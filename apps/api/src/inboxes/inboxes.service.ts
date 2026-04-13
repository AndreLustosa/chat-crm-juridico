import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class InboxesService {
  constructor(private prisma: PrismaService) {}

  private get inbox() {
    return (this.prisma as any).inbox;
  }

  private get instance() {
    return (this.prisma as any).instance;
  }

  async findAllOperators() {
    const [inboxes, sectors, allEligible, allOperators] = await Promise.all([
      this.inbox.findMany({
        include: { users: { select: { id: true, name: true } } },
      }),
      (this.prisma as any).sector.findMany({
        include: { users: { select: { id: true, name: true } } },
        orderBy: { name: 'asc' },
      }),
      // Todos os usuários elegíveis (para grupo "Equipe" genérico)
      (this.prisma as any).user.findMany({
        where: { roles: { hasSome: ['OPERADOR', 'ADVOGADO', 'ADMIN'] } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      // Operadores que não estão em nenhum inbox (ex: advogada com perfil operador)
      // Devem aparecer na seção comercial mesmo se estiverem em um setor de advogados
      (this.prisma as any).user.findMany({
        where: { roles: { has: 'OPERADOR' } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    const inboxGroups = inboxes.map((inbox: any) => ({
      id: inbox.id,
      name: inbox.name,
      type: 'INBOX' as const,
      auto_route: false,
      users: inbox.users as { id: string; name: string }[],
    }));

    const sectorGroups = sectors.map((sector: any) => ({
      id: sector.id,
      name: sector.name,
      type: 'SECTOR' as const,
      auto_route: sector.auto_route ?? false,
      users: sector.users as { id: string; name: string }[],
    }));

    const inboxUserIds = new Set(inboxes.flatMap((i: any) => (i.users || []).map((u: any) => u.id)));
    const sectorUserIds = new Set(sectors.flatMap((s: any) => (s.users || []).map((u: any) => u.id)));

    // Operadores que não estão em nenhum inbox devem aparecer no grupo Equipe
    // (mesmo que estejam em um setor de advogados — o papel OPERADOR garante visibilidade comercial)
    const operatorsNotInInbox = (allOperators as { id: string; name: string }[]).filter(
      u => !inboxUserIds.has(u.id),
    );

    // Demais elegíveis que não estão em nenhum inbox nem setor
    const ungroupedOther = (allEligible as { id: string; name: string }[]).filter(
      u => !inboxUserIds.has(u.id) && !sectorUserIds.has(u.id),
    );

    // Unir sem duplicatas
    const teamMap = new Map<string, { id: string; name: string }>();
    for (const u of [...operatorsNotInInbox, ...ungroupedOther]) teamMap.set(u.id, u);
    const teamUsers = Array.from(teamMap.values()).sort((a, b) => a.name.localeCompare(b.name));

    const result = [...inboxGroups, ...sectorGroups];

    if (teamUsers.length > 0) {
      result.push({
        id: '__team__',
        name: 'Equipe',
        type: 'SECTOR' as const,
        auto_route: false,
        users: teamUsers,
      });
    }

    return result;
  }

  async findAll(tenantId?: string, userId?: string) {
    return this.inbox.findMany({
      where: { 
        tenant_id: tenantId,
        users: userId ? { some: { id: userId } } : undefined
      },
      include: {
        instances: true,
        users: { select: { id: true, name: true, email: true } },
        _count: {
          select: { users: true, conversations: true }
        }
      }
    });
  }

  async findOne(id: string) {
    const inbox = await this.inbox.findUnique({
      where: { id },
      include: {
        instances: true,
        users: { select: { id: true, name: true, email: true } }
      }
    });

    if (!inbox) throw new NotFoundException('Inbox não encontrada');
    return inbox;
  }

  async create(data: { name: string; tenant_id?: string }) {
    return this.inbox.create({
      data,
      include: {
        instances: true,
        users: { select: { id: true, name: true, email: true } },
        _count: {
          select: { users: true, conversations: true }
        }
      }
    });
  }

  async update(id: string, data: { name?: string }) {
    return this.inbox.update({
      where: { id },
      data
    });
  }

  async remove(id: string) {
    // Desassociar conversas e instancias antes de deletar
    // (onDelete: SetNull no schema cuida disso, mas garantimos manualmente)
    await Promise.all([
      (this.prisma as any).conversation.updateMany({
        where: { inbox_id: id },
        data: { inbox_id: null },
      }),
      (this.prisma as any).instance.updateMany({
        where: { inbox_id: id },
        data: { inbox_id: null },
      }),
    ]);
    return this.inbox.delete({ where: { id } });
  }

  // --- Gestão de Usuários no Setor ---

  async addUser(inboxId: string, userId: string) {
    return this.inbox.update({
      where: { id: inboxId },
      data: {
        users: { connect: { id: userId } }
      }
    });
  }

  async removeUser(inboxId: string, userId: string) {
    return this.inbox.update({
      where: { id: inboxId },
      data: {
        users: { disconnect: { id: userId } }
      }
    });
  }

  // --- Gestão de Instâncias ---

  async addInstance(inboxId: string, instanceName: string, type: 'whatsapp' | 'instagram') {
    // Verifica se a instância já está vinculada a outro inbox
    const existing = await this.instance.findUnique({ where: { name: instanceName } });
    if (existing?.inbox_id && existing.inbox_id !== inboxId) {
      const otherInbox = await this.inbox.findUnique({ where: { id: existing.inbox_id }, select: { name: true } });
      throw new ConflictException(
        `A instância "${instanceName}" já está vinculada ao setor "${otherInbox?.name ?? existing.inbox_id}". Remova-a de lá primeiro.`
      );
    }

    // 1. Vincula a instância ao setor
    const instance = await this.instance.upsert({
      where: { name: instanceName },
      update: { inbox_id: inboxId, type },
      create: {
        name: instanceName,
        type,
        inbox_id: inboxId
      }
    });

    // 2. MIGRACAO: Vincula todas as conversas existentes desta instancia ao novo setor
    // Isso garante que contatos antigos "apareçam" no novo setor imediatamente
    await (this.prisma as any).conversation.updateMany({
      where: { instance_name: instanceName },
      data: { inbox_id: inboxId }
    });

    return instance;
  }

  async findByInstanceName(instanceName: string) {
    return this.instance.findUnique({
      where: { name: instanceName },
      include: { inbox: true }
    });
  }

  /**
   * Round-robin: retorna o ID do próximo operador do inbox.
   * Usa $transaction para evitar double-assign em chamadas paralelas.
   * Retorna null se o inbox não tiver operadores cadastrados.
   *
   * @param onlineUserIds Se fornecido, filtra apenas operadores online.
   *                      Retorna null se nenhum operador online estiver no inbox.
   */
  async getNextAssignee(inboxId: string, onlineUserIds?: string[]): Promise<string | null> {
    return (this.prisma as any).$transaction(async (tx: any) => {
      const inbox = await tx.inbox.findUnique({
        where: { id: inboxId },
        include: { users: { select: { id: true }, orderBy: { id: 'asc' } } },
      });

      if (!inbox?.users?.length) return null;

      // Filtra por operadores online (se fornecido)
      let users: { id: string }[] = inbox.users;
      if (onlineUserIds) {
        users = users.filter((u: any) => onlineUserIds.includes(u.id));
        if (users.length === 0) return null; // Ninguém online neste inbox
      }

      // Round-robin sobre os operadores disponíveis
      const currentIdx = inbox.rr_pointer
        ? users.findIndex((u: any) => u.id === inbox.rr_pointer)
        : -1;
      const nextIdx = (currentIdx + 1) % users.length;
      const nextUser = users[nextIdx];

      await tx.inbox.update({
        where: { id: inboxId },
        data: { rr_pointer: nextUser.id },
      });

      return nextUser.id;
    });
  }
}
