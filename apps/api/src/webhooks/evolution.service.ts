import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ChatGateway } from '../gateway/chat.gateway';
import { LeadsService } from '../leads/leads.service';
import { InboxesService } from '../inboxes/inboxes.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

interface EvolutionWebhookPayload {
  event: string;
  instanceId: string;
  instance?: string;
  data: any;
}

/**
 * Extrai o melhor número de telefone de dois JIDs do Evolution API.
 *
 * O WhatsApp Multi-Device pode enviar LIDs (Linked Device Identifiers)
 * como JID primário em alguns eventos. LIDs são números com 14+ dígitos
 * (ex: "237791032135755") e NÃO são números de telefone reais.
 * Números de telefone reais têm ≤13 dígitos (ex: "558291420467" = 55+DDD+número).
 *
 * Esta função sempre prefere o JID que parece um número de telefone real.
 */
function extractPhone(remoteJid: string, remoteJidAlt?: string): string {
  const p1 = (remoteJid || '').split('@')[0];
  const p2 = (remoteJidAlt || '').split('@')[0];

  // Heurística: telefones reais têm no máximo 13 dígitos (DDI+DDD+número)
  // LIDs do WhatsApp geralmente têm 14+ dígitos
  const looksLikePhone = (p: string) => p.length > 0 && p.length <= 13;

  if (!p2) return p1;
  if (looksLikePhone(p2) && !looksLikePhone(p1)) return p2; // p1 é LID, p2 é telefone
  if (!looksLikePhone(p2) && looksLikePhone(p1)) return p1; // p2 é LID, p1 é telefone
  return p2 || p1; // Ambos parecem telefone (ou ambos LID) → mantém comportamento original
}

@Injectable()
export class EvolutionService {
  private readonly logger = new Logger(EvolutionService.name);

  constructor(
    private prisma: PrismaService,
    private chatGateway: ChatGateway,
    private leadsService: LeadsService,
    private inboxesService: InboxesService,
    @InjectQueue('media-jobs') private mediaQueue: Queue,
    @InjectQueue('ai-jobs') private aiQueue: Queue,
    private whatsappService: WhatsappService,
  ) {}

