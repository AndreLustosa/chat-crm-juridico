import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { evaluateSubscription } from '../subscription/subscription.util';
import { isValidCPF, isValidCNPJ } from '../common/utils/cpf-cnpj.util';
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
        cpf: true,
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
      cpf: tenant.cpf ?? null,
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

  /**
   * Atualiza nome/CNPJ/CPF/telefone (só ADMIN). name não pode ficar vazio e o
   * escritório precisa ter PELO MENOS um documento (CPF ou CNPJ).
   */
  async update(tenantId: string | undefined, dto: UpdateOfficeDto) {
    if (!tenantId) throw new BadRequestException('Tenant não identificado.');
    const current = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { cnpj: true, cpf: true },
    });
    if (!current) throw new NotFoundException('Escritório não encontrado.');

    const data: { name?: string; cnpj?: string | null; cpf?: string | null; phone?: string | null } = {};
    if (dto.name !== undefined) {
      const n = dto.name.trim();
      if (!n) throw new BadRequestException('O nome do escritório não pode ficar vazio.');
      data.name = n;
    }
    if (dto.phone !== undefined) data.phone = dto.phone.trim() || null;
    if (dto.cnpj !== undefined) data.cnpj = this.normDoc(dto.cnpj, 'CNPJ', 14);
    if (dto.cpf !== undefined) data.cpf = this.normDoc(dto.cpf, 'CPF', 11);

    // Obrigatório ter um documento: o estado final precisa ter CPF ou CNPJ.
    const finalCnpj = data.cnpj !== undefined ? data.cnpj : current.cnpj;
    const finalCpf = data.cpf !== undefined ? data.cpf : current.cpf;
    if (!finalCnpj && !finalCpf) {
      throw new BadRequestException('Informe o CPF ou o CNPJ do escritório.');
    }

    if (Object.keys(data).length > 0) {
      await this.prisma.tenant.update({ where: { id: tenantId }, data });
    }
    return this.getForTenant(tenantId);
  }

  /**
   * Valida o documento: "" => null (limpa). Confere a quantidade de dígitos E os
   * dígitos verificadores (módulo 11) — rejeita números fictícios como
   * "00000000000" ou CPF/CNPJ com dígito verificador errado. Mantém a formatação.
   */
  private normDoc(value: string, label: string, digits: number): string | null {
    const raw = (value ?? '').trim();
    if (!raw) return null;
    const clean = raw.replace(/\D/g, '');
    if (clean.length !== digits) {
      throw new BadRequestException(`${label} inválido — deve ter ${digits} dígitos.`);
    }
    const valido = digits === 11 ? isValidCPF(clean) : isValidCNPJ(clean);
    if (!valido) {
      throw new BadRequestException(`${label} inválido — confira os dígitos (número inexistente).`);
    }
    return raw;
  }
}
