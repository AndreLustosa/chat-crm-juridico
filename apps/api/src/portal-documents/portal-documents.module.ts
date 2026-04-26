import { Module } from '@nestjs/common';
import { PortalDocumentsService } from './portal-documents.service';
import { PortalDocumentsController } from './portal-documents.controller';
import { PortalDocumentFetcherService } from './portal-document-fetcher.service';
import { PortalAuthModule } from '../portal-auth/portal-auth.module';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [PortalAuthModule, MediaModule],
  providers: [PortalDocumentsService, PortalDocumentFetcherService],
  controllers: [PortalDocumentsController],
  exports: [PortalDocumentFetcherService],
})
export class PortalDocumentsModule {}
