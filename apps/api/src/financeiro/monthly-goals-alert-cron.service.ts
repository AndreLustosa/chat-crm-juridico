import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MonthlyGoalsService } from './monthly-goals.service';
import { CronRunnerService } from '../common/cron/cron-runner.service';

/**
 * Cron de alerta de metas em risco.
 *
 * Regra: do dia 25 ao ultimo dia do mes corrente, ~9h BRT, varre todas as
 * metas REALIZED ativas e dispara notificacao interna pra:
 *  - meta de escritorio: todos os ADMIN/FINANCEIRO do tenant
 *  - meta individual: o proprio advogado (lawyer_id) + ADMINs
 *  ...quando o atingimento esta abaixo de 70%.
 *
 * Dedup: nao dispara duas vezes pra mesma meta no mesmo dia (filtra
 * Notification.created_at >= startOfToday + data.goalId == this.id).
 *
 * Roda diariamente porque queremos avisar todo dia ate o usuario reagir
 * ou o mes terminar — nao queremos disparar 1 vez no dia 25 e dormir.
 */
@Injectable()
export class MonthlyGoalsAlertCronService {
  private readonly logger = new Logger(MonthlyGoalsAlertCronService.name);

  constructor(
    private prisma: PrismaService,
    private goalsService: MonthlyGoalsService,
    private cronRunner: CronRunnerService,
  ) {}

  /**
   * Diariamente as 9h BRT. Roda apenas se hoje >= dia 25.
   * Cron expression: '0 9 * * *' = todo dia as 9:00.
   * Nota timezone: usamos UTC-3 BRT — em produção a VPS roda em America/Maceio.
   */
  @Cron('0 9 * * *', { timeZone: 'America/Maceio' })
  async checkGoalsAtRisk() {
    await this.cronRunner.run(
      'financeiro-monthly-goals-alert',
      15 * 60,
      async () => {
    const now = new Date();
    const dayOfMonth = now.getUTCDate();
    if (dayOfMonth < 25) {
      this.logger.debug(`[GOALS-ALERT] Dia ${dayOfMonth} < 25, pulando.`);
      return;
    }

    this.logger.log(`[GOALS-ALERT] Iniciando varredura — dia ${dayOfMonth}`);

    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;

    // Busca todas as metas REALIZED ativas do mes corrente, todos os tenants
    const goals = await this.prisma.monthlyGoal.findMany({
      where: {
        year, month,
        kind: 'REALIZED',
        deleted_at: null,
      },
      select: {
        id: true,
        tenant_id: true,
        lawyer_id: true,
        value: true,
        lawyer: { select: { id: true, name: true } },
      },
    });

    if (goals.length === 0) {
      this.logger.log(`[GOALS-ALERT] Nenhuma meta REALIZED ativa em ${month}/${year}.`);
      return;
    }

    let alertsSent = 0;
    let alertsSkipped = 0;

    for (const goal of goals) {
      // Verifica se ja alertou hoje
      const startOfToday = new Date(now);
      startOfToday.setUTCHours(0, 0, 0, 0);
      const alreadySent = await this.prisma.notification.findFirst({
        where: {
          notification_type: 'goal_at_risk',
          created_at: { gte: startOfToday },
          // Filtro pelo goalId no JSON.data
          data: { path: ['goalId'], equals: goal.id },
        },
        select: { id: true },
      });
      if (alreadySent) {
        alertsSkipped++;
        continue;
      }

      // Calcula atingimento
      const realized = await this.goalsService.computeRealizedValue({
        tenantId: goal.tenant_id || undefined,
        year, month,
        lawyerId: goal.lawyer_id,
        kind: 'REALIZED',
      });
      const target = Number(goal.value);
      const progressPct = target > 0 ? (realized / target) * 100 : 0;

      if (progressPct >= 70) {
        // Acima de 70%, nao alerta
        continue;
      }

      // Define destinatarios
      const recipients = await this.getRecipients(goal.tenant_id, goal.lawyer_id);
      if (recipients.length === 0) continue;

      const scopeLabel = goal.lawyer_id
        ? `de ${goal.lawyer?.name || 'advogado'}`
        : 'do escritório';
      const title = `Meta do mês ${scopeLabel} em risco`;
      const body = `Faltam poucos dias e o atingimento está em ${progressPct.toFixed(1)}% (R$ ${realized.toLocaleString('pt-BR')} de R$ ${target.toLocaleString('pt-BR')}).`;

      // Bug fix 2026-05-10 (Honorarios PR4 #30):
      // Apos hardening tenant_id NOT NULL, qualquer goal legacy com
      // tenant_id null faria insert de Notification quebrar (FK).
      // Skip explicito + log warn pra Andre fazer backfill manual
      // se acontecer.
      if (!goal.tenant_id) {
        this.logger.warn(
          `[GOALS-ALERT] Goal ${goal.id} sem tenant_id — backfill necessario antes de alerta funcionar`,
        );
        alertsSkipped++;
        continue;
      }

      // Cria notificacao pra cada destinatario
      const ops = recipients.map((userId) =>
        this.prisma.notification.create({
          data: {
            user_id: userId,
            tenant_id: goal.tenant_id,
            notification_type: 'goal_at_risk',
            title,
            body,
            data: {
              goalId: goal.id,
              year, month,
              progressPct: +progressPct.toFixed(1),
              target,
              realized,
              scope: goal.lawyer_id ? 'LAWYER' : 'OFFICE',
              lawyerId: goal.lawyer_id,
            },
          },
        }),
      );
      await Promise.all(ops);
      alertsSent += recipients.length;
    }

    this.logger.log(
      `[GOALS-ALERT] Concluido: ${goals.length} meta(s) verificadas, ${alertsSent} notificacao(oes) enviadas, ${alertsSkipped} ja alertadas hoje.`,
    );
      },
      { description: 'Alerta de meta mensal em risco (dia 25+, atingimento <70%)', schedule: '0 9 * * *' },
    );
  }

  /**
   * Define destinatarios da alerta.
   * - Meta de escritorio: ADMIN + FINANCEIRO do tenant.
   * - Meta individual: ADMIN do tenant + o proprio advogado.
   */
  private async getRecipients(tenantId: string | null, lawyerId: string | null): Promise<string[]> {
    const recipients = new Set<string>();

    // Sempre notifica ADMIN/FINANCEIRO do tenant
    const admins = await this.prisma.user.findMany({
      where: {
        ...(tenantId ? { tenant_id: tenantId } : {}),
        roles: { hasSome: ['ADMIN', 'FINANCEIRO'] },
      },
      select: { id: true },
    });
    admins.forEach((u) => recipients.add(u.id));

    // Adiciona advogado especifico se a meta for individual
    if (lawyerId) recipients.add(lawyerId);

    return Array.from(recipients);
  }
}
