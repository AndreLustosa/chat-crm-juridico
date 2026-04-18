import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MemoriesController } from './memories.controller';
import { MemoriesService } from './memories.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'memory-jobs' }),
    SettingsModule,
  ],
  controllers: [MemoriesController],
  providers: [MemoriesService],
  exports: [MemoriesService],
})
export class MemoriesModule {}
