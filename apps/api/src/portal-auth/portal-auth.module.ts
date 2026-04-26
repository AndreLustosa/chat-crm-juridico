import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PortalAuthService } from './portal-auth.service';
import { PortalAuthController } from './portal-auth.controller';
import { ClientJwtAuthGuard } from './client-jwt-auth.guard';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

/**
 * Modulo de auth do portal do cliente. Reusa JWT_SECRET do AuthModule (mesma
 * chave, audience diferente) — facilita rotacao e simplifica config.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.JWT_SECRET || '__INSECURE_DEV_FALLBACK_CHANGE_ME__',
        // expiresIn aplicado por chamada (verifyCode usa 7d).
      }),
    }),
    WhatsappModule,
  ],
  providers: [PortalAuthService, ClientJwtAuthGuard],
  controllers: [PortalAuthController],
  exports: [PortalAuthService, ClientJwtAuthGuard, JwtModule],
})
export class PortalAuthModule {}
