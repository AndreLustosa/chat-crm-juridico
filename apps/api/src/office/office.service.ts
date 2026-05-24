import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { evaluateSubscription } from '../subscription/subscription.util';
import { UpdateOfficeDto } from './dto/update-office.dto';

@Injectable()
export class OfficeService {
  constructor(private readonly prisma: PrismaService) {}

  /** Dados do escritório do usuário logado: identidade + dono + plano + equipe. */
  async getForTenant(tenantId?: string | null) {
    if (!tenantId) throw new NotFoundException('Tenant não encontrado para o usuário atual.');
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        cnpj: true,
        phone: true,
        is_internal: true,
        subscription_status: true,
        trial_ends_at: true,
        current_period_end: true,
        plan: true,
      },
    });
    if (!tenant) throw new NotFoundException('Escritório não encontrado.');

    // Tenant não tem created_at; o usuário mais antigo (admin do cadastro) serve
    // de referência para "cliente desde".
    const [owner, usersCount] = await Promise.all([
      this.prisma.user.findFirst({
        where: { tenant_id: tenantId },
        orderBy: { created_at: 'asc' },
        select: { name: true, email: true, phone: true, created_at: true },
      }),
      this.prisma.user.count({ where: { tenant_id: tenantId } }),
    ]);

    return {
      id: tenant.id,
      name: tenant.name,
      cnpj: tenant.cnpj ?? null,
      phone: tenant.phone ?? null,
      created_at: owner?.created_at ?? null,
      users_count: usersCount,
      owner: owner ? { name: owner.name, email: owner.email, phone: owner.phone ?? null } : null,
      subscription: evaluateSubscription({
        is_internal: tenant.is_internal,
        subscription_status: tenant.subscription_status,
        trial_ends_at: tenant.trial_ends_at,
        current_period_end: tenant.current_period_end,
        plan: tenant.plan,
      }),
    };
  }

  /** Atualiza nome/CNPJ/telefone (só ADMIN). name não pode ficar vazio. */
  async update(tenantId: string | undefined, dto: UpdateOfficeDto) {
    if (!tenantId) throw new BadRequestException('Tenant não identificado.');
    const data: { name?: string; cnpj?: string | null; phone?: string | null } = {};
    if (dto.name !== undefined) {
      const n = dto.name.trim();
      if (!n) throw new BadRequestException('O nome do escritório não pode ficar vazio.');
      data.name = n;
    }
    if (dto.cnpj !== undefined) data.cnpj = dto.cnpj.trim() || null;
    if (dto.phone !== undefined) data.phone = dto.phone.trim() || null;
    if (Object.keys(data).length > 0) {
      await this.prisma.tenant.update({ where: { id: tenantId }, data });
    }
    return this.getForTenant(tenantId);
  }
}
