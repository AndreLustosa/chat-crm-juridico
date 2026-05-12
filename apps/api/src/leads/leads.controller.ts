import { Controller, Get, Post, Body, Patch, Delete, Param, Query, UseGuards, Request, BadRequestException, UnauthorizedException, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { LeadsService } from './leads.service';
import { LeadsCleanupService } from './leads-cleanup.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateLeadDto, UpdateLeadDto, UpdateLeadStageDto, UpdateLeadPhoneDto } from './dto/create-lead.dto';
import { extractAttribution } from '../trafego/attribution.helper';

// Bug fix 2026-05-12 (Leads PR1 #C5):
// Allowlist de campos de attribution. Antes spread `...attribution` direto
// no prisma.lead.create permitia mass-assignment se extractAttribution
// retornasse campos arbitrarios. Filtramos so os campos esperados.
const ATTRIBUTION_FIELDS = [
  'google_gclid', 'google_gbraid', 'google_wbraid',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'referrer_url', 'landing_url',
] as const;
function whitelistAttribution(attrib: any): Record<string, any> {
  if (!attrib || typeof attrib !== 'object') return {};
  const out: Record<string, any> = {};
  for (const k of ATTRIBUTION_FIELDS) {
    if (attrib[k] !== undefined && attrib[k] !== null) out[k] = attrib[k];
  }
  return out;
}

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

    // Bug fix #C5: whitelist explicito (anti mass-assignment)
    const safeAttribution = whitelistAttribution(attribution);

    return this.leadsService.create({
      name: dto.name,
      phone: dto.phone,
      email: dto.email,
      origin: dto.origin,
      tags: dto.tags,
      tenant: req.user?.tenant_id ? { connect: { id: req.user.tenant_id } } : undefined,
      ...safeAttribution,
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
  checkPhone(@Query('phone') phone: string, @Request() req: any) {
    if (!phone) throw new BadRequestException('phone e obrigatorio');
    // Bug fix 2026-05-12 (Leads PR1 #C3 \u2014 CRITICO LGPD):
    // Antes: checkPhone(phone) sem tenant_id. Qualquer user autenticado de
    // tenant A descobria se telefone X era cliente de tenant B (exists:true
    // + nome + stage). Vazamento de base de clientes entre concorrentes.
    // Agora exige tenant_id e escopa por ele.
    if (!req.user?.tenant_id) throw new UnauthorizedException('Token sem tenant_id');
    return this.leadsService.checkPhone(phone, req.user.tenant_id);
  }

  // Bug fix 2026-05-12 (Leads PR1 #C9):
  // Throttle export pra evitar abuse + LGPD (export massivo de PII).
  // 5 exports por minuto por user. Audit log fica em leads.service.exportCsv.
  @Get('export')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async exportCsv(
    @Request() req: any,
    @Query('search') search: string,
    @Res() res: any,
  ) {
    if (!req.user?.tenant_id) throw new UnauthorizedException('Token sem tenant_id');
    const csv = await this.leadsService.exportCsv(req.user.tenant_id, search, req.user?.id);
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
    // Bug fix PR3 #M10: passa actorUserId pra audit log
    return this.leadsService.resetMemory(id, req.user?.tenant_id, req.user?.id);
  }

  // DELETE /leads/:id — exclui contato e TODOS os seus dados (somente ADMIN)
  // Bug fix 2026-05-12 (Leads PR1 #C2 — CRITICO):
  // Antes: deleteContact(id) recebia so id. ADMIN de tenant A podia apagar
  // lead+conversas+casos+midias+tasks de tenant B em cascade via id enumeration.
  // Agora exige tenant_id + actor_user_id pra audit.
  @Delete(':id')
  @Roles('ADMIN')
  deleteContact(@Param('id') id: string, @Request() req: any) {
    if (!req.user?.tenant_id) throw new UnauthorizedException('Token sem tenant_id');
    return this.leadsService.deleteContact(id, req.user.tenant_id, req.user.id);
  }

  // Bug fix 2026-05-12 (Leads PR1 #C6 — CRITICO):
  // Cleanup dedup global por tenant_id do request. Antes rodava findMany SEM
  // filtro tenant — ADMIN tenant A movia/mergia leads de TODOS os tenants.
  @Post('cleanup/deduplicate')
  @Roles('ADMIN')
  @Throttle({ default: { limit: 2, ttl: 60 * 60_000 } })
  deduplicatePhones(@Request() req: any) {
    if (!req.user?.tenant_id) throw new UnauthorizedException('Token sem tenant_id');
    return this.leadsCleanupService.deduplicatePhones(req.user.tenant_id, req.user.id);
  }
}
