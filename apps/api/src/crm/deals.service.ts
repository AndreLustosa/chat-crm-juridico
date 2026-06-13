import { Injectable, BadRequestException, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { resolveCsUser } from '../common/utils/resolve-cs-user';
import { closeOpenConversationsForLead } from '../common/utils/close-deals';

/**
 * CRUD de Deals (oportunidades) e suas movimentações.
 *
 * Cada movimentação de stage cria uma row em DealStageHistory pra auditoria;
 * snapshots de nomes permitem ler o histórico mesmo se a stage for renomeada
 * ou deletada depois.
 *
 * Quando o operador move um deal pra etapa com type=GANHO/PERDIDO, o service
 * atualiza Lead.stage (denormalização legada) + Lead.is_client (quando ganho)
 * pra telas antigas continuarem refletindo o estado.
 */
@Injectable()
export class DealsService {
  private readonly logger = new Logger(DealsService.name);

  constructor(
    private prisma: PrismaService,
    private chatGateway: ChatGateway,
  ) {}

  /** Lista deals do tenant com filtros opcionais. */
  async list(tenantId: string, params: {
    funnelId?: string;
    stageId?: string;
    ownerId?: string;
    leadId?: string;
    status?: 'aberto' | 'ganho' | 'perdido' | 'todos';
    search?: string;
    page?: number;
    limit?: number;
  } = {}) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(200, Math.max(1, params.limit ?? 100));

    const where: Prisma.DealWhereInput = {
      tenant_id: tenantId,
      ...(params.funnelId ? { funnel_id: params.funnelId } : {}),
      ...(params.stageId ? { stage_id: params.stageId } : {}),
      ...(params.ownerId ? { owner_user_id: params.ownerId } : {}),
      ...(params.leadId ? { lead_id: params.leadId } : {}),
      ...(params.status === 'ganho'   ? { won_at: { not: null } } : {}),
      ...(params.status === 'perdido' ? { lost_at: { not: null } } : {}),
      ...(params.status === 'aberto'  ? { won_at: null, lost_at: null } : {}),
      ...(params.search?.trim()
        ? { lead: { OR: [
            { name: { contains: params.search.trim(), mode: 'insensitive' } },
            { phone: { contains: params.search.trim() } },
          ] } }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.deal.findMany({
        where,
        orderBy: [{ stage_entered_at: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          lead: { select: { id: true, name: true, phone: true, profile_picture_url: true } },
          stage: true,
          funnel: { select: { id: true, key: true, name: true, color: true } },
          owner: { select: { id: true, name: true } },
        },
      }),
      this.prisma.deal.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  /** Detalhe de um deal com histórico completo. */
  async get(id: string, tenantId: string) {
    const deal = await this.prisma.deal.findUnique({
      where: { id },
      include: {
        lead: true,
        funnel: { include: { stages: { orderBy: { order: 'asc' } } } },
        stage: true,
        owner: { select: { id: true, name: true } },
        history: {
          orderBy: { created_at: 'desc' },
          include: { moved_by: { select: { id: true, name: true } } },
        },
      },
    });
    if (!deal) throw new NotFoundException('Oportunidade nao encontrada');
    if (deal.tenant_id !== tenantId) throw new ForbiddenException('Oportunidade de outro escritorio');
    return deal;
  }

  /** Cria um novo deal — entra no funil pela primeira etapa (menor order)
   *  por padrão, ou na etapa especificada via stageKey/stageId. */
  async create(tenantId: string, creatorUserId: string | undefined, input: {
    leadId: string;
    funnelId: string;
    stageId?: string;
    stageKey?: string;
    ownerUserId?: string;
    value?: number;
    expectedCloseAt?: string;
    source?: string;
    notes?: string;
  }) {
    // Valida lead + funil pertencem ao tenant
    const [lead, funnel] = await Promise.all([
      this.prisma.lead.findUnique({ where: { id: input.leadId } }),
      this.prisma.funnel.findUnique({
        where: { id: input.funnelId },
        include: { stages: { orderBy: { order: 'asc' } } },
      }),
    ]);
    if (!lead) throw new NotFoundException('Lead nao encontrado');
    if (lead.tenant_id && lead.tenant_id !== tenantId) {
      throw new ForbiddenException('Lead de outro escritorio');
    }
    if (!funnel || funnel.tenant_id !== tenantId) {
      throw new NotFoundException('Funil nao encontrado');
    }
    if (!funnel.active) throw new BadRequestException('Funil esta inativo');
    if (funnel.stages.length === 0) {
      throw new BadRequestException('Funil sem etapas cadastradas');
    }

    // Resolve stage inicial
    let stage = funnel.stages[0];
    if (input.stageId) {
      const found = funnel.stages.find((s) => s.id === input.stageId);
      if (!found) throw new BadRequestException('Etapa nao pertence ao funil');
      stage = found;
    } else if (input.stageKey) {
      const found = funnel.stages.find((s) => s.key === input.stageKey);
      if (!found) throw new BadRequestException('Etapa nao encontrada nesse funil');
      stage = found;
    }

    const deal = await this.prisma.deal.create({
      data: {
        tenant_id: tenantId,
        lead_id: input.leadId,
        funnel_id: input.funnelId,
        stage_id: stage.id,
        owner_user_id: input.ownerUserId ?? null,
        value: input.value != null ? new Prisma.Decimal(input.value) : null,
        expected_close_at: input.expectedCloseAt ? new Date(input.expectedCloseAt) : null,
        source: input.source?.trim() || null,
        notes: input.notes?.trim() || null,
        stage_entered_at: new Date(),
        won_at: stage.type === 'GANHO' ? new Date() : null,
        lost_at: stage.type === 'PERDIDO' ? new Date() : null,
      },
      include: { lead: true, funnel: true, stage: true, owner: true },
    });

    // Auditoria
    await this.prisma.dealStageHistory.create({
      data: {
        deal_id: deal.id,
        to_stage_id: stage.id,
        to_stage_name: stage.name,
        moved_by_id: creatorUserId ?? null,
        moved_via: creatorUserId ? 'manual' : 'automation',
        reason: 'criacao do deal',
      },
    });

    this.logger.log(`[DEAL] Criado ${deal.id} lead=${input.leadId} funnel=${funnel.key} stage=${stage.key}`);
    this.chatGateway.emitConversationsUpdate(tenantId);
    return deal;
  }

  /** Atualiza campos do deal (sem mexer em stage — usar move() pra isso). */
  async update(id: string, tenantId: string, input: {
    ownerUserId?: string | null;
    value?: number | null;
    expectedCloseAt?: string | null;
    source?: string | null;
    notes?: string | null;
  }) {
    await this.get(id, tenantId);
    const updated = await this.prisma.deal.update({
      where: { id },
      data: {
        ...(input.ownerUserId !== undefined ? { owner_user_id: input.ownerUserId } : {}),
        ...(input.value !== undefined
          ? { value: input.value != null ? new Prisma.Decimal(input.value) : null }
          : {}),
        ...(input.expectedCloseAt !== undefined
          ? { expected_close_at: input.expectedCloseAt ? new Date(input.expectedCloseAt) : null }
          : {}),
        ...(input.source !== undefined ? { source: input.source?.trim() || null } : {}),
        ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
      },
      include: { lead: true, funnel: true, stage: true, owner: true },
    });
    this.chatGateway.emitConversationsUpdate(tenantId);
    return updated;
  }

  /** Move o deal pra outra etapa. Cria entry em DealStageHistory.
   *  Quando a nova etapa é GANHO/PERDIDO, atualiza Lead.stage + Lead.is_client
   *  (denormalização pra telas antigas). */
  async move(id: string, tenantId: string, userId: string | undefined, input: {
    toStageId?: string;
    toStageKey?: string;
    reason?: string;
    via?: 'manual' | 'ai' | 'automation';
    lostReason?: string;
  }) {
    const deal = await this.get(id, tenantId);
    if (!input.toStageId && !input.toStageKey) {
      throw new BadRequestException('Informe toStageId ou toStageKey');
    }

    // Resolve a stage destino dentro do MESMO funil
    const target = await this.prisma.funnelStage.findFirst({
      where: {
        funnel_id: deal.funnel_id,
        ...(input.toStageId ? { id: input.toStageId } : { key: input.toStageKey }),
      },
    });
    if (!target) throw new NotFoundException('Etapa destino nao encontrada nesse funil');
    if (target.id === deal.stage_id) {
      return deal; // no-op
    }

    if (target.type === 'PERDIDO' && !input.lostReason?.trim() && !deal.lost_reason) {
      throw new BadRequestException('Motivo da perda obrigatorio ao mover pra PERDIDO');
    }

    const now = new Date();
    const updated = await this.prisma.deal.update({
      where: { id },
      data: {
        stage_id: target.id,
        stage_entered_at: now,
        won_at:  target.type === 'GANHO'   ? now : (deal.stage.type === 'GANHO'   ? null : deal.won_at),
        lost_at: target.type === 'PERDIDO' ? now : (deal.stage.type === 'PERDIDO' ? null : deal.lost_at),
        ...(target.type === 'PERDIDO' && input.lostReason ? { lost_reason: input.lostReason.trim() } : {}),
      },
      include: { lead: true, funnel: true, stage: true, owner: true },
    });

    // Auditoria
    await this.prisma.dealStageHistory.create({
      data: {
        deal_id: id,
        from_stage_id: deal.stage_id,
        from_stage_name: deal.stage.name,
        to_stage_id: target.id,
        to_stage_name: target.name,
        moved_by_id: userId ?? null,
        moved_via: input.via ?? 'manual',
        reason: input.reason?.trim() || null,
      },
    });

    // Denormalização legada: Lead.stage + Lead.is_client (telas antigas)
    if (target.type === 'GANHO') {
      // Operador (CS): dono do deal → atendente da conversa → quem moveu (ator).
      const csUser = (await resolveCsUser(this.prisma, deal.lead_id, [updated.owner_user_id])) ?? userId ?? null;
      await this.prisma.lead.update({
        where: { id: deal.lead_id },
        data: {
          stage: 'FINALIZADO',
          is_client: true,
          became_client_at: deal.lead.became_client_at ?? now,
          ...(csUser ? { cs_user_id: csUser } : {}),
        },
      }).catch(() => null);
    } else if (target.type === 'PERDIDO') {
      // GUARDA (2026-06): não rebaixar CLIENTE. Perder um DEAL (ex.: cliente
      // recusou um NOVO caso) NÃO torna a pessoa um lead perdido — ela continua
      // cliente (is_client=true, stage=FINALIZADO). A perda fica registrada no
      // próprio Deal (lost_at/lost_reason), sem corromper o status do Lead.
      if (!deal.lead?.is_client) {
        await this.prisma.lead.update({
          where: { id: deal.lead_id },
          data: {
            stage: 'PERDIDO',
            loss_reason: input.lostReason?.trim() ?? deal.lost_reason ?? null,
          },
        }).catch(() => null);
        // Lead perdido → fecha conversas abertas + IA off (idem leads.updateStatus).
        await closeOpenConversationsForLead(this.prisma, this.chatGateway, deal.lead_id, tenantId);
      }
    } else {
      // Mapeia keys do funil "captacao" pra Lead.stage legado quando aplicável.
      // GUARDA (2026-06): idem PERDIDO — NUNCA rebaixar o stage de quem já é
      // CLIENTE. Lead.stage é um campo só, compartilhado entre "posição no funil
      // de captação" e "status de cliente" (FINALIZADO). Sem esta guarda, mover o
      // Deal de um cliente que voltou a conversar pra "Reunião agendada"/"Docs"
      // gravava Lead.stage=REUNIAO_AGENDADA mantendo is_client=true — criando
      // clientes "presos" em etapa de lead (os 3 anômalos de jun/2026). O avanço
      // do funil fica só no Deal (stage_id); o Lead segue FINALIZADO.
      const legacyMap: Record<string, string> = {
        qualificando: 'QUALIFICANDO',
        reuniao_agendada: 'REUNIAO_AGENDADA',
        aguardando_docs: 'AGUARDANDO_DOCS',
        aguardando_proc: 'AGUARDANDO_PROC',
      };
      const legacyStage = legacyMap[target.key];
      if (legacyStage && !deal.lead?.is_client) {
        await this.prisma.lead.update({
          where: { id: deal.lead_id },
          data: { stage: legacyStage, stage_entered_at: now },
        }).catch(() => null);
      }
    }

    this.logger.log(`[DEAL] Move ${id} ${deal.stage.key} → ${target.key} (via=${input.via ?? 'manual'})`);
    this.chatGateway.emitConversationsUpdate(tenantId);
    return updated;
  }

  /** Deleta o deal (hard — cascade history). */
  async remove(id: string, tenantId: string) {
    await this.get(id, tenantId);
    await this.prisma.deal.delete({ where: { id } });
    this.chatGateway.emitConversationsUpdate(tenantId);
    return { ok: true };
  }

  /** KPIs agregados pro dashboard (opcionalmente scoped a um funil). */
  async stats(tenantId: string, funnelId?: string) {
    const where: Prisma.DealWhereInput = {
      tenant_id: tenantId,
      ...(funnelId ? { funnel_id: funnelId } : {}),
    };
    const [total, abertos, ganhos, perdidos, ganhoSum, ganhoMes] = await Promise.all([
      this.prisma.deal.count({ where }),
      this.prisma.deal.count({ where: { ...where, won_at: null, lost_at: null } }),
      this.prisma.deal.count({ where: { ...where, won_at: { not: null } } }),
      this.prisma.deal.count({ where: { ...where, lost_at: { not: null } } }),
      this.prisma.deal.aggregate({ where: { ...where, won_at: { not: null } }, _sum: { value: true } }),
      this.prisma.deal.count({
        where: {
          ...where,
          won_at: { gte: new Date(new Date().setDate(1)) }, // primeiro dia do mês corrente
        },
      }),
    ]);
    const conversion = total > 0 ? Math.round((ganhos / total) * 1000) / 10 : 0;
    return {
      total,
      abertos,
      ganhos,
      perdidos,
      ganho_valor_total: ganhoSum._sum.value?.toString() ?? '0',
      ganhos_mes: ganhoMes,
      conversion_pct: conversion,
    };
  }

  /**
   * Distribuicao por etapa (count + soma de valor) e ranking de motivos de
   * perda — agregado direto no banco com groupBy. O painel de analytics do
   * front consome isto em vez de baixar centenas de deals e contar no cliente
   * (mais rapido e sem o teto de 500 que truncava funis grandes).
   */
  async statsByStage(tenantId: string, funnelId?: string) {
    const where: Prisma.DealWhereInput = {
      tenant_id: tenantId,
      ...(funnelId ? { funnel_id: funnelId } : {}),
    };

    const [porEtapaRaw, motivosRaw] = await Promise.all([
      this.prisma.deal.groupBy({
        by: ['stage_id'],
        where,
        _count: { _all: true },
        _sum: { value: true },
      }),
      this.prisma.deal.groupBy({
        by: ['lost_reason'],
        where: { ...where, lost_at: { not: null } },
        _count: { _all: true },
      }),
    ]);

    const porEtapa = porEtapaRaw.map((g) => ({
      stage_id: g.stage_id,
      count: g._count._all,
      valor: g._sum.value?.toString() ?? '0',
    }));

    const motivosPerda = motivosRaw
      .map((g) => ({ reason: g.lost_reason?.trim() || 'Não informado', count: g._count._all }))
      .sort((a, b) => b.count - a.count);

    return { porEtapa, motivosPerda };
  }
}
