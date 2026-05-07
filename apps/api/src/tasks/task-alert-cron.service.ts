import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { CronRunnerService } from '../common/cron/cron-runner.service';
import {
  brazilRealNowToNaive,
  brazilRealEpochToNaive,
  minutesUntilBrazilNaive,
} from '../common/utils/timezone.util';

/**
 * Cron na API para emitir socket events de tarefas/eventos em tempo real.
 * Verifica AMBOS os modelos:
 * - Task (tarefas standalone com due_at)
 * - CalendarEvent (eventos tipo TAREFA/PRAZO com start_at)
 */
@Injectable()
export class TaskAlertCronService {
  private readonly logger = new Logger(TaskAlertCronService.name);

  constructor(
    private prisma: PrismaService,
    private chatGateway: ChatGateway,
    private cronRunner: CronRunnerService,
  ) {}

  /**
   * A cada 5 min: verifica tarefas/eventos vencendo nos próximos 15 min
   *
   * Nota timezone: colunas `due_at`/`start_at` sao gravadas como "UTC naive BRT"
   * (ver common/utils/timezone.util.ts). Por isso usamos helpers pra comparar
   * com `now`: senao o WHERE filtra uma janela deslocada em 3h.
   */
  @Cron('*/5 * * * *')
  async emitDueSoonAlerts() {
    await this.cronRunner.run(
      'tasks-due-soon-push',
      4 * 60,
      async () => {
      const nowMs = Date.now();
      // "now" e "15min" em coordenadas UTC naive BRT pra comparar com o banco
      const nowNaive = brazilRealNowToNaive(nowMs);
      const fifteenMinFromNowNaive = brazilRealEpochToNaive(nowMs + 15 * 60 * 1000);

      // 1. Tasks com due_at prestes a vencer
      const tasksDueSoon = await this.prisma.task.findMany({
        where: {
          status: { in: ['A_FAZER', 'EM_PROGRESSO'] },
          due_at: { gte: nowNaive, lte: fifteenMinFromNowNaive },
          assigned_user_id: { not: null },
        },
        select: {
          id: true, title: true, due_at: true, assigned_user_id: true,
          lead: { select: { name: true } },
          legal_case: { select: { case_number: true } },
        },
      });

      // 2. CalendarEvents (TAREFA, PRAZO) com start_at prestes a vencer
      const eventsDueSoon = await this.prisma.calendarEvent.findMany({
        where: {
          type: { in: ['TAREFA', 'PRAZO'] },
          status: { in: ['AGENDADO', 'CONFIRMADO'] },
          start_at: { gte: nowNaive, lte: fifteenMinFromNowNaive },
          assigned_user_id: { not: null },
        },
        select: {
          id: true, title: true, start_at: true, type: true, assigned_user_id: true,
          lead: { select: { name: true } },
          legal_case: { select: { case_number: true } },
        },
      });

      const total = tasksDueSoon.length + eventsDueSoon.length;
      if (total > 0) {
        this.logger.log(`[TASK-PUSH] ${total} alerta(s) due soon (${tasksDueSoon.length} tasks + ${eventsDueSoon.length} events)`);
      }

      // Emitir para Tasks
      for (const task of tasksDueSoon) {
        const mins = minutesUntilBrazilNaive(new Date(task.due_at!), nowMs);
        this.emitAlert(task.assigned_user_id!, {
          taskId: task.id,
          title: task.title,
          level: mins <= 5 ? 'critical' : 'urgent',
          message: `Vence em ${mins} min`,
          client: task.lead?.name || null,
          caseNumber: task.legal_case?.case_number || null,
        });
      }

      // Emitir para CalendarEvents
      for (const evt of eventsDueSoon) {
        const mins = minutesUntilBrazilNaive(new Date(evt.start_at), nowMs);
        const emoji = evt.type === 'PRAZO' ? '⏰' : '✅';
        this.emitAlert(evt.assigned_user_id!, {
          taskId: evt.id,
          title: `${emoji} ${evt.title}`,
          level: mins <= 5 ? 'critical' : 'urgent',
          message: `Vence em ${mins} min`,
          client: evt.lead?.name || null,
          caseNumber: evt.legal_case?.case_number || null,
        });
      }
      },
      { description: 'Emite alerta socket pra tarefas/eventos vencendo nos proximos 15min', schedule: '*/5 * * * *' },
    );
  }

