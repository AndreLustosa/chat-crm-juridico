import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../gateway/chat.gateway';

/**
 * Presença de usuários: quem está com o sistema aberto AGORA (socket app-wide
 * montado na sidebar → conecta em qualquer página) + histórico de
 * conexão/desconexão (UserConnectionLog, gravado pelo ChatGateway).
 */
@Injectable()
export class PresenceService {
  constructor(
    private prisma: PrismaService,
    private gateway: ChatGateway,
  ) {}

  /** Usuários do tenant atualmente online (escopo do tenant). */
  async getOnline(tenantId: string) {
    const ids = this.gateway.getOnlineUserIds();
    if (ids.length === 0) return [];
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids }, tenant_id: tenantId },
      select: { id: true, name: true, email: true, roles: true },
    });
    return users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      roles: u.roles,
    }));
  }

  /** Histórico de conexão/desconexão (admin). Mais recentes primeiro. */
  async getLog(
    tenantId: string,
    opts: { limit?: number; userId?: string } = {},
  ) {
    const take = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const logs = await this.prisma.userConnectionLog.findMany({
      where: {
        tenant_id: tenantId,
        ...(opts.userId ? { user_id: opts.userId } : {}),
      },
      orderBy: { at: 'desc' },
      take,
      include: { user: { select: { name: true, roles: true } } },
    });
    return logs.map((l) => ({
      id: l.id,
      userId: l.user_id,
      userName: l.user?.name ?? '—',
      roles: l.user?.roles ?? [],
      event: l.event,
      at: l.at,
    }));
  }
}
