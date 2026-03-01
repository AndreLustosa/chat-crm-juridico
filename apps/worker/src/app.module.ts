import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './prisma/prisma.module';
import { S3Module } from './s3/s3.module';
import { SettingsModule } from './settings/settings.module';
import { MediaModule } from './media/media.module';
import { AiModule } from './ai/ai.module';

@Module({
  imports: [
    PrismaModule,
    S3Module,
    SettingsModule,
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
    }),
    MediaModule,
    AiModule
  ],
})
export class AppModule {}
