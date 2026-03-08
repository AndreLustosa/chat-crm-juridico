import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { LeadsModule } from './leads/leads.module';
import { ConversationsModule } from './conversations/conversations.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { MessagesModule } from './messages/messages.module';
import { GatewayModule } from './gateway/gateway.module';
import { TasksModule } from './tasks/tasks.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { SettingsModule } from './settings/settings.module';
import { InboxesModule } from './inboxes/inboxes.module';
import { SectorsModule } from './sectors/sectors.module';
import { MediaModule } from './media/media.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { TransferAudioModule } from './transfer-audio/transfer-audio.module';
import { LegalCasesModule } from './legal-cases/legal-cases.module';
import { DjenModule } from './djen/djen.module';
import { FichaTrabalhistaModule } from './ficha-trabalhista/ficha-trabalhista.module';
import { CalendarModule } from './calendar/calendar.module';
import { CaseDocumentsModule } from './case-documents/case-documents.module';
import { CaseDeadlinesModule } from './case-deadlines/case-deadlines.module';

import { HealthController } from './common/controllers/health.controller';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { RolesGuard } from './auth/guards/roles.guard';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379'),
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          retryStrategy(times) {
            const delay = Math.min(times * 50, 2000);
            return delay;
          },
        },
      }),
    }),
    PrismaModule, 
    UsersModule, 
    AuthModule, 
    LeadsModule, 
    ConversationsModule,
    WebhooksModule,
    MessagesModule,
    GatewayModule,
    TasksModule,
    WhatsappModule,
    SettingsModule,
    InboxesModule,
    SectorsModule,
    MediaModule,
    AnalyticsModule,
    TransferAudioModule,
    LegalCasesModule,
    DjenModule,
    FichaTrabalhistaModule,
    CalendarModule,
    CaseDocumentsModule,
    CaseDeadlinesModule,
  ],
  controllers: [AppController, HealthController],
  providers: [
    AppService,
    {
      provide: APP_FILTER,
      useClass: PrismaExceptionFilter,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
