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
 * TrafegoRecommendationsService — fachada da UI pra Recommendations.
 * CRUD local + dispatch de jobs (sync, apply, dismiss) na fila
 * `trafego-recommendations` que o worker consome.
 */
@Injectable()
export class TrafegoRecommendationsService {
  private readonly logger = new Logger(TrafegoRecommendationsService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('trafego-recommendations') private readonly queue: Queue,
  ) {}

  async list(
    tenantId: string,
    opts: {
      status?: string;
      type?: string;
      limit?: number;
    } = {},
  ) {
    const where: Prisma.TrafficRecommendationWhereInput = {
      tenant_id: tenantId,
      // Default: oculta APPLIED/DISMISSED/EXPIRED da listagem principal
      // (admin pode pedir explicitamente via opts.status).
      ...(opts.status
        ? { status: opts.status }
        : { status: { in: ['PENDING', 'READY', 'OAB_BLOCKED', 'ERROR'] } }),
    };
    if (opts.type) where.recommendation_type = opts.type;

    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 300);

    const [items, counts] = await Promise.all([
      this.prisma.trafficRecommendation.findMany({
        where,
        orderBy: [{ status: 'asc' }, { last_seen_at: 'desc' }],
        take: limit,
        include: {
          // Trazer info da campanha alvo facilita o display
        },
      }),
      this.prisma.trafficRecommendation.groupBy({
        by: ['status'],
        where: { tenant_id: tenantId },
        _count: { _all: true },
      }),
    ]);

    const byStatus: Record<string, number> = {};
    for (const c of counts) byStatus[c.status] = c._count._all;

    return {
      items,
      counts_by_status: byStatus,
    };
  }

  async triggerSync(tenantId: string) {
    const account = await this.prisma.trafficAccount.findFirst({
      where: { tenant_id: tenantId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!account) {
      throw new HttpException(
        'Conecte uma conta Google Ads antes de sincronizar recomendações.',
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.queue.add(
      'sync',
      { accountId: account.id },
      {
        jobId: `rec-sync-${account.id}-${Date.now()}`,
        removeOnComplete: 30,
        removeOnFail: 20,
      },
    );
    return {
      ok: true,
      message: 'Sync de recomendações enfileirado. Resultado em ~30s.',
    };
  }

  async enqueueApply(
    tenantId: string,
    recommendationId: string,
    opts: { force?: boolean; resolvedBy: string },
  ) {
    const rec = await this.requireOwnedRecommendation(tenantId, recommendationId);
    await this.queue.add(
      'apply',
      {
        accountId: rec.account_id,
        recommendationId,
        force: !!opts.force,
        resolvedBy: opts.resolvedBy,
      },
      {
        jobId: `rec-apply-${recommendationId}-${Date.now()}`,
        removeOnComplete: 30,
        removeOnFail: 20,
      },
    );
    return { ok: true, message: 'Apply enfileirado.' };
  }

  async enqueueDismiss(
    tenantId: string,
    recommendationId: string,
    opts: { resolvedBy: string },
  ) {
    const rec = await this.requireOwnedRecommendation(tenantId, recommendationId);
    await this.queue.add(
      'dismiss',
      {
        accountId: rec.account_id,
        recommendationId,
        resolvedBy: opts.resolvedBy,
      },
      {
        jobId: `rec-dismiss-${recommendationId}-${Date.now()}`,
        removeOnComplete: 30,
        removeOnFail: 20,
      },
    );
    return { ok: true, message: 'Dismiss enfileirado.' };
  }

  private async requireOwnedRecommendation(
    tenantId: string,
    recommendationId: string,
  ) {
    const rec = await this.prisma.trafficRecommendation.findUnique({
      where: { id: recommendationId },
      select: { id: true, tenant_id: true, account_id: true, status: true },
    });
    if (!rec || rec.tenant_id !== tenantId) {
      throw new HttpException(
        'Recomendação não encontrada.',
        HttpStatus.NOT_FOUND,
      );
    }
    return rec;
  }
}
