import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleAdsMutateService } from './google-ads-mutate.service';
import { TrafegoAlertNotifierService } from './trafego-alert-notifier.service';
import { TrafficLLMService } from './traffic-llm.service';
import { Prisma } from '@prisma/client';

/**
 * TrafficAIAgentService — IA gestora de tráfego.
 *
 * Filosofia: humano-no-loop, não humano-no-comando.
 *
 * Cada loop (DAILY/WEEKLY/MONTHLY/HOURLY/TRIGGERED):
 *   1. Coleta contexto (campanhas, métricas, alertas, política, memória)
 *   2. Aplica REGRAS DETERMINÍSTICAS pra gerar decisões candidatas
 *      (LLM-based search term classification fica em service separado, plugado em fase 2)
 *   3. Cada decisão passa por filtros: OAB → daily limit → confidence → type-toggle
 *   4. Action final: EXECUTE | SUGGEST | BLOCK | NOTIFY_ONLY
 *   5. Persiste em TrafficIADecision (auditoria perpétua)
 *   6. Notifica humano (in-app, email, whatsapp via canais já existentes)
 *
 * Modo ADVISOR (default): nunca executa, só sugere.
 * Modo AUTONOMOUS: executa quando confidence >= min_confidence_for_auto E
 *   o toggle específico (auto_apply_*) está ligado.
 *
 * Shadow mode (default ON nos primeiros 14d): IA "decide" mas action vira
 *   NOTIFY_ONLY mesmo em AUTONOMOUS. Pra calibrar antes de soltar.
 */
@Injectable()
export class TrafficAIAgentService {
  private readonly logger = new Logger(TrafficAIAgentService.name);

  constructor(
    private prisma: PrismaService,
    private mutate: GoogleAdsMutateService,
    private notifier: TrafegoAlertNotifierService,
    private llm: TrafficLLMService,
  ) {}

  // ──────────────────────────────────────────────────────────────────────
  // Entry points (chamados pelo orchestrator/cron ou via trigger manual)
  // ──────────────────────────────────────────────────────────────────────

  async runDailyLoop(accountId: string): Promise<LoopReport> {
    return this.runLoop(accountId, 'DAILY');
  }
  async runWeeklyLoop(accountId: string): Promise<LoopReport> {
    // Sprint G.3 — antes do loop padrão, deixa LLM classificar search terms
    // ruins (cria candidates ADD_NEGATIVE_KEYWORD que entram no diagnose
    // via lookup determinístico no próximo passo).
    try {
      await this.llm.classifyBadSearchTerms(accountId);
    } catch (err: any) {
      this.logger.warn(
        `[ai-agent] llm.classifyBadSearchTerms falhou (account=${accountId}): ${err?.message ?? err}`,
      );
    }
    return this.runLoop(accountId, 'WEEKLY');
  }
  async runMonthlyLoop(accountId: string): Promise<LoopReport> {
    return this.runLoop(accountId, 'MONTHLY');
  }
  async runHourlyLoop(accountId: string): Promise<LoopReport> {
    return this.runLoop(accountId, 'HOURLY');
  }
  /** Trigger manual via UI ("Avaliar agora"). */
  async runTriggered(accountId: string): Promise<LoopReport> {
    return this.runLoop(accountId, 'TRIGGERED');
  }

  // ──────────────────────────────────────────────────────────────────────
  // Loop pipeline
  // ──────────────────────────────────────────────────────────────────────

