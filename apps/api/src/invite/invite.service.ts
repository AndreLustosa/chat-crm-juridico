import { Injectable, NotFoundException, BadRequestException, GoneException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Resgate de convite de novo escritorio. O admin convidado define a propria
 * senha pelo link — o dono (SUPER_ADMIN) nunca conhece a senha do cliente.
 */
@Injectable()
export class InviteService {
  constructor(private readonly prisma: PrismaService) {}

  /** Valida o token (existe + nao expirou) e devolve dados pra tela "definir senha". */
  async validate(token: string) {
    const user = await (this.prisma as any).user.findUnique({
      where: { invite_token: token },
      select: {
        id: true,
        name: true,
        email: true,
        invite_expires_at: true,
        tenant: { select: { name: true } },
      },
    });
    if (!user) throw new NotFoundException('Convite invalido ou ja utilizado.');
    if (user.invite_expires_at && new Date(user.invite_expires_at) < new Date()) {
      throw new GoneException('Convite expirado. Peca um novo ao administrador.');
    }
    return { valid: true, name: user.name, email: user.email, officeName: user.tenant?.name ?? null };
  }

  /** Resgata: define a senha (argon2) e invalida o token (uso unico). */
  async redeem(token: string, password: string) {
    if (!password || password.length < 8) {
      throw new BadRequestException('A senha deve ter ao menos 8 caracteres.');
    }
    const user = await (this.prisma as any).user.findUnique({
      where: { invite_token: token },
      select: { id: true, invite_expires_at: true },
    });
    if (!user) throw new NotFoundException('Convite invalido ou ja utilizado.');
    if (user.invite_expires_at && new Date(user.invite_expires_at) < new Date()) {
      throw new GoneException('Convite expirado. Peca um novo ao administrador.');
    }
    const password_hash = await argon2.hash(password);
    await (this.prisma as any).user.update({
      where: { id: user.id },
      data: { password_hash, invite_token: null, invite_expires_at: null },
    });
    return { ok: true };
  }
}
