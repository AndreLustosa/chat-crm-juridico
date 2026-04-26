import { Module } from '@nestjs/common';
import { PortalDocumentsService } from './portal-documents.service';
import { PortalDocumentsController } from './portal-documents.controller';
import { PortalAuthModule } from '../portal-auth/portal-auth.module';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [PortalAuthModule, MediaModule],
  providers: [PortalDocumentsService],
  controllers: [PortalDocumentsController],
})
export class PortalDocumentsModule {}
