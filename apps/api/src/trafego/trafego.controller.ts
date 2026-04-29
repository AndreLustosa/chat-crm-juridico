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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { TrafegoService } from './trafego.service';
import { TrafegoOAuthService } from './trafego-oauth.service';
import { TrafegoConfigService } from './trafego-config.service';
import {
  AcknowledgeAlertDto,
  DashboardQueryDto,
  UpdateAccountDto,
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
      await this.oauth.handleCallback(code, state);
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

  // ─── Sync manual (stub — worker real na Fase 2) ─────────────────────────

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
    // TODO: enfileirar job na BullMQ 'trafego-sync' (implementar na Fase 2)
    return {
      ok: true,
      message: 'Sync enfileirado (stub — implementacao real na Fase 2).',
    };
  }
}
