import {
  Controller,
  Get,
  Inject,
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
import type { Queue, QueueEvents } from 'bullmq';
// IMPORTANTE: importar de trafego.tokens (arquivo dedicado sem outros
// imports), NAO de trafego.module — senao gera circular import e o
// decorator @Inject(TOKEN) ve TOKEN=undefined em runtime → NestJS
// falha com UndefinedDependencyException. Bug visto em deploy 2026-05-17.
import {
  TRAFEGO_MUTATE_QUEUE_EVENTS,
  TRAFEGO_ENHANCED_CONV_QUEUE_EVENTS,
  TRAFEGO_READ_QUEUE_EVENTS,
} from './trafego.tokens';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { TrafegoService } from './trafego.service';
import { TrafegoOAuthService } from './trafego-oauth.service';
import { TrafegoConfigService } from './trafego-config.service';
import { TrafegoLeadFormService } from './trafego-lead-form.service';
import { TrafegoRecommendationsService } from './trafego-recommendations.service';
import { TrafegoBackfillService } from './trafego-backfill.service';
import { TrafegoMappingAiService } from './trafego-mapping-ai.service';
import { resolveInitiator } from '../common/utils/initiator.util';
import {
  AcknowledgeAlertDto,
  AddKeywordsDto,
  AddNegativesDto,
  ApplyRecommendationDto,
  UpdateAdScheduleDto,
  CreateRsaDto,
  CreateSearchCampaignDto,
  DashboardQueryDto,
  GenerateRsaDto,
  StartBackfillDto,
  ListLeadFormSubmissionsDto,
  ListRecommendationsDto,
  MutateBaseDto,
  RemoveAdGroupDto,
  RemoveCampaignDto,
  UpdateAccountDto,
  UpdateBiddingStrategyDto,
  UpdateAiMaxDto,
  UpdateBudgetDto,
  UpdateCampaignDto,
  UpdateCredentialsDto,
  UpdateLeadFormSettingsDto,
  UpdateSettingsDto,
  // Sprint 1 backlog (2026-05-17)
  CreateConversionActionDto,
  UpdateConversionActionDto,
  RemoveConversionActionDto,
  EnableEnhancedConversionsDto,
  TriggerEnhancedConvUploadDto,
  CreateExtensionDto,
  AttachExtensionDto,
  DetachExtensionDto,
  RemoveExtensionDto,
  // Sprint 3
  UpdateGeoTargetsDto,
  UpdateLanguageTargetsDto,
  UpdateDeviceTargetingDto,
  BulkAddNegativesDto,
  BulkUpdateStatusDto,
  // Sprint 3.1
  CreateSharedNegativeListDto,
  AttachSharedNegativeListDto,
  UpdateLocationBidModifiersDto,
  // Sprint 4
  CreatePmaxCampaignDto,
  GetCallHistoryDto,
  CreateAdGroupDto,
  UpdateAdGroupDto,
  UpdateRsaDto,
  RemoveAdDto,
  AttachCallAssetDto,
  // Sprint 4.1
  CreatePmaxAssetGroupDto,
  AddAssetsToPmaxAssetGroupDto,
  CreateExperimentDto,
  // Sprint 4.2
  AddTreatmentArmDto,
  ScheduleExperimentDto,
  EndExperimentDto,
  PromoteExperimentDto,
  GraduateExperimentDto,
  GetExperimentResultsDto,
  // Bug-fix batch (2026-05-17) — cleanup orfaos
  RemoveAssetDto,
} from './trafego.dto';

@Controller('trafego')
@UseGuards(JwtAuthGuard)
export class TrafegoController {
  constructor(
    private readonly service: TrafegoService,
    private readonly oauth: TrafegoOAuthService,
    private readonly config: TrafegoConfigService,
    private readonly leadForm: TrafegoLeadFormService,
    private readonly recommendations: TrafegoRecommendationsService,
    private readonly backfillSvc: TrafegoBackfillService,
    private readonly mappingAi: TrafegoMappingAiService,
    @InjectQueue('trafego-sync') private readonly syncQueue: Queue,
    @InjectQueue('trafego-mutate') private readonly mutateQueue: Queue,
    @InjectQueue('trafego-enhanced-conv')
    private readonly enhancedConvQueue: Queue,
    @InjectQueue('trafego-read')
    private readonly readQueue: Queue,
    @Inject(TRAFEGO_MUTATE_QUEUE_EVENTS)
    private readonly mutateQueueEvents: QueueEvents,
    @Inject(TRAFEGO_ENHANCED_CONV_QUEUE_EVENTS)
    private readonly enhancedConvQueueEvents: QueueEvents,
    @Inject(TRAFEGO_READ_QUEUE_EVENTS)
    private readonly readQueueEvents: QueueEvents,
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
  async oauthStart(@Req() req: any, @Query('return') ret?: string) {
    // Mapeamento FIXO (sem open-redirect): só caminhos conhecidos do front.
    // ?return=jurisflow → volta pra tela nova; default → front antigo.
    const returnTo =
      ret === 'jurisflow'
        ? '/sistema/trafego/configuracoes'
        : '/atendimento/marketing/trafego';
    const url = await this.oauth.buildAuthUrl(req.user.tenant_id, returnTo);
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
    // Erros voltam sempre pro caminho padrão; o sucesso usa o returnTo do state.
    const defaultPath = '/atendimento/marketing/trafego';
    const errBase = `${webBase}${defaultPath}?oauth=error`;

    if (error) {
      return res.redirect(`${errBase}&reason=${encodeURIComponent(error)}`);
    }
    if (!code || !state) {
      return res.redirect(`${errBase}&reason=missing_params`);
    }

    try {
      const { tenantId, returnTo } = await this.oauth.handleCallback(code, state);

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

      return res.redirect(`${webBase}${returnTo || defaultPath}?oauth=success`);
    } catch (e: any) {
      return res.redirect(`${errBase}&reason=${encodeURIComponent(e.message ?? 'unknown')}`);
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
   *
   * Aceita id = UUID interno OU google_campaign_id (via requireCampaign).
   * include_history=true anexa ultimas 10 mutacoes do schedule.
   */
  @Get('campaigns/:id/schedule')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  async getCampaignSchedule(
    @Req() req: any,
    @Param('id') id: string,
    @Query('include_history') includeHistory?: string,
  ) {
    return this.service.getCampaignSchedule(req.user.tenant_id, id, {
      includeHistory: includeHistory === 'true' || includeHistory === '1',
    });
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

  /**
   * Atualiza estratégia de lance da campanha (Fase 4c).
   *
   * Expandido em 2026-05-17: agora valida 9 categorias de regra antes
   * de enfileirar — bloqueia mudancas inseguras (TARGET_SPEND deprecated,
   * noop, params condicionais faltando) e retorna warnings pra mudancas
   * arriscadas mas permitidas (learning period perdido, valores suspeitos).
   *
   * Suporta `validate_only: true` retornando preview sem mutar.
   * Aceita `campaign_id` como UUID interno OU google_campaign_id (via
   * requireCampaign, fix #2 de 2026-05-17).
   */
  @Patch('campaigns/:id/bidding-strategy')
  @Roles('ADMIN', 'ADVOGADO')
  async updateBiddingStrategy(
    @Req() req: any,
    @Param('id') campaignId: string,
    @Body() dto: UpdateBiddingStrategyDto,
  ) {
    const tenantId = req.user.tenant_id;

    // Resolve campanha (UUID ou google_id) — propaga 404 cedo com mensagem clara.
    const campaign = await this.service.getCampaignByEither(tenantId, campaignId);
    if (!campaign) {
      throw new HttpException(
        `Campanha nao encontrada (id="${campaignId}"). Confira em traffic_list_campaigns.`,
        HttpStatus.NOT_FOUND,
      );
    }

    const validation = await this.service.validateBiddingStrategyChange(
      tenantId,
      campaign,
      dto,
      { allowDeprecatedTargetSpend: process.env.TRAFEGO_ALLOW_TARGET_SPEND === 'true' },
    );

    if (validation.blockingErrors.length > 0) {
      throw new HttpException(
        validation.blockingErrors.join(' | '),
        HttpStatus.BAD_REQUEST,
      );
    }

    const preview = {
      from: campaign.bidding_strategy ?? null,
      to: dto.bidding_strategy,
      campaign_name: campaign.name,
      campaign_id_local: campaign.id,
      google_campaign_id: campaign.google_campaign_id,
      learning_period_days_estimate: validation.learningPeriodDays,
    };

    // SEMPRE enfileira — incluindo validate_only=true. Antes (ate 2026-05-17)
    // o controller fazia shortcut em validate_only=true retornando direto sem
    // passar pelo worker. Isso causou inconsistencia com outras tools (negatives
    // logavam validate_only; bidding_strategy nao logava). Fix: padroniza
    // comportamento — toda chamada vira log proprio, validate_only roda no SDK
    // Google com flag validate_only=true (Google retorna SUCCESS sem aplicar)
    // e log fica com validate_only=true rastreavel.
    const result = await this.enqueueMutate(
      req,
      'trafego-mutate-update-bidding-strategy',
      { campaignId: campaign.id, ...dto },
    );

    return {
      ...result,
      warnings: validation.warnings,
      preview,
    };
  }

  /**
   * AI Max for Search — estado atual (preenchido pelo sync de campanha via
   * campaign.ai_max_setting.enable_ai_max). `available=false` quando a campanha
   * nao e do tipo SEARCH (AI Max so vale pra Pesquisa).
   */
  @Get('campaigns/:id/ai-max')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  async getAiMax(@Req() req: any, @Param('id') id: string) {
    return this.service.getAiMaxSettings(req.user.tenant_id, id);
  }

  /**
   * Liga/desliga AI Max for Search (campaign.ai_max_setting.enable_ai_max).
   * Usa update_mask EXPLICITO no worker (auto-mask falha em campo nested) +
   * audit-log + guards OAB. `validate_only: true` faz dry-run no Google sem
   * aplicar. So faz sentido pra campanhas SEARCH.
   */
  @Post('campaigns/:id/ai-max')
  @Roles('ADMIN', 'ADVOGADO')
  async updateAiMax(
    @Req() req: any,
    @Param('id') campaignId: string,
    @Body() dto: UpdateAiMaxDto,
  ) {
    return await this.enqueueMutate(req, 'trafego-mutate-update-ai-max', {
      campaignId,
      enabled: dto.enabled,
      reason: dto.reason,
      validate_only: dto.validate_only,
    });
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

  /**
   * Remove (soft-delete) uma campanha no Google Ads (status=REMOVED).
   *
   * Endpoint robusto com guard-rails. Substitui o DELETE legacy (mantido
   * abaixo pra back-compat mas sem validacoes).
   *
   * Valida 4 categorias antes de enfileirar:
   *   1. Existencia (404 explicito)
   *   2. Status REMOVED (noop)
   *   3. confirm + reason min 3 chars (DTO + double-check)
   *   4. ENABLED sem force_if_enabled, OU historico relevante sem
   *      confirm_with_history -> bloqueia com mensagem instrutiva
   *
   * Retorna preview do cascade (ad_groups, ads, keywords) + warnings
   * (ex: aprendizado perdido se historico relevante). validate_only=true
   * sempre passa pelo worker e loga.
   */
  @Post('campaigns/:id/remove')
  @Roles('ADMIN', 'ADVOGADO')
  async removeCampaignWithGuards(
    @Req() req: any,
    @Param('id') campaignId: string,
    @Body() dto: RemoveCampaignDto,
  ) {
    const tenantId = req.user.tenant_id;

    const campaign = await this.service.getCampaignByEither(tenantId, campaignId);
    if (!campaign) {
      throw new HttpException(
        `Campanha nao encontrada (id="${campaignId}"). Confira em traffic_list_campaigns.`,
        HttpStatus.NOT_FOUND,
      );
    }

    const validation = await this.service.validateCampaignRemoval(
      tenantId,
      campaign,
      dto,
    );

    if (validation.blockingErrors.length > 0) {
      throw new HttpException(
        validation.blockingErrors.join(' | '),
        HttpStatus.BAD_REQUEST,
      );
    }

    const result = await this.enqueueMutate(
      req,
      'trafego-mutate-remove-campaign',
      {
        campaignId: campaign.id,
        reason: dto.reason,
        validate_only: dto.validate_only,
      },
    );

    return {
      ...result,
      warnings: validation.warnings,
      preview: {
        ...validation.preview,
        google_campaign_id: campaign.google_campaign_id,
      },
    };
  }

  /**
   * @deprecated Use POST /campaigns/:id/remove (com confirm + reason
   * obrigatorios + guard-rails). Mantido pra back-compat de scripts/UI
   * que ainda usam DELETE simples.
   */
  @Delete('campaigns/:id')
  @Roles('ADMIN', 'ADVOGADO')
  async removeCampaign(
    @Req() req: any,
    @Param('id') campaignId: string,
    @Body() dto: MutateBaseDto,
  ) {
    return await this.enqueueMutate(req, 'trafego-mutate-remove-campaign', {
      campaignId,
      ...dto,
    });
  }

  /**
   * Remove (soft-delete) um ad_group no Google Ads (status=REMOVED).
   * Mesmo padrao de removeCampaignWithGuards + check adicional: bloqueia
   * se for o UNICO ad_group ativo da campanha (sem isso a campanha fica
   * orfã sem onde servir).
   */
  @Post('ad-groups/:id/remove')
  @Roles('ADMIN', 'ADVOGADO')
  async removeAdGroupWithGuards(
    @Req() req: any,
    @Param('id') adGroupId: string,
    @Body() dto: RemoveAdGroupDto,
  ) {
    const tenantId = req.user.tenant_id;

    const adGroup = await this.service.getAdGroupByEither(tenantId, adGroupId);
    if (!adGroup) {
      throw new HttpException(
        `Ad group nao encontrado (id="${adGroupId}"). Confira em traffic_list_ad_groups.`,
        HttpStatus.NOT_FOUND,
      );
    }

    const validation = await this.service.validateAdGroupRemoval(
      tenantId,
      adGroup,
      dto,
    );

    if (validation.blockingErrors.length > 0) {
      throw new HttpException(
        validation.blockingErrors.join(' | '),
        HttpStatus.BAD_REQUEST,
      );
    }

    const result = await this.enqueueMutate(
      req,
      'trafego-mutate-remove-ad-group',
      {
        adGroupId: adGroup.id,
        reason: dto.reason,
        validate_only: dto.validate_only,
      },
    );

    return {
      ...result,
      warnings: validation.warnings,
      preview: {
        ...validation.preview,
        google_ad_group_id: adGroup.google_ad_group_id,
      },
    };
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

  // ═══════════════════════════════════════════════════════════════════════
  // Sprint 1 backlog (2026-05-17) — Conversion Actions, Ad Groups, RSAs
  //
  // Padrao: controller fino + delega validacao especifica pra service
  // (quando aplicavel) + enfileira via enqueueMutate. Audit log automatico.
  // ═══════════════════════════════════════════════════════════════════════

  /** Cria ConversionAction nova. */
  @Post('conversion-actions')
  @Roles('ADMIN', 'ADVOGADO')
  async createConversionAction(
    @Req() req: any,
    @Body() dto: CreateConversionActionDto,
  ) {
    return await this.enqueueMutate(
      req,
      'trafego-mutate-create-conversion-action',
      dto,
    );
  }

  /** Atualiza ConversionAction existente. */
  @Patch('conversion-actions/:id')
  @Roles('ADMIN', 'ADVOGADO')
  async updateConversionAction(
    @Req() req: any,
    @Param('id') conversionActionId: string,
    @Body() dto: UpdateConversionActionDto,
  ) {
    return await this.enqueueMutate(
      req,
      'trafego-mutate-update-conversion-action',
      { conversionActionId, ...dto },
    );
  }

  /** Remove (soft) ConversionAction. */
  @Delete('conversion-actions/:id')
  @Roles('ADMIN', 'ADVOGADO')
  async removeConversionAction(
    @Req() req: any,
    @Param('id') conversionActionId: string,
    @Body() dto: RemoveConversionActionDto,
  ) {
    return await this.enqueueMutate(
      req,
      'trafego-mutate-remove-conversion-action',
      { conversionActionId, ...dto },
    );
  }

  /** Alias POST de remove (body em DELETE eh nao-padrao; MCP usa POST). */
  @Post('conversion-actions/:id/remove')
  @Roles('ADMIN', 'ADVOGADO')
  async removeConversionActionPost(
    @Req() req: any,
    @Param('id') conversionActionId: string,
    @Body() dto: RemoveConversionActionDto,
  ) {
    return this.removeConversionAction(req, conversionActionId, dto);
  }

  /**
   * Trigger manual do upload Enhanced Conversions for Leads (cron equivalente).
   * Enfileira job na queue trafego-enhanced-conv, worker processa via
   * EnhancedConvUploadCron.triggerManual + retorna contadores.
   *
   * Util pra: (a) processar leads recentes apos primeira habilitacao da feature,
   * (b) re-tentar leads que ficaram pendentes apos manutencao, (c) admin
   * querendo forcar refresh sem esperar 04h Maceio.
   *
   * So roda pra tenants com enhanced_conv_for_leads_upload_enabled=true.
   */
  @Post('conversion-tracking/trigger-enhanced-conv-upload')
  @Roles('ADMIN', 'ADVOGADO')
  async triggerEnhancedConvUpload(
    @Req() req: any,
    @Body() dto: TriggerEnhancedConvUploadDto,
  ) {
    const tenantId = req.user.tenant_id;

    // Confirma que tenant tem a flag ligada (defensivo — cron faria isso
    // de qualquer jeito, mas erro mais claro pra caller MCP).
    const settings = await this.service.getSettings(tenantId);
    if (!(settings as any)?.enhanced_conv_for_leads_upload_enabled) {
      throw new HttpException(
        'Enhanced Conversions for Leads upload NAO esta habilitado pra esta conta. ' +
          'Use traffic_enable_enhanced_conversions_for_leads(mode="API" ou "BOTH") primeiro.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const job = await this.enhancedConvQueue.add(
      'trafego-enhanced-conv-trigger',
      { tenantId, daysBack: dto.days_back },
      {
        jobId: `enhanced-conv-trigger-${tenantId}-${Date.now()}`,
        removeOnComplete: 50,
        removeOnFail: 20,
        attempts: 1,
      },
    );

    // Aguarda resultado (pode demorar — N leads x M tenants, com upload
    // a Google Ads em cada). Timeout 90s defensivo. Pra > 90s, caller usa
    // outro endpoint de status (nao implementado nesta iteracao — assumimos
    // que 90s cobre uso normal).
    try {
      const result = await job.waitUntilFinished(
        this.enhancedConvQueueEvents,
        90_000,
      );
      return {
        ok: true,
        message: `Upload Enhanced Conv enfileirado e processado em ${dto.days_back ?? 14} dias retroativos.`,
        ...result,
      };
    } catch (e: any) {
      throw new HttpException(
        `Trigger Enhanced Conv upload falhou ou demorou demais (>90s): ${e?.message ?? 'unknown'}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Habilita Enhanced Conversions for Leads.
   * Modo API/BOTH: tambem liga toggle local TrafficSettings.enhanced_conv_for_leads_upload_enabled.
   */
  @Post('conversion-tracking/enable-enhanced-conversions-for-leads')
  @Roles('ADMIN', 'ADVOGADO')
  async enableEnhancedConversions(
    @Req() req: any,
    @Body() dto: EnableEnhancedConversionsDto,
  ) {
    const tenantId = req.user.tenant_id;
    // Liga toggle local ANTES do mutate remoto pra evitar drift (se mutate
    // falhar, podemos ainda reativar manual).
    if ((dto.mode === 'API' || dto.mode === 'BOTH') && !dto.validate_only) {
      await this.service.setEnhancedConvUploadEnabled(tenantId, true);
    }
    return await this.enqueueMutate(
      req,
      'trafego-mutate-enable-enhanced-conversions',
      dto,
    );
  }

  /** Cria AdGroup novo dentro de uma campanha. */
  @Post('campaigns/:id/ad-groups')
  @Roles('ADMIN', 'ADVOGADO')
  async createAdGroup(
    @Req() req: any,
    @Param('id') campaignId: string,
    @Body() dto: CreateAdGroupDto,
  ) {
    return await this.enqueueMutate(req, 'trafego-mutate-create-ad-group', {
      campaignId,
      ...dto,
    });
  }

  /** Atualiza AdGroup existente. */
  @Patch('ad-groups/:id')
  @Roles('ADMIN', 'ADVOGADO')
  async updateAdGroup(
    @Req() req: any,
    @Param('id') adGroupId: string,
    @Body() dto: UpdateAdGroupDto,
  ) {
    return await this.enqueueMutate(req, 'trafego-mutate-update-ad-group', {
      adGroupId,
      ...dto,
    });
  }

  /** Atualiza RSA (pattern substituir: cria novo + remove antigo). */
  @Patch('ads/:id/rsa')
  @Roles('ADMIN', 'ADVOGADO')
  async updateRsa(
    @Req() req: any,
    @Param('id') adId: string,
    @Body() dto: UpdateRsaDto,
  ) {
    return await this.enqueueMutate(req, 'trafego-mutate-update-rsa', {
      adId,
      ...dto,
    });
  }

  /** Remove ad individual (status=REMOVED). */
  @Delete('ads/:id')
  @Roles('ADMIN', 'ADVOGADO')
  async removeAd(
    @Req() req: any,
    @Param('id') adId: string,
    @Body() dto: RemoveAdDto,
  ) {
    return await this.enqueueMutate(req, 'trafego-mutate-remove-ad', {
      adId,
      ...dto,
    });
  }

  /** Alias POST de remove (body em DELETE eh nao-padrao; MCP usa POST). */
  @Post('ads/:id/remove')
  @Roles('ADMIN', 'ADVOGADO')
  async removeAdPost(
    @Req() req: any,
    @Param('id') adId: string,
    @Body() dto: RemoveAdDto,
  ) {
    return this.removeAd(req, adId, dto);
  }

  /** Cria Call Asset + anexa em conta/campanha/ad_group. */
  @Post('assets/call')
  @Roles('ADMIN', 'ADVOGADO')
  async attachCallAsset(@Req() req: any, @Body() dto: AttachCallAssetDto) {
    return await this.enqueueMutate(
      req,
      'trafego-mutate-attach-call-asset',
      dto,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Sprint 2 backlog (2026-05-17) — Extensions/Assets + Quality Score
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Lista extensions (assets) anexados a conta/campanha/ad_group.
   *
   * Sprint 2.1: usa infra read queue do Sprint 4 — enfileira job
   * `kind=extensions` que faz GAQL live + retorna estrutura unificada.
   * Antes era placeholder. Agora data real.
   */
  @Get('extensions')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  async listExtensions(
    @Req() req: any,
    @Query('campaign_id') campaignId?: string,
    @Query('ad_group_id') adGroupId?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
  ) {
    // Fix 2026-05-18 (BUG-G): GAQL espera campaign.id e ad_group.id como
    // int64 (google_campaign_id / google_ad_group_id). Se vier UUID
    // interno do CRM, resolver pro google_id antes de enfileirar.
    const googleCampaignId = campaignId
      ? await this.service.resolveCampaignGoogleId(
          req.user.tenant_id,
          campaignId,
        )
      : undefined;
    const googleAdGroupId = adGroupId
      ? await this.service.resolveAdGroupGoogleId(
          req.user.tenant_id,
          adGroupId,
        )
      : undefined;
    return await this.enqueueReadJob(req, 'extensions', {
      campaign_id: googleCampaignId,
      ad_group_id: googleAdGroupId,
      type,
      status,
    });
  }

  /** Cria asset (sitelink, callout, snippet, call, location, price, promotion, lead_form). */
  @Post('extensions')
  @Roles('ADMIN', 'ADVOGADO')
  async createExtension(@Req() req: any, @Body() dto: CreateExtensionDto) {
    return await this.enqueueMutate(req, 'trafego-mutate-create-extension', dto);
  }

  /** Anexa asset existente a conta/campanha/ad_group. */
  @Post('extensions/attach')
  @Roles('ADMIN', 'ADVOGADO')
  async attachExtension(@Req() req: any, @Body() dto: AttachExtensionDto) {
    return await this.enqueueMutate(req, 'trafego-mutate-attach-extension', dto);
  }

  /** Desanexa asset (remove vinculo CustomerAsset/CampaignAsset/AdGroupAsset). */
  @Post('extensions/detach')
  @Roles('ADMIN', 'ADVOGADO')
  async detachExtension(@Req() req: any, @Body() dto: DetachExtensionDto) {
    return await this.enqueueMutate(req, 'trafego-mutate-detach-extension', dto);
  }

  /** Remove asset propriamente (status=REMOVED, vinculos sao cascadeados pelo Google). */
  @Post('extensions/remove')
  @Roles('ADMIN', 'ADVOGADO')
  async removeExtension(@Req() req: any, @Body() dto: RemoveExtensionDto) {
    return await this.enqueueMutate(req, 'trafego-mutate-remove-extension', dto);
  }

  /** Historico de Quality Score de uma keyword (MVP: snapshot atual). */
  @Get('keywords/:id/quality-score-history')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  async getKeywordQualityScoreHistory(
    @Req() req: any,
    @Param('id') keywordId: string,
    @Query('days') days?: string,
  ) {
    return await this.service.getKeywordQualityScoreHistory(
      req.user.tenant_id,
      keywordId,
      days ? parseInt(days, 10) : 30,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Sprint 3 backlog (2026-05-17) — Targeting + Bulk
  // ═══════════════════════════════════════════════════════════════════════

  @Post('campaigns/:id/geo-targets')
  @Roles('ADMIN', 'ADVOGADO')
  async updateGeoTargets(
    @Req() req: any,
    @Param('id') campaignId: string,
    @Body() dto: UpdateGeoTargetsDto,
  ) {
    return await this.enqueueMutate(
      req,
      'trafego-mutate-update-geo-targets',
      { campaignId, ...dto },
    );
  }

  @Post('campaigns/:id/language-targets')
  @Roles('ADMIN', 'ADVOGADO')
  async updateLanguageTargets(
    @Req() req: any,
    @Param('id') campaignId: string,
    @Body() dto: UpdateLanguageTargetsDto,
  ) {
    return await this.enqueueMutate(
      req,
      'trafego-mutate-update-language-targets',
      { campaignId, ...dto },
    );
  }

  @Post('campaigns/:id/device-targeting')
  @Roles('ADMIN', 'ADVOGADO')
  async updateDeviceTargeting(
    @Req() req: any,
    @Param('id') campaignId: string,
    @Body() dto: UpdateDeviceTargetingDto,
  ) {
    return await this.enqueueMutate(
      req,
      'trafego-mutate-update-device-targeting',
      { campaignId, ...dto },
    );
  }

  @Post('negatives/bulk')
  @Roles('ADMIN', 'ADVOGADO')
  async bulkAddNegatives(
    @Req() req: any,
    @Body() dto: BulkAddNegativesDto,
  ) {
    return await this.enqueueMutate(
      req,
      'trafego-mutate-bulk-add-negatives',
      dto,
    );
  }

  @Post('status/bulk')
  @Roles('ADMIN', 'ADVOGADO')
  async bulkUpdateStatus(
    @Req() req: any,
    @Body() dto: BulkUpdateStatusDto,
  ) {
    return await this.enqueueMutate(
      req,
      'trafego-mutate-bulk-update-status',
      dto,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Sprint 3.1 backlog (2026-05-17) — Shared library + Location bid
  // ═══════════════════════════════════════════════════════════════════════

  /** Lista SharedSets de negative keywords + suas attachments. */
  @Get('shared-negative-lists')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  async listSharedNegativeLists(@Req() req: any) {
    return await this.enqueueReadJob(req, 'shared_negative_lists', {});
  }

  /** Cria SharedSet + N keywords + opcionalmente anexa a N campanhas. */
  @Post('shared-negative-lists')
  @Roles('ADMIN', 'ADVOGADO')
  async createSharedNegativeList(
    @Req() req: any,
    @Body() dto: CreateSharedNegativeListDto,
  ) {
    return await this.enqueueMutate(
      req,
      'trafego-mutate-create-shared-negative-list',
      dto,
    );
  }

  /** Anexa SharedSet ja existente a N campanhas. */
  @Post('shared-negative-lists/attach')
  @Roles('ADMIN', 'ADVOGADO')
  async attachSharedNegativeList(
    @Req() req: any,
    @Body() dto: AttachSharedNegativeListDto,
  ) {
    return await this.enqueueMutate(
      req,
      'trafego-mutate-attach-shared-negative-list',
      dto,
    );
  }

  /** Define bid modifiers por location na campanha. */
  @Post('campaigns/:id/location-bid-modifiers')
  @Roles('ADMIN', 'ADVOGADO')
  async updateLocationBidModifiers(
    @Req() req: any,
    @Param('id') campaignId: string,
    @Body() dto: UpdateLocationBidModifiersDto,
  ) {
    return await this.enqueueMutate(
      req,
      'trafego-mutate-update-location-bid-modifiers',
      { campaignId, ...dto },
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Sprint 4 backlog (2026-05-17) — Tier P2 (PMax, calls, oauth, billing)
  // ═══════════════════════════════════════════════════════════════════════

  /** Cria PMax campaign (MVP — asset_group ainda manual via UI). */
  @Post('campaigns/pmax')
  @Roles('ADMIN', 'ADVOGADO')
  async createPmaxCampaign(@Req() req: any, @Body() dto: CreatePmaxCampaignDto) {
    return await this.enqueueMutate(req, 'trafego-mutate-create-pmax-campaign', dto);
  }

  /**
   * Gera URL de OAuth pra reconnect — quando o refresh_token caduca,
   * gestor chama esta tool e usuario abre a URL no browser pra refazer
   * o consent.
   */
  @Get('oauth/reconnect-link')
  @Roles('ADMIN', 'ADVOGADO')
  async getReconnectOAuthLink(@Req() req: any) {
    const url = await this.oauth.buildAuthUrl(req.user.tenant_id);
    return {
      ok: true,
      authorize_url: url,
      message:
        'Abra esta URL no browser pra refazer o consent OAuth do Google Ads. ' +
        'Apos completar, o refresh_token sera salvo automaticamente.',
    };
  }

  /** Lista call history via GAQL live (via worker queue). */
  @Get('reads/call-history')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  async getCallHistory(@Req() req: any, @Query() query: GetCallHistoryDto) {
    return await this.enqueueReadJob(req, 'call_history', {
      days_back: query.days_back ?? 30,
      campaign_id: query.campaign_id,
    });
  }

  /** Status de billing (setups + budgets) via GAQL live. */
  @Get('reads/billing-status')
  @Roles('ADMIN', 'ADVOGADO')
  async getBillingStatus(@Req() req: any) {
    return await this.enqueueReadJob(req, 'billing_status', {});
  }

  /**
   * BUG-F treatment (2026-05-18) — diagnose Enhanced Conversions for Leads.
   *
   * Combina:
   *  1. Estado atual via GAQL (customer.conversion_tracking_setting) — live
   *  2. TrafficSettings local (defaults, upload enabled)
   *  3. Mutate logs recentes pra ver tentativas + erros
   *  4. Checklist PT-BR de proximos passos baseado no diagnostico
   *
   * Read-only. Util DEPOIS de enable falhar com PERMISSION_DENIED — mostra
   * exatamente o que checar no Google Cloud + Google Ads UI.
   */
  @Get('diagnose/enhanced-conversions')
  @Roles('ADMIN', 'ADVOGADO')
  async diagnoseEnhancedConversions(@Req() req: any) {
    const tenantId = req.user.tenant_id;
    // Pega estado base (local DB + audit logs)
    const local = await this.service.diagnoseEnhancedConversions(tenantId);
    // Hidrata com estado live do Google via GAQL — pode falhar se OAuth
    // expirou (soft-fail, retorna o que tem)
    let googleState: any = null;
    try {
      googleState = await this.enqueueReadJob(req, 'customer_settings', {});
    } catch (e: any) {
      // Soft-fail: se ate o GAQL nega, eh outro nivel de problema
      local.next_steps.unshift(
        `Nao consegui ler estado atual via GAQL: ${e?.message ?? 'unknown'}. ` +
          `Provavel problema de OAuth/scope antes mesmo de tentar enable. ` +
          `Reconecte via traffic_reconnect_oauth_link.`,
      );
    }

    if (googleState?.conversion_tracking_setting?.enhanced_conversions_for_leads_enabled) {
      local.enabled_in_google = true;
      local.overall_status = 'OK';
      local.next_steps = [
        'Enhanced Conversions for Leads JA ESTA HABILITADA na conta Google Ads. ' +
          'Se quiser que o cron de upload comece a rodar, confirme que ' +
          'crm_settings.enhanced_conv_for_leads_upload_enabled = true.',
      ];
    } else if (googleState) {
      local.enabled_in_google = false;
      local.test_account = googleState.test_account ?? false;
      if (local.overall_status === 'NOT_ENABLED') {
        local.next_steps = [
          'Estado atual: DESABILITADA no Google Ads.',
          ...local.next_steps,
        ];
      }
    }

    return {
      ...local,
      google_live_state: googleState,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Sprint 4.1 backlog (2026-05-17) — PMax asset groups + Experiments
  // ═══════════════════════════════════════════════════════════════════════

  /** Lista PMax asset groups + counts + readiness warnings. */
  @Get('pmax-asset-groups')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  async listPmaxAssetGroups(
    @Req() req: any,
    @Query('campaign_id') campaignId?: string,
  ) {
    return await this.enqueueReadJob(req, 'pmax_asset_groups', {
      campaign_id: campaignId,
    });
  }

  /** Cria asset_group VAZIO numa PMax campaign existente. */
  @Post('pmax-asset-groups')
  @Roles('ADMIN', 'ADVOGADO')
  async createPmaxAssetGroup(
    @Req() req: any,
    @Body() dto: CreatePmaxAssetGroupDto,
  ) {
    return await this.enqueueMutate(
      req,
      'trafego-mutate-create-pmax-asset-group',
      dto,
    );
  }

  /** Adiciona Assets[] + AssetGroupAssets[] em 2 mutates sequenciais. */
  @Post('pmax-asset-groups/assets')
  @Roles('ADMIN', 'ADVOGADO')
  async addAssetsToPmaxAssetGroup(
    @Req() req: any,
    @Body() dto: AddAssetsToPmaxAssetGroupDto,
  ) {
    return await this.enqueueMutate(
      req,
      'trafego-mutate-add-assets-to-pmax-asset-group',
      dto,
    );
  }

  /** Cria Experiment (A/B test) em SETUP + control arm. */
  @Post('experiments')
  @Roles('ADMIN', 'ADVOGADO')
  async createExperiment(@Req() req: any, @Body() dto: CreateExperimentDto) {
    return await this.enqueueMutate(
      req,
      'trafego-mutate-create-experiment',
      dto,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Sprint 4.2 backlog (2026-05-17) — Experiments lifecycle
  // ═══════════════════════════════════════════════════════════════════════

  /** Adiciona ExperimentArm de treatment a um experiment em SETUP. */
  @Post('experiments/treatment-arms')
  @Roles('ADMIN', 'ADVOGADO')
  async addTreatmentArm(
    @Req() req: any,
    @Body() dto: AddTreatmentArmDto,
  ) {
    return await this.enqueueMutate(
      req,
      'trafego-mutate-add-treatment-arm',
      dto,
    );
  }

  /** Schedule experiment — SETUP -> INITIATED (async) -> ENABLED. */
  @Post('experiments/schedule')
  @Roles('ADMIN', 'ADVOGADO')
  async scheduleExperiment(
    @Req() req: any,
    @Body() dto: ScheduleExperimentDto,
  ) {
    return await this.enqueueMutate(
      req,
      'trafego-mutate-schedule-experiment',
      dto,
    );
  }

  /** End experiment — encerra ENABLED -> HALTED sem promover. */
  @Post('experiments/end')
  @Roles('ADMIN', 'ADVOGADO')
  async endExperiment(@Req() req: any, @Body() dto: EndExperimentDto) {
    return await this.enqueueMutate(
      req,
      'trafego-mutate-end-experiment',
      dto,
    );
  }

  /** Promote experiment — aplica mudancas do treatment na base_campaign. */
  @Post('experiments/promote')
  @Roles('ADMIN', 'ADVOGADO')
  async promoteExperiment(
    @Req() req: any,
    @Body() dto: PromoteExperimentDto,
  ) {
    return await this.enqueueMutate(
      req,
      'trafego-mutate-promote-experiment',
      dto,
    );
  }

  /** Graduate experiment — separa treatment como campanha standalone. */
  @Post('experiments/graduate')
  @Roles('ADMIN', 'ADVOGADO')
  async graduateExperiment(
    @Req() req: any,
    @Body() dto: GraduateExperimentDto,
  ) {
    return await this.enqueueMutate(
      req,
      'trafego-mutate-graduate-experiment',
      dto,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Bug-fix batch (2026-05-17) — cleanup asset orfaos
  // ═══════════════════════════════════════════════════════════════════════

  /** Remove um Asset orfao (sem attachments) da conta. */
  @Post('assets/remove')
  @Roles('ADMIN', 'ADVOGADO')
  async removeAsset(@Req() req: any, @Body() dto: RemoveAssetDto) {
    return await this.enqueueMutate(req, 'trafego-mutate-remove-asset', dto);
  }

  /** Get experiment results — metrics comparativas via GAQL live. */
  @Get('experiments/:id/results')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  async getExperimentResults(
    @Req() req: any,
    @Param('id') experimentId: string,
    @Query('days_back') daysBack?: string,
  ) {
    return await this.enqueueReadJob(req, 'experiment_results', {
      experiment_id: experimentId,
      days_back: daysBack ? parseInt(daysBack, 10) : 30,
    });
  }

  /**
   * Helper — enfileira read job na queue trafego-read e aguarda resultado.
   * Pattern equivalente ao enqueueMutate mas pra reads (sem audit log).
   */
  private async enqueueReadJob(
    req: any,
    kind:
      | 'call_history'
      | 'billing_status'
      | 'extensions'
      | 'shared_negative_lists'
      | 'pmax_asset_groups'
      | 'experiment_results'
      | 'customer_settings',
    params: Record<string, any>,
  ) {
    const tenantId = req.user.tenant_id;
    const account = await this.service.getAccount(tenantId);
    if (!account) {
      throw new HttpException(
        'Conecte uma conta antes de fazer reads live.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const job = await this.readQueue.add(
      'trafego-read',
      {
        tenantId,
        accountId: account.id,
        kind,
        params,
      },
      {
        jobId: `read-${kind}-${tenantId}-${Date.now()}`,
        removeOnComplete: 50,
        removeOnFail: 20,
        attempts: 1,
      },
    );
    try {
      const result = await job.waitUntilFinished(this.readQueueEvents, 30_000);
      return result;
    } catch (e: any) {
      throw new HttpException(
        `Read live falhou ou demorou demais: ${e?.message ?? 'unknown'}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
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

    // Le X-Initiator (sanitizado) pra distinguir Claude (via MCP) de
    // usuario clicando no painel. Helper aceita so prefixos confiaveis
    // (mcp:, ai_agent:); qualquer coisa fora cai no fallback user:<id>.
    const initiator = resolveInitiator(req);
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

    // Enfileira + AGUARDA resultado real do worker.
    // Fix 2026-05-17 (bug reportado pelo gestor de trafego): antes
    // retornava ok:true imediatamente apos add(), sem ver o resultado.
    // Dry-run virava inutil porque "mentia" — Google podia rejeitar
    // (partial_failure_error) e o caller nunca via. Agora aguardamos
    // o worker terminar via job.waitUntilFinished(queueEvents, ttl) e
    // propagamos status/error_message do MutateResult.
    const job = await this.mutateQueue.add(jobName, data, {
      jobId: `mutate-${jobName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      removeOnComplete: 100,
      removeOnFail: 50,
      attempts: 1, // Mutates nao retentam — caller decide se quer retry
    });

    let result: any;
    try {
      // Timeout 30s — Google Ads costuma responder em <5s, mas dry-run +
      // OAB validation + log persist pode levar mais. 30s eh defensivo.
      result = await job.waitUntilFinished(this.mutateQueueEvents, 30_000);
    } catch (err: any) {
      // job.waitUntilFinished rejeita se o job throws no processor OU se
      // o timeout estourar. Em ambos os casos, mensagem util ja vem no err.
      const errorMessage =
        err?.message || 'Falha desconhecida no worker de mutate';
      throw new HttpException(
        `Mutate falhou ou demorou demais (>30s): ${errorMessage}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // result eh um MutateResult — { status: SUCCESS | PARTIAL | FAILED, ... }
    // FAILED = erro no caminho (OAB block, API error, falta de credencial)
    // PARTIAL = Google retornou partial_failure_error (validate_only que
    //           Google rejeitou, ou apply com algumas operacoes falhando)
    if (result?.status === 'FAILED' || result?.status === 'PARTIAL') {
      throw new HttpException(
        `Mutate ${result.status}: ${
          result.errorMessage ?? '(sem detalhe — ver TrafficMutateLog)'
        }`,
        HttpStatus.BAD_REQUEST,
      );
    }

    return {
      ok: true,
      validate_only: validateOnly,
      message: validateOnly
        ? 'Dry-run executado — Google validou o payload com sucesso.'
        : 'Mutate aplicado com sucesso na Google Ads API.',
      mutate_log_id: result?.logId,
      resource_names: result?.resourceNames ?? [],
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

  /**
   * Sprint 3 (2026-05-17) — Dismiss recommendation.
   * Service.enqueueDismiss ja existia mas nao tinha endpoint exposto.
   */
  @Post('recommendations/:id/dismiss')
  @Roles('ADMIN', 'ADVOGADO')
  async dismissRecommendation(@Req() req: any, @Param('id') id: string) {
    return this.recommendations.enqueueDismiss(req.user.tenant_id, id, {
      resolvedBy: req.user.id,
    });
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

}
