import { Injectable, BadRequestException, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { slugify, uniqueSlug } from './slug';
import type { StageType } from '@prisma/client';

/**
 * Etapas padrao criadas automaticamente em todo funil novo. O escritorio
 * pode renomear/excluir/reorganizar depois, mas o ponto de partida cobre
 * o ciclo de vida basico de um lead no juridico:
 *   1) Qualificando — lead acabou de cair, sendo triado pelo atendente/IA.
 *   2) Finalizado   — virou cliente, segue pra triagem/peticoes (GANHO).
 *   3) Perdido      — desqualificado, contato arquivado (PERDIDO).
 * As `keys` sao slug fixos pra IA conseguir referenciar com seguranca em
 * prompts e tools (funil pode ate trocar de nome, key continua).
 */
const DEFAULT_FUNNEL_STAGES: Array<{
  key: string;
  name: string;
  type: StageType;
  color: string;
  order: number;
  ai_hint: string;
}> = [
  {
    key: 'qualificando',
    name: 'Qualificando',
    type: 'ATIVO',
    color: '#E6BE6A', // aurum
    order: 1,
    ai_hint:
      'Lead acabou de chegar. Apresente-se, descubra do que ele precisa (area juridica, urgencia), colete dados basicos (nome completo, contato) e avalie se o caso faz sentido pro escritorio. Quando estiver claro que o escritorio pode ajudar, avance para "Finalizado". Quando ficar claro que nao faz sentido (foge da area, sem condicoes, sem interesse real), mova para "Perdido".',
  },
  {
    key: 'finalizado',
    name: 'Finalizado',
    type: 'GANHO',
    color: '#7EB58A', // jade
    order: 2,
    ai_hint:
      'Lead qualificado — o caso faz sentido pro escritorio. Encaminhe para triagem/peticoes, agradeca pela confianca e mantenha o relacionamento ativo enquanto a equipe juridica assume.',
  },
  {
    key: 'perdido',
    name: 'Perdido',
    type: 'PERDIDO',
    color: '#C44444', // crimson
    order: 3,
    ai_hint:
      'Lead desqualificado — nao faz sentido pro escritorio ou nao demonstrou interesse real. Agradeca o contato com cordialidade, deixe a porta aberta pra retornar no futuro e arquive o contato.',
  },
];

/**
 * CRUD de funis (pipelines) e suas etapas. Tudo scoped por tenant.
 *
 * Regras:
 *  - `key` (funnel + stage) imutável depois de criada — admin não pode
 *    renomear a key, só o `name` de exibição. Garante que prompts/tools da
 *    IA continuem funcionando.
 *  - Soft delete de Funnel via `active=false` (preserva histórico).
 *  - Hard delete de Stage só permitido se não houver Deal nela.
 *  - Todo funil novo nasce com 3 etapas padrão (DEFAULT_FUNNEL_STAGES).
 */
@Injectable()
export class FunnelsService {
  private readonly logger = new Logger(FunnelsService.name);

  constructor(
    private prisma: PrismaService,
    private chatGateway: ChatGateway,
  ) {}

  // ─── Funis ────────────────────────────────────────────────────────────

  /** Lista funis do tenant. `includeInactive=false` por padrão. */
  async list(tenantId: string, includeInactive = false) {
    return this.prisma.funnel.findMany({
      where: {
        tenant_id: tenantId,
        ...(includeInactive ? {} : { active: true }),
      },
      orderBy: [{ active: 'desc' }, { order: 'asc' }, { created_at: 'asc' }],
      include: {
        stages: { orderBy: { order: 'asc' } },
        _count: { select: { deals: true } },
      },
    });
  }

  /** Detalhe de um funil com stages ordenadas. */
  async get(id: string, tenantId: string) {
    const funnel = await this.prisma.funnel.findUnique({
      where: { id },
      include: {
        stages: { orderBy: { order: 'asc' } },
        _count: { select: { deals: true } },
      },
    });
    if (!funnel) throw new NotFoundException('Funil nao encontrado');
    if (funnel.tenant_id !== tenantId) throw new ForbiddenException('Funil de outro escritorio');
    return funnel;
  }

  /** Cria um novo funil. Gera key automaticamente do nome. */
  async create(tenantId: string, input: {
    name: string;
    description?: string;
    color?: string;
    area?: string;
    is_default?: boolean;
  }) {
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('Nome obrigatorio');

    // Gera key unica dentro do tenant
    const key = await uniqueSlug(name, async (candidate) => {
      const exists = await this.prisma.funnel.findUnique({
        where: { tenant_id_key: { tenant_id: tenantId, key: candidate } },
      });
      return !!exists;
    });

    // Se marcar is_default=true, desmarca o anterior (so 1 default por tenant)
    if (input.is_default) {
      await this.prisma.funnel.updateMany({
        where: { tenant_id: tenantId, is_default: true },
        data: { is_default: false },
      });
    }

    // Order = ultimo + 1
    const lastOrder = await this.prisma.funnel.aggregate({
      where: { tenant_id: tenantId },
      _max: { order: true },
    });

    // Cria funil + etapas padrao numa transacao — se a criacao das etapas
    // falhar por qualquer motivo, o funil tambem nao fica orfao no banco.
    const funnel = await this.prisma.$transaction(async (tx) => {
      const created = await tx.funnel.create({
        data: {
          tenant_id: tenantId,
          key,
          name,
          description: input.description?.trim() || null,
          color: input.color || '#E6BE6A',
          area: input.area?.trim() || null,
          is_default: input.is_default ?? false,
          order: (lastOrder._max.order ?? 0) + 1,
          active: true,
        },
      });
      await tx.funnelStage.createMany({
        data: DEFAULT_FUNNEL_STAGES.map((s) => ({
          funnel_id: created.id,
          key: s.key,
          name: s.name,
          type: s.type,
          color: s.color,
          order: s.order,
          ai_hint: s.ai_hint,
        })),
      });
      // Retorna com as etapas ja carregadas, na ordem em que aparecem no kanban.
      return tx.funnel.findUniqueOrThrow({
        where: { id: created.id },
        include: { stages: { orderBy: { order: 'asc' } } },
      });
    });
    this.logger.log(
      `[FUNNEL] Criado ${key} (com ${DEFAULT_FUNNEL_STAGES.length} etapas padrao) tenant=${tenantId}`,
    );
    this.chatGateway.emitConversationsUpdate(tenantId);
    return funnel;
  }

  /** Atualiza metadados do funil. Key NAO muda. */
  async update(id: string, tenantId: string, input: {
    name?: string;
    description?: string | null;
    color?: string | null;
    area?: string | null;
    active?: boolean;
    is_default?: boolean;
  }) {
    const funnel = await this.get(id, tenantId);

    if (input.is_default === true) {
      await this.prisma.funnel.updateMany({
        where: { tenant_id: tenantId, is_default: true, NOT: { id } },
        data: { is_default: false },
      });
    }

    const updated = await this.prisma.funnel.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.area !== undefined ? { area: input.area?.trim() || null } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.is_default !== undefined ? { is_default: input.is_default } : {}),
      },
      include: { stages: { orderBy: { order: 'asc' } } },
    });
    this.chatGateway.emitConversationsUpdate(tenantId);
    return updated;
  }

  /** Remove o funil. Soft delete (active=false) por padrão; hard delete
   *  permitido só se não houver deals. */
  async remove(id: string, tenantId: string, hard = false) {
    const funnel = await this.get(id, tenantId);
    const dealCount = await this.prisma.deal.count({ where: { funnel_id: id } });

    if (hard) {
      if (dealCount > 0) {
        throw new BadRequestException(
          `Funil tem ${dealCount} oportunidades. Mova-as ou use soft delete.`,
        );
      }
      await this.prisma.funnel.delete({ where: { id } });
    } else {
      await this.prisma.funnel.update({ where: { id }, data: { active: false } });
    }
    this.logger.log(`[FUNNEL] ${hard ? 'Hard' : 'Soft'} delete ${funnel.key} tenant=${tenantId}`);
    this.chatGateway.emitConversationsUpdate(tenantId);
    return { ok: true };
  }

  // ─── Etapas ───────────────────────────────────────────────────────────

  /** Cria uma nova etapa no funil. Gera key automaticamente. */
  async addStage(funnelId: string, tenantId: string, input: {
    name: string;
    type?: StageType;
    color?: string;
    win_probability?: number;
    ai_hint?: string;
    sla_hours?: number;
  }) {
    await this.get(funnelId, tenantId); // valida ownership
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('Nome da etapa obrigatorio');

    const key = await uniqueSlug(name, async (candidate) => {
      const exists = await this.prisma.funnelStage.findUnique({
        where: { funnel_id_key: { funnel_id: funnelId, key: candidate } },
      });
      return !!exists;
    });

    // Order = ultima + 1 (antes da PERDIDO/GANHO se existir, ou no fim)
    const lastOrder = await this.prisma.funnelStage.aggregate({
      where: { funnel_id: funnelId },
      _max: { order: true },
    });

    const stage = await this.prisma.funnelStage.create({
      data: {
        funnel_id: funnelId,
        key,
        name,
        type: input.type ?? 'ATIVO',
        color: input.color || '#A8A095',
        order: (lastOrder._max.order ?? 0) + 1,
        win_probability: input.win_probability ?? null,
        ai_hint: input.ai_hint?.trim() || null,
        sla_hours: input.sla_hours ?? null,
      },
    });
    this.chatGateway.emitConversationsUpdate(tenantId);
    return stage;
  }

  /** Atualiza nome / tipo / cor / hint da etapa. Key NAO muda. */
  async updateStage(funnelId: string, stageId: string, tenantId: string, input: {
    name?: string;
    type?: StageType;
    color?: string;
    win_probability?: number | null;
    ai_hint?: string | null;
    sla_hours?: number | null;
  }) {
    await this.get(funnelId, tenantId);
    const stage = await this.prisma.funnelStage.findUnique({ where: { id: stageId } });
    if (!stage || stage.funnel_id !== funnelId) {
      throw new NotFoundException('Etapa nao encontrada nesse funil');
    }
    const updated = await this.prisma.funnelStage.update({
      where: { id: stageId },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.win_probability !== undefined ? { win_probability: input.win_probability } : {}),
        ...(input.ai_hint !== undefined ? { ai_hint: input.ai_hint?.trim() || null } : {}),
        ...(input.sla_hours !== undefined ? { sla_hours: input.sla_hours } : {}),
      },
    });
    this.chatGateway.emitConversationsUpdate(tenantId);
    return updated;
  }

  /** Remove etapa do funil. Block se houver deals nela. */
  async removeStage(funnelId: string, stageId: string, tenantId: string) {
    await this.get(funnelId, tenantId);
    const stage = await this.prisma.funnelStage.findUnique({ where: { id: stageId } });
    if (!stage || stage.funnel_id !== funnelId) {
      throw new NotFoundException('Etapa nao encontrada nesse funil');
    }
    const dealCount = await this.prisma.deal.count({ where: { stage_id: stageId } });
    if (dealCount > 0) {
      throw new BadRequestException(
        `Etapa tem ${dealCount} oportunidade(s). Mova-as antes de deletar.`,
      );
    }
    await this.prisma.funnelStage.delete({ where: { id: stageId } });
    this.chatGateway.emitConversationsUpdate(tenantId);
    return { ok: true };
  }

  /** Reordena etapas em batch (lista de IDs na nova ordem). */
  async reorderStages(funnelId: string, tenantId: string, stageIds: string[]) {
    await this.get(funnelId, tenantId);
    const stages = await this.prisma.funnelStage.findMany({
      where: { funnel_id: funnelId },
      select: { id: true },
    });
    const stageIdSet = new Set(stages.map((s) => s.id));
    for (const id of stageIds) {
      if (!stageIdSet.has(id)) {
        throw new BadRequestException(`Etapa ${id} nao pertence a esse funil`);
      }
    }
    // Atualiza em uma transação pra manter atomicidade
    await this.prisma.$transaction(
      stageIds.map((id, idx) =>
        this.prisma.funnelStage.update({
          where: { id },
          data: { order: idx + 1 },
        }),
      ),
    );
    this.chatGateway.emitConversationsUpdate(tenantId);
    return { ok: true };
  }
}
