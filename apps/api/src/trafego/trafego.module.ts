import { Module } from '@nestjs/common';
import { TrafegoController } from './trafego.controller';
import { TrafegoService } from './trafego.service';
import { TrafegoOAuthService } from './trafego-oauth.service';
import { TrafegoCryptoService } from './trafego-crypto.service';

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
  controllers: [TrafegoController],
  providers: [TrafegoService, TrafegoOAuthService, TrafegoCryptoService],
  exports: [TrafegoService, TrafegoOAuthService, TrafegoCryptoService],
})
export class TrafegoModule {}
