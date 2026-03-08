import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EvolutionService } from './evolution.service';
import { EvolutionController } from './evolution.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { LeadsModule } from '../leads/leads.module';
import { InboxesModule } from '../inboxes/inboxes.module';
import { SettingsModule } from '../settings/settings.module';
import { HmacGuard } from './guards/hmac.guard';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [
    PrismaModule,
    LeadsModule,
    InboxesModule,
    SettingsModule,
    WhatsappModule,
    BullModule.registerQueue({
      name: 'media-jobs',
    }),
    BullModule.registerQueue({
      name: 'ai-jobs',
    }),
  ],
  controllers: [EvolutionController],
  providers: [EvolutionService, HmacGuard],
  exports: [EvolutionService],
})
export class WebhooksModule {}
