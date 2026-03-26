import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { FollowupService } from './followup.service';
import axios from 'axios';

@Processor('followup-jobs')
export class FollowupProcessor extends WorkerHost {
  private readonly logger = new Logger(FollowupProcessor.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private followupService: FollowupService,
  ) { super(); }

  async process(job: Job) {
    if (job.name === 'process-step') return this.processStep(job.data.enrollment_id);
    if (job.name === 'send-message') return this.sendMessage(job.data.message_id);
  }

  // ─── Decision Engine: Horário Comercial ──────────────────────────────────

  private isBusinessHours(): boolean {
    const now = new Date();
    const hora = parseInt(
      now.toLocaleString('pt-BR', { timeZone: 'America/Maceio', hour: '2-digit', hour12: false }),
    );
    const diaSemana = now.toLocaleString('pt-BR', { timeZone: 'America/Maceio', weekday: 'short' });
    // Domingo = não envia. Segunda a Sábado entre 8h e 18h
    if (diaSemana === 'dom.') return false;
    return hora >= 8 && hora < 18;
  }

  private nextBusinessHour(): Date {
    const now = new Date();
    const brt = new Date(now.toLocaleString('en-US', { timeZone: 'America/Maceio' }));
    const hora = brt.getHours();
    const dia = brt.getDay(); // 0=Dom

    const next = new Date(brt);
    if (hora >= 18 || dia === 0) {
      // Após 18h ou domingo → próximo dia útil às 9h
      next.setDate(next.getDate() + (dia === 6 ? 2 : 1));
      next.setHours(9, 0, 0, 0);
    } else if (hora < 8) {
      next.setHours(8, 0, 0, 0);
    }
    return next;
  }

  // ─── Decision Engine: Rate Limiting — máx 2 mensagens por lead por dia ──

  private async exceedsDailyLimit(leadId: string): Promise<boolean> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const count = await this.prisma.followupMessage.count({
      where: {
        lead_id: leadId,
        status: { in: ['ENVIADO', 'APROVADO'] },
        sent_at: { gte: startOfDay },
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
