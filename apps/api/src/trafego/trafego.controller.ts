import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { TrafegoService } from './trafego.service';
import { TrafegoOAuthService } from './trafego-oauth.service';
import { TrafegoConfigService } from './trafego-config.service';
import { TrafegoAiService } from './trafego-ai.service';
import { TrafegoLeadFormService } from './trafego-lead-form.service';
import { TrafegoAudiencesService } from './trafego-audiences.service';
import { TrafegoRecommendationsService } from './trafego-recommendations.service';
import { TrafegoAssetGroupsService } from './trafego-asset-groups.service';
import { TrafegoReachPlannerService } from './trafego-reach-planner.service';
import { TrafegoChatService } from './trafego-chat.service';
import { TrafegoBackfillService } from './trafego-backfill.service';
import { TrafegoMappingAiService } from './trafego-mapping-ai.service';
import { TrafegoLandingPagesService } from './trafego-landing-pages.service';
import { TrafegoOptimizationService } from './trafego-optimization.service';
import {
  AcknowledgeAlertDto,
  AddKeywordsDto,
  AddNegativesDto,
  AiDecisionFeedbackDto,
  AiTriggerLoopDto,
  ApplyRecommendationDto,
  CreateChatSessionDto,
  CreateLandingPageDto,
  UpdateAdScheduleDto,
  CreateRsaDto,
  CreateSearchCampaignDto,
  CreateUserListDto,
  DashboardQueryDto,
  GenerateReachForecastDto,
  GenerateRsaDto,
  RejectChatActionDto,
  SendChatMessageDto,
  StartBackfillDto,
  ListAiDecisionsDto,
  ListLeadFormSubmissionsDto,
  ListRecommendationsDto,
  MapConversionActionDto,
  MutateBaseDto,
  UpdateAccountDto,
  UpdateAiPolicyDto,
  UpdateBiddingStrategyDto,
  UpdateBudgetDto,
  UpdateCampaignDto,
  UpdateCredentialsDto,
  UpdateLandingPageDto,
  UpdateLeadFormSettingsDto,
  UpdateSettingsDto,
} from './trafego.dto';

@Controller('trafego')
@UseGuards(JwtAuthGuard)
export class TrafegoController {
  constructor(
    private readonly service: TrafegoService,
    private readonly oauth: TrafegoOAuthService,
    private readonly config: TrafegoConfigService,
    private readonly ai: TrafegoAiService,
    private readonly leadForm: TrafegoLeadFormService,
    private readonly audiences: TrafegoAudiencesService,
    private readonly recommendations: TrafegoRecommendationsService,
    private readonly assetGroups: TrafegoAssetGroupsService,
    private readonly reachPlanner: TrafegoReachPlannerService,
    private readonly chat: TrafegoChatService,
    private readonly backfillSvc: TrafegoBackfillService,
    private readonly mappingAi: TrafegoMappingAiService,
    private readonly landingPages: TrafegoLandingPagesService,
    private readonly optimization: TrafegoOptimizationService,
    @InjectQueue('trafego-sync') private readonly syncQueue: Queue,
    @InjectQueue('trafego-mutate') private readonly mutateQueue: Queue,
  ) {}

  // ─── Dashboard ──────────────────────────────────────────────────────────

  @Get('dashboard')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  async dashboard(@Req() req: any, @Query() query: DashboardQueryDto) {
    return this.service.getDashboard(req.user.tenant_id, {
      period: query.period,
      dateFrom: query.date_from,
      dateTo: query.date_to,
      channelType: query.channel_type,
    });
  }

  // ─── Conta ──────────────────────────────────────────────────────────────

  @Get('account')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  async getAccount(@Req() req: any) {
    const account = await this.service.getAccount(req.user.tenant_id);
    return { connected: !!account, account };
  }

  @Patch('account')
  @Roles('ADMIN')
  async updateAccount(@Req() req: any, @Body() dto: UpdateAccountDto) {
    return this.service.updateAccount(req.user.tenant_id, dto);
  }

  @Delete('account')
  @Roles('ADMIN')
  async disconnect(@Req() req: any) {
    return this.service.disconnectAccount(req.user.tenant_id);
  }

  // ─── OAuth ──────────────────────────────────────────────────────────────

  @Get('oauth/start')
  @Roles('ADMIN')
  async oauthStart(@Req() req: any) {
    const url = await this.oauth.buildAuthUrl(req.user.tenant_id);
    return { authorize_url: url };
  }

