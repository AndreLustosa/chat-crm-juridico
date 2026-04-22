import { Controller, Post, Body, UseGuards, Request, HttpCode, HttpStatus } from '@nestjs/common';
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
