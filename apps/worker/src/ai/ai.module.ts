import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AiProcessor } from './ai.processor';

@Module({
  imports: [BullModule.registerQueue({ name: 'ai-jobs' })],
  providers: [AiProcessor],
})
export class AiModule {}
