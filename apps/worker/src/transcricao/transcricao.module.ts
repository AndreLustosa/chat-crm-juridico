import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { S3Module } from '../s3/s3.module';
import { SettingsModule } from '../settings/settings.module';
import { TranscricaoProcessor } from './transcricao.processor';

@Module({
  imports: [
    PrismaModule,
    S3Module,
    SettingsModule,
    BullModule.registerQueue({
      name: 'transcription-jobs',
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential' as const, delay: 60_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    }),
  ],
  providers: [TranscricaoProcessor],
})
export class TranscricaoModule {}