  async handleMessagesUpsert(payload: EvolutionWebhookPayload) {
    this.logger.log(`[WEBHOOK] messages.upsert received from ${payload?.instanceId}`);
    this.logger.debug(`Payload: ${JSON.stringify(payload)}`);
    const dataPayload = payload?.data as any;
    const instanceName = payload?.instance || payload?.instanceId;
    const inbox = instanceName ? await this.inboxesService.findByInstanceName(instanceName) : null;
    
    if (!inbox) {
      this.logger.warn(`[WEBHOOK] No inbox found for instanceName: ${instanceName}. Message might be lost or assigned to no tenant.`);
    }

    const inboxId = inbox?.inbox_id || null;

    const messages = Array.isArray(dataPayload?.messages)
      ? (dataPayload.messages as any[])
      : [dataPayload];

    for (const data of messages) {
      if (!data) continue;
      const key = data.key as any;
      if (!key) continue;

      const remoteJid = key.remoteJid as string;
      const remoteJidAlt = key.remoteJidAlt as string;
      if (!remoteJid || remoteJid.includes('@g.us')) continue;

      // ─── Handle incoming reactions ───────────────────────────────
      if (data.message?.reactionMessage) {
        const reaction = data.message.reactionMessage;
        const reactionKey = reaction.key;
        const emoji = reaction.text || '';
        if (reactionKey?.id) {
          const targetMsg = await this.prisma.message.findUnique({
            where: { external_message_id: reactionKey.id },
          });
          if (targetMsg) {
            if (emoji === '') {
              await (this.prisma as any).messageReaction.deleteMany({
                where: { message_id: targetMsg.id, contact_jid: remoteJid },
              });
            } else {
              await (this.prisma as any).messageReaction.upsert({
                where: { message_id_contact_jid: { message_id: targetMsg.id, contact_jid: remoteJid } },
                update: { emoji },
                create: { message_id: targetMsg.id, contact_jid: remoteJid, emoji },
              });
            }
            const allReactions = await (this.prisma as any).messageReaction.findMany({
              where: { message_id: targetMsg.id },
            });
            this.chatGateway.emitMessageReaction(targetMsg.conversation_id, {
              messageId: targetMsg.id,
              reactions: allReactions,
            });
          }
        }
        continue;
      }

      const phone = extractPhone(remoteJid, remoteJidAlt);
      // pushName from outgoing messages (fromMe=true) is the business account name, not the client.
      // Only use it as the contact name for incoming messages.
      const isFromMe = key.fromMe === true;
      const pushName = !isFromMe ? ((data.pushName as string) || null) : null;
      const externalMessageId = key.id as string;
      const messageContent =
        (data.message?.conversation as string) ||
        (data.message?.extendedTextMessage?.text as string) ||
        '';
      const messageType = (data.messageType as string) || 'text';

      // 1. Upsert Lead (via LeadsService para garantir normalização)
      const lead = await this.leadsService.upsert({
        phone,
        name: pushName,
        origin: 'whatsapp',
        stage: 'NOVO',
      });

      // 2. Find or Create Conversation
      let conv = await this.prisma.conversation.findFirst({
        where: {
          lead_id: lead.id,
          channel: 'whatsapp',
          status: 'ABERTO',
          instance_name: instanceName // Prioriza pelo nome da instância
        },
      });
      if (!conv) {
        // Antes de criar nova conversa, verifica se existe uma fechada para reabrir
        const closedConv = await this.prisma.conversation.findFirst({
          where: { lead_id: lead.id, channel: 'whatsapp', status: 'FECHADO', instance_name: instanceName },
          orderBy: { last_message_at: 'desc' },
        });
        if (closedConv) {
          conv = await this.prisma.conversation.update({
            where: { id: closedConv.id },
            data: {
              status: 'ABERTO',
              last_message_at: new Date(),
              ...(inboxId && !closedConv.inbox_id ? { inbox_id: inboxId } : {}),
            },
          });
          this.logger.log(`[REOPEN] Conversa ${conv.id} reaberta para lead ${lead.id}`);
        } else {
          conv = await this.prisma.conversation.create({
            data: {
              lead_id: lead.id,
              channel: 'whatsapp',
              status: 'ABERTO',
              external_id: remoteJid,
              inbox_id: inboxId,
              instance_name: instanceName,
              tenant_id: inbox?.tenant_id || lead.tenant_id,
            },
          });
        }
      } else if (!conv.inbox_id && inboxId) {
        // Se a conversa existe mas não tem setor, vincula ao setor da instância
        conv = await this.prisma.conversation.update({
          where: { id: conv.id },
          data: { inbox_id: inboxId, instance_name: instanceName }
        });
      }

      // ── Auto-merge de conversa LID ─────────────────────────────────────────
      // Se o remoteJid era um LID (14+ dígitos) e conseguimos o telefone real via
      // remoteJidAlt, verifica se existe uma conversa "gêmea" do LID e mescla
      // todas as mensagens na conversa do telefone real, encerrando a do LID.
      const rawLidPhone = remoteJid.split('@')[0];
      if (rawLidPhone.length > 13 && phone !== rawLidPhone) {
        const lidLead = await this.prisma.lead.findFirst({ where: { phone: rawLidPhone } });
        if (lidLead && lidLead.id !== lead.id) {
          const lidConvs = await this.prisma.conversation.findMany({
            where: { lead_id: lidLead.id, channel: 'whatsapp' },
          });
          for (const lidConv of lidConvs) {
            // Move todas as mensagens da conversa LID → conversa do telefone real
            await this.prisma.message.updateMany({
              where: { conversation_id: lidConv.id },
              data: { conversation_id: conv.id },
            });
            // Fecha a conversa LID duplicada
            await this.prisma.conversation.update({
              where: { id: lidConv.id },
              data: { status: 'FECHADO' },
            });
            this.logger.log(
              `[AUTO-MERGE] Conv LID ${lidConv.id} (${rawLidPhone}) → conv telefone ${conv.id} (${phone}) — ${lidConvs.length} conv(s) mescladas`,
            );
          }
          // Notifica a inbox para atualizar (remove duplicata da tela)
          this.chatGateway.emitConversationsUpdate(conv.tenant_id ?? null);
        }
      }
      // ──────────────────────────────────────────────────────────────────────

      // Auto-assign via round-robin se conversa sem operador atribuído
      if (inboxId && !conv.assigned_user_id) {
        const nextUserId = await this.inboxesService.getNextAssignee(inboxId);
        if (nextUserId) {
          conv = await this.prisma.conversation.update({
            where: { id: conv.id },
            data: { assigned_user_id: nextUserId },
            // ai_mode NÃO é alterado: operador monitora, IA continua respondendo
          });
          this.logger.log(`[AUTO-ASSIGN] Conversa ${conv.id} → operador ${nextUserId}`);
        }
      }

      // 3. Insert Message (idempotent)
      const existingMsg = await this.prisma.message.findUnique({
        where: { external_message_id: externalMessageId },
        include: { media: true, skill: { select: { id: true, name: true, area: true } } },
      });
      if (existingMsg) {
        this.logger.log(`[DEDUP] Mensagem já existe: ${externalMessageId} — re-emitindo WebSocket como fallback`);
        // Re-emite WebSocket para cobrir o caso em que o BullMQ QueueEvents perdeu o evento
        // (mensagem já está no banco mas o frontend pode não ter sido notificado em tempo real)
        this.chatGateway.emitNewMessage(existingMsg.conversation_id, existingMsg);
        this.chatGateway.emitConversationsUpdate(null);
        continue;
      }

      let msgType = 'text';
      if (
        [
          'imageMessage',
          'audioMessage',
          'documentMessage',
          'videoMessage',
          'stickerMessage',
        ].includes(messageType)
      ) {
        msgType = messageType.replace('Message', '');
      }

      // Extract quoted/reply context from contextInfo (works for both conversation and extendedTextMessage)
      const contextInfo =
        (data.message?.extendedTextMessage?.contextInfo as any) ||
        (data.message?.conversation ? undefined : undefined) ||
        (data.message?.[messageType]?.contextInfo as any);
      const quotedStanzaId: string | undefined = contextInfo?.stanzaId;
      const quotedText: string | undefined =
        contextInfo?.quotedMessage?.conversation ||
        contextInfo?.quotedMessage?.extendedTextMessage?.text ||
        contextInfo?.quotedMessage?.imageMessage?.caption;

      let replyToId: string | null = null;
      let replyToText: string | null = quotedText || null;
      if (quotedStanzaId) {
        const quotedMsg = await this.prisma.message.findUnique({
          where: { external_message_id: quotedStanzaId },
        });
        replyToId = quotedMsg?.id || null;
        if (!replyToText && quotedMsg?.text) replyToText = quotedMsg.text;
      }

      const isOutgoing = isFromMe;
      const msg = await this.prisma.message.create({
        data: {
          conversation_id: conv.id,
          direction: isOutgoing ? 'out' : 'in',
          type: msgType,
          text: messageContent,
          external_message_id: externalMessageId,
          status: isOutgoing ? 'enviado' : 'recebido',
          reply_to_id: replyToId,
          reply_to_text: replyToText,
        },
      });

      // Update Convo last message
      await this.prisma.conversation.update({
        where: { id: conv.id },
        data: { last_message_at: new Date() },
      });

      // Emit real-time events via WebSocket
      this.chatGateway.emitNewMessage(conv.id, msg);
      this.chatGateway.emitConversationsUpdate(null);

      // Notify operator(s) about incoming message (sound + unread badge)
      if (!isOutgoing) {
        this.chatGateway.emitIncomingMessageNotification(conv.assigned_user_id || null, {
          conversationId: conv.id,
          contactName: lead.name || lead.phone,
        });
      }

      // 4. Se mídia, enfileira download
      if (msgType !== 'text') {
        const mediaData = (data.message as any)?.[messageType];
        await this.mediaQueue.add('download_media', {
          message_id: msg.id,
          conversation_id: conv.id,
          media_data: mediaData,
          remote_jid: remoteJid,
          msg_id: externalMessageId,
          instance_name: instanceName,
        });
      }

      // 5. Se AI_Mode ativo e mensagem recebida (não enviada), agenda job para a IA responder
      // Debounce: cancela job pendente e cria novo com timer resetado, acumulando mensagens
      // rápidas. Quando o lead para de digitar, o job dispara e a IA responde tudo de uma vez.
      if (!isOutgoing && conv.ai_mode) {
        const cooldownRaw = await this.prisma.globalSetting.findUnique({
          where: { key: 'AI_COOLDOWN_SECONDS' },
        });
        const cooldownSeconds = cooldownRaw?.value ? parseInt(cooldownRaw.value, 10) : 8;
        const debounceMs = (isNaN(cooldownSeconds) ? 8 : Math.max(0, cooldownSeconds)) * 1000;
        const jobId = `ai-debounce-${conv.id}`;

        if (debounceMs > 0) {
          // Tenta remover job pendente com o mesmo ID para resetar o timer.
          // Se o job já estiver ATIVO (locked pelo worker), não pode ser removido;
          // nesse caso agendamos um novo job SEM jobId fixo para que o BullMQ
          // não faça deduplicação — garantindo que a nova mensagem seja processada
          // assim que o job atual terminar.
          let useFixedId = true;
          const existing = await this.aiQueue.getJob(jobId);
          if (existing) {
            try {
              await existing.remove();
              this.logger.log(`[AI] Debounce: job ${jobId} removido, timer resetado`);
            } catch {
              // Job está bloqueado (em execução) — não pode ser cancelado.
              // Agendamos novo job sem ID fixo para processar a nova mensagem em seguida.
              useFixedId = false;
              this.logger.warn(
                `[AI] Debounce: job ${jobId} ativo/bloqueado — novo job agendado sem ID fixo`,
              );
            }
          }

          await this.aiQueue.add(
            'process_ai_response',
            { conversation_id: conv.id, lead_id: lead.id },
            useFixedId
              ? { jobId, delay: debounceMs, removeOnComplete: true, removeOnFail: false }
              : { delay: debounceMs, removeOnComplete: true, removeOnFail: false },
          );
        } else {
          // Sem debounce: processa imediatamente
          await this.aiQueue.add('process_ai_response', {
            conversation_id: conv.id,
            lead_id: lead.id,
          });
        }
      }
    }
  }

