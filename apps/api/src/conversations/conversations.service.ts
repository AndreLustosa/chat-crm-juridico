import { Injectable, ForbiddenException, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { Prisma, Conversation } from '@crm/shared';

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

  async findAll(status?: string, userId?: string, inboxId?: string, tenantId?: string) {
    const where: any = {};
    if (status) {
      where.status = status;
    } else {
      // Por padrão excluir conversas fechadas do inbox
      where.status = { not: 'FECHADO' };
    }

    // Tenant isolation
    if (tenantId) {
      where.OR = [{ tenant_id: tenantId }, { tenant_id: null }];
    }

    // Se um inboxId específico foi solicitado, filtramos por ele
    if (inboxId) {
      where.inbox_id = inboxId;
    }
    // Caso contrário, se o userId estiver presente, filtramos pelos inboxes que o usuário tem acesso
    else if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { inboxes: { select: { id: true } } }
      });

      // Se o usuário não for ADMIN e tiver inboxes vinculados, filtramos por eles
      if (user?.role !== 'ADMIN' && user?.inboxes && user.inboxes.length > 0) {
        where.inbox_id = { in: user.inboxes.map((i: any) => i.id) };
      }
    }

    const [conversations, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where,
        orderBy: { last_message_at: 'desc' },
        include: {
          lead: { select: { id: true, name: true, phone: true, email: true, stage: true, profile_picture_url: true } },
          messages: { orderBy: { created_at: 'desc' }, take: 1, include: { media: true } },
          assigned_user: { select: { id: true, name: true } },
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

    const data = conversations.map((c) => ({
      id: c.id,
      leadId: c.lead_id,
      inboxId: (c as any).inbox_id || null,
      contactName: c.lead?.name || c.lead?.phone || 'Desconhecido',
      contactPhone: c.lead?.phone || '',
      contactEmail: c.lead?.email || '',
      channel: c.channel?.toUpperCase() || 'WHATSAPP',
      status: c.status === 'FECHADO' ? 'CLOSED'
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
        lead: { select: { id: true, name: true, phone: true, email: true, profile_picture_url: true } },
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
    return this.prisma.conversation.update({
      where: { id },
      data: { assigned_lawyer_id: lawyerId } as any,
    });
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
      data: { ai_mode },
    });
  }

  async assign(id: string, userId: string): Promise<Conversation> {
    return this.prisma.conversation.update({
      where: { id },
      data: { assigned_user_id: userId, ai_mode: false },
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
        select: { assigned_user_id: true, pending_transfer_to_id: true },
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

    // Broadcast para todos os clientes: garante que o destino atualize
    // a lista "Aguardando você" mesmo se o evento direto for perdido
    this.chatGateway.emitConversationsUpdate(null);

    return conv;
  }

  async acceptTransfer(id: string, userId: string) {
    // Transação atômica: ler estado atual + atualizar
    const { current, acceptingUser, conv } = await this.prisma.$transaction(async (tx) => {
      const current = await (tx as any).conversation.findUnique({
        where: { id },
        select: { pending_transfer_to_id: true, pending_transfer_from_id: true, lead: { select: { name: true, phone: true } } },
      });

      if (!current?.pending_transfer_to_id || current.pending_transfer_to_id !== userId) {
        throw new ForbiddenException('Você não é o destinatário desta transferência.');
      }

      const [acceptingUser, conv] = await Promise.all([
        tx.user.findUnique({ where: { id: userId }, select: { name: true } }),
        (tx as any).conversation.update({
          where: { id },
          data: {
            assigned_user_id: userId,
            ai_mode: false,
            pending_transfer_to_id: null,
            pending_transfer_from_id: null,
            pending_transfer_reason: null,
            pending_transfer_audio_ids: [],
          },
        }),
      ]);

      return { current, acceptingUser, conv };
    });

    if (current?.pending_transfer_from_id) {
      this.chatGateway.emitTransferResponse(current.pending_transfer_from_id, {
        accepted: true,
        userName: acceptingUser?.name || 'Operador',
        contactName: current.lead?.name || current.lead?.phone || 'Contato',
      });
    }
    this.chatGateway.emitConversationsUpdate(null);
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
    const { originUserId, returningUserName, contactName } = await this.prisma.$transaction(async (tx) => {
      const conv = await (tx as any).conversation.findUnique({
        where: { id },
        select: {
          origin_assigned_user_id: true,
          assigned_user_id: true,
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
          linked_agent_ids: { push: linkedIds },
        },
      });

      return {
        originUserId: conv.origin_assigned_user_id,
        returningUserName: returningUser?.name || 'Advogado',
        contactName: conv.lead?.name || conv.lead?.phone || 'Contato',
      };
    });

    // Notificar o atendente de origem sobre a devolução com o contexto do advogado
    this.chatGateway.emitTransferReturned(originUserId, {
      conversationId: id,
      fromUserName: returningUserName,
      contactName,
      reason: reason?.trim() || null,
      audioIds: audioIds?.length ? audioIds : undefined,
    });

    this.chatGateway.emitConversationsUpdate(null);
    return { success: true };
  }

  async countOpen(userId?: string): Promise<number> {
    const where: any = { status: { not: 'FECHADO' } };
    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { inboxes: { select: { id: true } } },
      });
      if (user?.role !== 'ADMIN' && user?.inboxes && user.inboxes.length > 0) {
        where.inbox_id = { in: user.inboxes.map((i: any) => i.id) };
      }
    }
    return this.prisma.conversation.count({ where });
  }

  async keepInInbox(id: string) {
    const conv = await (this.prisma as any).conversation.findUnique({
      where: { id },
      select: { origin_assigned_user_id: true, assigned_user_id: true },
    });

    const linkedIds = [...new Set([conv?.assigned_user_id, conv?.origin_assigned_user_id].filter(Boolean) as string[])];
    await (this.prisma as any).conversation.update({
      where: { id },
      data: {
        origin_assigned_user_id: null,
        linked_agent_ids: { push: linkedIds },
      },
    });

    this.chatGateway.emitConversationsUpdate(null);
    return { success: true };
  }

  // ── Mark as Read (envia tick azul ao contato) ───────────────────────────────

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
}
