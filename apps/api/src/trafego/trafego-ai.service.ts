import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

/**
 * TrafegoAiService — orquestra interações da UI com a IA do tráfego.
 *
 * Responsabilidades:
 *   - Listar decisões (TrafficIADecision) com filtros
 *   - Registrar feedback do humano (APPROVED/REVERTED/IGNORED) — alimenta
 *     calibração futura do agente
 *   - Get/Update da TrafficIAPolicy (toggles ADVISOR/AUTONOMOUS, schedules)
 *   - Enfileirar trigger manual de loop ("Avaliar agora")
 *
 * Não executa o agente diretamente — só publica jobs na fila
 * `trafego-ai-agent` que o worker consome.
 */
@Injectable()
export class TrafegoAiService {
  private readonly logger = new Logger(TrafegoAiService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('trafego-ai-agent') private readonly queue: Queue,
  ) {}

  // ────────────────────────────────────────────────────────────────────
  // Decisions
  // ────────────────────────────────────────────────────────────────────

  async listDecisions(
    tenantId: string,
    opts: ListDecisionsOpts = {},
  ) {
    const where: Prisma.TrafficIADecisionWhereInput = { tenant_id: tenantId };
    if (opts.action) where.action = opts.action;
    if (opts.kind) where.decision_kind = opts.kind;
    if (opts.loopKind) where.loop_kind = opts.loopKind;
    if (opts.feedback === 'PENDING') where.human_feedback = null;
    else if (opts.feedback) where.human_feedback = opts.feedback;
    if (opts.accountId) where.account_id = opts.accountId;

    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);