  async handleChatsUpsert(payload: EvolutionWebhookPayload) {
    this.logger.log(`Recebendo webhook de chats: ${JSON.stringify(payload)}`);
    const dataPayload = payload?.data as any;
    const instanceName = payload?.instance || payload?.instanceId;
    const inbox = instanceName ? await this.inboxesService.findByInstanceName(instanceName) : null;
    const inboxId = inbox?.inbox_id || null;

    const chats = Array.isArray(dataPayload)
      ? (dataPayload as any[])
      : [dataPayload];

    for (const data of chats) {
      if (!data) continue;

      const remoteJid = (data.remoteJidAlt || data.remoteJid) as string;
      if (!remoteJid || remoteJid.includes('@g.us')) continue;

      const phone = extractPhone(data.remoteJid as string, data.remoteJidAlt as string);
      const pushName = (data.pushName as string) || (data.name as string) || null;

      // 1. Upsert Lead — two guards:
      //   a) Skip creation when there's no name and lead doesn't exist yet (prevents phantom leads).
      //   b) Never overwrite an existing name: chats.upsert fires after outgoing messages and can
      //      carry the business account's profile name ("André Lustosa Advogados") instead of the
      //      client's name.  Only set name when lead has none.
      const existingLead = await this.leadsService.findByPhone(phone);
      if (!pushName && !existingLead) continue; // No name, no existing lead → skip
      const nameToSet = existingLead?.name ? null : pushName;

      const lead = await this.leadsService.upsert({
        phone,
        name: nameToSet,
        origin: 'whatsapp',
        stage: 'NOVO',
        tenant: inbox?.tenant_id ? { connect: { id: inbox.tenant_id } } : undefined,
      });

      // 2. Find or Create Conversation
      let conv = await this.prisma.conversation.findFirst({
        where: {
          lead_id: lead.id,
          channel: 'whatsapp',
          status: 'ABERTO',
          instance_name: instanceName
        },
      });

      if (!conv) {
        // Antes de criar nova conversa, verifica se existe uma fechada para reabrir
        const closedConv = await this.prisma.conversation.findFirst({
          where: { lead_id: lead.id, channel: 'whatsapp', status: 'FECHADO', instance_name: instanceName },
          orderBy: { last_message_at: 'desc' },
        });
        if (closedConv) {
          conv = await this.prisma.conversation.update({
            where: { id: closedConv.id },
            data: {
              status: 'ABERTO',
              last_message_at: new Date(),
              inbox_id: inboxId || closedConv.inbox_id,
              instance_name: instanceName,
              tenant_id: inbox?.tenant_id || closedConv.tenant_id || lead.tenant_id,
            },
          });
          this.logger.log(`[REOPEN] Conversa ${conv.id} reaberta via chat webhook: ${phone}`);
        } else {
          conv = await this.prisma.conversation.create({
            data: {
              lead_id: lead.id,
              channel: 'whatsapp',
              status: 'ABERTO',
              external_id: remoteJid,
              inbox_id: inboxId,
              instance_name: instanceName,
              tenant_id: inbox?.tenant_id || lead.tenant_id,
            },
          });
          this.logger.log(`Nova conversa criada via chat webhook: ${phone} no setor ${inbox?.inbox?.name || 'Nenhum'}`);
        }
      } else {
        conv = await this.prisma.conversation.update({
          where: { id: conv.id },
          data: {
            inbox_id: inboxId,
            instance_name: instanceName,
            tenant_id: inbox?.tenant_id || conv.tenant_id || lead.tenant_id
          }
        });
      }

      // 3. Sync Last Message if available
      if (data.lastMessage && conv) {
        const lm = data.lastMessage;
        const msgId = lm.key?.id || lm.id;
        const msgText = lm.message?.conversation || 
                        lm.message?.extendedTextMessage?.text || 
                        lm.message?.imageMessage?.caption || 
                        (lm.messageType !== 'conversation' ? `[${lm.messageType}]` : '');

        if (msgId && msgText) {
          await this.prisma.message.upsert({
            where: { external_message_id: msgId },
            update: {
              status: lm.status || 'recebido',
            },
            create: {
              conversation_id: conv.id,
              direction: lm.key?.fromMe ? 'out' : 'in',
              type: 'text',
              text: msgText,
              external_message_id: msgId,
              status: lm.status || 'recebido',
              created_at: lm.messageTimestamp ? new Date(lm.messageTimestamp * 1000) : new Date(),
            },
          });

          await this.prisma.conversation.update({
            where: { id: conv.id },
            data: { last_message_at: lm.messageTimestamp ? new Date(lm.messageTimestamp * 1000) : new Date() }
          });
        }
      }
    }
  }

