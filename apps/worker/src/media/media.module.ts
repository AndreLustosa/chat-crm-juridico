import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MediaProcessor } from './media.processor';

@Module({
  imports: [BullModule.registerQueue({ name: 'media-jobs' })],
  providers: [MediaProcessor],
})
export class MediaModule {}
