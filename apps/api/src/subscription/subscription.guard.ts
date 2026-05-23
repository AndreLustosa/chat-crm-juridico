import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { SUBSCRIPTION_EXEMPT_KEY } from './subscription-exempt.decorator';
import { evaluateSubscription, SAAS_GATING_ENABLED, SubscriptionEvaluation } from './subscription.util';

/**
 * Trava de assinatura (SaaS Fase 1). Bloqueia (HTTP 402) requests de tenants
 * cujo trial/assinatura expirou.
 *
 * Guard GLOBAL, registrado DEPOIS do JwtAuthGuard (precisa de req.user).
 *
 * Segurança em camadas — NUNCA bloqueia indevidamente:
 *   1. Flag SAAS_GATING_ENABLED OFF (default) → no-op total (zero efeito).
 *   2. Rotas @Public() (login, signup, webhooks) → ignora.
 *   3. Rotas @SubscriptionExempt() (/me/subscription, checkout) → ignora.
 *   4. Prefixos de sistema (/auth, /portal, /health) → ignora.
 *   5. Sem tenant_id na request → ignora (deixa outros guards decidirem).
 *   6. is_internal / ACTIVE / TRIAL válido → libera.
 *   7. Tenant inexistente (anomalia de dado) → fail-OPEN (libera). Esta é uma
 *      trava de cobrança, não a fronteira de segurança (essa é o isolamento de
 *      tenant). Fail-open evita derrubar o dono por um glitch.
 *
 * Cache em memória (TTL 60s) evita 1 query por request. Mudanças de status
 * (ex.: pagamento confirmado na Fase 2) propagam em até 60s.
 */
const SKIP_PREFIXES = ['/auth', '/portal', '/health'];
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 5000;

@Injectable()
export class SubscriptionGuard implements CanActivate {
  private readonly cache = new Map<string, { eval: SubscriptionEvaluation; exp: number }>();

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!SAAS_GATING_ENABLED) return true; // (1) flag OFF — no-op

    const targets = [context.getHandler(), context.getClass()];

    // (2) rotas públicas
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    // (3) rotas isentas da trava
    if (this.reflector.getAllAndOverride<boolean>(SUBSCRIPTION_EXEMPT_KEY, targets)) return true;

    const req = context.switchToHttp().getRequest();

    // (4) prefixos de sistema (defesa em profundidade)
    const path: string = req.path || req.url || '';
    if (SKIP_PREFIXES.some((p) => path.startsWith(p))) return true;

    // (5) sem tenant → não é nosso caso
    const tenantId: string | undefined = req.user?.tenant_id;
    if (!tenantId) return true;

    const evaluation = await this.getEvaluation(tenantId);
    if (evaluation.active) return true; // (6)

    // (7) bloqueio: 402. O AllExceptionsFilter achata para { statusCode, message }
    // → o frontend detecta pelo status 402.
    throw new HttpException(
      evaluation.is_trial
        ? 'Seu período de teste terminou. Assine um plano para continuar usando o sistema.'
        : 'Sua assinatura está inativa. Regularize o pagamento para continuar usando o sistema.',
      HttpStatus.PAYMENT_REQUIRED,
    );
  }

  private async getEvaluation(tenantId: string): Promise<SubscriptionEvaluation> {
    const now = Date.now();
    const hit = this.cache.get(tenantId);
    if (hit && hit.exp > now) return hit.eval;

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

    // Fail-open: tenant inexistente → trata como ativo (não bloqueia).
    const evaluation = tenant
      ? evaluateSubscription(tenant)
      : evaluateSubscription({ is_internal: true, subscription_status: 'ACTIVE', trial_ends_at: null });

    if (this.cache.size > CACHE_MAX_ENTRIES) this.cache.clear();
    this.cache.set(tenantId, { eval: evaluation, exp: now + CACHE_TTL_MS });
    return evaluation;
  }
}
