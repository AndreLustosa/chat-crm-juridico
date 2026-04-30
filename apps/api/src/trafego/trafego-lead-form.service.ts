import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

/**
 * Processa webhooks do Lead Form Asset do Google Ads.
 *
 * O Lead Form é um asset nativo do Google Ads — usuário preenche dentro do
 * próprio anúncio (sem precisar de landing page). Google manda submission
 * via webhook em URL configurada no asset.
 *
 * Formato de payload (api_version "1.1"):
 *   {
 *     "lead_id": "...",
 *     "api_version": "1.1",
 *     "form_id": "...",
 *     "campaign_id": "21458273619",
 *     "google_key": "<secret pra validar>",
 *     "is_test": false,
 *     "gcl_id": "Cj0KCQiA...",
 *     "adgroup_id": "...",
 *     "creative_id": "...",
 *     "user_column_data": [
 *       { "column_id": "FULL_NAME", "string_value": "João da Silva" },
 *       { "column_id": "EMAIL", "string_value": "joao@example.com" },
 *       { "column_id": "PHONE_NUMBER", "string_value": "+5582...." }
 *     ]
 *   }
 *
 * URL configurada no Google Ads:
 *   https://api.andrelustosaadvogados.com.br/trafego/lead-form-webhook
 *     ?tenant_id=<UUID>&google_key=<secret>
 *
 * O endpoint é PÚBLICO (Google não manda JWT) — autenticação via:
 *   1. tenant_id na query  → resolve TrafficSettings + secret
 *   2. google_key na query → match com lead_form_webhook_secret
 */
