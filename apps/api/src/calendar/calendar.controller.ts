import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Request, Put, Res, Header } from '@nestjs/common';
import type { Response } from 'express';
import { CalendarService } from './calendar.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

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
    @Request() req: any,
  ) {
    return this.calendarService.findAll({
      start,
      end,
      type,
      userId,
      leadId,
      legalCaseId,
      search,
      tenantId: req.user?.tenant_id,
    });
  }

  @Get('events/:id')
  findOne(@Param('id') id: string) {
    return this.calendarService.findOne(id);
  }

  @Post('events')
  create(@Body() data: any, @Request() req: any) {
    return this.calendarService.create({
      ...data,
      created_by_id: req.user.id,
      tenant_id: req.user?.tenant_id,
    });
  }

  @Patch('events/:id')
  update(
    @Param('id') id: string,
    @Body() data: any,
    @Query('updateScope') updateScope?: string,
  ) {
    if (updateScope === 'all') {
      return this.calendarService.updateRecurrenceAll(id, data);
    }
    return this.calendarService.update(id, data);
  }

  @Patch('events/:id/status')
  updateStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.calendarService.updateStatus(id, status);
  }

  @Delete('events/:id')
  remove(
    @Param('id') id: string,
    @Query('deleteScope') deleteScope?: string,
  ) {
    if (deleteScope === 'all') {
      return this.calendarService.removeRecurrenceAll(id);
    }
    return this.calendarService.remove(id);
  }

  // ─── Conflict Detection ─────────────────────────────────

  @Get('conflicts')
  checkConflicts(
    @Query('userId') userId: string,
    @Query('start') start: string,
    @Query('end') end: string,
    @Query('excludeId') excludeId?: string,
  ) {
    return this.calendarService.checkConflicts(userId, start, end, excludeId);
  }

  // ─── Availability ─────────────────────────────────────

  @Get('availability/:userId')
  getAvailability(
    @Param('userId') userId: string,
    @Query('date') date: string,
    @Query('duration') duration: string,
  ) {
    return this.calendarService.getAvailability(userId, date, parseInt(duration) || 30);
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
  createAppointmentType(@Body() data: any, @Request() req: any) {
    return this.calendarService.createAppointmentType({
      ...data,
      tenant_id: req.user?.tenant_id,
    });
  }

  @Patch('appointment-types/:id')
  updateAppointmentType(@Param('id') id: string, @Body() data: any) {
    return this.calendarService.updateAppointmentType(id, data);
  }

  @Delete('appointment-types/:id')
  deleteAppointmentType(@Param('id') id: string) {
    return this.calendarService.deleteAppointmentType(id);
  }

  // ─── Holidays ─────────────────────────────────────────

  @Get('holidays')
  findHolidays(@Request() req: any) {
    return this.calendarService.findHolidays(req.user?.tenant_id);
  }

  @Post('holidays')
  createHoliday(@Body() data: any, @Request() req: any) {
    return this.calendarService.createHoliday({
      ...data,
      tenant_id: req.user?.tenant_id,
    });
  }

  @Patch('holidays/:id')
  updateHoliday(@Param('id') id: string, @Body() data: any) {
    return this.calendarService.updateHoliday(id, data);
  }

  @Delete('holidays/:id')
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
}
