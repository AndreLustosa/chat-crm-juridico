import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Request, Put } from '@nestjs/common';
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
    @Request() req: any,
  ) {
    return this.calendarService.findAll({
      start,
      end,
      type,
      userId,
      leadId,
      legalCaseId,
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
  update(@Param('id') id: string, @Body() data: any) {
    return this.calendarService.update(id, data);
  }

  @Patch('events/:id/status')
  updateStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.calendarService.updateStatus(id, status);
  }

  @Delete('events/:id')
  remove(@Param('id') id: string) {
    return this.calendarService.remove(id);
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
}
