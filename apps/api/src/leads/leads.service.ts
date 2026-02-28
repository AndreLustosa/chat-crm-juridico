import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, Lead } from '@crm/shared';

@Injectable()
export class LeadsService {
  constructor(private prisma: PrismaService) {}

  async create(data: Prisma.LeadCreateInput): Promise<Lead> {
    return this.prisma.lead.create({ data });
  }

  async findAll(tenant_id?: string) {
    return this.prisma.lead.findMany({
      where: tenant_id ? { tenant_id } : undefined,
      orderBy: { created_at: 'desc' },
      include: {
        _count: { select: { conversations: true } },
        conversations: {
          orderBy: { last_message_at: 'desc' },
          take: 1,
          select: { last_message_at: true },
        },
      },
    });
  }

  async findOne(id: string): Promise<Lead | null> {
    return this.prisma.lead.findUnique({ where: { id } });
  }

  async updateStatus(id: string, stage: string): Promise<Lead> {
    return this.prisma.lead.update({
      where: { id },
      data: { stage },
    });
  }
}
