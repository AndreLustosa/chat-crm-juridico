import { Injectable, ForbiddenException, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { Prisma, Conversation } from '@crm/shared';
import { effectiveRole } from '../common/utils/permissions.util';

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    private prisma: PrismaService,
    private chatGateway: ChatGateway,
    private whatsappService: WhatsappService,
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
    //   - Aba Leads (clientMode=false): is_client=false, exclui FINALIZADO e PERDIDO
    //   - Aba Clientes (clientMode=true): is_client=true (todos os clientes)
    //   - Legado (clientMode=undefined): exclui apenas PERDIDO
    if (clientMode === true) {
      where.lead = { is_client: true };
    } else if (clientMode === false) {
      where.lead = { is_client: false, stage: { notIn: ['PERDIDO', 'FINALIZADO'] } };
    } else {
      where.lead = { stage: { notIn: ['PERDIDO', 'FINALIZADO'] } };
    }

    // ─── Controle de acesso por role (multi-role aware) ────────────────
    const userRoles: string[] = Array.isArray(user?.roles) ? user.roles : [userRole];
    const isAdminUser = userRoles.includes('ADMIN');
    const isAdvogadoUser = userRoles.includes('ADVOGADO');
    const isOperadorUser = userRoles.includes('OPERADOR') || userRoles.includes('COMERCIAL');

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
          orConditions.push({ assigned_lawyer_id: userId, lead: { is_client: true } });
          orConditions.push({ lead: { is_client: true, legal_cases: { some: { lawyer_id: userId } } } });
        }

        // Conversas atribuídas diretamente ao usuário (qualquer role)
        orConditions.push({ assigned_user_id: userId });

        // Visibilidade de OPERADOR: cs_user_id (clientes) + inbox membership (leads)
        if (isOperadorUser) {
          if (clientMode === true) {
            orConditions.push({ lead: { ...(where.lead ?? {}), cs_user_id: userId } });
          }
          // Inboxes vinculados — APENAS para operadores no modo leads
          if (userInboxIds.length > 0 && clientMode !== true) {
            orConditions.push({ inbox_id: { in: userInboxIds } });
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
            select: { id: true, title: true, due_at: true, status: true, assigned_user_id: true },
          },
        },
      }),
      this.prisma.conversation.count({ where }),
    ]);

    // Enrich with lawyer and origin-attendant names in a single query
    const lawyerIds = [...new Set(conversations.map((c: any) => c.assigned_lawyer_id).filter(Boolean))] as string[];
    const originIds = [...new Set(conversations.map((c: any) => c.origin_assigned_user_id).filter(Boolean))] as string[];
    const allEnrichIds = [...new Set([...lawyerIds, ...originIds])];
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
      } : null,
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
          include: { memory: { select: { facts_json: true } } },
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

  async setAssignedLawyer(id: string, lawyerId: string | null): Promise<Conversation> {
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
    return this.prisma.conversation.update({
      where: { id },
      data: {
        ai_mode,
        // Registra timestamp quando desligou; limpa quando religou
        ai_mode_disabled_at: ai_mode ? null : new Date(),
      },
    });
  }

  async assign(id: string, userId: string): Promise<Conversation> {
    return this.prisma.conversation.update({
      where: { id },
      data: { assigned_user_id: userId, ai_mode: false, ai_mode_disabled_at: new Date() },
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

  async requestTransfer(id: string, toUserId: string, fromUserId: string, reason: string | null, audioIds?: string[]) {
    // Transação atômica: verificar ownership + atualizar em uma só operação
    const { fromUser, conv } = await this.prisma.$transaction(async (tx) => {
      const existing = await (tx as any).conversation.findUnique({
        where: { id },
        select: { assigned_user_id: true, pending_transfer_to_id: true, tenant_id: true },
      });
      if (!existing || existing.assigned_user_id !== fromUserId) {
        throw new ForbiddenException('Você só pode transferir conversas atribuídas a você.');
      }
      if (existing.pending_transfer_to_id) {
        throw new BadRequestException('Esta conversa já possui uma transferência pendente.');
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

  async declineTransfer(id: string, reason: string | null) {
    // Transação atômica: ler estado + limpar campos de transferência
    const current = await this.prisma.$transaction(async (tx) => {
      const current = await (tx as any).conversation.findUnique({
        where: { id },
        select: { pending_transfer_from_id: true, lead: { select: { name: true, phone: true } } },
      });

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
    const where: any = { lead: { stage: { notIn: ['PERDIDO', 'FINALIZADO'] }, is_client: false } };
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
   * Regra de negócio (notificações — mais restritiva que visibilidade):
   *  - ADMIN: badges apenas das conversas atribuídas a ele (assigned_user_id)
   *  - ADVOGADO: badges apenas de clientes atribuídos a ele (assigned_lawyer_id)
   *  - OPERADOR: badges apenas de leads/clientes atribuídos a ele (assigned_user_id)
   *  - ADVOGADO+OPERADOR: combina ambos (clientes como advogado + leads como operador)
   *  - Exclui leads PERDIDO/FINALIZADO
   *
   * Nota: findAll() controla VISIBILIDADE (o que aparece na lista).
   *       getUnreadCounts() controla NOTIFICAÇÃO (o que mostra badge vermelho).
   *       Admin pode ver todas as conversas mas só recebe badge das suas.
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
      const isAdvogadoUser = userRoles.includes('ADVOGADO');
      const isOperadorUser = userRoles.includes('OPERADOR') || userRoles.includes('COMERCIAL');
      const isAdminUser = userRoles.includes('ADMIN');

      // Filtro base: tenant + exclui leads PERDIDO/FINALIZADO
      const convWhere: any = {
        ...(tenantId ? { tenant_id: tenantId } : {}),
        lead: { stage: { notIn: ['PERDIDO', 'FINALIZADO'] } },
      };

      const orConditions: any[] = [];

      // ADMIN: badge apenas das conversas atribuídas diretamente a ele
      if (isAdminUser) {
        orConditions.push({ assigned_user_id: userId });
        // Admin que também é advogado: clientes atribuídos como advogado
        if (isAdvogadoUser) {
          orConditions.push({ assigned_lawyer_id: userId, lead: { is_client: true } });
        }
      } else {
        // ADVOGADO: badge apenas de CLIENTES onde é advogado responsável
        if (isAdvogadoUser) {
          orConditions.push({ assigned_lawyer_id: userId, lead: { is_client: true } });
        }

        // Conversas atribuídas diretamente (qualquer role)
        orConditions.push({ assigned_user_id: userId });
      }

      // Fallback (estagiário puro, financeiro)
      if (orConditions.length === 0) {
        orConditions.push({ assigned_user_id: userId });
      }

      convWhere.OR = orConditions;

      const convs = await this.prisma.conversation.findMany({
        where: convWhere,
        select: { id: true },
      });
      conversationIds = convs.map(c => c.id);
    }

    // Etapa 2: conta mensagens não lidas apenas nessas conversas
    const where: any = {
      direction: 'in',
      status: { in: ['recebido', 'entregue'] },
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

  async markAsRead(conversationId: string) {
    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { lead: true },
    });

    if (!convo || !convo.lead?.phone || !convo.instance_name) {
      return { marked: 0 };
    }

    const unreadMessages = await this.prisma.message.findMany({
      where: {
        conversation_id: conversationId,
        direction: 'in',
        status: { in: ['recebido', 'entregue'] },
        external_message_id: { not: null },
      },
      select: { id: true, external_message_id: true },
    });

    if (unreadMessages.length === 0) return { marked: 0 };

    const remoteJid = convo.external_id || `${convo.lead.phone}@s.whatsapp.net`;
    const readPayload = unreadMessages.map((m) => ({
      remoteJid,
      fromMe: false as const,
      id: m.external_message_id!,
    }));

    try {
      await this.whatsappService.markAsRead(convo.instance_name, readPayload);
    } catch (e) {
      this.logger.warn(`Falha ao enviar markAsRead via Evolution: ${e?.message}`);
    }

    await this.prisma.message.updateMany({
      where: { id: { in: unreadMessages.map((m) => m.id) } },
      data: { status: 'lido' },
    });

    // Emitir atualização para todos os clientes conectados (limpar badge de não-lidas)
    if (convo.tenant_id) {
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
