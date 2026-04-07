import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import axios from 'axios';

/**
 * Worker cron para alertas de pagamento:
 * 1. Lembretes de vencimento (3 dias antes) — 8h Seg-Sex
 * 2. Alertas de inadimplência (parcelas vencidas) — 9h Seg-Sex
 * 3. Atualização de status PENDENTE → ATRASADO — 0h diário
 */
@Injectable()
export class PaymentAlertsCronService {
  private readonly logger = new Logger(PaymentAlertsCronService.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {}

  // ─── 0h diário: marcar parcelas vencidas como ATRASADO ─────────────────

  @Cron('5 0 * * *', { timeZone: 'America/Maceio' })
  async markOverduePayments() {
    try {
      const result = await this.prisma.honorarioPayment.updateMany({
        where: {
          status: 'PENDENTE',
          due_date: { lt: new Date() },
        },
        data: { status: 'ATRASADO' },
      });
      if (result.count > 0) {
        this.logger.log(`[PAYMENT-ALERTS] ${result.count} parcelas marcadas como ATRASADO`);
      }
    } catch (e: any) {
      this.logger.error(`[PAYMENT-ALERTS] Erro ao marcar atrasados: ${e.message}`);
    }
  }

  // ─── 8h Seg-Sex: lembrete de vencimento (3 dias antes) ─────────────────

  @Cron('0 8 * * 1-5', { timeZone: 'America/Maceio' })
  async sendDueReminders() {
    this.logger.log('[PAYMENT-ALERTS] Verificando parcelas vencendo em 3 dias...');
    try {
      const now = new Date();
      const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

      const dueSoon = await this.prisma.honorarioPayment.findMany({
        where: {
          status: 'PENDENTE',
          due_date: { gte: now, lte: threeDaysFromNow },
        },
        include: {
          honorario: {
            include: {
              legal_case: {
                select: {
                  case_number: true,
                  lead: { select: { id: true, name: true, phone: true } },
                },
              },
            },
          },
        },
      });

      if (dueSoon.length === 0) {
        this.logger.log('[PAYMENT-ALERTS] Nenhuma parcela vencendo em 3 dias');
        return;
      }

      this.logger.log(`[PAYMENT-ALERTS] ${dueSoon.length} parcelas vencendo em breve`);

      for (const payment of dueSoon) {
        const lc = (payment as any).honorario?.legal_case;
        const lead = lc?.lead;
        if (!lead?.phone) continue;

        // Verificar se já enviou lembrete nas últimas 48h (evitar spam)
        const alreadySent = await this.wasReminderSentRecently(payment.id, 'DUE_REMINDER', 48);
        if (alreadySent) continue;

        const firstName = (lead.name || 'Cliente').split(' ')[0];
        if (!payment.due_date) continue;
        const dueDate = payment.due_date.toLocaleDateString('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });
        const amount = Number(payment.amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

        const msg =
          `💰 *Lembrete de Pagamento*\n\n` +
          `Olá, ${firstName}!\n\n` +
          `Lembramos que sua parcela de *${amount}* vence em *${dueDate}*.\n` +
          (lc?.case_number ? `📋 Processo: ${lc.case_number}\n` : '') +
          `\nPara sua comodidade, entre em contato para gerar um PIX ou boleto.\n` +
          `Qualquer dúvida, estamos à disposição.\n\n` +
          `_André Lustosa Advogados_`;

        await this.sendWhatsApp(lead.phone, msg);
        await this.logReminder(payment.id, 'DUE_REMINDER', lead.id);
        this.logger.log(`[PAYMENT-ALERTS] Lembrete enviado para ${lead.phone} (parcela ${payment.id})`);
      }
    } catch (e: any) {
      this.logger.error(`[PAYMENT-ALERTS] Erro nos lembretes de vencimento: ${e.message}`);
    }
  }

  // ─── 9h Seg-Sex: alerta de inadimplência ───────────────────────────────

  @Cron('0 9 * * 1-5', { timeZone: 'America/Maceio' })
  async sendOverdueAlerts() {
    this.logger.log('[PAYMENT-ALERTS] Verificando parcelas atrasadas...');
    try {
      const overdue = await this.prisma.honorarioPayment.findMany({
        where: {
          status: { in: ['ATRASADO', 'PENDENTE'] },
          due_date: { lt: new Date() },
        },
        include: {
          honorario: {
            include: {
              legal_case: {
                select: {
                  case_number: true,
                  lead: { select: { id: true, name: true, phone: true } },
                },
              },
            },
          },
        },
        orderBy: { due_date: 'asc' },
        take: 50,
      });

      if (overdue.length === 0) {
        this.logger.log('[PAYMENT-ALERTS] Nenhuma parcela atrasada');
        return;
      }

      this.logger.log(`[PAYMENT-ALERTS] ${overdue.length} parcelas atrasadas`);

      // Agrupar por lead para enviar UMA mensagem por cliente
      const byLead = new Map<string, { lead: any; payments: typeof overdue }>();
      for (const p of overdue) {
        const lead = (p as any).honorario?.legal_case?.lead;
        if (!lead?.phone || !lead?.id) continue;
        if (!byLead.has(lead.id)) byLead.set(lead.id, { lead, payments: [] });
        byLead.get(lead.id)!.payments.push(p);
      }

      for (const [leadId, group] of byLead.entries()) {
        // Máximo 1 alerta por lead por semana
        const alreadySent = await this.wasReminderSentRecently(leadId, 'OVERDUE_ALERT', 168); // 7 dias
        if (alreadySent) continue;

        const { lead, payments } = group;
        const firstName = (lead.name || 'Cliente').split(' ')[0];
        const totalOverdue = payments.reduce((s, p) => s + Number(p.amount), 0);
        const totalStr = totalOverdue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        const count = payments.length;
        const oldestDays = payments[0].due_date ? Math.ceil((Date.now() - new Date(payments[0].due_date).getTime()) / 86400000) : 0;

        const msg =
          `⚠️ *Aviso de Pagamento em Atraso*\n\n` +
          `Olá, ${firstName}!\n\n` +
          `Identificamos *${count} parcela(s)* em atraso no valor total de *${totalStr}*` +
          (oldestDays > 1 ? ` (há ${oldestDays} dias)` : '') + `.\n\n` +
          `Pedimos gentilmente a regularização o quanto antes para evitar encargos.\n` +
          `Responda esta mensagem para combinarmos a melhor forma de pagamento.\n\n` +
          `_André Lustosa Advogados_`;

        await this.sendWhatsApp(lead.phone, msg);
        await this.logReminder(leadId, 'OVERDUE_ALERT', leadId);
        this.logger.log(`[PAYMENT-ALERTS] Alerta inadimplência enviado para ${lead.phone} (${count} parcelas, ${totalStr})`);
      }
    } catch (e: any) {
      this.logger.error(`[PAYMENT-ALERTS] Erro nos alertas de inadimplência: ${e.message}`);
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private async sendWhatsApp(phone: string, text: string): Promise<void> {
    try {
      const { apiUrl, apiKey } = await this.settings.getEvolutionConfig();
      if (!apiUrl) {
        this.logger.warn('[PAYMENT-ALERTS] EVOLUTION_API_URL não configurada');
        return;
      }
      const instance = process.env.EVOLUTION_INSTANCE_NAME || 'whatsapp';
      const cleanPhone = phone.replace(/\D/g, '');
      await axios.post(
        `${apiUrl}/message/sendText/${instance}`,
        { number: cleanPhone, text },
        { headers: { apikey: apiKey }, timeout: 15000 },
      );
    } catch (e: any) {
      this.logger.warn(`[PAYMENT-ALERTS] Falha ao enviar WhatsApp para ${phone}: ${e.message}`);
    }
  }

  /**
   * Verifica se um lembrete já foi enviado nas últimas X horas.
   * Usa a tabela de audit_log como registro de envio (simples e sem nova tabela).
   */
  private async wasReminderSentRecently(referenceId: string, type: string, hoursAgo: number): Promise<boolean> {
    const cutoff = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
    const existing = await this.prisma.auditLog.findFirst({
      where: {
        entity: 'PAYMENT_ALERT',
        entity_id: referenceId,
        action: type,
        created_at: { gte: cutoff },
      },
    });
    return !!existing;
  }

  private async logReminder(referenceId: string, type: string, leadId: string): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          entity: 'PAYMENT_ALERT',
          entity_id: referenceId,
          action: type,
          meta_json: { lead_id: leadId, sent_at: new Date().toISOString() },
        },
      });
    } catch {}
  }
}
