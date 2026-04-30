import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleAdsClientService } from './google-ads-client.service';

/**
 * Customer Match — sincroniza user lists (audiences) com o Google Ads.
 *
 * Pipeline:
 *   1. rebuildFromCRM(userListId)
 *      - Calcula o membership desejado a partir do CRM (ex: clientes
 *        assinados pra CLIENTES_ATIVOS, leads em estágio avançado pra
 *        LEADS_QUALIFICADOS).
 *      - Compara com TrafficUserListMember atual.
 *      - Marca diff: op_pending='ADD' pra entrantes, 'REMOVE' pra saintes.
 *
 *   2. syncToGoogle(userListId)
 *      - Garante UserList existe no Google Ads (cria se DRAFT).
 *      - Lê members pendentes em lotes.
 *      - Faz upload via OfflineUserDataJob (CUSTOMER_MATCH_USER_LIST).
 *      - Marca op_pending=null + synced_at quando bem-sucedido.
 *
 * Hash sempre SHA-256 lowercase do valor normalizado:
 *   - email: lowercase + trim
 *   - phone: E.164 (com +55 BR) + dígitos somente
 *   - first_name/last_name: lowercase + trim + remove acentos
 *
 * PII NUNCA sai em claro pro Google — só hashes.
 */
@Injectable()
export class TrafficCustomerMatchService {
  private readonly logger = new Logger(TrafficCustomerMatchService.name);

  constructor(
    private prisma: PrismaService,
    private adsClient: GoogleAdsClientService,
  ) {}

  // ──────────────────────────────────────────────────────────────────────
  // Rebuild — popula op_pending baseado no CRM
  // ──────────────────────────────────────────────────────────────────────

  async rebuildFromCRM(userListId: string): Promise<RebuildReport> {
    const userList = await this.prisma.trafficUserList.findUnique({
      where: { id: userListId },
    });
    if (!userList) {
      throw new HttpException('User list não encontrada.', HttpStatus.NOT_FOUND);
    }

    // Determina critério de membership baseado em kind
    const desired = await this.computeDesiredMembers(
      userList.tenant_id,
      userList.account_id,
      userList.kind,
    );

    // Membros atuais
    const current = await this.prisma.trafficUserListMember.findMany({
      where: { user_list_id: userListId },
      select: {
        id: true,
        email_sha256: true,
        phone_sha256: true,
        op_pending: true,
        lead_id: true,
      },
    });
    const currentByKey = new Map<string, (typeof current)[number]>();
    for (const m of current) {
      currentByKey.set(memberKey(m.email_sha256, m.phone_sha256), m);
    }

    let added = 0;
    let removed = 0;
    let kept = 0;

    // Pra cada member desejado: cria se não existe; reseta op_pending se
    // existia mas estava marcado como REMOVE (cliente voltou).
    const desiredKeys = new Set<string>();
    for (const d of desired) {
      const key = memberKey(d.email_sha256, d.phone_sha256);
      desiredKeys.add(key);
      const existing = currentByKey.get(key);
      if (!existing) {
        await this.prisma.trafficUserListMember.create({
          data: {
            tenant_id: userList.tenant_id,
            account_id: userList.account_id,
            user_list_id: userListId,
            lead_id: d.lead_id,
            email_sha256: d.email_sha256,
            phone_sha256: d.phone_sha256,
            first_name_sha256: d.first_name_sha256,
            last_name_sha256: d.last_name_sha256,
            op_pending: 'ADD',
          },
        });
        added++;
      } else if (existing.op_pending === 'REMOVE') {
        // Reverter remoção pendente — volta a ser membro
        await this.prisma.trafficUserListMember.update({
          where: { id: existing.id },
          data: { op_pending: 'ADD', error_message: null },
        });
        added++;
      } else {
        kept++;
      }
    }

    // Members atuais que NÃO estão mais em desired → marca REMOVE
    for (const c of current) {
      const key = memberKey(c.email_sha256, c.phone_sha256);
      if (!desiredKeys.has(key) && c.op_pending !== 'REMOVE') {
        await this.prisma.trafficUserListMember.update({
          where: { id: c.id },
          data: { op_pending: 'REMOVE' },
        });
        removed++;
      }
    }

    await this.prisma.trafficUserList.update({
      where: { id: userListId },
      data: { local_size: desired.length },
    });

    this.logger.log(
      `[customer-match] rebuild list=${userListId} kind=${userList.kind} ` +
        `desired=${desired.length} added=${added} removed=${removed} kept=${kept}`,
    );

    return {
      userListId,
      desired: desired.length,
      added,
      removed,
      kept,
    };
  }

  /**
   * Calcula members desejados pra uma user list dado o kind. Cada lead/
   * cliente vira 1+ entrada (email + phone podem gerar registros separados
   * caso queiramos). Aqui geramos 1 member por lead com email+phone juntos.
   */
  private async computeDesiredMembers(
    tenantId: string,
    accountId: string,
    kind: string,
  ): Promise<DesiredMember[]> {
    const where = this.computeLeadFilter(tenantId, kind);
    const leads = await this.prisma.lead.findMany({
      where,
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
      },
    });

    const out: DesiredMember[] = [];
    for (const l of leads) {
      const emailHash = l.email ? hashEmail(l.email) : null;
      const phoneHash = l.phone ? hashPhone(l.phone) : null;
      // Sem email NEM phone → não dá pra Customer Match
      if (!emailHash && !phoneHash) continue;
      const { firstHash, lastHash } = hashName(l.name ?? '');
      out.push({
        lead_id: l.id,
        email_sha256: emailHash,
        phone_sha256: phoneHash,
        first_name_sha256: firstHash,
        last_name_sha256: lastHash,
      });
    }

