import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class InboxesService {
  constructor(private prisma: PrismaService) {}

  private get inbox() {
    return (this.prisma as any).inbox;
  }

  private get instance() {
    return (this.prisma as any).instance;
  }

  async findAll(tenantId?: string, userId?: string) {
    return this.inbox.findMany({
      where: { 
        tenant_id: tenantId,
        users: userId ? { some: { id: userId } } : undefined
      },
      include: {
        instances: true,
        users: { select: { id: true, name: true, email: true } },
        _count: {
          select: { users: true, conversations: true }
        }
      }
    });
  }

  async findOne(id: string) {
    const inbox = await this.inbox.findUnique({
      where: { id },
      include: {
        instances: true,
        users: { select: { id: true, name: true, email: true } }
      }
    });

    if (!inbox) throw new NotFoundException('Inbox não encontrada');
    return inbox;
  }

  async create(data: { name: string; tenant_id?: string }) {
    return this.inbox.create({
      data,
      include: {
        instances: true,
        users: { select: { id: true, name: true, email: true } },
        _count: {
          select: { users: true, conversations: true }
        }
      }
    });
  }

  async update(id: string, data: { name?: string }) {
    return this.inbox.update({
      where: { id },
      data
    });
  }

  async remove(id: string) {
    return this.inbox.delete({ where: { id } });
  }

  // --- Gestão de Usuários no Setor ---

  async addUser(inboxId: string, userId: string) {
    return this.inbox.update({
      where: { id: inboxId },
      data: {
        users: { connect: { id: userId } }
      }
    });
  }

  async removeUser(inboxId: string, userId: string) {
    return this.inbox.update({
      where: { id: inboxId },
      data: {
        users: { disconnect: { id: userId } }
      }
    });
  }

  // --- Gestão de Instâncias ---

  async addInstance(inboxId: string, instanceName: string, type: 'whatsapp' | 'instagram') {
    // Verifica se a instância já está vinculada a outro inbox
    const existing = await this.instance.findUnique({ where: { name: instanceName } });
    if (existing?.inbox_id && existing.inbox_id !== inboxId) {
      const otherInbox = await this.inbox.findUnique({ where: { id: existing.inbox_id }, select: { name: true } });
      throw new ConflictException(
        `A instância "${instanceName}" já está vinculada ao setor "${otherInbox?.name ?? existing.inbox_id}". Remova-a de lá primeiro.`
      );
    }

    // 1. Vincula a instância ao setor
    const instance = await this.instance.upsert({
      where: { name: instanceName },
      update: { inbox_id: inboxId, type },
      create: {
        name: instanceName,
        type,
        inbox_id: inboxId
      }
    });

    // 2. MIGRACAO: Vincula todas as conversas existentes desta instancia ao novo setor
    // Isso garante que contatos antigos "apareçam" no novo setor imediatamente
    await (this.prisma as any).conversation.updateMany({
      where: { instance_name: instanceName },
      data: { inbox_id: inboxId }
    });

    return instance;
  }

  async findByInstanceName(instanceName: string) {
    return this.instance.findUnique({
      where: { name: instanceName },
      include: { inbox: true }
    });
  }
}
