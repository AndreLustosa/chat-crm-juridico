import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Sync diario de metricas Google Ads.
 *
 * Cron: 06:00 America/Maceio (todos os dias).
 *
 * Para cada TrafficAccount com status=ACTIVE e sync_enabled=true:
 *   1. Decripta refresh_token, troca por access_token
 *   2. Chama Google Ads API SearchStream pra ultimos 7 dias
 *   3. Upserta TrafficCampaign (metadata)
 *   4. Upserta TrafficMetricDaily (metricas)
 *   5. Avalia regras de alerta -> dispara TrafficAlert se aplicavel
 *   6. Grava TrafficSyncLog com resultado
 *
 * STUB: Fase 1 só registra um log "skipped — Google Ads API integration pending".
 * Implementacao real entra na Fase 2 quando Basic Access for aprovado.
 */
@Injectable()
export class TrafegoSyncService {
  private readonly logger = new Logger(TrafegoSyncService.name);

  constructor(private prisma: PrismaService) {}

  /** Cron: 06h Maceio. Para cada conta ativa, dispara sync individual. */
  @Cron('0 6 * * *', { timeZone: 'America/Maceio' })
  async runDailySync() {
    const accounts = await this.prisma.trafficAccount.findMany({
      where: { status: 'ACTIVE' },
      include: {
        tenant: {
          select: {
            traffic_settings: { select: { sync_enabled: true } },
          },
        },
      },
    });

    if (accounts.length === 0) {
      this.logger.log('[TRAFEGO_SYNC] Nenhuma conta ativa — skip');
      return;
    }

    this.logger.log(`[TRAFEGO_SYNC] Iniciando sync de ${accounts.length} conta(s)`);

    for (const account of accounts) {
      const enabled = account.tenant?.traffic_settings?.sync_enabled ?? true;
      if (!enabled) {
        this.logger.log(`[TRAFEGO_SYNC] Conta ${account.id} — sync desabilitado`);
        continue;
      }
      await this.syncAccount(account.id, 'CRON');
    }
  }

  /**
   * Sync de uma conta especifica. Pode ser chamado pelo cron ou manualmente
   * via worker queue (Fase 2).
   *
   * STUB: Fase 1 só grava sync log.
   */
  async syncAccount(accountId: string, trigger: 'CRON' | 'MANUAL' | 'OAUTH_CALLBACK') {
    const startedAt = new Date();
    const account = await this.prisma.trafficAccount.findUnique({
      where: { id: accountId },
    });
    if (!account) {
      this.logger.warn(`[TRAFEGO_SYNC] Conta ${accountId} nao encontrada`);
      return;
    }

    try {
      // ──────────────────────────────────────────────────────────────────
      // STUB Fase 1
      // ──────────────────────────────────────────────────────────────────
      // Implementacao real (Fase 2):
      //   1. const accessToken = await this.oauth.getAccessToken(account.refresh_token_enc);
      //   2. const ads = new GoogleAdsApi({...}).Customer({customer_id, login_customer_id, refresh_token: accessToken});
      //   3. const campaigns = await ads.query(`SELECT campaign.id, campaign.name, ... FROM campaign`);
      //   4. const metrics  = await ads.query(`SELECT metrics.* FROM campaign WHERE segments.date DURING LAST_7_DAYS`);
      //   5. Upsert nas tabelas
      //   6. Avalia regras de alerta
      // ──────────────────────────────────────────────────────────────────

      this.logger.log(
        `[TRAFEGO_SYNC] Conta ${account.customer_id} — STUB (Fase 1, Google Ads API pendente)`,
      );

      const finishedAt = new Date();
      const durationMs = finishedAt.getTime() - startedAt.getTime();

      await this.prisma.trafficSyncLog.create({
        data: {
          tenant_id: account.tenant_id,
          account_id: account.id,
          trigger,
          status: 'SUCCESS',
          rows_upserted: 0,
          campaigns_seen: 0,
          duration_ms: durationMs,
          started_at: startedAt,
          finished_at: finishedAt,
          error_message:
            'STUB Fase 1: integracao Google Ads API ainda nao implementada (aguardando Basic Access).',
        },
      });

      await this.prisma.trafficAccount.update({
        where: { id: account.id },
        data: { last_sync_at: finishedAt, last_error: null },
      });
    } catch (error: any) {
      this.logger.error(
        `[TRAFEGO_SYNC] Conta ${account.customer_id} — falhou: ${error.message}`,
      );
      const finishedAt = new Date();
      await this.prisma.trafficSyncLog.create({
        data: {
          tenant_id: account.tenant_id,
          account_id: account.id,
          trigger,
          status: 'ERROR',
          duration_ms: finishedAt.getTime() - startedAt.getTime(),
          started_at: startedAt,
          finished_at: finishedAt,
          error_message: error.message?.slice(0, 2000),
        },
      });
      await this.prisma.trafficAccount.update({
        where: { id: account.id },
        data: { status: 'ERROR', last_error: error.message?.slice(0, 500) },
      });
    }
  }

  /**
   * Limpeza diaria: TrafficSyncLog mais antigos que 90 dias.
   * Cron: 02:30 Maceio (depois do horario de baixa atividade).
   */
  @Cron('30 2 * * *', { timeZone: 'America/Maceio' })
  async pruneOldSyncLogs() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);

    const result = await this.prisma.trafficSyncLog.deleteMany({
      where: { started_at: { lt: cutoff } },
    });

    if (result.count > 0) {
      this.logger.log(
        `[TRAFEGO_SYNC] Purge: ${result.count} sync log(s) > 90 dias removido(s)`,
      );
    }
  }
}