  /**
   * Callback do Google. NAO usa JwtAuthGuard porque o Google nao manda nosso JWT.
   * A seguranca vem do `state` validado em memoria + redirect_uri whitelistado.
   *
   * @Public() bypassa o JwtAuthGuard global (set como APP_GUARD em app.module).
   * Sem isso, requests do Google Auth retornam 401 antes de chegar no handler.
   */
  @Public()
  @Get('oauth/callback')
  async oauthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string | undefined,
    @Req() req: any,
    @Res() res: Response,
  ) {
    // Resolve base URL pra redirect na seguinte ordem:
    //   1. process.env.FRONTEND_BASE_URL (se admin override)
    //   2. Header Host (X-Forwarded-Host atras de Traefik) — mesmo dominio
    //      do request, sempre confiavel em prod
    //   3. localhost:3000 (dev)
    //
    // NAO da pra usar TrafegoConfigService aqui ANTES de validar state
    // (callback eh @Public, sem tenantId disponivel).
    const forwardedHost = req.get('x-forwarded-host') || req.get('host');
    const forwardedProto =
      req.get('x-forwarded-proto') || req.protocol || 'https';
    const webBase =
      process.env.FRONTEND_BASE_URL ||
      (forwardedHost ? `${forwardedProto}://${forwardedHost}` : null) ||
      'http://localhost:3000';
    const successPath = '/atendimento/marketing/trafego?oauth=success';
    const errorPath = '/atendimento/marketing/trafego?oauth=error';

    if (error) {
      return res.redirect(
        `${webBase}${errorPath}&reason=${encodeURIComponent(error)}`,
      );
    }
    if (!code || !state) {
      return res.redirect(`${webBase}${errorPath}&reason=missing_params`);
    }

    try {
      const { tenantId } = await this.oauth.handleCallback(code, state);

      // Dispara primeiro sync logo apos OAuth — backfill 30 dias.
      // Se falhar enfileirar (Redis offline), nao trava o callback —
      // proximo cron 06h pega.
      const account = await this.service.getAccount(tenantId);
      if (account) {
        try {
          await this.syncQueue.add(
            'trafego-sync-account',
            { accountId: account.id, trigger: 'OAUTH_CALLBACK' },
            {
              // Timestamp evita dedupe se OAuth eh refeito (token revogado etc)
              jobId: `oauth-sync-${account.id}-${Date.now()}`,
              removeOnComplete: 100,
              removeOnFail: 50,
              attempts: 2,
              backoff: { type: 'exponential', delay: 5000 },
            },
          );
        } catch {
          // ignora — sync acontece no proximo cron
        }
      }

      return res.redirect(`${webBase}${successPath}`);
    } catch (e: any) {
      return res.redirect(
        `${webBase}${errorPath}&reason=${encodeURIComponent(e.message ?? 'unknown')}`,
      );
    }
  }

  // ─── Campanhas ──────────────────────────────────────────────────────────

  @Get('campaigns')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  async listCampaigns(
    @Req() req: any,
    @Query('include_archived') includeArchived: string,
    @Query('days') days: string,
  ) {
    const daysNum = days ? parseInt(days, 10) : undefined;
    return this.service.listCampaigns(req.user.tenant_id, {
      includeArchived: includeArchived === 'true',
      days: Number.isFinite(daysNum) ? daysNum : undefined,
    });
  }

  @Get('auction-insights')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  async auctionInsights(
    @Req() req: any,
    @Query('days') days: string,
    @Query('start_date') startDate?: string,
    @Query('end_date') endDate?: string,
    @Query('campaign_id') campaignId?: string,
  ) {
    const daysNum = days ? parseInt(days, 10) : undefined;
    return this.service.getAuctionInsights(req.user.tenant_id, {
      days: Number.isFinite(daysNum) ? daysNum : undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      campaignId: campaignId || undefined,
    });
  }

  @Patch('campaigns/:id')
  @Roles('ADMIN', 'ADVOGADO')
  async updateCampaign(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    return this.service.updateCampaign(req.user.tenant_id, id, dto);
  }

  // ─── Alertas ────────────────────────────────────────────────────────────

  @Get('alerts')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  async listAlerts(
    @Req() req: any,
    @Query('status') status: string,
    @Query('limit') limit: string,
  ) {
    return this.service.listAlerts(req.user.tenant_id, {
      status: status || undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Patch('alerts/:id')
  @Roles('ADMIN', 'ADVOGADO')
  async ackAlert(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: AcknowledgeAlertDto,
  ) {
    return this.service.acknowledgeAlert(
      req.user.tenant_id,
      id,
      req.user.id,
      dto.status,
    );
  }

  // ─── Settings ───────────────────────────────────────────────────────────

  @Get('settings')
  @Roles('ADMIN', 'ADVOGADO')
  async getSettings(@Req() req: any) {
    return this.service.getSettings(req.user.tenant_id);
  }

  @Patch('settings')
  @Roles('ADMIN')
  async updateSettings(@Req() req: any, @Body() dto: UpdateSettingsDto) {
    return this.service.updateSettings(req.user.tenant_id, dto);
  }

  // ─── Credenciais Google Ads ─────────────────────────────────────────────

  /**
   * Retorna credenciais COM SECRETOS MASCARADOS.
   * Resposta nunca contem developer_token nem oauth_client_secret em plaintext —
   * apenas metadata (configurado/nao + ultimos 4 chars).
   */
  @Get('credentials')
  @Roles('ADMIN')
  async getCredentials(@Req() req: any) {
    return this.config.getCredentialsMasked(req.user.tenant_id);
  }

  /**
   * Atualiza credenciais. Campos undefined preservam valor atual; null apaga
   * (e cai no fallback de env). Secretos sao criptografados em repouso.
   */
  @Patch('credentials')
  @Roles('ADMIN')
  async updateCredentials(@Req() req: any, @Body() dto: UpdateCredentialsDto) {
    return this.config.updateCredentials(req.user.tenant_id, dto);
  }

  // ─── Sync logs ──────────────────────────────────────────────────────────

  @Get('sync-logs')
  @Roles('ADMIN', 'ADVOGADO')
  async syncLogs(@Req() req: any, @Query('limit') limit: string) {
    return this.service.getSyncLogs(
      req.user.tenant_id,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  // ─── Sync manual ────────────────────────────────────────────────────────

  /**
   * Enfileira job 'trafego-sync-account' na BullMQ. Worker pega e roda
   * GAQL queries contra Google Ads API.
   *
   * Idempotente: se chamado varias vezes em sequencia, BullMQ deduplica
   * pelo jobId (= account.id) — apenas o ultimo eh processado.
   */
  @Post('sync')
  @Roles('ADMIN', 'ADVOGADO')
  async triggerSync(@Req() req: any) {
    const account = await this.service.getAccount(req.user.tenant_id);
    if (!account) {
      throw new HttpException(
        'Conecte uma conta antes de sincronizar.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // jobId com timestamp pra evitar dedupe silencioso do BullMQ — sem isso,
    // se um job anterior falhou (ficou em failed zset) e o admin tenta de
    // novo apos arrumar config, o novo add() seria descartado sem feedback.
    await this.syncQueue.add(
      'trafego-sync-account',
      { accountId: account.id, trigger: 'MANUAL' },
      {
        jobId: `manual-sync-${account.id}-${Date.now()}`,
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );

    return {
      ok: true,
      message: 'Sync enfileirado. Os dados aparecerao em alguns minutos.',
    };
  }

  // ─── Relatorios PDF (Fase 4B) ──────────────────────────────────────────

  /**
   * Gera PDF de snapshot do trafego pra um periodo. Faz download direto.
   *
   * Query params:
   *   from — data inicio (YYYY-MM-DD)
   *   to   — data fim (YYYY-MM-DD)
   *   label — opcional, ex: "Abril/2026"
   */
  @Get('reports/generate')
  @Roles('ADMIN', 'ADVOGADO')
  async generateReport(
    @Req() req: any,
    @Res() res: Response,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('label') label?: string,
  ) {
    if (!from || !to) {
      throw new HttpException(
        'Parametros from e to (YYYY-MM-DD) sao obrigatorios.',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const buffer = await this.service.generateReport(
        req.user.tenant_id,
        req.user.id,
        req.user.name,
        from,
        to,
        label,
      );

      const filename = `trafego_${from}_a_${to}.pdf`;
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': buffer.length.toString(),
      });
      res.send(buffer);
    } catch (e: any) {
      // Log no servidor pra debug, mas resposta limpa pro cliente
      throw new HttpException(
        `Erro ao gerar PDF: ${e.message ?? 'desconhecido'}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /** Lista historico de relatorios gerados (registros em Report table). */
  @Get('reports')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  async listReports(@Req() req: any, @Query('limit') limit: string) {
    return this.service.listReports(
      req.user.tenant_id,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  /**
   * Re-avalia regras de alerta sem rodar sync. Util pra testar regras ou
   * disparar reavaliacao apos admin mudar thresholds em Configuracoes.
   */
  // ─── Mutate (write na Google Ads API) ──────────────────────────────────
  //
  // Todas as rotas de mutate enfileiram job na queue `trafego-mutate`. O
  // worker (TrafegoMutateProcessor) processa com concurrency:1 por conta
  // pra evitar race conditions.
  //
  // validate_only=true em modo "IA Conselheira": faz dry-run no Google,
  // registra TrafficMutateLog mas nao aplica.
  //
  // initiator default: "user:<userId>". IA passa "ai_agent:<loop>" via
  // chamada interna (nao via HTTP).

  /** Lista ad_groups da conta (com filtro por campaign). */
  @Get('ad-groups')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  async listAdGroups(
    @Req() req: any,
    @Query('campaign_id') campaignId?: string,
    @Query('status') status?: string,
  ) {
    return this.service.listAdGroups(req.user.tenant_id, {
      campaignId,
      status,
    });
  }

  /** Lista keywords de um ad_group. */
  @Get('ad-groups/:adGroupId/keywords')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  async listKeywords(
    @Req() req: any,
    @Param('adGroupId') adGroupId: string,
    @Query('negative') negative?: string,
  ) {
    const negativeFilter =
      negative === 'true' ? true : negative === 'false' ? false : undefined;
    return this.service.listKeywords(req.user.tenant_id, adGroupId, {
      negative: negativeFilter,
    });
  }

  /** Lista ads de um ad_group. */
  @Get('ad-groups/:adGroupId/ads')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  async listAds(@Req() req: any, @Param('adGroupId') adGroupId: string) {
    return this.service.listAds(req.user.tenant_id, adGroupId);
  }

  /**
   * Cria RSA num ad_group (Fase 4d). Validador OAB roda automaticamente
   * no GoogleAdsMutateService — primeira violação aborta o batch e
   * retorna FAILED com lista de termos vetados.
   */
  @Post('ad-groups/:id/ads/rsa')
  @Roles('ADMIN', 'ADVOGADO')
  async createRsa(
    @Req() req: any,
    @Param('id') adGroupId: string,
    @Body() dto: CreateRsaDto,
  ) {
    return await this.enqueueMutate(req, 'trafego-mutate-create-rsa', {
      adGroupId,
      ...dto,
    });
  }

  /**
   * Gera variações de headlines + descriptions usando Claude API (Fase 4d).
   * Retorna JSON pronto pra alimentar POST /ad-groups/:id/ads/rsa.
   * Não cria nada no Google — admin revisa antes de aplicar.
   */
  @Post('ai/generate-rsa')
  @Roles('ADMIN', 'ADVOGADO')
  async generateRsa(@Req() req: any, @Body() dto: GenerateRsaDto) {
    return this.mappingAi.generateRsa(req.user.tenant_id, {
      practiceArea: dto.practice_area,
      city: dto.city,
      differentials: dto.differentials,
      finalUrl: dto.final_url,
    });
  }

  /** Lista budgets da conta. */
  @Get('budgets')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  async listBudgets(@Req() req: any) {
    return this.service.listBudgets(req.user.tenant_id);
  }

  /** Lista ConversionActions configuradas no Google Ads. */
  @Get('conversion-actions')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  async listConversionActions(@Req() req: any) {
    return this.service.listConversionActions(req.user.tenant_id);
  }

  /** Mapeia ConversionAction → evento CRM (lead.created, client.signed, etc). */
  @Patch('conversion-actions/:id')
  @Roles('ADMIN')
  async mapConversionAction(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: MapConversionActionDto,
  ) {
    return this.service.mapConversionAction(req.user.tenant_id, id, dto);
  }

  /**
   * Sugere mapeamento ConversionAction → evento CRM via Claude API.
   * Retorna lista de sugestões (sem aplicar) — front aplica o que o admin
   * aprovar via PATCH conversion-actions/:id.
   *
   * Custo: 1 chamada Claude (haiku) com prompt batch de TODAS as actions.
   */
  @Post('conversion-actions/ai-suggestions')
  @Roles('ADMIN', 'ADVOGADO')
  async suggestConversionMappings(@Req() req: any) {
    return this.mappingAi.suggestMappings(req.user.tenant_id);
  }

  /**
   * Lista search terms cacheados (Sprint I — Fase 4a). Worker popula via
   * search_term_view a cada sync. Default: piores ofensores (sem
   * conversao + maior gasto).
   */
  @Get('search-terms')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  async listSearchTerms(
    @Req() req: any,
    @Query('campaign_id') campaignId?: string,
    @Query('ad_group_id') adGroupId?: string,
    @Query('min_spend_brl') minSpendBrl?: string,
    @Query('zero_conv_only') zeroConvOnly?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listSearchTerms(req.user.tenant_id, {
      campaignId,
      adGroupId,
      minSpendBrl: minSpendBrl ? Number(minSpendBrl) : undefined,
      zeroConvOnly: zeroConvOnly === 'true',
      search,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  /** Lista logs de mutate (audit trail). */
  @Get('mutate-logs')
  @Roles('ADMIN')
  async listMutateLogs(
    @Req() req: any,
    @Query('limit') limit?: string,
    @Query('initiator') initiator?: string,
    @Query('status') status?: string,
  ) {
    return this.service.listMutateLogs(req.user.tenant_id, {
      limit: limit ? Math.min(200, Math.max(1, parseInt(limit))) : 50,
      initiator,
      status,
    });
  }

  /**
   * Cria nova campanha Search do zero (Sprint I — Fase 4b). Pipeline:
   *   1. Cria campaign_budget
   *   2. Cria campaign apontando pro budget
   *   3. Aplica geo_targets + languages via campaign_criterion
   *
   * Default: PAUSED (admin ativa explicitamente). Idempotência via jobId
   * com timestamp — re-clique acidental não duplica.
   */
  @Post('campaigns')
  @Roles('ADMIN', 'ADVOGADO')
  async createCampaign(@Req() req: any, @Body() dto: CreateSearchCampaignDto) {
    return await this.enqueueMutate(
      req,
      'trafego-mutate-create-search-campaign',
      dto,
    );
  }

  /**
   * Métricas hora × dia da semana de uma campanha — heatmap "quando os
   * leads aparecem". Default 30d. Retorna 168 cells (7 dias × 24 horas).
   */
  @Get('campaigns/:id/hourly-metrics')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  async getCampaignHourly(
    @Req() req: any,
    @Param('id') id: string,
    @Query('days') days?: string,
  ) {
    return this.service.getCampaignHourlyMetrics(
      req.user.tenant_id,
      id,
      days ? parseInt(days, 10) : 30,
    );
  }

  /**
   * Lista o agendamento (ad_schedule) atual da campanha. Quando vazio,
   * campanha roda 24/7. Sincronizado pelo cron via campaign_criterion.
   */
  @Get('campaigns/:id/schedule')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  async getCampaignSchedule(@Req() req: any, @Param('id') id: string) {
    return this.service.getCampaignSchedule(req.user.tenant_id, id);
  }

  /**
   * Atualiza agendamento — substituição atômica. Lista vazia volta a
   * campanha pra 24/7. validate_only=true faz dry-run.
   */
  @Put('campaigns/:id/schedule')
  @Roles('ADMIN', 'ADVOGADO')
  async updateCampaignSchedule(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateAdScheduleDto,
  ) {
    // Validação adicional: end > start no mesmo dia
    for (const s of dto.slots) {
      const startMinutes = s.start_hour * 60 + s.start_minute;
      const endMinutes = s.end_hour * 60 + s.end_minute;
      if (endMinutes <= startMinutes) {
        throw new HttpException(
          `Slot ${s.day_of_week} ${s.start_hour}:${String(s.start_minute).padStart(2, '0')}–${s.end_hour}:${String(s.end_minute).padStart(2, '0')}: fim precisa ser depois do início.`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }
    return await this.enqueueMutate(req, 'trafego-mutate-update-ad-schedule', {
      campaignId: id,
      ...dto,
    });
  }

  /**
   * Métricas por dispositivo (mobile/desktop/tablet) de uma campanha.
   * Inclui spend_share + conv_share pra donut.
   */
  @Get('campaigns/:id/device-metrics')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  async getCampaignDevice(
    @Req() req: any,
    @Param('id') id: string,
    @Query('days') days?: string,
  ) {
    return this.service.getCampaignDeviceMetrics(
      req.user.tenant_id,
      id,
      days ? parseInt(days, 10) : 30,
    );
  }

  /** Atualiza estratégia de lance da campanha (Fase 4c). */
  @Patch('campaigns/:id/bidding-strategy')
  @Roles('ADMIN', 'ADVOGADO')
  async updateBiddingStrategy(
    @Req() req: any,
    @Param('id') campaignId: string,
    @Body() dto: UpdateBiddingStrategyDto,
  ) {
    return await this.enqueueMutate(
      req,
      'trafego-mutate-update-bidding-strategy',
      { campaignId, ...dto },
    );
  }

  /** Pausa uma campanha no Google. */
  @Post('campaigns/:id/pause')
  @Roles('ADMIN', 'ADVOGADO')
  async pauseCampaign(
    @Req() req: any,
    @Param('id') campaignId: string,
    @Body() dto: MutateBaseDto,
  ) {
    return await this.enqueueMutate(req, 'trafego-mutate-pause-campaign', {
      campaignId,
      ...dto,
    });
  }

  /** Reativa uma campanha no Google. */
  @Post('campaigns/:id/resume')
  @Roles('ADMIN', 'ADVOGADO')
  async resumeCampaign(
    @Req() req: any,
    @Param('id') campaignId: string,
    @Body() dto: MutateBaseDto,
  ) {
    return await this.enqueueMutate(req, 'trafego-mutate-resume-campaign', {
      campaignId,
      ...dto,
    });
  }

  /** Atualiza budget diario. Recebe valor em BRL, converte pra micros. */
  @Patch('campaigns/:id/budget')
  @Roles('ADMIN', 'ADVOGADO')
  async updateBudget(
    @Req() req: any,
    @Param('id') campaignId: string,
    @Body() dto: UpdateBudgetDto,
  ) {
    return await this.enqueueMutate(req, 'trafego-mutate-update-budget', {
      campaignId,
      ...dto,
    });
  }

  /** Pausa um ad_group. */
  @Post('ad-groups/:id/pause')
  @Roles('ADMIN', 'ADVOGADO')
  async pauseAdGroup(
    @Req() req: any,
    @Param('id') adGroupId: string,
    @Body() dto: MutateBaseDto,
  ) {
    return await this.enqueueMutate(req, 'trafego-mutate-pause-ad-group', {
      adGroupId,
      ...dto,
    });
  }

  /** Reativa um ad_group. */
  @Post('ad-groups/:id/resume')
  @Roles('ADMIN', 'ADVOGADO')
  async resumeAdGroup(
    @Req() req: any,
    @Param('id') adGroupId: string,
    @Body() dto: MutateBaseDto,
  ) {
    return await this.enqueueMutate(req, 'trafego-mutate-resume-ad-group', {
      adGroupId,
      ...dto,
    });
  }

  /** Adiciona keywords positivas. */
  @Post('ad-groups/:id/keywords')
  @Roles('ADMIN', 'ADVOGADO')
  async addKeywords(
    @Req() req: any,
    @Param('id') adGroupId: string,
    @Body() dto: AddKeywordsDto,
  ) {
    return await this.enqueueMutate(req, 'trafego-mutate-add-keywords', {
      adGroupId,
      ...dto,
    });
  }

  /** Adiciona negative keywords. Scope=CAMPAIGN ou AD_GROUP. */
  @Post('campaigns/:id/negatives')
  @Roles('ADMIN', 'ADVOGADO')
  async addCampaignNegatives(
    @Req() req: any,
    @Param('id') campaignId: string,
    @Body() dto: AddNegativesDto,
  ) {
    return await this.enqueueMutate(req, 'trafego-mutate-add-negatives', {
      campaignId,
      ...dto,
    });
  }

  @Post('ad-groups/:id/negatives')
  @Roles('ADMIN', 'ADVOGADO')
  async addAdGroupNegatives(
    @Req() req: any,
    @Param('id') adGroupId: string,
    @Body() dto: AddNegativesDto,
  ) {
    return await this.enqueueMutate(req, 'trafego-mutate-add-negatives', {
      adGroupId,
      ...dto,
    });
  }

  /** Remove (soft) uma keyword. */
  @Delete('keywords/:id')
  @Roles('ADMIN', 'ADVOGADO')
  async removeKeyword(
    @Req() req: any,
    @Param('id') keywordId: string,
    @Body() dto: MutateBaseDto,
  ) {
    return await this.enqueueMutate(req, 'trafego-mutate-remove-keywords', {
      keywordIds: [keywordId],
      ...dto,
    });
  }

  // ─── Helper: enqueue mutate com resolucao de resource_names ─────────────
  private async enqueueMutate(req: any, jobName: string, payload: any) {
    const tenantId = req.user.tenant_id;
    const account = await this.service.getAccount(tenantId);
    if (!account) {
      throw new HttpException(
        'Conecte uma conta antes de executar acoes de mutate.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const initiator = `user:${req.user.id}`;
    const validateOnly = !!payload.validate_only;

    // Resolver IDs locais → resource_names da Google Ads API
    const data = await this.service.buildMutatePayload(
      tenantId,
      account.id,
      account.customer_id,
      jobName,
      payload,
      initiator,
      validateOnly,
    );

    await this.mutateQueue.add(jobName, data, {
      jobId: `mutate-${jobName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      removeOnComplete: 100,
      removeOnFail: 50,
      attempts: 1, // Mutates nao retentam — caller decide se quer retry
    });

    return {
      ok: true,
      validate_only: validateOnly,
      message: validateOnly
        ? 'Mutate em DRY-RUN enfileirado (modo Conselheiro).'
        : 'Mutate enfileirado. Acompanhe em /trafego/mutate-logs.',
    };
  }

  @Post('evaluate-alerts')
  @Roles('ADMIN')
  async evaluateAlerts(@Req() req: any) {
    const account = await this.service.getAccount(req.user.tenant_id);
    if (!account) {
      throw new HttpException(
        'Conecte uma conta antes de avaliar alertas.',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.syncQueue.add(
      'trafego-evaluate-alerts',
      { accountId: account.id },
      {
        jobId: `eval-alerts-${account.id}-${Date.now()}`,
        removeOnComplete: 50,
        removeOnFail: 20,
      },
    );

    return {
      ok: true,
      message: 'Avaliacao de alertas enfileirada. Resultados em ~10s.',
    };
  }

  // ─── IA Otimizadora (Sprint C) ──────────────────────────────────────────

  @Get('ai/decisions')
  @Roles('ADMIN', 'ADVOGADO')
  async listAiDecisions(@Req() req: any, @Query() query: ListAiDecisionsDto) {
    return this.ai.listDecisions(req.user.tenant_id, {
      action: query.action,
      kind: query.kind,
      loopKind: query.loop_kind,
      feedback: query.feedback,
      limit: query.limit,
    });
  }

  @Post('ai/decisions/:id/feedback')
  @Roles('ADMIN', 'ADVOGADO')
  async submitAiDecisionFeedback(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: AiDecisionFeedbackDto,
  ) {
    return this.ai.submitFeedback(
      req.user.tenant_id,
      id,
      dto.feedback,
      dto.note,
      req.user.id,
      { permanent: !!dto.permanent },
    );
  }

  @Get('ai/policy')
  @Roles('ADMIN', 'ADVOGADO')
  async getAiPolicy(@Req() req: any) {
    return this.ai.getPolicy(req.user.tenant_id);
  }

  @Patch('ai/policy')
  @Roles('ADMIN')
  async updateAiPolicy(@Req() req: any, @Body() dto: UpdateAiPolicyDto) {
    return this.ai.updatePolicy(req.user.tenant_id, dto);
  }

  @Post('ai/trigger')
  @Roles('ADMIN', 'ADVOGADO')
  async triggerAiLoop(@Req() req: any, @Body() dto: AiTriggerLoopDto) {
    return this.ai.triggerLoop(
      req.user.tenant_id,
      dto.loop_kind ?? 'TRIGGERED',
    );
  }

  // ─── Lead Form Asset (Sprint D) ─────────────────────────────────────────

  /**
   * Webhook recebido pelo Google Ads quando um Lead Form é submetido.
   *
   * URL configurada no asset (campo "Webhook URL"):
   *   https://api.andrelustosaadvogados.com.br/trafego/lead-form-webhook
   *     ?tenant_id=<UUID>&google_key=<secret>
   *
   * Endpoint público (Google não envia JWT). Autenticação via:
   *   - tenant_id na query → resolve TrafficSettings
   *   - google_key na query OU body → match com lead_form_webhook_secret
   *
   * Idempotência: cada lead_id do Google gera 1 TrafficLeadFormSubmission;
   * Lead é deduplicado por (tenant_id, phone) — submissions duplicadas
   * caem em status='DUPLICATE' apontando pro Lead existente.
   *
   * Sempre retorna 200 OK quando passa autenticação — Google desabilita
   * forms com taxa de erro alta. Erros internos ficam em error_message
   * pra troubleshooting.
   */
  @Public()
  @Post('lead-form-webhook')
  async leadFormWebhook(
    @Req() req: any,
    @Query('tenant_id') tenantId: string | undefined,
    @Query('google_key') googleKey: string | undefined,
    @Body() body: Record<string, any>,
  ) {
    return this.leadForm.processWebhook(
      tenantId,
      googleKey,
      body ?? {},
      (req?.headers ?? {}) as Record<string, any>,
    );
  }

  @Get('lead-form-submissions')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  async listLeadFormSubmissions(
    @Req() req: any,
    @Query() query: ListLeadFormSubmissionsDto,
  ) {
    return this.leadForm.listSubmissions(req.user.tenant_id, {
      status: query.status,
      limit: query.limit,
    });
  }

  /**
   * Atualiza somente os campos de Lead Form Asset em TrafficSettings.
   * Endpoint dedicado pra evitar inflar UpdateSettingsDto com campos novos
   * e simplificar permissões (só ADMIN pode rotacionar o secret).
   */
  @Patch('lead-form-settings')
  @Roles('ADMIN')
  async updateLeadFormSettings(
    @Req() req: any,
    @Body() dto: UpdateLeadFormSettingsDto,
  ) {
    const tenantId = req.user.tenant_id;
    const data: Record<string, unknown> = {};
    if (dto.lead_form_webhook_secret !== undefined) {
      data.lead_form_webhook_secret = dto.lead_form_webhook_secret;
    }
    if (dto.lead_form_auto_create_lead !== undefined) {
      data.lead_form_auto_create_lead = dto.lead_form_auto_create_lead;
    }
    if (dto.lead_form_default_stage !== undefined) {
      data.lead_form_default_stage = dto.lead_form_default_stage;
    }
    const updated = await this.service.upsertLeadFormSettings(tenantId, data);
    return updated;
  }

  // ─── Customer Match (Sprint D) ──────────────────────────────────────────

  @Get('audiences')
  @Roles('ADMIN', 'ADVOGADO')
  async listAudiences(@Req() req: any) {
    return this.audiences.list(req.user.tenant_id);
  }

  @Get('audiences/:id')
  @Roles('ADMIN', 'ADVOGADO')
  async getAudience(@Req() req: any, @Param('id') id: string) {
    return this.audiences.get(req.user.tenant_id, id);
  }

  @Post('audiences')
  @Roles('ADMIN')
  async createAudience(@Req() req: any, @Body() dto: CreateUserListDto) {
    return this.audiences.create(req.user.tenant_id, dto);
  }

  @Delete('audiences/:id')
  @Roles('ADMIN')
  async deleteAudience(@Req() req: any, @Param('id') id: string) {
    return this.audiences.delete(req.user.tenant_id, id);
  }

  @Post('audiences/:id/rebuild')
  @Roles('ADMIN', 'ADVOGADO')
  async rebuildAudience(@Req() req: any, @Param('id') id: string) {
    return this.audiences.enqueueRebuild(req.user.tenant_id, id);
  }

  @Post('audiences/:id/sync')
  @Roles('ADMIN')
  async syncAudience(@Req() req: any, @Param('id') id: string) {
    return this.audiences.enqueueSync(req.user.tenant_id, id);
  }

  // ─── Recommendations API (Sprint E) ─────────────────────────────────────

  @Get('recommendations')
  @Roles('ADMIN', 'ADVOGADO')
  async listRecommendations(
    @Req() req: any,
    @Query() query: ListRecommendationsDto,
  ) {
    return this.recommendations.list(req.user.tenant_id, {
      status: query.status,
      type: query.type,
      limit: query.limit,
    });
  }

  @Post('recommendations/sync')
  @Roles('ADMIN', 'ADVOGADO')
  async syncRecommendations(@Req() req: any) {
    return this.recommendations.triggerSync(req.user.tenant_id);
  }

  @Post('recommendations/:id/apply')
  @Roles('ADMIN', 'ADVOGADO')
  async applyRecommendation(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: ApplyRecommendationDto,
  ) {
    return this.recommendations.enqueueApply(req.user.tenant_id, id, {
      force: !!dto.force,
      resolvedBy: req.user.id,
    });
  }

  @Post('recommendations/:id/dismiss')
  @Roles('ADMIN', 'ADVOGADO')
  async dismissRecommendation(@Req() req: any, @Param('id') id: string) {
    return this.recommendations.enqueueDismiss(req.user.tenant_id, id, {
      resolvedBy: req.user.id,
    });
  }

  // ─── Asset Groups (PMax/Demand Gen — Sprint F) ──────────────────────────

  @Get('asset-groups')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  async listAssetGroups(@Req() req: any, @Query('limit') limit?: string) {
    return this.assetGroups.listAll(req.user.tenant_id, {
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('campaigns/:campaignId/asset-groups')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  async listAssetGroupsForCampaign(
    @Req() req: any,
    @Param('campaignId') campaignId: string,
  ) {
    return this.assetGroups.listForCampaign(req.user.tenant_id, campaignId);
  }

  // ─── Reach Planner (Sprint F) ───────────────────────────────────────────

  @Get('reach-forecasts')
  @Roles('ADMIN', 'ADVOGADO')
  async listReachForecasts(@Req() req: any, @Query('limit') limit?: string) {
    return this.reachPlanner.listForecasts(req.user.tenant_id, {
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('reach-forecasts/:id')
  @Roles('ADMIN', 'ADVOGADO')
  async getReachForecast(@Req() req: any, @Param('id') id: string) {
    return this.reachPlanner.getForecast(req.user.tenant_id, id);
  }

  @Post('reach-forecasts')
  @Roles('ADMIN', 'ADVOGADO')
  async generateReachForecast(
    @Req() req: any,
    @Body() dto: GenerateReachForecastDto,
  ) {
    return this.reachPlanner.enqueueGenerate(
      req.user.tenant_id,
      dto,
      req.user.id,
    );
  }

  // ─── Backfill histórico (Sprint H.1) ────────────────────────────────────

  @Post('backfill/start')
  @Roles('ADMIN')
  async startBackfill(@Req() req: any, @Body() dto: StartBackfillDto) {
    return this.backfillSvc.start(req.user.tenant_id, dto.target_from);
  }

  @Get('backfill/status')
  @Roles('ADMIN', 'ADVOGADO')
  async getBackfillStatus(@Req() req: any) {
    return this.backfillSvc.getStatus(req.user.tenant_id);
  }

  @Post('backfill/cancel')
  @Roles('ADMIN')
  async cancelBackfill(@Req() req: any) {
    return this.backfillSvc.cancel(req.user.tenant_id);
  }

  // ─── Chat com a IA (Sprint H.5) ─────────────────────────────────────────

  @Post('chat/sessions')
  @Roles('ADMIN', 'ADVOGADO')
  async createChatSession(@Req() req: any, @Body() dto: CreateChatSessionDto) {
    return this.chat.createSession(req.user.tenant_id, req.user.id, dto.title);
  }

  @Get('chat/sessions')
  @Roles('ADMIN', 'ADVOGADO')
  async listChatSessions(@Req() req: any) {
    return this.chat.listSessions(req.user.tenant_id, req.user.id);
  }

  @Get('chat/sessions/:id')
  @Roles('ADMIN', 'ADVOGADO')
  async getChatSession(@Req() req: any, @Param('id') id: string) {
    return this.chat.getSession(req.user.tenant_id, id, req.user.id);
  }

  @Get('chat/sessions/:id/messages')
  @Roles('ADMIN', 'ADVOGADO')
  async getChatMessages(
    @Req() req: any,
    @Param('id') id: string,
    @Query('after') after?: string,
  ) {
    return this.chat.getMessages(req.user.tenant_id, id, req.user.id, after);
  }

  @Post('chat/sessions/:id/messages')
  @Roles('ADMIN', 'ADVOGADO')
  async sendChatMessage(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: SendChatMessageDto,
  ) {
    return this.chat.sendMessage(req.user.tenant_id, id, req.user.id, dto.text);
  }

  @Delete('chat/sessions/:id')
  @Roles('ADMIN', 'ADVOGADO')
  async archiveChatSession(@Req() req: any, @Param('id') id: string) {
    return this.chat.archiveSession(req.user.tenant_id, id, req.user.id);
  }

  @Post('chat/messages/:id/apply')
  @Roles('ADMIN', 'ADVOGADO')
  async applyChatAction(@Req() req: any, @Param('id') id: string) {
    return this.chat.applyAction(req.user.tenant_id, id, req.user.id);
  }

  @Post('chat/messages/:id/reject')
  @Roles('ADMIN', 'ADVOGADO')
  async rejectChatAction(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: RejectChatActionDto,
  ) {
    return this.chat.rejectAction(
      req.user.tenant_id,
      id,
      req.user.id,
      dto.note,
    );
  }

  // ─── Landing Pages (Fase 4f) ─────────────────────────────────────────────

  /** Lista LPs do tenant com PageSpeed score + análise IA. */
  @Get('landing-pages')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  async listLandingPages(@Req() req: any) {
    return this.landingPages.list(req.user.tenant_id);
  }

  /** Detalhes da LP (inclui pagespeed_data e analysis completos). */
  @Get('landing-pages/:id')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  async getLandingPage(@Req() req: any, @Param('id') id: string) {
    return this.landingPages.get(req.user.tenant_id, id);
  }

  @Post('landing-pages')
  @Roles('ADMIN', 'ADVOGADO')
  async createLandingPage(@Req() req: any, @Body() dto: CreateLandingPageDto) {
    return this.landingPages.create(req.user.tenant_id, {
      url: dto.url,
      title: dto.title,
      description: dto.description,
      campaign_id: dto.campaign_id,
    });
  }

  @Patch('landing-pages/:id')
  @Roles('ADMIN', 'ADVOGADO')
  async updateLandingPage(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateLandingPageDto,
  ) {
    return this.landingPages.update(req.user.tenant_id, id, dto);
  }

  @Delete('landing-pages/:id')
  @Roles('ADMIN')
  async deleteLandingPage(@Req() req: any, @Param('id') id: string) {
    return this.landingPages.remove(req.user.tenant_id, id);
  }

  /**
   * Roda PageSpeed Insights pro URL (mobile + desktop). Atualiza scores +
   * Core Web Vitals. Pré-requisito: PAGESPEED_INSIGHTS_API_KEY em settings.
   */
  @Post('landing-pages/:id/pagespeed')
  @Roles('ADMIN', 'ADVOGADO')
  async refreshPageSpeed(@Req() req: any, @Param('id') id: string) {
    return this.landingPages.refreshPageSpeed(req.user.tenant_id, id);
  }

  /**
   * Análise IA: fetch HTML + Claude API com prompt OAB + CRO.
   * Retorna sugestões classificadas por severidade.
   */
  @Post('landing-pages/:id/analyze')
  @Roles('ADMIN', 'ADVOGADO')
  async analyzeLandingPage(@Req() req: any, @Param('id') id: string) {
    return this.landingPages.analyzeWithAi(req.user.tenant_id, id);
  }

  // ─── IA Otimiza (Fase 5) ─────────────────────────────────────────────────

  /**
   * Diagnóstico semanal automático — gera resumo em pt-BR comparando
   * esta semana vs anterior. On-demand (admin clica "Gerar"). Cache não
   * persistido — sempre gera fresh quando solicitado.
   */
  @Get('optimization/weekly-diagnosis')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  async weeklyDiagnosis(@Req() req: any) {
    return this.optimization.weeklyDiagnosis(req.user.tenant_id);
  }

  /**
   * Lista termos de pesquisa caros (gasto >= R$30 default) com 0 conversões
   * em 30d. Reusa TrafficSearchTerm como proxy. Admin pode negativar
   * individualmente ou em batch via endpoint /trafego/ad-groups/:id/negatives
   * existente.
   */
  @Get('optimization/keywords-to-pause')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  async keywordsToPause(
    @Req() req: any,
    @Query('min_spend_brl') minSpendBrl?: string,
    @Query('days') days?: string,
    @Query('limit') limit?: string,
  ) {
    return this.optimization.keywordsToPause(req.user.tenant_id, {
      minSpendBrl: minSpendBrl ? Number(minSpendBrl) : undefined,
      days: days ? parseInt(days, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  /**
   * Sugere ajuste de budget por campanha baseado em CPL atual e meta
   * declarada em TrafficSettings.target_cpl. Limite de mudança ±20%
   * (no service) pra evitar shock changes.
   */
  @Get('optimization/budget-suggestions')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  async budgetSuggestions(@Req() req: any) {
    return this.optimization.budgetSuggestions(req.user.tenant_id);
  }
}
