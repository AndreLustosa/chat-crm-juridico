import { Module } from '@nestjs/common';
import { PlatformBootstrapService } from './platform-bootstrap.service';
import { PlatformService } from './platform.service';
import { PlatformController } from './platform.controller';

/**
 * Modulo da administracao da PLATAFORMA (SaaS back-office), restrito ao
 * SUPER_ADMIN (dono da plataforma). Le apenas o banco da aplicacao (lustosa) —
 * nunca toca em outros sistemas que compartilham infraestrutura.
 *
 * Fase 1: promove o(s) dono(s) via PLATFORM_OWNER_EMAIL no boot.
 * Fase 2: lista de escritorios (GET /platform/tenants, /platform/stats).
 * Fase 3: gestao (suspender/excluir).
 */
@Module({
  controllers: [PlatformController],
  providers: [PlatformBootstrapService, PlatformService],
})
export class PlatformModule {}
