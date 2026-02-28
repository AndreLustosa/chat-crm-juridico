import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { ChatGateway } from '../gateway/chat.gateway';

@Injectable()
export class MessagesService {
  constructor(
    private prisma: PrismaService,
    private whatsapp: WhatsappService,
    private chatGateway: ChatGateway,
  ) {}

  async getMessages(conversationId: string) {
    return this.prisma.message.findMany({
      where: { conversation_id: conversationId },
      orderBy: { created_at: 'asc' },
      include: { media: true }
    });
  }

  async sendMessage(conversationId: string, text: string) {
    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { lead: true }
    });

    if (!convo || !convo.lead) {
      throw new BadRequestException('Conversa inválida');
    }

    // 1. Send via Evolution API
    let externalMsg;
    try {
      externalMsg = await this.whatsapp.sendText(convo.lead.phone, text);
    } catch (e) {
      throw new BadRequestException('Falha ao enviar webhook WhatsApp');
    }

    // 2. Persist in DB
    const externalId = externalMsg?.key?.id || `out_${Date.now()}`;
    const msg = await this.prisma.message.create({
      data: {
        conversation_id: convo.id,
        direction: 'out',
        type: 'text',
        text,
        external_message_id: externalId,
        status: 'enviado'
      }
    });

    // 3. Update Convo
    await this.prisma.conversation.update({
      where: { id: convo.id },
      data: { last_message_at: new Date() }
    });

    // 4. Emit real-time events via WebSocket
    this.chatGateway.emitNewMessage(convo.id, msg);
    this.chatGateway.emitConversationsUpdate(null);

    return msg;
  }
}
