import { Module } from '@nestjs/common';
import { PortalSchedulingService } from './portal-scheduling.service';
import { PortalSchedulingController } from './portal-scheduling.controller';
import { PortalAuthModule } from '../portal-auth/portal-auth.module';
import { CalendarModule } from '../calendar/calendar.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [PortalAuthModule, CalendarModule, WhatsappModule],
  providers: [PortalSchedulingService],
  controllers: [PortalSchedulingController],
})
export class PortalSchedulingModule {}
