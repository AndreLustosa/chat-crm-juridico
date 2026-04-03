import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Body,
} from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { FichaTrabalhistaService } from './ficha-trabalhista.service';
import { UpdateFichaDto } from './dto/update-ficha.dto';

@Controller('ficha-trabalhista')
export class FichaTrabalhistaController {
  constructor(private readonly service: FichaTrabalhistaService) {}

  // ─── Endpoints autenticados (painel admin) ────────────────────
  // JwtAuthGuard é global (APP_GUARD) — não precisa de @UseGuards(JwtAuthGuard)

  @Get(':leadId')
  async findOrCreate(@Param('leadId') leadId: string) {
    return this.service.findOrCreate(leadId);
  }

  @Patch(':leadId')
  async updatePartial(
    @Param('leadId') leadId: string,
    @Body() dto: UpdateFichaDto,
  ) {
    return this.service.updatePartial(leadId, dto);
  }

  @Post(':leadId/finalize')
  async finalize(@Param('leadId') leadId: string) {
    return this.service.finalize(leadId);
  }

  @Post(':leadId/fill-from-memory')
  async fillFromMemory(@Param('leadId') leadId: string) {
    return this.service.fillFromMemory(leadId);
  }

  // ─── Endpoints públicos (formulário externo via link WhatsApp) ─

  @Public()
  @Get(':leadId/public')
  async publicGet(@Param('leadId') leadId: string) {
    const ficha = await this.service.findOrCreate(leadId);
    return {
      id: ficha.id,
      lead_id: ficha.lead_id,
      data: ficha.data,
      finalizado: ficha.finalizado,
      completion_pct: ficha.completion_pct,
    };
  }

  @Public()
  @Patch(':leadId/public')
  async publicUpdate(
    @Param('leadId') leadId: string,
    @Body() dto: UpdateFichaDto,
  ) {
    return this.service.updatePartial(leadId, dto, 'lead');
  }

  @Public()
  @Post(':leadId/public/finalize')
  async publicFinalize(@Param('leadId') leadId: string) {
    return this.service.finalize(leadId);
  }

  @Public()
  @Post(':leadId/public/correct')
  async publicCorrect(
    @Param('leadId') leadId: string,
    @Body() body: { field: string; text: string },
  ) {
    return this.service.correctField(body.field, body.text);
  }

  @Post(':leadId/correct')
  async correct(
    @Param('leadId') leadId: string,
    @Body() body: { field: string; text: string },
  ) {
    return this.service.correctField(body.field, body.text);
  }
}
