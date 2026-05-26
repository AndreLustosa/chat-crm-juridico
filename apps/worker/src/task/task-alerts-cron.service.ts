import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { CronRunnerService } from '../common/cron/cron-runner.service';
import { resolveOverdueEffective } from './overdue-effective.util';
import axios from 'axios';

/**
 * Worker cron para alertas de tarefas:
 * 1. A cada 10 min: verifica tarefas vencendo nos próximos 30 min → WhatsApp + Socket
 *    (com gate pelo efetivo whatsapp do atendente)
 * 2. A cada 15 min: avisa UMA vez por tarefa assim que vencer → WhatsApp
 *    (dedup via Task.overdue_alerted_at; gate pelo efetivo whatsapp do atendente)
 */
@Injectable()
export class TaskAlertsCronService {
  private readonly logger = new Logger(TaskAlertsCronService.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private cronRunner: CronRunnerService,
  ) {}

  // ─── Resolução do efetivo "whatsapp" do aviso de vencida ──────────────────

  /**
   * Resolve o efetivo {whatsapp,badge,sound} do aviso de tarefa vencida pra um
   * atendente: combina o override tri-state dele (NotificationSetting.preferences
   * .taskOverdueOverride) com o padrão do escritório (Tenant.notification_defaults
   * .taskOverdue). `cache` evita refetch do mesmo user/tenant na mesma rodada.
   */
  private async resolveOverdueEffectiveForUser(
    userId: string | null | undefined,
    tenantId: string | null | undefined,
    cache: Map<string, { whatsapp: boolean; badge: boolean; sound: boolean }>,
  ): Promise<{ whatsapp: boolean; badge: boolean; sound: boolean }> {
    const key = `${userId || ''}::${tenantId || ''}`;
    const cached = cache.get(key);
    if (cached) return cached;

    let override: any = null;
    if (userId) {
      const setting = await (this.prisma as any).notificationSetting.findUnique({
        where: { user_id: userId },
        select: { preferences: true },
      });
      override = (setting?.preferences as any)?.taskOverdueOverride ?? null;
    }

    let officeDefault: any = null;
    if (tenantId) {
      const tenant = await (this.prisma as any).tenant.findUnique({
        where: { id: tenantId },
        select: { notification_defaults: true },
      });
      officeDefault = (tenant?.notification_defaults as any)?.taskOverdue ?? null;
    }

    const effective = resolveOverdueEffective(override, officeDefault);
    cache.set(key, effective);
    return effective;
  }

  // ─── A cada 10 min: tarefas prestes a vencer (próximos 30 min) ────────

