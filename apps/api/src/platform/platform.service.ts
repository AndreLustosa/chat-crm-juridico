import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { evaluateSubscription, TRIAL_DAYS } from '../subscription/subscription.util';

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
        suspended_at: true,
        deletion_scheduled_at: true,
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
        suspended_at: t.suspended_at ?? null,
        deletion_scheduled_at: t.deletion_scheduled_at ?? null,
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

  // ─── Gestão (Fase 3): suspender / reativar / agendar exclusão ──────────────
  private readonly GRACE_DAYS = 7;

  /** Carrega o tenant alvo aplicando as protecoes: nunca interno, nunca o proprio. */
  private async loadTarget(tenantId: string, actorTenantId?: string) {
    const t = await (this.prisma as any).tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true, name: true, is_internal: true,
        subscription_status: true, suspended_at: true,
        prev_subscription_status: true, deletion_scheduled_at: true,
      },
    });
    if (!t) throw new NotFoundException('Escritorio nao encontrado.');
    if (t.is_internal) throw new BadRequestException('Escritorios internos nao podem ser suspensos ou excluidos.');
    if (actorTenantId && tenantId === actorTenantId) {
      throw new BadRequestException('Voce nao pode suspender ou excluir o proprio escritorio.');
    }
    return t;
  }

  /** Suspende o acesso do escritorio (reversivel; dados intactos). */
  async suspend(tenantId: string, actorTenantId?: string) {
    const t = await this.loadTarget(tenantId, actorTenantId);
    if (t.subscription_status === 'SUSPENDED') return { ok: true, already: true };
    await (this.prisma as any).tenant.update({
      where: { id: tenantId },
      data: {
        prev_subscription_status: t.subscription_status,
        subscription_status: 'SUSPENDED',
        suspended_at: new Date(),
      },
    });
    return { ok: true };
  }

  /** Reativa (restaura o status anterior; tambem cancela qualquer exclusao agendada). */
  async reactivate(tenantId: string, actorTenantId?: string) {
    const t = await this.loadTarget(tenantId, actorTenantId);
    await (this.prisma as any).tenant.update({
      where: { id: tenantId },
      data: {
        subscription_status: t.prev_subscription_status || 'ACTIVE',
        suspended_at: null,
        prev_subscription_status: null,
        deletion_scheduled_at: null,
      },
    });
    return { ok: true };
  }

  /** Agenda a exclusao (suspende ja + marca purga apos a carencia). Exige o nome exato. */
  async scheduleDeletion(tenantId: string, confirmName: string, actorTenantId?: string) {
    const t = await this.loadTarget(tenantId, actorTenantId);
    if ((confirmName || '').trim() !== t.name) {
      throw new BadRequestException('Confirmacao invalida: digite o nome exato do escritorio.');
    }
    const scheduled = new Date(Date.now() + this.GRACE_DAYS * 24 * 60 * 60 * 1000);
    const alreadySuspended = t.subscription_status === 'SUSPENDED';
    await (this.prisma as any).tenant.update({
      where: { id: tenantId },
      data: {
        deletion_scheduled_at: scheduled,
        // agendar exclusao ja corta o acesso; preserva o status real para um eventual cancel+reativar
        prev_subscription_status: alreadySuspended ? t.prev_subscription_status : t.subscription_status,
        subscription_status: 'SUSPENDED',
        suspended_at: t.suspended_at ?? new Date(),
      },
    });
    return { ok: true, deletion_scheduled_at: scheduled.toISOString(), grace_days: this.GRACE_DAYS };
  }

  /** Cancela a exclusao agendada (mantem suspenso; reative a parte se quiser). */
  async cancelDeletion(tenantId: string, actorTenantId?: string) {
    await this.loadTarget(tenantId, actorTenantId);
    await (this.prisma as any).tenant.update({
      where: { id: tenantId },
      data: { deletion_scheduled_at: null },
    });
    return { ok: true };
  }

  // ─── Provisionamento (Fase 4): criar escritorio + admin via CONVITE ─────────
  private readonly INVITE_DAYS = 7;

  /**
   * Cria um novo escritorio + usuario ADMIN SEM senha, gerando um token de
   * convite. O admin define a propria senha pelo link (o dono nunca a conhece).
   * Sem auto-login. Trial padrao (mesma regra do signup publico).
   */
  async createTenant(input: {
    officeName?: string; name?: string; email?: string; cnpj?: string; cpf?: string; phone?: string;
  }) {
    const officeName = (input.officeName ?? '').trim();
    const adminName = (input.name ?? '').trim();
    const email = (input.email ?? '').trim().toLowerCase();
    if (!officeName || !adminName || !email) {
      throw new BadRequestException('Preencha o escritorio, o nome do admin e o e-mail.');
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new BadRequestException('E-mail invalido.');
    }

    const existing = await (this.prisma as any).user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new ConflictException('Ja existe uma conta com este e-mail.');

    const inviteToken = randomBytes(24).toString('hex');
    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    const inviteExpiresAt = new Date(Date.now() + this.INVITE_DAYS * 24 * 60 * 60 * 1000);
    const phone = input.phone?.trim() || null;

    try {
      const tenant = await (this.prisma as any).$transaction(async (tx: any) => {
        const t = await tx.tenant.create({
          data: {
            name: officeName,
            cnpj: input.cnpj?.trim() || null,
            cpf: input.cpf?.trim() || null,
            phone,
            is_internal: false,
            subscription_status: 'TRIALING',
            trial_ends_at: trialEndsAt,
            plan: 'TRIAL',
          },
          select: { id: true, name: true },
        });
        await tx.user.create({
          data: {
            tenant_id: t.id,
            name: adminName,
            email,
            phone,
            password_hash: null, // sem senha ate o convite ser resgatado
            invite_token: inviteToken,
            invite_expires_at: inviteExpiresAt,
            roles: ['ADMIN'],
          },
        });
        return t;
      });
      return {
        ok: true,
        id: tenant.id,
        name: tenant.name,
        inviteToken,
        inviteExpiresAt: inviteExpiresAt.toISOString(),
      };
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException('Ja existe uma conta com este e-mail.');
      throw e;
    }
  }
}
