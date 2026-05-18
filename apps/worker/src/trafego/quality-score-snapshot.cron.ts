import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Cron daily — snapshot de Quality Score por keyword (Sprint 2.1, 2026-05-17).
 *
 * Sem isso, traffic_get_quality_score_history retorna apenas o snapshot
 * atual cacheado em TrafficKeyword.quality_info. Pra serie temporal real
 * (ultimos N dias), este cron faz upsert diario em
 * TrafficKeywordQualitySnapshot.
 *
 * Roda 03h Maceio (antes do cron de sync principal, mas depois do
 * enhanced-conv-leads-upload que roda 04h). Pega keywords com
 * quality_score != null e faz upsert por (keyword_id, captured_at_date).
 *
 * Idempotente: se rodar 2x no mesmo dia, sobrescreve (unique constraint
 * on (keyword_id, captured_at_date)).
 *
 * Performance: 1 query por tenant pra listar keywords + N upserts. Pra
 * conta com 1000 keywords, ~30s. Aceitavel pra cron daily.
 */
@Injectable()
export class QualityScoreSnapshotCron {
  private readonly logger = new Logger(QualityScoreSnapshotCron.name);

  constructor(private prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, {
    name: 'quality-score-snapshot',
    timeZone: 'America/Maceio',
  })
  async dailySnapshot(): Promise<void> {
    const t0 = Date.now();
    const capturedAt = new Date();
    const capturedAtDate = new Date(
      capturedAt.getFullYear(),
      capturedAt.getMonth(),
      capturedAt.getDate(),
    );

    // Pega TODAS as keywords (cross-tenant) com quality_score nao null e
    // status ENABLED (PAUSED/REMOVED nao precisam de snapshot).
    const keywords = await this.prisma.trafficKeyword.findMany({
      where: {
        quality_score: { not: null },
        status: 'ENABLED',
        negative: false, // negativas nao tem QS
      },
      select: {
        id: true,
        tenant_id: true,
        account_id: true,
        quality_score: true,
        quality_info: true,
      },
    });

    this.logger.log(
      `[qs-snapshot] iniciando — ${keywords.length} keywords pra snapshotar`,
    );

    let upsertedOk = 0;
    let upsertedFail = 0;

    for (const kw of keywords) {
      try {
        const qi = (kw.quality_info as any) ?? {};
        await this.prisma.trafficKeywordQualitySnapshot.upsert({
          where: {
            keyword_id_captured_at_date: {
              keyword_id: kw.id,
              captured_at_date: capturedAtDate,
            },
          },
          update: {
            quality_score: kw.quality_score!,
            expected_ctr: qi.expected_clickthrough_rate ?? qi.expected_ctr ?? null,
            ad_relevance: qi.creative_quality_score ?? qi.ad_relevance ?? null,
            landing_page_experience:
              qi.post_click_quality_score ??
              qi.landing_page_experience ??
              null,
            captured_at: capturedAt,
          },
          create: {
            tenant_id: kw.tenant_id,
            account_id: kw.account_id,
            keyword_id: kw.id,
            quality_score: kw.quality_score!,
            expected_ctr: qi.expected_clickthrough_rate ?? qi.expected_ctr ?? null,
            ad_relevance: qi.creative_quality_score ?? qi.ad_relevance ?? null,
            landing_page_experience:
              qi.post_click_quality_score ??
              qi.landing_page_experience ??
              null,
            captured_at: capturedAt,
            captured_at_date: capturedAtDate,
          },
        });
        upsertedOk += 1;
      } catch (e: any) {
        upsertedFail += 1;
        this.logger.warn(`[qs-snapshot] keyword ${kw.id} falhou: ${e.message}`);
      }
    }

    const elapsed = Date.now() - t0;
    this.logger.log(
      `[qs-snapshot] concluido em ${elapsed}ms — upserts ok=${upsertedOk} fail=${upsertedFail}`,
    );
  }
}
