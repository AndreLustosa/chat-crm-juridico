import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CronRunnerService } from '../common/cron/cron-runner.service';

/**
 * Notificação de dívidas e recebíveis vencidos a cada 2 horas (horário comercial).
 * - Admin/Financeiro: vê tudo
 * - Advogado: vê apenas do seus processos
 * Notifica via WebSocket (toast no frontend).
 */
@Injectable()
export class OverdueAlertsService {
  private readonly logger = new Logger(OverdueAlertsService.name);

  constructor(
    private prisma: PrismaService,
    private cronRunner: CronRunnerService,
  ) {}

  /**
   * A cada 2 horas em horário comercial (8h, 10h, 12h, 14h, 16h, 18h) Seg-Sex
   */
  @Cron('0 8,10,12,14,16,18 * * 1-5', { timeZone: 'America/Maceio' })
  async checkOverdueItems() {
    await this.cronRunner.run(
      'financeiro-overdue-alerts',
      10 * 60,
      async () => {
      const now = new Date();

      // 1. Despesas pendentes vencidas
      const overdueDespesas = await this.prisma.financialTransaction.findMany({
        where: {
          type: 'DESPESA',
          status: 'PENDENTE',
          due_date: { lt: now },
        },
        select: { id: true, description: true, amount: true, due_date: true, lawyer_id: true, visible_to_lawyer: true },
      });

      // 2. Honorários pendentes/atrasados (recebíveis vencidos)
      const overdueHonorarios = await this.prisma.honorarioPayment.findMany({
        where: {
          status: { in: ['PENDENTE', 'ATRASADO'] },
          due_date: { lt: now, not: null },
        },
        select: {
          id: true, amount: true, due_date: true,
          honorario: {
            select: {
              type: true,
              legal_case: { select: { case_number: true, lawyer_id: true, lead: { select: { name: true } } } },
            },
          },
        },
      });

      const totalDespesasVencidas = overdueDespesas.reduce((s, d) => s + Number(d.amount), 0);
      const totalRecebiveisVencidos = overdueHonorarios.reduce((s, h) => s + Number(h.amount), 0);

      if (overdueDespesas.length === 0 && overdueHonorarios.length === 0) return;

      this.logger.log(
        `[OVERDUE] ${overdueDespesas.length} despesa(s) vencida(s) (R$ ${totalDespesasVencidas.toFixed(2)}) | ` +
        `${overdueHonorarios.length} recebível(is) vencido(s) (R$ ${totalRecebiveisVencidos.toFixed(2)})`,
      );

      // Criar registro de alerta no AuditLog para rastreabilidade
      await this.prisma.auditLog.create({
        data: {
          action: 'ALERTA_VENCIDOS',
          entity: 'FINANCEIRO',
          entity_id: 'sistema',
          meta_json: {
            despesas_vencidas: overdueDespesas.length,
            total_despesas: totalDespesasVencidas,
            recebiveis_vencidos: overdueHonorarios.length,
            total_recebiveis: totalRecebiveisVencidos,
            checked_at: now.toISOString(),
          },
        },
      });
      },
      { description: 'Audit-log de despesas/recebiveis vencidos a cada 2h (8h-18h)', schedule: '0 8,10,12,14,16,18 * * 1-5' },
    );
  }
}
