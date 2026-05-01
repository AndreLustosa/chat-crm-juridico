import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { CalendarService } from '../calendar/calendar.service';
import { TasksService } from '../tasks/tasks.service';
import { CaseDeadlinesService } from '../case-deadlines/case-deadlines.service';
import { HonorariosService } from '../honorarios/honorarios.service';
import { PrismaService } from '../prisma/prisma.service';

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
    private honorariosService: HonorariosService,
    private prisma: PrismaService,
  ) {}

  /**
   * Historico de cumprimento de um caso — lista unificada de todos os
   * CalendarEvents, Tasks e CaseDeadlines que ja foram cumpridos/cancelados,
   * ordenados por quando foram finalizados (completed_at desc).
   *
   * Dedup: se um CalendarEvent tem Task ou Deadline vinculados, aparece UMA
   * vez so (prioriza Calendar porque e o agregador natural).
   */
  async history(params: { legalCaseId?: string; leadId?: string; tenantId?: string; limit?: number }) {
    const limit = params.limit ?? 100;
    const tenantFilter = params.tenantId ? { tenant_id: params.tenantId } : {};

    const caseFilter: any = {};
    if (params.legalCaseId) caseFilter.legal_case_id = params.legalCaseId;
    if (params.leadId) caseFilter.lead_id = params.leadId;

    // 1. CalendarEvents terminais
    const calendarEvents = await this.prisma.calendarEvent.findMany({
      where: {
        status: { in: ['CONCLUIDO', 'CANCELADO'] },
        ...caseFilter,
        ...tenantFilter,
      },
      select: {
        id: true,
        type: true,
        title: true,
        status: true,
        start_at: true,
        completed_at: true,
        completion_note: true,
        completed_by: { select: { id: true, name: true } },
        task: { select: { id: true } },
        deadline: { select: { id: true } },
      },
      orderBy: { completed_at: 'desc' },
      take: limit,
    });

    // IDs de Task/Deadline ja cobertos via CalendarEvent (pra nao duplicar)
    const coveredTaskIds = new Set<string>();
    const coveredDeadlineIds = new Set<string>();
    for (const ce of calendarEvents) {
      if (ce.task?.id) coveredTaskIds.add(ce.task.id);
      if (ce.deadline?.id) coveredDeadlineIds.add(ce.deadline.id);
    }

    // 2. Tasks terminais (SEM calendar_event_id coberto acima)
    const tasks = await this.prisma.task.findMany({
      where: {
        status: { in: ['CONCLUIDA', 'CANCELADA'] },
        ...(params.legalCaseId ? { legal_case_id: params.legalCaseId } : {}),
        ...(params.leadId ? { lead_id: params.leadId } : {}),
        ...tenantFilter,
        id: { notIn: [...coveredTaskIds] },
      },
      select: {
        id: true,
        title: true,
        status: true,
        due_at: true,
        completed_at: true,
        completion_note: true,
        completed_by: { select: { id: true, name: true } },
      },
      orderBy: { completed_at: 'desc' },
      take: limit,
    });

    // 3. CaseDeadlines completed (SEM calendar_event_id coberto)
    const deadlines = params.legalCaseId
      ? await this.prisma.caseDeadline.findMany({
          where: {
            legal_case_id: params.legalCaseId,
            completed: true,
            id: { notIn: [...coveredDeadlineIds] },
            ...tenantFilter,
          },
          select: {
            id: true,
            type: true,
            title: true,
            due_at: true,
            completed_at: true,
            completion_note: true,
            completed_by: { select: { id: true, name: true } },
          },
          orderBy: { completed_at: 'desc' },
          take: limit,
        })
      : [];

    // Normalizar pro formato unificado
    const items = [
      ...calendarEvents.map(e => ({
        source: 'CALENDAR' as const,
        id: e.id,
        type: e.type,
        title: e.title,
        status: e.status,
        scheduled_at: e.start_at,
        completed_at: e.completed_at,
        completion_note: e.completion_note,
        completed_by: e.completed_by,
      })),
      ...tasks.map(t => ({
        source: 'TASK' as const,
        id: t.id,
        type: 'TAREFA',
        title: t.title,
        status: t.status,
        scheduled_at: t.due_at,
        completed_at: t.completed_at,
        completion_note: t.completion_note,
        completed_by: t.completed_by,
      })),
      ...deadlines.map(d => ({
        source: 'DEADLINE' as const,
        id: d.id,
        type: d.type,
        title: d.title,
        status: 'CONCLUIDO',
        scheduled_at: d.due_at,
        completed_at: d.completed_at,
        completion_note: d.completion_note,
        completed_by: d.completed_by,
      })),
    ];

    items.sort((a, b) => {
      const ta = a.completed_at?.getTime() ?? 0;
      const tb = b.completed_at?.getTime() ?? 0;
      return tb - ta;
    });

    return { total: items.length, items: items.slice(0, limit) };
  }

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
        return this.calendarService.updateStatus(target.id, 'CONCLUIDO', note, userId);
      case 'TASK':
        return this.tasksService.complete(target.id, note || '', userId, tenantId);
      case 'DEADLINE':
        return this.caseDeadlinesService.complete(target.id, tenantId, userId, note);
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
        return this.calendarService.updateStatus(target.id, 'CANCELADO', reason, userId);
      case 'TASK':
        return this.tasksService.updateStatus(target.id, 'CANCELADA', tenantId);
      case 'DEADLINE':
        // Deadline cancelado = nao e devido mais. Marcamos completed=true com
        // prefixo [CANCELADO] na note pra diferenciar cumprimento real de cancel.
        return this.caseDeadlinesService.complete(
          target.id,
          tenantId,
          userId,
          reason ? `[CANCELADO] ${reason}` : '[CANCELADO]',
        );
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
        // Atualiza só a data — mantém AGENDADO para o evento continuar aparecendo no painel.
        await this.calendarService.update(target.id, {
          start_at: newDateISO,
          status: 'AGENDADO',
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
   * Conclui audiência/perícia com ações pós-evento:
   * - Cria prazo de alegações finais se resultado = INSTRUCAO_ENCERRADA
   * - Avança tracking_stage do processo
   */
  async completeHearing(
    eventId: string,
    data: {
      note?: string;
      result: string;
      deadline_date?: string;
      deadline_title?: string;
      acordo_value?: number;
      fee_percentage?: number;
      installment_count?: number;
    },
    userId: string,
    tenantId?: string,
  ) {
    this.logger.log(`[CompleteHearing] event:${eventId} result:${data.result} por ${userId}`);

    const event = await this.prisma.calendarEvent.findUnique({
      where: { id: eventId },
      select: { id: true, type: true, legal_case_id: true },
    });
    if (!event) throw new BadRequestException('Evento não encontrado');

    const notePrefix = {
      INSTRUCAO_ENCERRADA: 'Instrução encerrada',
      ACORDO_CELEBRADO: 'Acordo celebrado',
      SENTENCA_PROFERIDA: 'Sentença proferida',
      REDESIGNADA: 'Audiência redesignada',
      OUTRA: '',
    }[data.result] || '';

    const fullNote = [notePrefix, data.note].filter(Boolean).join(' — ');

    if (data.result === 'REDESIGNADA' && data.deadline_date) {
      return this.postpone(
        { type: 'CALENDAR', id: eventId },
        data.deadline_date,
        fullNote || 'Redesignada',
        userId,
        tenantId,
      );
    }

    await this.calendarService.updateStatus(eventId, 'CONCLUIDO', fullNote || undefined, userId);

    const results: {
      completed: true;
      deadline_created?: boolean;
      stage_advanced?: string;
      honorario_created?: boolean;
    } = { completed: true };

    if (data.result === 'INSTRUCAO_ENCERRADA' && data.deadline_date && event.legal_case_id) {
      await this.caseDeadlinesService.create(
        event.legal_case_id,
        {
          type: 'MANIFESTACAO',
          title: data.deadline_title || 'Alegações Finais',
          due_at: data.deadline_date,
          alert_days: 3,
        },
        userId,
        tenantId,
      );
      results.deadline_created = true;
    }

    if (data.result === 'ACORDO_CELEBRADO' && data.acordo_value && event.legal_case_id) {
      const feeValue = data.fee_percentage
        ? Math.round(data.acordo_value * data.fee_percentage) / 100
        : data.acordo_value;
      try {
        await this.honorariosService.create(
          event.legal_case_id,
          {
            type: 'ACORDO',
            total_value: feeValue,
            installment_count: data.installment_count || 1,
            notes: `Acordo celebrado em audiência — valor total R$ ${data.acordo_value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}${data.fee_percentage ? ` (${data.fee_percentage}% honorários)` : ''}`,
          },
          tenantId,
          userId,
        );
        results.honorario_created = true;
      } catch (err: any) {
        this.logger.warn(`[CompleteHearing] Falha ao criar honorário: ${err.message}`);
      }
    }

    if (event.legal_case_id && data.result !== 'OUTRA') {
      const stageMap: Record<string, string> = {
        INSTRUCAO_ENCERRADA: 'ALEGACOES_FINAIS',
        SENTENCA_PROFERIDA: 'JULGAMENTO',
        ACORDO_CELEBRADO: 'EXECUCAO',
      };
      const newStage = stageMap[data.result];
      if (newStage) {
        await this.prisma.legalCase.update({
          where: { id: event.legal_case_id },
          data: { tracking_stage: newStage, stage_changed_at: new Date() },
        });
        results.stage_advanced = newStage;
      }
    }

    return results;
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
        return this.caseDeadlinesService.reopen(target.id, tenantId);
      default:
        throw new BadRequestException(`Tipo de evento invalido: ${(target as any).type}`);
    }
  }
}
