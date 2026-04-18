import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { S3Module } from './s3/s3.module';
import { SettingsModule } from './settings/settings.module';
import { MediaModule } from './media/media.module';
import { AiModule } from './ai/ai.module';
import { ReminderModule } from './reminder/reminder.module';
import { FollowupModule } from './followup/followup.module';
import { PaymentAlertsModule } from './payment/payment-alerts.module';
import { TaskAlertsModule } from './task/task-alerts.module';
import { FinanceiroRecurringModule } from './financeiro/financeiro-recurring.module';
import { NotificationWhatsappModule } from './notification-whatsapp/notification-whatsapp.module';
import { AfterHoursModule } from './after-hours/after-hours.module';

@Module({
  imports: [
    PrismaModule,
    S3Module,
    SettingsModule,
    ScheduleModule.forRoot(),
    BullModule.forRoot({
      prefix: process.env.BULL_PREFIX || 'bull',
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        maxRetriesPerRequest: null,        // BullMQ requer null
        enableReadyCheck: false,           // evita erros de startup
        retryStrategy: (times: number) => Math.min(times * 500, 5000),
      },
    }),
    MediaModule,
    AiModule,
    ReminderModule,
    FollowupModule,
    PaymentAlertsModule,
    TaskAlertsModule,
    FinanceiroRecurringModule,
    NotificationWhatsappModule,
    AfterHoursModule,
  ],
})
export class AppModule {}
