import { Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueEvents } from 'bullmq';
import { SettingsModule } from '../settings/settings.module';
import { TrafegoController } from './trafego.controller';
import { TrafegoService } from './trafego.service';
import { TrafegoOAuthService } from './trafego-oauth.service';
import { TrafegoCryptoService } from './trafego-crypto.service';
import { TrafegoConfigService } from './trafego-config.service';
import { TrafegoEventsService } from './trafego-events.service';
import { TrafegoLeadFormService } from './trafego-lead-form.service';
import { TrafegoRecommendationsService } from './trafego-recommendations.service';
import { TrafegoBackfillService } from './trafego-backfill.service';
import { TrafegoMappingAiService } from './trafego-mapping-ai.service';
import {
  TRAFEGO_MUTATE_QUEUE_EVENTS,
  TRAFEGO_ENHANCED_CONV_QUEUE_EVENTS,
  TRAFEGO_READ_QUEUE_EVENTS,
} from './trafego.tokens';

/**
 * Modulo de Gestao de Trafego Google Ads.
 *
 * Pos-cleanup (2026-05-17): a IA interna do CRM (agent loop + chat) foi
 * removida, junto com features sem uso (audiences, asset-groups,
 * reach-planner, landing-pages, optimization heuristics). A gestao de
 * trafego agora roda via Claude (Cowork) atraves do traffic-mcp-server.
 *
 * Services que ficaram:
 *   - TrafegoService: leitura de TrafficAccount/Campaign/MetricDaily + mutates internos
 *   - TrafegoOAuthService: fluxo OAuth do Google Ads
 *   - TrafegoCryptoService: AES-256-GCM pra secrets em repouso
 *   - TrafegoConfigService: leitura DB-first + env fallback de credenciais
 *   - TrafegoEventsService: emite eventos pra OCI (usado por LeadsModule/LegalCases)
 *   - TrafegoLeadFormService: webhook do Lead Form Asset do Google
 *   - TrafegoRecommendationsService: lista/aplica recommendations do Google (usado pelo MCP)
 *   - TrafegoBackfillService: backfill historico (UI ConfiguracoesTab)
 *   - TrafegoMappingAiService: gerador de RSA com IA (usado pelo CreateRsaModal)
 *
 * Filas BullMQ ativas: trafego-sync, trafego-mutate, trafego-oci, trafego-backfill,
 * trafego-recommendations. Filas removidas: trafego-ai-agent, trafego-chat,
 * trafego-customer-match, trafego-reach-planner.
 */
@Module({
  imports: [
    SettingsModule,
    BullModule.registerQueue({ name: 'trafego-sync' }),
    BullModule.registerQueue({ name: 'trafego-mutate' }),
    BullModule.registerQueue({ name: 'trafego-oci' }),
    BullModule.registerQueue({ name: 'trafego-recommendations' }),
    BullModule.registerQueue({ name: 'trafego-backfill' }),
    BullModule.registerQueue({ name: 'trafego-enhanced-conv' }),
    BullModule.registerQueue({ name: 'trafego-read' }),
  ],
  controllers: [TrafegoController],
  providers: [
    TrafegoService,
    TrafegoOAuthService,
    TrafegoCryptoService,
    TrafegoConfigService,
    TrafegoEventsService,
    TrafegoLeadFormService,
    TrafegoRecommendationsService,
    TrafegoBackfillService,
    TrafegoMappingAiService,
    {
      provide: TRAFEGO_MUTATE_QUEUE_EVENTS,
      // Singleton — cria conexao Redis dedicada pra escutar eventos da
      // fila trafego-mutate. Reusada por enqueueMutate em cada request.
      useFactory: (): QueueEvents => {
        return new QueueEvents('trafego-mutate', {
          prefix: process.env.BULL_PREFIX || 'bull',
          connection: {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379'),
            maxRetriesPerRequest: null,
          },
        });
      },
    },
    {
      provide: TRAFEGO_ENHANCED_CONV_QUEUE_EVENTS,
      useFactory: (): QueueEvents => {
        return new QueueEvents('trafego-enhanced-conv', {
          prefix: process.env.BULL_PREFIX || 'bull',
          connection: {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379'),
            maxRetriesPerRequest: null,
          },
        });
      },
    },
    {
      provide: TRAFEGO_READ_QUEUE_EVENTS,
      useFactory: (): QueueEvents => {
        return new QueueEvents('trafego-read', {
          prefix: process.env.BULL_PREFIX || 'bull',
          connection: {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379'),
            maxRetriesPerRequest: null,
          },
        });
      },
    },
  ],
  exports: [
    TrafegoService,
    TrafegoOAuthService,
    TrafegoCryptoService,
    TrafegoConfigService,
    TrafegoEventsService,
    TrafegoLeadFormService,
    TrafegoRecommendationsService,
    TrafegoBackfillService,
    TrafegoMappingAiService,
  ],
})
export class TrafegoModule implements OnModuleDestroy {
  constructor(
    @Inject(TRAFEGO_MUTATE_QUEUE_EVENTS)
    private readonly mutateQueueEvents: QueueEvents,
    @Inject(TRAFEGO_ENHANCED_CONV_QUEUE_EVENTS)
    private readonly enhancedConvQueueEvents: QueueEvents,
    @Inject(TRAFEGO_READ_QUEUE_EVENTS)
    private readonly readQueueEvents: QueueEvents,
  ) {}

  async onModuleDestroy(): Promise<void> {
    // Fecha conexoes Redis dos QueueEvents pra app shutdown limpo.
    await Promise.allSettled([
      this.mutateQueueEvents.close(),
      this.enhancedConvQueueEvents.close(),
      this.readQueueEvents.close(),
    ]);
  }
}
