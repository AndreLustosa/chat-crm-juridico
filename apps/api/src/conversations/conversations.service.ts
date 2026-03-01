import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, Conversation } from '@crm/shared';

@Injectable()
export class ConversationsService {
  constructor(private prisma: PrismaService) {}

  async create(data: Prisma.ConversationCreateInput): Promise<Conversation> {
    return this.prisma.conversation.create({ data });
  }

  async findAll(status?: string, userId?: string, inboxId?: string) {
    const where: any = {};
    if (status) where.status = status;

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

    const conversations = await this.prisma.conversation.findMany({
      where,
      orderBy: { last_message_at: 'desc' },
      include: {
        lead: { select: { id: true, name: true, phone: true, email: true, stage: true, profile_picture_url: true } },
        messages: { orderBy: { created_at: 'desc' }, take: 1, include: { media: true } },
        assigned_user: { select: { id: true, name: true } },
      },
    });

    return conversations.map((c) => ({
      id: c.id,
      leadId: c.lead_id,
      contactName: c.lead?.name || c.lead?.phone || 'Desconhecido',
      contactPhone: c.lead?.phone || '',
      contactEmail: c.lead?.email || '',
      channel: c.channel?.toUpperCase() || 'WHATSAPP',
      status: c.status === 'FECHADO' ? 'CLOSED' : (c.ai_mode && !c.assigned_user_id ? 'BOT' : c.assigned_user_id ? 'ACTIVE' : 'WAITING'),
      lastMessage: c.messages[0]?.text || '',
      lastMessageAt: c.last_message_at?.toISOString() || '',
      assignedAgentName: c.assigned_user?.name || null,
      aiMode: c.ai_mode,
      profile_picture_url: c.lead?.profile_picture_url || null,
    }));
  }

  async findOne(id: string) {
    return this.prisma.conversation.findUnique({
      where: { id },
      include: {
        lead: { select: { id: true, name: true, phone: true, email: true, profile_picture_url: true } },
        messages: { orderBy: { created_at: 'asc' }, include: { media: true } },
        assigned_user: { select: { id: true, name: true } },
      },
    });
  }

  async findAllByLead(lead_id: string): Promise<Conversation[]> {
    return this.prisma.conversation.findMany({
      where: { lead_id },
      orderBy: { last_message_at: 'desc' },
      include: {
        messages: { orderBy: { created_at: 'asc' }, take: 50 }
      }
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
    return this.prisma.conversation.update({
      where: { id },
      data: { status: 'FECHADO' },
    });
  }
}
