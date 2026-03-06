import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { S3Service } from '../s3/s3.service';
import OpenAI, { toFile } from 'openai';
import axios from 'axios';

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

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private s3: S3Service,
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

  // ─── Substitui variáveis {{var}} no prompt ───
  private injectVariables(
    prompt: string,
    vars: Record<string, string>,
  ): string {
    return prompt.replace(
      /\{\{(\w+)\}\}/g,
      (_, key) => vars[key] ?? `{{${key}}}`,
    );
  }

  // ─── Parseia resposta JSON da IA com fallbacks robustos ───
  private parseAiResponse(raw: string): { reply: string; updates: any } {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.reply) {
        return {
          reply: parsed.reply,
          updates: parsed.updates || parsed.lead_update || {},
        };
      }
    } catch {}

    const jsonMatch = raw.match(/```json?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1].trim());
        if (parsed.reply) {
          return {
            reply: parsed.reply,
            updates: parsed.updates || parsed.lead_update || {},
          };
        }
      } catch {}
    }

    this.logger.warn(
      '[AI] Resposta não é JSON válido — usando como texto puro',
    );
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

      // Retry: o media-job pode estar rodando em paralelo e ainda não ter salvo o registro
      let media = msg.media ?? null;
      if (!media?.s3_key) {
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
      if (!media?.s3_key) continue;

      try {
        const { buffer, contentType } = await this.s3.getObjectBuffer(
          media.s3_key,
        );
        const mimeBase = contentType.split(';')[0].trim();
        const ext = mimeBase.split('/')[1] || 'ogg';

        const file = await toFile(buffer, `audio.${ext}`, { type: mimeBase });
        const result = await ai.audio.transcriptions.create({
          file,
          model: 'whisper-1',
          language: 'pt',
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
        msg.text = '[áudio não transcrito]';
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

      const { apiUrl, apiKey } = await this.settings.getEvolutionConfig();
      if (apiUrl && instanceName) {
        try {
          await axios.post(
            `${apiUrl}/contact/upsert/${instanceName}`,
            {
              contacts: [{ phone: leadPhone, fullName: updates.name }],
            },
            {
              headers: {
                'Content-Type': 'application/json',
                apikey: apiKey,
              },
            },
          );
          this.logger.log(
            `[AI] Contato atualizado na Evolution: ${leadPhone} → "${updates.name}"`,
          );
        } catch (e: any) {
          this.logger.warn(
            `[AI] Falha ao atualizar contato na Evolution: ${e.message}`,
          );
        }
      }
    }

    // b. Status → Lead.stage
    if (updates.status && updates.status !== 'null') {
      await this.prisma.lead.update({
        where: { id: leadId },
        data: { stage: updates.status },
      });
      this.logger.log(`[AI] Lead.stage → "${updates.status}"`);
    } else if (!updates.status && updates.next_step) {
      // Se a IA enviou next_step mas esqueceu o status, inferir o stage automaticamente
      const inferMap: Record<string, string> = {
        formulario:        'AGUARDANDO_FORM',
        reuniao:           'REUNIAO_AGENDADA',
        documentos:        'AGUARDANDO_DOCS',
        procuracao:        'AGUARDANDO_PROC',
        encerrado:         'FINALIZADO',
        triagem_concluida: 'QUALIFICANDO',
      };
      const inferred = inferMap[updates.next_step];
      if (inferred) {
        await this.prisma.lead.update({ where: { id: leadId }, data: { stage: inferred } });
        this.logger.log(`[AI] Stage inferido do next_step "${updates.next_step}": ${inferred}`);
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
          const totalFields = 72;
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
              const totalFields = 72;
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

    const newEvent = `Últimas mensagens:\n${historyText.slice(-800)}\n\nUpdates do agente: ${JSON.stringify(latestUpdates || {})}`;

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
      ...this.tokenParam(memoryModel, 2000),
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
      await this.prisma.aiMemory.upsert({
        where: { lead_id: leadId },
        create: {
          lead_id: leadId,
          summary:
            latestUpdates?.lead_summary || existing?.summary || '',
          facts_json: parsed,
        },
        update: {
          facts_json: parsed,
          summary:
            latestUpdates?.lead_summary || existing?.summary || '',
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

    try {
      // 2. Buscar conversa + lead + últimas 20 mensagens com mídia incluída
      // orderBy desc para pegar as mais RECENTES; invertemos abaixo para ordem cronológica
      const convo = await this.prisma.conversation.findUnique({
        where: { id: conversation_id },
        include: {
          lead: true,
          messages: {
            orderBy: { created_at: 'desc' },
            take: 20,
            include: { media: true },
          },
        },
      });

      // 3. Verificar ai_mode ativo
      if (!convo || !convo.ai_mode) return;

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

      // Montar memória legível para injeção no prompt
      let leadMemory = 'Nenhuma memória anterior — primeiro contato.';
      if (memory && (memory.summary || factsJson)) {
        const parts: string[] = [];
        if (memory.summary) parts.push(`Resumo: ${memory.summary}`);
        if (factsJson?.case?.area)
          parts.push(`Área: ${factsJson.case.area}`);
        if (factsJson?.case?.status)
          parts.push(`Status: ${factsJson.case.status}`);
        if (factsJson?.facts?.current?.main_issue)
          parts.push(
            `Problema principal: ${factsJson.facts.current.main_issue}`,
          );
        if (factsJson?.facts?.core_facts?.length)
          parts.push(
            `Fatos-chave: ${factsJson.facts.core_facts.join('; ')}`,
          );
        if (factsJson?.open_questions?.length)
          parts.push(
            `Perguntas pendentes: ${factsJson.open_questions.join('; ')}`,
          );
        if (factsJson?.evidence?.items?.length) {
          const evItems = factsJson.evidence.items
            .filter((e: any) => e?.type)
            .map((e: any) => e.type);
          if (evItems.length)
            parts.push(`Evidências: ${evItems.join(', ')}`);
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

      // 8. Carregar skills ativas
      const activeSkills = await this.settings.getActiveSkills();

      // 9. Selecionar skill baseada na área jurídica detectada
      const legalArea = (convo as any).legal_area || null;
      const skill = this.selectSkill(activeSkills, legalArea);

      // 10. Preparar prompt e parâmetros
      let systemPrompt: string;
      let model: string;
      let maxTokens: number;
      let temperature: number;

      const siteUrl = process.env.APP_URL || 'https://andrelustosaadvogados.com.br';
      const vars: Record<string, string> = {
        lead_name: convo.lead.name || 'Desconhecido',
        lead_phone: convo.lead.phone || '',
        legal_area: legalArea || 'a ser identificada',
        firm_name: 'André Lustosa Advogados',
        lead_memory: leadMemory,
        lead_summary: memory?.summary || '',
        conversation_id: convo.id,
        lead_id: convo.lead_id || convo.lead?.id || '',
        history_summary: historyText.slice(0, 500),
        // URL base do site — use no prompt: "{{site_url}}/geral/arapiraca"
        site_url: siteUrl,
        form_url: `${siteUrl}/formulario/trabalhista/${convo.lead_id || convo.lead?.id || ''}`,
        data_hoje: new Date().toLocaleString('pt-BR', {
          timeZone: 'America/Maceio',
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        }),
      };

      // Cabeçalho fixo de capacidades — injetado antes de qualquer skill prompt
      const MEDIA_CAPABILITIES_HEADER = `CAPACIDADES DE MÍDIA DISPONÍVEIS:
- Áudios são transcritos automaticamente por IA (Whisper). O texto transcrito já aparece no histórico como texto normal. NUNCA diga que não consegue ouvir — você lê a transcrição.
- Imagens e documentos enviados pelo cliente são analisados visualmente quando o modelo suporta visão. Responda ao conteúdo deles normalmente.
- NUNCA peça para o cliente "escrever em texto" por causa de mídia — você já consegue ler o conteúdo.

`;

      // Regras comportamentais injetadas em TODOS os prompts (skill ou fallback).
      // Garantem conversa natural e não revelam que a IA está respondendo.
      const BEHAVIOR_RULES = `DATA E HORA ATUAL: {{data_hoje}} (fuso horário de Maceió/AL).
Use essa data para referências temporais e para saber os valores vigentes (ex: salário mínimo atual).

REGRAS DE ATENDIMENTO — OBRIGATÓRIAS, ACIMA DE TUDO:
1. FAÇA SOMENTE UMA PERGUNTA POR MENSAGEM. Nunca envie duas ou mais perguntas juntas.
2. Quando o cliente responder uma pergunta sua, RECONHEÇA BREVEMENTE a resposta ("Entendi.", "Anotado.", "Ok, obrigado.") e só então faça a próxima pergunta.
3. NUNCA explique leis, artigos, jurisprudências ou dê parecer jurídico A NÃO SER que o cliente pergunte EXPLICITAMENTE ("tenho direito?", "o que a lei diz?", "pode me explicar?"). Se o cliente apenas relatar um fato, registre e continue coletando.
4. Aja como um atendente humano. Não mencione que é IA, robô ou assistente virtual. Linguagem simples, direta e natural — como em um WhatsApp entre pessoas.
5. Mensagens curtas: máximo 4 linhas por resposta. WhatsApp não é e-mail.
6. Se o cliente fizer uma pergunta jurídica diretamente, responda em no máximo 2 linhas e volte imediatamente à coleta de informações.

FICHA TRABALHISTA (apenas quando area = Trabalhista):
Quando a área for TRABALHISTA, inclua "form_data" no JSON com os campos que a conversa permitir inferir.
A lista completa dos campos está no final do prompt. Se a área NÃO for trabalhista, envie form_data: null.

`;

      // Instrução de form_data injetada APÓS o prompt da skill (sobrescreve o JSON schema da skill)
      const FORM_DATA_INJECTION = `

CAMPO form_data — OBRIGATÓRIO NO JSON:
O JSON DEVE ter "form_data" em "updates". Quando area=Trabalhista, preencha com dados extraídos de TODA A CONVERSA.
nome_completo: nome completo DO CLIENTE/LEAD (NÃO é o empregador; nunca só o primeiro nome; use o nome que o próprio cliente informou). Quando não Trabalhista: form_data: null.

CAMPOS DISPONÍVEIS (inclua só os que a conversa permite inferir):
Pessoal: nome_completo(DO CLIENTE), cpf, rg, data_nascimento(YYYY-MM-DD), nome_mae, estado_civil, profissao, telefone, email.
Contrato: nome_empregador(nome da empresa/empregador — DIFERENTE de nome_completo do cliente), funcao, data_admissao(YYYY-MM-DD), data_saida(YYYY-MM-DD), situacao_atual, motivo_saida, salario(use EXATAMENTE o que o cliente informou: "salário mínimo" se não disse valor exato, "2000" se disse dois mil; NUNCA assuma o valor atual do salário mínimo), ctps_assinada_corretamente, atividades_realizadas.
Jornada: horario_entrada, horario_saida, tempo_intervalo, dias_trabalhados, fazia_horas_extras, qtd_horas_extras_dia, horas_extras_pagas_corretamente, tipo_controle_ponto.
Pagamentos: recebia_por_fora, outro_valor_por_fora, recebia_vale_transporte, premio_comissao, valor_comissao, valor_premio.
Segurança: ambiente_insalubre_perigoso, forneciam_epis, sofreu_acidente, detalhes_acidente, sofreu_assedio_moral, detalhes_assedio_moral.
FGTS/Verbas: fgts_depositado, fgts_sacado, tem_ferias_pendentes, tem_decimo_terceiro_pendente, detalhes_verbas_pendentes.
Provas: possui_testemunhas, possui_provas_documentais.
Resumo: motivos_reclamacao.

Exemplo (inclua apenas campos com dados reais):
{"reply":"Entendido...","updates":{"name":"João Silva","status":"QUALIFICANDO","area":"Trabalhista","lead_summary":"...","next_step":"duvidas","notes":"","form_data":{"nome_empregador":"Empresa X","salario":"3500","fazia_horas_extras":"Sim","fgts_depositado":"Não","motivos_reclamacao":"Salário atrasado 6 meses"}}}

LINK DO FORMULÁRIO TRABALHISTA: {{form_url}}
Quando next_step = "formulario", INCLUA OBRIGATORIAMENTE o link acima no campo "reply" da resposta.
Exemplo de reply com link: "Ótimo! Para agilizar seu atendimento, preencha a ficha com os dados do seu caso: {{form_url}} — Se tiver dúvidas, é só me chamar aqui!"
`;

      if (skill) {
        systemPrompt = MEDIA_CAPABILITIES_HEADER + this.injectVariables(BEHAVIOR_RULES, vars) + this.injectVariables(skill.system_prompt, vars) + this.injectVariables(FORM_DATA_INJECTION, vars);
        model = skill.model || (await this.settings.getDefaultModel());
        // Mínimo de 1500 tokens para acomodar JSON com form_data (trabalhista)
        maxTokens = Math.max(skill.max_tokens || 500, 1500);
        temperature = skill.temperature ?? 0.7;
        this.logger.log(
          `[AI] Usando skill: "${skill.name}" (area=${skill.area}, model=${model})`,
        );
      } else {
        systemPrompt =
          MEDIA_CAPABILITIES_HEADER +
          this.injectVariables(BEHAVIOR_RULES, vars) +
          `Você é Sophia, assistente de pré-atendimento do escritório André Lustosa Advogados.
Seu objetivo é coletar informações sobre o caso do cliente para o advogado conseguir avaliar.

ROTEIRO (siga na ordem, UMA pergunta por vez):
1. Cumprimente e pergunte o nome do cliente.
2. Pergunte qual é o problema principal (deixe o cliente descrever com as próprias palavras).
3. Colete detalhes: quando ocorreu, quem é a outra parte (empresa ou pessoa), se há valores envolvidos.
4. Pergunte se possui documentos ou provas (contrato, mensagens, fotos, etc.).
5. Quando tiver informações suficientes, informe que o advogado vai analisar e oriente o próximo passo.

Retorne SOMENTE JSON válido: {"reply":"texto para enviar","updates":{"name":null,"status":"INICIAL","area":null,"lead_summary":"resumo","next_step":"duvidas","notes":"","form_data":null}}

Valores válidos para updates.status: INICIAL | QUALIFICANDO | AGUARDANDO_FORM | REUNIAO_AGENDADA | AGUARDANDO_DOCS | AGUARDANDO_PROC | FINALIZADO | PERDIDO
Valores válidos para updates.next_step: duvidas | triagem_concluida | formulario | reuniao | documentos | procuracao | encerrado
form_data: objeto com campos trabalhistas extraídos (só quando area=Trabalhista). Null quando não se aplica.`;
        model = await this.settings.getDefaultModel();
        maxTokens = 1500;
        temperature = 0.7;
        this.logger.warn(
          '[AI] Nenhuma skill ativa encontrada — usando prompt fallback',
        );
      }

      // 11. Montar conteúdo do usuário (texto + imagens para modelos com visão)
      const baseText = `Histórico recente:\n${historyText}\n\nResponda SOMENTE à última mensagem do cliente. Se o cliente respondeu uma pergunta sua, reconheça brevemente e faça a próxima pergunta do roteiro. Não explique leis nem dê pareceres jurídicos a não ser que o cliente pergunte diretamente.`;

      let userContent: string | any[] = baseText;

      if (this.modelSupportsVision(model)) {
        const visionImages = await this.collectVisionImages(
          convo.messages as any[],
        );
        if (visionImages.length > 0) {
          userContent = [{ type: 'text', text: baseText }, ...visionImages];
          this.logger.log(
            `[AI] Visão ativa: ${visionImages.length} imagem(ns) incluída(s)`,
          );
        }
      }

      // 12. Chamar OpenAI com JSON mode
      const completion = await ai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent as any },
        ],
        ...this.tokenParam(model, maxTokens),
        temperature,
        response_format: { type: 'json_object' },
      });

      const rawResponse =
        completion.choices[0]?.message?.content ||
        '{"reply":"Desculpe, estou com instabilidade no momento."}';

      // Registra uso de tokens para dashboard de custos
      await this.saveUsage({
        conversation_id: conversation_id,
        skill_id: skill?.id ?? null,
        model,
        call_type: 'chat',
        usage: completion.usage,
      });

      // 13. Parsear resposta JSON
      const { reply: aiText, updates } = this.parseAiResponse(rawResponse);
      this.logger.log(
        `[AI] JSON parseado — reply: ${aiText.slice(0, 80)}... | updates: ${JSON.stringify(updates).slice(0, 200)}`,
      );

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

      // 15. Aplicar updates automaticamente
      await this.applyAiUpdates(
        updates,
        convo.id,
        convo.lead.id,
        convo.lead.phone,
        convo.instance_name || null,
      );

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
      const TYPING_DELAY_MS = 5000;
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
      const sendResult = await axios.post(
        `${apiUrl}/message/sendText/${instanceName}`,
        {
          number: convo.lead.phone,
          text: textToSend,
        },
        {
          headers: { 'Content-Type': 'application/json', apikey: apiKey },
          timeout: 30000,
        },
      );
      const evolutionMsgId: string =
        sendResult.data?.key?.id || `sys_ai_${Date.now()}`;

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

      // 19. Atualizar Long Memory (a cada 3 mensagens recebidas)
      const inboundTotal = convo.messages.filter(
        (m) => m.direction === 'in',
      ).length;
      if (inboundTotal > 0 && inboundTotal % 3 === 0) {
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
