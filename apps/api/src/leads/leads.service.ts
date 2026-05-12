import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException, ConflictException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { Prisma, Lead } from '@crm/shared';
import { LegalCasesService } from '../legal-cases/legal-cases.service';
import { AutomationsService } from '../automations/automations.service';
import { FollowupService } from '../followup/followup.service';
import { GoogleDriveService } from '../google-drive/google-drive.service';
import { TrafegoEventsService } from '../trafego/trafego-events.service';
import { effectiveRole, normalizeRoles } from '../common/utils/permissions.util';
import { phoneVariants, toCanonicalBrPhone } from '../common/utils/phone';
import OpenAI from 'openai';
import { buildTokenParam } from '../common/utils/openai-token-param.util';

/**
 * Converte telefone pro formato canonico (55+DDD+8dig). Wrapper que
 * mantem retrocompatibilidade (nunca retorna null — se nao for BR
 * valido, mantem raw limpo como fallback defensivo).
 *
 * Centralizado em common/utils/phone.ts desde 2026-04-24 — antes havia
 * multiplas implementacoes parciais (to12Digits aqui, normalizacao
 * inline em createDirect, etc) que divergiam em edge cases.
 */
function to12Digits(phone: string): string {
  const canonical = toCanonicalBrPhone(phone);
  // Fallback: se nao pudermos canonizar (ex: numero internacional
  // nao-BR ou string vazia), preserva apenas os digitos — evita quebrar
  // casos legados. Pontos de entrada novos devem validar explicitamente
  // chamando toCanonicalBrPhone direto.
  return canonical || (phone || '').replace(/\D/g, '');
}

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private prisma: PrismaService,
    private legalCasesService: LegalCasesService,
    private chatGateway: ChatGateway,
    private automationsService: AutomationsService,
    private moduleRef: ModuleRef,
    private googleDriveService: GoogleDriveService,
    private trafegoEvents: TrafegoEventsService,
  ) {}

  private async findReusableLeadByPhone(phone: string, tenantId: string | null): Promise<Pick<Lead, 'id' | 'tenant_id' | 'phone'> | null> {
    const variants = phoneVariants(phone);
    if (variants.length === 0) return null;

    if (tenantId) {
      const tenantLead = await this.prisma.lead.findFirst({
        where: { phone: { in: variants }, tenant_id: tenantId },
        orderBy: { created_at: 'asc' },
        select: { id: true, tenant_id: true, phone: true },
      });
      if (tenantLead) return tenantLead;
    }

    // Legacy fallback removido apos migration tenant_id NOT NULL — nao
    // existem mais leads com tenant_id IS NULL pra adotar.
    return null;
  }

  async create(data: Prisma.LeadCreateInput, inboxId?: string | null): Promise<Lead> {
    if (data.phone) data = { ...data, phone: to12Digits(data.phone) };
    const lead = await this.prisma.lead.create({ data });
    // Fire automation hooks asynchronously (don't block the response)
    this.automationsService.onNewLead(lead.id, lead.tenant_id ?? undefined).catch(err =>
      this.logger.warn(`onNewLead automation error for lead ${lead.id}: ${err}`),
    );
    this.notifyNewLead(lead, inboxId);
    // Trafego: dispara OCI upload se ConversionAction estiver mapeada a 'lead.created'.
    // Silencioso se nao houver gclid ou se nao houver mapeamento.
    if (lead.tenant_id) {
      this.trafegoEvents
        .onLeadCreated(lead.id, lead.tenant_id)
        .catch((err) =>
          this.logger.warn(`[trafego-events] onLeadCreated lead=${lead.id}: ${err}`),
        );
    }
    return lead;
  }

  /** Dispara notificação de novo lead: atendente vinculado > inbox > operators do tenant. */
  private notifyNewLead(lead: Lead, inboxId?: string | null): void {
    this.chatGateway.emitNewLeadNotification(
      lead.tenant_id ?? null,
      lead.cs_user_id ?? null,
      inboxId ?? null,
      {
        leadId: lead.id,
        leadName: lead.name,
        phone: lead.phone,
        origin: lead.origin,
      },
    ).catch(err => this.logger.warn(`[notifyNewLead] ${lead.id}: ${err}`));
  }

  async findAll(
    tenant_id?: string,
    inbox_id?: string,
    page?: number,
    limit?: number,
    search?: string,
    stage?: string,
    userId?: string,
    isClient?: boolean,
  ) {
    // Bug fix 2026-05-12 (Leads PR1 #C9 — CRITICO):
    // Antes: tenant_id ausente → where = {} → listava TODOS os leads de
    // TODOS os tenants. Token sem tenant_id (legado/seed/bug) = leak global.
    // Agora: tenant_id obrigatorio (lanca erro).
    if (!tenant_id) {
      throw new BadRequestException('tenant_id obrigatorio em findAll');
    }
    const baseWhere: any = { tenant_id };

    // Filtro por stage:
    //  - stage=PERDIDO  → busca arquivados
    //  - stage=<outro>  → filtra pelo stage específico
    //  - sem stage      → exclui PERDIDO (visão ativa, paginação correta)
    if (stage) {
      baseWhere.stage = stage;
    } else {
      baseWhere.stage = { not: 'PERDIDO' };
    }

    // Filtro por tipo lead vs cliente:
    //   - undefined: nao filtra (comportamento default — retorna tudo)
    //   - false: so leads (CRM Pipeline usa — clientes saem)
    //   - true: so clientes
    if (isClient !== undefined) {
      baseWhere.is_client = isClient;
    }

    // Busca server-side por nome ou telefone
    if (search && search.trim()) {
      const s = search.trim();
      baseWhere.AND = [
        {
          OR: [
            { name: { contains: s, mode: 'insensitive' } },
            { phone: { contains: s } },
            { email: { contains: s, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const where = inbox_id
      ? {
          ...baseWhere,
          conversations: { some: { inbox_id } },
        }
      : baseWhere;

    // ─── Controle de acesso por role (mesmo padrão de conversations) ────
    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { roles: true, inboxes: { select: { id: true } } },
      });

      const userRoles = normalizeRoles(user?.roles as any);
      const isAdminUser = userRoles.includes('ADMIN');
      const isAdvogadoUser = userRoles.includes('ADVOGADO');
      const isOperadorUser = userRoles.includes('OPERADOR') || userRoles.includes('COMERCIAL');
      const userInboxIds = (user?.inboxes ?? []).map((i: any) => i.id);

      if (!isAdminUser) {
        // CRM Pipeline: operador/advogado vê apenas leads explicitamente atribuídos.
        // Diferente do chat inbox (que mostra fila da inbox), aqui só mostra leads
        // onde o usuário é assigned_user, assigned_lawyer, cs_user ou lawyer do caso.
        const orConditions: any[] = [];

        if (isAdvogadoUser) {
          orConditions.push({ conversations: { some: { assigned_lawyer_id: userId } } });
          orConditions.push({ legal_cases: { some: { lawyer_id: userId } } });
        }

        if (isOperadorUser || isAdvogadoUser) {
          orConditions.push({ conversations: { some: { assigned_user_id: userId } } });
          orConditions.push({ cs_user_id: userId });
        }

        // Fallback: se nenhuma condição (ex: estagiário), ver só os atribuídos
        if (orConditions.length === 0) {
          orConditions.push({ conversations: { some: { assigned_user_id: userId } } });
        }

        // Combina com AND para manter os filtros de tenant/stage/search
        if (!where.AND) where.AND = [];
        if (!Array.isArray(where.AND)) where.AND = [where.AND];
        where.AND.push({ OR: orConditions });
      }
    }

    const includeOpts = {
      _count: {
        select: { conversations: true },
      },
      conversations: {
        where: inbox_id ? { inbox_id } : undefined,
        orderBy: { last_message_at: 'desc' as const },
        take: 1,
        include: {
          messages: {
            orderBy: { created_at: 'desc' as const },
            take: 1,
          },
          assigned_user: { select: { id: true, name: true } },
          assigned_lawyer: { select: { id: true, name: true } },
        },
      },
      calendar_events: {
        where: { start_at: { gte: new Date() } },
        orderBy: { start_at: 'asc' as const },
        take: 3,
        select: { id: true, type: true, title: true, start_at: true },
      },
      // Casos em VIABILIDADE (triagem) — renderizados como badge no card
      // de cliente. Inclui ID pra que o frontend possa linkar direto pro caso.
      legal_cases: {
        where: { stage: 'VIABILIDADE', archived: false },
        select: { id: true, legal_area: true, created_at: true, priority: true },
        orderBy: { created_at: 'desc' as const },
      },
    };

    if (page && limit) {
      const [data, total] = await this.prisma.$transaction([
        this.prisma.lead.findMany({
          where,
          include: includeOpts,
          orderBy: { created_at: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.prisma.lead.count({ where }),
      ]);
      return { data, total, page, limit };
    }

    return this.prisma.lead.findMany({
      where,
      include: includeOpts,
      orderBy: { created_at: 'desc' },
    }) as any;
  }

  async findOne(id: string, tenantId?: string): Promise<Lead | null> {
    // Bug fix 2026-05-12 (Leads PR1 #C1 — CRITICO):
    // Antes: findUnique({ where: { id } }) + check posterior. Falhas:
    //   1. tenantId undefined (token corrompido) passava direto
    //   2. lead.tenant_id null (legado) passava direto
    //   3. Lead ja era carregado ANTES do check (logs/timing leak)
    // Agora: findFirst com tenant_id no WHERE — Postgres nem retorna a row.
    // NotFoundException em vez de Forbidden — nao revela existencia da row.
    const where: any = { id };
    if (tenantId) where.tenant_id = tenantId;

    const lead = await this.prisma.lead.findFirst({
      where,
      include: {
        // memory (AiMemory) removido em 2026-04-20 (fase 2d da remocao total).
        // Quem precisa do perfil agora consulta LeadProfile via include { profile }.
        profile: { select: { summary: true, facts: true, generated_at: true } },
        conversations: {
          orderBy: { last_message_at: 'desc' },
          include: {
            assigned_user: { select: { id: true, name: true } },
            messages: {
              orderBy: { created_at: 'desc' },
              take: 1,
            },
          },
        },
        tasks: {
          orderBy: { created_at: 'desc' },
          take: 10,
        },
        legal_cases: {
          where: { archived: false },
          orderBy: { created_at: 'desc' },
          include: {
            lawyer: { select: { id: true, name: true } },
          },
        },
        _count: {
          select: { conversations: true },
        },
      },
    }) as any;
    return lead;
  }

  async upsert(data: Prisma.LeadCreateInput, inboxId?: string | null): Promise<Lead> {
    const phone = to12Digits(data.phone);
    // No UPDATE nunca sobrescreve nome, stage nem foto com valores piores:
    // - nome: só atualiza se o lead ainda não tem nome (null/vazio) E veio um nome no payload.
    //   Evita sobrescrever o nome real do cliente com o pushName do escritório.
    // - stage: webhook sempre envia 'QUALIFICANDO', mas o stage e gerenciado pela IA.
    // - profile_picture_url: só atualiza se o lead não tem foto OU se chegou uma URL válida.
    const { phone: _phone, name: incomingName, stage: _stage, profile_picture_url: incomingPhoto, tenant_id: rawTenantId, tenant: tenantConnect, ...updateData } = data as any;

    // tenant_id pode chegar como `tenant_id: '...'` direto OU via `tenant: { connect: { id } }`.
    // O upsert agora isola por tenant (vide bug 2026-04-29: phone deixou de ser
    // unique global no schema). Sem o tenant, dois escritorios com o mesmo
    // telefone se sobrescreviam.
    const tenantId: string | null = rawTenantId ?? tenantConnect?.connect?.id ?? null;

    this.logger.debug(`Upsert lead: raw=${data.phone} → stored=${phone} (tenant=${tenantId ?? 'null'})`);

    // Busca robusta por TODAS as variantes (10/11/12/13 digitos): leads legados
    // podem ter sido salvos em formato antigo (ex: 13 dig com nono digito) e o
    // match exato falharia, criando duplicata. Espelha a logica de findByPhone.
    // Bug 2026-05-04: webhook duplicou leads ao buscar so phone canonico.
    const variants = phoneVariants(data.phone);

    // Tenta atualizar o nome apenas se o lead existente não tiver nome.
    // Inclui leads legados sem tenant_id pra que sejam adotados pelo tenant
    // atual em vez de ficarem orfaos quando o webhook chega com tenant_id.
    if (incomingName) {
      await this.prisma.lead.updateMany({
        where: {
          phone: { in: variants.length ? variants : [phone] },
          name: null,
          ...(tenantId ? { tenant_id: tenantId } : {}),
        },
        data: { name: incomingName },
      });
    }

    // profile_picture_url: só incluir no update quando vier URL válida.
    // URLs do WhatsApp expiram (~24-48h) — URL nova é sempre melhor que a guardada.
    // Nunca limpar foto existente com null (se webhook não enviou foto, não toca no campo).
    if (incomingPhoto) {
      updateData.profile_picture_url = incomingPhoto;
    }

    // findFirst+create/update em vez de Prisma.upsert porque tenant_id eh
    // nullable: o composite key `tenant_id_phone` nao funciona bem para
    // registros legados tenant_id=null. Preferimos lead do tenant atual, mas
    // reutilizamos lead legado sem tenant para nao duplicar o contato quando
    // o webhook novo chega com tenant_id do inbox.
    const existing = await this.findReusableLeadByPhone(phone, tenantId);

    let lead: Lead;
    if (existing) {
      // Self-heal: se o lead existente esta em formato legado, normaliza pro
      // canonico no update. Ao longo do tempo, todos convergem pro 12-dig.
      // Adicional: se o lead legado nao tem tenant_id e o webhook chegou com
      // um, adota o lead pro tenant atual em vez de criar duplicata.
      const dataToUpdate: any = existing.phone !== phone ? { ...updateData, phone } : { ...updateData };
      if (tenantId && !existing.tenant_id) dataToUpdate.tenant_id = tenantId;
      lead = await this.prisma.lead.update({
        where: { id: existing.id },
        data: dataToUpdate,
      });
    } else {
      let createdLead = false;
      try {
        lead = await this.prisma.lead.create({
          data: { ...data, phone },
        });
        createdLead = true;
      } catch (err: any) {
        // Webhooks podem chegar em paralelo. Se outro request criou o lead
        // entre nosso lookup e create, reutiliza o registro vencedor.
        if (err?.code !== 'P2002') throw err;
        const winner = await this.findReusableLeadByPhone(phone, tenantId);
        if (!winner) throw err;
        lead = await this.prisma.lead.update({
          where: { id: winner.id },
          data: {
            ...updateData,
            ...(winner.phone !== phone ? { phone } : {}),
            ...(tenantId && !winner.tenant_id ? { tenant_id: tenantId } : {}),
          } as any,
        });
      }
      if (createdLead) {
        this.notifyNewLead(lead, inboxId);
      }
    }

    return lead;
  }

  async findByPhone(phone: string, tenantId?: string | null): Promise<Lead | null> {
    // Busca ROBUSTA: cobre todas as 4 variantes plausíveis (10/11/12/13
    // dígitos, com/sem DDI, com/sem nono dígito). Antes só tentava
    // normalizado + raw, então leads cadastrados em formato intermediário
    // (ex: 11 dígitos com nono mas sem DDI) não apareciam. Bug reportado
    // 2026-04-24: usuário digitou 8296316935 no Cadastro Direto e o lead
    // existente não foi encontrado (estava em outro formato no banco).
    //
    // Bug fix 2026-05-12 (Leads PR1 #C8 — CRITICO):
    // Antes tinha fallback "sem tenantId" que rodava findFirst GLOBAL —
    // resquicio pre-2026-04-29 (quando phone era unique global). Apos
    // tenant_id NOT NULL aplicado em 2026-05-08, esse fallback eh um
    // vetor de leak: caller que esquece de passar tenantId conseguia ler
    // lead de outro escritorio. Agora: tenantId OBRIGATORIO. Caller que
    // chamava sem tenant precisa atualizar — comportamento explicito,
    // sem fallback silencioso.
    if (!tenantId) {
      throw new BadRequestException(
        'findByPhone exige tenantId apos hardening 2026-05-08. ' +
        'Caller esta quebrado — verifique o stack trace.',
      );
    }
    const variants = phoneVariants(phone);
    if (variants.length === 0) return null;
    return this.prisma.lead.findFirst({
      where: { phone: { in: variants }, tenant_id: tenantId },
      orderBy: { created_at: 'asc' },
    });
  }

  // Bug fix 2026-05-12 (Leads PR1 #C3 — CRITICO LGPD):
  //
  // Antes: checkPhone(phone) chamava findByPhone(phone) SEM tenantId. Qualquer
  // user autenticado de tenant A descobria se telefone X era cliente de tenant
  // B — leak de base de clientes entre concorrentes + violacao LGPD.
  // Agora: tenantId obrigatorio, busca escopada por tenant.
  async checkPhone(phone: string, tenantId: string): Promise<{
    exists: boolean;
    lead?: Lead;
    inactive?: boolean;
    inactiveReason?: string | null;
  }> {
    if (!tenantId) {
      throw new BadRequestException('tenant_id obrigatorio em checkPhone');
    }
    const found = await this.findByPhone(phone, tenantId);
    if (!found) return { exists: false };
    const isInactive =
      ['PERDIDO', 'FINALIZADO'].includes(found.stage) &&
      !found.is_client;
    return {
      exists: true,
      lead: found,
      inactive: isInactive,
      inactiveReason: isInactive
        ? (found.stage === 'PERDIDO' ? 'perdido' : 'finalizado sem vínculo ativo')
        : null,
    };
  }

  async update(id: string, data: { name?: string; email?: string; cpf_cnpj?: string; tags?: string[] }, tenantId?: string): Promise<Lead> {
    // Bug fix 2026-05-12 (Leads PR1 #C1): updateMany com tenant_id no WHERE
    // + check count=0 (NotFound em vez de Forbidden — nao revela existencia).
    if (!tenantId) {
      throw new BadRequestException('tenant_id obrigatorio em update');
    }
    const result = await this.prisma.lead.updateMany({
      where: { id, tenant_id: tenantId },
      data,
    });
    if (result.count === 0) {
      throw new NotFoundException('Lead nao encontrado');
    }
    return this.prisma.lead.findUniqueOrThrow({ where: { id } });
  }

  // PATCH /leads/:id/phone (ADMIN-only) — troca o telefone do lead/cliente.
  // Bloqueia se o numero novo ja existir em outro lead (ConflictException com
  // o lead conflitante no payload pra UI mostrar). Registra audit trail como
  // LeadNote prefixada [SISTEMA] pra aparecer no timeline.
  async updatePhone(
    id: string,
    rawNewPhone: string,
    tenantId: string | undefined,
    actorId: string | undefined,
  ): Promise<Lead> {
    const newPhone = toCanonicalBrPhone(rawNewPhone);
    if (!newPhone) {
      throw new BadRequestException('Telefone invalido. Use formato BR (DDD + numero).');
    }

    // Bug fix 2026-05-12 (Leads PR1 #C1): findFirst com tenant_id no WHERE
    if (!tenantId) {
      throw new BadRequestException('tenant_id obrigatorio em updatePhone');
    }
    const current = await this.prisma.lead.findFirst({
      where: { id, tenant_id: tenantId },
      select: { id: true, tenant_id: true, phone: true, name: true },
    });
    if (!current) throw new NotFoundException('Lead nao encontrado');

    // No-op: telefone ja esta no formato canonico desejado.
    if (current.phone === newPhone) {
      return this.prisma.lead.findUniqueOrThrow({ where: { id } });
    }

    // Detecta conflito cobrindo TODAS as variantes (10/11/12/13 digitos)
    // pra pegar leads cadastrados em formato legado.
    // Bug fix 2026-05-12 (Leads PR1 #C4 — CRITICO):
    // Antes: conflict findFirst SEM tenant_id. Retornava 409 com nome/phone/
    // is_client de lead de OUTRO tenant — leak + bloqueava troca legitima.
    const conflict = await this.prisma.lead.findFirst({
      where: {
        phone: { in: phoneVariants(newPhone) },
        tenant_id: tenantId, // SO conflito dentro do tenant
        id: { not: id },
      },
      select: { id: true, name: true, phone: true, is_client: true },
    });
    if (conflict) {
      throw new ConflictException({
        message: 'Ja existe outro contato com este telefone.',
        conflict: {
          id: conflict.id,
          name: conflict.name,
          phone: conflict.phone,
          is_client: (conflict as any).is_client ?? false,
        },
      });
    }

    const updated = await this.prisma.lead.update({
      where: { id },
      data: { phone: newPhone },
    });

    // Audit trail no timeline. Note vai exigir actorId — se nao houver,
    // pula silenciosamente (acontece so em chamadas internas/seed).
    if (actorId) {
      await this.prisma.leadNote.create({
        data: {
          lead_id: id,
          user_id: actorId,
          text: `[SISTEMA] Telefone alterado de ${current.phone} para ${newPhone}.`,
        },
      }).catch(err => this.logger.warn(`[updatePhone] falha ao registrar audit note: ${err}`));
    }

    this.logger.log(`[updatePhone] lead ${id}: ${current.phone} -> ${newPhone} por ${actorId ?? 'sistema'}`);
    return updated;
  }

  async updateStatus(id: string, stage: string, tenantId?: string, lossReason?: string, actorId?: string): Promise<Lead> {
    // Bug fix 2026-05-12 (Leads PR1 #C1)
    if (!tenantId) {
      throw new BadRequestException('tenant_id obrigatorio em updateStatus');
    }
    {
      const existing = await this.prisma.lead.findFirst({ where: { id, tenant_id: tenantId }, select: { tenant_id: true } });
      if (!existing) {
        throw new NotFoundException('Lead nao encontrado');
      }
    }

    // Stage gate: PERDIDO exige motivo
    if (stage === 'PERDIDO' && !lossReason) {
      throw new ForbiddenException('Motivo de perda é obrigatório ao marcar como PERDIDO');
    }

    // Stage gate: FINALIZADO exige area juridica
    if (stage === 'FINALIZADO') {
      const conv = await this.prisma.conversation.findFirst({
        where: { lead_id: id },
        orderBy: { last_message_at: 'desc' },
        select: { legal_area: true, assigned_lawyer_id: true },
      });
      if (!conv?.legal_area) {
        throw new ForbiddenException('Lead precisa ter área jurídica definida para ser finalizado');
      }
    }

    // Captura o stage atual antes de alterar (para o histórico)
    const current = await this.prisma.lead.findUnique({ where: { id }, select: { stage: true } });

    // Ao finalizar: busca o operador que fechou a venda para registrar como CS
    let csUserId: string | undefined;
    if (stage === 'FINALIZADO') {
      const lastConv = await this.prisma.conversation.findFirst({
        where: { lead_id: id },
        orderBy: { last_message_at: 'desc' },
        select: { assigned_user_id: true },
      });
      csUserId = lastConv?.assigned_user_id ?? undefined;
    }

    const lead = await this.prisma.lead.update({
      where: { id },
      data: {
        stage,
        stage_entered_at: new Date(),
        ...(stage === 'PERDIDO' && lossReason ? { loss_reason: lossReason } : {}),
        // Marcar como cliente ao FINALIZAR
        ...(stage === 'FINALIZADO' ? {
          is_client: true,
          became_client_at: new Date(),
          ...(csUserId ? { cs_user_id: csUserId } : {}),
        } : {}),
      },
    });

    // Registra o histórico de mudança de stage
    this.prisma.leadStageHistory.create({
      data: {
        lead_id: id,
        from_stage: current?.stage ?? null,
        to_stage: stage,
        actor_id: actorId ?? null,
        loss_reason: lossReason ?? null,
      },
    }).catch(err => this.logger.warn(`Failed to record stage history for lead ${id}: ${err}`));

    // appendLeadStageToMemory REMOVIDO em 2026-04-20 (fase 2d-2). Historico
    // de etapas CRM fica em LeadStageHistory (tabela proppria — consultavel
    // por timeline). A IA recebe o stage atual via lead.stage no payload.

    // Broadcast: notificar outros clientes sobre mudanca de stage do lead
    this.chatGateway.emitConversationsUpdate(tenantId ?? null);

    // Criar pasta no Google Drive ao atingir AGUARDANDO_DOCS
    if (stage === 'AGUARDANDO_DOCS') {
      this.googleDriveService.isConfigured().then(configured => {
        if (!configured) return;
        return this.googleDriveService.ensureLeadFolder(id, lead.name || 'Lead');
      }).then(folderId => {
        if (folderId) this.logger.log(`[DRIVE] Pasta criada/garantida para lead ${id}: ${folderId}`);
      }).catch(err =>
        this.logger.warn(`[DRIVE] Falha ao criar pasta para lead ${id} em AGUARDANDO_DOCS: ${err.message}`),
      );
    }

    // Fire stage-change automation hooks asynchronously
    this.automationsService.onStageChange(id, stage, tenantId).catch(err =>
      this.logger.warn(`onStageChange automation error for lead ${id}: ${err}`),
    );

    // Auto-enroll em sequências de follow-up configuradas para o novo stage
    // Resolve via ModuleRef para evitar dependência circular na inicialização do módulo
    try {
      const followupService = this.moduleRef.get(FollowupService, { strict: false });
      if (followupService) {
        followupService.autoEnrollByStage(id, stage).catch((err: Error) =>
          this.logger.warn(`[FOLLOWUP] Auto-enroll falhou: ${err.message}`),
        );
      }
    } catch {
      // FollowupModule pode não estar carregado em contextos de teste — ignorar silenciosamente
    }

    // Auto-criacao de LegalCase quando lead atinge FINALIZADO
    if (stage === 'FINALIZADO') {
      try {
        const conv = await this.prisma.conversation.findFirst({
          where: { lead_id: id, assigned_lawyer_id: { not: null } },
          orderBy: { last_message_at: 'desc' },
          select: { id: true, assigned_lawyer_id: true, tenant_id: true, legal_area: true },
        });
        if (conv?.assigned_lawyer_id) {
          await this.legalCasesService.createFromFinalizado(
            id,
            conv.assigned_lawyer_id,
            conv.id,
            conv.tenant_id ?? undefined,
          );
          this.logger.log(`Auto-created LegalCase for lead ${id} -> lawyer ${conv.assigned_lawyer_id}`);
        } else {
          // Lead foi finalizado SEM advogado atribuido em nenhuma conversation —
          // processo nao eh criado automaticamente. Antes era silencioso,
          // confundindo operador que nao entendia porque o lead finalizava
          // mas processo nao aparecia. Agora loga WARN visivel pra diagnostico.
          this.logger.warn(
            `[AUTO-CASE] Lead ${id} finalizado mas SEM advogado em conversation ativa — ` +
            `LegalCase NAO foi criado automaticamente. Atribua um advogado na conversa ` +
            `ou crie o processo manualmente via POST /legal-cases ou /legal-cases/direct.`,
          );
        }
      } catch (err) {
        this.logger.warn(`Failed to auto-create LegalCase for lead ${id}: ${err}`);
      }
    }

    return lead;
  }

  /**
   * Reseta toda a memoria da IA para um lead — deleta LeadProfile (sistema
   * novo), Memory entries (scope=lead) e AiMemory (sistema antigo, mantido
   * apenas enquanto a tabela existir).
   *
   * Na proxima interacao do lead, o sistema novo cria LeadProfile do zero
   * a partir das novas mensagens via extracao batch noturna + consolidacao.
   *
   * Atualizado em 2026-04-20 (remocao total do sistema antigo — fase 2c):
   * antes resetava apenas AiMemory. Agora reseta ambos em paralelo dentro
   * de transaction.
   */
  /**
   * Bug fix 2026-05-11 (Memoria PR3 #M10):
   * Antes: hard DELETE de leadProfile + memorias sem audit. Operacao
   * destrutiva irrecuperavel — admin clicava no lead errado = perdia
   * meses de extracao IA.
   *
   * Agora:
   *   - leadProfile: continua DELETE (regenera via consolidate-profile)
   *   - memorias: SOFT delete (status='archived') — recuperavel via UPDATE
   *   - audit log obrigatorio
   */
  async resetMemory(id: string, tenantId?: string, actorUserId?: string): Promise<{ ok: boolean; deleted: { leadProfile: number; memories: number } }> {
    // Bug fix 2026-05-12 (Leads PR1 #C1)
    if (!tenantId) {
      throw new BadRequestException('tenant_id obrigatorio em resetMemory');
    }
    {
      const lead = await this.prisma.lead.findFirst({ where: { id, tenant_id: tenantId }, select: { tenant_id: true } });
      if (!lead) {
        throw new NotFoundException('Lead nao encontrado');
      }
    }

    const [lpResult, memResult] = await this.prisma.$transaction([
      this.prisma.leadProfile.deleteMany({ where: { lead_id: id } }),
      // Soft delete em vez de DELETE — preserva trilha de auditoria
      this.prisma.memory.updateMany({
        where: { scope: 'lead', scope_id: id, status: 'active' },
        data: { status: 'archived' },
      }),
    ]);

    // Audit log (best-effort, nao bloqueia)
    await this.prisma.auditLog.create({
      data: {
        actor_user_id: actorUserId || null,
        action: 'memory_reset_lead',
        entity: 'Lead',
        entity_id: id,
        meta_json: {
          tenant_id: tenantId || null,
          leadProfile_deleted: lpResult.count,
          memories_archived: memResult.count,
          note: 'Memorias com status=archived (soft delete). LeadProfile hard-deleted (regenera via consolidate-profile).',
        },
      },
    }).catch(() => { /* nao bloqueia */ });

    return {
      ok: true,
      deleted: {
        leadProfile: lpResult.count,
        memories: memResult.count,
      },
    };
  }

  // ─── DELETE CONTACT (somente ADMIN) ──────────────────────────────────────
  // Exclui o contato e TODOS os seus dados: conversas, mensagens, memória IA,
  // casos jurídicos, tarefas, eventos, publicações DJEN.
  //
  // Bug fix 2026-05-12 (Leads PR1 #C2 — CRITICO):
  //   - tenant_id obrigatorio (antes: ADMIN tenant A apagava lead tenant B
  //     via id enumeration)
  //   - Audit log obrigatorio com snapshot do lead deletado (LGPD/OAB:
  //     dever de guarda exige trace)
  //   - actor_user_id pra responsabilizacao
  async deleteContact(id: string, tenantId: string, actorUserId?: string): Promise<{ ok: boolean }> {
    if (!tenantId) {
      throw new BadRequestException('tenant_id obrigatorio em deleteContact');
    }
    // Snapshot completo pra audit log antes de deletar
    const lead = await this.prisma.lead.findFirst({
      where: { id, tenant_id: tenantId },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        cpf_cnpj: true,
        stage: true,
        is_client: true,
        tags: true,
        tenant_id: true,
        created_at: true,
      },
    });
    if (!lead) throw new NotFoundException('Contato não encontrado');

    // Conta o que sera deletado (pra audit + log informativo)
    const counts = await Promise.all([
      this.prisma.conversation.count({ where: { lead_id: id, tenant_id: tenantId } }),
      this.prisma.legalCase.count({ where: { lead_id: id, tenant_id: tenantId } }),
      this.prisma.task.count({ where: { lead_id: id, tenant_id: tenantId } }),
    ]).catch(() => [0, 0, 0]);

    // Audit log ANTES da transacao destrutiva — se transaction falha,
    // ainda temos rastro de que houve TENTATIVA de delete.
    await this.prisma.auditLog.create({
      data: {
        actor_user_id: actorUserId || null,
        action: 'lead_delete_contact',
        entity: 'Lead',
        entity_id: id,
        meta_json: {
          tenant_id: tenantId,
          lead_snapshot: {
            name: lead.name,
            phone: lead.phone,
            email: lead.email,
            cpf_cnpj: lead.cpf_cnpj ? `***${String(lead.cpf_cnpj).slice(-3)}` : null, // mask LGPD
            stage: lead.stage,
            is_client: lead.is_client,
            tags: lead.tags,
            created_at: lead.created_at,
          },
          cascade: {
            conversations: counts[0],
            legal_cases: counts[1],
            tasks: counts[2],
          },
          note: 'Hard delete em cascata. Recuperacao so via backup do banco.',
        },
      },
    }).catch((e: any) => {
      this.logger.warn(`[deleteContact] Falha ao criar audit log: ${e.message}`);
    });

    await this.prisma.$transaction(async (tx) => {
      // 1. Coleta todos os IDs relacionados
      const conversations = await tx.conversation.findMany({
        where: { lead_id: id },
        select: { id: true },
      });
      const convIds = conversations.map(c => c.id);

      const legalCases = await tx.legalCase.findMany({
        where: { lead_id: id },
        select: { id: true },
      });
      const caseIds = legalCases.map(c => c.id);

      const messages = convIds.length > 0
        ? await tx.message.findMany({
            where: { conversation_id: { in: convIds } },
            select: { id: true },
          })
        : [];
      const msgIds = messages.map(m => m.id);

      const allTasks = await tx.task.findMany({
        where: {
          OR: [
            { lead_id: id },
            ...(caseIds.length > 0 ? [{ legal_case_id: { in: caseIds } }] : []),
            ...(convIds.length > 0 ? [{ conversation_id: { in: convIds } }] : []),
          ],
        },
        select: { id: true },
      });
      const taskIds = allTasks.map(t => t.id);

      // 2. Exclui na ordem correta (filhos antes de pais)

      // Comentários de tarefas
      if (taskIds.length > 0) {
        await tx.taskComment.deleteMany({ where: { task_id: { in: taskIds } } });
      }

      // Publicações DJEN dos casos
      if (caseIds.length > 0) {
        await tx.djenPublication.deleteMany({ where: { legal_case_id: { in: caseIds } } });
      }

      // Eventos dos casos
      if (caseIds.length > 0) {
        await tx.caseEvent.deleteMany({ where: { case_id: { in: caseIds } } });
      }

      // Tarefas (do lead, dos casos e das conversas)
      if (taskIds.length > 0) {
        await tx.task.deleteMany({ where: { id: { in: taskIds } } });
      }

      // Casos jurídicos
      if (caseIds.length > 0) {
        await tx.legalCase.deleteMany({ where: { id: { in: caseIds } } });
      }

      // Mídia das mensagens
      if (msgIds.length > 0) {
        await tx.media.deleteMany({ where: { message_id: { in: msgIds } } });
        await tx.message.deleteMany({ where: { id: { in: msgIds } } });
      }

      // Conversas
      if (convIds.length > 0) {
        await tx.conversation.deleteMany({ where: { id: { in: convIds } } });
      }

      // Memoria IA: deleteMany(aiMemory) removido em 2026-04-20 (fase 2d-2).
      // LeadProfile e Memory entries sao deletados em cascade via onDelete
      // no schema (relacoes configuradas com Cascade).

      // Lead em si
      await tx.lead.delete({ where: { id } });
    }, { timeout: 30000 }); // timeout generoso para contatos com muito histórico

    this.logger.log(`[deleteContact] Contato ${id} e todos os seus dados foram excluídos.`);
    return { ok: true };
  }

  // ─── TIMELINE ─────────────────────────────────────────────────────────────
  async getTimeline(leadId: string, tenantId?: string): Promise<any[]> {
    // Bug fix 2026-05-12 (Leads PR1 #C1):
    // findFirst com tenant_id no WHERE em vez de check posterior.
    if (!tenantId) {
      throw new BadRequestException('tenant_id obrigatorio em getTimeline');
    }
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, tenant_id: tenantId },
      select: { id: true },
    });
    if (!lead) {
      throw new NotFoundException('Lead nao encontrado');
    }

    // Atualizado em 2026-04-20 (fase 2d-2): Timeline anterior incluia 3 fontes
    // derivadas de AiMemory.facts_json (case_stage, petition, djen). Como
    // AiMemory foi removido, timeline agora retorna apenas stage_history +
    // notes (dados autoritativos). Eventos derivados de outras tabelas
    // (Petition, DjenPublication, LegalCase) podem ser adicionados em uma
    // iteracao futura consultando essas tabelas diretamente.
    const [stageHistory, notes] = await Promise.all([
      this.prisma.leadStageHistory.findMany({
        where: { lead_id: leadId },
        orderBy: { created_at: 'desc' },
        take: 100,
        include: { actor: { select: { id: true, name: true } } },
      }),
      this.prisma.leadNote.findMany({
        where: { lead_id: leadId },
        orderBy: { created_at: 'desc' },
        take: 100,
        include: { user: { select: { id: true, name: true } } },
      }),
    ]);

    const items: any[] = [
      ...stageHistory.map(h => ({
        type: 'stage_change',
        id: h.id,
        from_stage: h.from_stage,
        to_stage: h.to_stage,
        actor: (h as any).actor ?? null,
        loss_reason: h.loss_reason,
        created_at: h.created_at,
      })),
      ...notes.map(n => ({
        type: 'note',
        id: n.id,
        text: n.text,
        author: (n as any).user ?? null,
        created_at: n.created_at,
      })),
    ];

    return items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  // ─── IA SUMMARY ───────────────────────────────────────────────────────────
  async summarizeLead(leadId: string, tenantId?: string): Promise<{ summary: string }> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        conversations: {
          include: {
            messages: {
              where: { type: 'text' },
              orderBy: { created_at: 'desc' },
              take: 30,
              select: { text: true, direction: true, created_at: true },
            },
          },
          take: 1,
        },
      },
    });
    if (!lead) throw new NotFoundException('Lead não encontrado');
    if (tenantId && lead.tenant_id && lead.tenant_id !== tenantId) {
      throw new ForbiddenException('Acesso negado');
    }

    const conv = lead.conversations?.[0];
    const messages = (conv?.messages ?? []).reverse();
    const messagesText = messages
      .filter((m) => m.text)
      .map((m) => `${m.direction === 'out' ? 'Atendente' : 'Cliente'}: ${m.text}`)
      .join('\n');

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new BadRequestException('API key OpenAI não configurada.');

    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      ...buildTokenParam('gpt-4.1-mini', 300),
      messages: [
        {
          role: 'system',
          content: 'Você é um assistente jurídico. Produza um briefing conciso (3-5 linhas) sobre o lead: quem é, qual é o problema jurídico, o que já foi tratado e qual o próximo passo recomendado. Responda em português, sem tópicos, em texto corrido.',
        },
        {
          role: 'user',
          content: `Lead: ${lead.name || 'Sem nome'} | Etapa: ${lead.stage} | Área: ${(conv as any)?.legal_area || 'não definida'}\n\nConversa:\n${messagesText || 'Sem mensagens registradas.'}`,
        },
      ],
    });

    return { summary: completion.choices[0]?.message?.content ?? 'Não foi possível gerar o resumo.' };
  }

  // ─── EXPORT CSV ───────────────────────────────────────────────────────────
  async exportCsv(tenantId?: string, search?: string, userId?: string): Promise<string> {
    // Bug fix 2026-05-12 (Leads PR1 #C9):
    // tenant_id obrigatorio. Antes: where = {} se ausente → exportava
    // PII de TODOS os tenants. LGPD critico.
    if (!tenantId) {
      throw new BadRequestException('tenant_id obrigatorio em exportCsv');
    }
    const where: any = { tenant_id: tenantId };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ];
    }

    // Controle de acesso por role (mesmo padrão do findAll)
    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { roles: true },
      });
      const userRoles = normalizeRoles(user?.roles as any);
      const isAdminUser = userRoles.includes('ADMIN');
      const isAdvogadoUser = userRoles.includes('ADVOGADO');
      const isOperadorUser = userRoles.includes('OPERADOR') || userRoles.includes('COMERCIAL');

      if (!isAdminUser) {
        const orConditions: any[] = [];
        if (isAdvogadoUser) {
          orConditions.push({ conversations: { some: { assigned_lawyer_id: userId } } });
          orConditions.push({ legal_cases: { some: { lawyer_id: userId } } });
        }
        if (isOperadorUser || isAdvogadoUser) {
          orConditions.push({ conversations: { some: { assigned_user_id: userId } } });
          orConditions.push({ cs_user_id: userId });
        }
        if (orConditions.length === 0) {
          orConditions.push({ conversations: { some: { assigned_user_id: userId } } });
        }
        if (!where.AND) where.AND = [];
        if (!Array.isArray(where.AND)) where.AND = [where.AND];
        where.AND.push({ OR: orConditions });
      }
    }

    const leads = await this.prisma.lead.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        conversations: {
          orderBy: { last_message_at: 'desc' },
          take: 1,
          select: { legal_area: true, assigned_lawyer: { select: { name: true } } },
        },
      },
    });

    const escape = (v: string | null | undefined) => {
      if (!v) return '';
      const s = String(v).replace(/"/g, '""');
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
    };

    const msPerDay = 86400000;
    const daysInStage = (d: Date | string) =>
      Math.floor((Date.now() - new Date(d).getTime()) / msPerDay);

    const header = ['Nome', 'Telefone', 'Email', 'Estágio', 'Área Jurídica', 'Advogado', 'Tags', 'Dias no Estágio', 'Criado em'];
    const rows = leads.map(l => {
      const conv = (l as any).conversations?.[0];
      return [
        escape(l.name),
        escape(l.phone),
        escape(l.email),
        escape(l.stage),
        escape(conv?.legal_area),
        escape(conv?.assigned_lawyer?.name),
        escape((l.tags || []).join('; ')),
        escape(String(daysInStage(l.stage_entered_at))),
        escape(new Date(l.created_at).toLocaleDateString('pt-BR')),
      ].join(',');
    });

    // Bug fix 2026-05-12 (Leads PR1 #C9 — LGPD):
    // Audit log obrigatorio em export massivo de PII. LGPD Art.18 da direito
    // ao titular saber quem acessou seus dados; auditoria interna exige
    // registro de exports.
    await this.prisma.auditLog.create({
      data: {
        actor_user_id: userId || null,
        action: 'leads_export_csv',
        entity: 'Tenant',
        entity_id: tenantId,
        meta_json: {
          tenant_id: tenantId,
          search: search || null,
          row_count: leads.length,
          fields: header,
        },
      },
    }).catch((e: any) => {
      this.logger.warn(`[exportCsv] Falha audit log: ${e.message}`);
    });

    return [header.join(','), ...rows].join('\n');
  }

  // appendLeadStageToMemory() REMOVIDO em 2026-04-20 (fase 2d-2). Historico
  // de etapas fica na tabela LeadStageHistory (consultavel via getTimeline).
}
