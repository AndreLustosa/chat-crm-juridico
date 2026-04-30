import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TrafegoController } from './trafego.controller';
import { TrafegoService } from './trafego.service';
import { TrafegoOAuthService } from './trafego-oauth.service';
import { TrafegoCryptoService } from './trafego-crypto.service';
import { TrafegoConfigService } from './trafego-config.service';
import { TrafegoEventsService } from './trafego-events.service';

/**
 * Modulo de Gestao de Trafego Google Ads.
 *
 * Lifecycle das fases:
 *   - Fase 1 (atual): CRUD esqueleto + OAuth + leitura de TrafficAccount/Settings
 *   - Fase 2: Worker sincroniza metricas reais via Google Ads API
 *   - Fase 3: Dashboard com KPIs/graficos
 *   - Fase 4: Alertas + Relatorios PDF
 *   - Fase 5: IA Otimizadora
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: 'trafego-sync' }),
    BullModule.registerQueue({ name: 'trafego-mutate' }),
    BullModule.registerQueue({ name: 'trafego-oci' }),
  ],
  controllers: [TrafegoController],
  providers: [
    TrafegoService,
    TrafegoOAuthService,
    TrafegoCryptoService,
    TrafegoConfigService,
    TrafegoEventsService,
  ],
  exports: [
    TrafegoService,
    TrafegoOAuthService,
    TrafegoCryptoService,
    TrafegoConfigService,
    TrafegoEventsService,
  ],
})
export class TrafegoModule {}
