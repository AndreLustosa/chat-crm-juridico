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

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`Iniciando job de IA: ${job.id}`);

    // Lê chave OpenAI do banco (ou env var como fallback)
    const openAiKey = await this.settings.getOpenAiKey();
    if (!openAiKey) {
      this.logger.warn('OPENAI_API_KEY não configurada — configure em Ajustes IA');
      return;
    }

    const { conversation_id } = job.data;

    try {
      // 1. Fetch conversation details and recent history
      const convo = await this.prisma.conversation.findUnique({
        where: { id: conversation_id },
        include: { lead: true, messages: { orderBy: { created_at: 'asc' }, take: 10 } }
      });

      if (!convo || !convo.ai_mode) return;

      // 2. Format history for OpenAI
      const historyText = convo.messages.map(m =>
        `${m.direction === 'in' ? 'Lead' : 'IA/Atendente'}: ${m.text || '[Anexo]'}`
      ).join('\n');

      const systemPrompt = `Você é um agente de pré-atendimento de um escritório de advocacia (LexCRM).
Seu objetivo é extrair informações do caso do lead, classificar a área do direito (civil, criminal, trabalhista, etc)
e coletar dados para o advogado.
Responda de forma empática e curta (adequado para WhatsApp).`;

      const userPrompt = `Histórico recente da conversa:\n${historyText}\n\nResponda à última mensagem do Lead.`;

      // 3. Call OpenAI
      const ai = new OpenAI({ apiKey: openAiKey });
      const completion = await ai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 300,
      });

      const aiText = completion.choices[0]?.message?.content || 'Desculpe, estou com instabilidade no momento.';

      // 4. Ler config da Evolution do banco
      const { apiUrl, apiKey } = await this.settings.getEvolutionConfig();
      if (!apiUrl) {
        this.logger.warn('EVOLUTION_API_URL não configurada — resposta da IA não enviada');
        return;
      }

      const instanceName = convo.instance_name || process.env.EVOLUTION_INSTANCE_NAME || '';

      // 5. Send back via Evolution API
      await axios.post(`${apiUrl}/message/sendText/${instanceName}`, {
        number: convo.lead.phone,
        textMessage: { text: aiText },
        options: { delay: 1500, presence: 'composing' }
      }, {
        headers: { 'Content-Type': 'application/json', apikey: apiKey }
      });

      // 6. Save generated message to DB
      await this.prisma.message.create({
        data: {
          conversation_id: convo.id,
          direction: 'out',
          type: 'text',
          text: aiText,
          external_message_id: `sys_${Date.now()}`,
          status: 'enviado'
        }
      });

      this.logger.log(`Resposta da IA enviada com sucesso para ${convo.lead.phone}`);
    } catch (e: any) {
      this.logger.error(`Erro no processamento da IA: ${e.message}`);
      throw e;
    }
  }
}