  async handleMessagesUpdate(payload: EvolutionWebhookPayload) {
    this.logger.log(`[WEBHOOK] messages.update received`);
    const updates = Array.isArray(payload?.data) ? payload.data : [payload?.data];

    for (const update of updates) {
      if (!update) continue;
      const externalMessageId: string = update.key?.id || update.id;
      if (!externalMessageId) continue;

      // Map Evolution status codes to internal status
      // 0=ERROR, 1=PENDING, 2=SERVER_ACK(enviado), 3=DELIVERY_ACK(entregue), 4=READ(lido), 5=PLAYED(ouvido)
      const statusCode: number = update.update?.status ?? update.status ?? -1;
      let newStatus: string | null = null;
      if (statusCode === 2) newStatus = 'enviado';
      else if (statusCode === 3) newStatus = 'entregue';
      else if (statusCode === 4 || statusCode === 5) newStatus = 'lido';

      if (!newStatus) continue;

      try {
        const msg = await this.prisma.message.findUnique({
          where: { external_message_id: externalMessageId },
        });
        if (!msg) continue;

        const updated = await this.prisma.message.update({
          where: { id: msg.id },
          data: { status: newStatus },
          include: { media: true },
        });

        this.chatGateway.emitMessageUpdate(msg.conversation_id, updated);
        this.logger.log(`[WEBHOOK] msg ${externalMessageId} status → ${newStatus}`);
      } catch (e) {
        this.logger.warn(`[WEBHOOK] Falha ao atualizar status de ${externalMessageId}: ${e.message}`);
      }
    }
  }

