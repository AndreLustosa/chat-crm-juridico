import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const SUPER_ADMIN = 'SUPER_ADMIN';

/**
 * Promove o(s) dono(s) da plataforma a SUPER_ADMIN no boot, de forma idempotente.
 *
 * Quem: e-mails em PLATFORM_OWNER_EMAIL (separados por virgula).
 * Por que no boot: SUPER_ADMIN da poder de gerenciar/excluir QUALQUER escritorio,
 * entao nunca e atribuivel pela UI de usuarios — a designacao vive na infra (env),
 * fora do alcance de qualquer admin de escritorio-cliente.
 *
 * Idempotente: so adiciona o papel a quem ainda nao o tem; nunca remove nada.
 * Match de e-mail case-insensitive (o env pode divergir do case gravado no banco).
 */
@Injectable()
export class PlatformBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(PlatformBootstrapService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    const emails = (process.env.PLATFORM_OWNER_EMAIL || '')
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);

    if (emails.length === 0) {
      this.logger.warn(
        'PLATFORM_OWNER_EMAIL nao definido — nenhum SUPER_ADMIN promovido. ' +
          'As rotas de infra global (Evolution, chaves de IA) ficam inacessiveis ate definir a env.',
      );
      return;
    }

    for (const email of emails) {
      try {
        const user = await this.prisma.user.findFirst({
          where: { email: { equals: email, mode: 'insensitive' } },
          select: { id: true, email: true, roles: true },
        });
        if (!user) {
          this.logger.warn(`PLATFORM_OWNER_EMAIL: usuario "${email}" nao encontrado.`);
          continue;
        }
        if (user.roles?.includes(SUPER_ADMIN)) {
          this.logger.log(`Platform owner ${user.email} ja e SUPER_ADMIN.`);
          continue;
        }
        await this.prisma.user.update({
          where: { id: user.id },
          data: { roles: { push: SUPER_ADMIN } },
        });
        this.logger.log(`Platform owner ${user.email} promovido a SUPER_ADMIN.`);
      } catch (e: any) {
        this.logger.error(`Falha ao promover "${email}" a SUPER_ADMIN: ${e?.message ?? e}`);
      }
    }
  }
}
