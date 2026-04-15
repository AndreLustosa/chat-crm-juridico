import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EvolutionService } from './evolution.service';
import { EvolutionController } from './evolution.controller';
import { EvolutionAdminController } from './evolution-admin.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { LeadsModule } from '../leads/leads.module';
import { InboxesModule } from '../inboxes/inboxes.module';
import { SettingsModule } from '../settings/settings.module';
import { HmacGuard } from './guards/hmac.guard';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { AdminBotModule } from '../admin-bot/admin-bot.module';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [
    PrismaModule,
    LeadsModule,
    InboxesModule,
    SettingsModule,
    WhatsappModule,
    AdminBotModule,
    MediaModule,
    BullModule.registerQueue({ name: 'media-jobs' }),
    BullModule.registerQueue({ name: 'ai-jobs' }),
  ],
  controllers: [EvolutionController, EvolutionAdminController],
  providers: [EvolutionService, HmacGuard],
  exports: [EvolutionService],
})
export class WebhooksModule {}
