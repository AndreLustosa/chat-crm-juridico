import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaS3Service } from './s3.service';
import { MediaEventsService } from './media-events.service';

@Module({
  controllers: [MediaController],
  providers: [MediaS3Service, MediaEventsService],
  exports: [MediaS3Service],
})
export class MediaModule {}
