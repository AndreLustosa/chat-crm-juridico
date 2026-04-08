import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MediaController } from './media.controller';
import { MediaS3Service } from './s3.service';
import { MediaEventsService } from './media-events.service';
import { AiEventsService } from './ai-events.service';
import { GoogleDriveModule } from '../google-drive/google-drive.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'media-jobs' }),
    forwardRef(() => GoogleDriveModule),
  ],
  controllers: [MediaController],
  providers: [MediaS3Service, MediaEventsService, AiEventsService],
  exports: [MediaS3Service],
})
export class MediaModule {}
