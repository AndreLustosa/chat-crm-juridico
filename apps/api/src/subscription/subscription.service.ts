import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@crm/shared';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { SignupDto } from './dto/signup.dto';
import {
  evaluateSubscription,
  SAAS_SIGNUP_ENABLED,
  TRIAL_DAYS,
  SubscriptionEvaluation,
} from './subscription.util';

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  /**
   * Cadastro público (SaaS Fase 1). Cria um escritório (Tenant) + o usuário
   * ADMIN dono, em 15 dias de trial, e devolve o token (auto-login — mesmo
   * shape de /auth/login: { access_token, user }).
   *
   * Flag-gated por SAAS_SIGNUP_ENABLED (default OFF → 403). Assim o código
   * pode subir para produção sem expor o cadastro até a virada deliberada.
   *
   * NOTA RLS: quando TENANT_RLS_ENABLED for ligado (Fase 0.5b-2, hoje OFF),
   * o signup é uma operação de SISTEMA (cria um tenant NOVO, sem contexto de
   * tenant na request) e precisará rodar pelo caminho com bypass de RLS — o
   * mesmo tratamento dos crons/webhooks (ver tarefa #66). Com a RLS OFF (estado
   * atual) roda normalmente.
   */
  async signup(dto: SignupDto): Promise<{
    access_token: string;
    user: any;
    tenant: { id: string; name: string };
    subscription: SubscriptionEvaluation;
  }> {
    if (!SAAS_SIGNUP_ENABLED) {
      throw new ForbiddenException('Cadastro indisponível no momento.');
    }

    const email = dto.email.trim().toLowerCase();
    const officeName = dto.officeName.trim();
    const name = dto.name.trim();
    const phone = dto.phone?.trim() || null;

    // Pré-checagem amigável (a constraint @unique cobre a corrida).
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Já existe uma conta com este e-mail.');
    }

    const password_hash = await argon2.hash(dto.password);
    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

    let tenant: { id: string; name: string };
    let user: { id: string; email: string; roles: string[]; tenant_id: string };

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const createdTenant = await tx.tenant.create({
          data: {
            name: officeName,
            is_internal: false,
            subscription_status: 'TRIALING',
            trial_ends_at: trialEndsAt,
            plan: 'TRIAL',
          },
          select: { id: true, name: true },
        });

        const createdUser = await tx.user.create({
          data: {
            tenant_id: createdTenant.id,
            name,
            email,
            phone,
            password_hash,
            roles: ['ADMIN'],
          },
          select: { id: true, email: true, roles: true, tenant_id: true },
        });

        return { createdTenant, createdUser };
      });
      tenant = result.createdTenant;
      user = result.createdUser;
    } catch (e) {
      // Corrida no e-mail único → 409 amigável.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Já existe uma conta com este e-mail.');
      }
      throw e;
    }

    this.logger.log(
      `[SIGNUP] Novo escritório criado: tenant=${tenant.id} ("${tenant.name}") admin=${user.id} email=${email} trial_ends=${trialEndsAt.toISOString()}`,
    );

    // Auto-login (mesmo formato de AuthService.login).
    const tokenResp = await this.authService.login({
      id: user.id,
      email: user.email,
      roles: user.roles,
      tenant_id: user.tenant_id,
    });

    return {
      access_token: tokenResp.access_token,
      user: tokenResp.user,
      tenant,
      subscription: evaluateSubscription({
        is_internal: false,
        subscription_status: 'TRIALING',
        trial_ends_at: trialEndsAt,
        current_period_end: null,
        plan: 'TRIAL',
      }),
    };
  }

  /**
   * Estado da assinatura do tenant do usuário logado — alimenta o banner de
   * trial e a tela de bloqueio no frontend. Isento da trava (o usuário precisa
   * ver o status mesmo com a assinatura vencida).
   */
  async getForTenant(tenantId: string | null | undefined): Promise<SubscriptionEvaluation> {
    if (!tenantId) {
      throw new NotFoundException('Tenant não encontrado para o usuário atual.');
    }
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        is_internal: true,
        subscription_status: true,
        trial_ends_at: true,
        current_period_end: true,
        plan: true,
      },
    });
    if (!tenant) {
      throw new NotFoundException('Tenant não encontrado.');
    }
    return evaluateSubscription(tenant);
  }
}
