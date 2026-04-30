import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { createHash } from 'crypto';
import type { Customer } from 'google-ads-api';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleAdsClientService } from './google-ads-client.service';

export const OCI_JOB = 'trafego-oci-upload';

export type OCIUploadInput = {
  /// ID do TrafficOCIUpload em status PENDING
  uploadId: string;
};

/**
 * Servico de Offline Conversion Imports (OCI).
 *
 * Pipeline:
 *   1. enqueueUpload(leadId, conversionActionId, triggerEvent, value?, manual?)
 *      cria registro TrafficOCIUpload status=PENDING + enfileira job.
 *   2. Worker processa job: chama customer.conversionUploads.uploadClickConversions
 *   3. Atualiza status para UPLOADED / FAILED / DUPLICATE_REJECTED.
 *
 * Dedupe: unique(conversion_action_id, gclid, conversion_at). Mesma triade
 * = mesmo upload (Google rejeita duplicata, mas evitamos chamar a API).
 *
 * Sem gclid: SE conversion_action.type permitir Enhanced Conversions for
 * Leads (ECL), tentamos via email_sha256/phone_sha256. Caso contrario,
 * marca como SKIPPED (rejeitado por falta de attribution).
 *
 * NAO recomendado uploadar conversao com gclid > 90 dias antes da chamada
 * (Google ignora). Filtramos no enqueue.
 */
@Injectable()
export class TrafficOCIService {
  private readonly logger = new Logger(TrafficOCIService.name);

  constructor(
    private prisma: PrismaService,
    private clientSvc: GoogleAdsClientService,
    @InjectQueue('trafego-oci') private ociQueue: Queue,
  ) {}

  /**
   * Enfileira upload OCI a partir de um evento CRM (lead.created, client.signed,
   * payment.received, etc). Resolve qual ConversionAction esta mapeada ao
   * evento. Se nao estiver mapeada, registra debug log e retorna null (no-op).
   *
   * Idempotencia: se upload com mesma triade (action+gclid+conversion_at)
   * ja existe, devolve o existente sem enfileirar de novo.
   */
  async enqueueUpload(input: {
    tenantId: string;
    leadId: string;
    triggerEvent: string;
    /// Quando aconteceu o evento offline (lead.created, contrato assinado, pagamento)
    conversionAt: Date;
    /// Valor da conversao em micros (override do default da ConversionAction)
    valueMicros?: bigint | null;
    /// Manual (UI) ou automatico (listener)
    manual?: boolean;
  }): Promise<{ uploadId: string | null; reason?: string }> {
    const account = await this.prisma.trafficAccount.findUnique({
      where: { tenant_id: input.tenantId },
    });
    if (!account) {
      return { uploadId: null, reason: 'no_account' };
    }

    // Achar ConversionAction mapeada a esse evento
    const ca = await this.prisma.trafficConversionAction.findFirst({
      where: {
        tenant_id: input.tenantId,
        account_id: account.id,
        crm_event_kind: input.triggerEvent,
        status: 'ENABLED',
      },
    });
    if (!ca) {
      return {
        uploadId: null,
        reason: `no_conversion_action_for_event:${input.triggerEvent}`,
      };
    }

    const lead = await this.prisma.lead.findFirst({
      where: { id: input.leadId, tenant_id: input.tenantId },
    });
    if (!lead) {
      return { uploadId: null, reason: 'lead_not_found' };
    }

    if (!lead.google_gclid && !lead.google_gbraid && !lead.google_wbraid) {
      // Sem identifier do Google — seria preciso ECL (Enhanced Conversions for Leads)
      // por email/phone. Pra simplificar Sprint B.3, marcamos como skip.
      // ECL fica como follow-up (Sprint B+ ou C).
      this.logger.log(
        `[OCI] Lead ${lead.id} sem gclid/gbraid/wbraid — pulando upload OCI`,
      );
      return { uploadId: null, reason: 'no_click_id' };
    }

    // Janela de 90 dias — Google ignora gclids mais antigos
    if (lead.google_click_at) {
      const ageDays =
        (input.conversionAt.getTime() - lead.google_click_at.getTime()) /
        (1000 * 60 * 60 * 24);
      if (ageDays > 90) {
        this.logger.warn(
          `[OCI] Lead ${lead.id}: gclid antigo (${Math.round(ageDays)}d) — descartando`,
        );
        return { uploadId: null, reason: 'click_too_old' };
      }
    }

    // Dedupe: unique constraint em (conversion_action_id, gclid, conversion_at)
    const valueMicros =
      input.valueMicros !== undefined && input.valueMicros !== null
        ? input.valueMicros
        : ca.default_value_micros;

    const emailSha = lead.email
      ? this.sha256Lower(this.normalizeEmail(lead.email))
      : null;
    const phoneSha = lead.phone ? this.sha256Lower(this.normalizePhone(lead.phone)) : null;

    try {
      const upload = await this.prisma.trafficOCIUpload.create({
        data: {
          tenant_id: input.tenantId,
          account_id: account.id,
          conversion_action_id: ca.id,
          lead_id: lead.id,
          gclid: lead.google_gclid,
          gbraid: lead.google_gbraid,
          wbraid: lead.google_wbraid,
          email_sha256: emailSha,
          phone_sha256: phoneSha,
          conversion_at: input.conversionAt,
          value_micros: valueMicros,
          currency_code: account.currency_code ?? 'BRL',
          status: 'PENDING',
          trigger_event: input.triggerEvent,
          manual: !!input.manual,
        },
      });

      await this.ociQueue.add(
        OCI_JOB,
        { uploadId: upload.id },
        {
          jobId: `oci-${upload.id}`,
          removeOnComplete: 200,
          removeOnFail: 100,
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
        },
      );

      return { uploadId: upload.id };
    } catch (e: any) {
      if (
        e?.code === 'P2002' ||
        e?.message?.includes('Unique constraint failed')
      ) {
        // Dedupe — ja existe upload pra essa triade
        return { uploadId: null, reason: 'duplicate_skipped' };
      }
      throw e;
    }
  }

