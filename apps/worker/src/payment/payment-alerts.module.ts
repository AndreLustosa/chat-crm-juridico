import { Module } from '@nestjs/common';
import { PaymentAlertsCronService } from './payment-alerts-cron.service';

@Module({
  providers: [PaymentAlertsCronService],
})
export class PaymentAlertsModule {}
