import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MediaController } from './media.controller';
import { MediaS3Service } from './s3.service';
import { MediaEventsService } from './media-events.service';
import { AiEventsService } from './ai-events.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'media-jobs' }),
  ],
  controllers: [MediaController],
  providers: [MediaS3Service, MediaEventsService, AiEventsService],
  exports: [MediaS3Service],
})
export class MediaModule {}
