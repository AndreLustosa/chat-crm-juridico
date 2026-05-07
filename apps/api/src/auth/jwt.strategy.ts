import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
import { getJwtSecret } from '../common/utils/jwt-secret.util';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      // Aceita JWT em 2 lugares:
      //   1. Header Authorization: Bearer ... (padrão pra chamadas API normais)
      //   2. ?token=... na query string (necessário pra <video src> nativo,
      //      <img src>, downloads — onde o browser não permite custom headers)
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        ExtractJwt.fromUrlQueryParameter('token'),
      ]),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(),
    });
  }

  async validate(payload: any) {
    // Backward compat: tokens antigos têm role (string), novos têm roles (array)
    const roles: string[] = Array.isArray(payload.roles)
      ? payload.roles
      : (payload.role ? [payload.role] : ['OPERADOR']);
    return { id: payload.sub, email: payload.email, roles, role: roles[0], tenant_id: payload.tenant_id };
  }
}
