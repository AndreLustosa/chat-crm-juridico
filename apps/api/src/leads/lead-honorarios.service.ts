import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LeadHonorariosService {
  constructor(private prisma: PrismaService) {}

  async findByLead(leadId: string) {
    return this.prisma.leadHonorario.findMany({
      where: { lead_id: leadId },
      orderBy: { created_at: 'desc' },
    });
  }

  async create(leadId: string, data: {
    type: string;
    total_value: number;
    installment_count?: number;
    success_percentage?: number;
    entry_value?: number;
    notes?: string;
  }, tenantId?: string) {
    if (!data.total_value || data.total_value <= 0) {
      throw new BadRequestException('Valor total deve ser maior que zero');
    }

    const validTypes = ['CONTRATUAL', 'ENTRADA', 'ACORDO'];
    if (!validTypes.includes(data.type)) {
      throw new BadRequestException(`Tipo inválido. Use: ${validTypes.join(', ')}`);
    }

    return this.prisma.leadHonorario.create({
      data: {
        lead_id: leadId,
        tenant_id: tenantId || null,
        type: data.type,
        total_value: data.total_value,
        installment_count: data.installment_count || 1,
        success_percentage: data.success_percentage ?? null,
        entry_value: data.entry_value ?? null,
        notes: data.notes || null,
      },
    });
  }

  async update(id: string, data: {
    type?: string;
    total_value?: number;
    installment_count?: number;
    success_percentage?: number;
    entry_value?: number;
    notes?: string;
    status?: string;
  }) {
    const existing = await this.prisma.leadHonorario.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Honorário negociado não encontrado');
    if (existing.status === 'CONVERTIDO') {
      throw new ForbiddenException('Honorário já convertido não pode ser alterado');
    }

    if (data.type) {
      const validTypes = ['CONTRATUAL', 'ENTRADA', 'ACORDO'];
      if (!validTypes.includes(data.type)) {
        throw new BadRequestException(`Tipo inválido. Use: ${validTypes.join(', ')}`);
      }
    }

    if (data.status) {
      const validStatuses = ['NEGOCIANDO', 'ACEITO', 'RECUSADO'];
      if (!validStatuses.includes(data.status)) {
        throw new BadRequestException(`Status inválido. Use: NEGOCIANDO, ACEITO, RECUSADO`);
      }
    }

    return this.prisma.leadHonorario.update({
      where: { id },
      data: {
        ...(data.type && { type: data.type }),
        ...(data.total_value && { total_value: data.total_value }),
        ...(data.installment_count && { installment_count: data.installment_count }),
        ...(data.success_percentage !== undefined && { success_percentage: data.success_percentage }),
        ...(data.entry_value !== undefined && { entry_value: data.entry_value }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.status && { status: data.status }),
      },
    });
  }

  async delete(id: string) {
    const existing = await this.prisma.leadHonorario.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Honorário negociado não encontrado');
    if (existing.status === 'CONVERTIDO') {
      throw new ForbiddenException('Honorário já convertido não pode ser excluído');
    }

    await this.prisma.leadHonorario.delete({ where: { id } });
    return { ok: true };
  }
}
