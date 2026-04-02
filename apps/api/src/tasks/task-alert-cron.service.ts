import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../gateway/chat.gateway';

/**
 * Cron na API para emitir socket events de tarefas em tempo real.
 * O frontend (TasksPanel) já escuta 'task_overdue_alert'.
 * O NotificationCenter escuta 'notification_update' para refresh.
 */
@Injectable()
export class TaskAlertCronService {
  private readonly logger = new Logger(TaskAlertCronService.name);

  constructor(
    private prisma: PrismaService,
    private chatGateway: ChatGateway,
  ) {}

  /**
   * A cada 5 min: verifica tarefas vencendo nos próximos 15 min
   * e emite socket event para o responsável
   */
  @Cron('*/5 * * * *')
  async emitDueSoonAlerts() {
    try {
      const now = new Date();
      const fifteenMinFromNow = new Date(now.getTime() + 15 * 60 * 1000);

      const dueSoon = await this.prisma.task.findMany({
        where: {
          status: { in: ['A_FAZER', 'EM_PROGRESSO'] },
          due_at: { gte: now, lte: fifteenMinFromNow },
          assigned_user_id: { not: null },
        },
        select: {
          id: true,
          title: true,
          due_at: true,
          assigned_user_id: true,
          lead: { select: { name: true } },
          legal_case: { select: { case_number: true } },
        },
      });

      for (const task of dueSoon) {
        if (!task.assigned_user_id) continue;

        const mins = Math.round((new Date(task.due_at!).getTime() - now.getTime()) / 60000);

        this.chatGateway.server
          .to(`user:${task.assigned_user_id}`)
          .emit('task_overdue_alert', {
            taskId: task.id,
            title: task.title,
            level: mins <= 5 ? 'critical' : 'urgent',
            message: `Vence em ${mins} min`,
            client: task.lead?.name || null,
            caseNumber: task.legal_case?.case_number || null,
          });
      }

      if (dueSoon.length > 0) {
        this.logger.log(`[TASK-PUSH] ${dueSoon.length} alerta(s) de tarefa emitido(s) via socket`);
      }
    } catch (e: any) {
      this.logger.warn(`[TASK-PUSH] Erro: ${e.message}`);
    }
  }

  /**
   * A cada 30 min: verifica tarefas vencidas e emite alerta overdue
   */
  @Cron('*/30 * * * *')
  async emitOverdueAlerts() {
    try {
      const now = new Date();

      const overdue = await this.prisma.task.findMany({
        where: {
          status: { in: ['A_FAZER', 'EM_PROGRESSO'] },
          due_at: { lt: now },
          assigned_user_id: { not: null },
        },
        select: {
          id: true,
          title: true,
          due_at: true,
          assigned_user_id: true,
        },
        take: 30,
      });

      // Agrupar por usuário e emitir uma vez por pessoa
      const byUser = new Map<string, typeof overdue>();
      for (const task of overdue) {
        if (!task.assigned_user_id) continue;
        if (!byUser.has(task.assigned_user_id)) byUser.set(task.assigned_user_id, []);
        byUser.get(task.assigned_user_id)!.push(task);
      }

      for (const [userId, tasks] of byUser.entries()) {
        // Emite alerta para cada tarefa vencida
        for (const task of tasks.slice(0, 5)) {
          const hoursAgo = Math.round((now.getTime() - new Date(task.due_at!).getTime()) / 3600000);

          this.chatGateway.server
            .to(`user:${userId}`)
            .emit('task_overdue_alert', {
              taskId: task.id,
              title: task.title,
              level: hoursAgo >= 24 ? 'critical' : 'urgent',
              message: hoursAgo >= 24 ? `${Math.round(hoursAgo / 24)}d de atraso` : `${hoursAgo}h de atraso`,
            });
        }

        // Emite refresh do notification center
        this.chatGateway.server
          .to(`user:${userId}`)
          .emit('notification_update', { type: 'task_overdue', count: tasks.length });
      }

      if (overdue.length > 0) {
        this.logger.log(`[TASK-PUSH] ${overdue.length} alerta(s) overdue emitido(s) para ${byUser.size} usuário(s)`);
      }
    } catch (e: any) {
      this.logger.warn(`[TASK-PUSH] Erro overdue: ${e.message}`);
    }
  }
}
