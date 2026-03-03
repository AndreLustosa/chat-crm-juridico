import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, User } from '@crm/shared';
import * as argon2 from 'argon2';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAgents(): Promise<{ id: string; name: string }[]> {
    return (this.prisma as any).user.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async findAll(): Promise<Omit<User, 'password_hash'>[]> {
    const users = await (this.prisma as any).user.findMany({
      orderBy: { created_at: 'desc' },
      include: {
        inboxes: { select: { id: true, name: true } },
        sectors: { select: { id: true, name: true } },
      },
    });
    return users.map(({ password_hash, ...user }: any) => user);
  }

  async findOne(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findById(id: string): Promise<Omit<User, 'password_hash'> | null> {
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

  async create(data: { name: string; email: string; password: string; role: string; tenant_id?: string; inboxIds?: string[] }): Promise<Omit<User, 'password_hash'>> {
    const password_hash = await argon2.hash(data.password);
    const user = await this.prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
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

  async update(id: string, data: { name?: string; email?: string; role?: string; password?: string; inboxIds?: string[]; specialties?: string[] }): Promise<Omit<User, 'password_hash'>> {
    const updateData: Prisma.UserUpdateInput = {};
    if (data.name) updateData.name = data.name;
    if (data.email) updateData.email = data.email;
    if (data.role) updateData.role = data.role;
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

  async remove(id: string): Promise<void> {
    await this.prisma.user.delete({ where: { id } });
  }
}