  async handleContactsUpsert(payload: EvolutionWebhookPayload) {
    this.logger.log(`Recebendo webhook de contatos: ${JSON.stringify(payload)}`);
    const contacts = Array.isArray(payload?.data)
      ? (payload.data as any[])
      : [payload?.data as any];

    for (const data of contacts) {
      if (!data) continue;

      const remoteJid = (data.id as string) || (data.remoteJid as string);
      if (!remoteJid || remoteJid.includes('@g.us')) continue;

      const phone = extractPhone(remoteJid, (data.remoteJidAlt as string) || (data.remoteJid as string));
      const name =
        (data.pushName as string) ||
        (data.name as string) ||
        (data.verifiedName as string) ||
        null;

      // contacts.upsert can fire with the business account's profile name after outgoing messages.
      // Only set the name if the lead doesn't already have one — never overwrite the client's name.
      const existingContact = await this.leadsService.findByPhone(phone);
      if (!existingContact && !name) continue; // No name, no existing lead → skip
      const contactNameToSet = existingContact?.name ? null : name;

      await this.leadsService.upsert({
        phone,
        name: contactNameToSet,
        origin: 'whatsapp',
        stage: 'NOVO',
      });

      this.logger.log(`Contato sincronizado via webhook: ${phone} (${contactNameToSet ?? 'nome preservado'})`);
    }
  }

  // ─── messages.delete ──────────────────────────────────────────

