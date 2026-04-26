import { Module } from '@nestjs/common';
import { PortalProcessesService } from './portal-processes.service';
import { PortalProcessesController } from './portal-processes.controller';
import { PortalAuthModule } from '../portal-auth/portal-auth.module';
import { SettingsModule } from '../settings/settings.module';

/**
 * Modulo de processos do portal. Depende de:
 * - PortalAuthModule: ClientJwtAuthGuard (cookie portal_token)
 * - SettingsModule: SettingsService pra IA explainMovement
 */
@Module({
  imports: [PortalAuthModule, SettingsModule],
  providers: [PortalProcessesService],
  controllers: [PortalProcessesController],
})
export class PortalProcessesModule {}
