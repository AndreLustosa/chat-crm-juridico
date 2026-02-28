import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ChatGateway } from '../gateway/chat.gateway';

@Injectable()
export class EvolutionService {
  private readonly logger = new Logger(EvolutionService.name);

  constructor(
    private prisma: PrismaService,
    private chatGateway: ChatGateway,
    @InjectQueue('media-jobs') private mediaQueue: Queue,
    @InjectQueue('ai-jobs') private aiQueue: Queue,
  ) {}

  async handleMessagesUpsert(payload: any) {
    this.logger.log(`Recebendo webhook: ${JSON.stringify(payload)}`);
    // Basic array or single object support
    const messages = Array.isArray(payload?.data?.messages) ? payload.data.messages : [payload?.data];
    
    for (const data of messages) {
      if (!data) continue;
      const key = data.key;
      if (!key || key.fromMe) continue; // Ignorar mensagens enviadas pelo próprio bot se for receive handler

      const remoteJid = key.remoteJid; // ex: 5511999999999@s.whatsapp.net
      if (!remoteJid || remoteJid.includes('@g.us')) continue; // Ignora grupos inicial

      const phone = remoteJid.split('@')[0];
      const pushName = data.pushName || 'Desconhecido';
      const externalMessageId = key.id;
      const messageContent = data.message?.conversation || data.message?.extendedTextMessage?.text || '';
      const messageType = data.messageType || 'text';

      // 1. Upsert Lead
      const lead = await this.prisma.lead.upsert({
        where: { phone },
        update: {},
        create: {
          phone,
          name: pushName,
          origin: 'whatsapp',
          stage: 'NOVO',
        }
      });

      // 2. Find or Create Conversation
      let conv = await this.prisma.conversation.findFirst({
         where: { lead_id: lead.id, channel: 'whatsapp', status: 'ABERTO' }
      });
      if (!conv) {
         conv = await this.prisma.conversation.create({
           data: { lead_id: lead.id, channel: 'whatsapp', status: 'ABERTO', external_id: remoteJid }
         });
      }

      // 3. Insert Message (idempotent)
      const existingMsg = await this.prisma.message.findUnique({ where: { external_message_id: externalMessageId } });
      if (existingMsg) {
        this.logger.log(`Mensagem duplicada ignorada: ${externalMessageId}`);
        continue;
      }

      let msgType = 'text';
      if (['imageMessage', 'audioMessage', 'documentMessage', 'videoMessage'].includes(messageType)) {
        msgType = messageType.replace('Message', '');
      }

      const msg = await this.prisma.message.create({
        data: {
          conversation_id: conv.id,
          direction: 'in',
          type: msgType,
          text: messageContent,
          external_message_id: externalMessageId,
          status: 'recebido'
        }
      });

      // Update Convo last message
      await this.prisma.conversation.update({
        where: { id: conv.id },
        data: { last_message_at: new Date() }
      });

      // Emit real-time events via WebSocket
      this.chatGateway.emitNewMessage(conv.id, msg);
      this.chatGateway.emitConversationsUpdate(null);

      // 4. Se mídia, enfileira download
      if (msgType !== 'text') {
        const mediaData = data.message?.[messageType];
        await this.mediaQueue.add('download_media', {
          message_id: msg.id,
          media_data: mediaData,
          remote_jid: remoteJid,
          msg_id: externalMessageId
        });
      }

      // 5. Se AI_Mode ativo, agenda job para a IA responder
      if (conv.ai_mode && !conv.assigned_user_id) {
        await this.aiQueue.add('process_ai_response', {
           conversation_id: conv.id,
           lead_id: lead.id
        });
      }
    }
  }
}
