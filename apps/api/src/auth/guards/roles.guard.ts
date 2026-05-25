import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    
    if (!requiredRoles) {
      return true;
    }
    
    const { user } = context.switchToHttp().getRequest();
    // Multi-role: verifica se QUALQUER role do usuário está na lista requerida
    const userRoles: string[] = Array.isArray(user?.roles) ? user.roles : (user?.role ? [user.role] : []);
    // SUPER_ADMIN (dono da plataforma) passa em qualquer @Roles — é admin++ global.
    // Reservado ao platform owner; nunca é atribuído pela UI de usuários.
    if (userRoles.includes('SUPER_ADMIN')) return true;
    return requiredRoles.some((role) => userRoles.includes(role));
  }
}
