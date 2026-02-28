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
    return this.prisma.lead.findMany({
      where: tenant_id ? { tenant_id } : undefined,
      orderBy: { created_at: 'desc' },
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
