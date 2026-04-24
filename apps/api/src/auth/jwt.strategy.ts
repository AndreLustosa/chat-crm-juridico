import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    const secret = process.env.JWT_SECRET;
    if (!secret && process.env.NODE_ENV === 'production') {
      new Logger('JwtStrategy').error('FATAL: JWT_SECRET não definido em produção!');
      process.exit(1);
    }
    if (!secret) {
      new Logger('JwtStrategy').warn('⚠️  JWT_SECRET não definido! Usando fallback INSEGURO.');
    }
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
      secretOrKey: secret || '__INSECURE_DEV_FALLBACK_CHANGE_ME__',
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
