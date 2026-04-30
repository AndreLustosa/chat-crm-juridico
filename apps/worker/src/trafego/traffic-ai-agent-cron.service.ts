import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TrafficAIAgentService } from './traffic-ai-agent.service';

/**
 * Orquestra os loops do TrafficAIAgentService por cron.
 *
 * Schedules (timezone America/Maceio — pra alinhar com horário comercial):
 *   - Daily   06:30  →  análise diária + sugestões pra o admin abrir o dia
 *   - Weekly  Mon 09:00  →  reflexão semanal (overspend, budget exhausted)
 *   - Monthly day-1 09:00  →  fechamento mensal (gera relatório)
 *   - Hourly  :17  →  só roda se policy.hourly_enabled=true (alertas em
 *                     tempo quase-real, ex: gasto disparado mid-day)
 *
 * Para cada conta ACTIVE com policy.agent_enabled=true, dispara o loop.
 * Erros em uma conta NÃO bloqueiam as outras (try/catch isolado).
 *
 * NOTA: este service NÃO usa BullMQ — chama o TrafficAIAgentService inline.
 * Justificativa: cargas pequenas (1-30 contas) e isolamento por try/catch
 * já é suficiente. Se um dia o tenant escalar pra centenas de contas,
 * migrar pra fila própria 'trafego-ai-agent'.
 */
@Injectable()
export class TrafficAIAgentCronService {
  private readonly logger = new Logger(TrafficAIAgentCronService.name);

  constructor(
    private prisma: PrismaService,
    private agent: TrafficAIAgentService,
  ) {}

  // 06:30 daily — começo do dia comercial em Maceió
  @Cron('30 6 * * *', { timeZone: 'America/Maceio' })
  async runDaily() {
    await this.runForAllEnabledAccounts('DAILY', (id) =>
      this.agent.runDailyLoop(id),
    );
  }

  // Segunda 09:00 — reflexão semanal
  @Cron('0 9 * * 1', { timeZone: 'America/Maceio' })
  async runWeekly() {
    await this.runForAllEnabledAccounts('WEEKLY', (id) =>
      this.agent.runWeeklyLoop(id),
    );
  }

  // Dia 1 do mês 09:00 — fechamento mensal
  @Cron('0 9 1 * *', { timeZone: 'America/Maceio' })
  async runMonthly() {
    await this.runForAllEnabledAccounts('MONTHLY', (id) =>
      this.agent.runMonthlyLoop(id),
    );
  }

  // :17 de cada hora — só pra contas com hourly_enabled=true (opt-in)
  @Cron('17 * * * *', { timeZone: 'America/Maceio' })
  async runHourly() {
    await this.runForAllEnabledAccounts(
      'HOURLY',
      (id) => this.agent.runHourlyLoop(id),
      { onlyHourlyEnabled: true },
    );
  }

  /**
   * Itera contas ACTIVE com agent_enabled=true (e hourly_enabled=true se filtro
   * extra for pedido) e executa o loop. Erros são logados mas não bloqueiam.
   */
  private async runForAllEnabledAccounts(
    label: string,
    runner: (accountId: string) => Promise<unknown>,
    opts: { onlyHourlyEnabled?: boolean } = {},
  ) {
    const accounts = await this.prisma.trafficAccount.findMany({
      where: {
        status: 'ACTIVE',
        tenant: {
          traffic_ia_policy: {
            agent_enabled: true,
            ...(opts.onlyHourlyEnabled ? { hourly_enabled: true } : {}),
          },
        },
      },
      select: { id: true, customer_id: true },
    });

    if (accounts.length === 0) {
      this.logger.log(`[ai-agent-cron:${label}] sem contas elegíveis — skip`);
      return;
    }

    this.logger.log(
      `[ai-agent-cron:${label}] iniciando p/ ${accounts.length} conta(s)`,
    );

    let ok = 0;
    let fail = 0;
    for (const acc of accounts) {
      try {
        await runner(acc.id);
        ok++;
      } catch (err: any) {
        fail++;
        this.logger.error(
          `[ai-agent-cron:${label}] account=${acc.id} customer=${acc.customer_id} falhou: ${err?.message ?? err}`,
        );
      }
    }
    this.logger.log(
      `[ai-agent-cron:${label}] done ok=${ok} fail=${fail}`,
    );
  }
}