    const [items, total, openCount] = await Promise.all([
      this.prisma.trafficIADecision.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: limit,
        select: {
          id: true,
          loop_kind: true,
          decision_kind: true,
          resource_type: true,
          resource_name: true,
          confidence: true,
          reasons: true,
          inputs: true,
          action: true,
          executed: true,
          mutate_log_id: true,
          human_feedback: true,
          feedback_at: true,
          summary: true,
          created_at: true,
        },
      }),
      this.prisma.trafficIADecision.count({ where }),
      // Pendentes (suggestions sem feedback) — pra badge na UI
      this.prisma.trafficIADecision.count({
        where: {
          tenant_id: tenantId,
          action: 'SUGGEST',
          human_feedback: null,
        },
      }),
    ]);

    return {
      items: items.map((d) => ({
        ...d,
        confidence: d.confidence?.toFixed(3) ?? null,
      })),
      total,
      pending_count: openCount,
    };
  }

  async submitFeedback(
    tenantId: string,
    decisionId: string,
    feedback: 'APPROVED' | 'REVERTED' | 'IGNORED',
    note: string | undefined,
    userId: string,
    opts: { permanent?: boolean } = {},
  ) {
    const decision = await this.prisma.trafficIADecision.findUnique({
      where: { id: decisionId },
    });
    if (!decision || decision.tenant_id !== tenantId) {
      throw new HttpException('Decisão não encontrada.', HttpStatus.NOT_FOUND);
    }
    if (decision.human_feedback) {
      throw new HttpException(
        `Decisão já recebeu feedback (${decision.human_feedback}).`,
        HttpStatus.CONFLICT,
      );
    }

    const finalNote = opts.permanent
      ? `[PERMANENTE] ${note?.slice(0, 950) ?? 'Veto permanente do admin'}`
      : note?.slice(0, 1000) ?? null;

    const updated = await this.prisma.trafficIADecision.update({
      where: { id: decisionId },
      data: {
        human_feedback: feedback,
        feedback_at: new Date(),
        feedback_note: finalNote,
      },
    });

    // Sprint G.5 — Veto permanente cria entrada em TrafficIAMemory com TTL
    // longo (365d). O filtro de memória adaptativa respeita: além do
    // cooldown IGNORED por 30d (default), checa também por essa key e
    // suprime totalmente.
    if (opts.permanent && feedback === 'IGNORED') {
      const memKey = `permanent_ignore:${decision.decision_kind}|${decision.resource_id ?? '_'}`;
      await this.prisma.trafficIAMemory.upsert({
        where: { tenant_id_key: { tenant_id: tenantId, key: memKey } },
        update: {
          value: {
            decision_id: decisionId,
            resource_name: decision.resource_name,
            note: finalNote,
            by_user_id: userId,
            at: new Date().toISOString(),
          } as any,
          expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        },
        create: {
          tenant_id: tenantId,
          key: memKey,
          value: {
            decision_id: decisionId,
            resource_name: decision.resource_name,
            note: finalNote,
            by_user_id: userId,
            at: new Date().toISOString(),
          } as any,
          expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        },
      });
    }

    this.logger.log(
      `[ai-feedback] decision=${decisionId} feedback=${feedback} permanent=${!!opts.permanent} userId=${userId}`,
    );
    return updated;
  }

  // ────────────────────────────────────────────────────────────────────
  // Policy
  // ────────────────────────────────────────────────────────────────────

  async getPolicy(tenantId: string) {
    let policy = await this.prisma.trafficIAPolicy.findUnique({
      where: { tenant_id: tenantId },
    });
    if (!policy) {
      policy = await this.prisma.trafficIAPolicy.create({
        data: { tenant_id: tenantId },
      });
    }
    return this.serializePolicy(policy);
  }

  async updatePolicy(
    tenantId: string,
    patch: Partial<{
      agent_enabled: boolean;
      mode: 'ADVISOR' | 'AUTONOMOUS';
      max_auto_actions_per_day: number;
      min_confidence_for_auto: number;
      auto_apply_negative_keywords: boolean;
      auto_apply_pause_disapproved: boolean;
      auto_apply_rsa_asset_recommendations: boolean;
      auto_apply_budget_changes: boolean;
      auto_apply_bidding_strategy_changes: boolean;
      max_budget_change_percent: number;
      max_budget_change_per_week: number;
      max_negatives_per_week: number;
      rollback_window_hours: number;
      notify_admin_email: boolean;
      notify_admin_whatsapp: boolean;
      notify_admin_inapp: boolean;
      escalation_hours: number;
      hourly_enabled: boolean;
      shadow_mode: boolean;
      // Sprint G
      llm_provider: 'anthropic' | 'openai';
      llm_summary_model: string;
      llm_classify_model: string;
      ignored_cooldown_days: number;
      reverted_penalty_days: number;
      max_resuggestion_strikes: number;
    }>,
  ) {
    const data: Prisma.TrafficIAPolicyUpdateInput = {};
    for (const key of Object.keys(patch) as Array<keyof typeof patch>) {
      const v = patch[key];
      if (v === undefined) continue;
      if (key === 'min_confidence_for_auto' && typeof v === 'number') {
        data.min_confidence_for_auto = new Prisma.Decimal(v.toFixed(3));
      } else if (key === 'max_budget_change_percent' && typeof v === 'number') {
        data.max_budget_change_percent = new Prisma.Decimal(v.toFixed(3));
      } else {
        // assignment seguro: TS já valida via Prisma type
        (data as any)[key] = v;
      }
    }

    const policy = await this.prisma.trafficIAPolicy.upsert({
      where: { tenant_id: tenantId },
      update: data,
      create: {
        tenant_id: tenantId,
        ...(data as any),
      },
    });
    return this.serializePolicy(policy);
  }

  private serializePolicy(p: any) {
    return {
      ...p,
      min_confidence_for_auto: p.min_confidence_for_auto?.toFixed(3) ?? '0.950',
      max_budget_change_percent: p.max_budget_change_percent?.toFixed(3) ?? '0.200',
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // Trigger manual de loop
  // ────────────────────────────────────────────────────────────────────

  async triggerLoop(
    tenantId: string,
    loopKind: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'TRIGGERED' = 'TRIGGERED',
  ) {
    const account = await this.prisma.trafficAccount.findFirst({
      where: { tenant_id: tenantId, status: 'ACTIVE' },
      select: { id: true, customer_id: true },
    });
    if (!account) {
      throw new HttpException(
        'Conecte uma conta Google Ads antes de acionar a IA.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const policy = await this.getPolicy(tenantId);
    if (!policy.agent_enabled) {
      throw new HttpException(
        'IA está desabilitada. Habilite em Configurações antes de acionar.',
        HttpStatus.CONFLICT,
      );
    }

    // jobId inclui timestamp pra cada click ser único (evita silent dedupe).
    await this.queue.add(
      'trafego-ai-run-loop',
      { accountId: account.id, loopKind },
      {
        jobId: `ai-${loopKind.toLowerCase()}-${account.id}-${Date.now()}`,
        removeOnComplete: 30,
        removeOnFail: 20,
      },
    );

    return {
      ok: true,
      message: `Loop ${loopKind} enfileirado. Resultado disponível em ~30s.`,
    };
  }
}

export type ListDecisionsOpts = {
  action?: 'EXECUTE' | 'SUGGEST' | 'BLOCK' | 'NOTIFY_ONLY' | 'FAILED';
  kind?: string;
  loopKind?: 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'TRIGGERED';
  feedback?: 'APPROVED' | 'REVERTED' | 'IGNORED' | 'PENDING';
  accountId?: string;
  limit?: number;
};
