import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, User } from '@crm/shared';
import * as argon2 from 'argon2';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll(): Promise<Omit<User, 'password_hash'>[]> {
    const users = await this.prisma.user.findMany({
      orderBy: { created_at: 'desc' },
    });
    return users.map(({ password_hash, ...user }) => user);
  }

  async findOne(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findById(id: string): Promise<Omit<User, 'password_hash'> | null> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) return null;
    const { password_hash, ...result } = user;
    return result;
  }

  async create(data: { name: string; email: string; password: string; role: string; tenant_id?: string }): Promise<Omit<User, 'password_hash'>> {
    const password_hash = await argon2.hash(data.password);
    const user = await this.prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        password_hash,
        role: data.role,
        tenant_id: data.tenant_id,
      },
    });
    const { password_hash: _, ...result } = user;
    return result;
  }

  async update(id: string, data: { name?: string; email?: string; role?: string; password?: string }): Promise<Omit<User, 'password_hash'>> {
    const updateData: Prisma.UserUpdateInput = {};
    if (data.name) updateData.name = data.name;
    if (data.email) updateData.email = data.email;
    if (data.role) updateData.role = data.role;
    if (data.password) updateData.password_hash = await argon2.hash(data.password);

    const user = await this.prisma.user.update({
      where: { id },
      data: updateData,
    });
    const { password_hash, ...result } = user;
    return result;
  }

  async remove(id: string): Promise<void> {
    await this.prisma.user.delete({ where: { id } });
  }
}
