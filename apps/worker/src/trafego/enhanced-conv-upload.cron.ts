import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TrafficOCIService } from './trafego-oci.service';

/**
 * Cron daily — Enhanced Conversions for Leads upload em batch.
 *
 * Sprint 1.5 (2026-05-17): pra `traffic_enable_enhanced_conversions_for_leads`
 * modo API/BOTH ficar realmente util sem gclid (cookieless world), precisa
 * subir userIdentifiers (email/phone hashed SHA-256) periodicamente.
 *
 * Pipeline:
 *   1. Roda diariamente as 04h Maceio
 *   2. Pra cada TrafficSettings com enhanced_conv_for_leads_upload_enabled=true:
 *      a. Lista leads dos ultimos 14 dias criados nesse tenant
 *      b. Pra cada lead, chama TrafficOCIService.enqueueUpload com
 *         trigger_event="lead.created" e conversion_at=lead.created_at
 *      c. O enqueue ja faz dedupe via unique(action, gclid, time) — leads
 *         ja uploadados anteriormente caem em duplicate_skipped
 *
 * Pode tambem ser disparado manualmente via endpoint REST
 * `POST /trafego/conversion-tracking/trigger-enhanced-conv-upload`.
 *
 * Janela de 14 dias eh defensiva: Google aceita conversoes ate 90 dias
 * pos-click. 14 cobre re-upload de leads que ficaram pendentes (worker
 * em manutencao, falha temporaria de auth, etc) sem ressuscitar lead
 * antigo demais.
 */
@Injectable()
export class EnhancedConvUploadCron {
  private readonly logger = new Logger(EnhancedConvUploadCron.name);

  constructor(
    private prisma: PrismaService,
    private oci: TrafficOCIService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM, {
    name: 'enhanced-conv-leads-upload',
    timeZone: 'America/Maceio',
  })
  async dailyUpload(): Promise<void> {
    await this.runForAllTenants({ daysBack: 14, manual: false });
  }

  /**
   * Disparado por endpoint manual. Aceita janela customizada e flag manual=true
   * (audit log distingue).
   */
  async triggerManual(opts: {
    tenantId?: string;
    daysBack?: number;
  }): Promise<{
    tenants_processed: number;
    leads_enqueued: number;
    leads_skipped: number;
    errors: number;
  }> {
    return await this.runForAllTenants({
      tenantId: opts.tenantId,
      daysBack: opts.daysBack ?? 14,
      manual: true,
    });
  }

  /**
   * Logica central — usada pelo cron e pelo trigger manual.
   *
   * Se tenantId passado, processa so esse tenant. Senao, processa todos
   * com flag enhanced_conv_for_leads_upload_enabled=true.
   */
  private async runForAllTenants(opts: {
    tenantId?: string;
    daysBack: number;
    manual: boolean;
  }): Promise<{
    tenants_processed: number;
    leads_enqueued: number;
    leads_skipped: number;
    errors: number;
  }> {
    const t0 = Date.now();
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - opts.daysBack);

    const settingsList = await this.prisma.trafficSettings.findMany({
      where: {
        enhanced_conv_for_leads_upload_enabled: true,
        ...(opts.tenantId && { tenant_id: opts.tenantId }),
      },
      select: { tenant_id: true },
    });

    if (settingsList.length === 0) {
      this.logger.log(
        `[enhanced-conv-cron] Nenhum tenant com enhanced_conv flag ligado${
          opts.tenantId ? ` (tenantId=${opts.tenantId})` : ''
        } — skip.`,
      );
      return {
        tenants_processed: 0,
        leads_enqueued: 0,
        leads_skipped: 0,
        errors: 0,
      };
    }

    let totalEnqueued = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (const { tenant_id } of settingsList) {
      try {
        // Leads criados na janela. Pre-filtra os que tem email OU phone —
        // sem isso nao tem signal pra Enhanced Conv matching no Google.
        const leads = await this.prisma.lead.findMany({
          where: {
            tenant_id,
            created_at: { gte: since },
            OR: [{ email: { not: null } }, { phone: { not: '' } }],
          },
          select: { id: true, created_at: true },
        });

        for (const lead of leads) {
          try {
            const r = await this.oci.enqueueUpload({
              tenantId: tenant_id,
              leadId: lead.id,
              triggerEvent: 'lead.created',
              conversionAt: lead.created_at,
              manual: opts.manual,
            });
            if (r.uploadId) {
              totalEnqueued += 1;
            } else {
              totalSkipped += 1;
              // Log so se nao for duplicate (esperado pra leads ja uploadados)
              if (r.reason && r.reason !== 'duplicate_skipped') {
                this.logger.debug(
                  `[enhanced-conv-cron] tenant=${tenant_id} lead=${lead.id} skipped=${r.reason}`,
                );
              }
            }
          } catch (e: any) {
            totalErrors += 1;
            this.logger.warn(
              `[enhanced-conv-cron] tenant=${tenant_id} lead=${lead.id} error=${e?.message}`,
            );
          }
        }
      } catch (e: any) {
        totalErrors += 1;
        this.logger.error(
          `[enhanced-conv-cron] tenant=${tenant_id} fatal=${e?.message}`,
        );
      }
    }

    const elapsed = Date.now() - t0;
    this.logger.log(
      `[enhanced-conv-cron] ${opts.manual ? 'MANUAL' : 'CRON'} concluido em ${elapsed}ms ` +
        `tenants=${settingsList.length} enfileirados=${totalEnqueued} skipados=${totalSkipped} erros=${totalErrors}`,
    );

    return {
      tenants_processed: settingsList.length,
      leads_enqueued: totalEnqueued,
      leads_skipped: totalSkipped,
      errors: totalErrors,
    };
  }
}
