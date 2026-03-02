import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SectorsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return (this.prisma as any).sector.findMany({
      include: { users: { select: { id: true, name: true, email: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async create(name: string, autoRoute = false) {
    return (this.prisma as any).sector.create({ data: { name, auto_route: autoRoute } });
  }

  async update(id: string, name: string, autoRoute?: boolean) {
    const data: any = { name };
    if (autoRoute !== undefined) data.auto_route = autoRoute;
    return (this.prisma as any).sector.update({ where: { id }, data });
  }

  async remove(id: string) {
    return (this.prisma as any).sector.delete({ where: { id } });
  }

  async addUser(sectorId: string, userId: string) {
    return (this.prisma as any).sector.update({
      where: { id: sectorId },
      data: { users: { connect: { id: userId } } },
    });
  }

  async removeUser(sectorId: string, userId: string) {
    return (this.prisma as any).sector.update({
      where: { id: sectorId },
      data: { users: { disconnect: { id: userId } } },
    });
  }
}
