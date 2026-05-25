import { Module } from '@nestjs/common';
import { PlatformBootstrapService } from './platform-bootstrap.service';

/**
 * Modulo da administracao da PLATAFORMA (SaaS back-office), restrito ao
 * SUPER_ADMIN (dono da plataforma). Le apenas o banco da aplicacao (lustosa) —
 * nunca toca em outros sistemas que compartilham infraestrutura.
 *
 * Fase 1: promove o(s) dono(s) via PLATFORM_OWNER_EMAIL no boot.
 * Fases seguintes: controller de escritorios (listagem, status, gestao).
 */
@Module({
  providers: [PlatformBootstrapService],
})
export class PlatformModule {}