  /**
   * A cada 30 min: verifica tarefas/eventos JÁ vencidos
   */
  @Cron('*/30 * * * *')
  async emitOverdueAlerts() {
    await this.cronRunner.run(
      'tasks-overdue-push',
      15 * 60,
      async () => {
      const nowMs = Date.now();
      // Compara com colunas "UTC naive BRT" (ver timezone.util.ts)
      const nowNaive = brazilRealNowToNaive(nowMs);

      // 1. Tasks vencidas
      const overdueTasks = await this.prisma.task.findMany({
        where: {
          status: { in: ['A_FAZER', 'EM_PROGRESSO'] },
          due_at: { lt: nowNaive },
          assigned_user_id: { not: null },
        },
        select: { id: true, title: true, due_at: true, assigned_user_id: true },
        take: 30,
      });

      // 2. CalendarEvents vencidos
      const overdueEvents = await this.prisma.calendarEvent.findMany({
        where: {
          type: { in: ['TAREFA', 'PRAZO'] },
          status: { in: ['AGENDADO', 'CONFIRMADO'] },
          start_at: { lt: nowNaive },
          assigned_user_id: { not: null },
        },
        select: { id: true, title: true, start_at: true, type: true, assigned_user_id: true },
        take: 30,
      });

      const total = overdueTasks.length + overdueEvents.length;
      if (total > 0) {
        this.logger.log(`[TASK-PUSH] ${total} alerta(s) overdue (${overdueTasks.length} tasks + ${overdueEvents.length} events)`);
      }

      // Agrupar por usuário
      const byUser = new Map<string, Array<{ id: string; title: string; date: Date }>>();

      for (const t of overdueTasks) {
        if (!t.assigned_user_id) continue;
        if (!byUser.has(t.assigned_user_id)) byUser.set(t.assigned_user_id, []);
        byUser.get(t.assigned_user_id)!.push({ id: t.id, title: t.title, date: t.due_at! });
      }

      for (const e of overdueEvents) {
        if (!e.assigned_user_id) continue;
        const emoji = e.type === 'PRAZO' ? '⏰' : '✅';
        if (!byUser.has(e.assigned_user_id)) byUser.set(e.assigned_user_id, []);
        byUser.get(e.assigned_user_id)!.push({ id: e.id, title: `${emoji} ${e.title}`, date: e.start_at });
      }

      for (const [userId, items] of byUser.entries()) {
        // Emitir um ÚNICO batch com todas as tarefas vencidas (não individual)
        const topItems = items.slice(0, 5).map(item => {
          // item.date eh "UTC naive BRT" — minutesUntil compensa offset
          const minsAgo = -minutesUntilBrazilNaive(item.date, nowMs);
          const hoursAgo = Math.round(minsAgo / 60);
          return {
            taskId: item.id,
            title: item.title,
            level: hoursAgo >= 24 ? 'critical' as const : 'urgent' as const,
            message: hoursAgo >= 24 ? `${Math.round(hoursAgo / 24)}d de atraso` : `${hoursAgo}h de atraso`,
          };
        });

        // Emitir batch único ao invés de múltiplos eventos
        this.chatGateway.server
          .to(`user:${userId}`)
          .emit('task_overdue_batch', { items: topItems, total: items.length });
      }
      },
      { description: 'Emite alerta socket batch de tarefas/eventos ja vencidos', schedule: '*/30 * * * *' },
    );
  }

  private emitAlert(userId: string, data: any) {
    try {
      this.chatGateway.server
        .to(`user:${userId}`)
        .emit('task_overdue_alert', data);
    } catch {}
  }
}
