import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { FollowupController } from './followup.controller';
import { FollowupService } from './followup.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    // Anti-ban (2026-05-13): retry com backoff exponencial pra erros 5xx/network
    // transitorios do Evolution. attempts=3 = 1 tentativa inicial + 2 retries.
    // Backoff exponencial 30s/60s/120s. removeOnComplete pra nao inflar redis.
    BullModule.registerQueue({
      name: 'followup-jobs',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
      },
    }),
  ],
  controllers: [FollowupController],
  providers: [FollowupService],
  exports: [FollowupService],
})
export class FollowupModule {}