    return out;
  }

  /** Filtro Prisma pra Lead baseado no tipo de user list. */
  private computeLeadFilter(tenantId: string, kind: string): any {
    switch (kind) {
      case 'CLIENTES_ATIVOS':
        return { tenant_id: tenantId, is_client: true };
      case 'LEADS_QUALIFICADOS':
        return {
          tenant_id: tenantId,
          is_client: false,
          stage: { in: ['QUALIFICADO', 'AGENDADO', 'NEGOCIANDO'] },
        };
      case 'LOOKALIKE_BASE':
        // Mesma fonte de CLIENTES_ATIVOS — Google gera lookalikes a partir
        return { tenant_id: tenantId, is_client: true };
      case 'CUSTOM':
      default:
        // Lista CUSTOM não tem critério automático — admin gerencia members
        return { tenant_id: tenantId, id: { in: [] as string[] } };
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Sync to Google Ads — placeholder pra implementação completa via SDK
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Sincroniza members pendentes (op_pending != null) com o Google Ads.
   *
   * Implementação inicial: registra a intenção em TrafficMutateLog com
   * status 'PENDING' e marca members como synced_at=now() ASSIM que a
   * call ao OfflineUserDataJob completar. Pra primeira leva, fazemos só
   * a parte local — a integração com OfflineUserDataJobService do SDK
   * fica como follow-up (D2) pra evitar batch upload de PII em produção
   * sem auditoria de OAB-LGPD aprovada pelo escritório primeiro.
   *
   * NOTA pro próximo sprint:
   *   - Usar `customer.userDataService.uploadUserData()` ou
   *     `customer.offlineUserDataJobs.create()` + add operations.
   *   - Lotes de até 10k operations por call.
   *   - validate_only=true em primeiro deploy pra confirmar formato.
   */
  async syncToGoogle(userListId: string): Promise<SyncReport> {
    const userList = await this.prisma.trafficUserList.findUnique({
      where: { id: userListId },
    });
    if (!userList) {
      throw new HttpException('User list não encontrada.', HttpStatus.NOT_FOUND);
    }

    const pending = await this.prisma.trafficUserListMember.findMany({
      where: { user_list_id: userListId, op_pending: { in: ['ADD', 'REMOVE'] } },
      select: { id: true, op_pending: true },
    });

    if (pending.length === 0) {
      this.logger.log(
        `[customer-match] sync list=${userListId} sem members pendentes`,
      );
      return {
        userListId,
        pending: 0,
        synced: 0,
        failed: 0,
        skipped_google_call: true,
        note: 'Sem mudanças pendentes.',
      };
    }

    // Marca user_list como SYNCING pra UI mostrar progresso
    await this.prisma.trafficUserList.update({
      where: { id: userListId },
      data: { status: 'SYNCING', error_message: null },
    });

    // ── PLACEHOLDER ── A implementação completa via SDK
    // (UserListService + OfflineUserDataJobService) entra em D2.
    // Por ora, marcamos o status como pendente de implementação pra
    // não enviar PII real pro Google sem revisão completa.
    this.logger.warn(
      `[customer-match] sync list=${userListId} pending=${pending.length} — ` +
        `Google API call NÃO implementada ainda (D2). Members ficam em op_pending.`,
    );

    await this.prisma.trafficUserList.update({
      where: { id: userListId },
      data: {
        status: 'DRAFT',
        error_message:
          'Sync com Google Ads ainda não implementada. Aguardando aprovação OAB+LGPD.',
      },
    });

    return {
      userListId,
      pending: pending.length,
      synced: 0,
      failed: 0,
      skipped_google_call: true,
      note: 'Implementação SDK pendente (D2). Members preparados localmente.',
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Hash helpers — sempre SHA-256 lowercase do valor normalizado
// ──────────────────────────────────────────────────────────────────────────

export function hashEmail(email: string): string {
  return sha256(email.trim().toLowerCase());
}

export function hashPhone(phone: string): string {
  // Espera-se que phone esteja em E.164 (+55XXYYYYYYYYY). Se vier
  // sem +, normaliza assumindo BR.
  let normalized = phone.replace(/[^\d+]/g, '');
  if (!normalized.startsWith('+')) {
    if (normalized.length === 10 || normalized.length === 11) {
      normalized = `+55${normalized}`;
    } else if (
      (normalized.length === 12 || normalized.length === 13) &&
      normalized.startsWith('55')
    ) {
      normalized = `+${normalized}`;
    } else {
      normalized = `+${normalized}`;
    }
  }
  return sha256(normalized);
}

export function hashName(fullName: string): {
  firstHash: string | null;
  lastHash: string | null;
} {
  const cleaned = removeDiacritics(fullName)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
  if (!cleaned) return { firstHash: null, lastHash: null };
  const parts = cleaned.split(' ');
  const first = parts[0];
  const last = parts.length > 1 ? parts[parts.length - 1] : null;
  return {
    firstHash: first ? sha256(first) : null,
    lastHash: last ? sha256(last) : null,
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function removeDiacritics(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function memberKey(emailH: string | null, phoneH: string | null): string {
  return `${emailH ?? ''}|${phoneH ?? ''}`;
}

// ──────────────────────────────────────────────────────────────────────────
// Tipos
// ──────────────────────────────────────────────────────────────────────────

type DesiredMember = {
  lead_id: string;
  email_sha256: string | null;
  phone_sha256: string | null;
  first_name_sha256: string | null;
  last_name_sha256: string | null;
};

export type RebuildReport = {
  userListId: string;
  desired: number;
  added: number;
  removed: number;
  kept: number;
};

export type SyncReport = {
  userListId: string;
  pending: number;
  synced: number;
  failed: number;
  skipped_google_call: boolean;
  note?: string;
};
