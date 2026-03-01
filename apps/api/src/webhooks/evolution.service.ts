import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ChatGateway } from '../gateway/chat.gateway';

interface EvolutionWebhookPayload {
  event: string;
  instanceId: string;
  data: any;
}

@Injectable()
export class EvolutionService {
  private readonly logger = new Logger(EvolutionService.name);

  constructor(
    private prisma: PrismaService,
    private chatGateway: ChatGateway,
    @InjectQueue('media-jobs') private mediaQueue: Queue,
    @InjectQueue('ai-jobs') private aiQueue: Queue,
  ) {}

  async handleMessagesUpsert(payload: EvolutionWebhookPayload) {
    this.logger.log(`Recebendo webhook: ${JSON.stringify(payload)}`);
    const dataPayload = payload?.data as any;
    const messages = Array.isArray(dataPayload?.messages)
      ? (dataPayload.messages as any[])
      : [dataPayload];

    for (const data of messages) {
      if (!data) continue;
      const key = data.key as any;
      if (!key || key.fromMe) continue;

      const remoteJid = key.remoteJid as string;
      if (!remoteJid || remoteJid.includes('@g.us')) continue;

      let phone = remoteJid.split('@')[0];
      // Normalização Especial Brasil: Nono Dígito
      phone = this.normalizeBrazilianPhone(phone);

      const pushName = (data.pushName as string) || 'Desconhecido';
      const externalMessageId = key.id as string;
      const messageContent =
        (data.message?.conversation as string) ||
        (data.message?.extendedTextMessage?.text as string) ||
        '';
      const messageType = (data.messageType as string) || 'text';

      // 1. Upsert Lead
      const lead = await this.prisma.lead.upsert({
        where: { phone },
        update: {},
        create: {
          phone,
          name: pushName,
          origin: 'whatsapp',
          stage: 'NOVO',
        },
      });

      // 2. Find or Create Conversation
      let conv = await this.prisma.conversation.findFirst({
        where: { lead_id: lead.id, channel: 'whatsapp', status: 'ABERTO' },
      });
      if (!conv) {
        conv = await this.prisma.conversation.create({
          data: {
            lead_id: lead.id,
            channel: 'whatsapp',
            status: 'ABERTO',
            external_id: remoteJid,
          },
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
        ].includes(messageType)
      ) {
        msgType = messageType.replace('Message', '');
      }

      const msg = await this.prisma.message.create({
        data: {
          conversation_id: conv.id,
          direction: 'in',
          type: msgType,
          text: messageContent,
          external_message_id: externalMessageId,
          status: 'recebido',
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
          media_data: mediaData,
          remote_jid: remoteJid,
          msg_id: externalMessageId,
        });
      }

      // 5. Se AI_Mode ativo, agenda job para a IA responder
      if (conv.ai_mode && !conv.assigned_user_id) {
        await this.aiQueue.add('process_ai_response', {
          conversation_id: conv.id,
          lead_id: lead.id,
        });
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

      let phone = remoteJid.split('@')[0];
      // Normalização Especial Brasil: Nono Dígito
      phone = this.normalizeBrazilianPhone(phone);

      const name =
        (data.pushName as string) ||
        (data.name as string) ||
        (data.verifiedName as string) ||
        'Desconhecido';

      const existingLead = await this.prisma.lead.findUnique({
        where: { phone },
      });

      await this.prisma.lead.upsert({
        where: { phone },
        update: {
          name: name,
        },
        create: {
          phone,
          name: name,
          origin: 'whatsapp',
          stage: 'NOVO',
          tenant_id: existingLead?.tenant_id || payload.instanceId || null,
        },
      });

      this.logger.log(`Contato sincronizado via webhook: ${phone} (${name})`);
    }
  }

  private normalizeBrazilianPhone(phone: string): string {
    // Se não é Brasil (55), não mexe
    if (!phone.startsWith('55')) return phone;

    // Mobile com 8 digitos (legado): 55 + DD + 8 digitos = 12 digitos
    if (phone.length === 12) {
      const ddd = phone.substring(2, 4);
      const number = phone.substring(4);
      // Se o numero começa com [6, 7, 8, 9], é um celular que precisa de nono dígito
      if (['6', '7', '8', '9'].includes(number[0])) {
        return `55${ddd}9${number}`;
      }
    }
    return phone;
  }
}
