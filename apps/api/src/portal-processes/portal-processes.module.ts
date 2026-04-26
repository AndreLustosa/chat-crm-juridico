import { Module } from '@nestjs/common';
import { PortalProcessesService } from './portal-processes.service';
import { PortalProcessesController } from './portal-processes.controller';
import { PortalAuthModule } from '../portal-auth/portal-auth.module';
import { SettingsModule } from '../settings/settings.module';
import { PortalDocumentsModule } from '../portal-documents/portal-documents.module';

/**
 * Modulo de processos do portal. Depende de:
 * - PortalAuthModule: ClientJwtAuthGuard (cookie portal_token)
 * - SettingsModule: SettingsService pra IA explainMovement
 * - PortalDocumentsModule: PortalDocumentFetcherService pra baixar PDF
 *   de movimentacao via scraping do TJAL
 */
@Module({
  imports: [PortalAuthModule, SettingsModule, PortalDocumentsModule],
  providers: [PortalProcessesService],
  controllers: [PortalProcessesController],
})
export class PortalProcessesModule {}
