import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Avalia regras de alerta pos-sync. Cria/atualiza TrafficAlert com dedupe
 * diario (mesmo alerta nao dispara duas vezes no mesmo dia mesmo se sync
 * rodar varias vezes).
 *
 * Regras default (todas configuraveis em TrafficSettings):
 *   - HIGH_CPL          — CPL > target_cpl * (1 + cpl_alert_threshold)
 *   - LOW_CTR           — CTR < target_ctr * (1 - ctr_alert_threshold)
 *   - ZERO_CONVERSIONS  — campanha ENABLED com gasto > 0 e 0 conv (7d)
 *   - OVERSPEND         — gasto 7d > target_daily_budget * 7 * 1.20
 *   - PAUSED_BUT_SPENDING — campanha PAUSED com gasto nos ultimos 3 dias
 *   - NO_DATA           — conta sem novos dados ha mais de 2 dias
 *
 * Cada alerta tem `dedupe_key` (hash de kind + campaign_id + date_bucket).
 * @@unique no schema garante: tentar criar duplicado falha silenciosamente,
 * prefiro `upsert` aqui.
 */
@Injectable()
export class TrafegoAlertEvaluatorService {
  private readonly logger = new Logger(TrafegoAlertEvaluatorService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Avalia todas as regras pra uma conta. Retorna IDs dos alertas criados
   * (novos ou atualizados) — quem chama pode passar pro Notifier.
   */
  async evaluateForAccount(accountId: string): Promise<string[]> {
    const account = await this.prisma.trafficAccount.findUnique({
      where: { id: accountId },
    });
    if (!account || account.status !== 'ACTIVE') {
      return [];
    }

    const settings = await this.prisma.trafficSettings.findUnique({
      where: { tenant_id: account.tenant_id },
    });
    if (!settings) {
      this.logger.warn(
        `[ALERT_EVAL] Tenant ${account.tenant_id} sem TrafficSettings — usando defaults`,
      );
    }

    // Defaults caso settings vazia
    const targetCplMicros = settings?.target_cpl_micros ?? 50_000_000n; // R$ 50
    const targetCtr = Number(settings?.target_ctr ?? 0.03);
    const cplThreshold = Number(settings?.cpl_alert_threshold ?? 0.30);
    const ctrThreshold = Number(settings?.ctr_alert_threshold ?? 0.30);
    const windowDays = settings?.alert_window_days ?? 7;
    const targetDailyBudget = settings?.target_daily_budget_micros ?? null;

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const dateBucket = today.toISOString().slice(0, 10); // YYYY-MM-DD pra dedupe

    const windowStart = new Date(today);
    windowStart.setUTCDate(windowStart.getUTCDate() - windowDays);

    const threeDaysAgo = new Date(today);
    threeDaysAgo.setUTCDate(threeDaysAgo.getUTCDate() - 3);

    const newAlertIds: string[] = [];

    // ─── Pre-fetch: campanhas + agregados por campanha na janela ───────
    const [campaigns, perCampaignAgg] = await Promise.all([
      this.prisma.trafficCampaign.findMany({
        where: { account_id: account.id, is_archived_internal: false },
      }),
      this.prisma.trafficMetricDaily.groupBy({
        by: ['campaign_id'],
        where: { account_id: account.id, date: { gte: windowStart } },
        _sum: {
          cost_micros: true,
          impressions: true,
          clicks: true,
          conversions: true,
        },
      }),
    ]);

    const aggByCampaign = new Map(
      perCampaignAgg.map((a) => [a.campaign_id, a]),
    );

    // ─── Regra 1+2+3: por campanha ─────────────────────────────────────
    for (const c of campaigns) {
      const agg = aggByCampaign.get(c.id);
      if (!agg) continue; // campanha sem dados na janela — pula

      const cost = Number(agg._sum.cost_micros ?? 0);
      const clicks = Number(agg._sum.clicks ?? 0);
      const impressions = Number(agg._sum.impressions ?? 0);
      const conversions = Number(agg._sum.conversions ?? 0);

      const cpl = conversions > 0 ? cost / conversions : 0;
      const ctr = impressions > 0 ? clicks / impressions : 0;

      // ─── HIGH_CPL ───
      if (conversions >= 1 && cpl > Number(targetCplMicros) * (1 + cplThreshold)) {
        const cplBrl = (cpl / 1_000_000).toFixed(2);
        const targetBrl = (Number(targetCplMicros) / 1_000_000).toFixed(2);
        const id = await this.upsertAlert({
          tenantId: account.tenant_id,
          accountId: account.id,
          campaignId: c.id,
          kind: 'HIGH_CPL',
          severity: 'WARNING',
          message: `CPL da campanha "${c.name}" está em R$ ${cplBrl} (meta: R$ ${targetBrl}, +${Math.round(((cpl / Number(targetCplMicros)) - 1) * 100)}%)`,
          context: {
            campaign_name: c.name,
            cpl_brl: cpl / 1_000_000,
            target_cpl_brl: Number(targetCplMicros) / 1_000_000,
            window_days: windowDays,
          },
          dateBucket,
        });
        if (id) newAlertIds.push(id);
      }

      // ─── LOW_CTR ───
      if (impressions >= 100 && ctr < targetCtr * (1 - ctrThreshold)) {
        const ctrPct = (ctr * 100).toFixed(2);
        const targetPct = (targetCtr * 100).toFixed(2);
        const id = await this.upsertAlert({
          tenantId: account.tenant_id,
          accountId: account.id,
          campaignId: c.id,
          kind: 'LOW_CTR',
          severity: 'WARNING',
          message: `CTR da campanha "${c.name}" está em ${ctrPct}% (meta: ${targetPct}%)`,
          context: {
            campaign_name: c.name,
            ctr,
            target_ctr: targetCtr,
            impressions,
            clicks,
            window_days: windowDays,
          },
          dateBucket,
        });
        if (id) newAlertIds.push(id);
      }

      // ─── ZERO_CONVERSIONS ───
      // Campanha ENABLED com gasto significativo (>R$ 50) e 0 conversoes
      if (
        c.status === 'ENABLED' &&
        cost > 50_000_000 && // R$ 50 em micros
        conversions === 0
      ) {
        const costBrl = (cost / 1_000_000).toFixed(2);
        const id = await this.upsertAlert({
          tenantId: account.tenant_id,
          accountId: account.id,
          campaignId: c.id,
          kind: 'ZERO_CONVERSIONS',
          severity: 'WARNING',
          message: `Campanha "${c.name}" gastou R$ ${costBrl} sem nenhuma conversão nos últimos ${windowDays} dias`,
          context: {
            campaign_name: c.name,
            cost_brl: cost / 1_000_000,
            window_days: windowDays,
          },
          dateBucket,
        });
        if (id) newAlertIds.push(id);
      }
    }

    // ─── Regra 4: OVERSPEND (conta inteira) ────────────────────────────
    if (targetDailyBudget) {
      const totalAgg = await this.prisma.trafficMetricDaily.aggregate({
        where: { account_id: account.id, date: { gte: windowStart } },
        _sum: { cost_micros: true },
      });
      const total = Number(totalAgg._sum.cost_micros ?? 0);
      const expectedMax = Number(targetDailyBudget) * windowDays * 1.20;
      if (total > expectedMax) {
        const totalBrl = (total / 1_000_000).toFixed(2);
        const expectedBrl = (expectedMax / 1_000_000).toFixed(2);
        const id = await this.upsertAlert({
          tenantId: account.tenant_id,
          accountId: account.id,
          campaignId: null,
          kind: 'OVERSPEND',
          severity: 'CRITICAL',
          message: `Gasto total de R$ ${totalBrl} nos últimos ${windowDays} dias está acima do esperado (R$ ${expectedBrl} = orçamento × 120%)`,
          context: {
            total_brl: total / 1_000_000,
            expected_max_brl: expectedMax / 1_000_000,
            window_days: windowDays,
          },
          dateBucket,
        });
        if (id) newAlertIds.push(id);
      }
    }

    // ─── Regra 5: PAUSED_BUT_SPENDING (3 dias) ─────────────────────────
    const recentSpendByCampaign = await this.prisma.trafficMetricDaily.groupBy({
      by: ['campaign_id'],
      where: {
        account_id: account.id,
        date: { gte: threeDaysAgo },
        cost_micros: { gt: 0n },
      },
      _sum: { cost_micros: true },
    });
    const recentSpendMap = new Map(
      recentSpendByCampaign.map((r) => [r.campaign_id, r]),
    );
    for (const c of campaigns) {
      if (c.status !== 'PAUSED') continue;
      const spent = recentSpendMap.get(c.id);
      if (!spent || !spent._sum.cost_micros) continue;
      const cost = Number(spent._sum.cost_micros);
      if (cost <= 0) continue;
      const costBrl = (cost / 1_000_000).toFixed(2);
      const id = await this.upsertAlert({
        tenantId: account.tenant_id,
        accountId: account.id,
        campaignId: c.id,
        kind: 'PAUSED_BUT_SPENDING',
        severity: 'WARNING',
        message: `Campanha pausada "${c.name}" teve gasto de R$ ${costBrl} nos últimos 3 dias — verifique`,
        context: {
          campaign_name: c.name,
          cost_brl: cost / 1_000_000,
          status: 'PAUSED',
        },
        dateBucket,
      });
      if (id) newAlertIds.push(id);
    }

    // ─── Regra 6: NO_DATA (conta sem dados ha 2+ dias) ─────────────────
    const lastMetric = await this.prisma.trafficMetricDaily.findFirst({
      where: { account_id: account.id },
      orderBy: { date: 'desc' },
      select: { date: true },
    });
    if (lastMetric) {
      const daysSince = Math.floor(
        (today.getTime() - lastMetric.date.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (daysSince > 2) {
        const id = await this.upsertAlert({
          tenantId: account.tenant_id,
          accountId: account.id,
          campaignId: null,
          kind: 'NO_DATA',
          severity: 'CRITICAL',
          message: `Conta sem dados novos há ${daysSince} dias. Último dado: ${lastMetric.date.toISOString().slice(0, 10)}`,
          context: { last_data_date: lastMetric.date.toISOString().slice(0, 10), days_since: daysSince },
          dateBucket,
        });
        if (id) newAlertIds.push(id);
      }
    }

    if (newAlertIds.length > 0) {
      this.logger.log(
        `[ALERT_EVAL] Conta ${account.id}: ${newAlertIds.length} alerta(s) novo(s)/reabertos`,
      );
    }

    return newAlertIds;
  }

  /**
   * Upsert idempotente de alerta. Usa dedupe_key (kind + campaign_id +
   * date_bucket) — mesmo alerta no mesmo dia nao gera duplicado.
   *
   * Comportamento:
   *   - Se ja existe alerta com esse dedupe_key e status='OPEN' → atualiza
   *     mensagem/context (caso valores mudem ao longo do dia) e mantem.
   *     Retorna null (nao eh "novo" — nao notifica de novo).
   *   - Se ja existe e status='ACKNOWLEDGED'/'RESOLVED'/'MUTED' → nao
   *     reabre. Retorna null.
   *   - Se nao existe → cria novo, retorna id pra notificar.
   */
  private async upsertAlert(params: {
    tenantId: string;
    accountId: string;
    campaignId: string | null;
    kind: string;
    severity: 'INFO' | 'WARNING' | 'CRITICAL';
    message: string;
    context: Record<string, any>;
    dateBucket: string;
  }): Promise<string | null> {
    const dedupeKey = crypto
      .createHash('sha256')
      .update(
        `${params.kind}|${params.campaignId ?? 'account'}|${params.dateBucket}`,
      )
      .digest('hex')
      .slice(0, 32);

    const existing = await this.prisma.trafficAlert.findUnique({
      where: { dedupe_key: dedupeKey },
    });

    if (existing) {
      // Se ainda OPEN, atualiza valores. Senao, mantem (admin ja reagiu).
      if (existing.status === 'OPEN') {
        await this.prisma.trafficAlert.update({
          where: { id: existing.id },
          data: { message: params.message, context: params.context },
        });
      }
      return null; // nao eh novo, nao notifica
    }

    const created = await this.prisma.trafficAlert.create({
      data: {
        tenant_id: params.tenantId,
        account_id: params.accountId,
        campaign_id: params.campaignId,
        kind: params.kind,
        severity: params.severity,
        message: params.message,
        context: params.context,
        dedupe_key: dedupeKey,
        status: 'OPEN',
      },
    });
    return created.id;
  }
}
