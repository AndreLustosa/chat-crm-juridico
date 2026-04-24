import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Request, Put, Res, ForbiddenException } from '@nestjs/common';
import type { Response } from 'express';
import { CalendarService } from './calendar.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CreateEventDto,
  UpdateEventDto,
  CreateAppointmentTypeDto,
  UpdateAppointmentTypeDto,
  CreateHolidayDto,
  UpdateHolidayDto,
} from './dto/calendar.dto';

@UseGuards(JwtAuthGuard)
@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  // ─── Events CRUD ──────────────────────────────────────

  @Get('events')
  findAll(
    @Query('start') start: string | undefined,
    @Query('end') end: string | undefined,
    @Query('type') type: string | undefined,
    @Query('userId') userId: string | undefined,
    @Query('leadId') leadId: string | undefined,
    @Query('legalCaseId') legalCaseId: string | undefined,
    @Query('search') search: string | undefined,
    @Query('showAll') showAll: string | undefined,
    @Request() req: any,
  ) {
    // Regras de visibilidade (RBAC):
    //
    //   ADMIN        → pode ver TUDO (showAll=true) ou filtrar por userId
    //                  especifico (pra auditoria/supervisao).
    //
    //   ADVOGADO/    → SEMPRE ve apenas eventos onde eh responsavel
    //   OPERADOR/      (assigned_user_id = ele) ou criou (created_by_id
    //   demais         se sem responsavel). `showAll` e `userId` da query
    //                  sao IGNORADOS — impede vazamento lateral de prazos
    //                  de outros advogados.
    //
    // Bug reportado 2026-04-24: advogado nao-admin estava vendo prazos
    // de todos os outros advogados porque showAll=true burlava o filtro
    // (o antigo canViewAll = isAdmin || (showAll && isAdvogado) deixava
    // qualquer ADVOGADO com showAll=true ver tudo).
    const isAdmin = req.user?.roles?.includes('ADMIN');
    const effectiveUserId = isAdmin
      ? (showAll === 'true' ? undefined : (userId || req.user.id))
      : req.user.id; // nao-admin: SEMPRE o proprio (ignora userId/showAll)
    return this.calendarService.findAll({
      start,
      end,
      type,
      userId: effectiveUserId,
      leadId,
      legalCaseId,
      search,
      tenantId: req.user?.tenant_id,
    });
  }

  // IMPORTANTE: rotas com paths fixos ANTES de :id para evitar conflito
  @Get('events/legal-case/:caseId')
  findByLegalCase(@Param('caseId') caseId: string, @Query('type') type: string | undefined, @Request() req: any) {
    return this.calendarService.findByLegalCase(caseId, type, req.user?.tenant_id);
  }

  @Get('events/:id')
  findOne(@Param('id') id: string) {
    return this.calendarService.findOne(id);
  }

  @Post('events')
  create(@Body() data: CreateEventDto, @Request() req: any) {
    return this.calendarService.create({
      ...data,
      created_by_id: req.user.id,
      tenant_id: req.user?.tenant_id,
    });
  }

  @Patch('events/:id')
  async update(
    @Param('id') id: string,
    @Body() data: UpdateEventDto,
    @Query('updateScope') updateScope: string | undefined,
    @Request() req: any,
  ) {
    const canEdit = await this.calendarService.checkOwnership(id, req.user.id, req.user.roles, req.user?.tenant_id);
    if (!canEdit) throw new ForbiddenException('Sem permissao para editar este evento');

    if (updateScope === 'all') {
      return this.calendarService.updateRecurrenceAll(id, data);
    }
    return this.calendarService.update(id, data);
  }

  @Patch('events/:id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string; completion_note?: string },
    @Request() req: any,
  ) {
    const canEdit = await this.calendarService.checkOwnership(id, req.user.id, req.user.roles, req.user?.tenant_id);
    if (!canEdit) throw new ForbiddenException('Sem permissao para alterar status deste evento');
    return this.calendarService.updateStatus(id, body.status, body.completion_note, req.user?.id);
  }

  @Post('events/:id/notify')
  async notifyEvent(@Param('id') id: string) {
    return this.calendarService.notifyEvent(id);
  }

  @Delete('events/:id')
  async remove(
    @Param('id') id: string,
    @Query('deleteScope') deleteScope: string | undefined,
    @Request() req: any,
  ) {
    const canEdit = await this.calendarService.checkOwnership(id, req.user.id, req.user.roles, req.user?.tenant_id);
    if (!canEdit) throw new ForbiddenException('Sem permissao para remover este evento');

    if (deleteScope === 'all') {
      return this.calendarService.removeRecurrenceAll(id);
    }
    return this.calendarService.remove(id);
  }

  // ─── Event Comments ──────────────────────────────────

  @Get('events/:id/comments')
  async findComments(@Param('id') id: string, @Request() req: any) {
    const canAccess = await this.calendarService.checkOwnership(id, req.user.id, req.user.roles, req.user?.tenant_id);
    if (!canAccess) throw new ForbiddenException('Sem permissao para acessar este evento');
    return this.calendarService.findComments(id);
  }

  @Post('events/:id/comments')
  async addComment(@Param('id') id: string, @Body('text') text: string, @Request() req: any) {
    const canAccess = await this.calendarService.checkOwnership(id, req.user.id, req.user.roles, req.user?.tenant_id);
    if (!canAccess) throw new ForbiddenException('Sem permissao para comentar neste evento');
    return this.calendarService.addComment(id, req.user.id, text);
  }

  // ─── Conflict Detection ─────────────────────────────────

  @Get('conflicts')
  checkConflicts(
    @Query('userId') userId: string,
    @Query('start') start: string,
    @Query('end') end: string,
    @Query('excludeId') excludeId: string | undefined,
    @Request() req: any,
  ) {
    // Usuários não-admin só podem checar conflitos da própria agenda
    const isAdmin = req.user?.roles?.includes('ADMIN');
    const effectiveUserId = isAdmin ? (userId || req.user.id) : req.user.id;
    return this.calendarService.checkConflicts(effectiveUserId, start, end, excludeId, req.user?.tenant_id);
  }

  // ─── Availability ─────────────────────────────────────

  @Get('availability/:userId')
  getAvailability(
    @Param('userId') userId: string,
    @Query('date') date: string,
    @Query('duration') duration: string,
    @Request() req: any,
  ) {
    return this.calendarService.getAvailability(userId, date, parseInt(duration) || 30, req.user?.tenant_id);
  }

  @Get('schedule/:userId')
  getSchedule(@Param('userId') userId: string) {
    return this.calendarService.getSchedule(userId);
  }

  @Put('schedule/:userId')
  setSchedule(
    @Param('userId') userId: string,
    @Body('slots') slots: { day_of_week: number; start_time: string; end_time: string }[],
  ) {
    return this.calendarService.setSchedule(userId, slots);
  }

  // ─── Appointment Types ────────────────────────────────

  @Get('appointment-types')
  findAppointmentTypes(@Request() req: any) {
    return this.calendarService.findAppointmentTypes(req.user?.tenant_id);
  }

  @Post('appointment-types')
  @Roles('ADMIN')
  createAppointmentType(@Body() data: CreateAppointmentTypeDto, @Request() req: any) {
    return this.calendarService.createAppointmentType({
      ...data,
      tenant_id: req.user?.tenant_id,
    });
  }

  @Patch('appointment-types/:id')
  @Roles('ADMIN')
  updateAppointmentType(@Param('id') id: string, @Body() data: UpdateAppointmentTypeDto) {
    return this.calendarService.updateAppointmentType(id, data);
  }

  @Delete('appointment-types/:id')
  @Roles('ADMIN')
  deleteAppointmentType(@Param('id') id: string) {
    return this.calendarService.deleteAppointmentType(id);
  }

  // ─── Holidays ─────────────────────────────────────────

  @Get('holidays')
  findHolidays(@Request() req: any) {
    return this.calendarService.findHolidays(req.user?.tenant_id);
  }

  @Post('holidays')
  @Roles('ADMIN')
  createHoliday(@Body() data: CreateHolidayDto, @Request() req: any) {
    return this.calendarService.createHoliday({
      ...data,
      tenant_id: req.user?.tenant_id,
    });
  }

  @Patch('holidays/:id')
  @Roles('ADMIN')
  updateHoliday(@Param('id') id: string, @Body() data: UpdateHolidayDto) {
    return this.calendarService.updateHoliday(id, data);
  }

  @Delete('holidays/:id')
  @Roles('ADMIN')
  deleteHoliday(@Param('id') id: string) {
    return this.calendarService.deleteHoliday(id);
  }

  // ─── Search ───────────────────────────────────────────

  @Get('search')
  search(@Query('q') q: string, @Request() req: any) {
    return this.calendarService.search(q || '', req.user?.tenant_id);
  }

  // ─── ICS Export ───────────────────────────────────────

  @Get('export/ics/:id')
  async exportEventIcs(@Param('id') id: string, @Res() res: Response) {
    const icsContent = await this.calendarService.exportICS([id]);
    res.set({
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="event-${id}.ics"`,
    });
    res.send(icsContent);
  }

  @Get('export/ics')
  async exportRangeIcs(
    @Query('start') start: string,
    @Query('end') end: string,
    @Query('userId') userId: string | undefined,
    @Request() req: any,
    @Res() res: Response,
  ) {
    const events = await this.calendarService.findAll({
      start,
      end,
      userId,
      tenantId: req.user?.tenant_id,
    });
    const ids = events.map((e: any) => e.id);
    const icsContent = await this.calendarService.exportICS(ids);
    res.set({
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="calendar-export.ics"',
    });
    res.send(icsContent);
  }

  // ─── Migration ────────────────────────────────────────

  @Post('migrate-tasks')
  @Roles('ADMIN')
  async migrateTasks() {
    return this.calendarService.migrateOrphanTasks();
  }
}
