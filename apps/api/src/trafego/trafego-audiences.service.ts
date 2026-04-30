import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

/**
 * TrafegoAudiencesService — Customer Match (Sprint D).
 *
 * Manage user lists (audiences) sincronizadas com Google Ads. Expoe CRUD
 * local da TrafficUserList + dispara `rebuild` (recompute do CRM) e
 * `sync` (push pro Google) via fila trafego-customer-match.
 *
 * Por que via fila? Rebuild pode varrer milhares de leads + sync envolve
 * batch upload de PII hashed. Bloquear request HTTP é má ideia.
 */
@Injectable()
export class TrafegoAudiencesService {
  private readonly logger = new Logger(TrafegoAudiencesService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('trafego-customer-match') private readonly queue: Queue,
  ) {}

  // ────────────────────────────────────────────────────────────────────
  // Read
  // ────────────────────────────────────────────────────────────────────

  async list(tenantId: string) {
    const lists = await this.prisma.trafficUserList.findMany({
      where: { tenant_id: tenantId },
      orderBy: { created_at: 'desc' },
    });
    return lists;
  }

  async get(tenantId: string, userListId: string) {
    const ul = await this.prisma.trafficUserList.findUnique({
      where: { id: userListId },
    });
    if (!ul || ul.tenant_id !== tenantId) {
      throw new HttpException('Audience não encontrada.', HttpStatus.NOT_FOUND);
    }
    const memberCount = await this.prisma.trafficUserListMember.count({
      where: { user_list_id: userListId },
    });
    const pendingCount = await this.prisma.trafficUserListMember.count({
      where: { user_list_id: userListId, op_pending: { not: null } },
    });
    return {
      ...ul,
      member_count: memberCount,
      pending_count: pendingCount,
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // Create / Delete
  // ────────────────────────────────────────────────────────────────────

  async create(
    tenantId: string,
    dto: {
      kind: 'CLIENTES_ATIVOS' | 'LEADS_QUALIFICADOS' | 'LOOKALIKE_BASE' | 'CUSTOM';
      name?: string;
      description?: string;
      membership_lifespan_days?: number;
    },
  ) {
    const account = await this.prisma.trafficAccount.findFirst({
      where: { tenant_id: tenantId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!account) {
      throw new HttpException(
        'Conta de tráfego não conectada.',
        HttpStatus.CONFLICT,
      );
    }

    // 1 lista por (account, kind) — evita duplicatas
    const existing = await this.prisma.trafficUserList.findFirst({
      where: { account_id: account.id, kind: dto.kind },
    });
    if (existing) {
      throw new HttpException(
        `Já existe uma audiência do tipo ${dto.kind}.`,
        HttpStatus.CONFLICT,
      );
    }

    const defaultName = this.defaultNameForKind(dto.kind);
    const created = await this.prisma.trafficUserList.create({
      data: {
        tenant_id: tenantId,
        account_id: account.id,
        kind: dto.kind,
        name: dto.name ?? defaultName,
        description: dto.description ?? null,
        membership_lifespan_days: dto.membership_lifespan_days ?? 540,
        status: 'DRAFT',
      },
    });
    this.logger.log(
      `[audiences] criada list=${created.id} kind=${dto.kind} tenant=${tenantId}`,
    );
    return created;
  }

  async delete(tenantId: string, userListId: string) {
    const ul = await this.prisma.trafficUserList.findUnique({
      where: { id: userListId },
    });
    if (!ul || ul.tenant_id !== tenantId) {
      throw new HttpException('Audience não encontrada.', HttpStatus.NOT_FOUND);
    }
    if (ul.google_user_list_id) {
      throw new HttpException(
        'Audiência já está sincronizada no Google Ads. Remova lá primeiro pra evitar drift.',
        HttpStatus.CONFLICT,
      );
    }
    await this.prisma.trafficUserList.delete({
      where: { id: userListId },
    });
    return { ok: true };
  }

  // ────────────────────────────────────────────────────────────────────
  // Rebuild / Sync (assíncrono via fila)
  // ────────────────────────────────────────────────────────────────────

  async enqueueRebuild(tenantId: string, userListId: string) {
    const ul = await this.prisma.trafficUserList.findUnique({
      where: { id: userListId },
    });
    if (!ul || ul.tenant_id !== tenantId) {
      throw new HttpException('Audience não encontrada.', HttpStatus.NOT_FOUND);
    }
    if (ul.kind === 'CUSTOM') {
      throw new HttpException(
        'Listas CUSTOM não suportam rebuild automático — gerencie members manualmente.',
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.queue.add(
      'rebuild',
      { userListId },
      {
        jobId: `cm-rebuild-${userListId}-${Date.now()}`,
        removeOnComplete: 30,
        removeOnFail: 20,
      },
    );
    return {
      ok: true,
      message: 'Rebuild enfileirado. Recompute do CRM em ~30s.',
    };
  }

  async enqueueSync(tenantId: string, userListId: string) {
    const ul = await this.prisma.trafficUserList.findUnique({
      where: { id: userListId },
    });
    if (!ul || ul.tenant_id !== tenantId) {
      throw new HttpException('Audience não encontrada.', HttpStatus.NOT_FOUND);
    }
    await this.queue.add(
      'sync',
      { userListId },
      {
        jobId: `cm-sync-${userListId}-${Date.now()}`,
        removeOnComplete: 30,
        removeOnFail: 20,
      },
    );
    return {
      ok: true,
      message: 'Sync enfileirado. Status atualizado em até 1min.',
    };
  }

  private defaultNameForKind(
    kind: 'CLIENTES_ATIVOS' | 'LEADS_QUALIFICADOS' | 'LOOKALIKE_BASE' | 'CUSTOM',
  ): string {
    switch (kind) {
      case 'CLIENTES_ATIVOS':
        return 'CRM — Clientes Ativos';
      case 'LEADS_QUALIFICADOS':
        return 'CRM — Leads Qualificados';
      case 'LOOKALIKE_BASE':
        return 'CRM — Base p/ Similar';
      case 'CUSTOM':
        return 'CRM — Lista Customizada';
    }
  }
}
