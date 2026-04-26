import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Pagamentos do cliente — unifica:
 *   - LeadHonorarioPayment (fase de negociacao, antes do contrato)
 *   - HonorarioPayment (caso ativo, depois do contrato)
 *
 * Cada um pode ter PaymentGatewayCharge associado com PIX/boleto.
 *
 * Status normalizado: PENDENTE | PAGO | ATRASADO | CANCELADO
 */
@Injectable()
export class PortalPaymentsService {
  private readonly logger = new Logger(PortalPaymentsService.name);

  constructor(private prisma: PrismaService) {}

  async list(leadId: string) {
    // 1. LeadHonorarios (negociacao) com seus pagamentos
    const leadHonorarios = await this.prisma.leadHonorario.findMany({
      where: {
        lead_id: leadId,
        status: { in: ['ACEITO', 'CONVERTIDO', 'NEGOCIANDO'] },
      },
      include: {
        payments: {
          include: {
            gateway_charge: {
              select: {
                pix_qr_code: true,
                pix_copy_paste: true,
                pix_expiration_date: true,
                boleto_url: true,
                boleto_barcode: true,
                invoice_url: true,
                billing_type: true,
                status: true,
              },
            },
          },
          orderBy: { due_date: 'asc' },
        },
      },
    });

    // 2. CaseHonorarios (caso ativo) — busca via legal_cases do lead
    const caseHonorarios = await this.prisma.caseHonorario.findMany({
      where: {
        legal_case: {
          lead_id: leadId,
          archived: false,
          renounced: false,
        },
        status: 'ATIVO',
      },
      include: {
        legal_case: {
          select: {
            id: true,
            case_number: true,
            action_type: true,
            legal_area: true,
          },
        },
        payments: {
          include: {
            gateway_charge: {
              select: {
                pix_qr_code: true,
                pix_copy_paste: true,
                pix_expiration_date: true,
                boleto_url: true,
                boleto_barcode: true,
                invoice_url: true,
                billing_type: true,
                status: true,
              },
            },
          },
          orderBy: { due_date: 'asc' },
        },
      },
    });

    // Achata em uma lista unica de "PaymentItem"
    type PaymentItem = {
      id: string;
      source: 'lead' | 'case';
      amount: string;
      due_date: string | null;
      paid_at: string | null;
      payment_method: string | null;
      status: string;
      // Contexto: ou tipo de honorario (lead_honorario.type) ou processo (case)
      context: string;
      case?: { id: string; case_number: string | null; title: string };
      // Gateway PIX/boleto
      gateway: {
        billing_type: string | null;
        pix_qr_code: string | null;
        pix_copy_paste: string | null;
        pix_expiration_date: string | null;
        boleto_url: string | null;
        boleto_barcode: string | null;
        invoice_url: string | null;
      } | null;
    };

    const items: PaymentItem[] = [];

    for (const lh of leadHonorarios) {
      for (const p of lh.payments) {
        items.push({
          id: p.id,
          source: 'lead',
          amount: p.amount.toString(),
          due_date: p.due_date?.toISOString() || null,
          paid_at: p.paid_at?.toISOString() || null,
          payment_method: p.payment_method,
          status: this.normalizeStatus(p.status, p.due_date, p.paid_at),
          context: this.honorarioTypeLabel(lh.type),
          gateway: p.gateway_charge ? {
            billing_type: p.gateway_charge.billing_type,
            pix_qr_code: p.gateway_charge.pix_qr_code,
            pix_copy_paste: p.gateway_charge.pix_copy_paste,
            pix_expiration_date: p.gateway_charge.pix_expiration_date?.toISOString() || null,
            boleto_url: p.gateway_charge.boleto_url,
            boleto_barcode: p.gateway_charge.boleto_barcode,
            invoice_url: p.gateway_charge.invoice_url,
          } : null,
        });
      }
    }

    for (const ch of caseHonorarios) {
      for (const p of ch.payments) {
        items.push({
          id: p.id,
          source: 'case',
          amount: p.amount.toString(),
          due_date: p.due_date?.toISOString() || null,
          paid_at: p.paid_at?.toISOString() || null,
          payment_method: p.payment_method,
          status: this.normalizeStatus(p.status, p.due_date, p.paid_at),
          context: this.honorarioTypeLabel(ch.type),
          case: {
            id: ch.legal_case.id,
            case_number: ch.legal_case.case_number,
            title: ch.legal_case.action_type || ch.legal_case.legal_area || 'Processo',
          },
          gateway: p.gateway_charge ? {
            billing_type: p.gateway_charge.billing_type,
            pix_qr_code: p.gateway_charge.pix_qr_code,
            pix_copy_paste: p.gateway_charge.pix_copy_paste,
            pix_expiration_date: p.gateway_charge.pix_expiration_date?.toISOString() || null,
            boleto_url: p.gateway_charge.boleto_url,
            boleto_barcode: p.gateway_charge.boleto_barcode,
            invoice_url: p.gateway_charge.invoice_url,
          } : null,
        });
      }
    }

    // Ordena: pendentes/atrasados primeiro (por due_date asc),
    // depois pagos (por paid_at desc)
    items.sort((a, b) => {
      const aOpen = a.status === 'PENDENTE' || a.status === 'ATRASADO';
      const bOpen = b.status === 'PENDENTE' || b.status === 'ATRASADO';
      if (aOpen !== bOpen) return aOpen ? -1 : 1;
      if (aOpen) {
        // Pendentes: due_date asc (mais urgente primeiro)
        const ad = a.due_date || '';
        const bd = b.due_date || '';
        return ad.localeCompare(bd);
      }
      // Pagos: paid_at desc
      const ap = a.paid_at || '';
      const bp = b.paid_at || '';
      return bp.localeCompare(ap);
    });

    // Sumario pra UI
    const summary = {
      total_pending: items
        .filter(i => i.status === 'PENDENTE' || i.status === 'ATRASADO')
        .reduce((sum, i) => sum + parseFloat(i.amount), 0)
        .toFixed(2),
      count_pending: items.filter(i => i.status === 'PENDENTE').length,
      count_overdue: items.filter(i => i.status === 'ATRASADO').length,
      count_paid: items.filter(i => i.status === 'PAGO').length,
    };

    return { items, summary };
  }

  private normalizeStatus(rawStatus: string, dueDate: Date | null, paidAt: Date | null): string {
    if (paidAt || rawStatus === 'PAGO') return 'PAGO';
    if (rawStatus === 'CANCELADO') return 'CANCELADO';
    if (dueDate && dueDate < new Date()) return 'ATRASADO';
    return 'PENDENTE';
  }

  private honorarioTypeLabel(type: string): string {
    const map: Record<string, string> = {
      CONTRATUAL: 'Honorário contratual',
      SUCUMBENCIA: 'Honorário sucumbencial',
      ENTRADA: 'Entrada',
      ACORDO: 'Honorário (acordo)',
    };
    return map[type] || type;
  }
}
