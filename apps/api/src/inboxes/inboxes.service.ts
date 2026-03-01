import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class InboxesService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId?: string, userId?: string) {
    return this.prisma.inbox.findMany({
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
    const inbox = await this.prisma.inbox.findUnique({
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
    return this.prisma.inbox.create({
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
    return this.prisma.inbox.update({
      where: { id },
      data
    });
  }

  async remove(id: string) {
    return this.prisma.inbox.delete({ where: { id } });
  }

  // --- Gestão de Usuários no Setor ---

  async addUser(inboxId: string, userId: string) {
    return this.prisma.inbox.update({
      where: { id: inboxId },
      data: {
        users: { connect: { id: userId } }
      }
    });
  }

  async removeUser(inboxId: string, userId: string) {
    return this.prisma.inbox.update({
      where: { id: inboxId },
      data: {
        users: { disconnect: { id: userId } }
      }
    });
  }

  // --- Gestão de Instâncias ---

  async addInstance(inboxId: string, instanceName: string, type: 'whatsapp' | 'instagram') {
    return this.prisma.instance.upsert({
      where: { name: instanceName },
      update: { inbox_id: inboxId, type },
      create: {
        name: instanceName,
        type,
        inbox_id: inboxId
      }
    });
  }

  async findByInstanceName(instanceName: string) {
    return this.prisma.instance.findUnique({
      where: { name: instanceName },
      include: { inbox: true }
    });
  }
}
