import { Injectable, ForbiddenException, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Prisma, Conversation } from '@crm/shared';
import { effectiveRole } from '../common/utils/permissions.util';

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    private prisma: PrismaService,
    private chatGateway: ChatGateway,
    private whatsappService: WhatsappService,
    private notificationsService: NotificationsService,
  ) {}

  async create(data: Prisma.ConversationCreateInput): Promise<Conversation> {
    return this.prisma.conversation.create({ data });
  }

  async findAll(status?: string, userId?: string, inboxId?: string, tenantId?: string, clientMode?: boolean) {
    const where: any = {};
    // Filtro por status explícito (se passado via query param)
    if (status) {
      where.status = status;
    }
    // Não filtramos mais por conversation.status (FECHADO/ADIADO).
    // A visibilidade é controlada exclusivamente por lead.stage e lead.is_client.

    // Tenant isolation
    if (tenantId) {
      where.tenant_id = tenantId;
    }

    // Carrega dados do usuário para aplicar regras de acesso
    const user = userId
      ? await this.prisma.user.findUnique({
          where: { id: userId },
          include: { inboxes: { select: { id: true } } },
        })
      : null;

    const userRole = effectiveRole(user?.roles ?? 'OPERADOR');
    const userInboxIds = (user?.inboxes ?? []).map((i: any) => i.id);

    // ─── Filtro por clientMode (modo Leads vs Clientes) ──────────────────
    // Visibilidade controlada por lead.stage e lead.is_client:
    //   - Aba Leads (clientMode=false): is_client=false, exclui ENCERRADO/FINALIZADO/PERDIDO
    //   - Aba Clientes (clientMode=true): is_client=true (todos os clientes)
    //   - Legado (clientMode=undefined): exclui ENCERRADO/FINALIZADO/PERDIDO
    //
    // Bug fix 2026-05-15: ENCERRADO foi adicionado a todos os notIn. Antes,
    // leads com processo arquivado (stage='ENCERRADO' setado por
    // legal-cases.service.ts:archive()) ficavam visiveis na aba Leads —
    // tinham que aparecer ARQUIVADOS / OCULTOS. Andre reportou que cliente
    // "Andreia" (processo arquivado) continuou em Leads pos-archive.
    const HIDDEN_STAGES = ['PERDIDO', 'FINALIZADO', 'ENCERRADO'];
    if (clientMode === true) {
      where.lead = { is_client: true };
    } else if (clientMode === false) {
      where.lead = { is_client: false, stage: { notIn: HIDDEN_STAGES } };
    } else {
      where.lead = { stage: { notIn: HIDDEN_STAGES } };
    }

    // ─── Controle de acesso por role (multi-role aware) ────────────────
    const userRoles: string[] = Array.isArray(user?.roles) ? user.roles : [userRole];
    const isAdminUser = userRoles.includes('ADMIN');
    const isAdvogadoUser = userRoles.includes('ADVOGADO') || userRoles.includes('Advogados');
    const isOperadorUser = userRoles.includes('OPERADOR') || userRoles.includes('COMERCIAL') || userRoles.includes('Atendente Comercial');

    if (isAdminUser) {
      // Admin vê tudo — apenas filtra por inboxId se explicitamente pedido
      if (inboxId) where.inbox_id = inboxId;

    } else {
      // Multi-role: combina visibilidade de todos os papéis do usuário
      // ADVOGADO vê: assigned_lawyer_id + legal_cases.lawyer_id
      // OPERADOR vê: assigned_user_id + cs_user_id (clientes)
      // Ambos: combina tudo via OR
      if (inboxId) {
        // Valida que o usuário pertence ao inbox solicitado
        if (userInboxIds.length > 0 && !userInboxIds.includes(inboxId)) {
          where.inbox_id = '__none__'; // retorna vazio se não pertence ao inbox
        } else {
          where.inbox_id = inboxId;
        }
      } else {
        const orConditions: any[] = [];

        // Visibilidade de ADVOGADO: apenas CLIENTES atribuídos como advogada + processos
        // Na aba Leads: advogado NÃO vê leads de outros operadores via assigned_lawyer_id
        if (isAdvogadoUser && clientMode === true) {
          // Conversas onde o advogado está atribuído diretamente
          orConditions.push({ assigned_lawyer_id: userId, lead: { is_client: true } });
          // Clientes com processos deste advogado
          orConditions.push({ lead: { is_client: true, legal_cases: { some: { lawyer_id: userId } } } });
          // Clientes que têm QUALQUER conversa atribuída a este advogado (ex: atribuído via lead/IA)
          orConditions.push({ lead: { is_client: true, conversations: { some: { assigned_lawyer_id: userId } } } });
        }

        // Conversas atribuídas diretamente ao usuário (qualquer role)
        orConditions.push({ assigned_user_id: userId });

        // Visibilidade de OPERADOR: cs_user_id (clientes) + inbox membership (leads)
        if (isOperadorUser) {
          if (clientMode === true) {
            orConditions.push({ lead: { ...(where.lead ?? {}), cs_user_id: userId } });
          }
          // Inboxes vinculados — APENAS para operadores no modo leads.
          // Pool de ESPERA: só leads do inbox AINDA não atribuídos. Sem o filtro
          // assigned_user_id:null, um lead já assumido por outro operador (ex.: André)
          // vazava para todos do mesmo inbox (ex.: Tatyane). A conversa atribuída a
          // MIM já entra acima via { assigned_user_id: userId }; e uma transferência
          // pendente chega pelo popup de aceite (pending_transfer_to_id), não pela lista.
          if (userInboxIds.length > 0 && clientMode !== true) {
            orConditions.push({ inbox_id: { in: userInboxIds }, assigned_user_id: null });
          }
        }

        where.OR = orConditions;
      }
    }

    const [conversations, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where,
        orderBy: { last_message_at: 'desc' },
        include: {
          lead: { select: { id: true, name: true, phone: true, email: true, stage: true, stage_entered_at: true, profile_picture_url: true, tags: true, is_client: true, became_client_at: true } },
          messages: { orderBy: { created_at: 'desc' }, take: 1, include: { media: true } },
          assigned_user: { select: { id: true, name: true } },
          tasks: {
            where: { status: 'A_FAZER' },
            orderBy: { created_at: 'desc' },
            take: 1,
            select: { id: true, title: true, due_at: true, status: true, assigned_user_id: true, description: true },
          },
          _count: { select: { tasks: { where: { status: 'A_FAZER' } } } },
        },
      }),
      this.prisma.conversation.count({ where }),
    ]);

    // Enrich with lawyer and origin-attendant names in a single query
    const lawyerIds = [...new Set(conversations.map((c: any) => c.assigned_lawyer_id).filter(Boolean))] as string[];
    const originIds = [...new Set(conversations.map((c: any) => c.origin_assigned_user_id).filter(Boolean))] as string[];
    // Destinatário de transferência pendente — para o remetente ver "Aguardando X aceitar".
    const pendingToIds = [...new Set(conversations.map((c: any) => c.pending_transfer_to_id).filter(Boolean))] as string[];
    const allEnrichIds = [...new Set([...lawyerIds, ...originIds, ...pendingToIds])];
    const enrichUsers = allEnrichIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: allEnrichIds } },
          select: { id: true, name: true },
        })
      : [];
    const userNameMap: Record<string, string> = Object.fromEntries(enrichUsers.map((u) => [u.id, u.name]));

    // Enrich with hasNotes flag (1 query, não N+1)
    const convIds = conversations.map((c) => c.id);
    const noteCounts = convIds.length
      ? await (this.prisma as any).conversationNote.groupBy({
          by: ['conversation_id'],
          where: { conversation_id: { in: convIds } },
          _count: true,
        })
      : [];
    const noteCountMap: Record<string, boolean> = Object.fromEntries(
      noteCounts.map((n: any) => [n.conversation_id, true]),
    );

    const data = conversations.map((c) => ({
      id: c.id,
      leadId: c.lead_id,
      inboxId: (c as any).inbox_id || null,
      contactName: c.lead?.name || c.lead?.phone || 'Desconhecido',
      contactPhone: c.lead?.phone || '',
      contactEmail: c.lead?.email || '',
      channel: c.channel?.toUpperCase() || 'WHATSAPP',
      status: c.status === 'FECHADO' ? 'CLOSED'
        : c.status === 'ADIADO'            ? 'ADIADO'      // conversa adiada (aguardando tarefa)
        : c.ai_mode                        ? 'BOT'         // IA ativa (com ou sem operador)
        : c.assigned_user_id               ? 'ACTIVE'      // operador assumiu (ai_mode=false)
        : 'WAITING',                                       // sem IA, sem operador
      lastMessage: c.messages[0]?.text || '',
      // Direção + tipo da última mensagem — o front usa pra (a) prefixar a prévia
      // ("Você: ..."), (b) marcar "aguardando resposta" (último foi o contato) e
      // (c) prévia de mídia ("🎤 Áudio") quando text é vazio.
      lastMessageDirection: c.messages[0]?.direction || null,
      lastMessageType: c.messages[0]?.type || null,
      lastMessageAt: c.last_message_at?.toISOString() || '',
      assignedAgentId: c.assigned_user_id || null,
      assignedAgentName: c.assigned_user?.name || null,
      aiMode: c.ai_mode,
      profile_picture_url: c.lead?.profile_picture_url || null,
      legalArea: (c as any).legal_area || null,
      assignedLawyerId: (c as any).assigned_lawyer_id || null,
      assignedLawyerName: (c as any).assigned_lawyer_id ? (userNameMap[(c as any).assigned_lawyer_id] || null) : null,
      originAssignedUserId: (c as any).origin_assigned_user_id || null,
      originAssignedUserName: (c as any).origin_assigned_user_id ? (userNameMap[(c as any).origin_assigned_user_id] || null) : null,
      // Transferência pendente (remetente vê banner "Aguardando aceitar"; some sozinho ao resolver).
      pendingTransferToId: (c as any).pending_transfer_to_id || null,
      pendingTransferToName: (c as any).pending_transfer_to_id ? (userNameMap[(c as any).pending_transfer_to_id] || null) : null,
      leadStage: c.lead?.stage || null,
      leadTags: (c.lead as any)?.tags || [],
      stageEnteredAt: (c.lead as any)?.stage_entered_at?.toISOString() || null,
      isClient: (c.lead as any)?.is_client ?? false,
      becameClientAt: (c.lead as any)?.became_client_at?.toISOString() || null,
      nextStep: (c as any).next_step || null,
      activeTask: (c as any).tasks?.[0] ? {
        id: (c as any).tasks[0].id,
        title: (c as any).tasks[0].title,
        dueAt: (c as any).tasks[0].due_at?.toISOString() || null,
        status: (c as any).tasks[0].status,
        assignedUserId: (c as any).tasks[0].assigned_user_id || null,
        postponeCount: (c as any).tasks[0].postpone_count || 0,
        note: (c as any).tasks[0].description || null,
      } : null,
      taskCount: (c as any)._count?.tasks ?? 0,
      hasNotes: !!noteCountMap[c.id],
    }));

    return { data, total };
  }

  async findOne(id: string, tenantId?: string) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id },
      include: {
        lead: { select: { id: true, name: true, phone: true, email: true, profile_picture_url: true } },
        // Mensagens sao carregadas via GET /messages/conversation/:id com paginacao
        messages: { orderBy: { created_at: 'desc' }, take: 100, include: { media: true, skill: { select: { id: true, name: true, area: true } } } },
        assigned_user: { select: { id: true, name: true } },
      },
    });
    if (conv && tenantId && conv.tenant_id && conv.tenant_id !== tenantId) {
      throw new ForbiddenException('Acesso negado a este recurso');
    }
    return conv;
  }

  async findAllByLead(lead_id: string, tenantId?: string): Promise<any[]> {
    // Verificar ownership do lead
    if (tenantId) {
      const lead = await this.prisma.lead.findUnique({ where: { id: lead_id }, select: { tenant_id: true } });
      if (lead?.tenant_id && lead.tenant_id !== tenantId) {
        throw new ForbiddenException('Acesso negado a este recurso');
      }
    }
    const convos = await (this.prisma as any).conversation.findMany({
      where: { lead_id },
      orderBy: { last_message_at: 'desc' },
      include: {
        lead: {
          // memory (AiMemory) removido em 2026-04-20 (fase 2d). Consumidores que
          // precisem de contexto do lead devem consultar LeadProfile separadamente.
          include: { profile: { select: { summary: true, facts: true } } },
        },
        messages: { orderBy: { created_at: 'asc' }, take: 100, include: { media: true, skill: { select: { id: true, name: true, area: true } } } },
        assigned_user: { select: { id: true, name: true } },
      },
    });

    // Enriquecer com dados do advogado especialista pré-atribuído
    const lawyerIds = [...new Set(convos.map((c: any) => c.assigned_lawyer_id).filter(Boolean))] as string[];
    const lawyers = lawyerIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: lawyerIds } },
          select: { id: true, name: true, specialties: true },
        })
      : [];
    const lawyerMap: Record<string, any> = Object.fromEntries(lawyers.map((l) => [l.id, l]));

    return convos.map((c: any) => ({
      ...c,
      assigned_lawyer: c.assigned_lawyer_id ? (lawyerMap[c.assigned_lawyer_id] ?? null) : null,
    }));
  }

  async setAssignedLawyer(id: string, lawyerId: string | null, tenantId?: string): Promise<Conversation> {
    // Multi-tenant: a conversa e o advogado de destino têm de ser do escritório.
    await this.assertConversationTenant(id, tenantId);
    if (lawyerId) await this.assertSameTenantUser(lawyerId, tenantId);
    const updated = await this.prisma.conversation.update({
      where: { id },
      data: { assigned_lawyer_id: lawyerId } as any,
    });

    // Enviar notificação WhatsApp para o atendente atribuído
    if (lawyerId) {
      try {
        const [lawyer, conv] = await Promise.all([
          this.prisma.user.findUnique({ where: { id: lawyerId }, select: { name: true, phone: true } }),
          (this.prisma as any).conversation.findUnique({
            where: { id },
            include: { lead: { select: { name: true, phone: true } } },
          }),
        ]);

        if (lawyer?.phone && conv?.lead) {
          const leadName = conv.lead.name || 'Lead sem nome';
          const leadPhone = conv.lead.phone || '';
          const area = (conv as any).legal_area || 'não identificada';

          // Buscar instância da conversa para enviar pelo mesmo número
          const instanceName = (conv as any).instance_name || undefined;

          const msg = `📋 *Novo atendimento atribuído a você*\n\n` +
            `👤 *Cliente:* ${leadName}\n` +
            `📱 *Telefone:* ${leadPhone}\n` +
            `⚖️ *Área:* ${area}\n\n` +
            `Acesse o painel para continuar o atendimento.`;

          await this.whatsappService.sendText(lawyer.phone, msg, instanceName);
          this.logger.log(`[Assign] Notificação WhatsApp enviada para ${lawyer.name} (${lawyer.phone}) — lead: ${leadName}`);
        }
      } catch (err: any) {
        this.logger.warn(`[Assign] Falha ao enviar notificação WhatsApp: ${err.message}`);
      }
    }

    // Reatribui todos os eventos da conversa que ainda não foram concluídos/cancelados
    if (lawyerId) {
      try {
        await (this.prisma as any).calendarEvent.updateMany({
          where: {
            conversation_id: id,
            status: { notIn: ['CONCLUIDO', 'CANCELADO'] },
          },
          data: { assigned_user_id: lawyerId },
        });
      } catch (err: any) {
        this.logger.warn(`[Assign] Falha ao reatribuir eventos do calendário: ${err.message}`);
      }
    }

    return updated;
  }

  async setLegalArea(id: string, legalArea: string | null): Promise<Conversation> {
    return (this.prisma as any).conversation.update({
      where: { id },
      data: { legal_area: legalArea },
    });
  }

  async setAiMode(id: string, ai_mode: boolean): Promise<Conversation> {
    // Toggle do operador SEMPRE marca como MANUAL — protege a conversa do
    // cron AfterHours, que só mexe em entradas sem origem manual.
    return this.prisma.conversation.update({
      where: { id },
      data: {
        ai_mode,
        ai_mode_disabled_at: ai_mode ? null : new Date(),
        ai_mode_source: 'MANUAL',
      },
    });
  }

  /** Anti-IDOR: a conversa precisa pertencer ao tenant do usuário. */
  private async assertConversationTenant(id: string, tenantId?: string): Promise<void> {
    const conv = await this.prisma.conversation.findUnique({ where: { id }, select: { tenant_id: true } });
    if (!conv) throw new NotFoundException('Conversa não encontrada.');
    if (tenantId && conv.tenant_id && conv.tenant_id !== tenantId) {
      throw new ForbiddenException('Acesso negado a esta conversa.');
    }
  }

  /** Anti-vazamento: o destino (operador/advogado) tem de ser do MESMO escritório. */
  private async assertSameTenantUser(userId: string | null | undefined, tenantId?: string): Promise<void> {
    if (!userId || !tenantId) return;
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { tenant_id: true } });
    if (!u || (u.tenant_id && u.tenant_id !== tenantId)) {
      throw new ForbiddenException('Destino inválido: usuário de outro escritório.');
    }
  }

  async assign(id: string, userId: string, tenantId?: string): Promise<Conversation> {
    // Multi-tenant: a conversa e o destino têm de ser do escritório do usuário.
    await this.assertConversationTenant(id, tenantId);
    await this.assertSameTenantUser(userId, tenantId);
    return this.prisma.conversation.update({
      where: { id },
      data: {
        assigned_user_id: userId,
        ai_mode: false,
        ai_mode_disabled_at: new Date(),
        ai_mode_source: 'MANUAL',
      },
    });
  }

  async close(id: string): Promise<Conversation> {
    const conv = await this.prisma.conversation.update({
      where: { id },
      data: { status: 'FECHADO' },
    });
    // Broadcast: notificar sidebar sobre mudanca de status
    this.chatGateway.emitConversationsUpdate((conv as any).tenant_id ?? null);
    return conv;
  }

  async defer(id: string): Promise<Conversation> {
    const conv = await this.prisma.conversation.update({
      where: { id },
      data: { status: 'ADIADO' },
    });
    // Broadcast: remover da lista principal e mover para Adiados
    this.chatGateway.emitConversationsUpdate((conv as any).tenant_id ?? null);
    return conv;
  }

  /**
   * Adia (snooze) a conversa: cria uma TAREFA de retorno (ligada à conversa,
   * atribuída a quem adiou, com prazo) e marca a conversa como ADIADO + guarda
   * `snooze_until`. Quando o prazo vencer, o cron `reopenSnoozed` traz a conversa
   * de volta sozinha para a fila "Minhas" de quem adiou (MANTÉM o dono), no topo
   * e com um aviso de retorno que conta como NÃO-LIDA — pra ele dar sequência à
   * tarefa sem precisar caçar a conversa.
   */
  async snooze(id: string, userId: string, tenantId: string | undefined, dueAtIso: string, note?: string, title?: string) {
    if (!tenantId) throw new BadRequestException('Tenant não identificado.');
    await this.assertConversationTenant(id, tenantId);
    const conv = await this.prisma.conversation.findUnique({
      where: { id },
      select: { lead_id: true, lead: { select: { name: true, phone: true } } },
    });
    if (!conv) throw new NotFoundException('Conversa não encontrada.');
    const dueAt = new Date(dueAtIso);
    if (isNaN(dueAt.getTime())) throw new BadRequestException('Prazo inválido.');
    if (dueAt.getTime() <= Date.now()) throw new BadRequestException('O prazo precisa ser no futuro.');
    const contato = conv.lead?.name || conv.lead?.phone || 'contato';

    // 1) Tarefa da conversa (aparece como activeTask na conversa + na lista de Tarefas).
    //    Se já existe uma A_FAZER nesta conversa (RE-ADIAMENTO/reagendar), atualiza o
    //    prazo/observação/título e conta +1 adiamento — em vez de criar uma duplicata.
    const existingTask = await this.prisma.task.findFirst({
      // a tarefa A_FAZER mais recente da conversa (qualquer título — modelo unificado)
      where: { conversation_id: id, status: 'A_FAZER' },
      orderBy: { created_at: 'desc' },
      select: { id: true },
    });
    if (existingTask) {
      await this.prisma.task.update({
        where: { id: existingTask.id },
        data: {
          due_at: dueAt,
          description: note?.trim() || undefined, // só troca se veio observação nova
          title: title?.trim() || undefined, // só troca o título se veio um
          assigned_user_id: userId,
          postpone_count: { increment: 1 },
        } as any,
      });
    } else {
      await this.prisma.task.create({
        data: {
          title: title?.trim() || `Retornar conversa — ${contato}`,
          description: note?.trim() || null,
          conversation_id: id,
          lead_id: conv.lead_id,
          assigned_user_id: userId,
          created_by_id: userId,
          due_at: dueAt,
          status: 'A_FAZER',
          tenant_id: tenantId,
        },
      });
    }

    // 2) Adia a conversa (sai da fila ativa; volta sozinha no prazo via cron).
    const updated = await this.prisma.conversation.update({
      where: { id },
      data: { status: 'ADIADO', snooze_until: dueAt, assigned_user_id: userId, ai_mode: false } as any,
    });
    this.chatGateway.emitConversationsUpdate((updated as any).tenant_id ?? null);
    return { ok: true };
  }

  /**
   * A cada 2 min: reabre conversas adiadas cujo prazo já venceu. Ao reabrir,
   * MANTÉM o dono (quem adiou) → a conversa volta direto para a fila "Minhas"
   * dele, no TOPO (last_message_at=agora), com um aviso de retorno que CONTA
   * COMO NÃO-LIDA (id snooze_reopen_*, ver getUnreadCounts/markAsRead) pra ele
   * não passar batido. O update é ATÔMICO (where status=ADIADO) — só uma
   * réplica "ganha" e cria a nota, evitando duplicata sem lock distribuído.
   */
  @Cron('*/2 * * * *')
  async reopenSnoozed() {
    const now = new Date();
    const due = await (this.prisma as any).conversation.findMany({
      where: { status: 'ADIADO', snooze_until: { not: null, lte: now } },
      select: { id: true, tenant_id: true, assigned_user_id: true, lead: { select: { name: true, phone: true } } },
    });
    if (due.length === 0) return;
    for (const c of due) {
      const res = await (this.prisma as any).conversation.updateMany({
        where: { id: c.id, status: 'ADIADO' }, // atômico: só reabre se ainda ADIADO
        // MANTÉM o dono (não zera assigned_user_id) → volta pra "Minhas" de quem
        // adiou; sobe ao TOPO via last_message_at; o aviso de retorno (criado
        // abaixo) conta como não-lida pra ele notar.
        data: { status: 'ABERTO', snooze_until: null, last_message_at: new Date() },
      });
      if (res.count === 0) continue; // outra réplica já reabriu
      // Recupera a tarefa de retorno: TÍTULO + observação (p/ a mensagem) e o
      // dono (usado como fallback de atribuição abaixo).
      let taskTitle = '';
      let taskNote = '';
      let taskOwnerId: string | null = null;
      try {
        const task = await (this.prisma as any).task.findFirst({
          where: { conversation_id: c.id, status: 'A_FAZER' },
          orderBy: { created_at: 'desc' },
          select: { title: true, description: true, assigned_user_id: true },
        });
        taskTitle = (task?.title || '').trim();
        taskNote = (task?.description || '').trim();
        taskOwnerId = task?.assigned_user_id ?? null;
      } catch { /* sem tarefa → usa o texto genérico */ }

      // Dono efetivo do retorno: quem adiou (dono atual) ou, em conversa sem
      // dono (legado), o dono da tarefa de retorno.
      const ownerId: string | null = c.assigned_user_id ?? taskOwnerId;
      // Edge/legado: conversa adiada SEM dono (não criada pelo snooze() atual,
      // que sempre atribui). Sem isto ela voltaria órfã (sem dono → WAITING) e,
      // como a aba Espera foi removida, só o admin a veria. Atribui ao dono da
      // tarefa pra cair em "Minhas" de quem programou o retorno.
      if (!c.assigned_user_id && taskOwnerId) {
        await (this.prisma as any).conversation.update({
          where: { id: c.id },
          data: { assigned_user_id: taskOwnerId },
        });
      }
      const text = taskTitle
        ? `⏰ Conversa retornada — o prazo do adiamento venceu.\n📋 ${taskTitle}${taskNote ? `\n📝 ${taskNote}` : ''}`
        : '⏰ Conversa retornada — o prazo do adiamento venceu. Hora de dar sequência à tarefa.';
      try {
        const msg = await this.prisma.message.create({
          data: {
            conversation_id: c.id,
            direction: 'out',
            type: 'transfer_event',
            text,
            status: 'enviado',
            external_message_id: `snooze_reopen_${c.id}_${Date.now()}`,
          },
        });
        this.chatGateway.emitNewMessage(c.id, msg);
      } catch (e: any) {
        this.logger.warn(`[snooze] nota de retorno falhou (${c.id}): ${e?.message ?? e}`);
      }
      // Toca o SINO do dono: badge no NotificationCenter + ping + web push, com
      // copy de retorno de tarefa. Zera ao abrir a conversa (markByConversation).
      if (ownerId) {
        this.chatGateway.emitSnoozeReturnNotification(c.tenant_id ?? null, ownerId, {
          conversationId: c.id,
          contactName: c.lead?.name || c.lead?.phone || undefined,
          taskTitle: taskTitle || undefined,
        });
      }
      this.chatGateway.emitConversationsUpdate(c.tenant_id ?? null);
    }
    this.logger.log(`[snooze] ${due.length} conversa(s) adiada(s) reaberta(s).`);
  }

  async findPendingTransfers(toUserId: string) {
    const convs = await (this.prisma as any).conversation.findMany({
      where: { pending_transfer_to_id: toUserId },
      include: { lead: { select: { name: true, phone: true, profile_picture_url: true } } },
    });
    const fromUserIds = [...new Set(convs.map((c: any) => c.pending_transfer_from_id).filter(Boolean))] as string[];
    const fromUsers = fromUserIds.length > 0
      ? await this.prisma.user.findMany({ where: { id: { in: fromUserIds } }, select: { id: true, name: true } })
      : [];
    const fromUserMap: Record<string, string> = Object.fromEntries(fromUsers.map(u => [u.id, u.name]));
    return convs.map((c: any) => ({
      conversationId: c.id,
      contactName: c.lead?.name || c.lead?.phone || 'Contato',
      contactPhone: c.lead?.phone || '',
      profilePicture: c.lead?.profile_picture_url || null,
      fromUserName: fromUserMap[c.pending_transfer_from_id] || 'Operador',
      reason: c.pending_transfer_reason || null,
      audioIds: c.pending_transfer_audio_ids || [],
    }));
  }

  async requestTransfer(id: string, toUserId: string, fromUserId: string, reason: string | null, audioIds?: string[], isAdmin = false) {
    // Transação atômica: verificar ownership + atualizar em uma só operação
    const { fromUser, conv } = await this.prisma.$transaction(async (tx) => {
      const existing = await (tx as any).conversation.findUnique({
        where: { id },
        select: { assigned_user_id: true, pending_transfer_to_id: true, tenant_id: true },
      });
      if (!existing) {
        throw new NotFoundException('Conversa não encontrada.');
      }
      // Admin/super-admin transfere conversa de QUALQUER operador; operador
      // comum só as atribuídas a ele (assigned_user_id === fromUserId).
      if (!isAdmin && existing.assigned_user_id !== fromUserId) {
        throw new ForbiddenException('Você só pode transferir conversas atribuídas a você.');
      }
      if (existing.pending_transfer_to_id) {
        throw new BadRequestException('Esta conversa já possui uma transferência pendente.');
      }
      // Multi-tenant: o destino tem de ser do MESMO escritório da conversa.
      const toUser = await tx.user.findUnique({ where: { id: toUserId }, select: { tenant_id: true } });
      if (!toUser || (existing.tenant_id && toUser.tenant_id !== existing.tenant_id)) {
        throw new ForbiddenException('Destino inválido: usuário de outro escritório.');
      }

      const [fromUser, conv] = await Promise.all([
        tx.user.findUnique({ where: { id: fromUserId }, select: { name: true } }),
        (tx as any).conversation.update({
          where: { id },
          data: {
            pending_transfer_to_id: toUserId,
            pending_transfer_from_id: fromUserId,
            pending_transfer_reason: reason,
            ...(audioIds?.length ? { pending_transfer_audio_ids: audioIds } : {}),
          },
          include: { lead: { select: { name: true, phone: true } } },
        }),
      ]);

      return { fromUser, conv };
    });

    this.chatGateway.emitTransferRequest(toUserId, {
      conversationId: id,
      fromUserId,
      fromUserName: fromUser?.name || 'Operador',
      contactName: conv.lead?.name || conv.lead?.phone || 'Contato',
      reason,
      audioIds: audioIds?.length ? audioIds : undefined,
    });

    // Broadcast escopado por tenant para atualizar a lista "Aguardando você"
    this.chatGateway.emitConversationsUpdate((conv as any).tenant_id ?? null);

    return conv;
  }

  async acceptTransfer(id: string, userId: string) {
    // Transação atômica: ler estado atual + atualizar
    const { current, acceptingUser, fromUser, conv } = await this.prisma.$transaction(async (tx) => {
      const current = await (tx as any).conversation.findUnique({
        where: { id },
        select: { pending_transfer_to_id: true, pending_transfer_from_id: true, tenant_id: true, lead: { select: { name: true, phone: true } } },
      });

      if (!current?.pending_transfer_to_id || current.pending_transfer_to_id !== userId) {
        throw new ForbiddenException('Você não é o destinatário desta transferência.');
      }

      const [acceptingUser, fromUser, conv] = await Promise.all([
        tx.user.findUnique({ where: { id: userId }, select: { name: true } }),
        current.pending_transfer_from_id
          ? tx.user.findUnique({ where: { id: current.pending_transfer_from_id }, select: { name: true } })
          : null,
        (tx as any).conversation.update({
          where: { id },
          data: {
            assigned_user_id: userId,
            origin_assigned_user_id: current.pending_transfer_from_id,
            ai_mode: false,
            ai_mode_disabled_at: new Date(),
            ai_mode_source: 'MANUAL',
            pending_transfer_to_id: null,
            pending_transfer_from_id: null,
            pending_transfer_reason: null,
            pending_transfer_audio_ids: [],
          },
        }),
      ]);

      return { current, acceptingUser, fromUser, conv };
    });

    // Salvar mensagem de histórico de transferência
    const fromName = fromUser?.name || 'Operador';
    const toName = acceptingUser?.name || 'Operador';
    const transferMsg = await this.prisma.message.create({
      data: {
        conversation_id: id,
        direction: 'out',
        type: 'transfer_event',
        text: `📨 Transferido de ${fromName} para ${toName}`,
        status: 'enviado',
        external_message_id: `transfer_${Date.now()}`,
      },
    });
    this.chatGateway.emitNewMessage(id, transferMsg);

    if (current?.pending_transfer_from_id) {
      this.chatGateway.emitTransferResponse(current.pending_transfer_from_id, {
        accepted: true,
        userName: acceptingUser?.name || 'Operador',
        contactName: current.lead?.name || current.lead?.phone || 'Contato',
      });
    }
    this.chatGateway.emitConversationsUpdate(current?.tenant_id ?? null);
    return conv;
  }

  async declineTransfer(id: string, reason: string | null, userId: string) {
    // Transação atômica: ler estado + validar destinatário + limpar campos
    const current = await this.prisma.$transaction(async (tx) => {
      const current = await (tx as any).conversation.findUnique({
        where: { id },
        select: { pending_transfer_to_id: true, pending_transfer_from_id: true, tenant_id: true, lead: { select: { name: true, phone: true } } },
      });

      // Só o DESTINATÁRIO pendente pode recusar (mesma guarda do acceptTransfer) —
      // sem isto, qualquer usuário podia recusar a transferência pendente de outro.
      if (!current?.pending_transfer_to_id || current.pending_transfer_to_id !== userId) {
        throw new ForbiddenException('Você não é o destinatário desta transferência.');
      }

      await (tx as any).conversation.update({
        where: { id },
        data: {
          pending_transfer_to_id: null,
          pending_transfer_from_id: null,
          pending_transfer_reason: null,
          pending_transfer_audio_ids: [],
        },
      });

      return current;
    });

    if (current?.pending_transfer_from_id) {
      this.chatGateway.emitTransferResponse(current.pending_transfer_from_id, {
        accepted: false,
        reason,
        contactName: current.lead?.name || current.lead?.phone || 'Contato',
      });
    }
    // Atualiza a lista do remetente: limpa o banner "Aguardando aceitar" mesmo que
    // o socket transfer_response se perca (a conversa volta a ser só "Minha").
    this.chatGateway.emitConversationsUpdate((current as any)?.tenant_id ?? null);

    return { success: true };
  }

  async cancelTransfer(id: string, userId: string) {
    const conv = await (this.prisma as any).conversation.findUnique({
      where: { id },
      select: { pending_transfer_from_id: true, pending_transfer_to_id: true, tenant_id: true },
    });
    if (!conv?.pending_transfer_from_id || conv.pending_transfer_from_id !== userId) {
      throw new ForbiddenException('Só quem enviou a transferência pode cancelá-la.');
    }
    await (this.prisma as any).conversation.update({
      where: { id },
      data: {
        pending_transfer_to_id: null,
        pending_transfer_from_id: null,
        pending_transfer_reason: null,
        pending_transfer_audio_ids: [],
      },
    });
    // Notifica o destinatário para fechar o popup de transferência
    if (conv.pending_transfer_to_id) {
      this.chatGateway.emitTransferCancelled(conv.pending_transfer_to_id, { conversationId: id });
    }
    this.chatGateway.emitConversationsUpdate(conv.tenant_id ?? null);
    return { success: true };
  }

  async transferToAssignedLawyer(id: string, fromUserId: string, reason?: string, audioIds?: string[]) {
    // Transação atômica: ler + validar ownership + definir origin em uma operação
    const conv = await this.prisma.$transaction(async (tx) => {
      const existing = await (tx as any).conversation.findUnique({
        where: { id },
        select: { assigned_user_id: true, assigned_lawyer_id: true, legal_area: true },
      });

      if (!existing || existing.assigned_user_id !== fromUserId) {
        throw new ForbiddenException('Você só pode transferir conversas atribuídas a você.');
      }
      if (!existing.assigned_lawyer_id) {
        throw new BadRequestException(
          'Nenhum advogado foi vinculado a esta conversa pela IA. Aguarde a IA processar as mensagens ou faça transferência manual.',
        );
      }

      await (tx as any).conversation.update({
        where: { id },
        data: { origin_assigned_user_id: fromUserId },
      });

      return existing;
    });

    return this.requestTransfer(
      id,
      conv.assigned_lawyer_id,
      fromUserId,
      reason?.trim() || `Área detectada pela IA: ${conv.legal_area || 'Jurídica'}`,
      audioIds,
    );
  }

  async returnToOrigin(id: string, reason?: string, audioIds?: string[], returningUserId?: string) {
    // Transação atômica: ler estado + lookup user + atualizar conversa
    const { originUserId, returningUserName, contactName, tenantId } = await this.prisma.$transaction(async (tx) => {
      const conv = await (tx as any).conversation.findUnique({
        where: { id },
        select: {
          origin_assigned_user_id: true,
          assigned_user_id: true,
          tenant_id: true,
          lead: { select: { name: true, phone: true } },
        },
      });
      if (!conv?.origin_assigned_user_id) {
        throw new BadRequestException('Sem atendente de origem para devolver.');
      }

      const returningUser = returningUserId
        ? await tx.user.findUnique({ where: { id: returningUserId }, select: { name: true } })
        : null;

      const linkedIds = [...new Set([conv.assigned_user_id, conv.origin_assigned_user_id].filter(Boolean) as string[])];
      await (tx as any).conversation.update({
        where: { id },
        data: {
          assigned_user_id: conv.origin_assigned_user_id,
          origin_assigned_user_id: null,
          ai_mode: false,
          ai_mode_disabled_at: new Date(),
          ai_mode_source: 'MANUAL',
          linked_agent_ids: { push: linkedIds },
        },
      });

      return {
        originUserId: conv.origin_assigned_user_id,
        returningUserName: returningUser?.name || 'Advogado',
        contactName: conv.lead?.name || conv.lead?.phone || 'Contato',
        tenantId: conv.tenant_id as string | null,
      };
    });

    // Salvar mensagem de histórico de devolução
    const originUser = await this.prisma.user.findUnique({ where: { id: originUserId }, select: { name: true } });
    const returnMsg = await this.prisma.message.create({
      data: {
        conversation_id: id,
        direction: 'out',
        type: 'transfer_event',
        text: `↩ Devolvido de ${returningUserName} para ${originUser?.name || 'Operador'}${reason?.trim() ? ` — ${reason.trim()}` : ''}`,
        status: 'enviado',
        external_message_id: `transfer_${Date.now()}`,
      },
    });
    this.chatGateway.emitNewMessage(id, returnMsg);

    // Notificar o atendente de origem sobre a devolução com o contexto do advogado
    this.chatGateway.emitTransferReturned(originUserId, {
      conversationId: id,
      fromUserName: returningUserName,
      contactName,
      reason: reason?.trim() || null,
      audioIds: audioIds?.length ? audioIds : undefined,
    });

    this.chatGateway.emitConversationsUpdate(tenantId ?? null);
    return { success: true };
  }

  async countOpen(userId?: string): Promise<number> {
    // Mesmo notIn da query principal — inclui ENCERRADO (bug fix 2026-05-15)
    const where: any = { lead: { stage: { notIn: ['PERDIDO', 'FINALIZADO', 'ENCERRADO'] }, is_client: false } };
    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { inboxes: { select: { id: true } } },
      });
      if (!user?.roles?.includes('ADMIN') && user?.inboxes && user.inboxes.length > 0) {
        where.inbox_id = { in: user.inboxes.map((i: any) => i.id) };
      }
    }
    return this.prisma.conversation.count({ where });
  }

  async keepInInbox(id: string) {
    const conv = await (this.prisma as any).conversation.findUnique({
      where: { id },
      select: { origin_assigned_user_id: true, assigned_user_id: true, tenant_id: true },
    });

    const linkedIds = [...new Set([conv?.assigned_user_id, conv?.origin_assigned_user_id].filter(Boolean) as string[])];
    await (this.prisma as any).conversation.update({
      where: { id },
      data: {
        origin_assigned_user_id: null,
        linked_agent_ids: { push: linkedIds },
      },
    });

    this.chatGateway.emitConversationsUpdate(conv?.tenant_id ?? null);
    return { success: true };
  }

  // ── Mark as Read (envia tick azul ao contato) ───────────────────────────────

  /**
   * Retorna a contagem real de mensagens não lidas por conversa (fonte: banco de dados).
   *
   * REGRA ÚNICA (redesenho 2026-06-12, pedido do André): O CONTADOR SEGUE A
   * VISIBILIDADE — o mapa cobre toda conversa que o usuário ENXERGA na lista
   * (mesmas cláusulas do findAll, união leads+clientes):
   *  - ADMIN: todas do escritório (ele vê tudo → conta tudo)
   *  - ADVOGADO: atribuídas a ele + clientes onde é o responsável (3 cláusulas)
   *  - OPERADOR: atribuídas + clientes via cs_user_id + pool dos seus inboxes
   *  - Exclui leads PERDIDO/FINALIZADO/ENCERRADO (igual à lista)
   *
   * As 3 dimensões do chat são INDEPENDENTES e cada uma tem um dono:
   *  · VER (lista)        → findAll()                — quem enxerga a conversa
   *  · CONTAR (badges)    → getUnreadCounts/Summary  — espelho do que enxerga
   *  · NOTIFICAR (ding)   → gateway (dono / advogado do caso / pool do inbox)
   * "Quem precisa AGIR" é o chip 'A responder'/badges de fila (front).
   * IMPORTANTE: se mudar as cláusulas do findAll, replicar AQUI (e vice-versa).
   */
  async getUnreadCounts(tenantId?: string, userId?: string) {
    let conversationIds: string[] | undefined;

    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { inboxes: { select: { id: true } } },
      });

      const userRoles: string[] = Array.isArray(user?.roles)
        ? user.roles
        : [effectiveRole(user?.roles ?? 'OPERADOR')];
      const isAdvogadoUser = userRoles.includes('ADVOGADO') || userRoles.includes('Advogados');
      const isOperadorUser = userRoles.includes('OPERADOR') || userRoles.includes('COMERCIAL') || userRoles.includes('Atendente Comercial');
      const isAdminUser = userRoles.includes('ADMIN');
      const userInboxIds = (user?.inboxes ?? []).map((i: any) => i.id);

      // Filtro base: tenant + exclui leads ocultos (PERDIDO/FINALIZADO/ENCERRADO).
      // Alinhado ao HIDDEN_STAGES da lista (findAll) — sem isto, um lead ENCERRADO
      // com não-lida inflava o badge mas sumia da lista (badge ≠ conversas visíveis).
      const convWhere: any = {
        ...(tenantId ? { tenant_id: tenantId } : {}),
        lead: { stage: { notIn: ['PERDIDO', 'FINALIZADO', 'ENCERRADO'] } },
      };

      // (REDESENHO 2026-06-12, pedido do André) O CONTADOR SEGUE A VISIBILIDADE:
      // o mapa de não-lidas cobre TODA conversa que o usuário enxerga na lista
      // (mesmas regras do findAll, união leads+clientes — o front fatia por
      // aba/fila). Antes contador e lista tinham regras DIFERENTES — ex.: o
      // admin via as conversas da Sophia sem dono na aba, mas o badge contava
      // só as atribuídas a ele (a aba mostrava 18 não-lidas e o badge dizia 9).
      // "Quem precisa AGIR" não é papel deste contador: isso é o chip
      // "A responder"/badges de fila do front. Notificação sonora também não:
      // o ding tem alvo próprio no gateway (dono / advogado do caso / pool do
      // inbox) e continua igual.
      if (isAdminUser) {
        // Admin vê tudo do escritório → conta tudo (espelho do findAll).
      } else {
        const orConditions: any[] = [];

        // Conversas atribuídas diretamente (qualquer papel)
        orConditions.push({ assigned_user_id: userId });

        // ADVOGADO: clientes onde é o responsável (mesmas 3 cláusulas do findAll)
        if (isAdvogadoUser) {
          orConditions.push({ assigned_lawyer_id: userId, lead: { is_client: true } });
          orConditions.push({ lead: { is_client: true, legal_cases: { some: { lawyer_id: userId } } } });
          orConditions.push({ lead: { is_client: true, conversations: { some: { assigned_lawyer_id: userId } } } });
        }

        // OPERADOR: clientes via cs_user_id + pool dos seus inboxes (leads sem dono)
        if (isOperadorUser) {
          orConditions.push({ lead: { is_client: true, cs_user_id: userId } });
          if (userInboxIds.length > 0) {
            orConditions.push({
              inbox_id: { in: userInboxIds },
              assigned_user_id: null,
              lead: { is_client: false },
            });
          }
        }

        convWhere.OR = orConditions;
      }

      const convs = await this.prisma.conversation.findMany({
        where: convWhere,
        select: { id: true },
      });
      conversationIds = convs.map(c => c.id);
    }

    // Etapa 2: conta mensagens não lidas apenas nessas conversas.
    // Fonte de verdade: read_at IS NULL. Antes era status NOT IN ('recebido',
    // 'entregue'), fragil porque algumas msgs nao recebiam updateMany de
    // status (ex: msgs sem external_message_id eram filtradas no markAsRead
    // e ficavam para sempre como 'recebido', inflando o badge).
    const where: any = {
      read_at: null,
      // (a) mensagens do CONTATO ainda não lidas + (b) o aviso de RETORNO DE
      // ADIAMENTO (id snooze_reopen_*, direction 'out') — pro DONO notar que a
      // conversa voltou pra "Minhas". markAsRead zera os dois ao abrir. O
      // prefixo snooze_reopen_ é interno (nenhuma msg real do WhatsApp tem),
      // então não conta nenhum outro evento de sistema (ex: transferências).
      OR: [
        { direction: 'in' },
        { external_message_id: { startsWith: 'snooze_reopen_' } },
      ],
    };

    if (conversationIds !== undefined) {
      where.conversation_id = { in: conversationIds };
    } else if (tenantId) {
      // Fallback sem userId (chamadas internas/admin sem contexto de usuário)
      where.conversation = { tenant_id: tenantId };
    }

    const counts = await this.prisma.message.groupBy({
      by: ['conversation_id'],
      where,
      _count: { id: true },
    });

    const result: Record<string, number> = {};
    for (const c of counts) {
      if (c.conversation_id) {
        result[c.conversation_id] = c._count.id;
      }
    }
    return result;
  }

  /**
   * Total de MENSAGENS não-lidas agrupado por lead.is_client (badge das abas
   * Leads/Clientes — InboxSidebar legada + Jurisflow). Mostra o total de cada
   * categoria INDEPENDENTE do clientMode ativo (a lista só traz uma aba por vez;
   * o badge é global). Exclui leads ocultos (PERDIDO/FINALIZADO/ENCERRADO) via
   * getUnreadCounts — alinhado ao que a lista mostra (sem mensagem "fantasma").
   */
  async getUnreadSummary(tenantId?: string, userId?: string): Promise<{ leads: number; clients: number }> {
    const counts = await this.getUnreadCounts(tenantId, userId);
    const convIds = Object.keys(counts);
    if (convIds.length === 0) return { leads: 0, clients: 0 };

    const convs = await this.prisma.conversation.findMany({
      where: { id: { in: convIds } },
      select: { id: true, lead: { select: { is_client: true } } },
    });

    let leads = 0;
    let clients = 0;
    for (const c of convs) {
      const n = counts[c.id] || 0;
      if ((c as any).lead?.is_client) clients += n;
      else leads += n;
    }
    return { leads, clients };
  }

  async markAsRead(conversationId: string, userId?: string) {
    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { lead: true },
    });

    if (!convo || !convo.lead?.phone || !convo.instance_name) {
      // Mesmo sem phone/instance (conversa demo ou incompleta), sincroniza o sino
      if (userId) {
        await this.notificationsService.markByConversation(userId, conversationId).catch(() => {});
      }
      return { marked: 0 };
    }

    // Pega TODAS as nao lidas — inclusive as sem external_message_id (msgs
    // criadas pelo CRM, sync_history sem ID real, etc). Antes filtravamos
    // external_message_id NOT NULL e elas ficavam com read_at=null pra
    // sempre, inflando o badge da sidebar mesmo apos abrir a conversa.
    const unreadMessages = await this.prisma.message.findMany({
      where: {
        conversation_id: conversationId,
        read_at: null,
        // Mesma regra do getUnreadCounts: zera as do contato E o aviso de
        // retorno de adiamento (snooze_reopen_*), senão o badge do retorno
        // ficaria aceso pra sempre depois que ele abrisse a conversa.
        OR: [
          { direction: 'in' },
          { external_message_id: { startsWith: 'snooze_reopen_' } },
        ],
      },
      select: { id: true, external_message_id: true },
    });

    // Marca notificacoes do sino relacionadas a esta conversa como lidas —
    // sincroniza com o desaparecimento do badge da sidebar. Mesmo que nao
    // haja mensagens nao lidas (user ja havia aberto), pode haver
    // notificacoes persistidas pendentes do NotificationCenter.
    if (userId) {
      await this.notificationsService.markByConversation(userId, conversationId).catch(() => {});
    }

    if (unreadMessages.length === 0) return { marked: 0 };

    // Read receipt (visto azul) so envia pra Evolution as msgs com ID real
    // do WhatsApp — as outras nao existem no celular do cliente.
    const evolutionPayload = unreadMessages
      // exclui o aviso de retorno de adiamento: o id snooze_reopen_* é interno,
      // não existe no WhatsApp do cliente (enviar receipt daria erro na Evolution).
      .filter((m) => m.external_message_id && !m.external_message_id.startsWith('snooze_reopen_'))
      .map((m) => ({
        remoteJid: convo.external_id || `${convo.lead.phone}@s.whatsapp.net`,
        fromMe: false as const,
        id: m.external_message_id!,
      }));

    if (evolutionPayload.length > 0) {
      try {
        await this.whatsappService.markAsRead(convo.instance_name, evolutionPayload);
      } catch (e: any) {
        // Cliente nao recebe o "visto azul" mas o badge zera local porque
        // atualizamos read_at no banco mesmo assim. Log com contexto pra
        // investigar instabilidade da Evolution quando reclamarem.
        this.logger.warn(
          `[markAsRead] Evolution falhou conv=${conversationId} instance=${convo.instance_name} ` +
          `msgs=${evolutionPayload.length} status=${e?.response?.status ?? 'n/a'} ` +
          `reason=${e?.code ?? e?.message ?? 'unknown'} — read receipt NAO enviado ao cliente`,
        );
      }
    }

    await this.prisma.message.updateMany({
      where: { id: { in: unreadMessages.map((m) => m.id) } },
      data: { status: 'lido', read_at: new Date() },
    });

    // Sinaliza ao proprio user (todas as abas/dispositivos) que esta conversa
    // foi lida — frontend zera o badge sem precisar de refetch completo.
    // Outros operadores do tenant nao precisam saber: cada um ve os proprios
    // badges (filtrados por role em getUnreadCounts).
    if (userId) {
      this.chatGateway.emitConversationRead(userId, conversationId);
    } else if (convo.tenant_id) {
      // Fallback para callers internos sem userId: mantem comportamento antigo.
      this.chatGateway.emitConversationsUpdate(convo.tenant_id);
    }

    return { marked: unreadMessages.length };
  }

  // ── Send Presence (digitando / gravando) ────────────────────────────────────

  async sendPresence(conversationId: string, presence: 'composing' | 'recording' | 'paused') {
    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { lead: true },
    });

    if (!convo?.lead?.phone || !convo.instance_name) return { sent: false };

    try {
      await this.whatsappService.sendPresence(convo.instance_name, convo.lead.phone, presence);
      return { sent: true };
    } catch {
      return { sent: false };
    }
  }

  // ── Notas internas fixas ──────────────────────────────────────────────────

  async listNotes(conversationId: string, tenantId?: string) {
    if (tenantId) {
      const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { tenant_id: true } });
      if (conv?.tenant_id && conv.tenant_id !== tenantId) throw new ForbiddenException('Acesso negado');
    }
    return (this.prisma as any).conversationNote.findMany({
      where: { conversation_id: conversationId },
      orderBy: { created_at: 'asc' },
      include: { user: { select: { id: true, name: true } } },
    });
  }

  async createNote(conversationId: string, userId: string, text: string, tenantId?: string) {
    if (tenantId) {
      const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { tenant_id: true } });
      if (conv?.tenant_id && conv.tenant_id !== tenantId) throw new ForbiddenException('Acesso negado');
    }
    const note = await (this.prisma as any).conversationNote.create({
      data: { conversation_id: conversationId, user_id: userId, text },
      include: { user: { select: { id: true, name: true } } },
    });
    this.chatGateway.emitNewNote(conversationId, note);
    return note;
  }

  async updateNote(noteId: string, userId: string, text: string) {
    const note = await (this.prisma as any).conversationNote.findUnique({ where: { id: noteId } });
    if (!note) throw new NotFoundException('Nota não encontrada');
    if (note.user_id !== userId) throw new ForbiddenException('Apenas o autor pode editar esta nota');
    const updated = await (this.prisma as any).conversationNote.update({
      where: { id: noteId },
      data: { text },
      include: { user: { select: { id: true, name: true } } },
    });
    this.chatGateway.emitNoteUpdated(note.conversation_id, updated);
    return updated;
  }
}