  async handleMessagesDelete(payload: EvolutionWebhookPayload) {
    this.logger.log(`[WEBHOOK] messages.delete received`);
    const data = payload?.data;
    // Evolution v2: { key: { remoteJid, fromMe, id }, ... } or data directly
    const messageKey = data?.key || data;
    const externalId = messageKey?.id;
    if (!externalId) return;

    const msg = await this.prisma.message.findUnique({
      where: { external_message_id: externalId },
    });
    if (!msg) return;

    // Preserva conteúdo original (texto, tipo, mídia) para uso como prova.
    // Apenas marca o status — não altera type nem text.
    const updated = await this.prisma.message.update({
      where: { id: msg.id },
      data: { status: 'apagado_pelo_contato' },
      include: { media: true },
    });

    // Emite messageUpdate — frontend ja escuta e atualiza
    this.chatGateway.emitMessageUpdate(msg.conversation_id, updated);

    this.logger.log(`[WEBHOOK] Message ${msg.id} marked as deleted by contact (content preserved)`);
  }

  // ─── contacts.update ──────────────────────────────────────────

  async handleContactsUpdate(payload: EvolutionWebhookPayload) {
    this.logger.log(`[WEBHOOK] contacts.update received`);
    const data = payload?.data;
    const instanceName = payload?.instance || payload?.instanceId;
    const contacts = Array.isArray(data) ? data : [data];

    for (const contact of contacts) {
      if (!contact) continue;
      const jid = contact.id || contact.jid || contact.remoteJid;
      if (!jid) continue;

      const phone = jid.replace(/@.*$/, '');
      if (!phone || phone.includes('-')) continue; // Ignorar grupos

      const lead = await this.prisma.lead.findFirst({ where: { phone } });
      if (!lead) continue;

      const updates: Record<string, string> = {};

      // Atualizar nome se mudou
      const newName = contact.pushName || contact.name || contact.verifiedName;
      if (newName && newName !== lead.name) {
        updates.name = newName;
      }

      // Buscar nova foto de perfil
      if (instanceName) {
        try {
          const newPic = await this.whatsappService.fetchProfilePicture(instanceName, phone);
          if (newPic && newPic !== lead.profile_picture_url) {
            updates.profile_picture_url = newPic;
          }
        } catch {
          // Best-effort — ignorar falha ao buscar foto
        }
      }

      if (Object.keys(updates).length === 0) continue;

      await this.prisma.lead.update({
        where: { id: lead.id },
        data: updates,
      });

      this.chatGateway.emitConversationsUpdate(null);
      this.logger.log(`[WEBHOOK] Lead ${lead.id} updated: ${JSON.stringify(updates)}`);
    }
  }

  // ─── connection.update ──────────────────────────────────────────

  async handleConnectionUpdate(payload: EvolutionWebhookPayload) {
    this.logger.log(`[WEBHOOK] connection.update received`);
    const data = payload?.data;
    const instanceName = payload?.instance || payload?.instanceId;
    const state = data?.state || data?.status || 'unknown';

    this.chatGateway.emitConnectionStatusUpdate({
      instanceName: instanceName || 'unknown',
      state,
      statusReason: data?.statusReason,
    });

    this.logger.log(`[WEBHOOK] Instance ${instanceName} connection: ${state}`);
  }

  // ─── presence.update ──────────────────────────────────────────

  async handlePresenceUpdate(payload: EvolutionWebhookPayload) {
    this.logger.log(`[WEBHOOK] presence.update received`);
    const data = payload?.data;
    const jid = data?.id || data?.remoteJid;
    if (!jid) return;

    const phone = jid.replace(/@.*$/, '');
    if (!phone || phone.includes('-')) return; // Ignorar grupos

    const lead = await this.prisma.lead.findFirst({ where: { phone } });
    if (!lead) return;

    const conversation = await this.prisma.conversation.findFirst({
      where: { lead_id: lead.id, status: { in: ['ABERTO', 'WAITING', 'MONITORING'] } },
      orderBy: { last_message_at: 'desc' },
    });
    if (!conversation) return;

    // Extrair presence do payload
    const presences = data?.presences || {};
    const presenceData = Object.values(presences)[0] as any;
    const presence = presenceData?.lastKnownPresence || data?.presence || 'unavailable';

    this.chatGateway.emitContactPresence(conversation.id, {
      presence,
      lastSeen: presence === 'unavailable' ? new Date().toISOString() : undefined,
    });
  }
}
