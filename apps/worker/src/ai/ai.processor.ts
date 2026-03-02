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

      const media = msg.media ?? null;
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

    // a. Nome do lead (só se não existir)
    if (updates.name && updates.name !== 'null' && updates.name.length >= 2) {
      const lead = await this.prisma.lead.findUnique({
        where: { id: leadId },
      });
      if (!lead?.name) {
        await this.prisma.lead.update({
          where: { id: leadId },
          data: { name: updates.name },
        });
        this.logger.log(
          `[AI] Nome salvo: "${updates.name}" → lead ${leadId}`,
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
              `[AI] Contato salvo na Evolution: ${leadPhone} → "${updates.name}"`,
            );
          } catch (e: any) {
            this.logger.warn(
              `[AI] Falha ao salvar contato na Evolution: ${e.message}`,
            );
          }
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
    }

    // c. Área → Conversation.legal_area (só se não classificada)
    if (updates.area && updates.area !== 'null') {
      const conv = await (this.prisma as any).conversation.findUnique({
        where: { id: convoId },
        select: { legal_area: true },
      });
      if (!conv?.legal_area) {
        await (this.prisma as any).conversation.update({
          where: { id: convoId },
          data: { legal_area: updates.area },
        });
        this.logger.log(`[AI] Área classificada: "${updates.area}"`);
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
      ...this.tokenParam(memoryModel, 800),
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const rawContent =
      memoryResult.choices[0]?.message?.content || '{}';
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

      // 4. Guard: cooldown configurável
      // Procura a última mensagem SAÍDA na lista (já está em desc, então é a primeira outgoing)
      const cooldownMs = await this.settings.getCooldownMs();
      if (cooldownMs > 0) {
        const lastOutMsg = convo.messages.find((m) => m.direction === 'out');
        if (lastOutMsg) {
          const elapsed = Date.now() - lastOutMsg.created_at.getTime();
          if (elapsed < cooldownMs) {
            this.logger.log(
              `[AI] Cooldown ativo (${elapsed}ms < ${cooldownMs}ms) — job ignorado`,
            );
            return;
          }
        }
      }

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

      const vars: Record<string, string> = {
        lead_name: convo.lead.name || 'Desconhecido',
        lead_phone: convo.lead.phone || '',
        legal_area: legalArea || 'a ser identificada',
        firm_name: 'André Lustosa Advogados',
        lead_memory: leadMemory,
        lead_summary: memory?.summary || '',
        conversation_id: convo.id,
        history_summary: historyText.slice(0, 500),
      };

      if (skill) {
        systemPrompt = this.injectVariables(skill.system_prompt, vars);
        model = skill.model || (await this.settings.getDefaultModel());
        maxTokens = skill.max_tokens || 500;
        temperature = skill.temperature ?? 0.7;
        this.logger.log(
          `[AI] Usando skill: "${skill.name}" (area=${skill.area}, model=${model})`,
        );
      } else {
        systemPrompt = `Você é Sophia, agente de pré-atendimento do escritório André Lustosa Advogados.\nSeu objetivo é acolher o cliente, entender o problema e coletar informações para o advogado.\nResponda de forma empática e curta (adequado para WhatsApp).\nRetorne SOMENTE JSON válido: {"reply":"texto para enviar","updates":{"name":null,"status":"Contato Inicial","area":null,"lead_summary":"resumo","next_step":"duvidas","notes":""}}`;
        model = await this.settings.getDefaultModel();
        maxTokens = 500;
        temperature = 0.7;
        this.logger.warn(
          '[AI] Nenhuma skill ativa encontrada — usando prompt fallback',
        );
      }

      // 11. Montar conteúdo do usuário (texto + imagens para modelos com visão)
      const baseText = `Histórico recente:\n${historyText}\n\nResponda à última mensagem do cliente.`;

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

      await axios.post(
        `${apiUrl}/message/sendText/${instanceName}`,
        {
          number: convo.lead.phone,
          text: textToSend,
        },
        {
          headers: { 'Content-Type': 'application/json', apikey: apiKey },
        },
      );

      // 17. Salvar mensagem no banco com skill_id (texto limpo, sem assinatura)
      await this.prisma.message.create({
        data: {
          conversation_id: convo.id,
          direction: 'out',
          type: 'text',
          text: finalText,
          external_message_id: `sys_${Date.now()}`,
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
    } catch (e: any) {
      this.logger.error(`Erro no processamento da IA: ${e.message}`);
      throw e;
    }
  }
}
