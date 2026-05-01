import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Avalia regras de alerta pos-sync. Cria/atualiza TrafficAlert com dedupe
 * diario (mesmo alerta nao dispara duas vezes no mesmo dia mesmo se sync
 * rodar varias vezes).
 *
 * Regras default (todas configuraveis em TrafficSettings):
 *   - HIGH_CPL                 — CPL > target_cpl * (1 + cpl_alert_threshold)
 *   - LOW_CTR                  — CTR < target_ctr * (1 - ctr_alert_threshold)
 *   - ZERO_CONVERSIONS         — campanha ENABLED com gasto > R$50 e 0 conv (7d)
 *   - OVERSPEND                — gasto 7d > target_daily_budget * 7 * 1.20
 *   - PAUSED_BUT_SPENDING      — campanha PAUSED com gasto nos ultimos 3 dias
 *   - NO_DATA                  — conta sem novos dados ha mais de 2 dias
 *   - NO_LEADS_2D              — sync OK mas zero conversoes em 2 dias
 *   - DAILY_HIGH_SPEND_NO_CONV — campanha com gasto > R$20 hoje e 0 conv hoje
 *   - CTR_DROP                 — CTR semana atual < 70% da semana anterior
 *   - BUDGET_DEPLETED_EARLY    — orcamento >=95% gasto antes das 14h Maceio
 *   - LOW_QUALITY_SCORE        — keyword ativa com quality_score < 5
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

    // ─── Regra 7: NO_LEADS_2D ─────────────────────────────────────────
    // Conta sincronizando normalmente mas sem nenhuma conversao nos
    // ultimos 2 dias. Diferente de NO_DATA — aqui sync esta OK.
    const twoDaysAgo = new Date(today);
    twoDaysAgo.setUTCDate(twoDaysAgo.getUTCDate() - 2);
    const last2dAgg = await this.prisma.trafficMetricDaily.aggregate({
      where: { account_id: account.id, date: { gte: twoDaysAgo } },
      _sum: { conversions: true, cost_micros: true },
    });
    const conv2d = Number(last2dAgg._sum.conversions ?? 0);
    const cost2d = Number(last2dAgg._sum.cost_micros ?? 0);
    if (conv2d === 0 && cost2d > 10_000_000) {
      // Gasto > R$10 mas zero leads — ai sim vale alertar (sem gasto pode
      // ser fim de semana / pausada / orçamento estourado de outro).
      const cost2dBrl = (cost2d / 1_000_000).toFixed(2);
      const id = await this.upsertAlert({
        tenantId: account.tenant_id,
        accountId: account.id,
        campaignId: null,
        kind: 'NO_LEADS_2D',
        severity: 'WARNING',
        message: `Sem novos leads há 2 dias (gasto R$ ${cost2dBrl}). Verifique conversion tracking ou ofertas das campanhas.`,
        context: {
          conv_2d: conv2d,
          cost_2d_brl: cost2d / 1_000_000,
        },
        dateBucket,
      });
      if (id) newAlertIds.push(id);
    }

    // ─── Regra 8: DAILY_HIGH_SPEND_NO_CONV ────────────────────────────
    // Campanha gastou > R$20 HOJE e zero conversões. Dispara cedo (vs
    // ZERO_CONVERSIONS que aguarda 7d) — útil pra reagir rápido a ad
    // disapproved silenciosamente ou keyword off-topic em fim de semana.
    const todayPerCampaign = await this.prisma.trafficMetricDaily.groupBy({
      by: ['campaign_id'],
      where: { account_id: account.id, date: today },
      _sum: { cost_micros: true, conversions: true },
    });
    for (const agg of todayPerCampaign) {
      const cost = Number(agg._sum.cost_micros ?? 0);
      const conv = Number(agg._sum.conversions ?? 0);
      if (cost > 20_000_000 && conv === 0) {
        const c = campaigns.find((x) => x.id === agg.campaign_id);
        if (!c || c.status !== 'ENABLED') continue;
        const costBrl = (cost / 1_000_000).toFixed(2);
        const id = await this.upsertAlert({
          tenantId: account.tenant_id,
          accountId: account.id,
          campaignId: c.id,
          kind: 'DAILY_HIGH_SPEND_NO_CONV',
          severity: 'WARNING',
          message: `"${c.name}" gastou R$ ${costBrl} hoje sem nenhuma conversão`,
          context: {
            campaign_name: c.name,
            cost_brl: cost / 1_000_000,
          },
          dateBucket,
        });
        if (id) newAlertIds.push(id);
      }
    }

    // ─── Regra 9: CTR_DROP ─────────────────────────────────────────────
    // CTR da semana atual < 70% do CTR da semana anterior (queda > 30%).
    // Compara janela 7d atual vs 7d-14d anterior. Só dispara com >= 500
    // impressions em cada janela pra evitar falso-positivo de campanha
    // pequena.
    const fourteenDaysAgo = new Date(today);
    fourteenDaysAgo.setUTCDate(fourteenDaysAgo.getUTCDate() - 14);
    for (const c of campaigns) {
      if (c.status !== 'ENABLED') continue;
      const [thisWeek, prevWeek] = await Promise.all([
        this.prisma.trafficMetricDaily.aggregate({
          where: {
            campaign_id: c.id,
            date: { gte: windowStart, lt: today },
          },
          _sum: { impressions: true, clicks: true },
        }),
        this.prisma.trafficMetricDaily.aggregate({
          where: {
            campaign_id: c.id,
            date: { gte: fourteenDaysAgo, lt: windowStart },
          },
          _sum: { impressions: true, clicks: true },
        }),
      ]);
      const thisImp = Number(thisWeek._sum.impressions ?? 0);
      const thisClk = Number(thisWeek._sum.clicks ?? 0);
      const prevImp = Number(prevWeek._sum.impressions ?? 0);
      const prevClk = Number(prevWeek._sum.clicks ?? 0);
      if (thisImp < 500 || prevImp < 500) continue;
      const thisCtr = thisClk / thisImp;
      const prevCtr = prevClk / prevImp;
      if (prevCtr === 0) continue;
      const drop = (prevCtr - thisCtr) / prevCtr;
      if (drop >= 0.30) {
        const id = await this.upsertAlert({
          tenantId: account.tenant_id,
          accountId: account.id,
          campaignId: c.id,
          kind: 'CTR_DROP',
          severity: 'WARNING',
          message: `CTR de "${c.name}" caiu ${(drop * 100).toFixed(0)}% (de ${(prevCtr * 100).toFixed(2)}% pra ${(thisCtr * 100).toFixed(2)}%)`,
          context: {
            campaign_name: c.name,
            this_ctr: thisCtr,
            prev_ctr: prevCtr,
            drop_pct: drop,
          },
          dateBucket,
        });
        if (id) newAlertIds.push(id);
      }
    }

    // ─── Regra 10: BUDGET_DEPLETED_EARLY ──────────────────────────────
    // Orçamento esgotou antes das 14h Maceió (UTC-3) — campanha vai
    // ficar offline o resto do dia, perdendo demanda.
    // Só roda se alert estiver sendo avaliado depois das 14h Maceió;
    // antes disso o sinal não é confiável (pode só estar no início do dia).
    const nowMaceio = new Date(Date.now() - 3 * 3600 * 1000); // UTC-3
    if (nowMaceio.getUTCHours() >= 14) {
      for (const c of campaigns) {
        if (c.status !== 'ENABLED' || !c.daily_budget_micros) continue;
        const todaySpent = todayPerCampaign.find(
          (a) => a.campaign_id === c.id,
        );
        if (!todaySpent) continue;
        const spent = Number(todaySpent._sum.cost_micros ?? 0);
        const budget = Number(c.daily_budget_micros);
        if (budget > 0 && spent >= budget * 0.95) {
          const spentBrl = (spent / 1_000_000).toFixed(2);
          const budgetBrl = (budget / 1_000_000).toFixed(2);
          const id = await this.upsertAlert({
            tenantId: account.tenant_id,
            accountId: account.id,
            campaignId: c.id,
            kind: 'BUDGET_DEPLETED_EARLY',
            severity: 'CRITICAL',
            message: `"${c.name}" esgotou o orçamento (R$ ${spentBrl} / R$ ${budgetBrl}) antes das 14h — perdendo impressões`,
            context: {
              campaign_name: c.name,
              spent_brl: spent / 1_000_000,
              budget_brl: budget / 1_000_000,
              hour_maceio: nowMaceio.getUTCHours(),
            },
            dateBucket,
          });
          if (id) newAlertIds.push(id);
        }
      }
    }

    // ─── Regra 11: LOW_QUALITY_SCORE ──────────────────────────────────
    // Keywords ativas com QS < 5. Agrupa por campanha pra evitar alert
    // spam (1 alerta/campanha listando até 5 piores keywords).
    const lowQsKeywords = await this.prisma.trafficKeyword.findMany({
      where: {
        account_id: account.id,
        negative: false,
        status: 'ENABLED',
        quality_score: { lt: 5 },
      },
      orderBy: { quality_score: 'asc' },
      take: 50,
      select: {
        id: true,
        text: true,
        quality_score: true,
        ad_group: { select: { campaign_id: true, name: true } },
      },
    });
    const byCampaign = new Map<
      string,
      Array<{ text: string; qs: number | null; ad_group_name: string }>
    >();
    for (const kw of lowQsKeywords) {
      const cid = kw.ad_group?.campaign_id;
      if (!cid) continue;
      const arr = byCampaign.get(cid) ?? [];
      if (arr.length < 5) {
        arr.push({
          text: kw.text,
          qs: kw.quality_score,
          ad_group_name: kw.ad_group.name,
        });
      }
      byCampaign.set(cid, arr);
    }
    for (const [campaignId, keywords] of byCampaign) {
      const c = campaigns.find((x) => x.id === campaignId);
      if (!c) continue;
      const sample = keywords
        .map((k) => `"${k.text}" (QS ${k.qs ?? '?'})`)
        .join(', ');
      const id = await this.upsertAlert({
        tenantId: account.tenant_id,
        accountId: account.id,
        campaignId: c.id,
        kind: 'LOW_QUALITY_SCORE',
        severity: 'INFO',
        message: `${keywords.length} palavra(s)-chave de "${c.name}" com QS < 5: ${sample}`,
        context: {
          campaign_name: c.name,
          keywords_count: keywords.length,
          sample: keywords,
        },
        dateBucket,
      });
      if (id) newAlertIds.push(id);
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
