import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { MediaModule } from '../media/media.module';
import { SettingsModule } from '../settings/settings.module';
import { AudienciaTranscricaoController } from './audiencia-transcricao.controller';
import { AudienciaTranscricaoService, TRANSCRIPTION_QUEUE } from './audiencia-transcricao.service';

@Module({
  imports: [
    PrismaModule,
    MediaModule,
    SettingsModule,
    BullModule.registerQueue({ name: TRANSCRIPTION_QUEUE }),
  ],
  controllers: [AudienciaTranscricaoController],
  providers: [AudienciaTranscricaoService],
  exports: [AudienciaTranscricaoService],
})
export class AudienciaTranscricaoModule {}
