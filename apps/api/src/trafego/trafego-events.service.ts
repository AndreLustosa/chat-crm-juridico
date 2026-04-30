import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Servico de eventos do CRM relevantes pro modulo de Trafego.
 *
 * Quando services do CRM (LeadsService, LegalCasesService, PaymentGatewayService)
 * registram eventos relevantes ("client signed", "payment received"), eles
 * chamam aqui. Aqui:
 *  1. Resolvemos qual ConversionAction esta mapeada ao evento.
 *  2. Verificamos se o Lead tem gclid/gbraid/wbraid.
 *  3. Criamos TrafficOCIUpload status=PENDING.
 *  4. Enfileiramos job no `trafego-oci` (worker processa).
 *
 * Idempotencia: unique(conversion_action, gclid, conversion_at) evita upload
 * duplicado.
 *
 * Erros silenciosos: se nao houver gclid ou se ConversionAction nao mapeada,
 * apenas loga e retorna sem erro. Caller (CRM) nao deve quebrar por causa
 * de OCI.
 */
@Injectable()
export class TrafegoEventsService {
  private readonly logger = new Logger(TrafegoEventsService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('trafego-oci') private ociQueue: Queue,
  ) {}

  /**
   * Lead criado no CRM. Dispara OCI se ConversionAction mapeada a 'lead.created'.
   */
  async onLeadCreated(leadId: string, tenantId: string): Promise<void> {
    await this.fireEvent(leadId, tenantId, 'lead.created', new Date(), null);
  }

  /**
   * Lead qualificado (passou pra etapa Q+). Conversao de mid-funnel.
   */
  async onLeadQualified(leadId: string, tenantId: string): Promise<void> {
    await this.fireEvent(leadId, tenantId, 'lead.qualified', new Date(), null);
  }

  /**
   * Cliente assinou contrato. Conversao final (highest value).
   * Se passar `valueBrl`, sobrescreve default_value da ConversionAction.
   */
  async onClientSigned(
    leadId: string,
    tenantId: string,
    opts?: { valueBrl?: number; signedAt?: Date },
  ): Promise<void> {
    await this.fireEvent(
      leadId,
      tenantId,
      'client.signed',
      opts?.signedAt ?? new Date(),
      opts?.valueBrl ?? null,
    );
  }

  /**
   * Pagamento recebido. Pode disparar varias vezes (parcelas) — cada upload
   * usa um order_id distinto pra evitar dedupe.
   */
  async onPaymentReceived(
    leadId: string,
    tenantId: string,
    opts: { valueBrl: number; paidAt?: Date; orderId?: string },
  ): Promise<void> {
    await this.fireEvent(
      leadId,
      tenantId,
      'payment.received',
      opts.paidAt ?? new Date(),
      opts.valueBrl,
      opts.orderId,
    );
  }

  /**
   * Evento custom — Future hook (admin pode mapear ConversionActions a
   * crm_event_kind=custom:* via UI).
   */
  async onCustomEvent(
    leadId: string,
    tenantId: string,
    eventKind: string,
    opts?: { valueBrl?: number; eventAt?: Date; orderId?: string },
  ): Promise<void> {
    await this.fireEvent(
      leadId,
      tenantId,
      eventKind,
      opts?.eventAt ?? new Date(),
      opts?.valueBrl ?? null,
      opts?.orderId,
    );
  }

  /**
   * Pipeline interno: resolve ConversionAction → cria registro PENDING → enfileira upload.
   * Failures sao logadas mas nunca propagadas (CRM nao deve quebrar por OCI).
   */
  private async fireEvent(
    leadId: string,
    tenantId: string,
    eventKind: string,
    conversionAt: Date,
    valueBrl: number | null,
    orderId?: string,
  ): Promise<void> {
    try {
      const account = await this.prisma.trafficAccount.findUnique({
        where: { tenant_id: tenantId },
      });
      if (!account) return; // sem conta conectada — no-op silencioso

      const ca = await this.prisma.trafficConversionAction.findFirst({
        where: {
          tenant_id: tenantId,
          account_id: account.id,
          crm_event_kind: eventKind,
          status: 'ENABLED',
        },
      });
      if (!ca) {
        // Nenhuma ConversionAction mapeada — admin precisa configurar
        this.logger.debug(
          `[trafego-events] sem ConversionAction mapeada a ${eventKind} (tenant=${tenantId})`,
        );
        return;
      }

      const lead = await this.prisma.lead.findFirst({
        where: { id: leadId, tenant_id: tenantId },
      });
      if (!lead) return;
      if (!lead.google_gclid && !lead.google_gbraid && !lead.google_wbraid) {
        // Sem click ID, OCI nao funciona (ECL fica como follow-up)
        return;
      }

      // Janela de 90 dias: gclid antigos sao ignorados pelo Google
      if (lead.google_click_at) {
        const ageDays =
          (conversionAt.getTime() - lead.google_click_at.getTime()) /
          (1000 * 60 * 60 * 24);
        if (ageDays > 90) {
          this.logger.warn(
            `[trafego-events] lead=${leadId} click=${lead.google_click_at.toISOString()} > 90d — descartando`,
          );
          return;
        }
      }

      const valueMicros =
        valueBrl !== null && valueBrl !== undefined
          ? BigInt(Math.round(valueBrl * 1_000_000))
          : ca.default_value_micros;

      const emailSha = lead.email
        ? this.sha256Lower(lead.email.trim().toLowerCase())
        : null;
      const phoneSha = lead.phone
        ? this.sha256Lower(this.normalizePhone(lead.phone))
        : null;

      try {
        const upload = await this.prisma.trafficOCIUpload.create({
          data: {
            tenant_id: tenantId,
            account_id: account.id,
            conversion_action_id: ca.id,
            lead_id: lead.id,
            gclid: lead.google_gclid,
            gbraid: lead.google_gbraid,
            wbraid: lead.google_wbraid,
            email_sha256: emailSha,
            phone_sha256: phoneSha,
            order_id: orderId ?? null,
            conversion_at: conversionAt,
            value_micros: valueMicros,
            currency_code: account.currency_code ?? 'BRL',
            status: 'PENDING',
            trigger_event: eventKind,
            manual: false,
          },
        });

        await this.ociQueue.add(
          'trafego-oci-upload',
          { uploadId: upload.id },
          {
            jobId: `oci-${upload.id}`,
            removeOnComplete: 200,
            removeOnFail: 100,
            attempts: 3,
            backoff: { type: 'exponential', delay: 30_000 },
          },
        );

        this.logger.log(
          `[trafego-events] enqueued OCI upload=${upload.id} lead=${leadId} event=${eventKind}`,
        );
      } catch (e: any) {
        if (
          e?.code === 'P2002' ||
          e?.message?.includes('Unique constraint failed')
        ) {
          // Dedupe — upload identico ja existe (caller chamou duas vezes).
          // Silencioso: comportamento esperado.
          this.logger.debug(
            `[trafego-events] dedupe lead=${leadId} event=${eventKind}`,
          );
          return;
        }
        throw e;
      }
    } catch (e: any) {
      // Nunca propagar pra caller — CRM nao deve quebrar por OCI
      this.logger.error(
        `[trafego-events] erro fireEvent lead=${leadId} event=${eventKind}: ${e?.message ?? e}`,
      );
    }
  }

  private sha256Lower(s: string): string {
    return createHash('sha256').update(s).digest('hex');
  }

  private normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.startsWith('55')) return digits;
    if (digits.length >= 10) return '55' + digits;
    return digits;
  }
}
