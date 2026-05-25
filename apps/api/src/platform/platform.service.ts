import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { evaluateSubscription } from '../subscription/subscription.util';

/**
 * Leitura do back-office da PLATAFORMA (SaaS), restrito ao SUPER_ADMIN.
 * Visao cross-tenant proposital (lista TODOS os escritorios) — por isso so o
 * dono acessa. Le apenas o banco da aplicacao; nunca toca em outros sistemas.
 *
 * Classificacao de status (adimplente/inadimplente/trial/etc.) reusa a funcao
 * pura evaluateSubscription — mesma fonte de verdade do SubscriptionGuard e do
 * GET /me/subscription, pra nao divergir.
 */
@Injectable()
export class PlatformService {
  constructor(private readonly prisma: PrismaService) {}

  /** Campos minimos de assinatura que evaluateSubscription precisa. */
  private readonly subFields = {
    is_internal: true,
    subscription_status: true,
    trial_ends_at: true,
    current_period_end: true,
    plan: true,
  } as const;

  /** Lista todos os escritorios com status de assinatura e metadados. */
  async listTenants() {
    const tenants = await (this.prisma as any).tenant.findMany({
      select: {
        id: true,
        name: true,
        cnpj: true,
        cpf: true,
        phone: true,
        ...this.subFields,
        _count: { select: { users: true } },
        // Proxy de "cadastrado em": o Tenant nao tem created_at, entao usamos a
        // criacao do usuario mais antigo (o admin que abriu o escritorio).
        users: { orderBy: { created_at: 'asc' }, take: 1, select: { created_at: true } },
      },
      orderBy: { name: 'asc' },
    });

    return tenants.map((t: any) => {
      const ev = evaluateSubscription(t);
      return {
        id: t.id,
        name: t.name,
        document: t.cnpj || t.cpf || null,
        document_type: t.cnpj ? 'CNPJ' : t.cpf ? 'CPF' : null,
        phone: t.phone ?? null,
        plan: t.plan ?? null,
        is_internal: t.is_internal,
        subscription_status: t.subscription_status,
        active: ev.active,
        reason: ev.reason,
        is_trial: ev.is_trial,
        days_remaining: ev.days_remaining,
        users_count: t._count?.users ?? 0,
        created_at: t.users?.[0]?.created_at ?? null,
      };
    });
  }

  /** Contadores agregados pro cabecalho do painel. */
  async getStats() {
    const tenants = await (this.prisma as any).tenant.findMany({ select: this.subFields });
    const now = new Date();

    const s = {
      total: 0,
      internos: 0,
      clientes: 0,
      ativos: 0,
      inativos: 0,
      adimplentes: 0,
      inadimplentes: 0,
      trial: 0,
      cancelados: 0,
    };

    for (const t of tenants) {
      s.total++;
      const ev = evaluateSubscription(t, now);
      if (ev.is_internal) s.internos++;
      if (ev.active) s.ativos++;
      else s.inativos++;

      // Adimplencia so faz sentido pra escritorios-clientes (nao-internos).
      if (!ev.is_internal) {
        if (ev.reason === 'ACTIVE') s.adimplentes++;
        else if (ev.reason === 'PAST_DUE') s.inadimplentes++;
        if (ev.is_trial && ev.active) s.trial++;
        if (ev.reason === 'CANCELED' || ev.reason === 'EXPIRED' || ev.reason === 'TRIAL_EXPIRED') s.cancelados++;
      }
    }
    s.clientes = s.total - s.internos;
    return s;
  }
}
