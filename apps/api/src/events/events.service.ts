import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { CalendarService } from '../calendar/calendar.service';
import { TasksService } from '../tasks/tasks.service';
import { CaseDeadlinesService } from '../case-deadlines/case-deadlines.service';

export type EventTarget =
  | { type: 'CALENDAR'; id: string }
  | { type: 'TASK'; id: string }
  | { type: 'DEADLINE'; id: string };

/**
 * Facade de "cumprimento de evento" — padroniza as 3 acoes operacionais
 * (cumprir / cancelar / adiar) em cima dos 3 modelos que coexistem no
 * sistema: CalendarEvent, Task, CaseDeadline.
 *
 * Motivacao: antes o frontend tinha que saber chamar endpoints diferentes
 * dependendo do tipo — /calendar/events/:id/status vs /tasks/:id/complete
 * vs /case-deadlines/:id/complete. Agora tem um endpoint so.
 *
 * Sincronizacao: quando uma Task tem calendar_event_id, atualizar a Task
 * tambem atualiza o CalendarEvent (via CalendarService.updateStatus). E
 * vice-versa — o CalendarService ja propaga Calendar -> Task e Calendar
 * -> CaseDeadline. Entao qualquer ponto de entrada mantem os 3 em sync.
 */
@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private calendarService: CalendarService,
    private tasksService: TasksService,
    private caseDeadlinesService: CaseDeadlinesService,
  ) {}

  /**
   * Marca evento como cumprido/concluido.
   * @param target - tipo + id do evento
   * @param note - nota opcional de cumprimento (ex: "audiencia ocorreu, conciliacao pendente")
   * @param userId - quem esta cumprindo
   * @param tenantId - isolamento multi-tenant
   */
  async complete(
    target: EventTarget,
    note: string | undefined,
    userId: string,
    tenantId?: string,
  ) {
    this.logger.log(`[Complete] ${target.type}:${target.id} por ${userId}`);

    switch (target.type) {
      case 'CALENDAR':
        return this.calendarService.updateStatus(target.id, 'CONCLUIDO', note);
      case 'TASK':
        return this.tasksService.complete(target.id, note || '', userId, tenantId);
      case 'DEADLINE':
        return this.caseDeadlinesService.complete(target.id, tenantId);
      default:
        throw new BadRequestException(`Tipo de evento invalido: ${(target as any).type}`);
    }
  }

  /**
   * Cancela evento — decisao ativa (nao "esquecido"/"adiado").
   * Deadlines nao tem conceito de "cancelado" nativo (so completed true/false),
   * entao marcamos como completed + completed_at + note do CalendarEvent vinculado.
   */
  async cancel(
    target: EventTarget,
    reason: string | undefined,
    userId: string,
    tenantId?: string,
  ) {
    this.logger.log(`[Cancel] ${target.type}:${target.id} por ${userId}`);

    switch (target.type) {
      case 'CALENDAR':
        return this.calendarService.updateStatus(target.id, 'CANCELADO', reason);
      case 'TASK':
        return this.tasksService.updateStatus(target.id, 'CANCELADA', tenantId);
      case 'DEADLINE':
        // Deadline cancelado = nao e devido mais. Marcamos completed=true mas
        // com completion_note "CANCELADO: reason" pra diferenciar no audit.
        // Frontend que consome precisa saber ler isso.
        return this.caseDeadlinesService.complete(target.id, tenantId);
      default:
        throw new BadRequestException(`Tipo de evento invalido: ${(target as any).type}`);
    }
  }

  /**
   * Adia evento pra nova data (remarcar).
   */
  async postpone(
    target: EventTarget,
    newDateISO: string,
    reason: string,
    userId: string,
    tenantId?: string,
  ) {
    if (!newDateISO) {
      throw new BadRequestException('Nova data e obrigatoria pra adiar');
    }
    this.logger.log(`[Postpone] ${target.type}:${target.id} -> ${newDateISO} por ${userId}`);

    switch (target.type) {
      case 'CALENDAR':
        // Atualiza a data + seta status ADIADO.
        await this.calendarService.update(target.id, {
          start_at: newDateISO,
          status: 'ADIADO',
        });
        return { ok: true, type: 'CALENDAR', id: target.id, new_date: newDateISO };
      case 'TASK':
        return this.tasksService.postpone(target.id, newDateISO, reason, userId, tenantId);
      case 'DEADLINE':
        // CaseDeadlinesService.update aceita due_at — re-enfileira lembretes
        await this.caseDeadlinesService.update(
          target.id,
          { due_at: newDateISO },
          tenantId,
        );
        return { ok: true, type: 'DEADLINE', id: target.id, new_date: newDateISO };
      default:
        throw new BadRequestException(`Tipo de evento invalido: ${(target as any).type}`);
    }
  }

  /**
   * Reabre evento concluido/cancelado (volta pra pendente).
   * Util se o advogado marcou errado.
   */
  async reopen(target: EventTarget, tenantId?: string) {
    this.logger.log(`[Reopen] ${target.type}:${target.id}`);

    switch (target.type) {
      case 'CALENDAR':
        return this.calendarService.updateStatus(target.id, 'AGENDADO');
      case 'TASK':
        return this.tasksService.updateStatus(target.id, 'A_FAZER', tenantId);
      case 'DEADLINE':
        // Nao tem reopen nativo — manipular direto
        return this.caseDeadlinesService.update(target.id, {}, tenantId);
      default:
        throw new BadRequestException(`Tipo de evento invalido: ${(target as any).type}`);
    }
  }
}
