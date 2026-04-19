import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { InboxesService } from '../inboxes/inboxes.service';
import { NotificationSettingsService, type NotifEventType } from '../notification-settings/notification-settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PushService } from '../push/push.service';

@Injectable()
export class ChatGateway {
  server: Server;

  private logger = new Logger('ChatGateway');

  // ─── Presença de usuários online ─────────────────────────────────
  // Map<userId, Set<socketId>> — um usuário pode ter múltiplas abas
  private onlineUsers = new Map<string, Set<string>>();

  // ─── Debounce para inboxUpdate ───────────────────────────────────
  // Evita flood de emissões quando muitos contacts.update chegam em sequência
  private inboxUpdateTimers = new Map<string, NodeJS.Timeout>();
  private readonly INBOX_UPDATE_DEBOUNCE_MS = 2000; // 2 segundos

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => InboxesService))
    private inboxesService: InboxesService,
    private notifSettings: NotificationSettingsService,
    private notificationsService: NotificationsService,
    private pushService: PushService,
  ) {}

  handleConnection(client: Socket) {
    const transport = client.conn?.transport?.name ?? 'unknown';
    const recovered = (client as any).recovered ? ' (recovered)' : '';
    this.logger.log(`[SOCKET] Client connected: ${client.id} transport=${transport}${recovered}`);
    // Observa upgrades polling→websocket (ajuda a diagnosticar quando o
    // cliente nao consegue subir pra WS e fica preso em long-polling).
    client.conn?.on('upgrade', (t: any) => {
      this.logger.log(`[SOCKET] Transport upgrade: ${client.id} → ${t?.name ?? 'unknown'}`);
    });
    const socketUser = client.data.user;
    if (socketUser?.sub) {
      this.trackUserOnline(socketUser.sub, client.id);
    }
  }

  handleDisconnect(client: Socket, reason?: string) {
    const transport = client.conn?.transport?.name ?? 'unknown';
    this.logger.log(`[SOCKET] Client disconnected: ${client.id} reason="${reason ?? 'unknown'}" transport=${transport}`);
    const socketUser = client.data.user;
    if (socketUser?.sub) {
      this.trackUserOffline(socketUser.sub, client.id);
    }
  }

  private trackUserOnline(userId: string, socketId: string) {
    if (!this.onlineUsers.has(userId)) {
      this.onlineUsers.set(userId, new Set());
    }
    const wasOffline = this.onlineUsers.get(userId)!.size === 0;
    this.onlineUsers.get(userId)!.add(socketId);
    if (wasOffline) {
      // Broadcast: usuário ficou online
      this.server?.emit('user_presence', { userId, online: true });
      this.logger.log(`[PRESENCE] User ${userId} ONLINE (${this.onlineUsers.get(userId)!.size} tab(s))`);
      // Atribuir conversas pendentes que a IA estava atendendo (fire-and-forget)
      this.assignPendingConversations(userId).catch(e =>
        this.logger.warn(`[PRESENCE] Falha ao atribuir pendentes para ${userId}: ${e.message}`),
      );
    }
  }

  /**
   * Quando um operador fica online, atribui conversas sem operador dos inboxes dele
   * usando round-robin entre TODOS os operadores online (não só o que acabou de entrar).
   */
  private async assignPendingConversations(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { inboxes: { select: { id: true } } },
    });
    if (!user?.inboxes?.length) return;

    const inboxIds = user.inboxes.map((i: any) => i.id);

    // Busca conversas sem operador nos inboxes desse user
    const pending = await this.prisma.conversation.findMany({
      where: {
        assigned_user_id: null,
        inbox_id: { in: inboxIds },
        status: { notIn: ['FECHADO'] },
        lead: { stage: { notIn: ['PERDIDO', 'FINALIZADO'] } },
      },
      select: { id: true, tenant_id: true, inbox_id: true },
      orderBy: { last_message_at: 'asc' }, // Mais antiga primeiro
    });

    if (pending.length === 0) return;

    this.logger.log(`[PRESENCE] User ${userId} online — distribuindo ${pending.length} conversa(s) pendente(s) via round-robin`);

    const onlineUserIds = this.getOnlineUserIds();

    for (const conv of pending) {
      // Round-robin por inbox — distribui entre todos os operadores online
      const assigneeId = conv.inbox_id
        ? await this.inboxesService.getNextAssignee(conv.inbox_id, onlineUserIds)
        : userId; // Sem inbox → atribui ao que entrou

      if (assigneeId) {
        await this.prisma.conversation.update({
          where: { id: conv.id },
          data: { assigned_user_id: assigneeId },
        });
        this.logger.log(`[AUTO-ASSIGN] Conversa pendente ${conv.id} → operador online ${assigneeId}`);
      }
    }

    // Refresh sidebar de todos
    if (pending[0]?.tenant_id) {
      this.emitConversationsUpdate(pending[0].tenant_id);
    }
  }

  private trackUserOffline(userId: string, socketId: string) {
    const sockets = this.onlineUsers.get(userId);
    if (sockets) {
      sockets.delete(socketId);
      if (sockets.size === 0) {
        this.onlineUsers.delete(userId);
        // Broadcast: usuário ficou offline
        this.server?.emit('user_presence', { userId, online: false });
        this.logger.log(`[PRESENCE] User ${userId} OFFLINE`);
      }
    }
  }

  /** Retorna lista de userIds online */
  getOnlineUserIds(): string[] {
    return Array.from(this.onlineUsers.keys());
  }

  /** Verifica se um usuário específico está online */
  isUserOnline(userId: string): boolean {
    return (this.onlineUsers.get(userId)?.size ?? 0) > 0;
  }

  /**
   * Ao conectar, o socket entra em rooms de escopo de notificacao:
   *   - inbox:{id}       → conversas pool daquele setor (membros do inbox + ADMINs)
   *   - operators:{tenantId} → novo lead sem inbox (ADMIN + OPERADOR/COMERCIAL;
   *                            ADVOGADO puro nao entra, evitando ding de lead
   *                            que ele nao vai atender)
   *
   * Regra:
   *  - OPERADOR/COMERCIAL: joina seus inboxes + operators room
   *  - ADVOGADO puro: nenhuma inbox, nenhum operators room (so user:{id})
   *  - ADMIN: joina TODOS inboxes do tenant + operators room (ve tudo)
   */
  async autoJoinRooms(userId: string, tenantId: string | null | undefined, client: Socket): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { inboxes: { select: { id: true } } },
      });
      if (!user) return;

      const userRoles: string[] = Array.isArray(user.roles)
        ? (user.roles as string[])
        : (user.roles ? [user.roles as string] : []);
      const isAdmin = userRoles.includes('ADMIN');
      const isOperador =
        userRoles.includes('OPERADOR') ||
        userRoles.includes('COMERCIAL') ||
        userRoles.includes('Atendente Comercial');

      // Inbox rooms
      let inboxIds: string[];
      if (isAdmin && tenantId) {
        const all = await this.prisma.inbox.findMany({
          where: { tenant_id: tenantId },
          select: { id: true },
        });
        inboxIds = all.map(i => i.id);
      } else {
        inboxIds = (user.inboxes || []).map((i: any) => i.id);
      }
      for (const id of inboxIds) {
        client.join(`inbox:${id}`);
      }

      // Operators room (pool de leads sem inbox — formulario web, criacao manual via CRM)
      const joinOperators = !!tenantId && (isAdmin || isOperador);
      if (joinOperators) {
        client.join(`operators:${tenantId}`);
      }

      this.logger.log(
        `[SOCKET] ${client.id} rooms: ${inboxIds.length} inbox(es), operators=${joinOperators} (admin=${isAdmin}, operador=${isOperador})`,
      );
    } catch (e: any) {
      this.logger.warn(`[SOCKET] autoJoinRooms falhou para user ${userId}: ${e.message}`);
    }
  }

  async handleJoinConversation(conversationId: string, client: Socket) {
    const socketUser = client.data.user;
    if (!socketUser?.sub) {
      this.logger.warn(`[SOCKET] BLOQUEADO: join_conversation sem user no socket`);
      return;
    }

    // Admin pode entrar em qualquer sala
    const userRoles = Array.isArray(socketUser.roles) ? socketUser.roles : (socketUser.role ? [socketUser.role] : []);
    if (userRoles.includes('ADMIN')) {
      client.join(conversationId);
      this.logger.log(`[SOCKET] Client ${client.id} (ADMIN) joined room: ${conversationId}`);
      this.server.to(client.id).emit('joined_room', { room: conversationId });
      return;
    }

    // Verificar se a conversa existe
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { inbox_id: true, assigned_user_id: true, assigned_lawyer_id: true },
    });

    if (!conversation) {
      this.logger.warn(`[SOCKET] BLOQUEADO: conversa ${conversationId} nao encontrada`);
      return;
    }

    // Verificar: usuario esta atribuido OU pertence ao inbox da conversa
    const user = await this.prisma.user.findUnique({
      where: { id: socketUser.sub },
      select: { inboxes: { select: { id: true } } },
    });

    const userInboxIds = (user?.inboxes || []).map((i: any) => i.id);
    const hasAccess =
      conversation.assigned_user_id === socketUser.sub ||
      conversation.assigned_lawyer_id === socketUser.sub ||
      ((conversation as any).inbox_id && userInboxIds.includes((conversation as any).inbox_id));

    if (!hasAccess) {
      this.logger.warn(`[SOCKET] BLOQUEADO: user ${socketUser.sub} sem acesso a conversa ${conversationId}`);
      return;
    }

    client.join(conversationId);
    this.logger.log(`[SOCKET] Client ${client.id} joined room: ${conversationId}`);
    this.server.to(client.id).emit('joined_room', { room: conversationId });
  }

  handleLeaveConversation(conversationId: string, client: Socket) {
    client.leave(conversationId);
    this.logger.log(`[SOCKET] Client ${client.id} left room: ${conversationId}`);
  }

  handleJoinUser(userId: string, client: Socket) {
    const socketUser = client.data.user;
    // So permite entrar na propria sala
    if (socketUser?.sub !== userId) {
      this.logger.warn(`[SOCKET] BLOQUEADO: Client ${client.id} tentou entrar em user:${userId} (user real: ${socketUser?.sub})`);
      return;
    }
    client.join(`user:${userId}`);
    this.logger.log(`[SOCKET] Client ${client.id} joined user room: user:${userId}`);
  }

  async emitTransferRequest(toUserId: string, data: any) {
    const prefs = await this.notifSettings.getNotifFlags(toUserId, 'transfer_request').catch(() => ({ skipSound: false, skipDesktop: false }));
    this.logger.log(`[SOCKET] Emitting transfer_request to user:${toUserId}`);
    this.server.to(`user:${toUserId}`).emit('transfer_request', { ...data, _prefs: prefs });
  }

  emitTransferResponse(fromUserId: string, data: any) {
    this.logger.log(`[SOCKET] Emitting transfer_response to user:${fromUserId}`);
    this.server.to(`user:${fromUserId}`).emit('transfer_response', data);
  }

  emitTransferCancelled(toUserId: string, data: { conversationId: string }) {
    this.logger.log(`[SOCKET] Emitting transfer_cancelled to user:${toUserId}`);
    this.server.to(`user:${toUserId}`).emit('transfer_cancelled', data);
  }

  emitTransferReturned(toUserId: string, data: any) {
    this.logger.log(`[SOCKET] Emitting transfer_returned to user:${toUserId}`);
    this.server.to(`user:${toUserId}`).emit('transfer_returned', data);
  }

  emitNewMessage(conversationId: string, message: any) {
    this.logger.log(`[SOCKET] Emitting newMessage to room ${conversationId}`);
    this.server.to(conversationId).emit('newMessage', message);
  }

  emitNewNote(conversationId: string, note: any) {
    this.logger.log(`[SOCKET] Emitting newNote to room ${conversationId}`);
    this.server.to(conversationId).emit('newNote', note);
  }

  emitNoteUpdated(conversationId: string, note: any) {
    this.logger.log(`[SOCKET] Emitting noteUpdated to room ${conversationId}`);
    this.server.to(conversationId).emit('noteUpdated', note);
  }

  emitMessageUpdate(conversationId: string, message: any) {
    this.logger.log(`[SOCKET] Emitting messageUpdate to room ${conversationId}`);
    this.server.to(conversationId).emit('messageUpdate', message);
  }

  /**
   * Sinaliza ao user (em todas as abas/dispositivos) que uma conversa foi
   * marcada como lida — permite frontend zerar o badge daquela conversa sem
   * disparar refetch completo via inboxUpdate. Evita overhead de atualizar
   * toda a lista do tenant por conta de uma leitura individual.
   */
  emitConversationRead(userId: string, conversationId: string) {
    this.logger.log(`[SOCKET] Emitting conversation_read to user:${userId} for conv ${conversationId}`);
    this.server.to(`user:${userId}`).emit('conversation_read', { conversationId });
  }

  /**
   * Emite inboxUpdate com debounce para evitar flood.
   * Múltiplas chamadas dentro de 2s resultam em UMA única emissão.
   * Use immediate=true para emitir instantaneamente (ex: nova mensagem).
   */
  emitConversationsUpdate(tenantId: string | null, immediate = false) {
    const resolveAndEmit = (resolvedTenantId: string) => {
      if (immediate) {
        // Emissão imediata — mensagens novas não podem esperar
        this.logger.log(`[SOCKET] Emitting inboxUpdate to tenant:${resolvedTenantId}`);
        this.server.to(`tenant:${resolvedTenantId}`).emit('inboxUpdate');
        return;
      }

      // Debounce — múltiplas chamadas em sequência rápida consolidam em 1
      const key = resolvedTenantId;
      const existing = this.inboxUpdateTimers.get(key);
      if (existing) {
        clearTimeout(existing);
      }
      const timer = setTimeout(() => {
        this.inboxUpdateTimers.delete(key);
        this.logger.log(`[SOCKET] Emitting inboxUpdate (debounced) to tenant:${resolvedTenantId}`);
        this.server.to(`tenant:${resolvedTenantId}`).emit('inboxUpdate');
      }, this.INBOX_UPDATE_DEBOUNCE_MS);
      this.inboxUpdateTimers.set(key, timer);
    };

    if (tenantId) {
      resolveAndEmit(tenantId);
    } else {
      // SEGURANCA: sem tenantId, busca o tenant padrao em vez de broadcast global.
      this.logger.warn(`[SOCKET] inboxUpdate sem tenantId — resolvendo tenant padrao`);
      this.prisma.tenant.findFirst().then((t) => {
        if (t) resolveAndEmit(t.id);
      }).catch(() => {});
    }
  }

  /**
   * Emit incoming message notification.
   *
   * Regra de negócio:
   *  - Lead com operador atribuído   → notifica SOMENTE o operador (assigned_user_id)
   *  - Cliente com operador atribuído → notifica operador E advogado (assigned_lawyer_id), se distintos
   *  - Sem operador atribuído + inboxId → notifica apenas operadores daquele setor (room inbox:{id})
   *  - Sem operador e sem inbox (legado) → fallback tenant (como antes)
   */
  async emitIncomingMessageNotification(
    tenantId: string | null,
    inboxId: string | null,
    assignedUserId: string | null,
    data: { conversationId: string; contactName?: string },
    assignedLawyerId?: string | null,
    isClient?: boolean,
  ) {
    const basePayload = { ...data, assignedUserId };

    if (assignedUserId) {
      // Checa mute da conversa para o operador
      const isMuted = await this.notificationsService.isConversationMuted(assignedUserId, data.conversationId).catch(() => false);
      const prefs = isMuted
        ? { skipSound: true, skipDesktop: true }
        : await this.notifSettings.getNotifFlags(assignedUserId, 'incoming_message').catch(() => ({ skipSound: false, skipDesktop: false }));
      const payload = { ...basePayload, _prefs: prefs };

      this.logger.log(`[SOCKET] incoming_message_notification → user:${assignedUserId} (sound=${!prefs.skipSound}, desktop=${!prefs.skipDesktop}${isMuted ? ', MUTED' : ''})`);
      this.server.to(`user:${assignedUserId}`).emit('incoming_message_notification', payload);

      // Persiste no histórico de notificações (fire-and-forget)
      this.notificationsService.create({
        userId: assignedUserId,
        tenantId,
        type: 'incoming_message',
        title: data.contactName || 'Nova mensagem',
        body: 'Nova mensagem recebida',
        data: { conversationId: data.conversationId },
      }).catch(() => {});

      // Web Push (fire-and-forget) — notifica mesmo com aba fechada
      if (!isMuted) {
        this.pushService.sendToUser(assignedUserId, {
          title: data.contactName || 'Nova mensagem',
          body: 'Nova mensagem recebida',
          tag: `msg-${data.conversationId}`,
          url: `/atendimento`,
          data: { conversationId: data.conversationId },
        }).catch(() => {});
      }

      // Para clientes: notifica também o advogado responsável (se diferente do operador)
      if (isClient && assignedLawyerId && assignedLawyerId !== assignedUserId) {
        const lawyerMuted = await this.notificationsService.isConversationMuted(assignedLawyerId, data.conversationId).catch(() => false);
        const lawyerPrefs = lawyerMuted
          ? { skipSound: true, skipDesktop: true }
          : await this.notifSettings.getNotifFlags(assignedLawyerId, 'incoming_message').catch(() => ({ skipSound: false, skipDesktop: false }));
        const lawyerPayload = { ...basePayload, _prefs: lawyerPrefs };
        this.logger.log(`[SOCKET] incoming_message_notification → lawyer:${assignedLawyerId} (cliente)`);
        this.server.to(`user:${assignedLawyerId}`).emit('incoming_message_notification', lawyerPayload);

        this.notificationsService.create({
          userId: assignedLawyerId,
          tenantId,
          type: 'incoming_message',
          title: data.contactName || 'Nova mensagem',
          body: 'Nova mensagem de cliente',
          data: { conversationId: data.conversationId },
        }).catch(() => {});
      }
    } else if (inboxId) {
      // Sem operador: isola o pool aos operadores daquele setor (room inbox:{id}).
      // ADMINs fazem auto-join em todos os inboxes do tenant, entao continuam vendo.
      this.logger.log(`[SOCKET] incoming_message_notification → inbox:${inboxId} (pool do setor)`);
      this.server.to(`inbox:${inboxId}`).emit('incoming_message_notification', basePayload);
    } else if (tenantId) {
      // Conversa legada sem inbox_id: fallback para tenant (comportamento antigo).
      this.logger.log(`[SOCKET] incoming_message_notification → tenant:${tenantId} (sem inbox, fallback)`);
      this.server.to(`tenant:${tenantId}`).emit('incoming_message_notification', basePayload);
    } else {
      this.prisma.tenant.findFirst().then((t) => {
        if (t) {
          this.server.to(`tenant:${t.id}`).emit('incoming_message_notification', basePayload);
        }
      }).catch(() => {});
    }
  }

  // ─── Legal Cases ────────────────────────────────────────────────

  emitLegalCaseUpdate(lawyerId: string, data: { caseId: string; action: string; [key: string]: any }) {
    this.logger.log(`[SOCKET] Emitting legal_case_update to user:${lawyerId}`);
    this.server.to(`user:${lawyerId}`).emit('legal_case_update', data);
  }

  emitNewLegalCase(lawyerId: string, data: { caseId: string; leadName: string }) {
    this.logger.log(`[SOCKET] Emitting new_legal_case to user:${lawyerId}`);
    this.server.to(`user:${lawyerId}`).emit('new_legal_case', data);
  }

  /**
   * Emit new lead notification.
   *
   * Regra de negócio:
   *  - Lead com atendente vinculado (cs_user_id) → notifica SOMENTE o atendente
   *  - Lead sem atendente                        → broadcast ao tenant (alguém precisa assumir)
   *
   * Dispara socket + persistência + Web Push (respeita mute/preferências).
   */
  async emitNewLeadNotification(
    tenantId: string | null,
    assignedUserId: string | null,
    inboxId: string | null,
    data: { leadId: string; leadName?: string | null; phone?: string | null; origin?: string | null },
  ) {
    const contactName = data.leadName || data.phone || 'Novo lead';
    const title = 'Novo lead';
    const body = data.origin
      ? `${contactName} chegou via ${data.origin}`
      : `${contactName} acabou de chegar`;
    const basePayload = { ...data, assignedUserId };

    if (assignedUserId) {
      const prefs = await this.notifSettings
        .getNotifFlags(assignedUserId, 'new_lead' as NotifEventType)
        .catch(() => ({ skipSound: false, skipDesktop: false }));
      const payload = { ...basePayload, _prefs: prefs };

      this.logger.log(`[SOCKET] new_lead_notification → user:${assignedUserId} (sound=${!prefs.skipSound}, desktop=${!prefs.skipDesktop})`);
      this.server.to(`user:${assignedUserId}`).emit('new_lead_notification', payload);

      this.notificationsService.create({
        userId: assignedUserId,
        tenantId,
        type: 'new_lead',
        title,
        body,
        data: { leadId: data.leadId },
      }).catch(() => {});

      this.pushService.sendToUser(assignedUserId, {
        title,
        body,
        tag: `new-lead-${data.leadId}`,
        url: `/atendimento/crm`,
        data: { leadId: data.leadId },
      }).catch(() => {});
      return;
    }

    // Sem atendente: prioridade inbox (pool do setor) → operators (fallback
    // sem inbox — lead via formulario, API externa, criacao manual). Nunca
    // tenant: advogados puros nao devem receber ding de lead novo.
    const emitTo = (room: string) => {
      this.logger.log(`[SOCKET] new_lead_notification → ${room}`);
      this.server.to(room).emit('new_lead_notification', basePayload);
    };

    if (inboxId) {
      emitTo(`inbox:${inboxId}`);
    } else if (tenantId) {
      emitTo(`operators:${tenantId}`);
    } else {
      this.prisma.tenant.findFirst().then((t) => {
        if (t) emitTo(`operators:${t.id}`);
      }).catch(() => {});
    }
  }

  emitTaskComment(userId: string, data: { taskId: string; text: string; fromUserName: string }) {
    this.logger.log(`[SOCKET] Emitting task_comment to user:${userId}`);
    this.server.to(`user:${userId}`).emit('task_comment', data);
  }

  // ─── Calendar ──────────────────────────────────────────────────

  emitCalendarUpdate(userId: string, data: { eventId: string; action: string; [key: string]: any }) {
    this.logger.log(`[SOCKET] Emitting calendar_update to user:${userId}`);
    this.server.to(`user:${userId}`).emit('calendar_update', data);
  }

  async emitCalendarReminder(userId: string, data: { eventId: string; title: string; type: string; start_at: string; minutesBefore: number }) {
    const prefs = await this.notifSettings.getNotifFlags(userId, 'calendar_reminder').catch(() => ({ skipSound: false, skipDesktop: false }));
    this.logger.log(`[SOCKET] Emitting calendar_reminder to user:${userId} — ${data.title} em ${data.minutesBefore}min`);
    this.server.to(`user:${userId}`).emit('calendar_reminder', { ...data, _prefs: prefs });
  }

  // ─── Reactions ──────────────────────────────────────────────

  emitMessageReaction(conversationId: string, data: { messageId: string; reactions: any[] }) {
    this.logger.log(`[SOCKET] Emitting messageReaction to room ${conversationId}`);
    this.server.to(conversationId).emit('messageReaction', data);
  }

  // ─── Typing Indicator ────────────────────────────────────────

  emitTypingIndicator(conversationId: string, data: { userId: string; userName: string; isTyping: boolean }) {
    this.server.to(conversationId).emit('typing_indicator', data);
  }

  // ─── Connection Status ──────────────────────────────────────

  emitConnectionStatusUpdate(data: { instanceName: string; state: string; statusReason?: number }) {
    this.logger.log(`[SOCKET] Emitting connection_status_update: ${data.instanceName} → ${data.state}`);
    this.server.emit('connection_status_update', data);
  }

  // ─── Contact Presence ──────────────────────────────────────

  emitContactPresence(conversationId: string, data: { presence: string; lastSeen?: string }) {
    this.server.to(conversationId).emit('contact_presence', data);
  }

  // ─── Messages Sync ────────────────────────────────────────
  // Emitido após importar mensagens perdidas do WhatsApp para a sala da conversa.
  // O frontend usa para saber que deve recarregar o histórico.
  emitMessagesSynced(conversationId: string, imported: number) {
    this.logger.log(`[SOCKET] Emitting messages_synced to room ${conversationId}: ${imported} imported`);
    this.server.to(conversationId).emit('messages_synced', { conversationId, imported });
  }

  // ─── Petitions ─────────────────────────────────────────────

  emitPetitionStatusChange(userId: string, data: {
    petitionId: string;
    title: string;
    status: string;
    previousStatus: string;
    action?: string;
    reviewNotes?: string;
    caseId?: string;
  }) {
    this.logger.log(`[SOCKET] Emitting petition_status_change to user:${userId} — ${data.title} → ${data.status}`);
    this.server.to(`user:${userId}`).emit('petition_status_change', data);
  }

  emitPetitionCreated(userId: string, data: {
    petitionId: string;
    title: string;
    type: string;
    caseId: string;
    createdBy: string;
  }) {
    this.logger.log(`[SOCKET] Emitting petition_created to user:${userId} — ${data.title}`);
    this.server.to(`user:${userId}`).emit('petition_created', data);
  }
}
