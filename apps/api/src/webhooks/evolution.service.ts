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
      const pushName = (data.pushName as string) || 'Desconhecido';
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
      } else if (!conv.inbox_id && inboxId) {
        // Se a conversa existe mas não tem setor, vincula ao setor da instância
        await this.prisma.conversation.update({
          where: { id: conv.id },
          data: { inbox_id: inboxId, instance_name: instanceName }
        });
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

      const isOutgoing = key.fromMe === true;
      const msg = await this.prisma.message.create({
        data: {
          conversation_id: conv.id,
          direction: isOutgoing ? 'out' : 'in',
          type: msgType,
          text: messageContent,
          external_message_id: externalMessageId,
          status: isOutgoing ? 'enviado' : 'recebido',
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
      if (!isOutgoing && conv.ai_mode && !conv.assigned_user_id) {
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
      const pushName = (data.pushName as string) || (data.name as string) || 'Desconhecido';

      // 1. Upsert Lead
      const lead = await this.leadsService.upsert({
        phone,
        name: pushName,
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
        'Desconhecido';

      await this.leadsService.upsert({
        phone,
        name,
        origin: 'whatsapp',
        stage: 'NOVO',
      });

      this.logger.log(`Contato sincronizado via webhook: ${phone} (${name})`);
    }
  }
}
