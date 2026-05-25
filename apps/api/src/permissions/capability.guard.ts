import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_CAPABILITY_KEY } from './require-capability.decorator';
import { Capability } from './permissions.constants';
import { PermissionsService } from './permissions.service';

/**
 * Guard global: so atua em rotas com @RequireCapability(...). Checa a capacidade
 * efetiva do tenant (matriz padrao + overrides). ADMIN sempre passa. Roda DEPOIS
 * do JwtAuthGuard (precisa de req.user). Rota sem @RequireCapability = no-op.
 */
@Injectable()
export class CapabilityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly perms: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const cap = this.reflector.getAllAndOverride<Capability | undefined>(REQUIRE_CAPABILITY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!cap) return true; // rota sem capacidade exigida -> nao interfere

    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (!user) return true; // sem usuario (publica) -> deixa os outros guards decidirem

    const roles: string[] = user.roles ?? [];
    if (roles.some((r) => (r ?? '').toUpperCase() === 'ADMIN')) return true; // ADMIN sempre

    const caps = await this.perms.getUserCapabilities(user.tenant_id, roles);
    if (caps.has(cap)) return true;
    throw new ForbiddenException(`Seu perfil nao tem acesso a esta area.`);
  }
}
