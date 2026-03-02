import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import OpenAI from 'openai';
import axios from 'axios';

@Processor('ai-jobs')
export class AiProcessor extends WorkerHost {
  private readonly logger = new Logger(AiProcessor.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {
    super();
  }

  // Seleciona a skill mais adequada baseado na área jurídica detectada
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
    // Fallback: skill geral ou primeira ativa
    return (
      skills.find((s) =>
        ['geral', '*', 'triagem'].includes(s.area.toLowerCase()),
      ) || skills[0]
    );
  }

  // Substitui variáveis {{var}} no prompt
  private injectVariables(
    prompt: string,
    vars: Record<string, string>,
  ): string {
    return prompt.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`Iniciando job de IA: ${job.id}`);

    // 1. Ler chave OpenAI do banco
    const openAiKey = await this.settings.getOpenAiKey();
    if (!openAiKey) {
      this.logger.warn('OPENAI_API_KEY não configurada — configure em Ajustes IA');
      return;
    }

    const { conversation_id } = job.data;

    try {
      // 2. Buscar conversa + histórico
      const convo = await this.prisma.conversation.findUnique({
        where: { id: conversation_id },
        include: {
          lead: true,
          messages: { orderBy: { created_at: 'asc' }, take: 10 },
        },
      });

      if (!convo || !convo.ai_mode) return;

      const historyText = convo.messages
        .map(
          (m) =>
            `${m.direction === 'in' ? 'Cliente' : 'IA'}: ${m.text || '[Mídia]'}`,
        )
        .join('\n');

      // 3. Carregar skills ativas do banco
      const activeSkills = await this.settings.getActiveSkills();

      // 4. Selecionar skill baseada na área jurídica detectada
      const legalArea = (convo as any).legal_area || null;
      const skill = this.selectSkill(activeSkills, legalArea);

      // 5. Preparar prompt e parâmetros
      let systemPrompt: string;
      let model: string;
      let maxTokens: number;
      let temperature: number;
      let handoffSignal: string | null;

      if (skill) {
        const vars: Record<string, string> = {
          lead_name: convo.lead.name || 'Cliente',
          lead_phone: convo.lead.phone || '',
          legal_area: legalArea || 'a ser identificada',
          firm_name: 'André Lustosa Advogados',
          history_summary: historyText.slice(0, 500),
        };
        systemPrompt = this.injectVariables(skill.system_prompt, vars);
        model = skill.model || (await this.settings.getDefaultModel());
        maxTokens = skill.max_tokens || 300;
        temperature = skill.temperature ?? 0.7;
        handoffSignal = skill.handoff_signal || null;
        this.logger.log(
          `[AI] Usando skill: "${skill.name}" (area=${skill.area}, model=${model})`,
        );
      } else {
        // Fallback hardcoded quando não há skills configuradas
        systemPrompt = `Você é um agente de pré-atendimento de um escritório de advocacia.\nSeu objetivo é extrair informações do caso do lead, classificar a área do direito e coletar dados para o advogado.\nResponda de forma empática e curta (adequado para WhatsApp).`;
        model = await this.settings.getDefaultModel();
        maxTokens = 300;
        temperature = 0.7;
        handoffSignal = null;
        this.logger.warn('[AI] Nenhuma skill ativa encontrada — usando prompt fallback');
      }

      // 5b. Quando lead sem nome nas primeiras mensagens, instruir a IA a pedir o nome
      const inboundCount = convo.messages.filter((m) => m.direction === 'in').length;
      if (!convo.lead.name && inboundCount <= 2) {
        systemPrompt +=
          '\n\nO cliente ainda não informou o nome. Cumprimente-o de forma acolhedora e peça o nome antes de continuar.';
      }

      const userPrompt = `Histórico recente:\n${historyText}\n\nResponda à última mensagem do cliente.`;

      // 6. Chamar OpenAI com parâmetros da skill
      const ai = new OpenAI({ apiKey: openAiKey });
      const completion = await ai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: maxTokens,
        temperature,
      });

      let aiText =
        completion.choices[0]?.message?.content ||
        'Desculpe, estou com instabilidade no momento.';

      // 7. Verificar sinal de escalada (handoff para humano)
      if (handoffSignal && aiText.includes(handoffSignal)) {
        aiText = aiText.replace(new RegExp(handoffSignal, 'g'), '').trim();
        await (this.prisma as any).conversation.update({
          where: { id: conversation_id },
          data: { ai_mode: false },
        });
        this.logger.log(
          `[AI] Sinal de escalada detectado ("${handoffSignal}") — ai_mode desativado para ${conversation_id}`,
        );
      }

      // 8. Ler config da Evolution do banco
      const { apiUrl, apiKey } = await this.settings.getEvolutionConfig();
      if (!apiUrl) {
        this.logger.warn(
          'EVOLUTION_API_URL não configurada — resposta da IA não enviada',
        );
        return;
      }

      const instanceName =
        convo.instance_name || process.env.EVOLUTION_INSTANCE_NAME || '';

      // 9. Enviar via Evolution API
      await axios.post(
        `${apiUrl}/message/sendText/${instanceName}`,
        {
          number: convo.lead.phone,
          textMessage: { text: aiText },
          options: { delay: 1500, presence: 'composing' },
        },
        {
          headers: { 'Content-Type': 'application/json', apikey: apiKey },
        },
      );

      // 10. Salvar mensagem no banco
      await this.prisma.message.create({
        data: {
          conversation_id: convo.id,
          direction: 'out',
          type: 'text',
          text: aiText,
          external_message_id: `sys_${Date.now()}`,
          status: 'enviado',
        },
      });

      this.logger.log(
        `Resposta da IA enviada com sucesso para ${convo.lead.phone} (model=${model})`,
      );

      // 11. Extrair e salvar nome do lead se ainda não identificado
      if (!convo.lead.name) {
        try {
          const lastInbound = [...convo.messages].reverse().find((m) => m.direction === 'in');
          if (lastInbound?.text) {
            const nameResult = await ai.chat.completions.create({
              model: 'gpt-4o-mini',
              messages: [
                {
                  role: 'system',
                  content:
                    'A pessoa enviou uma mensagem. Extraia o nome próprio dela caso ela tenha se apresentado. Responda SOMENTE com o nome (ex: "Maria" ou "João Silva") ou "null" se não há apresentação de nome na mensagem.',
                },
                { role: 'user', content: lastInbound.text },
              ],
              max_tokens: 20,
            });

            const extractedName = nameResult.choices[0]?.message?.content?.trim();
            if (
              extractedName &&
              extractedName.toLowerCase() !== 'null' &&
              extractedName.length >= 2 &&
              extractedName.length <= 60
            ) {
              // 11a. Salvar nome no CRM
              await this.prisma.lead.update({
                where: { id: convo.lead.id },
                data: { name: extractedName },
              });

              // 11b. Salvar na agenda da Evolution API (agenda do WhatsApp)
              if (apiUrl && instanceName) {
                try {
                  await axios.post(
                    `${apiUrl}/contact/upsert/${instanceName}`,
                    { contacts: [{ phone: convo.lead.phone, fullName: extractedName }] },
                    { headers: { 'Content-Type': 'application/json', apikey: apiKey } },
                  );
                  this.logger.log(
                    `[AI] Contato salvo na Evolution: ${convo.lead.phone} → "${extractedName}"`,
                  );
                } catch (evErr: any) {
                  this.logger.warn(
                    `[AI] Falha ao salvar contato na Evolution: ${evErr.message}`,
                  );
                }
              }

              this.logger.log(
                `[AI] Nome extraído e salvo: "${extractedName}" → lead ${convo.lead.id}`,
              );
            }
          }
        } catch (nameErr: any) {
          this.logger.warn(`[AI] Falha ao extrair nome: ${nameErr.message}`);
        }
      }

      // 12. Classificar área jurídica e vincular advogado (apenas se ainda não classificado)
      const currentConv = await (this.prisma as any).conversation.findUnique({
        where: { id: conversation_id },
        select: { legal_area: true, assigned_lawyer_id: true },
      });

      if (!currentConv?.legal_area) {
        try {
          const areaResult = await ai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content:
                  'Analise esta conversa jurídica e responda APENAS com a área do direito em 1-3 palavras em português. Ex: "Trabalhista", "Civil", "Criminal", "Tributário", "Família", "Empresarial", "Previdenciário", "Imobiliário". Sem explicação adicional.',
              },
              { role: 'user', content: historyText },
            ],
            max_tokens: 20,
          });
          const detectedArea =
            areaResult.choices[0]?.message?.content?.trim() || null;

          if (detectedArea) {
            const allAutoSectors = await (this.prisma as any).sector.findMany({
              where: { auto_route: true },
              include: { users: { select: { id: true, specialties: true } } },
            });

            let assignedLawyerId: string | null = null;
            for (const sector of allAutoSectors) {
              const match = (sector.users as any[]).find((u: any) =>
                u.specialties.some(
                  (s: string) =>
                    s.toLowerCase().includes(detectedArea.toLowerCase()) ||
                    detectedArea.toLowerCase().includes(s.toLowerCase()),
                ),
              );
              if (match) {
                assignedLawyerId = match.id;
                break;
              }
            }

            await (this.prisma as any).conversation.update({
              where: { id: conversation_id },
              data: {
                legal_area: detectedArea,
                assigned_lawyer_id: assignedLawyerId,
              },
            });

            this.logger.log(
              `[AI] Área detectada: "${detectedArea}" | Advogado vinculado: ${assignedLawyerId || 'nenhum'}`,
            );
          }
        } catch (classifyErr: any) {
          this.logger.warn(
            `[AI] Falha na classificação de área jurídica: ${classifyErr.message}`,
          );
        }
      }
    } catch (e: any) {
      this.logger.error(`Erro no processamento da IA: ${e.message}`);
      throw e;
    }
  }
}
