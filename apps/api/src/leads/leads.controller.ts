import { Controller, Get, Post, Body, Patch, Delete, Param, Query, UseGuards, Request, BadRequestException, Res } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { LeadsCleanupService } from './leads-cleanup.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateLeadDto, UpdateLeadDto, UpdateLeadStageDto, UpdateLeadPhoneDto } from './dto/create-lead.dto';
import { extractAttribution } from '../trafego/attribution.helper';

@UseGuards(JwtAuthGuard)
@Controller('leads')
export class LeadsController {
  constructor(
    private readonly leadsService: LeadsService,
    private readonly leadsCleanupService: LeadsCleanupService,
  ) {}

  @Post()
  create(@Body() dto: CreateLeadDto, @Request() req: any) {
    // Captura atribuicao (gclid/utm) se presente em body ou query.
    // Frontend persiste o gclid em sessionStorage no clique do anuncio
    // e envia como hidden field neste POST.
    const attribution = extractAttribution({
      body: req.body ?? {},
      query: req.query ?? {},
    });

    return this.leadsService.create({
      name: dto.name,
      phone: dto.phone,
      email: dto.email,
      origin: dto.origin,
      tags: dto.tags,
      tenant: req.user?.tenant_id ? { connect: { id: req.user.tenant_id } } : undefined,
      ...attribution,
    });
  }

  // GET /leads
  //
  // Query params:
  //   - inboxId, page, limit, search, stage: filtros gerais
  //   - is_client: 'true' | 'false'
  //       * nao passado: retorna TUDO (comportamento default pra busca global,
  //         agenda, djen, financeiro — onde faz sentido listar leads+clientes)
  //       * 'false': SO leads (CRM Pipeline usa isso — clientes saem da tela)
  //       * 'true': SO clientes
  @Get()
  findAll(
    @Request() req: any,
    @Query('inboxId') inboxId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('stage') stage?: string,
    @Query('is_client') isClient?: string,
  ) {
    const p = page ? parseInt(page, 10) : undefined;
    const l = limit ? parseInt(limit, 10) : undefined;
    let isClientBool: boolean | undefined = undefined;
    if (isClient === 'true') isClientBool = true;
    else if (isClient === 'false') isClientBool = false;
    return this.leadsService.findAll(req.user?.tenant_id, inboxId, p, l, search, stage, req.user?.id, isClientBool);
  }

  @Get('check-phone')
  checkPhone(@Query('phone') phone: string) {
    if (!phone) throw new BadRequestException('phone e obrigatorio');
    return this.leadsService.checkPhone(phone);
  }

  @Get('export')
  async exportCsv(
    @Request() req: any,
    @Query('search') search: string,
    @Res() res: any,
  ) {
    const csv = await this.leadsService.exportCsv(req.user?.tenant_id, search, req.user?.id);
    const filename = `leads_${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csv); // BOM UTF-8 para Excel abrir corretamente
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.leadsService.findOne(id, req.user?.tenant_id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: UpdateLeadDto,
    @Request() req: any,
  ) {
    return this.leadsService.update(id, body, req.user?.tenant_id);
  }

  @Patch(':id/stage')
  updateStage(@Param('id') id: string, @Body() body: UpdateLeadStageDto, @Request() req: any) {
    return this.leadsService.updateStatus(id, body.stage, req.user?.tenant_id, body.loss_reason, req.user?.id);
  }

  // Troca de telefone — separado do PATCH /:id por ser destrutiva (telefone
  // e a chave do WhatsApp/webhook). ADMIN-only. Conflito retorna 409 com
  // o lead conflitante no payload pra UI mostrar.
  @Patch(':id/phone')
  @Roles('ADMIN')
  updatePhone(@Param('id') id: string, @Body() body: UpdateLeadPhoneDto, @Request() req: any) {
    return this.leadsService.updatePhone(id, body.phone, req.user?.tenant_id, req.user?.id);
  }

  @Get(':id/timeline')
  getTimeline(@Param('id') id: string, @Request() req: any) {
    return this.leadsService.getTimeline(id, req.user?.tenant_id);
  }

  @Post(':id/summary')
  summarize(@Param('id') id: string, @Request() req: any) {
    return this.leadsService.summarizeLead(id, req.user?.tenant_id);
  }

  @Delete(':id/memory')
  resetMemory(@Param('id') id: string, @Request() req: any) {
    return this.leadsService.resetMemory(id, req.user?.tenant_id);
  }

  // DELETE /leads/:id — exclui contato e TODOS os seus dados (somente ADMIN)
  @Delete(':id')
  @Roles('ADMIN')
  deleteContact(@Param('id') id: string) {
    return this.leadsService.deleteContact(id);
  }

  @Post('cleanup/deduplicate')
  @Roles('ADMIN')
  deduplicatePhones() {
    return this.leadsCleanupService.deduplicatePhones();
  }
}
