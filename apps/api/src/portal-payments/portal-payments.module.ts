import { Module } from '@nestjs/common';
import { PortalPaymentsService } from './portal-payments.service';
import { PortalPaymentsController } from './portal-payments.controller';
import { PortalAuthModule } from '../portal-auth/portal-auth.module';

@Module({
  imports: [PortalAuthModule],
  providers: [PortalPaymentsService],
  controllers: [PortalPaymentsController],
})
export class PortalPaymentsModule {}
