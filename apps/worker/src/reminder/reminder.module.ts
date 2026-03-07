import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ReminderProcessor } from './reminder.processor';

@Module({
  imports: [BullModule.registerQueue({ name: 'calendar-reminders' })],
  providers: [ReminderProcessor],
})
export class ReminderModule {}