@Injectable()
export class TrafegoLeadFormService {
  private readonly logger = new Logger(TrafegoLeadFormService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Processa um payload de Lead Form. Lança HttpException se a validação
   * de tenant_id/google_key falhar (sem detalhar pro lado do atacante).
   *
   * Sempre persiste em TrafficLeadFormSubmission (mesmo em ERROR), pra
   * audit trail. Cria Lead se auto_create_lead=true.
   */
  async processWebhook(
    tenantIdParam: string | undefined,
    googleKeyParam: string | undefined,
    payload: Record<string, any>,
    headers: Record<string, any> = {},
  ) {
    if (!tenantIdParam) {
      throw new HttpException(
        'Parâmetros inválidos.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const settings = await this.prisma.trafficSettings.findUnique({
      where: { tenant_id: tenantIdParam },
    });
    if (!settings || !settings.lead_form_webhook_secret) {
      // Não vazamos detalhes pro caller — 401 genérico
      this.logger.warn(
        `[lead-form] webhook hit sem secret configurado tenant=${tenantIdParam}`,
      );
      throw new HttpException('Não autorizado.', HttpStatus.UNAUTHORIZED);
    }

    // google_key pode vir tanto na query quanto no body (a depender da
    // configuração do Google Ads). Body tem precedência.
    const incomingKey =
      typeof payload.google_key === 'string' && payload.google_key.length > 0
        ? payload.google_key
        : (googleKeyParam ?? null);

    if (incomingKey !== settings.lead_form_webhook_secret) {
      this.logger.warn(
        `[lead-form] secret mismatch tenant=${tenantIdParam}`,
      );
      throw new HttpException('Não autorizado.', HttpStatus.UNAUTHORIZED);
    }

    // Conta ativa do tenant — Lead Form sempre vincula a uma TrafficAccount
    const account = await this.prisma.trafficAccount.findFirst({
      where: { tenant_id: tenantIdParam, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!account) {
      throw new HttpException(
        'Conta de tráfego não conectada para este tenant.',
        HttpStatus.CONFLICT,
      );
    }

    // ── Extração de campos do payload ─────────────────────────────────
    const userColumns = Array.isArray(payload.user_column_data)
      ? payload.user_column_data
      : [];
    const fields = userColumnDataToMap(userColumns);

    const fullName = pickString(fields, [
      'FULL_NAME',
      'FIRST_NAME',
      'full_name',
      'name',
    ]);
    const email = pickString(fields, ['EMAIL', 'email']);
    const phoneRaw = pickString(fields, [
      'PHONE_NUMBER',
      'phone',
      'phone_number',
    ]);
    const phone = phoneRaw ? normalizePhoneE164(phoneRaw) : null;
    const gclid =
      pickString(payload, ['gcl_id', 'gclid', 'google_gclid']) ?? null;
    const submittedAtRaw =
      payload.submitted_at ?? payload.lead_creation_time ?? null;
    const submittedAt = parseDate(submittedAtRaw) ?? new Date();
    const isTest = !!payload.is_test;

    // Mapeia campaign_id externo → TrafficCampaign local (best-effort)
    const externalCampaignId = pickString(payload, ['campaign_id']);
    const campaign = externalCampaignId
      ? await this.prisma.trafficCampaign.findUnique({
          where: {
            account_id_google_campaign_id: {
              account_id: account.id,
              google_campaign_id: externalCampaignId,
            },
          },
          select: { id: true },
        })
      : null;

    // Custom fields: tudo que NÃO foi mapeado em coluna dedicada
    const customFields: Record<string, any> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (!['FULL_NAME', 'FIRST_NAME', 'EMAIL', 'PHONE_NUMBER'].includes(k)) {
        customFields[k] = v;
      }
    }

    const ipAddress =
      typeof headers['x-forwarded-for'] === 'string'
        ? headers['x-forwarded-for'].split(',')[0]?.trim() ?? null
        : null;
    const userAgent =
      typeof headers['user-agent'] === 'string' ? headers['user-agent'] : null;

    // ── Persiste TrafficLeadFormSubmission ─────────────────────────────
    const submission = await this.prisma.trafficLeadFormSubmission.create({
      data: {
        tenant_id: tenantIdParam,
        account_id: account.id,
        google_asset_id: pickString(payload, ['form_id']) ?? null,
        campaign_id: campaign?.id ?? null,
        gclid,
        gbraid: pickString(payload, ['gbraid', 'google_gbraid']) ?? null,
        wbraid: pickString(payload, ['wbraid', 'google_wbraid']) ?? null,
        full_name: fullName,
        email,
        phone,
        custom_fields: customFields as Prisma.InputJsonValue,
        ip_address: ipAddress,
        user_agent: userAgent,
        raw_payload: payload as Prisma.InputJsonValue,
        submitted_at: submittedAt,
        status: 'PENDING',
      },
    });

    // is_test=true → registra mas não cria Lead
    if (isTest) {
      await this.prisma.trafficLeadFormSubmission.update({
        where: { id: submission.id },
        data: { status: 'REJECTED', error_message: 'is_test=true', processed_at: new Date() },
      });
      this.logger.log(`[lead-form] submission ${submission.id} é teste — skip lead creation`);
      return { ok: true, submission_id: submission.id, lead_id: null, test: true };
    }

    // Auto-criação desabilitada → fica em PENDING pra revisão manual
    if (!settings.lead_form_auto_create_lead) {
      this.logger.log(
        `[lead-form] submission ${submission.id} salvo PENDING (auto_create_lead=false)`,
      );
      return { ok: true, submission_id: submission.id, lead_id: null };
    }

    if (!phone) {
      // Sem phone, Lead não pode ser criado (constraint @@unique [tenant, phone])
      await this.prisma.trafficLeadFormSubmission.update({
        where: { id: submission.id },
        data: {
          status: 'REJECTED',
          error_message: 'Submission sem phone — Lead não pode ser criado.',
          processed_at: new Date(),
        },
      });
      return { ok: true, submission_id: submission.id, lead_id: null };
    }

    // ── Cria/dedupe Lead ───────────────────────────────────────────────
    try {
      const existingLead = await this.prisma.lead.findUnique({
        where: { tenant_id_phone: { tenant_id: tenantIdParam, phone } },
      });

      let leadId: string;
      if (existingLead) {
        // Reaproveita lead existente — apenas adiciona attribution se faltava
        const patch: Prisma.LeadUpdateInput = {};
        if (!existingLead.email && email) patch.email = email;
        if (!existingLead.name && fullName) patch.name = fullName;
        if (!existingLead.google_gclid && gclid) {
          patch.google_gclid = gclid;
          patch.google_click_at = submittedAt;
        }
        if (!existingLead.origin) patch.origin = 'GOOGLE_ADS_LEAD_FORM';
        if (Object.keys(patch).length > 0) {
          await this.prisma.lead.update({
            where: { id: existingLead.id },
            data: patch,
          });
        }
        leadId = existingLead.id;
        await this.prisma.trafficLeadFormSubmission.update({
          where: { id: submission.id },
          data: {
            status: 'DUPLICATE',
            lead_id: leadId,
            processed_at: new Date(),
          },
        });
      } else {
        const created = await this.prisma.lead.create({
          data: {
            tenant_id: tenantIdParam,
            phone,
            email,
            name: fullName,
            origin: 'GOOGLE_ADS_LEAD_FORM',
            stage: settings.lead_form_default_stage ?? 'INTERESSADO',
            google_gclid: gclid,
            google_click_at: gclid ? submittedAt : null,
          },
        });
        leadId = created.id;
        await this.prisma.trafficLeadFormSubmission.update({
          where: { id: submission.id },
          data: {
            status: 'PROCESSED',
            lead_id: leadId,
            processed_at: new Date(),
          },
        });
      }

      this.logger.log(
        `[lead-form] submission=${submission.id} lead=${leadId} ` +
          `(${existingLead ? 'reaproveitado' : 'criado'}) gclid=${gclid ? 'yes' : 'no'}`,
      );

      return { ok: true, submission_id: submission.id, lead_id: leadId };
    } catch (err: any) {
      this.logger.error(
        `[lead-form] falha criação Lead submission=${submission.id}: ${err?.message ?? err}`,
      );
      await this.prisma.trafficLeadFormSubmission.update({
        where: { id: submission.id },
        data: {
          status: 'ERROR',
          error_message: String(err?.message ?? err).slice(0, 1000),
          processed_at: new Date(),
        },
      });
      // Retornamos 200 OK MESMO assim — Google Ads desabilita o Lead Form
      // depois de muitos retries falhados. Erro fica registrado pra
      // troubleshooting interno.
      return {
        ok: true,
        submission_id: submission.id,
        lead_id: null,
        error: 'lead_creation_failed',
      };
    }
  }

  /** Lista submissions recentes pra UI. */
  async listSubmissions(
    tenantId: string,
    opts: { status?: string; limit?: number } = {},
  ) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const where: Prisma.TrafficLeadFormSubmissionWhereInput = {
      tenant_id: tenantId,
    };
    if (opts.status) where.status = opts.status;
    return this.prisma.trafficLeadFormSubmission.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: limit,
      select: {
        id: true,
        google_asset_id: true,
        campaign_id: true,
        gclid: true,
        full_name: true,
        email: true,
        phone: true,
        status: true,
        error_message: true,
        lead_id: true,
        submitted_at: true,
        created_at: true,
        processed_at: true,
      },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

/** Converte user_column_data array em map {column_id: value}. */
function userColumnDataToMap(arr: any[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const key = typeof item.column_id === 'string' ? item.column_id : null;
    const val =
      typeof item.string_value === 'string' ? item.string_value : null;
    if (key && val) out[key] = val;
  }
  return out;
}

function pickString(
  obj: Record<string, any>,
  keys: string[],
): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

/** Normaliza phone pra E.164 com +55. Aceita formatos BR comuns. */
function normalizePhoneE164(raw: string): string | null {
  if (!raw) return null;
  // Remove tudo exceto dígitos e '+'
  let digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) {
    // Já E.164 — mantém
    return digits;
  }
  // Strips leading zeros (DDD vem com 0 às vezes)
  digits = digits.replace(/^0+/, '');
  // Se 10-11 dígitos, assume BR
  if (digits.length === 10 || digits.length === 11) {
    return `+55${digits}`;
  }
  // Se já tem 12-13 com 55 no início
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    return `+${digits}`;
  }
  // Não conseguiu — retorna como veio (com + se não tinha)
  return digits.length > 0 ? `+${digits}` : null;
}

function parseDate(raw: unknown): Date | null {
  if (raw instanceof Date) return raw;
  if (typeof raw === 'string' || typeof raw === 'number') {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
