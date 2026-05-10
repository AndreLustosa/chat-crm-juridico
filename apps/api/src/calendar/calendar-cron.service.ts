import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { CronRunnerService } from '../common/cron/cron-runner.service';

@Injectable()
export class CalendarCronService {
  private readonly logger = new Logger(CalendarCronService.name);

  constructor(
    private prisma: PrismaService,
    private chatGateway: ChatGateway,
    @InjectQueue('calendar-reminders') private reminderQueue: Queue,
    private cronRunner: CronRunnerService,
  ) {}

  /**
   * Check for PUSH reminders every minute.
   * Finds reminders where:
   * - channel = PUSH
   * - sent_at IS NULL
   * - trigger time (event.start_at - minutes_before) is within now..now+2min
   * - event not cancelled/concluded
   *
   * Bug fix 2026-05-10 (PR1 Tarefas+Calendario, #5): comparacao com NOW()
   * estava 3h off. `ce.start_at` eh `timestamp without time zone` e armazena
   * wall-clock BRT (convencao "UTC naive BRT" — ver timezone.util.ts). NOW()
   * eh timestamptz e devolve UTC real. Quando PG comparava `timestamp` com
   * `timestamptz`, ele convertia o timestamp pra timestamptz usando session
   * TZ (UTC), gerando 3h de defasagem: reminder de evento 08:20 BRT (gravado
   * como 08:20 UTC) era comparado com NOW=11:20 UTC e nunca batia 30min antes
   * do horario real.
   *
   * Fix: usar `(NOW() AT TIME ZONE 'America/Maceio')::timestamp` pra obter o
   * wall-clock BRT atual como timestamp without TZ — assim casa com a
   * convencao do `start_at`. Pre-calcular num CTE evita re-avaliar NOW() por
   * linha (PG ja garante isso, mas explicito eh mais legivel).
   */
  @Cron('*/1 * * * *')
  async checkPushReminders() {
    await this.cronRunner.run(
      'calendar-push-reminders',
      2 * 60,
      async () => {
      const reminders = await this.prisma.$queryRaw<
        { id: string; event_id: string; minutes_before: number; title: string; type: string; start_at: Date; assigned_user_id: string | null }[]
      >`
        WITH brt_now AS (
          SELECT (NOW() AT TIME ZONE 'America/Maceio')::timestamp AS ts
        )
        SELECT er.id, er.event_id, er.minutes_before,
               ce.title, ce.type, ce.start_at, ce.assigned_user_id
        FROM "EventReminder" er
        JOIN "CalendarEvent" ce ON er.event_id = ce.id
        CROSS JOIN brt_now
        WHERE er.channel = 'PUSH'
          AND er.sent_at IS NULL
          AND ce.start_at - (er.minutes_before * interval '1 minute')
              BETWEEN brt_now.ts AND brt_now.ts + INTERVAL '2 minutes'
          AND ce.status NOT IN ('CANCELADO', 'CONCLUIDO', 'ADIADO')
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
      },
      { description: 'Dispara lembretes PUSH (Socket.IO) 1min antes do evento', schedule: '*/1 * * * *' },
    );
  }

  /**
   * Cron de fallback para WHATSAPP + EMAIL: pega reminders cujo trigger
   * time ja passou mas ainda nao foram enviados (sent_at IS NULL).
   *
   * Contexto: quando o container da API reinicia (OOM, deploy, etc), jobs
   * do BullMQ com `delay` calculado no momento da criacao podem ser perdidos
   * se a ficaram no Redis mas o trigger ja passou enquanto o worker estava
   * fora. O backfill SQL tambem cria EventReminders pra eventos antigos
   * sem enfileirar na BullMQ.
   *
   * Este cron roda a cada 5 min e pega orfaos — enfileira com delay=0 pra
   * disparar na hora. Usa jobId diferente (`fallback-*`) pra nao conflitar
   * com jobs originais.
   *
   * Filtros de seguranca:
   *   - Evento nao CANCELADO/CONCLUIDO/ADIADO
   *   - Trigger time > NOW() - 12h (nao dispara reminder muito antigo)
   *   - Evento ainda vai acontecer OU aconteceu ha menos de 2h
   */
  // Bug fix 2026-05-10 (PR1 #6): mesmo problema de timezone do
  // checkPushReminders. NOW() devolvia UTC real e `ce.start_at` eh wall-clock
  // BRT como timestamp naive — comparacao ficava 3h off. Resultado pratico:
  // reminders WHATSAPP/EMAIL antigos (>9h) caiam fora do range "12h", e os
  // reminders novos ficavam 3h "no futuro" (NOW comparado contra start_at
  // ja convertido). Funcionava por sorte pra eventos do dia atual mas
  // pulava reminders proximos do horario real BRT.
  @Cron('*/5 * * * *')
  async checkOrphanReminders() {
    await this.cronRunner.run(
      'calendar-orphan-reminders',
      5 * 60,
      async () => {
      const orphans = await this.prisma.$queryRaw<
        { id: string; event_id: string; channel: string; minutes_before: number; start_at: Date }[]
      >`
        WITH brt_now AS (
          SELECT (NOW() AT TIME ZONE 'America/Maceio')::timestamp AS ts
        )
        SELECT er.id, er.event_id, er.channel, er.minutes_before, ce.start_at
        FROM "EventReminder" er
        JOIN "CalendarEvent" ce ON er.event_id = ce.id
        CROSS JOIN brt_now
        WHERE er.sent_at IS NULL
          AND er.channel IN ('WHATSAPP', 'EMAIL')
          AND ce.status NOT IN ('CANCELADO', 'CONCLUIDO', 'ADIADO')
          AND ce.start_at > brt_now.ts - INTERVAL '2 hours'
          AND ce.start_at - (er.minutes_before * interval '1 minute') < brt_now.ts
          AND ce.start_at - (er.minutes_before * interval '1 minute') > brt_now.ts - INTERVAL '12 hours'
        ORDER BY ce.start_at ASC
        LIMIT 50
      `;

      if (orphans.length === 0) return;

      this.logger.log(
        `[CRON-FALLBACK] Encontrados ${orphans.length} reminders orfaos pra re-enfileirar`,
      );

      for (const r of orphans) {
        const jobId = `fallback-${r.id}`;
        try {
          // Remove job anterior com mesmo id (idempotencia)
          const old = await this.reminderQueue.getJob(jobId);
          if (old) await old.remove();

          await this.reminderQueue.add(
            'send-reminder',
            {
              reminderId: r.id,
              eventId: r.event_id,
              channel: r.channel,
            },
            {
              delay: 0,
              jobId,
              attempts: 3,
              backoff: { type: 'exponential', delay: 5000 },
              removeOnComplete: true,
              removeOnFail: 50,
            },
          );
          this.logger.log(
            `[CRON-FALLBACK] Re-enfileirado: ${r.channel} reminder=${r.id} (${r.minutes_before}min antes de ${r.start_at.toISOString()})`,
          );
        } catch (e: any) {
          this.logger.warn(`[CRON-FALLBACK] Falha ao enfileirar ${r.id}: ${e.message}`);
        }
      }
      },
      { description: 'Re-enfileira reminders WHATSAPP/EMAIL orfaos (perdidos em restart)', schedule: '*/5 * * * *' },
    );
  }

  /**
   * Cron diario 6h: marca como "descartados" reminders WHATSAPP/EMAIL muito
   * antigos (>24h do trigger) que nunca dispararam. Evita acumulo + evita
   * o fallback cron ficar re-tentando orfaos muito velhos que nao valem
   * mais notificar (audiencia que ja aconteceu dia anterior, etc).
   *
   * "Descartar" = preenche sent_at com agora + loga motivo. Assim saem do
   * pool de pendentes no dashboard mas ficam no historico.
   */
  // Bug fix 2026-05-10 (PR1 #7): NOW() comparado com `ce.start_at` wall-clock
  // BRT estava 3h off — descarte rodava 3h "antes" do esperado, deixando
  // alguns reminders pendentes que deveriam ter sido marcados.
  // sent_at recebe NOW() (timestamptz) que e gravado como wall-clock UTC no
  // banco, mas isso e ok pra audit (mostra quando o cron rodou no relogio
  // do servidor). Apenas a comparacao temporal e sensivel a timezone.
  @Cron('0 6 * * *', { timeZone: 'America/Maceio' })
  async discardStaleReminders() {
    await this.cronRunner.run(
      'calendar-discard-stale-reminders',
      10 * 60,
      async () => {
      const result = await this.prisma.$executeRaw`
        UPDATE "EventReminder" er
        SET sent_at = (NOW() AT TIME ZONE 'America/Maceio')::timestamp
        FROM "CalendarEvent" ce
        WHERE er.event_id = ce.id
          AND er.sent_at IS NULL
          AND ce.start_at - (er.minutes_before * interval '1 minute')
              < (NOW() AT TIME ZONE 'America/Maceio')::timestamp - INTERVAL '24 hours'
      `;
      if (result > 0) {
        this.logger.log(`[CRON-DISCARD] ${result} reminders vencidos ha mais de 24h marcados como descartados`);
      }
      },
      { description: 'Marca como descartados reminders WHATSAPP/EMAIL vencidos > 24h', schedule: '0 6 * * *' },
    );
  }
}
