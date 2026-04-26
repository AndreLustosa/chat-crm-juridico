import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PortalAuthService } from './portal-auth.service';

/**
 * Guard pras rotas /portal/* — valida JWT do CLIENTE (audience='client').
 * Bloqueia tokens de advogado (audience ausente ou diferente).
 *
 * Token vem via cookie httpOnly `portal_token`. Aceita tambem header
 * `Authorization: Bearer ...` pra facilitar testes/Swagger.
 */
@Injectable()
export class ClientJwtAuthGuard implements CanActivate {
  constructor(
    private jwt: JwtService,
    private portalAuth: PortalAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const token = this.extractToken(req);
    if (!token) {
      throw new UnauthorizedException('Token nao fornecido');
    }

    let payload: any;
    try {
      payload = this.jwt.verify(token);
    } catch {
      throw new UnauthorizedException('Token invalido ou expirado');
    }

    if (payload.aud !== 'client') {
      // Token de advogado nao tem acesso a /portal — separacao de papeis
      throw new UnauthorizedException('Token nao autorizado pra portal do cliente');
    }

    const lead = await this.portalAuth.findLeadById(payload.sub);
    if (!lead) {
      throw new UnauthorizedException('Cliente nao encontrado');
    }

    // Disponibiliza no request.client pros controllers
    req.client = lead;
    return true;
  }

  private extractToken(req: any): string | null {
    // 1. Cookie httpOnly (caminho principal — usado pelo navegador)
    if (req.cookies?.portal_token) return req.cookies.portal_token;
    // 2. Authorization header (testes, mobile, integracoes)
    const auth = req.headers?.authorization;
    if (auth?.startsWith('Bearer ')) return auth.slice(7);
    return null;
  }
}