  /**
   * Processa upload — chamado pelo TrafficOCIProcessor.
   */
  async processUpload(uploadId: string): Promise<void> {
    const upload = await this.prisma.trafficOCIUpload.findUnique({
      where: { id: uploadId },
      include: { conversion_action: true, account: true },
    });
    if (!upload) {
      this.logger.warn(`[OCI] Upload ${uploadId} nao encontrado`);
      return;
    }
    if (upload.status !== 'PENDING') {
      this.logger.log(`[OCI] Upload ${uploadId} ja processado (${upload.status})`);
      return;
    }

    let customer: Customer;
    try {
      customer = await this.clientSvc.getCustomer(upload.tenant_id, upload.account_id);
    } catch (e: any) {
      await this.markFailed(uploadId, e?.message || 'Falha obtendo customer');
      return;
    }

    // Resource_name da conversion_action
    const conversionActionResourceName = `customers/${upload.account.customer_id}/conversionActions/${upload.conversion_action.google_conversion_id}`;

    const conversionMicros = upload.value_micros ?? null;
    const valueAsDecimal =
      conversionMicros !== null ? Number(conversionMicros) / 1_000_000 : null;

    const click: any = {
      conversion_action: conversionActionResourceName,
      conversion_date_time: this.formatGoogleDateTime(
        upload.conversion_at,
        upload.account.time_zone ?? 'America/Maceio',
      ),
    };
    if (upload.gclid) click.gclid = upload.gclid;
    if (upload.gbraid) click.gbraid = upload.gbraid;
    if (upload.wbraid) click.wbraid = upload.wbraid;
    if (valueAsDecimal !== null) {
      click.conversion_value = valueAsDecimal;
      click.currency_code = upload.currency_code ?? 'BRL';
    }
    if (upload.order_id) click.order_id = upload.order_id;

    // Enhanced Conversions data
    if (upload.email_sha256 || upload.phone_sha256) {
      click.user_identifiers = [
        ...(upload.email_sha256
          ? [{ hashed_email: upload.email_sha256 }]
          : []),
        ...(upload.phone_sha256
          ? [{ hashed_phone_number: upload.phone_sha256 }]
          : []),
      ];
    }

    try {
      const conversionUploads: any = (customer as any).conversionUploads;
      if (!conversionUploads?.uploadClickConversions) {
        throw new Error(
          'SDK google-ads-api: conversionUploads.uploadClickConversions nao disponivel',
        );
      }
      const result = await conversionUploads.uploadClickConversions({
        conversions: [click],
        partial_failure: true,
        validate_only: false,
      });

      // Detectar partial failure
      const partial = (result as any)?.partial_failure_error;
      if (partial) {
        await this.prisma.trafficOCIUpload.update({
          where: { id: uploadId },
          data: {
            status: 'FAILED',
            error_message: this.formatPartialFailure(partial).slice(0, 1500),
            api_response: result as any,
          },
        });
        this.logger.warn(
          `[OCI] Upload ${uploadId} PARTIAL FAILURE: ${this.formatPartialFailure(partial)}`,
        );
        return;
      }

      await this.prisma.trafficOCIUpload.update({
        where: { id: uploadId },
        data: {
          status: 'UPLOADED',
          uploaded_at: new Date(),
          api_response: result as any,
        },
      });
      this.logger.log(`[OCI] Upload ${uploadId} OK conv_at=${upload.conversion_at.toISOString()}`);
    } catch (e: any) {
      const formatted = this.clientSvc.formatError(e);
      await this.markFailed(uploadId, `[${formatted.kind}] ${formatted.message}`);
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private async markFailed(uploadId: string, message: string): Promise<void> {
    await this.prisma.trafficOCIUpload.update({
      where: { id: uploadId },
      data: { status: 'FAILED', error_message: message.slice(0, 1500) },
    });
  }

  private sha256Lower(s: string): string {
    return createHash('sha256').update(s.trim().toLowerCase()).digest('hex');
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  /**
   * Normaliza pra E.164 sem '+' (formato exigido pelo Google ECL):
   * remove tudo que nao for digito, prefixa 55 se necessario.
   */
  private normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.startsWith('55')) return digits;
    if (digits.length >= 10) return '55' + digits;
    return digits;
  }

  /**
   * Google espera "YYYY-MM-DD HH:mm:ss+TZ" com offset numerico.
   * Calcula offset baseado em time_zone IANA (ex: America/Maceio = -03:00).
   */
  private formatGoogleDateTime(date: Date, timeZone: string): string {
    // Formato "YYYY-MM-DD HH:mm:ss+HH:MM"
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(date);
    const find = (t: string) =>
      parts.find((p) => p.type === t)?.value ?? '00';
    const ymd = `${find('year')}-${find('month')}-${find('day')}`;
    let hms = `${find('hour')}:${find('minute')}:${find('second')}`;
    if (hms.startsWith('24')) hms = '00' + hms.slice(2); // edge-case meia-noite
    const offsetMinutes = this.getTimeZoneOffsetMinutes(date, timeZone);
    const sign = offsetMinutes <= 0 ? '-' : '+';
    const absMin = Math.abs(offsetMinutes);
    const offHours = String(Math.floor(absMin / 60)).padStart(2, '0');
    const offMins = String(absMin % 60).padStart(2, '0');
    return `${ymd} ${hms}${sign}${offHours}:${offMins}`;
  }

  private getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const parts = dtf.formatToParts(date);
    const find = (t: string) =>
      parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10);
    const asUTC = Date.UTC(
      find('year'),
      find('month') - 1,
      find('day'),
      find('hour'),
      find('minute'),
      find('second'),
    );
    return Math.round((asUTC - date.getTime()) / 60000);
  }

  private formatPartialFailure(err: any): string {
    if (typeof err === 'string') return err;
    if (err?.message) return err.message;
    return JSON.stringify(err).slice(0, 1500);
  }
}
