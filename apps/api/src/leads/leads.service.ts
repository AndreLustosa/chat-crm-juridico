import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, Lead } from '@crm/shared';

@Injectable()
export class LeadsService {
  constructor(private prisma: PrismaService) {}

  async create(data: Prisma.LeadCreateInput): Promise<Lead> {
    return this.prisma.lead.create({ data });
  }

  async findAll(tenant_id?: string): Promise<Lead[]> {
    return (await this.prisma.lead.findMany({
      where: tenant_id ? { OR: [{ tenant_id }, { tenant_id: null }] } : undefined,
      include: {
        _count: {
          select: { conversations: true },
        },
        conversations: {
          orderBy: { last_message_at: 'desc' },
          take: 1,
          include: {
            messages: {
              orderBy: { created_at: 'desc' },
              take: 1,
            },
          },
        },
      },
      orderBy: { created_at: 'desc' },
    })) as any;
  }

  async findOne(id: string): Promise<Lead | null> {
    return this.prisma.lead.findUnique({ where: { id } });
  }

  async upsert(data: Prisma.LeadCreateInput): Promise<Lead> {
    const { phone, ...rest } = data;
    return this.prisma.lead.upsert({
      where: { phone },
      update: { ...rest },
      create: { ...data },
    });
  }

  async updateStatus(id: string, stage: string): Promise<Lead> {
    return this.prisma.lead.update({
      where: { id },
      data: { stage },
    });
  }
}
