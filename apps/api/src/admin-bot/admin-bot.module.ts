import { Module, forwardRef } from '@nestjs/common';
import { AdminBotService } from './admin-bot.service';
import { PrismaModule } from '../prisma/prisma.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { TasksModule } from '../tasks/tasks.module';
import { CalendarModule } from '../calendar/calendar.module';
import { FinanceiroModule } from '../financeiro/financeiro.module';
import { PaymentGatewayModule } from '../payment-gateway/payment-gateway.module';

@Module({
  imports: [
    PrismaModule,
    WhatsappModule,
    TasksModule,
    CalendarModule,
    forwardRef(() => FinanceiroModule),
    forwardRef(() => PaymentGatewayModule),
  ],
  providers: [AdminBotService],
  exports: [AdminBotService],
})
export class AdminBotModule {}
