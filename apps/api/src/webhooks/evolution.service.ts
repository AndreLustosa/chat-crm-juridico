import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ChatGateway } from '../gateway/chat.gateway';
import { LeadsService } from '../leads/leads.service';
import { InboxesService } from '../inboxes/inboxes.service';

interface EvolutionWebhookPayload {
  event: string;
  instanceId: string;
  instance?: string;
  data: any;
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

      const phone = (remoteJidAlt || remoteJid).split('@')[0];
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
      });
      if (existingMsg) {
        this.logger.log(`Mensagem duplicada ignorada: ${externalMessageId}`);
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

      // Notify the assigned operator about incoming message (sound notification)
      if (!isOutgoing && conv.assigned_user_id) {
        this.chatGateway.emitIncomingMessageNotification(conv.assigned_user_id, {
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
      // Nota: assigned_user_id pode estar preenchido (monitorando) mas ai_mode ainda ativo
      if (!isOutgoing && conv.ai_mode) {
        await this.aiQueue.add('process_ai_response', {
          conversation_id: conv.id,
          lead_id: lead.id,
        });
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

      const phone = remoteJid.split('@')[0];
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

      const phone = remoteJid.split('@')[0];
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
}
