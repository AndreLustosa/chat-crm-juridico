import { Controller, Post, Get, Body, Query, UseGuards } from '@nestjs/common';
import { AnalyticsService, TrackEventDto } from './analytics.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  /** Público — chamado pelo tracking script nas LPs */
  @Post('track')
  track(@Body() dto: TrackEventDto) {
    return this.service.track(dto);
  }

  /** Protegido — lista todas as páginas com métricas agregadas */
  @UseGuards(JwtAuthGuard)
  @Get('pages')
  getPages() {
    return this.service.getPages();
  }

  /** Protegido — detalhe de uma página específica */
  @UseGuards(JwtAuthGuard)
  @Get('detail')
  getDetail(@Query('path') path: string) {
    return this.service.getPageDetail(decodeURIComponent(path));
  }
}