  private async runLoop(
    accountId: string,
    loopKind: LoopKind,
  ): Promise<LoopReport> {
    const t0 = Date.now();
    const ctx = await this.buildContext(accountId);
    if (!ctx) {
      this.logger.warn(`[ai-agent] account ${accountId} sem contexto válido — skip`);
      return emptyReport(accountId, loopKind);
    }
    if (!ctx.policy.agent_enabled) {
      this.logger.log(
        `[ai-agent] account ${accountId} policy.agent_enabled=false — skip`,
      );
      return emptyReport(accountId, loopKind);
    }

    const rawCandidates = await this.diagnose(ctx, loopKind);
    // Memória adaptativa (Sprint G.1): suprime IGNORED em cooldown,
    // penaliza REVERTED, reforça APPROVED, conta strikes de re-sugestão.
    const candidates: DecisionCandidate[] = [];
    let suppressedByMemory = 0;
    for (const cand of rawCandidates) {
      const filtered = this.applyMemoryFilter(cand, ctx);
      if (filtered) candidates.push(filtered);
      else suppressedByMemory++;
    }

    const persisted: PersistedDecision[] = [];
    let executed = 0;
    let suggested = 0;
    let blocked = 0;
    let failed = 0;

    for (const cand of candidates) {
      const decided = await this.evaluateAndExecute(cand, ctx, loopKind);
      persisted.push(decided);
      switch (decided.action) {
        case 'EXECUTE':
          executed++;
          break;
        case 'SUGGEST':
          suggested++;
          break;
        case 'BLOCK':
          blocked++;
          break;
        case 'FAILED':
          failed++;
          break;
      }
    }

    await this.persistMemory(ctx, loopKind, persisted);
    if (persisted.length > 0) {
      await this.notifyHuman(ctx, loopKind, persisted);
    }

    const durationMs = Date.now() - t0;
    this.logger.log(
      `[ai-agent] loop=${loopKind} account=${accountId} ` +
        `decisions=${persisted.length} exec=${executed} sug=${suggested} ` +
        `blocked=${blocked} failed=${failed} ` +
        `suppressed_by_memory=${suppressedByMemory} (${durationMs}ms)`,
    );

    return {
      accountId,
      loopKind,
      durationMs,
      decisions: persisted.length,
      executed,
      suggested,
      blocked,
      failed,
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Context (snapshot dos dados que alimentam diagnóstico)
  // ──────────────────────────────────────────────────────────────────────

  private async buildContext(accountId: string): Promise<AgentContext | null> {
    const account = await this.prisma.trafficAccount.findUnique({
      where: { id: accountId },
    });
    if (!account || account.status !== 'ACTIVE') return null;

    const policy = await this.ensurePolicy(account.tenant_id);

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);

    const [campaigns, metrics7d, metrics30d, openAlerts, settings, ads] =
      await Promise.all([
        this.prisma.trafficCampaign.findMany({
          where: { account_id: accountId, is_archived_internal: false },
        }),
        this.prisma.trafficMetricDaily.groupBy({
          by: ['campaign_id'],
          where: { account_id: accountId, date: { gte: sevenDaysAgo } },
          _sum: {
            cost_micros: true,
            clicks: true,
            impressions: true,
            conversions: true,
          },
        }),
        this.prisma.trafficMetricDaily.groupBy({
          by: ['campaign_id'],
          where: { account_id: accountId, date: { gte: thirtyDaysAgo } },
          _sum: {
            cost_micros: true,
            clicks: true,
            impressions: true,
            conversions: true,
          },
        }),
        this.prisma.trafficAlert.findMany({
          where: { account_id: accountId, status: 'OPEN' },
        }),
        this.prisma.trafficSettings.findUnique({
          where: { tenant_id: account.tenant_id },
        }),
        // Ads desaprovados — alimenta regra PAUSE_AD_REPROVED
        // include ad_group pra montar resource_name 'customers/X/adGroupAds/Y~Z'
        this.prisma.trafficAd.findMany({
          where: {
            account_id: accountId,
            approval_status: 'DISAPPROVED',
            // Excluímos só os já PAUSED/REMOVED — DISAPPROVED em estado
            // ENABLED é o caso que precisa de mirror local.
            status: { notIn: ['PAUSED', 'REMOVED'] },
          },
          include: { ad_group: { select: { google_ad_group_id: true } } },
          take: 50,
        }),
      ]);

    const todayActionsCount = await this.prisma.trafficIADecision.count({
      where: {
        account_id: accountId,
        action: 'EXECUTE',
        created_at: { gte: today },
      },
    });

    // Janela ampla pra alimentar memória adaptativa (cooldowns IGNORED,
    // penalty REVERTED, reforço APPROVED). 120 dias cobre folgas dos
    // defaults reverted_penalty_days=90 e ignored_cooldown_days=30.
    const ninetyDaysAgo = new Date(today);
    ninetyDaysAgo.setUTCDate(ninetyDaysAgo.getUTCDate() - 120);
    const recentDecisions = await this.prisma.trafficIADecision.findMany({
      where: {
        account_id: accountId,
        created_at: { gte: ninetyDaysAgo },
      },
      orderBy: { created_at: 'desc' },
      take: 500,
    });

    // Sprint G.5 — Memória de vetos permanentes do admin.
    // Carrega keys 'permanent_ignore:<kind>|<resource_id>' válidas.
    const permanentVetos = await this.prisma.trafficIAMemory.findMany({
      where: {
        tenant_id: account.tenant_id,
        key: { startsWith: 'permanent_ignore:' },
        OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }],
      },
      select: { key: true },
    });
    const permanentVetoSet = new Set(
      permanentVetos.map((m) => m.key.replace(/^permanent_ignore:/, '')),
    );

