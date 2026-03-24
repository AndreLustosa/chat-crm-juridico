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
import { PetitionsModule } from './petitions/petitions.module';
import { LegalTemplatesModule } from './legal-templates/legal-templates.module';
import { HonorariosModule } from './honorarios/honorarios.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ContractsModule } from './contracts/contracts.module';
import { ClicksignModule } from './clicksign/clicksign.module';
import { S3Module } from './s3/s3.module';
import { McpModule } from './mcp/mcp.module';

import { HealthController } from './common/controllers/health.controller';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
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
    S3Module,
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
    PetitionsModule,
    LegalTemplatesModule,
    HonorariosModule,
    DashboardModule,
    ContractsModule,
    ClicksignModule,
    McpModule,
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
    // JwtAuthGuard deve vir ANTES de RolesGuard para popular req.user antes da checagem de roles
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
