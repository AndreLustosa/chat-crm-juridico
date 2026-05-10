import { Controller, Post, Get, Body, Query, UseGuards, Request, HttpCode, HttpStatus } from '@nestjs/common';
import { EventsService, EventTarget } from './events.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

/**
 * Events — endpoints unificados de cumprimento/cancelamento/adiamento
 * que funcionam pra CalendarEvent, Task e CaseDeadline.
 *
 * O frontend passa { type, id } no body e a API dispatcha pro servico
 * certo. Resolve a fragmentacao anterior onde cada tipo tinha endpoint
 * proprio e o frontend precisava saber qual chamar.
 */
@UseGuards(JwtAuthGuard)
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  /**
   * Historico unificado de cumprimento/cancelamento pra um caso ou lead.
   * Query params:
   *   - legal_case_id: filtra por caso (preferido)
   *   - lead_id: filtra por lead (abrangente — inclui eventos sem legal_case)
   *   - limit: default 100
   */
  @Get('history')
  history(
    @Query('legal_case_id') legalCaseId: string | undefined,
    @Query('lead_id') leadId: string | undefined,
    @Query('limit') limit: string | undefined,
    @Request() req: any,
  ) {
    return this.eventsService.history({
      legalCaseId,
      leadId,
      tenantId: req.user?.tenant_id,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  // Bug fix 2026-05-10 (PR1 Tarefas+Calendario): controllers passavam
  // tenant_id mas NAO passavam roles — efetivamente nao-admin podia
  // completar/cancelar/adiar evento de qualquer outro user no mesmo
  // tenant. EventsService.verifyOwnership precisa de roles pra liberar
  // ADMIN sem precisar do checkOwnership por entidade.
  @Post('complete')
  @HttpCode(HttpStatus.OK)
  complete(
    @Body() body: { type: 'CALENDAR' | 'TASK' | 'DEADLINE'; id: string; note?: string },
    @Request() req: any,
  ) {
    const target: EventTarget = { type: body.type, id: body.id };
    return this.eventsService.complete(target, body.note, req.user?.id, req.user?.tenant_id, req.user?.roles);
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @Body() body: { type: 'CALENDAR' | 'TASK' | 'DEADLINE'; id: string; reason?: string },
    @Request() req: any,
  ) {
    const target: EventTarget = { type: body.type, id: body.id };
    return this.eventsService.cancel(target, body.reason, req.user?.id, req.user?.tenant_id, req.user?.roles);
  }

  @Post('postpone')
  @HttpCode(HttpStatus.OK)
  postpone(
    @Body() body: { type: 'CALENDAR' | 'TASK' | 'DEADLINE'; id: string; new_date: string; reason?: string },
    @Request() req: any,
  ) {
    const target: EventTarget = { type: body.type, id: body.id };
    return this.eventsService.postpone(
      target,
      body.new_date,
      body.reason || 'Sem motivo informado',
      req.user?.id,
      req.user?.tenant_id,
      req.user?.roles,
    );
  }

  @Post('complete-hearing')
  @HttpCode(HttpStatus.OK)
  completeHearing(
    @Body() body: {
      id: string;
      result: string;
      note?: string;
      deadline_date?: string;
      deadline_title?: string;
      acordo_honorario_value?: number;
      acordo_honorario_parcelas?: number;
      contratual_honorario_value?: number;
      contratual_honorario_parcelas?: number;
    },
    @Request() req: any,
  ) {
    return this.eventsService.completeHearing(
      body.id,
      {
        note: body.note,
        result: body.result,
        deadline_date: body.deadline_date,
        deadline_title: body.deadline_title,
        acordo_honorario_value: body.acordo_honorario_value,
        acordo_honorario_parcelas: body.acordo_honorario_parcelas,
        contratual_honorario_value: body.contratual_honorario_value,
        contratual_honorario_parcelas: body.contratual_honorario_parcelas,
      },
      req.user?.id,
      req.user?.tenant_id,
      req.user?.roles,
    );
  }

  @Post('reopen')
  @HttpCode(HttpStatus.OK)
  reopen(
    @Body() body: { type: 'CALENDAR' | 'TASK' | 'DEADLINE'; id: string },
    @Request() req: any,
  ) {
    const target: EventTarget = { type: body.type, id: body.id };
    return this.eventsService.reopen(target, req.user?.tenant_id, req.user?.id, req.user?.roles);
  }
}
