import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService
  ) {}

  async validateUser(email: string, pass: string): Promise<any> {
    const user = await this.usersService.findOne(email);
    if (user && await argon2.verify(user.password_hash, pass)) {
      const { password_hash, ...result } = user;
      return result;
    }
    return null;
  }

  async login(user: any) {
    // Multi-role: roles é array. Fallback se vazio ou ausente.
    const roles: string[] = (Array.isArray(user.roles) && user.roles.length > 0)
      ? user.roles
      : (user.role ? [user.role] : ['OPERADOR']);
    const payload = { email: user.email, sub: user.id, roles, tenant_id: user.tenant_id };
    return {
      access_token: this.jwtService.sign(payload),
      user: payload
    };
  }

  async generateMcpToken(user: any) {
    const roles: string[] = (Array.isArray(user.roles) && user.roles.length > 0)
      ? user.roles
      : (user.role ? [user.role] : ['OPERADOR']);
    const payload = { email: user.email, sub: user.id, roles, tenant_id: user.tenant_id };
    const mcp_token = this.jwtService.sign(payload, { expiresIn: '365d' });
    return { mcp_token };
  }
}