  @Cron('*/10 * * * *', { timeZone: 'America/Maceio' })
  async checkDueSoon() {
    await this.cronRunner.run(
      'task-alerts-due-soon-whatsapp',
      9 * 60,
      async () => {
      const now = new Date();
      const thirtyMinFromNow = new Date(now.getTime() + 30 * 60 * 1000);

      // 1. Tasks com due_at
      const tasksDueSoon = await this.prisma.task.findMany({
        where: {
          status: { in: ['A_FAZER', 'EM_PROGRESSO'] },
          due_at: { gte: now, lte: thirtyMinFromNow },
        },
        include: {
          assigned_user: { select: { id: true, name: true, phone: true, tenant_id: true } },
          lead: { select: { name: true } },
          legal_case: { select: { case_number: true } },
        },
      });

      // 2. CalendarEvents (TAREFA/PRAZO) com start_at
      const eventsDueSoon = await this.prisma.calendarEvent.findMany({
        where: {
          type: { in: ['TAREFA', 'PRAZO'] },
          status: { in: ['AGENDADO', 'CONFIRMADO'] },
          start_at: { gte: now, lte: thirtyMinFromNow },
        },
        include: {
          assigned_user: { select: { id: true, name: true, phone: true, tenant_id: true } },
          lead: { select: { name: true } },
          legal_case: { select: { case_number: true } },
        },
      });

      // Unificar em lista comum
      const dueSoon: Array<{ id: string; title: string; dueAt: Date; user: any; lead: any; legalCase: any }> = [
        ...tasksDueSoon.map(t => ({ id: t.id, title: t.title, dueAt: t.due_at!, user: t.assigned_user, lead: t.lead, legalCase: t.legal_case })),
        ...eventsDueSoon.map(e => ({ id: e.id, title: e.title, dueAt: e.start_at, user: e.assigned_user, lead: e.lead, legalCase: e.legal_case })),
      ];

      if (dueSoon.length === 0) return;

      this.logger.log(`[TASK-ALERTS] ${dueSoon.length} tarefa(s)/evento(s) vencendo em 30 min`);

      // Cache do efetivo por user/tenant dentro desta rodada (evita N+1).
      const effCache = new Map<string, { whatsapp: boolean; badge: boolean; sound: boolean }>();

      for (const task of dueSoon) {
        if (!task.user?.phone) continue;

        // Gate: respeita o efetivo whatsapp do atendente (mesma config do
        // aviso de vencida). Se desligado, pula o WhatsApp.
        const eff = await this.resolveOverdueEffectiveForUser(task.user.id, task.user.tenant_id, effCache);
        if (!eff.whatsapp) continue;

        const alreadySent = await this.wasAlertSentRecently(task.id, 'TASK_DUE_SOON', 2);
        if (alreadySent) continue;

        const dueTime = task.dueAt.toLocaleTimeString('pt-BR', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
        const firstName = task.user.name.split(' ')[0];

        const msg =
          `⏰ *Tarefa vencendo em breve!*\n\n` +
          `Olá, ${firstName}!\n\n` +
          `📋 *${task.title}*\n` +
          `⏰ Vence às *${dueTime}*\n` +
          (task.lead?.name ? `👤 Cliente: ${task.lead.name}\n` : '') +
          (task.legalCase?.case_number ? `📁 Processo: ${task.legalCase.case_number}\n` : '') +
          `\nAcesse o sistema para atualizar o status.\n\n` +
          `_Alerta automático do CRM Jurídico_`;

        await this.sendWhatsApp(task.user.phone, msg);
        await this.logAlert(task.id, 'TASK_DUE_SOON', task.user.id);
        this.logger.log(`[TASK-ALERTS] Lembrete enviado para ${task.user.name} — tarefa: ${task.title}`);
      }
      },
      { description: 'WhatsApp de aviso para tarefas/eventos vencendo em 30 min', schedule: '*/10 * * * *' },
    );
  }

  // ─── A cada 15 min: avisa UMA vez por tarefa assim que vencer ─────────────

  @Cron('*/15 * * * *', { timeZone: 'America/Maceio' })
  async checkOverdue() {
    await this.cronRunner.run(
      'task-alerts-overdue-whatsapp',
      15 * 60,
      async () => {
      const now = new Date();

      // Tasks recém-vencidas que ainda nao foram avisadas (dedup via
      // overdue_alerted_at, nao mais por AuditLog). Inclui dados do atendente
      // (com tenant_id pra resolver o efetivo), do lead e do processo.
      const overdueTasks = await this.prisma.task.findMany({
        where: {
          status: { in: ['A_FAZER', 'EM_PROGRESSO'] },
          due_at: { lt: now },
          overdue_alerted_at: null,
          assigned_user_id: { not: null },
        },
        include: {
          assigned_user: { select: { id: true, name: true, phone: true, tenant_id: true } },
          lead: { select: { name: true, phone: true } },
          legal_case: { select: { case_number: true } },
        },
        orderBy: { due_at: 'asc' },
        take: 200,
      });

      if (overdueTasks.length === 0) return;

      this.logger.log(`[TASK-ALERTS] ${overdueTasks.length} tarefa(s) recém-vencida(s) p/ avisar`);

      // Cache do efetivo por user/tenant dentro desta rodada (evita N+1).
      const effCache = new Map<string, { whatsapp: boolean; badge: boolean; sound: boolean }>();

      for (const task of overdueTasks) {
        const user = task.assigned_user;
        try {
          // Só envia WhatsApp se: efetivo.whatsapp === true E atendente tem telefone.
          if (user?.phone) {
            const eff = await this.resolveOverdueEffectiveForUser(user.id, user.tenant_id, effCache);
            if (eff.whatsapp) {
              await this.sendWhatsApp(user.phone, this.buildOverdueMessage(task, user, now));
              this.logger.log(`[TASK-ALERTS] Aviso de vencida enviado para ${user.name} — tarefa: ${task.title}`);
            }
          }
        } catch (e: any) {
          this.logger.warn(`[TASK-ALERTS] Falha ao processar task ${task.id}: ${e.message}`);
        } finally {
          // SEMPRE marca como avisada (mesmo sem whatsapp/telefone) pra nao
          // reprocessar a cada 15 min.
          await this.prisma.task.update({
            where: { id: task.id },
            data: { overdue_alerted_at: new Date() },
          }).catch((e: any) => {
            this.logger.warn(`[TASK-ALERTS] Falha ao marcar overdue_alerted_at da task ${task.id}: ${e.message}`);
          });
        }
      }
      },
      { description: 'WhatsApp "tarefa venceu" (uma vez por tarefa, a cada 15 min)', schedule: '*/15 * * * *' },
    );
  }

  /**
   * Monta a mensagem do aviso de vencida com TODOS os dados: título, descrição
   * (se houver), prazo formatado, lead (nome+telefone), processo (case_number)
   * se houver, e há quanto tempo venceu.
   */
  private buildOverdueMessage(task: any, user: any, now: Date): string {
    const firstName = (user?.name || '').split(' ')[0] || '';
    const due: Date = task.due_at;
    const dueFmt = due.toLocaleString('pt-BR', {
      timeZone: 'America/Maceio',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

    // Há quanto tempo venceu (minutos/horas/dias).
    const diffMs = Math.max(0, now.getTime() - due.getTime());
    const mins = Math.floor(diffMs / 60000);
    let atraso: string;
    if (mins < 60) atraso = `${mins} min`;
    else if (mins < 1440) atraso = `${Math.floor(mins / 60)}h`;
    else atraso = `${Math.floor(mins / 1440)}d`;

    const lead = task.lead;
    const leadLine = lead?.name
      ? `👤 Cliente: ${lead.name}${lead.phone ? ` (${lead.phone})` : ''}\n`
      : '';
    const descLine = task.description ? `📝 ${task.description}\n` : '';
    const caseLine = task.legal_case?.case_number ? `📁 Processo: ${task.legal_case.case_number}\n` : '';

    return (
      `🚨 *Tarefa vencida!*\n\n` +
      `Olá, ${firstName}!\n\n` +
      `📋 *${task.title}*\n` +
      descLine +
      `⏰ Prazo: *${dueFmt}*\n` +
      `⌛ Venceu há *${atraso}*\n` +
      leadLine +
      caseLine +
      `\nAcesse o sistema para atualizar o status.\n\n` +
      `_Alerta automático do CRM Jurídico_`
    );
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private async sendWhatsApp(phone: string, text: string): Promise<void> {
    try {
      const { apiUrl, apiKey } = await this.settings.getEvolutionConfig();
      if (!apiUrl) return;
      const instance = process.env.EVOLUTION_INSTANCE_NAME || 'whatsapp';
      const cleanPhone = phone.replace(/\D/g, '');
      await axios.post(
        `${apiUrl}/message/sendText/${instance}`,
        { number: cleanPhone, text },
        { headers: { apikey: apiKey }, timeout: 15000 },
      );
    } catch (e: any) {
      this.logger.warn(`[TASK-ALERTS] Falha WhatsApp para ${phone}: ${e.message}`);
    }
  }

  private async wasAlertSentRecently(referenceId: string, type: string, hoursAgo: number): Promise<boolean> {
    const cutoff = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
    const existing = await this.prisma.auditLog.findFirst({
      where: { entity: 'TASK_ALERT', entity_id: referenceId, action: type, created_at: { gte: cutoff } },
    });
    return !!existing;
  }

  private async logAlert(referenceId: string, type: string, userId: string): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: { entity: 'TASK_ALERT', entity_id: referenceId, action: type, meta_json: { user_id: userId, sent_at: new Date().toISOString() } },
      });
    } catch {}
  }
}
