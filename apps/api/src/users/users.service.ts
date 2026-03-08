import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, User } from '@crm/shared';
import * as argon2 from 'argon2';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  private tenantWhere(tenantId?: string) {
    return tenantId ? { OR: [{ tenant_id: tenantId }, { tenant_id: null }] } : {};
  }

  private async verifyTenantOwnership(id: string, tenantId?: string) {
    if (!tenantId) return;
    const user = await this.prisma.user.findUnique({ where: { id }, select: { tenant_id: true } });
    if (user?.tenant_id && user.tenant_id !== tenantId) {
      throw new ForbiddenException('Acesso negado a este recurso');
    }
  }

  async findAgents(tenantId?: string): Promise<{ id: string; name: string; specialties: string[] }[]> {
    return (this.prisma as any).user.findMany({
      where: this.tenantWhere(tenantId),
      select: { id: true, name: true, specialties: true },
      orderBy: { name: 'asc' },
    });
  }

  async findAll(tenantId?: string): Promise<Omit<User, 'password_hash'>[]> {
    const users = await (this.prisma as any).user.findMany({
      where: this.tenantWhere(tenantId),
      orderBy: { created_at: 'desc' },
      include: {
        inboxes: { select: { id: true, name: true } },
        sectors: { select: { id: true, name: true } },
        supervisors: { select: { id: true, name: true } },
      },
    });
    return users.map(({ password_hash, ...user }: any) => user);
  }

  async findOne(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findById(id: string, tenantId?: string): Promise<Omit<User, 'password_hash'> | null> {
    await this.verifyTenantOwnership(id, tenantId);
    const user = await (this.prisma as any).user.findUnique({
      where: { id },
      include: {
        inboxes: { select: { id: true, name: true } },
        sectors: { select: { id: true, name: true } },
      },
    });
    if (!user) return null;
    const { password_hash, ...result } = user as any;
    return result;
  }

  private async syncSector(userId: string, role: string) {
    if (role === 'ADMIN') {
      await (this.prisma as any).user.update({
        where: { id: userId },
        data: { sectors: { set: [] } },
      });
    } else {
      const sector = await (this.prisma as any).sector.findFirst({
        where: { name: { equals: role, mode: 'insensitive' } },
      });
      await (this.prisma as any).user.update({
        where: { id: userId },
        data: { sectors: { set: sector ? [{ id: sector.id }] : [] } },
      });
    }
  }

  async create(data: { name: string; email: string; password: string; role: string; tenant_id?: string; inboxIds?: string[]; phone?: string }): Promise<Omit<User, 'password_hash'>> {
    const password_hash = await argon2.hash(data.password);
    const user = await this.prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone || null,
        password_hash,
        role: data.role,
        tenant_id: data.tenant_id,
        inboxes: data.inboxIds ? { connect: data.inboxIds.map(id => ({ id })) } : undefined
      },
      include: { inboxes: { select: { id: true, name: true } } }
    });
    // Auto-sync department based on role
    await this.syncSector(user.id, data.role);
    const { password_hash: _, ...result } = user;
    return result as any;
  }

  async update(id: string, data: { name?: string; email?: string; role?: string; password?: string; inboxIds?: string[]; specialties?: string[]; phone?: string }, tenantId?: string): Promise<Omit<User, 'password_hash'>> {
    await this.verifyTenantOwnership(id, tenantId);
    const updateData: Prisma.UserUpdateInput = {};
    if (data.name) updateData.name = data.name;
    if (data.email) updateData.email = data.email;
    if (data.role) updateData.role = data.role;
    if (data.phone !== undefined) updateData.phone = data.phone || null;
    if (data.password) updateData.password_hash = await argon2.hash(data.password);
    if (data.specialties !== undefined) (updateData as any).specialties = { set: data.specialties };

    if (data.inboxIds) {
      updateData.inboxes = {
        set: data.inboxIds.map(id => ({ id }))
      };
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: updateData,
      include: { inboxes: { select: { id: true, name: true } } }
    });
    // Auto-sync department when role changes
    if (data.role) {
      await this.syncSector(id, data.role);
    }
    const { password_hash, ...result } = user;
    return result as any;
  }

  async remove(id: string, tenantId?: string): Promise<void> {
    await this.verifyTenantOwnership(id, tenantId);

    // Verificar se o usuario possui registros que impedem exclusao (FKs required)
    const [caseCount, createdEventCount] = await Promise.all([
      this.prisma.legalCase.count({ where: { lawyer_id: id } }),
      this.prisma.calendarEvent.count({ where: { created_by_id: id } }),
    ]);

    if (caseCount > 0) {
      throw new ForbiddenException(
        `Nao e possivel excluir: usuario possui ${caseCount} caso(s) juridico(s) como advogado. Reatribua os casos antes.`,
      );
    }
    if (createdEventCount > 0) {
      throw new ForbiddenException(
        `Nao e possivel excluir: usuario criou ${createdEventCount} evento(s) de calendario. Exclua ou reatribua os eventos antes.`,
      );
    }

    // Desassociar conversas atribuidas (SetNull via schema, mas limpar explicitamente)
    await this.prisma.conversation.updateMany({
      where: { assigned_user_id: id },
      data: { assigned_user_id: null },
    });

    // As demais relacoes (Task, TaskComment, CalendarEventComment, UserSchedule, AuditLog)
    // sao tratadas pelo onDelete: SetNull/Cascade no schema Prisma
    await this.prisma.user.delete({ where: { id } });
  }

  // ─── Lawyer / Intern helpers ──────────────────────────────────

  /** Lista advogados (users com specialties não-vazio) */
  async findLawyers(tenantId?: string) {
    return this.prisma.user.findMany({
      where: { specialties: { isEmpty: false }, ...this.tenantWhere(tenantId) },
      select: { id: true, name: true, specialties: true },
      orderBy: { name: 'asc' },
    });
  }

  /** Lista estagiários vinculados a um advogado */
  async findInterns(supervisorId: string) {
    return this.prisma.user.findMany({
      where: { supervisors: { some: { id: supervisorId } } },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    });
  }

  /** Define os supervisores (advogados) de um estagiário */
  async linkSupervisors(internId: string, lawyerIds: string[]) {
    return this.prisma.user.update({
      where: { id: internId },
      data: {
        supervisors: { set: lawyerIds.map(id => ({ id })) },
      },
      include: {
        supervisors: { select: { id: true, name: true } },
      },
    });
  }
}
