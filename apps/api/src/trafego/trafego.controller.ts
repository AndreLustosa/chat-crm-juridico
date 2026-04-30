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
import { TrafegoAiService } from './trafego-ai.service';
import { TrafegoLeadFormService } from './trafego-lead-form.service';
import { TrafegoAudiencesService } from './trafego-audiences.service';
import {
  AcknowledgeAlertDto,
  AddKeywordsDto,
  AddNegativesDto,
  AiDecisionFeedbackDto,
  AiTriggerLoopDto,
  CreateUserListDto,
  DashboardQueryDto,
  ListAiDecisionsDto,
  ListLeadFormSubmissionsDto,
  MapConversionActionDto,
  MutateBaseDto,
  UpdateAccountDto,
  UpdateAiPolicyDto,
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
    private readonly ai: TrafegoAiService,
    private readonly leadForm: TrafegoLeadFormService,
    private readonly audiences: TrafegoAudiencesService,
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
    return this.ai.triggerLoop(req.user.tenant_id, dto.loop_kind ?? 'TRIGGERED');
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
}
