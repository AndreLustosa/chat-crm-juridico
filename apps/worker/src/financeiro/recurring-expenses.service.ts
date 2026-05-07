import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CronRunnerService } from '../common/cron/cron-runner.service';

@Injectable()
export class RecurringExpensesService {
  private readonly logger = new Logger(RecurringExpensesService.name);

  constructor(
    private prisma: PrismaService,
    private cronRunner: CronRunnerService,
  ) {}

  /**
   * Todo dia às 1h (Maceió): gera despesas recorrentes do mês.
   * Verifica transações-mãe com is_recurring=true e cria filhas se ainda não existem.
   */
  @Cron('0 1 * * *', { timeZone: 'America/Maceio' })
  async generateRecurringExpenses() {
    await this.cronRunner.run(
      'financeiro-recurring-expenses',
      15 * 60,
      async () => {
      const now = new Date();
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();

      // Buscar todas as transações recorrentes ativas
      const recurring = await this.prisma.financialTransaction.findMany({
        where: {
          is_recurring: true,
          status: { not: 'CANCELADO' },
        },
      });

      if (recurring.length === 0) return;

      this.logger.log(`[RECURRING] Verificando ${recurring.length} despesa(s) recorrente(s)`);

      let generated = 0;

      for (const parent of recurring) {
        // Verificar se já passou da data final de recorrência
        if (parent.recurrence_end_date && parent.recurrence_end_date < now) {
          continue;
        }

        // Calcular se deve gerar neste mês
        const shouldGenerate = this.shouldGenerateThisMonth(
          parent.recurrence_pattern,
          parent.created_at,
          currentMonth,
          currentYear,
        );
        if (!shouldGenerate) continue;

        // Verificar se já gerou filha neste mês
        const startOfMonth = new Date(currentYear, currentMonth, 1);
        const endOfMonth = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59);

        const existingChild = await this.prisma.financialTransaction.findFirst({
          where: {
            parent_transaction_id: parent.id,
            date: { gte: startOfMonth, lte: endOfMonth },
          },
        });

        if (existingChild) continue; // Já gerou este mês

        // Calcular data de vencimento
        const day = parent.recurrence_day || 1;
        const maxDay = new Date(currentYear, currentMonth + 1, 0).getDate();
        const dueDate = new Date(currentYear, currentMonth, Math.min(day, maxDay));

        // Criar filha
        await this.prisma.financialTransaction.create({
          data: {
            tenant_id: parent.tenant_id,
            type: parent.type,
            category: parent.category,
            description: parent.description,
            amount: parent.amount,
            date: dueDate,
            due_date: dueDate,
            payment_method: parent.payment_method,
            status: 'PENDENTE',
            visible_to_lawyer: parent.visible_to_lawyer,
            lawyer_id: parent.lawyer_id,
            legal_case_id: parent.legal_case_id,
            lead_id: parent.lead_id,
            notes: parent.notes,
            parent_transaction_id: parent.id,
            is_recurring: false,
          },
        });

        generated++;
        this.logger.log(
          `[RECURRING] Gerada: "${parent.description}" | R$ ${Number(parent.amount).toFixed(2)} | venc. ${dueDate.toLocaleDateString('pt-BR')}`,
        );
      }

      if (generated > 0) {
        this.logger.log(`[RECURRING] ${generated} despesa(s) recorrente(s) gerada(s) para ${currentMonth + 1}/${currentYear}`);
      }
      },
      { description: 'Gera despesas recorrentes do mes a partir de transacoes-mae (1h diario)', schedule: '0 1 * * *' },
    );
  }

  /**
   * Verifica se deve gerar transação neste mês baseado no padrão de recorrência.
   */
  private shouldGenerateThisMonth(
    pattern: string | null,
    createdAt: Date,
    currentMonth: number,
    currentYear: number,
  ): boolean {
    if (!pattern) return false;

    const createdMonth = createdAt.getMonth();
    const createdYear = createdAt.getFullYear();
    const monthsDiff = (currentYear - createdYear) * 12 + (currentMonth - createdMonth);

    switch (pattern) {
      case 'MENSAL':
        return monthsDiff >= 1;
      case 'TRIMESTRAL':
        return monthsDiff >= 3 && monthsDiff % 3 === 0;
      case 'SEMESTRAL':
        return monthsDiff >= 6 && monthsDiff % 6 === 0;
      case 'ANUAL':
        return monthsDiff >= 12 && monthsDiff % 12 === 0;
      default:
        return false;
    }
  }
}
