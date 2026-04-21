import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { FollowupService } from './followup.service';
import { FollowupAnalyzerService } from './followup-analyzer.service';
import axios from 'axios';

@Processor('followup-jobs')
export class FollowupProcessor extends WorkerHost {
  private readonly logger = new Logger(FollowupProcessor.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private followupService: FollowupService,
    private analyzer: FollowupAnalyzerService,
  ) { super(); }

  async process(job: Job) {
    if (job.name === 'process-step') return this.processStep(job.data.enrollment_id);
    if (job.name === 'send-message') return this.sendMessage(job.data.message_id);
    if (job.name === 'broadcast-send') return this.processBroadcastItem(job.data.broadcast_id, job.data.item_id, job.data.custom_prompt);
    if (job.name === 'manual-legacy-followup') return this.processManualLegacy(job.data.lead_id, job.data.stage);
  }

  /**
   * Handler: followup manual disparado pelo admin pra um lead legacy
   * (sem sequencia customizada). Roda a mesma analise IA do cron
   * (FollowupAnalyzerService) mas pra apenas 1 lead, ignorando cutoffs
   * de dias inativos. Usado quando o admin aperta "Disparar agora" na
   * aba Fila do menu Followup.
   */
  private async processManualLegacy(leadId: string, stage: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, name: true, phone: true, stage: true, is_client: true },
    });
    if (!lead) {
      this.logger.warn(`[FOLLOWUP-MANUAL] Lead ${leadId} nao encontrado`);
      return;
    }
    if (lead.is_client) {
      this.logger.log(`[FOLLOWUP-MANUAL] Lead ${leadId} virou cliente — abortando disparo`);
      return;
    }

    const convo = await this.prisma.conversation.findFirst({
      where: { lead_id: leadId, status: 'ABERTO' },
      orderBy: { last_message_at: 'desc' },
      select: { id: true, instance_name: true },
    });
    if (!convo) {
      this.logger.warn(`[FOLLOWUP-MANUAL] Sem conversa aberta pra lead ${leadId}`);
      return;
    }

    const decision = await this.analyzer.analyzeAndDecide({
      leadId: lead.id,
      conversationId: convo.id,
      stage: lead.stage || stage,
      stageHint: 'disparo manual pelo admin (botao Disparar Agora)',
    });

    if (decision.action === 'ARCHIVE') {
      await this.prisma.lead.update({
        where: { id: lead.id },
        data: {
          stage: 'PERDIDO',
          loss_reason: decision.reason || 'IA detectou desengajamento no disparo manual',
          last_followup_at: new Date(),
        },
      });
      this.logger.log(`[FOLLOWUP-MANUAL] Lead ${lead.phone} ARQUIVADO: ${decision.reason}`);
      return;
    }

    if (decision.action === 'SKIP') {
      this.logger.log(`[FOLLOWUP-MANUAL] Lead ${lead.phone} PULADO (IA): ${decision.reason}`);
      return;
    }

    if (decision.action === 'SEND' && decision.message) {
      const { apiUrl, apiKey } = await this.settings.getEvolutionConfig();
      if (!apiUrl) {
        this.logger.warn(`[FOLLOWUP-MANUAL] EVOLUTION_API_URL nao configurada`);
        return;
      }
      const instanceName = convo.instance_name || process.env.EVOLUTION_INSTANCE_NAME || '';
      const textToSend = `*Sophia:* ${decision.message}`;

      const sendResult = await axios.post(
        `${apiUrl}/message/sendText/${instanceName}`,
        { number: lead.phone, text: textToSend },
        { headers: { 'Content-Type': 'application/json', apikey: apiKey }, timeout: 15000 },
      );
      const evoMsgId = sendResult?.data?.key?.id || `out_followup_manual_${Date.now()}`;

      await this.prisma.message.create({
        data: {
          conversation_id: convo.id,
          direction: 'out',
          type: 'text',
          text: decision.message,
          external_message_id: evoMsgId,
          status: 'enviado',
        },
      });
      await Promise.all([
        this.prisma.conversation.update({
          where: { id: convo.id },
          data: { last_message_at: new Date() },
        }),
        this.prisma.lead.update({
          where: { id: lead.id },
          data: { last_followup_at: new Date() },
        }),
      ]);
      this.logger.log(
        `[FOLLOWUP-MANUAL] Lead ${lead.phone} ENVIADO: "${decision.message.slice(0, 60)}..."`,
      );
    }
  }

  // ─── Timezone helper — America/Maceio (UTC-3) ────────────────────────────

  private getMaceioNow(): { hora: number; dia: number; date: Date } {
    const now = new Date();
    // Usar offset fixo BRT = UTC-3
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    const maceioMs = utcMs - 3 * 3600000;
    const maceio = new Date(maceioMs);
    return { hora: maceio.getHours(), dia: maceio.getDay(), date: maceio };
  }

  // ─── Decision Engine: Horário Comercial ──────────────────────────────────

  private isBusinessHours(): boolean {
    const { hora, dia } = this.getMaceioNow();
    // Domingo (0) = não envia. Segunda a Sábado entre 8h e 18h
    if (dia === 0) return false;
    return hora >= 8 && hora < 18;
  }

  private nextBusinessHour(): Date {
    const { hora, dia, date } = this.getMaceioNow();
    const now = new Date();

    if (hora >= 18 || dia === 0) {
      // Após 18h ou domingo → próximo dia útil às 9h
      let daysToAdd = 1;
      if (dia === 6) daysToAdd = 2; // sábado → segunda
      if (dia === 0) daysToAdd = 1; // domingo → segunda
      const next = new Date(now.getTime() + daysToAdd * 86400000);
      // Setar para 9h em Maceio (12h UTC)
      next.setUTCHours(12, 0, 0, 0);
      return next;
    } else if (hora < 8) {
      // Antes de 8h → hoje às 8h em Maceio (11h UTC)
      const next = new Date(now);
      next.setUTCHours(11, 0, 0, 0);
      return next;
    }
    return now; // já está em horário comercial
  }

  // ─── Decision Engine: Rate Limiting — máx 2 mensagens por lead por dia ──

  private async exceedsDailyLimit(leadId: string): Promise<boolean> {
    // Calcular início do dia em Maceio (UTC-3) → 03:00 UTC
    const now = new Date();
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    const maceioMs = utcMs - 3 * 3600000;
    const maceio = new Date(maceioMs);
    maceio.setHours(0, 0, 0, 0);
    // Converter de volta para UTC
    const startOfDayMaceio = new Date(maceio.getTime() + 3 * 3600000);

    const count = await this.prisma.followupMessage.count({
      where: {
        lead_id: leadId,
        status: { in: ['ENVIADO', 'APROVADO'] },
        sent_at: { gte: startOfDayMaceio },
      },
    });
    return count >= 2;
  }

  private async processStep(enrollmentId: string) {
    const enrollment = await this.prisma.followupEnrollment.findUnique({
      where: { id: enrollmentId },
      include: {
        lead: true,
        sequence: { include: { steps: { orderBy: { position: 'asc' } } } },
      },
    });

    if (!enrollment || enrollment.status !== 'ATIVO') return;

    const step = enrollment.sequence.steps.find(s => s.position === enrollment.current_step);
    if (!step) {
      // Sequência concluída
      await this.prisma.followupEnrollment.update({
        where: { id: enrollmentId },
        data: { status: 'CONCLUIDO' },
      });
      return;
    }

    // ─── Decision Engine ──────────────────────────────────────────────────

    // 1. Verificação de Horário Comercial
    if (!this.isBusinessHours()) {
      const nextAt = this.nextBusinessHour();
      await this.prisma.followupEnrollment.update({
        where: { id: enrollmentId },
        data: { next_send_at: nextAt },
      });
      this.logger.log(
        `[FOLLOWUP] Fora do horário comercial — reagendado para ${nextAt.toLocaleString('pt-BR', { timeZone: 'America/Maceio' })}`,
      );
      return;
    }

    // 2. Rate Limiting — máx 2 mensagens por lead por dia
    if (await this.exceedsDailyLimit(enrollment.lead_id)) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      await this.prisma.followupEnrollment.update({
        where: { id: enrollmentId },
        data: { next_send_at: tomorrow },
      });
      this.logger.log(
        `[FOLLOWUP] Limite diário atingido para lead ${enrollment.lead_id} — reagendado para amanhã`,
      );
      return;
    }

    // ─── Bloquear enrollment se lead virou cliente ────────────────────────
    // Atualizado em 2026-04-21: clientes (is_client=true) nao devem receber
    // followup automatico — so LEADS em qualificacao. Mesmo que o admin
    // tenha criado uma sequencia pra um lead, se ele virou cliente no meio
    // da sequencia, cancelamos.
    if ((enrollment.lead as any).is_client) {
      this.logger.log(
        `[FOLLOWUP] Enrollment ${enrollmentId} cancelado — lead virou cliente`,
      );
      await this.prisma.followupEnrollment.update({
        where: { id: enrollmentId },
        data: { status: 'CANCELADO' },
      });
      return;
    }

    // ─── Anti-spam: não enviar se houve mensagem na conversa nas últimas 12h ─

    const convo = await this.prisma.conversation.findFirst({
      where: { lead_id: enrollment.lead_id, status: 'ABERTO' },
      orderBy: { last_message_at: 'desc' },
    });
    if (convo?.last_message_at) {
      const horasDesde = (Date.now() - convo.last_message_at.getTime()) / 3600000;
      if (horasDesde < 12) {
        this.logger.log(`[FOLLOWUP] Pulando ${enrollment.lead_id} — conversa ativa (${Math.round(horasDesde)}h atrás)`);
        // Reagendar para 12h mais tarde
        const nextAt = new Date(Date.now() + 12 * 3600000);
        await this.prisma.followupEnrollment.update({
          where: { id: enrollmentId },
          data: { next_send_at: nextAt },
        });
        return;
      }
    }

    // ─── Analise contextual via IA: decidir ARCHIVE/SEND/SKIP ─────────────
    // Antes de gerar a mensagem do step (que usa templates customizados do
    // enrollment), checa via LLM se faz sentido enviar agora. Se o lead ja
    // sinalizou desinteresse/desistencia, cancela a sequencia inteira e
    // arquiva o lead. Se nao for momento certo, reagenda pra amanha.
    if (convo) {
      const decision = await this.analyzer.analyzeAndDecide({
        leadId: enrollment.lead_id,
        conversationId: convo.id,
        stage: (enrollment.lead as any).stage || 'QUALIFICANDO',
        stageHint: `enrollment em sequencia ${enrollment.sequence.name || ''} step ${enrollment.current_step}`,
      });

      if (decision.action === 'ARCHIVE') {
        await this.prisma.$transaction([
          this.prisma.followupEnrollment.update({
            where: { id: enrollmentId },
            data: { status: 'CANCELADO' },
          }),
          this.prisma.lead.update({
            where: { id: enrollment.lead_id },
            data: {
              stage: 'PERDIDO',
              loss_reason: decision.reason || 'Enrollment cancelado pelo analyzer IA',
            },
          }),
        ]);
        this.logger.log(
          `[FOLLOWUP] Enrollment ${enrollmentId} cancelado + lead ${enrollment.lead_id} arquivado: ${decision.reason}`,
        );
        return;
      }

      if (decision.action === 'SKIP') {
        // Reagendar pra amanha (mesmo horario)
        const tomorrow = new Date(Date.now() + 24 * 3600000);
        await this.prisma.followupEnrollment.update({
          where: { id: enrollmentId },
          data: { next_send_at: tomorrow },
        });
        this.logger.log(
          `[FOLLOWUP] Enrollment ${enrollmentId} pulado: ${decision.reason}`,
        );
        return;
      }

      // decision.action === 'SEND' — prossegue com o fluxo de geracao normal
      // (o step pode ter template customizado que o admin criou)
    }

    // ─── Gerar mensagem com IA ────────────────────────────────────────────

    try {
      const dossie = await this.followupService.buildDossie(enrollment, step, enrollment.lead);
      const generatedText = await this.followupService.generateMessage(dossie, step.custom_prompt);
      const riskLevel = this.followupService.classifyRisk(dossie, step);

      const msg = await this.prisma.followupMessage.create({
        data: {
          enrollment_id: enrollmentId,
          step_id: step.id,
          lead_id: enrollment.lead_id,
          channel: step.channel,
          generated_text: generatedText,
          sent_text: step.auto_send ? generatedText : undefined,
          status: step.auto_send && riskLevel === 'baixo' ? 'APROVADO' : 'PENDENTE_APROVACAO',
          risk_level: riskLevel,
          context_json: dossie as any,
        },
      });

      if (step.auto_send && riskLevel === 'baixo') {
        await this.sendMessageDirect(msg.id, enrollment.lead_id, step.channel, generatedText, convo);
      } else {
        this.logger.log(`[FOLLOWUP] Mensagem ${msg.id} aguardando aprovação (risco: ${riskLevel})`);
      }
    } catch (e: any) {
      this.logger.error(`[FOLLOWUP] Erro ao processar step: ${e.message}`);
    }
  }

  private async sendMessage(messageId: string) {
    const msg = await this.prisma.followupMessage.findUnique({
      where: { id: messageId },
      include: { enrollment: { include: { lead: true } }, step: true },
    });
    if (!msg || msg.status === 'ENVIADO') return;

    const convo = await this.prisma.conversation.findFirst({
      where: { lead_id: msg.lead_id, status: 'ABERTO' },
      orderBy: { last_message_at: 'desc' },
    });

    await this.sendMessageDirect(messageId, msg.lead_id, msg.step.channel, msg.sent_text || msg.generated_text, convo);
  }

  private async sendMessageDirect(msgId: string, leadId: string, channel: string, text: string, convo: any) {
    if (channel !== 'whatsapp') {
      this.logger.log(`[FOLLOWUP] Canal ${channel} — marcado como enviado (integração pendente)`);
      await this.prisma.followupMessage.update({ where: { id: msgId }, data: { status: 'ENVIADO', sent_at: new Date(), sent_text: text } });
      await this.advanceEnrollment(msgId);
      return;
    }

    const { apiUrl, apiKey } = await this.settings.getEvolutionConfig();
    if (!apiUrl) { this.logger.warn('[FOLLOWUP] EVOLUTION_API_URL não configurada'); return; }

    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) return;

    const instanceName = convo?.instance_name || process.env.EVOLUTION_INSTANCE_NAME || '';

    try {
      await axios.post(`${apiUrl}/message/sendText/${instanceName}`, {
        number: lead.phone, text,
      }, { headers: { 'Content-Type': 'application/json', apikey: apiKey }, timeout: 15000 });

      await this.prisma.followupMessage.update({
        where: { id: msgId },
        data: { status: 'ENVIADO', sent_at: new Date(), sent_text: text },
      });

      if (convo) {
        await Promise.all([
          this.prisma.conversation.update({ where: { id: convo.id }, data: { last_message_at: new Date() } }),
          this.prisma.message.create({
            data: { conversation_id: convo.id, direction: 'out', type: 'text', text, external_message_id: `sys_followup_ia_${Date.now()}`, status: 'enviado' },
          }),
        ]);
      }

      await this.prisma.lead.update({ where: { id: leadId }, data: { last_followup_at: new Date() } });
      this.logger.log(`[FOLLOWUP] Enviado para ${lead.phone}`);
      await this.advanceEnrollment(msgId);
    } catch (e: any) {
      this.logger.error(`[FOLLOWUP] Falha ao enviar: ${e.message}`);
      await this.prisma.followupMessage.update({ where: { id: msgId }, data: { status: 'FALHOU' } });
    }
  }

  private async processBroadcastItem(broadcastId: string, itemId: string, customPrompt?: string) {
    // Check broadcast is still active
    const broadcast = await this.prisma.broadcastJob.findUnique({ where: { id: broadcastId } });
    if (!broadcast || broadcast.status === 'CANCELADO') {
      this.logger.log(`[BROADCAST] Disparo ${broadcastId} cancelado — pulando item ${itemId}`);
      return;
    }

    const item = await this.prisma.broadcastItem.findUnique({ where: { id: itemId } });
    if (!item || item.status !== 'PENDENTE') return;

    // Load event + lead + case context
    const event = item.event_id ? await this.prisma.calendarEvent.findUnique({
      where: { id: item.event_id },
      include: {
        lead: true,
        legal_case: { select: { case_number: true, action_type: true, court: true, opposing_party: true, judge: true, legal_area: true } },
      },
    }) : null;

    const lead = event?.lead || await this.prisma.lead.findUnique({ where: { id: item.lead_id } });
    if (!lead) {
      await this.prisma.broadcastItem.update({ where: { id: itemId }, data: { status: 'FALHOU', error: 'Lead não encontrado' } });
      await this.prisma.broadcastJob.update({ where: { id: broadcastId }, data: { failed_count: { increment: 1 } } });
      return;
    }

    try {
      // COMUNICADO: usa mensagem fixa do custom_prompt (sem IA)
      // Outros tipos: gera mensagem personalizada com IA
      let text: string;
      if (broadcast.type === 'COMUNICADO' && customPrompt) {
        const nome = lead.name?.split(' ')[0] || 'cliente';
        text = customPrompt.replace(/\{\{nome\}\}/g, nome);
      } else {
        text = await this.generateBroadcastMessage(lead, event, broadcast.type, customPrompt);
      }

      // Save generated text
      await this.prisma.broadcastItem.update({ where: { id: itemId }, data: { generated_text: text } });

      // Send via Evolution API
      const { apiUrl, apiKey } = await this.settings.getEvolutionConfig();
      if (!apiUrl) {
        await this.prisma.broadcastItem.update({ where: { id: itemId }, data: { status: 'FALHOU', error: 'Evolution API não configurada' } });
        await this.prisma.broadcastJob.update({ where: { id: broadcastId }, data: { failed_count: { increment: 1 } } });
        return;
      }

      const convo = await this.prisma.conversation.findFirst({
        where: { lead_id: lead.id, status: 'ABERTO' },
        orderBy: { last_message_at: 'desc' },
      });
      const instanceName = convo?.instance_name || process.env.EVOLUTION_INSTANCE_NAME || '';

      await axios.post(`${apiUrl}/message/sendText/${instanceName}`, {
        number: lead.phone, text,
      }, { headers: { 'Content-Type': 'application/json', apikey: apiKey }, timeout: 15000 });

      // Update item as sent
      await this.prisma.broadcastItem.update({ where: { id: itemId }, data: { status: 'ENVIADO', sent_at: new Date() } });
      await this.prisma.broadcastJob.update({ where: { id: broadcastId }, data: { sent_count: { increment: 1 } } });

      // Save in conversation history
      if (convo) {
        await this.prisma.message.create({
          data: { conversation_id: convo.id, direction: 'out', type: 'text', text, external_message_id: `sys_broadcast_${Date.now()}`, status: 'enviado' },
        });
        await this.prisma.conversation.update({ where: { id: convo.id }, data: { last_message_at: new Date() } });
      }

      this.logger.log(`[BROADCAST] Enviado para ${lead.phone} (${lead.name})`);
    } catch (e: any) {
      this.logger.error(`[BROADCAST] Falha ao enviar para ${lead.phone}: ${e.message}`);
      await this.prisma.broadcastItem.update({ where: { id: itemId }, data: { status: 'FALHOU', error: e.message?.substring(0, 500) } });
      await this.prisma.broadcastJob.update({ where: { id: broadcastId }, data: { failed_count: { increment: 1 } } });
    }

    // Check if this was the last item
    const remaining = await this.prisma.broadcastItem.count({ where: { broadcast_id: broadcastId, status: 'PENDENTE' } });
    if (remaining === 0) {
      await this.prisma.broadcastJob.update({
        where: { id: broadcastId },
        data: { status: broadcast.status === 'CANCELADO' ? 'CANCELADO' : 'CONCLUIDO', completed_at: new Date() },
      });
      this.logger.log(`[BROADCAST] Disparo ${broadcastId} concluído`);
    }
  }

  private async generateBroadcastMessage(lead: any, event: any, type: string, customPrompt?: string): Promise<string> {
    const nome = (lead.name || 'Cliente').split(' ')[0];
    const advogado = 'André Lustosa';
    const escritorio = 'Lustosa Advogados';

    // Format event date in pt-BR
    const dataEvento = event?.start_at ? new Date(event.start_at).toLocaleString('pt-BR', {
      weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
    }) : 'data a confirmar';

    const systemPrompt = `Você é ${advogado}, advogado do escritório ${escritorio}.
Está escrevendo uma mensagem de lembrete de ${type === 'AUDIENCIA' ? 'audiência' : type === 'PERICIA' ? 'perícia' : 'prazo'} via WhatsApp para seu cliente ${lead.name || 'Cliente'}.

REGRAS ABSOLUTAS:
1. Nunca revele que é IA ou mensagem automática
2. Seja direto e profissional, máximo 200 palavras
3. Inclua data, horário e local (se disponível)
4. Peça para o cliente chegar com 30 minutos de antecedência
5. Oriente sobre documentos necessários se relevante
6. Termine com pergunta se tem dúvidas
7. Tom: profissional mas caloroso
8. NÃO use "venho por meio desta" ou frases burocráticas

DADOS DO EVENTO:
- Tipo: ${type}
- Título: ${event?.title || 'Audiência'}
- Data/Hora: ${dataEvento}
- Local: ${event?.location || 'A confirmar'}
${event?.legal_case ? `- Processo: ${event.legal_case.case_number || 'N/A'}
- Tipo de ação: ${event.legal_case.action_type || 'N/A'}
- Vara/Tribunal: ${event.legal_case.court || 'N/A'}
- Parte contrária: ${event.legal_case.opposing_party || 'N/A'}` : ''}

DADOS DO CLIENTE:
- Nome: ${lead.name || 'Cliente'}

${customPrompt ? `INSTRUÇÃO ADICIONAL DO ADVOGADO:\n${customPrompt}` : ''}

Gere APENAS o texto da mensagem, sem introduções.`;

    try {
      const openai = new (await import('openai')).default({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        messages: [{ role: 'system', content: systemPrompt }],
        max_tokens: 500,
        temperature: 0.7,
      });
      return completion.choices[0]?.message?.content?.trim() || this.fallbackBroadcastMessage(nome, type, dataEvento, event?.location);
    } catch (e: any) {
      this.logger.warn(`[BROADCAST] IA indisponível, usando fallback: ${e.message}`);
      return this.fallbackBroadcastMessage(nome, type, dataEvento, event?.location);
    }
  }

  private fallbackBroadcastMessage(nome: string, type: string, dataEvento: string, location?: string): string {
    const tipoLabel = type === 'AUDIENCIA' ? 'audiência' : type === 'PERICIA' ? 'perícia' : 'compromisso';
    return `Olá, ${nome}! Tudo bem?\n\nGostaria de lembrá-lo(a) que sua ${tipoLabel} está agendada para *${dataEvento}*${location ? ` no local: *${location}*` : ''}.\n\nPor favor, chegue com 30 minutos de antecedência e traga seus documentos pessoais.\n\nEm caso de dúvidas, estou à disposição!`;
  }

  private async advanceEnrollment(msgId: string) {
    const msg = await this.prisma.followupMessage.findUnique({ where: { id: msgId }, include: { enrollment: { include: { sequence: { include: { steps: { orderBy: { position: 'asc' } } } } } } } });
    if (!msg) return;

    const enrollment = msg.enrollment;
    const nextStep = enrollment.sequence.steps.find(s => s.position === enrollment.current_step + 1);

    if (!nextStep) {
      await this.prisma.followupEnrollment.update({ where: { id: enrollment.id }, data: { status: 'CONCLUIDO', last_sent_at: new Date() } });
      return;
    }

    const nextAt = new Date(Date.now() + nextStep.delay_hours * 3600000);
    await this.prisma.followupEnrollment.update({
      where: { id: enrollment.id },
      data: { current_step: nextStep.position, last_sent_at: new Date(), next_send_at: nextAt },
    });
  }
}
