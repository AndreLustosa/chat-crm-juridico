import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TrafficAIAgentService } from './traffic-ai-agent.service';
import { CronRunnerService } from '../common/cron/cron-runner.service';

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
    private cronRunner: CronRunnerService,
  ) {}

  // 06:30 daily — começo do dia comercial em Maceió
  @Cron('30 6 * * *', { timeZone: 'America/Maceio' })
  async runDaily() {
    await this.cronRunner.run(
      'trafego-ai-agent-daily',
      45 * 60,
      async () => {
        await this.runForAllEnabledAccounts('DAILY', (id) =>
          this.agent.runDailyLoop(id),
        );
      },
      { description: 'Loop diario do agente IA de Trafego (06:30)', schedule: '30 6 * * *' },
    );
  }

  // Segunda 09:00 — reflexão semanal
  @Cron('0 9 * * 1', { timeZone: 'America/Maceio' })
  async runWeekly() {
    await this.cronRunner.run(
      'trafego-ai-agent-weekly',
      45 * 60,
      async () => {
        await this.runForAllEnabledAccounts('WEEKLY', (id) =>
          this.agent.runWeeklyLoop(id),
        );
      },
      { description: 'Reflexao semanal do agente IA de Trafego (segunda 09h)', schedule: '0 9 * * 1' },
    );
  }

  // Dia 1 do mês 09:00 — fechamento mensal
  @Cron('0 9 1 * *', { timeZone: 'America/Maceio' })
  async runMonthly() {
    await this.cronRunner.run(
      'trafego-ai-agent-monthly',
      45 * 60,
      async () => {
        await this.runForAllEnabledAccounts('MONTHLY', (id) =>
          this.agent.runMonthlyLoop(id),
        );
      },
      { description: 'Fechamento mensal do agente IA de Trafego (dia 1, 09h)', schedule: '0 9 1 * *' },
    );
  }

  // :17 de cada hora — só pra contas com hourly_enabled=true (opt-in)
  @Cron('17 * * * *', { timeZone: 'America/Maceio' })
  async runHourly() {
    await this.cronRunner.run(
      'trafego-ai-agent-hourly',
      15 * 60,
      async () => {
        await this.runForAllEnabledAccounts(
          'HOURLY',
          (id) => this.agent.runHourlyLoop(id),
          { onlyHourlyEnabled: true },
        );
      },
      { description: 'Loop horario opt-in do agente IA de Trafego (:17 de cada hora)', schedule: '17 * * * *' },
    );
  }

  /**
   * Sprint G.2 — Escalation diário 22:00 Maceió.
   * Varre TrafficIADecision com action=SUGGEST + human_feedback=null e:
   *   - Após `escalation_hours` (default 48h) sem resposta, conta strike +1
   *   - Após `max_resuggestion_strikes` (default 3) sem resposta,
   *     auto-marca como IGNORED com nota "expirou sem feedback"
   *   - A re-sugestão da mesma kind+resource_id no próximo loop fica
   *     suprimida pelo cooldown IGNORED (G.1)
   */
  @Cron('0 22 * * *', { timeZone: 'America/Maceio' })
  async runEscalation() {
    await this.cronRunner.run(
      'trafego-ai-agent-escalation',
      30 * 60,
      async () => {
        await this.runForAllEnabledAccounts('ESCALATION', (id) =>
          this.agent.escalateOrAutoIgnore(id),
        );
      },
      { description: 'Escalation diario (22h): conta strikes em decisoes IA sem feedback', schedule: '0 22 * * *' },
    );
  }

  /**
   * Feature flag global pra desligar a IA interna do trafego sem precisar
   * remover crons. Quando false, todos os loops do agente sao no-op.
   * Default true (preserva comportamento atual). Desliga em prod via env
   * `TRAFEGO_IA_INTERNA_ENABLED=false` quando o Claude (Cowork via MCP)
   * assumir a gestao.
   * Detalhes: docs/mcp-server/fase-0-descoberta.md §10 (decisao do usuario).
   */
  private isIaInternaEnabled(): boolean {
    const raw = (process.env.TRAFEGO_IA_INTERNA_ENABLED ?? '').trim().toLowerCase();
    if (raw === '') return true;
    return !['false', '0', 'no', 'off'].includes(raw);
  }

  /**
   * Itera contas ACTIVE com agent_enabled=true (e hourly_enabled=true se filtro
   * extra for pedido) e executa o loop. Erros são logados mas não bloqueiam.
   *
   * Honra `TRAFEGO_IA_INTERNA_ENABLED` — quando false, retorna sem rodar nada.
   * Cron ainda dispara (pra nao perder agendamento se voltarmos a ativar)
   * mas o loop interno eh skip silencioso (log informativo).
   */
  private async runForAllEnabledAccounts(
    label: string,
    runner: (accountId: string) => Promise<unknown>,
    opts: { onlyHourlyEnabled?: boolean } = {},
  ) {
    if (!this.isIaInternaEnabled()) {
      this.logger.log(
        `[ai-agent-cron:${label}] IA interna desativada (TRAFEGO_IA_INTERNA_ENABLED=false) — skip`,
      );
      return;
    }

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
