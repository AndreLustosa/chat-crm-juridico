import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { TrafegoSyncService } from './trafego-sync.service';
import { TrafegoCryptoService } from './trafego-crypto.service';
import { TrafegoConfigService } from './trafego-config.service';
import { GoogleAdsClientService } from './google-ads-client.service';
import { GoogleAdsMutateService } from './google-ads-mutate.service';
import { TrafegoAlertEvaluatorService } from './trafego-alert-evaluator.service';
import { TrafegoAlertNotifierService } from './trafego-alert-notifier.service';
import { TrafegoMutateProcessor } from './trafego-mutate.processor';
import { TrafegoSyncExtendedService } from './trafego-sync-extended.service';
import { TrafficOCIService } from './trafego-oci.service';
import { TrafficOCIProcessor } from './trafego-oci.processor';
import { TrafficRecommendationsService } from './traffic-recommendations.service';
import { TrafficRecommendationsProcessor } from './traffic-recommendations.processor';
import { TrafficBackfillService } from './traffic-backfill.service';
import { TrafficBackfillProcessor } from './traffic-backfill.processor';

/**
 * Worker do modulo de Trafego.
 *
 * Pos-cleanup (2026-05-17): a IA interna (ai-agent + chat + LLM wrapper +
 * customer-match + reach-planner) foi removida — gestao de trafego agora
 * roda via Claude (Cowork) atraves do traffic-mcp-server.
 *
 * Services que ficaram:
 *   - TrafegoSyncService + Extended: sync diario com Google Ads
 *   - GoogleAdsClient + Mutate: cliente OAuth + mutate validado (OAB)
 *   - TrafegoAlertEvaluator + Notifier: detecta CPL alto, CTR baixo etc
 *   - TrafegoMutateProcessor: consome fila trafego-mutate (pause, budget, RSA, etc)
 *   - TrafficOCIService + Processor: Offline Conversion Import (Lead -> conversion)
 *   - TrafficRecommendationsService + Processor: sync/apply do MCP
 *   - TrafficBackfillService + Processor: historico ate 90d
 *
 * Filas BullMQ removidas: trafego-ai-agent, trafego-chat, trafego-customer-match,
 * trafego-reach-planner.
 */
@Module({
  imports: [
    PrismaModule,
    SettingsModule,
    BullModule.registerQueue({ name: 'trafego-sync' }),
    BullModule.registerQueue({ name: 'trafego-mutate' }),
    BullModule.registerQueue({ name: 'trafego-oci' }),
    BullModule.registerQueue({ name: 'trafego-recommendations' }),
    BullModule.registerQueue({ name: 'trafego-backfill' }),
  ],
  providers: [
    TrafegoCryptoService,
    TrafegoConfigService,
    GoogleAdsClientService,
    GoogleAdsMutateService,
    TrafegoAlertEvaluatorService,
    TrafegoAlertNotifierService,
    TrafegoSyncService,
    TrafegoSyncExtendedService,
    TrafegoMutateProcessor,
    TrafficOCIService,
    TrafficOCIProcessor,
    TrafficRecommendationsService,
    TrafficRecommendationsProcessor,
    TrafficBackfillService,
    TrafficBackfillProcessor,
  ],
  exports: [
    TrafficOCIService,
    TrafficRecommendationsService,
    TrafficBackfillService,
  ],
})
export class TrafegoModule {}