    return {
      account,
      policy,
      settings,
      campaigns,
      metricsByCampaign7d: indexBy(metrics7d, (m) => m.campaign_id),
      metricsByCampaign30d: indexBy(metrics30d, (m) => m.campaign_id),
      openAlerts,
      disapprovedAds: ads,
      todayActionsCount,
      recentDecisions,
      permanentVetoSet,
    };
  }

  /**
   * Garante que existe uma TrafficIAPolicy pro tenant. Cria com defaults
   * (ADVISOR mode + shadow_mode=true + agent_enabled=false). Admin precisa
   * habilitar manualmente em Configurações.
   */
  private async ensurePolicy(tenantId: string) {
    const existing = await this.prisma.trafficIAPolicy.findUnique({
      where: { tenant_id: tenantId },
    });
    if (existing) return existing;
    return this.prisma.trafficIAPolicy.create({
      data: { tenant_id: tenantId },
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Diagnose — REGRAS DETERMINÍSTICAS
  // ──────────────────────────────────────────────────────────────────────

  private async diagnose(
    ctx: AgentContext,
    loopKind: LoopKind,
  ): Promise<DecisionCandidate[]> {
    const out: DecisionCandidate[] = [];

    // Sempre rodam (cheap)
    out.push(...this.findDisapprovedAds(ctx));
    out.push(...this.findDeadCampaigns(ctx));
    out.push(...this.findHighCPL(ctx));
    out.push(...this.findLowCTR(ctx));
    out.push(...this.findZeroConversions(ctx));

    // Loops mais longos rodam regras adicionais
    if (loopKind === 'WEEKLY' || loopKind === 'MONTHLY') {
      out.push(...this.findOverspend(ctx));
      out.push(...this.findBudgetExhausted(ctx));
    }

    return out;
  }

  /** PAUSE_AD_REPROVED — Google já desaprovou o ad; refletir pause local. */
  private findDisapprovedAds(ctx: AgentContext): DecisionCandidate[] {
    return ctx.disapprovedAds.map((ad) => {
      // headlines é Json (array de objetos {text, pinned_field?}) — extrai 1ª text
      const firstHeadline = extractFirstHeadlineText(ad.headlines);
      const customerId = ctx.account.customer_id;
      const googleAdGroupId = ad.ad_group?.google_ad_group_id;
      const adGroupAdResourceName =
        customerId && googleAdGroupId && ad.google_ad_id
          ? `customers/${customerId}/adGroupAds/${googleAdGroupId}~${ad.google_ad_id}`
          : null;
      return {
        kind: 'PAUSE_AD_REPROVED',
        resourceType: 'AD',
        resourceId: ad.id,
        resourceName: firstHeadline ?? `Ad ${ad.google_ad_id}`,
        // Confidence alta: Google já tomou decisão de pausar mostragem
        confidence: 0.99,
        reasons: [
          'Google Ads marcou este ad como DISAPPROVED — já não está sendo exibido.',
          'Mirror local da pausa pra higiene do dashboard e evitar dispute futuro.',
        ],
        inputs: {
          ad_id: ad.id,
          google_ad_id: ad.google_ad_id,
          approval_status: ad.approval_status,
          policy_topics: ad.policy_topics,
        },
        // Qual mutate aplicar (caso EXECUTE):
        autoApply: {
          kind: 'PAUSE_AD',
          adGroupAdResourceName,
        },
      };
    });
  }

  /** CAMPAIGN_DEAD_ALERT — gasto sem conversão por janela longa. */
  private findDeadCampaigns(ctx: AgentContext): DecisionCandidate[] {
    const out: DecisionCandidate[] = [];
    for (const camp of ctx.campaigns) {
      if (camp.status !== 'ENABLED') continue;
      const m30 = ctx.metricsByCampaign30d.get(camp.id);
      if (!m30) continue;
      const cost30 = Number(m30._sum.cost_micros ?? 0n) / 1_000_000;
      const conv30 = Number(m30._sum.conversions ?? 0);
      // Threshold: gastou >= R$ 100 em 30d e zero conversões
      if (cost30 < 100 || conv30 > 0) continue;
      // Score "morta" cresce com gasto
      const score = Math.min(0.99, 0.7 + (cost30 / 1000) * 0.05);
      out.push({
        kind: 'CAMPAIGN_DEAD_ALERT',
        resourceType: 'CAMPAIGN',
        resourceId: camp.id,
        resourceName: camp.name,
        // **Nunca auto-pausar** — humano decide se pausa
        confidence: score,
        forceSuggest: true,
        reasons: [
          `Gasto 30d: R$ ${cost30.toFixed(2)} sem nenhuma conversão registrada.`,
          'Recomendação: revisar keywords, landing page e copy. Considerar pausa.',
        ],
        inputs: {
          campaign_id: camp.id,
          cost_30d_brl: cost30,
          conversions_30d: conv30,
        },
      });
    }
    return out;
  }

  /** HIGH_CPL_WARNING — CPL > target * (1 + threshold) em janela de 7d. */
  private findHighCPL(ctx: AgentContext): DecisionCandidate[] {
    const out: DecisionCandidate[] = [];
    const settings = ctx.settings;
    if (!settings?.target_cpl_micros) return out;
    const targetMicros = settings.target_cpl_micros;
    const threshold = Number(settings.cpl_alert_threshold ?? 0.30);

    for (const camp of ctx.campaigns) {
      if (camp.status !== 'ENABLED') continue;
      const m = ctx.metricsByCampaign7d.get(camp.id);
      if (!m) continue;
      const conv = Number(m._sum.conversions ?? 0);
      if (conv === 0) continue; // sem conv não dá pra calcular CPL
      const costMicros = m._sum.cost_micros ?? 0n;
      const cplMicros = costMicros / BigInt(Math.max(1, Math.round(conv)));
      const limit = (targetMicros * BigInt(Math.round((1 + threshold) * 1000))) / 1000n;
      if (cplMicros <= limit) continue;
      const cplBrl = Number(cplMicros) / 1_000_000;
      const targetBrl = Number(targetMicros) / 1_000_000;
      out.push({
        kind: 'HIGH_CPL_WARNING',
        resourceType: 'CAMPAIGN',
        resourceId: camp.id,
        resourceName: camp.name,
        // Confidence moderada — humano avalia
        confidence: 0.75,
        forceSuggest: true,
        reasons: [
          `CPL 7d: R$ ${cplBrl.toFixed(2)} (target R$ ${targetBrl.toFixed(2)}, +${Math.round(threshold * 100)}% tolerado).`,
          'Sugestão: revisar termos de pesquisa e relevância do ad → landing.',
        ],
        inputs: {
          campaign_id: camp.id,
          cpl_7d_brl: cplBrl,
          target_cpl_brl: targetBrl,
          threshold,
        },
      });
    }
    return out;
  }

  /** LOW_CTR_WARNING — CTR < target * (1 - threshold). */
  private findLowCTR(ctx: AgentContext): DecisionCandidate[] {
    const out: DecisionCandidate[] = [];
    const settings = ctx.settings;
    if (!settings?.target_ctr) return out;
    const target = Number(settings.target_ctr);
    const threshold = Number(settings.ctr_alert_threshold ?? 0.30);
    const minImpressions = 500; // anti-ruído

    for (const camp of ctx.campaigns) {
      if (camp.status !== 'ENABLED') continue;
      const m = ctx.metricsByCampaign7d.get(camp.id);
      if (!m) continue;
      const impressions = Number(m._sum.impressions ?? 0n);
      if (impressions < minImpressions) continue;
      const clicks = Number(m._sum.clicks ?? 0n);
      const ctr = clicks / Math.max(1, impressions);
      const limit = target * (1 - threshold);
      if (ctr >= limit) continue;
      out.push({
        kind: 'LOW_CTR_WARNING',
        resourceType: 'CAMPAIGN',
        resourceId: camp.id,
        resourceName: camp.name,
        confidence: 0.7,
        forceSuggest: true,
        reasons: [
          `CTR 7d: ${(ctr * 100).toFixed(2)}% (target ${(target * 100).toFixed(2)}%).`,
          'Sugestão: testar novos headlines/descriptions, revisar match types.',
        ],
        inputs: {
          campaign_id: camp.id,
          ctr_7d: ctr,
          target_ctr: target,
          threshold,
        },
      });
    }
    return out;
  }

  /** ZERO_CONVERSIONS — campanha ENABLED com gasto > 0 e 0 conv (7d). */
  private findZeroConversions(ctx: AgentContext): DecisionCandidate[] {
    const out: DecisionCandidate[] = [];
    for (const camp of ctx.campaigns) {
      if (camp.status !== 'ENABLED') continue;
      const m = ctx.metricsByCampaign7d.get(camp.id);
      if (!m) continue;
      const cost = Number(m._sum.cost_micros ?? 0n) / 1_000_000;
      const conv = Number(m._sum.conversions ?? 0);
      if (cost < 50 || conv > 0) continue; // ruído cortado
      out.push({
        kind: 'ZERO_CONVERSIONS',
        resourceType: 'CAMPAIGN',
        resourceId: camp.id,
        resourceName: camp.name,
        // Score cresce com gasto
        confidence: Math.min(0.9, 0.6 + cost / 500),
        forceSuggest: true,
        reasons: [
          `Gasto 7d: R$ ${cost.toFixed(2)} sem conversões.`,
          'Verificar: tracking de conversão (gtag/GA4) E qualidade do tráfego.',
        ],
        inputs: { campaign_id: camp.id, cost_7d_brl: cost, conversions_7d: 0 },
      });
    }
    return out;
  }

  /** OVERSPEND — gasto 7d > budget*7*1.20. */
  private findOverspend(ctx: AgentContext): DecisionCandidate[] {
    const out: DecisionCandidate[] = [];
    for (const camp of ctx.campaigns) {
      if (!camp.daily_budget_micros) continue;
      const m = ctx.metricsByCampaign7d.get(camp.id);
      if (!m) continue;
      const cost7 = m._sum.cost_micros ?? 0n;
      const limit = camp.daily_budget_micros * 7n + (camp.daily_budget_micros * 7n * 20n) / 100n;
      if (cost7 <= limit) continue;
      const costBrl = Number(cost7) / 1_000_000;
      const dailyBudgetBrl = Number(camp.daily_budget_micros) / 1_000_000;
      out.push({
        kind: 'OVERSPEND',
        resourceType: 'CAMPAIGN',
        resourceId: camp.id,
        resourceName: camp.name,
        confidence: 0.9,
        forceSuggest: true,
        reasons: [
          `Gasto 7d: R$ ${costBrl.toFixed(2)} (~${((costBrl / (dailyBudgetBrl * 7)) * 100).toFixed(0)}% do orçamento esperado).`,
          'Verificar bidding strategy ou ajustar budget diário.',
        ],
        inputs: {
          campaign_id: camp.id,
          cost_7d_brl: costBrl,
          daily_budget_brl: dailyBudgetBrl,
        },
      });
    }
    return out;
  }

  /** BUDGET_EXHAUSTED — gasto diário batendo budget consistentemente (proxy). */
  private findBudgetExhausted(ctx: AgentContext): DecisionCandidate[] {
    const out: DecisionCandidate[] = [];
    for (const camp of ctx.campaigns) {
      if (!camp.daily_budget_micros) continue;
      const m = ctx.metricsByCampaign7d.get(camp.id);
      if (!m) continue;
      const cost7 = Number(m._sum.cost_micros ?? 0n);
      const budget7 = Number(camp.daily_budget_micros) * 7;
      // 95-105% do budget = saturação típica
      if (cost7 < budget7 * 0.95 || cost7 > budget7 * 1.05) continue;
      const conv = Number(m._sum.conversions ?? 0);
      if (conv === 0) continue; // não sugere subir budget de campanha morta
      out.push({
        kind: 'BUDGET_INCREASE_SUGGESTION',
        resourceType: 'CAMPAIGN',
        resourceId: camp.id,
        resourceName: camp.name,
        confidence: 0.7,
        forceSuggest: true,
        reasons: [
          `Campanha consumindo ~100% do orçamento diário com ${conv.toFixed(1)} conversões em 7d.`,
          'Sugestão: aumentar budget em até +20% (limite policy.max_budget_change_percent).',
        ],
        inputs: {
          campaign_id: camp.id,
          cost_7d_brl: cost7 / 1_000_000,
          daily_budget_brl: Number(camp.daily_budget_micros) / 1_000_000,
          conversions_7d: conv,
        },
      });
    }
    return out;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Memory filter (Sprint G.1) — adapta candidato com base no histórico
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Aplica memória adaptativa em um candidato:
   *  - Suprime se IGNORED dentro da janela de cooldown (ignored_cooldown_days)
   *  - Penaliza confidence se REVERTED dentro da janela (reverted_penalty_days)
   *  - Reforça confidence se APPROVED previamente
   *  - Conta strikes pra escalation (suggestionStrikes na decisão)
   *  - Pula tudo isso se decision_kind for um diagnóstico puro sem resource_id
   *    associado (warning operacional não dedupa por target).
   *
   * Retorna `null` quando o candidato deve ser totalmente suprimido.
   */
  private applyMemoryFilter(
    cand: DecisionCandidate,
    ctx: AgentContext,
  ): DecisionCandidate | null {
    const policy = ctx.policy as any;
    const cooldownDays: number = policy.ignored_cooldown_days ?? 30;
    const penaltyDays: number = policy.reverted_penalty_days ?? 90;

    // Veto permanente do admin (Sprint G.5) tem prioridade absoluta
    const permanentKey = `${cand.kind}|${cand.resourceId ?? '_'}`;
    if (ctx.permanentVetoSet.has(permanentKey)) {
      this.logger.log(
        `[ai-agent] memory: permanent veto kind=${cand.kind} resource=${cand.resourceId}`,
      );
      return null;
    }

    const matches = ctx.recentDecisions.filter((d: any) => {
      if (d.decision_kind !== cand.kind) return false;
      // Quando candidato não tem resource_id, comparamos apenas por kind
      if (!cand.resourceId) return d.resource_id == null;
      return d.resource_id === cand.resourceId;
    });

    if (matches.length === 0) return cand;

    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const ignoredCutoff = now - cooldownDays * day;
    const revertedCutoff = now - penaltyDays * day;

    // 1. IGNORED dentro da janela → suprime totalmente
    const recentIgnored = matches.find((d: any) => {
      if (d.human_feedback !== 'IGNORED') return false;
      const at = (d.feedback_at ?? d.created_at) as Date;
      return at.getTime() >= ignoredCutoff;
    });
    if (recentIgnored) {
      this.logger.log(
        `[ai-agent] memory: suppress kind=${cand.kind} resource=${cand.resourceId} ` +
          `(IGNORED em ${(recentIgnored.feedback_at ?? recentIgnored.created_at).toISOString().slice(0, 10)})`,
      );
      return null;
    }

    // 2. REVERTED dentro da janela → penaliza confidence + força SUGGEST
    const recentReverted = matches.find((d: any) => {
      if (d.human_feedback !== 'REVERTED') return false;
      const at = (d.feedback_at ?? d.created_at) as Date;
      return at.getTime() >= revertedCutoff;
    });
    if (recentReverted) {
      cand.confidence = Math.max(0, cand.confidence - 0.2);
      cand.forceSuggest = true;
      cand.reasons.push(
        `Admin reverteu sugestão similar em ${(recentReverted.feedback_at ?? recentReverted.created_at).toLocaleDateString?.('pt-BR') ?? '—'}; confidence reduzida.`,
      );
    }

    // 3. APPROVED previamente (sem REVERTED recente) → reforça confidence
    const previouslyApproved = matches.some(
      (d: any) => d.human_feedback === 'APPROVED',
    );
    if (previouslyApproved && !recentReverted) {
      cand.confidence = Math.min(1, cand.confidence + 0.1);
      cand.reasons.push(
        'Admin aprovou sugestão similar antes; confidence reforçada.',
      );
    }

    // 4. SUGGEST pendente sem feedback (na janela curta de 14d) → strikes
    const fourteenDaysAgo = now - 14 * day;
    const pendingSuggests = matches.filter(
      (d: any) =>
        d.action === 'SUGGEST' &&
        d.human_feedback == null &&
        (d.created_at as Date).getTime() > fourteenDaysAgo,
    );
    if (pendingSuggests.length > 0) {
      const ordinal = pendingSuggests.length + 1;
      cand.suggestionStrikes = pendingSuggests.length;
      cand.reasons.push(
        `${ordinal}ª vez sugerindo isto em 14 dias sem resposta — escalando atenção.`,
      );
    }

    return cand;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Evaluate + Execute (ou Suggest)
  // ──────────────────────────────────────────────────────────────────────

  private async evaluateAndExecute(
    cand: DecisionCandidate,
    ctx: AgentContext,
    loopKind: LoopKind,
  ): Promise<PersistedDecision> {
    const policy = ctx.policy;
    let action: DecisionAction = 'SUGGEST';
    const reasons = [...cand.reasons];

    // 1. forceSuggest (regra explícita: ex. CAMPAIGN_DEAD nunca auto-pausa)
    let canExecute = !cand.forceSuggest;

    // 2. Modo geral
    if (policy.mode === 'ADVISOR') {
      canExecute = false;
      reasons.push('Modo ADVISOR: IA apenas sugere, não executa.');
    }

    // 3. Shadow mode (calibração) — força NOTIFY_ONLY
    if (policy.shadow_mode && canExecute) {
      action = 'NOTIFY_ONLY';
      reasons.push('Shadow mode ON — decisão registrada mas não aplicada.');
      return await this.persistDecision(cand, ctx, loopKind, action, reasons);
    }

    // 4. Daily limit
    if (canExecute && ctx.todayActionsCount >= policy.max_auto_actions_per_day) {
      canExecute = false;
      reasons.push(
        `Limite diário de ${policy.max_auto_actions_per_day} ações auto-aplicadas atingido.`,
      );
    }

    // 5. Confidence threshold
    if (canExecute && cand.confidence < Number(policy.min_confidence_for_auto)) {
      canExecute = false;
      reasons.push(
        `Confidence ${cand.confidence.toFixed(2)} < threshold ${Number(policy.min_confidence_for_auto).toFixed(2)}.`,
      );
    }

    // 6. Type-specific toggle
    if (canExecute && !this.isTypeAutoEnabled(cand.kind, policy)) {
      canExecute = false;
      reasons.push(
        `Toggle auto_apply para "${cand.kind}" desligado em policy.`,
      );
    }

    // 7. autoApply payload disponível?
    if (canExecute && !cand.autoApply) {
      canExecute = false;
      reasons.push('Sem payload de auto-aplicação para este tipo.');
    }

    // Decide
    if (canExecute) {
      action = 'EXECUTE';
      try {
        const log = await this.applyMutate(cand, ctx);
        return await this.persistDecision(
          cand,
          ctx,
          loopKind,
          action,
          reasons,
          { executed: true, mutateLogId: log.id },
        );
      } catch (err: any) {
        action = 'FAILED';
        reasons.push(`Falha na execução: ${err?.message ?? String(err)}`);
        return await this.persistDecision(cand, ctx, loopKind, action, reasons);
      }
    }

    return await this.persistDecision(cand, ctx, loopKind, action, reasons);
  }

  private isTypeAutoEnabled(
    kind: DecisionKind,
    policy: { [k: string]: any },
  ): boolean {
    switch (kind) {
      case 'PAUSE_AD_REPROVED':
        return !!policy.auto_apply_pause_disapproved;
      case 'ADD_NEGATIVE_KEYWORD':
        return !!policy.auto_apply_negative_keywords;
      case 'BUDGET_INCREASE_SUGGESTION':
        return !!policy.auto_apply_budget_changes;
      // Diagnósticos puros nunca auto-aplicam
      default:
        return false;
    }
  }

  private async applyMutate(
    cand: DecisionCandidate,
    ctx: AgentContext,
  ): Promise<{ id: string }> {
    const auto = cand.autoApply;
    if (!auto) throw new Error('autoApply ausente');

    if (auto.kind === 'PAUSE_AD' && auto.adGroupAdResourceName) {
      const r = await this.mutate.execute({
        tenantId: ctx.account.tenant_id,
        accountId: ctx.account.id,
        resourceType: 'ad_group_ad',
        operation: 'update',
        initiator: 'AI_AGENT',
        confidence: cand.confidence,
        operations: [
          {
            resource_name: auto.adGroupAdResourceName,
            // SDK enums: 3 = PAUSED no AdGroupAdStatus
            status: 3,
          },
        ],
        context: {
          ai_loop: true,
          decision_kind: cand.kind,
          campaign_id_local: cand.resourceId,
        },
      });
      if (r.status !== 'SUCCESS') {
        throw new Error(r.errorMessage ?? `mutate status=${r.status}`);
      }
      return { id: r.logId };
    }

    throw new Error(`autoApply.kind="${auto.kind}" sem implementação`);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Persistence
  // ──────────────────────────────────────────────────────────────────────

  private async persistDecision(
    cand: DecisionCandidate,
    ctx: AgentContext,
    loopKind: LoopKind,
    action: DecisionAction,
    reasons: string[],
    extra: { executed?: boolean; mutateLogId?: string } = {},
  ): Promise<PersistedDecision> {
    const summary = this.buildSummary(cand, action);
    // Sprint G.5 — strikes ficam dentro de inputs.suggestion_strikes pra UI
    // poder exibir badge "Xª vez sugerindo".
    const inputsWithStrikes = {
      ...(cand.inputs ?? {}),
      ...(cand.suggestionStrikes
        ? { suggestion_strikes: cand.suggestionStrikes }
        : {}),
    };

    const decision = await this.prisma.trafficIADecision.create({
      data: {
        tenant_id: ctx.account.tenant_id,
        account_id: ctx.account.id,
        loop_kind: loopKind,
        decision_kind: cand.kind,
        resource_type: cand.resourceType ?? null,
        resource_id: cand.resourceId ?? null,
        resource_name: cand.resourceName ?? null,
        inputs: inputsWithStrikes as Prisma.InputJsonValue,
        confidence: new Prisma.Decimal(cand.confidence.toFixed(3)),
        reasons: reasons as unknown as Prisma.InputJsonValue,
        action,
        executed: !!extra.executed,
        mutate_log_id: extra.mutateLogId ?? null,
        summary,
      },
    });
    return {
      id: decision.id,
      action,
      kind: cand.kind,
      resourceName: cand.resourceName ?? null,
      summary,
      confidence: cand.confidence,
    };
  }

  private buildSummary(cand: DecisionCandidate, action: DecisionAction): string {
    const verbo =
      action === 'EXECUTE'
        ? 'Aplicado'
        : action === 'SUGGEST'
          ? 'Sugerido'
          : action === 'BLOCK'
            ? 'Bloqueado por OAB'
            : action === 'FAILED'
              ? 'Tentativa falhou'
              : 'Diagnóstico';
    const target = cand.resourceName ? ` em "${cand.resourceName}"` : '';
    const kindLabel = humanizeKind(cand.kind);
    return `${verbo}: ${kindLabel}${target}.`;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Escalation (Sprint G.2)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Para uma conta: marca SUGGEST sem feedback como IGNORED quando há
   * mais de N strikes (re-sugestões) acumulados sem resposta. Antes
   * disso, só registra a contagem em TrafficIAMemory pra log.
   *
   * Heurística:
   *   - "strike" = qtd de SUGGEST com mesma kind+resource_id sem feedback,
   *      após o primeiro `escalation_hours` (default 48h)
   *   - Quando strikes ≥ `max_resuggestion_strikes` (default 3), o item
   *      MAIS RECENTE vira human_feedback=IGNORED com note explícita.
   *   - As anteriores ficam como estão (auditoria histórica).
   */
  async escalateOrAutoIgnore(accountId: string): Promise<EscalationReport> {
    const account = await this.prisma.trafficAccount.findUnique({
      where: { id: accountId },
    });
    if (!account || account.status !== 'ACTIVE') {
      return { accountId, escalated: 0, autoIgnored: 0 };
    }
    const policy = await this.ensurePolicy(account.tenant_id);
    const escalationHours = policy.escalation_hours ?? 48;
    const maxStrikes = (policy as any).max_resuggestion_strikes ?? 3;

    const cutoff = new Date(Date.now() - escalationHours * 60 * 60 * 1000);

    // Pega todas SUGGEST sem feedback com created_at < cutoff (sentaram tempo demais)
    const stale = await this.prisma.trafficIADecision.findMany({
      where: {
        account_id: accountId,
        action: 'SUGGEST',
        human_feedback: null,
        created_at: { lt: cutoff },
      },
      orderBy: { created_at: 'desc' },
    });
    if (stale.length === 0) {
      return { accountId, escalated: 0, autoIgnored: 0 };
    }

    // Agrupa por (kind, resource_id) — strikes = tamanho do grupo
    const groups = new Map<string, typeof stale>();
    for (const d of stale) {
      const key = `${d.decision_kind}|${d.resource_id ?? '_'}`;
      const list = groups.get(key) ?? [];
      list.push(d);
      groups.set(key, list);
    }

    let escalated = 0;
    let autoIgnored = 0;

    for (const [key, list] of groups) {
      if (list.length >= maxStrikes) {
        // Auto-IGNORE da mais recente. As outras ficam em status histórico.
        const latest = list[0];
        await this.prisma.trafficIADecision.update({
          where: { id: latest.id },
          data: {
            human_feedback: 'IGNORED',
            feedback_at: new Date(),
            feedback_note: `Auto-IGNORE: ${list.length} sugestões em ${escalationHours}h+ sem resposta do admin (max_resuggestion_strikes=${maxStrikes}).`,
          },
        });
        autoIgnored++;

        // Memória persistente — admin vê na UI quantas vezes foi auto-ignorado
        await this.prisma.trafficIAMemory.upsert({
          where: {
            tenant_id_key: {
              tenant_id: account.tenant_id,
              key: `auto_ignore:${key}`,
            },
          },
          update: {
            value: {
              count: list.length,
              last_at: new Date().toISOString(),
            } as any,
            expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          },
          create: {
            tenant_id: account.tenant_id,
            key: `auto_ignore:${key}`,
            value: {
              count: list.length,
              last_at: new Date().toISOString(),
            } as any,
            expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          },
        });
      } else {
        escalated++;
      }
    }

    this.logger.log(
      `[ai-agent] escalation account=${accountId} stale_groups=${groups.size} ` +
        `escalated=${escalated} auto_ignored=${autoIgnored}`,
    );
    return { accountId, escalated, autoIgnored };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Memory + notification
  // ──────────────────────────────────────────────────────────────────────

  private async persistMemory(
    ctx: AgentContext,
    loopKind: LoopKind,
    persisted: PersistedDecision[],
  ) {
    const key = `last_${loopKind.toLowerCase()}_run_at`;
    await this.prisma.trafficIAMemory.upsert({
      where: { tenant_id_key: { tenant_id: ctx.account.tenant_id, key } },
      update: {
        value: {
          at: new Date().toISOString(),
          decisions: persisted.length,
          executed: persisted.filter((p) => p.action === 'EXECUTE').length,
        } as Prisma.InputJsonValue,
      },
      create: {
        tenant_id: ctx.account.tenant_id,
        key,
        value: {
          at: new Date().toISOString(),
          decisions: persisted.length,
          executed: persisted.filter((p) => p.action === 'EXECUTE').length,
        } as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Notifica humano via canais já existentes. Reusa o pipeline de
   * TrafficAlert: cria 1 alerta agregador "AI_DECISIONS_AVAILABLE" com
   * resumo no message — que vai pra inbox/email/whatsapp do admin.
   *
   * Detalhes individuais ficam na UI (tab "IA Otimizadora").
   */
  private async notifyHuman(
    ctx: AgentContext,
    loopKind: LoopKind,
    persisted: PersistedDecision[],
  ) {
    if (persisted.length === 0) return;

    const executed = persisted.filter((p) => p.action === 'EXECUTE').length;
    const suggested = persisted.filter((p) => p.action === 'SUGGEST').length;
    const blocked = persisted.filter((p) => p.action === 'BLOCK').length;
    if (suggested === 0 && executed === 0 && blocked === 0) return;

    const dateBucket = new Date().toISOString().slice(0, 10);
    const dedupeKey = `ai-${loopKind.toLowerCase()}-${dateBucket}-${ctx.account.id}`;

    // Sprint G.4 — Resumo gerado por LLM (com fallback determinístico).
    // Notificação do admin via WhatsApp tem tom mais natural.
    const llmSummary = await this.llm.generateSummary(
      ctx.account.tenant_id,
      persisted.map((p) => ({
        action: p.action,
        kind: p.kind,
        resourceName: p.resourceName,
        confidence: p.confidence,
        summary: p.summary,
      })),
      'whatsapp',
    );

    const headerStats = `IA (${loopKind.toLowerCase()}): ${executed} executadas, ${suggested} sugestões, ${blocked} bloqueadas.`;
    const message = `${headerStats}\n\n${llmSummary}`;

    const alert = await this.prisma.trafficAlert.upsert({
      where: { dedupe_key: dedupeKey },
      update: {
        message,
        context: {
          loop_kind: loopKind,
          executed,
          suggested,
          blocked,
          decisions_count: persisted.length,
          updated_at: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
      create: {
        tenant_id: ctx.account.tenant_id,
        account_id: ctx.account.id,
        kind: 'AI_DECISIONS_AVAILABLE',
        severity: executed > 0 ? 'INFO' : 'WARNING',
        message,
        dedupe_key: dedupeKey,
        context: {
          loop_kind: loopKind,
          executed,
          suggested,
          blocked,
          decisions_count: persisted.length,
        } as Prisma.InputJsonValue,
        status: 'OPEN',
      },
    });
    await this.notifier.notifyAlerts([alert.id]);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Tipos
// ──────────────────────────────────────────────────────────────────────────

export type LoopKind =
  | 'HOURLY'
  | 'DAILY'
  | 'WEEKLY'
  | 'MONTHLY'
  | 'TRIGGERED';

export type DecisionAction =
  | 'EXECUTE'
  | 'SUGGEST'
  | 'BLOCK'
  | 'NOTIFY_ONLY'
  | 'FAILED';

export type DecisionKind =
  | 'PAUSE_AD_REPROVED'
  | 'CAMPAIGN_DEAD_ALERT'
  | 'HIGH_CPL_WARNING'
  | 'LOW_CTR_WARNING'
  | 'ZERO_CONVERSIONS'
  | 'OVERSPEND'
  | 'ADD_NEGATIVE_KEYWORD'
  | 'BUDGET_INCREASE_SUGGESTION';

type AutoApplyPayload = {
  kind: 'PAUSE_AD' | 'PAUSE_CAMPAIGN' | 'UPDATE_BUDGET' | 'ADD_NEGATIVES';
  adGroupAdResourceName?: string | null;
  campaignResourceName?: string | null;
  budgetResourceName?: string | null;
  newAmountMicros?: bigint | null;
};

type DecisionCandidate = {
  kind: DecisionKind;
  resourceType?: string;
  resourceId?: string;
  resourceName?: string;
  confidence: number;
  reasons: string[];
  inputs: Record<string, any>;
  /** se true, força action='SUGGEST' ignorando policy (regra de negócio explícita) */
  forceSuggest?: boolean;
  autoApply?: AutoApplyPayload;
  /** Sprint G.1 — quantas vezes sugerimos isto sem resposta do admin (janela 14d) */
  suggestionStrikes?: number;
};

type PersistedDecision = {
  id: string;
  action: DecisionAction;
  kind: DecisionKind;
  resourceName: string | null;
  summary: string;
  confidence: number;
};

type AgentContext = {
  account: {
    id: string;
    tenant_id: string;
    customer_id: string | null;
    status: string;
  };
  policy: {
    agent_enabled: boolean;
    mode: string;
    max_auto_actions_per_day: number;
    min_confidence_for_auto: Prisma.Decimal;
    auto_apply_negative_keywords: boolean;
    auto_apply_pause_disapproved: boolean;
    auto_apply_rsa_asset_recommendations: boolean;
    auto_apply_budget_changes: boolean;
    auto_apply_bidding_strategy_changes: boolean;
    max_budget_change_percent: Prisma.Decimal;
    max_budget_change_per_week: number;
    max_negatives_per_week: number;
    rollback_window_hours: number;
    notify_admin_email: boolean;
    notify_admin_whatsapp: boolean;
    notify_admin_inapp: boolean;
    escalation_hours: number;
    daily_cron: string;
    weekly_cron: string;
    monthly_cron: string;
    hourly_enabled: boolean;
    shadow_mode: boolean;
  };
  settings: any;
  campaigns: any[];
  metricsByCampaign7d: Map<string, any>;
  metricsByCampaign30d: Map<string, any>;
  openAlerts: any[];
  disapprovedAds: any[];
  todayActionsCount: number;
  recentDecisions: any[];
  /** Sprint G.5 — keys '<kind>|<resource_id>' marcadas como veto permanente */
  permanentVetoSet: Set<string>;
};

export type LoopReport = {
  accountId: string;
  loopKind: LoopKind;
  durationMs: number;
  decisions: number;
  executed: number;
  suggested: number;
  blocked: number;
  failed: number;
};

export type EscalationReport = {
  accountId: string;
  escalated: number;
  autoIgnored: number;
};

function emptyReport(accountId: string, loopKind: LoopKind): LoopReport {
  return {
    accountId,
    loopKind,
    durationMs: 0,
    decisions: 0,
    executed: 0,
    suggested: 0,
    blocked: 0,
    failed: 0,
  };
}

function indexBy<T, K>(arr: T[], keyFn: (t: T) => K): Map<K, T> {
  const map = new Map<K, T>();
  for (const item of arr) {
    map.set(keyFn(item), item);
  }
  return map;
}

/**
 * Extrai 1ª headline text de TrafficAd.headlines (Json: array de
 * {text, pinned_field?}). Retorna null se vazio ou formato inesperado.
 */
function extractFirstHeadlineText(headlines: unknown): string | null {
  if (!Array.isArray(headlines) || headlines.length === 0) return null;
  const first = headlines[0];
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object' && 'text' in first) {
    const text = (first as { text?: unknown }).text;
    return typeof text === 'string' ? text : null;
  }
  return null;
}

function humanizeKind(kind: DecisionKind): string {
  switch (kind) {
    case 'PAUSE_AD_REPROVED':
      return 'pausar anúncio reprovado';
    case 'CAMPAIGN_DEAD_ALERT':
      return 'campanha sem retorno';
    case 'HIGH_CPL_WARNING':
      return 'CPL acima do alvo';
    case 'LOW_CTR_WARNING':
      return 'CTR abaixo do alvo';
    case 'ZERO_CONVERSIONS':
      return 'zero conversões com gasto';
    case 'OVERSPEND':
      return 'gasto acima do orçamento';
    case 'ADD_NEGATIVE_KEYWORD':
      return 'adicionar palavra negativa';
    case 'BUDGET_INCREASE_SUGGESTION':
      return 'aumentar orçamento';
    default:
      return kind;
  }
}
