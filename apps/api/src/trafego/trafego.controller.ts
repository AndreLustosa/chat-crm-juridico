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
  UpdateAccountDto,
  UpdateBiddingStrategyDto,
  UpdateBudgetDto,
  UpdateCampaignDto,
  UpdateCredentialsDto,
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
    private readonly leadForm: TrafegoLeadFormService,
    private readonly recommendations: TrafegoRecommendationsService,
    private readonly backfillSvc: TrafegoBackfillService,
    private readonly mappingAi: TrafegoMappingAiService,
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

    if (dto.validate_only) {
      return {
        ok: true,
        validate_only: true,
        message: 'Mutate em DRY-RUN — payload valido, nada foi aplicado.',
        warnings: validation.warnings,
        preview,
      };
    }

    // Passa UUID interno pro enqueueMutate (resolve_id ja feito acima)
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

  /** Remove uma campanha no Google. */
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
