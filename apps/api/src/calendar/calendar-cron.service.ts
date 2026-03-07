import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../gateway/chat.gateway';

@Injectable()
export class CalendarCronService {
  private readonly logger = new Logger(CalendarCronService.name);

  constructor(
    private prisma: PrismaService,
    private chatGateway: ChatGateway,
  ) {}

  /**
   * Check for PUSH reminders every minute.
   * Finds reminders where:
   * - channel = PUSH
   * - sent_at IS NULL
   * - trigger time (event.start_at - minutes_before) is within now..now+2min
   * - event not cancelled/concluded
   */
  @Cron('*/1 * * * *')
  async checkPushReminders() {
    try {
      const now = new Date();
      const in2min = new Date(now.getTime() + 2 * 60 * 1000);

      const reminders = await this.prisma.$queryRaw<
        { id: string; event_id: string; minutes_before: number; title: string; type: string; start_at: Date; assigned_user_id: string | null }[]
      >`
        SELECT er.id, er.event_id, er.minutes_before,
               ce.title, ce.type, ce.start_at, ce.assigned_user_id
        FROM "EventReminder" er
        JOIN "CalendarEvent" ce ON er.event_id = ce.id
        WHERE er.channel = 'PUSH'
          AND er.sent_at IS NULL
          AND ce.start_at - (er.minutes_before * interval '1 minute') BETWEEN ${now} AND ${in2min}
          AND ce.status NOT IN ('CANCELADO', 'CONCLUIDO')
      `;

      if (reminders.length > 0) {
        this.logger.log(`[CRON] Encontrados ${reminders.length} lembretes PUSH para enviar`);
      }

      for (const r of reminders) {
        if (r.assigned_user_id) {
          try {
            this.chatGateway.emitCalendarReminder(r.assigned_user_id, {
              eventId: r.event_id,
              title: r.title,
              type: r.type,
              start_at: r.start_at.toISOString(),
              minutesBefore: r.minutes_before,
            });
          } catch (e: any) {
            this.logger.error(`[CRON] Erro ao emitir lembrete PUSH para user ${r.assigned_user_id}: ${e.message}`);
          }
        }

        // Mark as sent
        await this.prisma.eventReminder.update({
          where: { id: r.id },
          data: { sent_at: new Date() },
        });
      }
    } catch (e: any) {
      this.logger.error(`[CRON] Erro no checkPushReminders: ${e.message}`);
    }
  }
}
