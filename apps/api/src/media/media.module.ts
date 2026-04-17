import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MediaController } from './media.controller';
import { MediaS3Service } from './s3.service';
import { FileStorageService } from './filesystem.service';
import { AiEventsService } from './ai-events.service';
import { MediaDownloadService } from './media-download.service';
import { GoogleDriveModule } from '../google-drive/google-drive.module';
import { SettingsModule } from '../settings/settings.module';
import { GatewayModule } from '../gateway/gateway.module';

/**
 * Nota: a queue `media-jobs` é mantida APENAS para o job `sync_missed_messages`
 * (resync de mensagens após reconexão da instância WhatsApp). O download de mídia
 * foi migrado para o fluxo síncrono de MediaDownloadService (sem BullMQ).
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: 'media-jobs' }),
    forwardRef(() => GoogleDriveModule),
    forwardRef(() => GatewayModule),
    SettingsModule,
  ],
  controllers: [MediaController],
  providers: [MediaS3Service, FileStorageService, AiEventsService, MediaDownloadService],
  exports: [MediaS3Service, FileStorageService, MediaDownloadService],
})
export class MediaModule {}
