import { Controller, Get, Post, Body, Query, Param, UseGuards } from '@nestjs/common';
import { DjenService } from './djen.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('djen')
export class DjenController {
  constructor(private readonly djenService: DjenService) {}

  /** Trigger manual do sync — útil para testar e para reprocessar datas passadas */
  @Post('sync')
  syncManual(@Body() body: { date?: string }) {
    const date = body?.date || new Date().toISOString().slice(0, 10);
    return this.djenService.syncForDate(date);
  }

  /** Lista publicações recentes de todos os processos */
  @Get()
  findRecent(@Query('days') days?: string) {
    return this.djenService.findRecent(days ? parseInt(days) : 7);
  }

  /** Publicações de um processo específico */
  @Get('case/:caseId')
  findByCase(@Param('caseId') caseId: string) {
    return this.djenService.findByCase(caseId);
  }
}
