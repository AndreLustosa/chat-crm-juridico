import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, Lead } from '@crm/shared';
import {
  normalizeBrazilianPhone,
  denormalizeBrazilianPhone,
} from '../common/utils/phone';

@Injectable()
export class LeadsService {
  constructor(private prisma: PrismaService) {}

  async create(data: Prisma.LeadCreateInput): Promise<Lead> {
    if (data.phone) {
      data = { ...data, phone: normalizeBrazilianPhone(data.phone) };
    }

    // Verificar se existe lead com formato antigo (13 dígitos com nono dígito)
    const denormalized = denormalizeBrazilianPhone(data.phone);
    if (denormalized !== data.phone) {
      const existingOld = await this.prisma.lead.findUnique({
        where: { phone: denormalized },
      });
      if (existingOld) {
        const { phone: _phone, ...rest } = data;
        return this.prisma.lead.update({
          where: { id: existingOld.id },
          data: { phone: data.phone, ...rest },
        });
      }
    }

    return this.prisma.lead.create({ data });
  }

  async findAll(tenant_id?: string): Promise<Lead[]> {
    return (await this.prisma.lead.findMany({
      where: tenant_id
        ? { OR: [{ tenant_id }, { tenant_id: null }] }
        : undefined,
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
    const normalizedPhone = normalizeBrazilianPhone(data.phone);
    const denormalizedPhone = denormalizeBrazilianPhone(normalizedPhone);

    // Verificar se existe lead com formato antigo (13 dígitos com nono dígito)
    if (denormalizedPhone !== normalizedPhone) {
      const existingOld = await this.prisma.lead.findUnique({
        where: { phone: denormalizedPhone },
      });
      if (existingOld) {
        const { phone: _phone, ...rest } = data;
        return this.prisma.lead.update({
          where: { id: existingOld.id },
          data: { phone: normalizedPhone, ...rest },
        });
      }
    }

    // Upsert normal com phone normalizado
    const { phone: _phone, ...rest } = data;
    return this.prisma.lead.upsert({
      where: { phone: normalizedPhone },
      update: { ...rest },
      create: { ...data, phone: normalizedPhone },
    });
  }

  async updateStatus(id: string, stage: string): Promise<Lead> {
    return this.prisma.lead.update({
      where: { id },
      data: { stage },
    });
  }
}
