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

  @Post('complete')
  @HttpCode(HttpStatus.OK)
  complete(
    @Body() body: { type: 'CALENDAR' | 'TASK' | 'DEADLINE'; id: string; note?: string },
    @Request() req: any,
  ) {
    const target: EventTarget = { type: body.type, id: body.id };
    return this.eventsService.complete(target, body.note, req.user?.id, req.user?.tenant_id);
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @Body() body: { type: 'CALENDAR' | 'TASK' | 'DEADLINE'; id: string; reason?: string },
    @Request() req: any,
  ) {
    const target: EventTarget = { type: body.type, id: body.id };
    return this.eventsService.cancel(target, body.reason, req.user?.id, req.user?.tenant_id);
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
      acordo_value?: number;
      fee_percentage?: number;
      installment_count?: number;
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
        acordo_value: body.acordo_value,
        fee_percentage: body.fee_percentage,
        installment_count: body.installment_count,
      },
      req.user?.id,
      req.user?.tenant_id,
    );
  }

  @Post('reopen')
  @HttpCode(HttpStatus.OK)
  reopen(
    @Body() body: { type: 'CALENDAR' | 'TASK' | 'DEADLINE'; id: string },
    @Request() req: any,
  ) {
    const target: EventTarget = { type: body.type, id: body.id };
    return this.eventsService.reopen(target, req.user?.tenant_id);
  }
}
