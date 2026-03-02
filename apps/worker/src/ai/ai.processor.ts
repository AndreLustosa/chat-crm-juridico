import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import OpenAI from 'openai';
import axios from 'axios';

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
  ) {
    super();
  }

  // ─── Retorna o parâmetro correto de tokens conforme o modelo ───
  // GPT-4.1, GPT-5.x e modelos o1/o3 usam max_completion_tokens (max_tokens foi removido)
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
    // Fallback: skill de triagem/geral ou primeira ativa
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
    // Tentar parse direto
    try {
      const parsed = JSON.parse(raw);
      if (parsed.reply) {
        return {
          reply: parsed.reply,
          updates: parsed.updates || parsed.lead_update || {},
        };
      }
    } catch {}

    // Fallback: extrair JSON de dentro de markdown ```json ... ```
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

    // Fallback final: tratar como texto puro (compatibilidade com skills antigas)
    this.logger.warn(
      '[AI] Resposta não é JSON válido — usando como texto puro',
    );
    return { reply: raw, updates: {} };
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

        // Salvar na agenda do WhatsApp
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
      // 2. Buscar conversa + lead + últimas 20 mensagens (IA + operador + lead)
      // orderBy desc para pegar as mais RECENTES; invertemos logo abaixo para ordem cronológica
      const convo = await this.prisma.conversation.findUnique({
        where: { id: conversation_id },
        include: {
          lead: true,
          messages: { orderBy: { created_at: 'desc' }, take: 20 },
        },
      });

      // 3. Verificar ai_mode ativo
      if (!convo || !convo.ai_mode) return;

      // Guard: cooldown de 8s — evita resposta duplicada quando o lead manda
      // várias mensagens em sequência rápida (cada uma dispara um job)
      const lastOutMsg = convo.messages.find((m) => m.direction === 'out');
      if (lastOutMsg && Date.now() - lastOutMsg.created_at.getTime() < 8000) {
        this.logger.log(
          `[AI] Cooldown ativo (${Date.now() - lastOutMsg.created_at.getTime()}ms desde última resposta) — job ignorado`,
        );
        return;
      }

      // 4. Carregar AiMemory (Long Memory) do lead
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

      // 5. Montar histórico com rótulos (Cliente / Sophia / Operador)
      // Invertemos o array (que veio desc) para ordem cronológica correta
      const historyText = [...convo.messages].reverse()
        .map((m) => {
          const sender =
            m.direction === 'in'
              ? 'Cliente'
              : m.external_message_id?.startsWith('sys_')
                ? 'Sophia'
                : 'Operador';
          return `${sender}: ${m.text || '[Mídia]'}`;
        })
        .join('\n');

      // 6. Carregar skills ativas
      const activeSkills = await this.settings.getActiveSkills();

      // 7. Selecionar skill baseada na área jurídica detectada
      const legalArea = (convo as any).legal_area || null;
      const skill = this.selectSkill(activeSkills, legalArea);

      // 8. Preparar prompt e parâmetros
      let systemPrompt: string;
      let model: string;
      let maxTokens: number;
      let temperature: number;

      // Variáveis disponíveis para injeção nos prompts
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
        // Fallback quando não há skills configuradas
        systemPrompt = `Você é Sophia, agente de pré-atendimento do escritório André Lustosa Advogados.\nSeu objetivo é acolher o cliente, entender o problema e coletar informações para o advogado.\nResponda de forma empática e curta (adequado para WhatsApp).\nRetorne SOMENTE JSON válido: {"reply":"texto para enviar","updates":{"name":null,"status":"Contato Inicial","area":null,"lead_summary":"resumo","next_step":"duvidas","notes":""}}`;
        model = await this.settings.getDefaultModel();
        maxTokens = 500;
        temperature = 0.7;
        this.logger.warn(
          '[AI] Nenhuma skill ativa encontrada — usando prompt fallback',
        );
      }

      const userPrompt = `Histórico recente:\n${historyText}\n\nResponda à última mensagem do cliente.`;

      // 9. Chamar OpenAI com JSON mode
      const ai = new OpenAI({ apiKey: openAiKey });
      const completion = await ai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        ...this.tokenParam(model, maxTokens),
        temperature,
        response_format: { type: 'json_object' },
      });

      const rawResponse =
        completion.choices[0]?.message?.content ||
        '{"reply":"Desculpe, estou com instabilidade no momento."}';

      // 10. Parsear resposta JSON
      const { reply: aiText, updates } = this.parseAiResponse(rawResponse);
      this.logger.log(
        `[AI] JSON parseado — reply: ${aiText.slice(0, 80)}... | updates: ${JSON.stringify(updates).slice(0, 200)}`,
      );

      // 11. Verificar sinal de escalada (handoff para humano)
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

      // 12. Aplicar updates automaticamente (name, status, area, lead_summary, next_step, notes)
      await this.applyAiUpdates(
        updates,
        convo.id,
        convo.lead.id,
        convo.lead.phone,
        convo.instance_name || null,
      );

      // 13. Ler config da Evolution e enviar via WhatsApp
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

      // 14. Salvar mensagem no banco com skill_id (texto limpo, sem assinatura)
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

      // 15. Atualizar last_message_at
      await this.prisma.conversation.update({
        where: { id: convo.id },
        data: { last_message_at: new Date() },
      });

      this.logger.log(
        `[AI] Resposta enviada para ${convo.lead.phone} (model=${model}, skill=${skill?.name || 'fallback'})`,
      );

      // 16. Atualizar Long Memory (a cada 3 mensagens recebidas)
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
