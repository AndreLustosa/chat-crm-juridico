import { Module } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { ConversationsController } from './conversations.controller';
import { SlaCronService } from './sla-cron.service';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { InboxesModule } from '../inboxes/inboxes.module';

@Module({
  // InboxesModule: o SlaCronService usa o round-robin (getNextAssignee).
  // ChatGateway, PrismaService e CronRunnerService são @Global (injeção direta).
  imports: [WhatsappModule, InboxesModule],
  controllers: [ConversationsController],
  providers: [ConversationsService, SlaCronService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
