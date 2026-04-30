import {
  Controller,
  Get,
  Post,
  Patch,
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
import {
  AcknowledgeAlertDto,
  AddKeywordsDto,
  AddNegativesDto,
  DashboardQueryDto,
  MapConversionActionDto,
  MutateBaseDto,
  UpdateAccountDto,
  UpdateBudgetDto,
  UpdateCampaignDto,
  UpdateCredentialsDto,
  UpdateSettingsDto,
} from './trafego.dto';

@Controller('trafego')
@UseGuards(JwtAuthGuard)
export class TrafegoController {
  constructor(
    private readonly service: TrafegoService,
    private readonly oauth: TrafegoOAuthService,
    private readonly config: TrafegoConfigService,
    @InjectQueue('trafego-sync') private readonly syncQueue: Queue,
    @InjectQueue('trafego-mutate') private readonly mutateQueue: Queue,
  ) {}

  // ─── Dashboard ──────────────────────────────────────────────────────────

  @Get('dashboard')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  async dashboard(@Req() req: any, @Query() query: DashboardQueryDto) {
    return this.service.getDashboard(req.user.tenant_id, {
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
    const forwardedProto = req.get('x-forwarded-proto') || req.protocol || 'https';
    const webBase =
      process.env.FRONTEND_BASE_URL ||
      (forwardedHost ? `${forwardedProto}://${forwardedHost}` : null) ||
      'http://localhost:3000';
    const successPath = '/atendimento/marketing/trafego?oauth=success';
    const errorPath = '/atendimento/marketing/trafego?oauth=error';

    if (error) {
      return res.redirect(`${webBase}${errorPath}&reason=${encodeURIComponent(error)}`);
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
  ) {
    return this.service.listCampaigns(req.user.tenant_id, {
      includeArchived: includeArchived === 'true',
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
  async updateCredentials(
    @Req() req: any,
    @Body() dto: UpdateCredentialsDto,
  ) {
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
    return this.service.listAdGroups(req.user.tenant_id, { campaignId, status });
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
}
