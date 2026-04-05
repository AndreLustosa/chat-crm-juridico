import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { S3Service } from '../s3/s3.service';
import OpenAI, { toFile } from 'openai';
import axios from 'axios';
import { SkillRouter } from './skill-router';
import { ToolExecutor } from './tool-executor';
import { PromptBuilder } from './prompt-builder';
import { buildHandlerMap } from './tool-handlers';
import { createLLMClient, calculateCost, type LLMProvider } from './llm-client';

// Modelos com suporte a visão (imagens)
const VISION_MODELS = ['gpt-4o', 'gpt-4.1', 'gpt-5'];

// ─── Long Memory System Prompt (infraestrutura interna, não é skill) ───
const LONG_MEMORY_SYSTEM_PROMPT = `Você é uma IA especializada em gerenciamento de memória de longo prazo (LONG MEMORY) de leads e casos jurídicos, multiárea.

Objetivo:
Manter um "case_state" estruturado, enxuto e acionável para:
1) Redação de petições (ex.: inicial) com base em fatos e documentos.
2) Atendimento contínuo do cliente ao longo do tempo.

Você SEMPRE receberá:
- old_memory: a memória anterior (pode estar vazia).
- new_event: uma nova informação para guardar.

REGRAS OBRIGATÓRIAS:
1) NUNCA apague fatos já registrados.
2) Você PODE atualizar o estado atual ("current") quando houver informação mais específica ou correção, MAS deve registrar a mudança em "timeline" como "retificação/atualização" com data e origem.
3) NÃO copie o transcript inteiro. NÃO salve "oi", "ok", cumprimentos, nem falas irrelevantes.
4) Para rastreabilidade, quando possível inclua "source_ref".
5) Seja multiárea: não presuma área; só preencha se vier no new_event.

DEDUPE E CONTROLE DE TAMANHO:
- Deduplicar fatos repetidos.
- "summary" no máximo 800 caracteres.
- "core_facts" no máximo 25 itens. "open_questions" no máximo 20.
- Se exceder, consolidar: manter o essencial e registrar o excesso como "consolidação".

ORIGEM (origin) deve ser UMA destas strings:
"Lead" | "AtendenteHumano" | "AgenteSDR"

Retorne SOMENTE o JSON no schema:
{
  "lead": { "first_name": null, "full_name": null, "mother_name": null, "cpf": null, "phones": [], "emails": [], "city": null, "state": null },
  "case": { "area": null, "subarea": null, "status": "triage", "summary": null, "tags": [] },
  "parties": { "client_role": null, "counterparty_name": null, "counterparty_id": null, "counterparty_type": null },
  "facts": {
    "current": { "employment_status": null, "main_issue": null, "key_dates": {}, "key_values": {} },
    "core_facts": [],
    "timeline": [{ "date": null, "event": null, "origin": null, "source_ref": null }]
  },
  "evidence": { "has_evidence": null, "items": [{ "type": null, "status": "unknown", "notes": null, "source_ref": null }] },
  "open_questions": [],
  "next_actions": [],
  "meta": { "last_updated_at": null, "memory_version": 1 }
}`;

