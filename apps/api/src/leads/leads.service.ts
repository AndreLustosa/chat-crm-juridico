import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { Prisma, Lead } from '@crm/shared';
import { LegalCasesService } from '../legal-cases/legal-cases.service';
import { AutomationsService } from '../automations/automations.service';
import { FollowupService } from '../followup/followup.service';
import { GoogleDriveService } from '../google-drive/google-drive.service';
import { effectiveRole, normalizeRoles } from '../common/utils/permissions.util';
import OpenAI from 'openai';

/**
 * Remove o nono digito de celulares brasileiros.
 * 13 digitos (55+DD+9+8dig) -> 12 digitos (55+DD+8dig)
 * Ex: 5582999130127 -> 558299130127
 */
function to12Digits(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('55') && d[4] === '9') {
    return d.slice(0, 4) + d.slice(5); // remove o 5o caractere (o 9)
  }
  return d;
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
  ) {}

  async create(data: Prisma.LeadCreateInput, inboxId?: string | null): Promise<Lead> {
    if (data.phone) data = { ...data, phone: to12Digits(data.phone) };
    const lead = await this.prisma.lead.create({ data });
    // Fire automation hooks asynchronously (don't block the response)
    this.automationsService.onNewLead(lead.id, lead.tenant_id ?? undefined).catch(err =>
      this.logger.warn(`onNewLead automation error for lead ${lead.id}: ${err}`),
    );
    this.notifyNewLead(lead, inboxId);
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

  async findAll(tenant_id?: string, inbox_id?: string, page?: number, limit?: number, search?: string, stage?: string, userId?: string) {
    const baseWhere: any = tenant_id
      ? { OR: [{ tenant_id }, { tenant_id: null }] }
      : {};

    // Filtro por stage:
    //  - stage=PERDIDO  → busca arquivados
    //  - stage=<outro>  → filtra pelo stage específico
    //  - sem stage      → exclui PERDIDO (visão ativa, paginação correta)
    if (stage) {
      baseWhere.stage = stage;
    } else {
      baseWhere.stage = { not: 'PERDIDO' };
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
    const lead = await this.prisma.lead.findUnique({
      where: { id },
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
    if (lead && tenantId && lead.tenant_id && lead.tenant_id !== tenantId) {
      throw new ForbiddenException('Acesso negado a este recurso');
    }
    return lead;
  }

  async upsert(data: Prisma.LeadCreateInput, inboxId?: string | null): Promise<Lead> {
    const phone = to12Digits(data.phone);
    // No UPDATE nunca sobrescreve nome, stage nem foto com valores piores:
    // - nome: só atualiza se o lead ainda não tem nome (null/vazio) E veio um nome no payload.
    //   Evita sobrescrever o nome real do cliente com o pushName do escritório.
    // - stage: webhook sempre envia 'NOVO', mas o stage é gerenciado pela IA.
    // - profile_picture_url: só atualiza se o lead não tem foto OU se chegou uma URL válida.
    const { phone: _phone, name: incomingName, stage: _stage, profile_picture_url: incomingPhoto, ...updateData } = data as any;

    this.logger.debug(`Upsert lead: raw=${data.phone} → stored=${phone}`);

    // Tenta atualizar o nome apenas se o lead existente não tiver nome
    if (incomingName) {
      await this.prisma.lead.updateMany({
        where: { phone, name: null },
        data: { name: incomingName },
      });
    }

    // profile_picture_url: só incluir no update quando vier URL válida.
    // URLs do WhatsApp expiram (~24-48h) — URL nova é sempre melhor que a guardada.
    // Nunca limpar foto existente com null (se webhook não enviou foto, não toca no campo).
    if (incomingPhoto) {
      updateData.profile_picture_url = incomingPhoto;
    }

    // Detecta se é criação (lead novo) para disparar notificação ao atendente
    const existing = await this.prisma.lead.findUnique({ where: { phone }, select: { id: true } });

    const lead = await this.prisma.lead.upsert({
      where: { phone },
      update: updateData,
      create: { ...data, phone },
    });

    if (!existing) {
      this.notifyNewLead(lead, inboxId);
    }

    return lead;
  }

  async findByPhone(phone: string): Promise<Lead | null> {
    const normalized = to12Digits(phone);
    return this.prisma.lead.findFirst({
      where: { OR: [{ phone: normalized }, { phone }] },
    });
  }

  async checkPhone(phone: string): Promise<{ exists: boolean; lead?: Lead }> {
    const found = await this.findByPhone(phone);
    if (!found) return { exists: false };
    return { exists: true, lead: found };
  }

  async update(id: string, data: { name?: string; email?: string; cpf_cnpj?: string; tags?: string[] }, tenantId?: string): Promise<Lead> {
    if (tenantId) {
      const existing = await this.prisma.lead.findUnique({ where: { id }, select: { tenant_id: true } });
      if (existing?.tenant_id && existing.tenant_id !== tenantId) {
        throw new ForbiddenException('Acesso negado a este recurso');
      }
    }
    return this.prisma.lead.update({
      where: { id },
      data,
    });
  }

  async updateStatus(id: string, stage: string, tenantId?: string, lossReason?: string, actorId?: string): Promise<Lead> {
    if (tenantId) {
      const existing = await this.prisma.lead.findUnique({ where: { id }, select: { tenant_id: true } });
      if (existing?.tenant_id && existing.tenant_id !== tenantId) {
        throw new ForbiddenException('Acesso negado a este recurso');
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
  async resetMemory(id: string, tenantId?: string): Promise<{ ok: boolean; deleted: { leadProfile: number; memories: number } }> {
    if (tenantId) {
      const lead = await this.prisma.lead.findUnique({ where: { id }, select: { tenant_id: true } });
      if (lead?.tenant_id && lead.tenant_id !== tenantId) {
        throw new ForbiddenException('Acesso negado a este recurso');
      }
    }

    const [lpResult, memResult] = await this.prisma.$transaction([
      this.prisma.leadProfile.deleteMany({ where: { lead_id: id } }),
      this.prisma.memory.deleteMany({ where: { scope: 'lead', scope_id: id } }),
    ]);

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
  async deleteContact(id: string): Promise<{ ok: boolean }> {
    const lead = await this.prisma.lead.findUnique({ where: { id }, select: { id: true } });
    if (!lead) throw new NotFoundException('Contato não encontrado');

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
    if (tenantId) {
      const lead = await this.prisma.lead.findUnique({ where: { id: leadId }, select: { tenant_id: true } });
      if (lead?.tenant_id && lead.tenant_id !== tenantId) {
        throw new ForbiddenException('Acesso negado a este recurso');
      }
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
      max_tokens: 300,
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
    const where: any = {};
    if (tenantId) where.tenant_id = tenantId;
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

    return [header.join(','), ...rows].join('\n');
  }

  // appendLeadStageToMemory() REMOVIDO em 2026-04-20 (fase 2d-2). Historico
  // de etapas fica na tabela LeadStageHistory (consultavel via getTimeline).
}
