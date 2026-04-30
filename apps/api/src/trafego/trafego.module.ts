import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TrafegoController } from './trafego.controller';
import { TrafegoService } from './trafego.service';
import { TrafegoOAuthService } from './trafego-oauth.service';
import { TrafegoCryptoService } from './trafego-crypto.service';
import { TrafegoConfigService } from './trafego-config.service';
import { TrafegoEventsService } from './trafego-events.service';
import { TrafegoAiService } from './trafego-ai.service';
import { TrafegoLeadFormService } from './trafego-lead-form.service';
import { TrafegoAudiencesService } from './trafego-audiences.service';
import { TrafegoRecommendationsService } from './trafego-recommendations.service';

/**
 * Modulo de Gestao de Trafego Google Ads.
 *
 * Lifecycle das fases:
 *   - Fase 1 (atual): CRUD esqueleto + OAuth + leitura de TrafficAccount/Settings
 *   - Fase 2: Worker sincroniza metricas reais via Google Ads API
 *   - Fase 3: Dashboard com KPIs/graficos
 *   - Fase 4: Alertas + Relatorios PDF
 *   - Fase 5 (Sprint C): IA Otimizadora — TrafficIADecision/Policy/Memory
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: 'trafego-sync' }),
    BullModule.registerQueue({ name: 'trafego-mutate' }),
    BullModule.registerQueue({ name: 'trafego-oci' }),
    BullModule.registerQueue({ name: 'trafego-ai-agent' }),
    BullModule.registerQueue({ name: 'trafego-customer-match' }),
    BullModule.registerQueue({ name: 'trafego-recommendations' }),
  ],
  controllers: [TrafegoController],
  providers: [
    TrafegoService,
    TrafegoOAuthService,
    TrafegoCryptoService,
    TrafegoConfigService,
    TrafegoEventsService,
    TrafegoAiService,
    TrafegoLeadFormService,
    TrafegoAudiencesService,
    TrafegoRecommendationsService,
  ],
  exports: [
    TrafegoService,
    TrafegoOAuthService,
    TrafegoCryptoService,
    TrafegoConfigService,
    TrafegoEventsService,
    TrafegoAiService,
    TrafegoLeadFormService,
    TrafegoAudiencesService,
    TrafegoRecommendationsService,
  ],
})
export class TrafegoModule {}