@Processor('ai-jobs')
export class AiProcessor extends WorkerHost {
  private readonly logger = new Logger(AiProcessor.name);
  private skillRouter = new SkillRouter();
  private promptBuilder = new PromptBuilder();

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private s3: S3Service,
    @InjectQueue('calendar-reminders') private reminderQueue: Queue,
  ) {
    super();
  }

  // ─── Retorna o parâmetro correto de tokens conforme o modelo ───
  private tokenParam(
    model: string,
    value: number,
  ): { max_tokens?: number; max_completion_tokens?: number } {
    const usesCompletionTokens = ['gpt-4.1', 'gpt-5', 'o1', 'o3'].some(
      (prefix) => model.startsWith(prefix),
    );
    return usesCompletionTokens
      ? { max_completion_tokens: value }
      : { max_tokens: value };
  }

  // ─── Verifica se o modelo suporta visão ───
  private modelSupportsVision(model: string): boolean {
    return VISION_MODELS.some((prefix) => model.startsWith(prefix));
  }

  // ─── Tabela de preços OpenAI (USD por 1M tokens) ───
  private static readonly OPENAI_PRICING: Record<string, { input: number; output: number }> = {
    'gpt-4o-mini':  { input: 0.15,  output: 0.60  },
    'gpt-4o':       { input: 5.00,  output: 15.00 },
    'gpt-4.1':      { input: 2.00,  output: 8.00  },
    'gpt-4.1-mini': { input: 0.40,  output: 1.60  },
    'gpt-5':        { input: 15.00, output: 60.00 },
    'gpt-5-mini':   { input: 1.50,  output: 6.00  },
    'o1':           { input: 15.00, output: 60.00 },
    'o3-mini':      { input: 1.10,  output: 4.40  },
  };

  // ─── Salva uso de tokens no banco para o dashboard de custos ───
  private async saveUsage(params: {
    conversation_id?: string | null;
    skill_id?: string | null;
    model: string;
    call_type: 'chat' | 'memory' | 'whisper';
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
  }): Promise<void> {
    if (!params.usage) return;
    // Busca preço pelo prefixo do modelo (ex: 'gpt-4.1' cobre 'gpt-4.1-mini')
    const priceEntry = Object.entries(AiProcessor.OPENAI_PRICING)
      .find(([key]) => params.model.startsWith(key));
    const price = priceEntry ? priceEntry[1] : { input: 0.15, output: 0.60 };
    const costUsd =
      (params.usage.prompt_tokens     * price.input  / 1_000_000) +
      (params.usage.completion_tokens * price.output / 1_000_000);
    try {
      await (this.prisma as any).aiUsage.create({
        data: {
          conversation_id: params.conversation_id ?? null,
          skill_id:        params.skill_id ?? null,
          model:           params.model,
          call_type:       params.call_type,
          prompt_tokens:     params.usage.prompt_tokens,
          completion_tokens: params.usage.completion_tokens,
          total_tokens:      params.usage.total_tokens,
          cost_usd:          costUsd,
        },
      });
    } catch (e) {
      this.logger.warn(`[AI] Falha ao salvar AiUsage: ${e}`);
    }
  }

  // ─── Seleciona a skill baseado na área jurídica ───
  private selectSkill(skills: any[], legalArea: string | null): any | null {
    if (!skills.length) return null;
    if (legalArea) {
      const specialist = skills.find(
        (s) =>
          s.area.toLowerCase().includes(legalArea.toLowerCase()) ||
          legalArea.toLowerCase().includes(s.area.toLowerCase()),
      );
      if (specialist) return specialist;
    }
    return (
      skills.find((s) =>
        ['geral', '*', 'triagem'].includes(s.area.toLowerCase()),
      ) || skills[0]
    );
  }

  // ─── Normaliza IDs de modelos (aliases → IDs reais da API) ───
  private normalizeModelId(model: string): string {
    const aliases: Record<string, string> = {
      'claude-haiku-4-5': 'claude-haiku-4-5-20251001',
      'claude-sonnet-4-5': 'claude-sonnet-4-5-20250514',
    };
    return aliases[model] || model;
  }

  // ─── Constrói header WAV para PCM raw (Gemini TTS retorna PCM 24kHz) ───
  private buildWavHeader(dataSize: number, sampleRate: number, channels: number, bitsPerSample: number): Buffer {
    const header = Buffer.alloc(44);
    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    const blockAlign = channels * (bitsPerSample / 8);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);
    return header;
  }

  // ─── Parseia resposta JSON da IA com fallbacks robustos ───
  private parseAiResponse(raw: string): {
    reply: string;
    updates: any;
    scheduling_action?: { action: string; date?: string; time?: string };
    slots_to_offer?: { date: string; time: string; label: string }[];
  } {
    const extract = (parsed: any) => ({
      reply: parsed.reply,
      updates: parsed.updates || parsed.lead_update || {},
      scheduling_action: parsed.scheduling_action || undefined,
      slots_to_offer: parsed.slots_to_offer || undefined,
    });

    try {
      const parsed = JSON.parse(raw);
      if (parsed.reply) return extract(parsed);
    } catch {}

    const jsonMatch = raw.match(/```json?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1].trim());
        if (parsed.reply) return extract(parsed);
      } catch {}
    }

    this.logger.warn('[AI] Resposta não é JSON válido — usando como texto puro');
    return { reply: raw, updates: {} };
  }

  // ─── Auto-transcreve mensagens de áudio sem texto (Whisper) ───
  private async autoTranscribeAudios(
    messages: any[],
    ai: OpenAI,
  ): Promise<void> {
    for (const msg of messages) {
      // Só áudios recebidos do cliente sem transcrição
      if (msg.direction !== 'in' || msg.type !== 'audio' || msg.text) continue;

      // Retry apenas para mensagens recentes (< 2 min). Mensagens antigas sem mídia
      // são do sync-history e nunca terão registro no S3 — pular sem esperar.
      let media = msg.media ?? null;
      const msgAge = Date.now() - new Date(msg.created_at).getTime();
      const isRecent = msgAge < 2 * 60 * 1000; // < 2 minutos

      if (!media?.s3_key && isRecent) {
        for (let attempt = 1; attempt <= 5; attempt++) {
          await new Promise((r) => setTimeout(r, 800));
          const found = await this.prisma.media.findFirst({
            where: { message_id: msg.id },
          });
          if (found?.s3_key) {
            media = found;
            break;
          }
          this.logger.log(
            `[AI] Aguardando mídia para msg ${msg.id} (tentativa ${attempt}/5)...`,
          );
        }
      }
      if (!media?.s3_key) {
        msg.text = '[o cliente enviou um áudio mas não foi possível ouvir — peça educadamente para repetir por texto ou enviar outro áudio]';
        continue;
      }

      try {
        const { buffer, contentType } = await this.s3.getObjectBuffer(
          media.s3_key,
        );
        const mimeBase = contentType.split(';')[0].trim();
        const ext = mimeBase.split('/')[1] || 'ogg';

        const file = await toFile(buffer, `audio.${ext}`, { type: mimeBase });
        const result = await ai.audio.transcriptions.create({
          file,
          model: 'gpt-4o-transcribe',
          language: 'pt',
          prompt: 'Transcrição de mensagem de voz do WhatsApp em português brasileiro. O cliente está conversando com um escritório de advocacia sobre questões jurídicas.',
        });

        const transcription = result.text?.trim() || '';
        if (transcription) {
          // Salva no banco para que próximos jobs não precisem retranscrever
          await this.prisma.message.update({
            where: { id: msg.id },
            data: { text: transcription },
          });
          msg.text = transcription; // atualiza in-memory
          this.logger.log(
            `[AI] Áudio transcrito (msg ${msg.id}): "${transcription.slice(0, 80)}"`,
          );
        }
      } catch (e: any) {
        this.logger.warn(
          `[AI] Falha ao transcrever áudio ${msg.id}: ${e.message}`,
        );
        msg.text = '[o cliente enviou um áudio mas não foi possível ouvir — peça educadamente para repetir por texto ou enviar outro áudio]';
      }
    }
  }

  // ─── Coleta imagens para visão (base64 inline) ───
  private async collectVisionImages(messages: any[]): Promise<
    { type: 'image_url'; image_url: { url: string } }[]
  > {
    const attachments: { type: 'image_url'; image_url: { url: string } }[] =
      [];

    for (const msg of messages) {
      if (msg.direction !== 'in' || msg.type !== 'image') continue;
      const media = msg.media ?? null;
      if (!media?.s3_key) continue;

      try {
        const { buffer, contentType } = await this.s3.getObjectBuffer(
          media.s3_key,
        );
        const mimeBase = contentType.split(';')[0].trim();
        const base64 = buffer.toString('base64');
        attachments.push({
          type: 'image_url',
          image_url: { url: `data:${mimeBase};base64,${base64}` },
        });
        this.logger.log(
          `[AI] Imagem carregada para visão (msg ${msg.id}, ${(buffer.length / 1024).toFixed(0)}KB)`,
        );
      } catch (e: any) {
        this.logger.warn(
          `[AI] Falha ao carregar imagem ${msg.id}: ${e.message}`,
        );
      }
    }

    return attachments;
  }

  // ─── Aplica updates do JSON da IA no banco ───
  private async applyAiUpdates(
    updates: any,
    convoId: string,
    leadId: string,
    leadPhone: string,
    instanceName: string | null,
  ) {
    if (!updates || typeof updates !== 'object') return;

    // a. Nome do lead — sempre atualiza quando a IA extrai o nome real do contato.
    //    O pushName do WhatsApp (display name) é apenas um placeholder inicial;
    //    quando o usuário informa o próprio nome a IA o captura e substitui.
    if (updates.name && updates.name !== 'null' && updates.name.length >= 2) {
      await this.prisma.lead.update({
        where: { id: leadId },
        data: { name: updates.name },
      });
      this.logger.log(
        `[AI] Nome atualizado: "${updates.name}" → lead ${leadId}`,
      );

      // Nome salvo no banco (Lead.name) — Evolution API não tem endpoint para renomear contatos
    }

    // b. Status → Lead.stage
    let resolvedStage: string | null = null;
    if (updates.status && updates.status !== 'null') {
      const stageData: Record<string, any> = { stage: updates.status, stage_entered_at: new Date() };
      // Se for PERDIDO, salvar loss_reason junto
      if (updates.status === 'PERDIDO' && updates.loss_reason) {
        stageData.loss_reason = updates.loss_reason;
      }
      await this.prisma.lead.update({ where: { id: leadId }, data: stageData });
      resolvedStage = updates.status;
      this.logger.log(`[AI] Lead.stage → "${updates.status}"${updates.loss_reason ? ` (motivo: ${updates.loss_reason})` : ''}`);
    } else if (!updates.status && updates.next_step) {
      // Se a IA enviou next_step mas esqueceu o status, inferir o stage automaticamente
      const inferMap: Record<string, string> = {
        formulario:        'AGUARDANDO_FORM',
        reuniao:           'REUNIAO_AGENDADA',
        documentos:        'AGUARDANDO_DOCS',
        procuracao:        'AGUARDANDO_PROC',
        encerrado:         'FINALIZADO',
        triagem_concluida: 'QUALIFICANDO',
        perdido:           'PERDIDO',
      };
      const inferred = inferMap[updates.next_step];
      if (inferred) {
        const stageData: Record<string, any> = { stage: inferred, stage_entered_at: new Date() };
        // Quando lead é perdido, salvar motivo se fornecido
        if (inferred === 'PERDIDO' && updates.loss_reason) {
          stageData.loss_reason = updates.loss_reason;
        }
        await this.prisma.lead.update({ where: { id: leadId }, data: stageData });
        resolvedStage = inferred;
        this.logger.log(`[AI] Stage inferido do next_step "${updates.next_step}": ${inferred}${updates.loss_reason ? ` (motivo: ${updates.loss_reason})` : ''}`);
      }
    } else if (updates.status === 'PERDIDO' && updates.loss_reason) {
      // Se a IA enviou PERDIDO diretamente no status, salvar loss_reason também
      await this.prisma.lead.update({ where: { id: leadId }, data: { loss_reason: updates.loss_reason } });
    }

    // === AUTOMAÇÃO: Criar tarefas automáticas baseado no novo stage ===
    if (resolvedStage) {
      try {
        const conv = await (this.prisma as any).conversation.findUnique({
          where: { id: convoId },
          select: { assigned_lawyer_id: true },
        });
        const lawyerId = conv?.assigned_lawyer_id;

        if (lawyerId) {
          const taskMap: Record<string, string> = {
            AGUARDANDO_DOCS: 'Cobrar documentos do lead',
            AGUARDANDO_PROC: 'Cobrar procuração do lead',
            AGUARDANDO_FORM: 'Acompanhar preenchimento do formulário',
          };
          const taskTitle = taskMap[resolvedStage];
          if (taskTitle) {
            const lead = await this.prisma.lead.findUnique({
              where: { id: leadId },
              select: { name: true },
            });
            await this.createCalendarEvent({
              type: 'TAREFA',
              title: `${taskTitle} — ${lead?.name || 'Lead'}`,
              description: `Tarefa automática criada pela IA ao mover lead para ${resolvedStage}`,
              start_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
              assigned_user_id: lawyerId,
              lead_id: leadId,
              conversation_id: convoId,
              created_by_id: lawyerId,
            });
            this.logger.log(
              `[AI] Tarefa automática criada: "${taskTitle}" para advogado ${lawyerId}`,
            );
          }
        }
      } catch (e: any) {
        this.logger.warn(`[AI] Falha ao criar tarefa automática: ${e.message}`);
      }
    }

    // c. Área → Conversation.legal_area (só se não classificada) + auto-atribuir especialista
    if (updates.area && updates.area !== 'null') {
      const conv = await (this.prisma as any).conversation.findUnique({
        where: { id: convoId },
        select: { legal_area: true, assigned_lawyer_id: true },
      });
      if (!conv?.legal_area) {
        await (this.prisma as any).conversation.update({
          where: { id: convoId },
          data: { legal_area: updates.area },
        });
        this.logger.log(`[AI] Área classificada: "${updates.area}"`);

        // Auto-atribuir o especialista menos ocupado (só se ainda não houver um)
        if (!conv?.assigned_lawyer_id) {
          const lawyerId = await this.findLeastBusySpecialist(updates.area);
          if (lawyerId) {
            await (this.prisma as any).conversation.update({
              where: { id: convoId },
              data: { assigned_lawyer_id: lawyerId },
            });
            this.logger.log(
              `[AI] Especialista pré-atribuído: ${lawyerId} (área: ${updates.area})`,
            );
          }
        }
      }
    }

    // d. lead_summary → AiMemory.summary
    if (updates.lead_summary) {
      await this.prisma.aiMemory.upsert({
        where: { lead_id: leadId },
        create: {
          lead_id: leadId,
          summary: updates.lead_summary,
          facts_json: {},
        },
        update: {
          summary: updates.lead_summary,
          last_updated_at: new Date(),
          version: { increment: 1 },
        },
      });
    }

    // e. next_step + notes → Conversation
    const convUpdate: any = {};
    if (updates.next_step) convUpdate.next_step = updates.next_step;
    if (updates.notes) convUpdate.ai_notes = updates.notes;
    if (Object.keys(convUpdate).length > 0) {
      await (this.prisma as any).conversation.update({
        where: { id: convoId },
        data: convUpdate,
      });
    }

    // f. form_data → Auto-preencher FichaTrabalhista (área Trabalhista)
    if (updates.form_data && typeof updates.form_data === 'object') {
      const formFields = updates.form_data;
      // Filtrar campos null/undefined
      const cleanFields: Record<string, any> = {};
      for (const [key, value] of Object.entries(formFields)) {
        if (value !== null && value !== undefined && value !== 'null') {
          cleanFields[key] = value;
        }
      }
      if (Object.keys(cleanFields).length > 0) {
        try {
          const ficha = await (this.prisma as any).fichaTrabalhista.upsert({
            where: { lead_id: leadId },
            update: {},
            create: { lead_id: leadId, data: {} },
          });
          const oldData = (ficha.data as Record<string, any>) || {};
          const merged = { ...oldData, ...cleanFields };
          const totalFields = 76;
          const filled = Object.values(merged).filter(
            (v) => v !== null && v !== undefined && v !== '',
          ).length;
          const pct = Math.min(100, Math.round((filled / totalFields) * 100));

          await (this.prisma as any).fichaTrabalhista.update({
            where: { lead_id: leadId },
            data: {
              data: merged,
              nome_completo: cleanFields.nome_completo ?? ficha.nome_completo,
              nome_empregador: cleanFields.nome_empregador ?? ficha.nome_empregador,
              completion_pct: pct,
              filled_by: 'ai',
            },
          });
          this.logger.log(
            `[AI] Ficha trabalhista atualizada: ${Object.keys(cleanFields).length} campo(s), ${pct}%`,
          );
        } catch (e: any) {
          this.logger.warn(`[AI] Falha ao atualizar ficha trabalhista: ${e.message}`);
        }
      }
    }

    // g. Se next_step = "formulario" e área = Trabalhista, preencher ficha com memória
    if (updates.next_step === 'formulario') {
      try {
        const conv = await (this.prisma as any).conversation.findUnique({
          where: { id: convoId },
          select: { legal_area: true },
        });
        if (conv?.legal_area?.toLowerCase().includes('trabalhist')) {
          const memory = await this.prisma.aiMemory.findUnique({
            where: { lead_id: leadId },
          });
          if (memory?.facts_json) {
            const facts = memory.facts_json as any;
            const mappedData: Record<string, string> = {};
            if (facts.lead?.full_name) mappedData.nome_completo = facts.lead.full_name;
            if (facts.lead?.cpf) mappedData.cpf = facts.lead.cpf;
            if (facts.lead?.city) mappedData.cidade = facts.lead.city;
            if (facts.lead?.state) mappedData.estado_uf = facts.lead.state;
            if (facts.lead?.phones?.[0]) mappedData.telefone = facts.lead.phones[0];
            if (facts.lead?.emails?.[0]) mappedData.email = facts.lead.emails[0];
            if (facts.lead?.mother_name) mappedData.nome_mae = facts.lead.mother_name;
            if (facts.parties?.counterparty_name) mappedData.nome_empregador = facts.parties.counterparty_name;
            if (facts.parties?.counterparty_id) mappedData.cnpjcpf_empregador = facts.parties.counterparty_id;
            if (facts.facts?.current?.employment_status) mappedData.situacao_atual = facts.facts.current.employment_status;
            if (facts.facts?.current?.main_issue) mappedData.motivos_reclamacao = facts.facts.current.main_issue;
            const kv = facts.facts?.current?.key_values || {};
            if (kv.salario) mappedData.salario = String(kv.salario);
            const kd = facts.facts?.current?.key_dates || {};
            if (kd.admissao) mappedData.data_admissao = kd.admissao;
            if (kd.demissao || kd.saida) mappedData.data_saida = kd.demissao || kd.saida;

            if (Object.keys(mappedData).length > 0) {
              const ficha = await (this.prisma as any).fichaTrabalhista.upsert({
                where: { lead_id: leadId },
                update: {},
                create: { lead_id: leadId, data: {} },
              });
              const merged = { ...(ficha.data as Record<string, any>), ...mappedData };
              const totalFields = 76;
              const filled = Object.values(merged).filter((v) => v != null && v !== '').length;
              const pct = Math.min(100, Math.round((filled / totalFields) * 100));

              await (this.prisma as any).fichaTrabalhista.update({
                where: { lead_id: leadId },
                data: {
                  data: merged,
                  nome_completo: mappedData.nome_completo ?? ficha.nome_completo,
                  nome_empregador: mappedData.nome_empregador ?? ficha.nome_empregador,
                  completion_pct: pct,
                  filled_by: 'ai',
                },
              });
              this.logger.log(
                `[AI] Ficha trabalhista preenchida da memória: ${Object.keys(mappedData).length} campo(s)`,
              );
            }
          }
        }
      } catch (e: any) {
        this.logger.warn(`[AI] Falha ao preencher ficha da memória: ${e.message}`);
      }
    }
  }

  // ─── Cria CalendarEvent diretamente + enfileira lembretes ───
  private async createCalendarEvent(params: {
    type: string;
    title: string;
    description?: string;
    start_at: Date;
    end_at?: Date;
    assigned_user_id: string;
    lead_id: string;
    conversation_id?: string;
    created_by_id: string;
  }): Promise<any> {
    const event = await this.prisma.calendarEvent.create({
      data: {
        type: params.type,
        title: params.title,
        description: params.description,
        start_at: params.start_at,
        end_at: params.end_at || new Date(params.start_at.getTime() + 30 * 60 * 1000),
        status: 'AGENDADO',
        priority: 'NORMAL',
        assigned_user_id: params.assigned_user_id,
        lead_id: params.lead_id,
        conversation_id: params.conversation_id,
        created_by_id: params.created_by_id,
        reminders: {
          create: [
            { minutes_before: 60, channel: 'WHATSAPP' },
            { minutes_before: 1440, channel: 'WHATSAPP' },
          ],
        },
      },
      include: { reminders: true },
    });

    // Enqueue WhatsApp reminders
    for (const r of event.reminders) {
      const fireAt = new Date(event.start_at.getTime() - r.minutes_before * 60 * 1000);
      if (fireAt > new Date()) {
        await this.reminderQueue.add(
          'send-reminder',
          { reminderId: r.id, eventId: event.id, channel: r.channel },
          { delay: fireAt.getTime() - Date.now() },
        );
      }
    }

    this.logger.log(
      `[AI] CalendarEvent criado: "${params.title}" (${params.type}) para ${params.assigned_user_id}`,
    );
    return event;
  }

  // ─── Consulta disponibilidade de horários de um advogado ───
  private async getAvailability(
    userId: string,
    dateStr: string,
    durationMinutes: number,
  ): Promise<{ start: string; end: string }[]> {
    const date = new Date(dateStr);
    const dayOfWeek = date.getDay();

    // Verificar feriado
    const dateOnly = date.toISOString().split('T')[0];
    const holidayCount = await (this.prisma as any).holiday.count({
      where: {
        OR: [
          { date: new Date(dateOnly) },
          { date: { gte: new Date(dateOnly + 'T00:00:00'), lte: new Date(dateOnly + 'T23:59:59') } },
        ],
      },
    });
    if (holidayCount > 0) return [];

    // Horário de trabalho do dia
    const schedule = await (this.prisma as any).userSchedule.findUnique({
      where: { user_id_day_of_week: { user_id: userId, day_of_week: dayOfWeek } },
    });
    if (!schedule) return [];

    // Eventos existentes nesse dia
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    const events = await this.prisma.calendarEvent.findMany({
      where: {
        assigned_user_id: userId,
        start_at: { gte: dayStart, lte: dayEnd },
        status: { notIn: ['CANCELADO'] },
      },
      select: { start_at: true, end_at: true },
      orderBy: { start_at: 'asc' },
    });

    // Calcular slots livres
    const [startH, startM] = schedule.start_time.split(':').map(Number);
    const [endH, endM] = schedule.end_time.split(':').map(Number);
    const workStart = startH * 60 + startM;
    const workEnd = endH * 60 + endM;

    const busy = events.map((e: any) => {
      const s = e.start_at.getHours() * 60 + e.start_at.getMinutes();
      const eEnd = e.end_at
        ? e.end_at.getHours() * 60 + e.end_at.getMinutes()
        : s + 30;
      return { start: s, end: eEnd };
    });

    // Adicionar pausa de almoço como período ocupado
    if (schedule.lunch_start && schedule.lunch_end) {
      const [lsH, lsM] = (schedule.lunch_start as string).split(':').map(Number);
      const [leH, leM] = (schedule.lunch_end as string).split(':').map(Number);
      busy.push({ start: lsH * 60 + lsM, end: leH * 60 + leM });
      busy.sort((a: any, b: any) => a.start - b.start);
    }

    const slots: { start: string; end: string }[] = [];
    let cursor = workStart;
    for (const b of busy) {
      while (cursor + durationMinutes <= b.start) {
        const slotEnd = cursor + durationMinutes;
        slots.push({
          start: `${String(Math.floor(cursor / 60)).padStart(2, '0')}:${String(cursor % 60).padStart(2, '0')}`,
          end: `${String(Math.floor(slotEnd / 60)).padStart(2, '0')}:${String(slotEnd % 60).padStart(2, '0')}`,
        });
        cursor = slotEnd;
      }
      if (b.end > cursor) cursor = b.end;
    }
    while (cursor + durationMinutes <= workEnd) {
      const slotEnd = cursor + durationMinutes;
      slots.push({
        start: `${String(Math.floor(cursor / 60)).padStart(2, '0')}:${String(cursor % 60).padStart(2, '0')}`,
        end: `${String(Math.floor(slotEnd / 60)).padStart(2, '0')}:${String(slotEnd % 60).padStart(2, '0')}`,
      });
      cursor = slotEnd;
    }

    return slots;
  }

  // ─── Encontra o especialista menos ocupado para uma área jurídica ───
  private async findLeastBusySpecialist(area: string): Promise<string | null> {
    const allUsers = await (this.prisma as any).user.findMany({
      where: { specialties: { isEmpty: false } },
      select: { id: true, specialties: true },
    });

    const areaLower = area.toLowerCase();
    const specialists = (allUsers as any[]).filter((u) =>
      u.specialties.some(
        (s: string) =>
          s.toLowerCase().includes(areaLower) ||
          areaLower.includes(s.toLowerCase()),
      ),
    );

    if (!specialists.length) {
      this.logger.warn(
        `[AI] Nenhum especialista encontrado para área: "${area}"`,
      );
      return null;
    }

    const counts = await Promise.all(
      specialists.map(async (s) => {
        const count = await (this.prisma as any).conversation.count({
          where: { assigned_lawyer_id: s.id, status: 'ABERTO' },
        });
        return { id: s.id as string, count };
      }),
    );

    counts.sort((a, b) => a.count - b.count);
    this.logger.log(
      `[AI] Especialistas disponíveis para "${area}": ${counts.map((c) => `${c.id}(${c.count})`).join(', ')}`,
    );
    return counts[0]?.id ?? null;
  }

  // ─── Atualiza Long Memory estruturada com GPT-4.1 ───
  private async updateLongMemory(
    ai: OpenAI,
    leadId: string,
    historyText: string,
    latestUpdates: any,
  ) {
    const existing = await this.prisma.aiMemory.findUnique({
      where: { lead_id: leadId },
    });
    const oldMemory = (existing?.facts_json as any) || {};

    const memoryModel = await this.settings.getMemoryModel();

    const newEvent = `Últimas mensagens:\n${historyText.slice(-3000)}\n\nUpdates do agente: ${JSON.stringify(latestUpdates || {})}`;

    const memoryResult = await ai.chat.completions.create({
      model: memoryModel,
      messages: [
        { role: 'system', content: LONG_MEMORY_SYSTEM_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            old_memory: oldMemory,
            new_event: newEvent,
          }),
        },
      ],
      ...this.tokenParam(memoryModel, 4000),
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const rawContent =
      memoryResult.choices[0]?.message?.content || '{}';

    // Registra uso de tokens da memória para dashboard de custos
    await this.saveUsage({
      model: memoryModel,
      call_type: 'memory',
      usage: memoryResult.usage,
    });

    const parsed = JSON.parse(rawContent);

    if (parsed.lead || parsed.case || parsed.facts) {
      // Prioridade para summary: updates do agente AI > gerado pelo modelo de memória > anterior
      const newSummary =
        latestUpdates?.lead_summary ||
        parsed?.case?.summary ||
        existing?.summary ||
        '';
      await this.prisma.aiMemory.upsert({
        where: { lead_id: leadId },
        create: {
          lead_id: leadId,
          summary: newSummary,
          facts_json: parsed,
        },
        update: {
          facts_json: parsed,
          summary: newSummary,
          last_updated_at: new Date(),
          version: { increment: 1 },
        },
      });
      this.logger.log(
        `[AI] Long Memory atualizada (v${(existing?.version || 0) + 1}) para lead ${leadId} (model=${memoryModel})`,
      );
    }
  }

  // ─── Processo principal ───
  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`Iniciando job de IA: ${job.id}`);

    // 1. Ler chave OpenAI do banco
    const openAiKey = await this.settings.getOpenAiKey();
    if (!openAiKey) {
      this.logger.warn(
        'OPENAI_API_KEY não configurada — configure em Ajustes IA',
      );
      return;
    }

    const { conversation_id } = job.data;

    if (!conversation_id) {
      this.logger.warn(`[AI] Job ${job.id} sem conversation_id — ignorando (payload: ${JSON.stringify(job.data).slice(0, 100)})`);
      return;
    }

    try {
      // 2. Buscar conversa + lead + últimas 20 mensagens com mídia incluída
      // orderBy desc para pegar as mais RECENTES; invertemos abaixo para ordem cronológica
      const convo = await this.prisma.conversation.findUnique({
        where: { id: conversation_id },
        include: {
          lead: true,
          messages: {
            orderBy: { created_at: 'desc' },
            take: 80,
            include: { media: true },
          },
        },
      });

      // 3. Verificar ai_mode ativo
      if (!convo) return;

      // 3a. Mesmo sem ai_mode, atualiza Long Memory para conversas do operador humano.
      // Isso garante que o "Resumo dos Fatos" seja atualizado mesmo quando um humano atende.
      if (!convo.ai_mode) {
        if (convo.messages.length > 0) {
          try {
            const aiForMemory = new OpenAI({ apiKey: openAiKey });
            const chronologicalMemory = [...convo.messages].reverse();
            const historyForMemory = chronologicalMemory
              .map((m: any) => {
                const sender =
                  m.direction === 'in'
                    ? 'Cliente'
                    : m.external_message_id?.startsWith('sys_')
                      ? 'Sophia'
                      : 'Operador';
                const content =
                  m.text ||
                  (m.type === 'audio'
                    ? '[áudio sem transcrição]'
                    : m.type === 'image'
                      ? `[imagem${m.media?.original_name ? ': ' + m.media.original_name : ''}]`
                      : m.type === 'document'
                        ? `[documento${m.media?.original_name ? ': ' + m.media.original_name : ''}]`
                        : '[mídia]');
                return `${sender}: ${content}`;
              })
              .join('\n');
            await this.updateLongMemory(aiForMemory, convo.lead_id, historyForMemory, null);
            this.logger.log(`[AI] Long Memory atualizada para conversa do operador humano (conv ${conversation_id})`);
          } catch (memErr: any) {
            this.logger.warn(`[AI] Falha ao atualizar Long Memory (modo operador): ${memErr.message}`);
          }
        }
        return;
      }

      // 3b. Anti-stale check — aborta job duplicado/obsoleto
      // Mensagens carregadas em ordem DESC: convo.messages[0] = mais recente.
      // Se a mensagem mais recente já é outbound (IA/operador respondeu), não há nada a responder.
      // Isso ocorre quando dois jobs são enfileirados quase ao mesmo tempo (race condition)
      // e o segundo encontra a conversa já respondida pelo primeiro.
      const mostRecentMsg = convo.messages[0];
      if (mostRecentMsg && mostRecentMsg.direction === 'out') {
        this.logger.warn(
          `[AI] Job ${job.id} abortado — última msg já é outbound (race condition evitada) para conv ${conversation_id}`,
        );
        return;
      }

      // 4. (Debounce gerenciado no enqueue — evolution.service.ts)
      // O job só chega aqui após o silêncio do lead (delay configurável em Ajustes IA).
      // Não há mais cooldown guard aqui; o processor simplesmente processa todas as
      // mensagens acumuladas no histórico de uma só vez.

      const ai = new OpenAI({ apiKey: openAiKey });

      // 5. Auto-transcrever áudios sem texto (Whisper) — salva no banco
      await this.autoTranscribeAudios(convo.messages as any[], ai);

      // 6. Carregar AiMemory (Long Memory) do lead
      const memory = await this.prisma.aiMemory.findUnique({
        where: { lead_id: convo.lead_id },
      });
      const factsJson = (memory?.facts_json as any) || null;

      // Montar memória legível COMPLETA para injeção no prompt
      // Quanto mais detalhada, menos chance de repetir perguntas
      let leadMemory = 'Nenhuma memória anterior — primeiro contato.';
      if (memory && (memory.summary || factsJson)) {
        const parts: string[] = [];
        if (memory.summary) parts.push(`📋 Resumo: ${memory.summary}`);
        // Dados do lead
        if (factsJson?.lead) {
          const l = factsJson.lead;
          const leadParts: string[] = [];
          if (l.full_name) leadParts.push(`Nome: ${l.full_name}`);
          if (l.first_name && !l.full_name) leadParts.push(`Nome: ${l.first_name}`);
          if (l.cpf) leadParts.push(`CPF: ${l.cpf}`);
          if (l.mother_name) leadParts.push(`Mãe: ${l.mother_name}`);
          if (l.city) leadParts.push(`Cidade: ${l.city}`);
          if (l.state) leadParts.push(`Estado: ${l.state}`);
          if (l.phones?.length) leadParts.push(`Telefone(s): ${l.phones.join(', ')}`);
          if (l.emails?.length) leadParts.push(`Email(s): ${l.emails.join(', ')}`);
          if (leadParts.length) parts.push(`👤 Dados do Lead: ${leadParts.join(' | ')}`);
        }
        // Caso
        if (factsJson?.case) {
          const c = factsJson.case;
          const caseParts: string[] = [];
          if (c.area) caseParts.push(`Área: ${c.area}`);
          if (c.subarea) caseParts.push(`Subárea: ${c.subarea}`);
          if (c.status) caseParts.push(`Status: ${c.status}`);
          if (c.summary) caseParts.push(`Resumo: ${c.summary}`);
          if (c.tags?.length) caseParts.push(`Tags: ${c.tags.join(', ')}`);
          if (caseParts.length) parts.push(`⚖️ Caso: ${caseParts.join(' | ')}`);
        }
        // Partes
        if (factsJson?.parties) {
          const p = factsJson.parties;
          const partyParts: string[] = [];
          if (p.client_role) partyParts.push(`Papel do cliente: ${p.client_role}`);
          if (p.counterparty_name) partyParts.push(`Parte contrária: ${p.counterparty_name}`);
          if (p.counterparty_id) partyParts.push(`CNPJ/CPF contrária: ${p.counterparty_id}`);
          if (p.counterparty_type) partyParts.push(`Tipo: ${p.counterparty_type}`);
          if (partyParts.length) parts.push(`🏢 Partes: ${partyParts.join(' | ')}`);
        }
        // Fatos
        if (factsJson?.facts) {
          const f = factsJson.facts;
          if (f.current) {
            const curParts: string[] = [];
            if (f.current.employment_status) curParts.push(`Situação: ${f.current.employment_status}`);
            if (f.current.main_issue) curParts.push(`Problema: ${f.current.main_issue}`);
            if (f.current.key_dates && Object.keys(f.current.key_dates).length) {
              curParts.push(`Datas: ${Object.entries(f.current.key_dates).map(([k,v]) => `${k}=${v}`).join(', ')}`);
            }
            if (f.current.key_values && Object.keys(f.current.key_values).length) {
              curParts.push(`Valores: ${Object.entries(f.current.key_values).map(([k,v]) => `${k}=${v}`).join(', ')}`);
            }
            if (curParts.length) parts.push(`📌 Situação atual: ${curParts.join(' | ')}`);
          }
          if (f.core_facts?.length)
            parts.push(`📝 Fatos-chave:\n${f.core_facts.map((fact: string, i: number) => `  ${i+1}. ${fact}`).join('\n')}`);
          if (f.timeline?.length) {
            const events = f.timeline.filter((t: any) => t?.event).slice(-10);
            if (events.length)
              parts.push(`📅 Timeline:\n${events.map((t: any) => `  - ${t.date || '?'}: ${t.event} (${t.origin || '?'})`).join('\n')}`);
          }
        }
        // Evidências
        if (factsJson?.evidence?.items?.length) {
          const evItems = factsJson.evidence.items
            .filter((e: any) => e?.type)
            .map((e: any) => `${e.type}(${e.status || '?'})${e.notes ? ': '+e.notes : ''}`);
          if (evItems.length)
            parts.push(`📎 Evidências: ${evItems.join('; ')}`);
        }
        // Perguntas pendentes
        if (factsJson?.open_questions?.length)
          parts.push(`❓ Perguntas AINDA pendentes (pergunte estas):\n${factsJson.open_questions.map((q: string, i: number) => `  ${i+1}. ${q}`).join('\n')}`);
        // Próximas ações
        if (factsJson?.next_actions?.length)
          parts.push(`🎯 Próximas ações: ${factsJson.next_actions.join('; ')}`);

        // Histórico de etapas CRM (kanban de leads)
        if (factsJson?.crm_timeline?.length) {
          const entries = (factsJson.crm_timeline as any[]).slice(-10);
          parts.push(`🏷️ Jornada no CRM:\n${entries.map((e: any) => `  - ${e.date}: ${e.from || 'início'} → ${e.to}${e.loss_reason ? ` (${e.loss_reason})` : ''}`).join('\n')}`);
        }
        // Histórico de etapas do processo judicial
        if (factsJson?.case_timeline?.length) {
          const entries = (factsJson.case_timeline as any[]).slice(-10);
          parts.push(`⚖️ Histórico do Processo:\n${entries.map((e: any) => `  - ${e.date}: ${e.from || 'início'} → ${e.to}${e.case_number ? ` (${e.case_number})` : ''}`).join('\n')}`);
        }
        // Petições protocoladas/aprovadas
        if (factsJson?.petitions?.length) {
          const pItems = (factsJson.petitions as any[]).slice(-5);
          parts.push(`📄 Petições: ${pItems.map((p: any) => `${p.type}(${p.status})${p.date ? ' em '+p.date : ''}`).join('; ')}`);
        }
        // Publicações DJEN analisadas
        if (factsJson?.djen_publications?.length) {
          const dItems = (factsJson.djen_publications as any[]).slice(0, 5);
          parts.push(`📰 DJEN (${dItems.length} pub.):\n${dItems.map((d: any) => `  - ${d.date}: ${d.tipo}${d.assunto ? ' — '+d.assunto : ''}. ${d.resumo || ''}`).join('\n')}`);
        }

        if (parts.length) leadMemory = parts.join('\n');
      }

      // 7. Montar histórico com rótulos (Cliente / Sophia / Operador)
      // Invertemos o array (que veio desc) para ordem cronológica correta
      const chronological = [...convo.messages].reverse();
      const historyText = chronological
        .map((m: any) => {
          const sender =
            m.direction === 'in'
              ? 'Cliente'
              : m.external_message_id?.startsWith('sys_')
                ? 'Sophia'
                : 'Operador';
          // Indica tipo de mídia quando não há texto
          const content =
            m.text ||
            (m.type === 'audio'
              ? '[áudio sem transcrição]'
              : m.type === 'image'
                ? `[imagem${m.media?.original_name ? ': ' + m.media.original_name : ''}]`
                : m.type === 'document'
                  ? `[documento${m.media?.original_name ? ': ' + m.media.original_name : ''}]`
                  : '[mídia]');
          return `${sender}: ${content}`;
        })
        .join('\n');

      // 8. Carregar skills ativas (com tools e assets inclusos)
      const activeSkills = await this.settings.getActiveSkills();

      // 9. Selecionar skill — via Router inteligente ou fallback area-matching
      const legalArea = (convo as any).legal_area || null;
      const nextStep = (convo as any).next_step || null;
      const routerConfig = await this.settings.getRouterConfig();
      let skill: any = null;
      let routerReason = '';
      let routerTokens = 0;

      if (routerConfig.enabled && activeSkills.length > 1) {
        try {
          const routerApiKey = routerConfig.provider === 'anthropic'
            ? await this.settings.getAnthropicKey()
            : await this.settings.getOpenAiKey();

          if (routerApiKey) {
            // Últimas 5 mensagens para contexto do router
            const lastMsgs = chronological.slice(-5).map((m: any) => {
              const sender = m.direction === 'in' ? 'Cliente' : 'Sophia';
              return `${sender}: ${(m.text || '[mídia]').slice(0, 200)}`;
            });

            const routerResult = await this.skillRouter.selectSkill({
              skills: activeSkills,
              lastMessages: lastMsgs,
              legalArea,
              nextStep,
              routerModel: routerConfig.model,
              routerProvider: routerConfig.provider as LLMProvider,
              apiKey: routerApiKey,
            });

            skill = activeSkills.find((s: any) => s.id === routerResult.skillId) || null;
            routerReason = routerResult.reason;
            routerTokens = routerResult.tokensUsed;
          }
        } catch (err: any) {
          this.logger.warn(`[AI] Router falhou: ${err.message}. Usando fallback.`);
        }
      }

      // Fallback: area-matching original
      if (!skill) {
        skill = this.selectSkill(activeSkills, legalArea);
        routerReason = routerReason || 'fallback: area matching';
      }

      // 10. Preparar prompt e parâmetros
      let systemPrompt: string;
      let model: string;
      let maxTokens: number;
      let temperature: number;

      // 10b. Buscar status da ficha trabalhista (se área trabalhista)
      let fichaStatus = '';
      if (legalArea?.toLowerCase().includes('trabalhist')) {
        try {
          const ficha = await (this.prisma as any).fichaTrabalhista.findUnique({
            where: { lead_id: convo.lead_id },
          });
          if (ficha?.data) {
            const data = ficha.data as Record<string, any>;
            const requiredFields = [
              'nome_completo', 'cpf', 'data_nascimento', 'nome_mae', 'estado_civil', 'profissao', 'telefone', 'email',
              'cidade', 'estado_uf',
              'nome_empregador', 'funcao', 'data_admissao', 'situacao_atual', 'salario', 'ctps_assinada_corretamente', 'atividades_realizadas',
              'horario_entrada', 'horario_saida', 'tempo_intervalo', 'dias_trabalhados', 'fazia_horas_extras',
              'fgts_depositado', 'fgts_sacado', 'tem_ferias_pendentes', 'tem_decimo_terceiro_pendente',
              'possui_testemunhas', 'possui_provas_documentais',
            ];
            const filled = requiredFields.filter(k => data[k] && data[k] !== '');
            const missing = requiredFields.filter(k => !data[k] || data[k] === '');
            fichaStatus = `CAMPOS JÁ PREENCHIDOS (${filled.length}/${requiredFields.length}): ${filled.join(', ')}\nCAMPOS FALTANDO (${missing.length}): ${missing.join(', ')}\nProgresso: ${ficha.completion_pct || 0}%`;
          } else {
            fichaStatus = 'FICHA AINDA NÃO INICIADA — nenhum campo preenchido. Comece coletando os dados.';
          }
        } catch {
          fichaStatus = 'FICHA AINDA NÃO INICIADA — nenhum campo preenchido. Comece coletando os dados.';
        }
      }

      const siteUrl = process.env.APP_URL || 'https://andrelustosaadvogados.com.br';

      // 10c. Buscar horários disponíveis do advogado atribuído (para agendamento)
      let availableSlots = 'Nenhum advogado atribuído — horários indisponíveis.';
      const assignedLawyerId = (convo as any).assigned_lawyer_id;
      if (assignedLawyerId) {
        try {
          const now = new Date();
          const formatDateBR = (d: Date) =>
            d.toLocaleDateString('pt-BR', { timeZone: 'America/Maceio', day: '2-digit', month: '2-digit' });
          const slotParts: string[] = [];
          // Buscar slots para os próximos 5 dias úteis
          for (let i = 1; i <= 7 && slotParts.length < 5; i++) {
            const day = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
            if (day.getDay() === 0 || day.getDay() === 6) continue; // pular fim de semana
            const dateStr = day.toISOString().split('T')[0];
            const slots = await this.getAvailability(assignedLawyerId, dateStr, 60);
            if (slots.length > 0) {
              const slotsStr = slots.slice(0, 6).map((s) => s.start).join(', ');
              slotParts.push(`${formatDateBR(day)} (${dateStr}): ${slotsStr}`);
            }
          }
          if (slotParts.length > 0) {
            availableSlots = slotParts.join(' | ');
          } else {
            availableSlots = 'Sem horários disponíveis nos próximos dias.';
          }
        } catch (e: any) {
          this.logger.warn(`[AI] Falha ao buscar disponibilidade: ${e.message}`);
          availableSlots = 'Erro ao consultar horários — tente novamente.';
        }
      }

      // ── Próximos eventos do calendário do lead — perícias, audiências, prazos ──
      let upcomingEventsBlock = '';
      try {
        const upcomingEvents = await this.prisma.calendarEvent.findMany({
          where: {
            lead_id: convo.lead_id,
            start_at: { gte: new Date() },
            status: { notIn: ['CANCELADO', 'CONCLUIDO'] },
          },
          orderBy: { start_at: 'asc' },
          take: 5,
          select: { type: true, title: true, start_at: true, location: true, description: true },
        });
        if (upcomingEvents.length > 0) {
          const TYPE_LABEL: Record<string, string> = {
            AUDIENCIA: '⚖️ Audiência', PERICIA: '🔬 Perícia', PRAZO: '⏰ Prazo',
            CONSULTA: '📞 Consulta', TAREFA: '✅ Tarefa', OUTRO: '📅 Evento',
          };
          const lines = upcomingEvents.map(e => {
            const dt = e.start_at;
            const dateStr = `${String(dt.getUTCDate()).padStart(2,'0')}/${String(dt.getUTCMonth()+1).padStart(2,'0')}/${dt.getUTCFullYear()} ${String(dt.getUTCHours()).padStart(2,'0')}:${String(dt.getUTCMinutes()).padStart(2,'0')}`;
            const label = TYPE_LABEL[e.type] || e.type;
            return `- ${label}: ${e.title} | ${dateStr}${e.location ? ` | Local: ${e.location}` : ''}${e.description ? ` | ${e.description.slice(0,100)}` : ''}`;
          });
          upcomingEventsBlock =
            `\n═══════════════════════════════════════════════════\n` +
            `📅 PRÓXIMOS EVENTOS DO CLIENTE (use para responder dúvidas sobre data/horário):\n` +
            lines.join('\n') + '\n' +
            `═══════════════════════════════════════════════════\n`;
        }
      } catch (e: any) {
        this.logger.warn(`[AI] Falha ao buscar próximos eventos: ${e.message}`);
      }

      // ── Notas internas dos operadores (ConversationNote) — visíveis para a IA ──
      let operatorNotesBlock = '';
      try {
        const opNotes = await (this.prisma as any).conversationNote.findMany({
          where: { conversation_id: convo.id },
          orderBy: { created_at: 'desc' },
          take: 10,
          include: { user: { select: { name: true } } },
        });
        if (opNotes.length > 0) {
          const lines = opNotes.reverse().map((n: any) => {
            const date = new Date(n.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            return `- [${n.user?.name || 'Operador'}, ${date}]: ${n.text}`;
          });
          operatorNotesBlock =
            `\n═══════════════════════════════════════════════════\n` +
            `📝 NOTAS INTERNAS DOS OPERADORES (instruções da equipe — OBEDEÇA):\n` +
            lines.join('\n') + '\n' +
            `═══════════════════════════════════════════════════\n`;
        }
      } catch (e: any) {
        this.logger.warn(`[AI] Falha ao carregar notas internas: ${e.message}`);
      }

      // ── ai_notes — observações da própria IA sobre o lead ──
      let aiNotesBlock = '';
      if ((convo as any).ai_notes) {
        aiNotesBlock =
          `\n═══════════════════════════════════════════════════\n` +
          `🤖 SUAS ANOTAÇÕES ANTERIORES (você escreveu isso):\n` +
          `${(convo as any).ai_notes}\n` +
          `═══════════════════════════════════════════════════\n`;
      }

      // ── Reminder context — injeta aviso se cliente está respondendo a um lembrete recente ──
      let reminderContextBlock = '';
      const reminderCtx = (convo as any).reminder_context as any;
      if (reminderCtx && reminderCtx.sent_at) {
        const sentAt = new Date(reminderCtx.sent_at);
        const hoursAgo = Math.round((Date.now() - sentAt.getTime()) / 3_600_000);
        if (hoursAgo < 48) {
          const quando = hoursAgo === 0 ? 'há menos de 1 hora' : `há ${hoursAgo} hora(s)`;
          reminderContextBlock =
            `\n═══════════════════════════════════════════════════\n` +
            `⚠️ CONTEXTO — LEMBRETE ENVIADO AO CLIENTE (${quando}):\n` +
            `Tipo: ${reminderCtx.type || ''}\n` +
            `Evento: ${reminderCtx.event_title || ''}\n` +
            `Data/Hora: ${reminderCtx.event_date || ''}\n` +
            (reminderCtx.location ? `Local: ${reminderCtx.location}\n` : '') +
            `\nMensagem que foi enviada ao cliente:\n"${(reminderCtx.message_sent || '').slice(0, 500)}"\n` +
            `\nINSTRUÇÕES IMPORTANTES:\n` +
            `- Se o cliente está respondendo agora, PROVAVELMENTE é sobre este lembrete.\n` +
            `- Você JÁ SABE todos os detalhes da audiência — NÃO pergunte data, local ou horário.\n` +
            `- Responda dúvidas (documentos a levar, como se preparar, o que esperar etc.) com naturalidade.\n` +
            `- NÃO mencione que foi você quem enviou o lembrete — aja como atendente humano normal.\n` +
            `═══════════════════════════════════════════════════\n`;
        }
      }

      const vars: Record<string, string> = {
        lead_name: convo.lead.name || 'Desconhecido',
        lead_phone: convo.lead.phone || '',
        legal_area: legalArea || 'a ser identificada',
        firm_name: 'André Lustosa Advogados',
        lead_memory: leadMemory,
        lead_summary: memory?.summary || '',
        conversation_id: convo.id,
        lead_id: convo.lead_id || convo.lead?.id || '',
        history_summary: historyText.slice(0, 2000),
        // URL base do site — use no prompt: "{{site_url}}/geral/arapiraca"
        site_url: siteUrl,
        form_url: `${siteUrl}/formulario/trabalhista/${convo.lead_id || convo.lead?.id || ''}`,
        data_hoje: new Date().toLocaleString('pt-BR', {
          timeZone: 'America/Maceio',
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        }),
        ficha_status: fichaStatus,
        available_slots: availableSlots,
        reminder_context: reminderContextBlock,
        upcoming_events: upcomingEventsBlock,
        operator_notes: operatorNotesBlock,
        ai_notes: aiNotesBlock,
      };

      // Cabeçalho fixo de capacidades — injetado antes de qualquer skill prompt
      const MEDIA_CAPABILITIES_HEADER = `CAPACIDADES DE MÍDIA DISPONÍVEIS:
- Áudios são transcritos automaticamente por IA (Whisper). O texto transcrito já aparece no histórico como texto normal. NUNCA diga que não consegue ouvir — você lê a transcrição.
- Imagens e documentos enviados pelo cliente são analisados visualmente quando o modelo suporta visão. Responda ao conteúdo deles normalmente.
- NUNCA peça para o cliente "escrever em texto" por causa de mídia — você já consegue ler o conteúdo.

`;

      // CORE_RULES: regras técnicas imutáveis injetadas em TODO prompt.
      // O conteúdo de personalidade, roteiro e comportamento está no skill.system_prompt (editável no admin).
      const CORE_RULES = `DATA E HORA ATUAL: {{data_hoje}} (fuso horário de Maceió/AL).

═══════════════════════════════════════════════════
MEMÓRIA DO LEAD (tudo que já foi coletado sobre este cliente):
{{lead_memory}}
═══════════════════════════════════════════════════
{{operator_notes}}
{{ai_notes}}
{{reminder_context}}
{{upcoming_events}}
REGRAS DE TOM E FORMATO (INVIOLÁVEIS):
- MÁXIMO 2 frases curtas por mensagem. Se passar disso, CORTE.
- NUNCA pular linha na mensagem. Tudo em bloco só.
- NUNCA usar: "Opa", "Beleza", "Caramba", "Show", "Top", "Legal", "Massa", "Dahora"
- NUNCA usar: "Ótima pergunta", "Boa pergunta", "Excelente pergunta"
- NUNCA usar: "Entendi.", "Ok.", "Certo.", "Vou anotar", "Anotei"
- NUNCA comentar o que o lead disse: nada de "isso é sério", "é pesado mesmo", "complicado"
- NUNCA ser MAIS informal que o lead. O lead define o tom. Se ele escreve formal, responda formal.
- Vá DIRETO para a próxima pergunta. Sem preâmbulos.

PROIBIDO REPETIR PERGUNTAS:
- O histórico COMPLETO da conversa está nos turns acima (user/assistant). LEIA TUDO.
- A MEMÓRIA DO LEAD contém TODOS os fatos já extraídos.
- ANTES de perguntar algo, verifique SE a informação já foi dita no histórico OU na memória.
- Se perceber que repetiu, reconheça e avance.

HORÁRIOS DISPONÍVEIS DO ADVOGADO (use SOMENTE estes — NUNCA invente datas ou horários):
{{available_slots}}
REGRAS DE AGENDAMENTO: sábado e domingo NÃO são dias úteis. NUNCA ofereça fim de semana. Use {{data_hoje}} para calcular dias da semana corretamente.

STATUS DA FICHA:
{{ficha_status}}
`;


      if (skill) {
        // Injetar references (SkillAssets com inject_mode=full_text) no prompt via PromptBuilder
        const references = (skill.assets || [])
          .filter((a: any) => a.inject_mode === 'full_text' && a.content_text)
          .map((a: any) => ({ name: a.name, content: a.content_text }));

        systemPrompt = this.promptBuilder.buildSystemPrompt({
          mediaCapabilities: MEDIA_CAPABILITIES_HEADER,
          behaviorRules: CORE_RULES,
          skillPrompt: skill.system_prompt,
          references,
          maxContextTokens: skill.max_context_tokens || 4000,
          vars,
        });
        model = this.normalizeModelId(skill.model || (await this.settings.getDefaultModel()));
        maxTokens = Math.max(skill.max_tokens || 500, 800);
        temperature = skill.temperature ?? 0.7;
        this.logger.log(
          `[AI] Usando skill: "${skill.name}" (area=${skill.area}, model=${model})`,
        );
      } else {
        const fallbackSkillPrompt = `Você é Sophia, assistente de pré-atendimento do escritório André Lustosa Advogados.
Seu objetivo é coletar informações sobre o caso do cliente para o advogado conseguir avaliar.

ROTEIRO (siga na ordem, UMA pergunta por vez):
1. Cumprimente e pergunte o nome do cliente.
2. Pergunte qual é o problema principal (deixe o cliente descrever com as próprias palavras).
3. Colete detalhes: quando ocorreu, quem é a outra parte (empresa ou pessoa), se há valores envolvidos.
4. Pergunte se possui documentos ou provas (contrato, mensagens, fotos, etc.).
5. Quando tiver informações suficientes, informe que o advogado vai analisar e oriente o próximo passo.

Retorne SOMENTE JSON válido: {"reply":"texto para enviar","updates":{"name":null,"status":"INICIAL","area":null,"lead_summary":"resumo","next_step":"duvidas","notes":"","loss_reason":null,"form_data":null},"scheduling_action":null}

Valores válidos para updates.status: INICIAL | QUALIFICANDO | AGUARDANDO_FORM | REUNIAO_AGENDADA | AGUARDANDO_DOCS | AGUARDANDO_PROC | FINALIZADO | PERDIDO
Valores válidos para updates.next_step: duvidas | triagem_concluida | entrevista | formulario | reuniao | documentos | procuracao | encerrado | perdido
updates.loss_reason: motivo da perda em português (ex: "Sem interesse"). Obrigatório quando next_step="perdido". Null nos demais casos.
form_data: objeto com campos trabalhistas extraídos (só quando area=Trabalhista). Null quando não se aplica.
scheduling_action: {"action":"confirm_slot","date":"YYYY-MM-DD","time":"HH:MM"} quando confirmar agendamento. Null quando não se aplica.`;
        systemPrompt = this.promptBuilder.buildSystemPrompt({
          mediaCapabilities: MEDIA_CAPABILITIES_HEADER,
          behaviorRules: CORE_RULES,
          skillPrompt: fallbackSkillPrompt,
          references: [],
          maxContextTokens: 4000,
          vars,
        });
        model = await this.settings.getDefaultModel();
        maxTokens = 1500;
        temperature = 0.7;
        this.logger.warn(
          '[AI] Nenhuma skill ativa encontrada — usando prompt fallback',
        );
      }

      // 11. Montar histórico MULTI-TURN (memória natural do modelo)
      // Cada mensagem vira um turn user/assistant real — muito mais eficaz que texto plano
      const chatTurns: Array<{role: 'user' | 'assistant', content: string}> = [];
      for (const m of chronological) {
        const isClient = (m as any).direction === 'in';
        const role: 'user' | 'assistant' = isClient ? 'user' : 'assistant';
        const content =
          (m as any).text ||
          ((m as any).type === 'audio'
            ? '[áudio sem transcrição]'
            : (m as any).type === 'image'
              ? '[imagem enviada]'
              : (m as any).type === 'document'
                ? '[documento enviado]'
                : '[mídia]');
        // Prefixar mensagens de operadores humanos para distinguir da IA
        const isOperator = !isClient && !(m as any).external_message_id?.startsWith('sys_');
        const finalContent = isOperator ? `[Operador Humano]: ${content}` : content;
        // Mesclar mensagens consecutivas do mesmo remetente (ex: cliente envia 3 msgs seguidas)
        if (chatTurns.length > 0 && chatTurns[chatTurns.length - 1].role === role) {
          chatTurns[chatTurns.length - 1].content += '\n' + finalContent;
        } else {
          chatTurns.push({ role, content: finalContent });
        }
      }

      // Coletar imagens para visão (modelos com suporte)
      let visionImages: { type: 'image_url'; image_url: { url: string } }[] = [];
      if (this.modelSupportsVision(model)) {
        visionImages = await this.collectVisionImages(convo.messages as any[]);
        if (visionImages.length > 0) {
          this.logger.log(`[AI] Visão ativa: ${visionImages.length} imagem(ns) incluída(s)`);
        }
      }

      // Instrução final para a IA (não aparece no chat do cliente)
      const instruction = `[INSTRUÇÃO INTERNA — não exiba ao cliente]\nResponda à última mensagem do cliente. Consulte o histórico completo acima e a MEMÓRIA DO LEAD no system prompt: NÃO repita perguntas já respondidas. Avance o roteiro para o próximo ponto que ainda não foi coberto. Atualize o status do funil conforme as regras de PROGRESSÃO DE ETAPAS.`;

      // Montar array final de mensagens para a OpenAI (multi-turn real)
      const openAiMessages: any[] = [
        { role: 'system', content: systemPrompt },
        ...chatTurns,
      ];

      // Adicionar instrução + imagens de visão como última mensagem user
      if (visionImages.length > 0) {
        openAiMessages.push({
          role: 'user',
          content: [{ type: 'text', text: instruction }, ...visionImages],
        });
      } else {
        openAiMessages.push({ role: 'user', content: instruction });
      }

      this.logger.log(`[AI] Multi-turn: ${chatTurns.length} turns + instrução (${chronological.length} msgs carregadas)`);

      // 12. Chamar LLM — com tools (function calling) ou JSON mode (legado)
      const skillTools = (skill?.tools || []).filter((t: any) => t.active);
      const useToolCalling = skillTools.length > 0;
      let aiText = '';
      let updates: any = {};
      let scheduling_action: any = null;
      let slotsToOffer: any[] | null = null;
      let toolCallLogs: any[] = [];

      if (useToolCalling) {
        // ─── PATH NOVO: Function Calling com Tool Executor ───
        // Auto-detectar provider pelo nome do modelo (evita inconsistência model/provider)
        const isClaudeModel = model.startsWith('claude-');
        const provider: LLMProvider = isClaudeModel ? 'anthropic' : (skill.provider || 'openai');
        const apiKeyForSkill = provider === 'anthropic'
          ? await this.settings.getAnthropicKey()
          : await this.settings.getOpenAiKey();

        if (!apiKeyForSkill) {
          this.logger.error(`[AI] API key não encontrada para provider "${provider}"`);
          return;
        }

        const llmClient = createLLMClient(provider, apiKeyForSkill);
        const toolDefs = this.promptBuilder.buildToolDefinitions(skillTools);
        toolDefs.push(this.promptBuilder.buildRespondToClientTool());

        const handlerMap = buildHandlerMap(skillTools);

        // Converter chatTurns para LLMMessage format
        const llmMessages = chatTurns.map((t: any) => ({
          role: t.role as 'user' | 'assistant',
          content: t.content,
        }));

        // Add instruction + vision as last user message
        if (visionImages.length > 0) {
          llmMessages.push({
            role: 'user' as const,
            content: [{ type: 'text', text: instruction }, ...visionImages],
          });
        } else {
          llmMessages.push({ role: 'user' as const, content: instruction });
        }

        const toolExecutor = new ToolExecutor(handlerMap);
        const toolResult = await toolExecutor.execute({
          client: llmClient,
          model,
          systemPrompt,
          messages: llmMessages,
          tools: toolDefs,
          maxTokens,
          temperature,
          context: {
            conversationId: convo.id,
            leadId: convo.lead.id,
            leadPhone: convo.lead.phone,
            instanceName: convo.instance_name || null,
            prisma: this.prisma,
            s3: this.s3,
            skillAssets: skill.assets || [],
            reminderQueue: this.reminderQueue,
          },
        });

        toolCallLogs = toolResult.toolCallLogs;

        // Cacheia ambas as calls de interesse antes de qualquer ramificação
        const respondCall = toolCallLogs.find((l: any) => l.name === 'respond_to_client');
        const updateLeadCall = toolCallLogs.find((l: any) => l.name === 'update_lead');

        if (respondCall) {
          aiText = respondCall.input.reply || '';
          updates = respondCall.input.updates || {};
          scheduling_action = respondCall.input.scheduling_action || null;
          slotsToOffer = respondCall.input.slots_to_offer || null;
        } else if (toolResult.response.content) {
          // Fallback: parse content as JSON (hybrid mode) ou texto puro
          const parsed = this.parseAiResponse(toolResult.response.content);
          aiText = parsed.reply;
          updates = parsed.updates || {};
          scheduling_action = parsed.scheduling_action || null;
        }

        // Propaga stage/next_step de update_lead quando respond_to_client não trouxe status.
        // Cobre todos os paths: com ou sem respond_to_client.
        if (!updates.status && updateLeadCall) {
          if (updateLeadCall.input?.stage) {
            updates.status = updateLeadCall.input.stage;
          } else if (updateLeadCall.input?.next_step && !updates.next_step) {
            updates.next_step = updateLeadCall.input.next_step;
          }
        }

        // Save usage
        await this.saveUsage({
          conversation_id,
          skill_id: skill?.id ?? null,
          model,
          call_type: 'chat',
          usage: {
            prompt_tokens: toolResult.response.usage.promptTokens,
            completion_tokens: toolResult.response.usage.completionTokens,
            total_tokens: toolResult.response.usage.totalTokens,
          },
        });

        this.logger.log(`[AI] Tool calling: ${toolCallLogs.length} tools executados, reply: ${aiText.slice(0, 80)}...`);

      } else {
        // ─── PATH LEGADO: JSON mode (sem tools) ───
        const isClaudeModelLegacy = model.startsWith('claude-');
        const legacyProvider: LLMProvider = isClaudeModelLegacy ? 'anthropic' : 'openai';
        const legacyApiKey = isClaudeModelLegacy
          ? await this.settings.getAnthropicKey()
          : openAiKey;

        if (!legacyApiKey) {
          this.logger.error(`[AI] API key não encontrada para provider "${legacyProvider}" (legacy path)`);
          return;
        }

        const legacyClient = createLLMClient(legacyProvider, legacyApiKey);
        const legacyMessages = chatTurns.map((t: any) => ({
          role: t.role as 'user' | 'assistant',
          content: t.content,
        }));
        // Adicionar instrução final como último user message
        if (visionImages.length > 0) {
          legacyMessages.push({ role: 'user' as const, content: [{ type: 'text', text: instruction }, ...visionImages] });
        } else {
          legacyMessages.push({ role: 'user' as const, content: instruction });
        }

        const legacyResult = await legacyClient.chat({
          model,
          systemPrompt,
          messages: legacyMessages,
          maxTokens,
          temperature,
          jsonMode: true,
        });

        const completion = { choices: [{ message: { content: legacyResult.content } }] } as any;
        // Salvar usage com dados reais
        await this.saveUsage({
          conversation_id,
          skill_id: skill?.id ?? null,
          model,
          call_type: 'chat',
          usage: {
            prompt_tokens: legacyResult.usage.promptTokens,
            completion_tokens: legacyResult.usage.completionTokens,
            total_tokens: legacyResult.usage.totalTokens,
          },
        });

        const rawResponse =
          completion.choices[0]?.message?.content ||
          '{"reply":"Desculpe, estou com instabilidade no momento."}';

        const parsed = this.parseAiResponse(rawResponse);
        aiText = parsed.reply;
        updates = parsed.updates;
        scheduling_action = parsed.scheduling_action;
        slotsToOffer = parsed.slots_to_offer || null;
      }

      this.logger.log(
        `[AI] Resposta — reply: ${aiText.slice(0, 80)}... | updates: ${JSON.stringify(updates).slice(0, 200)}`,
      );
      if (!updates.status && !updates.next_step && !updates.name) {
        this.logger.warn(`[AI] updates vazio após processamento — stage não será atualizado. convo=${conversation_id}`);
      }

      // 14. Verificar sinal de escalada (handoff para humano)
      let finalText = aiText;
      const handoffSignal = skill?.handoff_signal || null;
      if (handoffSignal && finalText.includes(handoffSignal)) {
        finalText = finalText
          .replace(new RegExp(handoffSignal, 'g'), '')
          .trim();
        await (this.prisma as any).conversation.update({
          where: { id: conversation_id },
          data: { ai_mode: false },
        });
        this.logger.log(
          `[AI] Sinal de escalada detectado ("${handoffSignal}") — ai_mode desativado para ${conversation_id}`,
        );
      }

      // 14b. Salvar log de execução da skill (observabilidade)
      try {
        await (this.prisma as any).skillExecutionLog.create({
          data: {
            conversation_id,
            skill_id: skill?.id || null,
            tool_calls_json: toolCallLogs.length > 0 ? toolCallLogs : undefined,
            selection_reason: routerReason || null,
            router_tokens: routerTokens || null,
            duration_ms: Date.now() - (job.processedOn || Date.now()),
          },
        });
      } catch { /* non-critical */ }

      // 15. Aplicar updates automaticamente
      await this.applyAiUpdates(
        updates,
        convo.id,
        convo.lead.id,
        convo.lead.phone,
        convo.instance_name || null,
      );

      // 15b. Processar scheduling_action (agendamento automático de reunião)
      if (scheduling_action?.action === 'confirm_slot' && scheduling_action.date && scheduling_action.time) {
        try {
          const lawyerId = (await (this.prisma as any).conversation.findUnique({
            where: { id: convo.id },
            select: { assigned_lawyer_id: true },
          }))?.assigned_lawyer_id;

          if (lawyerId) {
            const [h, m] = scheduling_action.time.split(':').map(Number);
            const startAt = new Date(scheduling_action.date + 'T00:00:00');
            startAt.setHours(h, m, 0, 0);
            const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);

            await this.createCalendarEvent({
              type: 'CONSULTA',
              title: `Consulta — ${convo.lead.name || 'Lead'}`,
              description: `Reunião agendada automaticamente pela IA`,
              start_at: startAt,
              end_at: endAt,
              assigned_user_id: lawyerId,
              lead_id: convo.lead.id,
              conversation_id: convo.id,
              created_by_id: lawyerId,
            });
            this.logger.log(
              `[AI] Consulta agendada: ${scheduling_action.date} ${scheduling_action.time} — advogado ${lawyerId}`,
            );
          }
        } catch (e: any) {
          this.logger.warn(`[AI] Falha ao agendar consulta: ${e.message}`);
        }
      }

      // 16. Ler config da Evolution e enviar via WhatsApp
      const { apiUrl, apiKey } = await this.settings.getEvolutionConfig();
      if (!apiUrl) {
        this.logger.warn(
          'EVOLUTION_API_URL não configurada — resposta da IA não enviada',
        );
        return;
      }

      const instanceName =
        convo.instance_name || process.env.EVOLUTION_INSTANCE_NAME || '';

      // Assinatura "Sophia:" em negrito no WhatsApp (salva sem assinatura no DB)
      const textToSend = `*Sophia:* ${finalText}`;

      // Exibe "digitando..." por 5s via endpoint dedicado da Evolution API.
      // Fire-and-forget (sem await): dispara o indicador e imediatamente começa
      // a contar os 5s em paralelo — evita dupla espera (API delay + setTimeout).
      const TYPING_DELAY_MS = 2000;
      // Formato flat (sem wrapper "options") — conforme comportamento real da API
      axios
        .post(
          `${apiUrl}/chat/sendPresence/${instanceName}`,
          {
            number: convo.lead.phone,
            delay: TYPING_DELAY_MS,
            presence: 'composing',
          },
          { headers: { 'Content-Type': 'application/json', apikey: apiKey }, timeout: 10000 },
        )
        .catch((e) =>
          this.logger.warn(`[AI] sendPresence falhou (não-fatal): ${e.message}`),
        );
      await new Promise((resolve) => setTimeout(resolve, TYPING_DELAY_MS));

      // Captura o ID real da mensagem retornado pela Evolution API
      // para que o webhook echo seja corretamente deduplicado e não gere registro duplicado.
      let evolutionMsgId = `sys_ai_${Date.now()}`;
      // Pré-calcular se vai enviar áudio (para pular texto nesse caso)
      // Buscar a última mensagem inbound (mais recente = primeiro do array desc)
      const _lastIn = convo.messages.find((m: any) => m.direction === 'in');
      const _tts = await this.settings.getTtsConfig();
      const _willAudio = _tts.enabled && _tts.googleApiKey && !_tts.googleApiKey.startsWith('enc:') && _lastIn?.type === 'audio';

      this.logger.debug(`[TTS-CHECK] enabled=${_tts.enabled} keyLen=${_tts.googleApiKey?.length || 0} keyEnc=${_tts.googleApiKey?.startsWith('enc:')} lastInType=${_lastIn?.type} willAudio=${_willAudio}`);

      if (_willAudio) {
        this.logger.log('[AI] Lead enviou áudio — resposta será apenas por voz (sem texto)');
      }

      try {
        let sendResult: any;
        const evoHeaders = { 'Content-Type': 'application/json', apikey: apiKey };

        // Se vai enviar áudio, pula o texto
        if (_willAudio) {
          // Não envia texto — será enviado apenas áudio no passo 18 (TTS)
        } else if (slotsToOffer?.length) {
          const rows = slotsToOffer.map((s: any) => ({
            title: s.label || `${s.date} ${s.time}`,
            description: s.date || 'Horário disponível',
            rowId: `slot_${s.date}_${(s.time || '').replace(/:/g, '')}`,
          }));
          sendResult = await axios.post(
            `${apiUrl}/message/sendList/${instanceName}`,
            {
              number: convo.lead.phone,
              title: 'Horários disponíveis',
              description: finalText,
              buttonText: 'Escolher horário',
              footerText: 'André Lustosa Advogados',
              sections: [{ title: 'Horários', rows }],
            },
            { headers: evoHeaders, timeout: 30000 },
          );
          this.logger.log(`[AI] Lista interativa enviada: ${rows.length} horários`);
        } else {
          sendResult = await axios.post(
            `${apiUrl}/message/sendText/${instanceName}`,
            { number: convo.lead.phone, text: textToSend },
            { headers: evoHeaders, timeout: 30000 },
          );
        }
        if (sendResult) evolutionMsgId = sendResult.data?.key?.id || evolutionMsgId;
      } catch (sendErr: any) {
        this.logger.error(`[AI] Falha ao enviar via Evolution (${sendErr.response?.status || sendErr.message}): ${JSON.stringify(sendErr.response?.data || {}).slice(0, 200)}`);
      }

      // 17. Salvar mensagem no banco com skill_id (texto limpo, sem assinatura)
      // Usa o ID real da Evolution para que o echo do webhook seja deduplicado
      const savedMsg = await this.prisma.message.create({
        data: {
          conversation_id: convo.id,
          direction: 'out',
          type: 'text',
          text: finalText,
          external_message_id: evolutionMsgId,
          status: 'enviado',
          skill_id: skill?.id || null,
        },
      });

      // 18. Atualizar last_message_at
      await this.prisma.conversation.update({
        where: { id: convo.id },
        data: { last_message_at: new Date() },
      });

      this.logger.log(
        `[AI] Resposta enviada para ${convo.lead.phone} (model=${model}, skill=${skill?.name || 'fallback'})`,
      );

      // 18. TTS — reutiliza _willAudio calculado antes do envio de texto
      const ttsConfig = _tts; // reutiliza config já carregado
      if (_willAudio) {
        this.logger.log(`[TTS] Chave OK (len=${ttsConfig.googleApiKey.length}), voz=${ttsConfig.voice}`);
        try {
          // Remove formatação markdown do texto
          const ttsText = finalText
            .replace(/\*\*(.*?)\*\*/g, '$1')
            .replace(/\*(.*?)\*/g, '$1')
            .trim();

          // Detectar se é voz Gemini ou Google Cloud TTS legado
          const isGeminiVoice = !ttsConfig.voice?.startsWith('pt-BR');
          const voiceName = isGeminiVoice ? (ttsConfig.voice || 'Kore') : 'Kore';

          if (!isGeminiVoice) {
            this.logger.log(`[TTS] Voz legada ${ttsConfig.voice} detectada — usando Gemini com voz Kore`);
          }

          // Instrução de estilo para voz natural e adaptativa
          const styledText = `Mulher profissional, voz serena e confiante. Fala com clareza e empatia. Adapta automaticamente o tom conforme o conteúdo da mensagem. Atendimento ao cliente jurídico via áudio. O cliente pode estar ansioso, aliviado, inadimplente ou aguardando notícias do processo. A voz deve espelhar o momento emocional do conteúdo narrado. Português brasileiro padrão, dicção clara. REGRAS DE ADAPTAÇÃO: mensagem de prazo ou urgência, ritmo mais acelerado com ênfase nas datas e valores; mensagem de atualização processual, tom informativo com pausas após termos jurídicos; mensagem de boas notícias, voz mais leve com leve sorriso perceptível; mensagem de cobrança, tom sério e respeitoso sem agressividade; mensagem de situação delicada, voz mais suave com ritmo lento; mensagem de boas-vindas, tom acolhedor e animado; mensagem informativa, tom neutro e preciso. Agora diga: ${ttsText}`;

          // Gemini 2.5 Flash TTS
          const geminiModel = 'gemini-2.5-flash-preview-tts';
          const ttsRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${ttsConfig.googleApiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: styledText }] }],
                generationConfig: {
                  responseModalities: ['AUDIO'],
                  speechConfig: {
                    voiceConfig: {
                      prebuiltVoiceConfig: { voiceName },
                    },
                  },
                },
              }),
              signal: AbortSignal.timeout(30000),
            },
          );

          if (!ttsRes.ok) {
            const errText = await ttsRes.text().catch(() => '');
            this.logger.warn(`[TTS] Gemini TTS retornou ${ttsRes.status}: ${errText.slice(0, 300)}`);
          } else {
            const ttsData = await ttsRes.json();
            const audioB64 = ttsData?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (!audioB64) {
              this.logger.warn('[TTS] Gemini TTS não retornou áudio');
            } else {
              // Gemini retorna PCM 24kHz 16-bit — converter para WAV
              const pcmBuffer = Buffer.from(audioB64, 'base64');
              const wavHeader = this.buildWavHeader(pcmBuffer.length, 24000, 1, 16);
              const audioBuffer = Buffer.concat([wavHeader, pcmBuffer]);

            // Upload do áudio para S3
            const audioKey = `tts/${convo.id}/${savedMsg.id}.wav`;
            await this.s3.uploadBuffer(audioKey, audioBuffer, 'audio/wav');

            // Cria registro de mensagem de áudio no banco
            const audioMsg = await this.prisma.message.create({
              data: {
                conversation_id:     convo.id,
                direction:           'out',
                type:                'audio',
                text:                null,
                status:              'enviado',
                skill_id:            skill?.id || null,
              },
            });

            // Cria registro de mídia vinculado à mensagem
            await (this.prisma as any).media.create({
              data: {
                message_id: audioMsg.id,
                s3_key:     audioKey,
                mime_type:  'audio/wav',
                size:       audioBuffer.length,
              },
            });

            // Envia via Evolution API como áudio base64 puro
            const audioBase64 = audioBuffer.toString('base64');
            const ttsEvoResult = await axios.post(
              `${apiUrl}/message/sendWhatsAppAudio/${instanceName}`,
              { number: convo.lead.phone, audio: audioBase64 },
              { headers: { 'Content-Type': 'application/json', apikey: apiKey }, timeout: 30000 },
            );

            // Salvar external_message_id para deduplicação do echo da Evolution
            const ttsEvoId = ttsEvoResult.data?.key?.id;
            if (ttsEvoId) {
              await this.prisma.message.update({
                where: { id: audioMsg.id },
                data: { external_message_id: ttsEvoId },
              });
            }

            this.logger.log(`[TTS] Áudio Gemini enviado para ${convo.lead.phone} (${audioBuffer.length} bytes, voz=${voiceName}, evoId=${ttsEvoId || 'N/A'})`);
            }
          }
        } catch (ttsErr: any) {
          this.logger.warn(`[TTS] Falha ao gerar/enviar áudio: ${ttsErr.message} — enviando texto como fallback`);
          // Fallback: envia texto quando TTS falha (créditos esgotados, erro de API, etc.)
          try {
            await axios.post(
              `${apiUrl}/message/sendText/${instanceName}`,
              { number: convo.lead.phone, text: textToSend },
              { headers: { 'Content-Type': 'application/json', apikey: apiKey }, timeout: 30000 },
            );
            this.logger.log('[TTS] Fallback texto enviado com sucesso');
          } catch (fallbackErr: any) {
            this.logger.error(`[TTS] Fallback texto também falhou: ${fallbackErr.message}`);
          }
        }
      }

      // 19. Atualizar Long Memory (TODA mensagem recebida — sem economizar tokens)
      const inboundTotal = convo.messages.filter(
        (m) => m.direction === 'in',
      ).length;
      if (inboundTotal > 0) {
        try {
          await this.updateLongMemory(
            ai,
            convo.lead_id,
            historyText,
            updates,
          );
        } catch (memErr: any) {
          this.logger.warn(
            `[AI] Falha ao atualizar Long Memory: ${memErr.message}`,
          );
        }
      }

      // 20. Retorna IDs para o AiEventsService da API emitir WebSocket em tempo real
      return { conversationId: convo.id, messageId: savedMsg.id };
    } catch (e: any) {
      this.logger.error(`Erro no processamento da IA: ${e.message}`);
      throw e;
    }
  }
}
