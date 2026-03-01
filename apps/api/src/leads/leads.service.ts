import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, Lead } from '@crm/shared';

/**
 * Remove o nono dígito de celulares brasileiros.
 * 13 dígitos (55+DD+9+8dig) → 12 dígitos (55+DD+8dig)
 * Ex: 5582999130127 → 558299130127
 */
function to12Digits(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('55') && d[4] === '9') {
    return d.slice(0, 4) + d.slice(5); // remove o 5º caractere (o 9)
  }
  return d;
}

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(private prisma: PrismaService) {}

  async create(data: Prisma.LeadCreateInput): Promise<Lead> {
    if (data.phone) data = { ...data, phone: to12Digits(data.phone) };
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
    const phone = to12Digits(data.phone);
    const { phone: _phone, ...rest } = data;

    this.logger.debug(`Upsert lead: raw=${data.phone} → stored=${phone}`);

    return this.prisma.lead.upsert({
      where: { phone },
      update: { ...rest },
      create: { ...data, phone },
    });
  }

  async updateStatus(id: string, stage: string): Promise<Lead> {
    return this.prisma.lead.update({
      where: { id },
      data: { stage },
    });
  }
}
