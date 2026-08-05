import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleAdsClientService } from './google-ads-client.service';

/**
 * Cron — cidade INFERIDA do lead pela localização física do clique (2026-08).
 *
 * Fase 2 do "mapa de leads" (banco primário, Ads fallback): pra leads que
 * vieram de clique pago (google_gclid) e NÃO têm cidade declarada
 * (address_city), busca a localização física do clique via
 * click_view.location_of_presence.city e grava em Lead.inferred_city/state.
 *
 * Restrições da API do Google (click_view):
 *   - só os últimos 90 dias de cliques;
 *   - cada query filtra UM dia (segments.date = 'YYYY-MM-DD').
 * Por isso agrupamos os leads elegíveis por data do clique (±1 dia p/ cobrir o
 * fuso da conta) e resolvemos o nome da cidade via geo_target_constant.
 *
 * Idempotente: só toca em leads com inferred_city NULL. NÃO sobrescreve
 * address_city (declarado, usado em documentos). Roda 04h30 Maceió + uma
 * passada ~2min após o boot pra não esperar a noite.
 */

const REGION_TO_UF: Record<string, string> = {
  acre: 'AC', alagoas: 'AL', amapa: 'AP', amazonas: 'AM', bahia: 'BA',
  ceara: 'CE', 'distrito federal': 'DF', 'espirito santo': 'ES', goias: 'GO',
  maranhao: 'MA', 'mato grosso': 'MT', 'mato grosso do sul': 'MS', 'minas gerais': 'MG',
  para: 'PA', paraiba: 'PB', parana: 'PR', pernambuco: 'PE', piaui: 'PI',
  'rio de janeiro': 'RJ', 'rio grande do norte': 'RN', 'rio grande do sul': 'RS',
  rondonia: 'RO', roraima: 'RR', 'santa catarina': 'SC', 'sao paulo': 'SP',
  sergipe: 'SE', tocantins: 'TO',
};
const norm = (s: string) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
function regionToUf(region: string): string | null {
  const r = norm(region).replace(/^state of /, '');
  return REGION_TO_UF[r] ?? null;
}

@Injectable()
export class LeadGeoBackfillCron implements OnModuleInit {
  private readonly logger = new Logger(LeadGeoBackfillCron.name);
  private running = false;

  constructor(
    private prisma: PrismaService,
    private clientSvc: GoogleAdsClientService,
  ) {}

  onModuleInit() {
    // Passada inicial ~2min após o boot (não bloqueia). Idempotente.
    setTimeout(() => {
      this.run().catch((e) =>
        this.logger.warn(`[lead-geo] boot run falhou: ${this.errMsg(e)}`),
      );
    }, 120_000);
  }

  @Cron('30 4 * * *', { name: 'lead-geo-backfill', timeZone: 'America/Maceio' })
  async run(): Promise<void> {
    if (this.running) {
      this.logger.log('[lead-geo] já rodando — pulando.');
      return;
    }
    this.running = true;
    const t0 = Date.now();
    try {
      const accounts = await this.prisma.trafficAccount.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, tenant_id: true },
      });
      let total = 0;
      for (const acc of accounts) {
        try {
          total += await this.backfillAccount(acc.tenant_id, acc.id);
        } catch (e: any) {
          this.logger.warn(
            `[lead-geo] tenant ${acc.tenant_id} falhou: ${this.errMsg(e)}`,
          );
        }
      }
      this.logger.log(
        `[lead-geo] concluído em ${Date.now() - t0}ms — ${total} lead(s) com cidade inferida.`,
      );
    } finally {
      this.running = false;
    }
  }

  private async backfillAccount(tenantId: string, accountId: string): Promise<number> {
    const today = new Date();
    const ninety = new Date(today);
    ninety.setUTCDate(ninety.getUTCDate() - 90);

    // Elegíveis: têm clique (gclid + data <90d), sem cidade declarada NEM inferida.
    const leads = await this.prisma.lead.findMany({
      where: {
        tenant_id: tenantId,
        google_gclid: { not: null },
        google_click_at: { gte: ninety },
        address_city: null,
        inferred_city: null,
      },
      select: { id: true, google_gclid: true, google_click_at: true },
      take: 2000,
    });
    if (leads.length === 0) return 0;

    // Datas a consultar (±1 dia por causa do fuso da conta), dentro dos 90d.
    const datesToQuery = new Set<string>();
    for (const l of leads) {
      if (!l.google_click_at) continue;
      for (const off of [-1, 0, 1]) {
        const d = new Date(l.google_click_at);
        d.setUTCDate(d.getUTCDate() + off);
        if (d > today || d < ninety) continue;
        datesToQuery.add(d.toISOString().slice(0, 10));
      }
    }
    if (datesToQuery.size === 0) return 0;

    const customer = await this.clientSvc.getCustomer(tenantId, accountId);

    // gclid → id da constante de cidade (localização física).
    const cityIdByGclid = new Map<string, string>();
    const cityIds = new Set<string>();
    for (const ds of datesToQuery) {
      let rows: any[] = [];
      try {
        rows = (await customer.query(`
          SELECT
            click_view.gclid,
            click_view.location_of_presence.city
          FROM click_view
          WHERE segments.date = '${ds}'
        `)) as any[];
      } catch (e: any) {
        this.logger.warn(`[lead-geo] click_view ${ds} falhou: ${this.errMsg(e)}`);
        continue;
      }
      for (const r of rows) {
        const gclid: string | undefined = r?.click_view?.gclid;
        const cityRes: string | undefined = r?.click_view?.location_of_presence?.city;
        if (!gclid || !cityRes) continue;
        cityIdByGclid.set(gclid, String(cityRes).split('/').pop() as string);
        cityIds.add(String(cityRes).split('/').pop() as string);
      }
    }
    if (cityIds.size === 0) return 0;

    const info = await this.resolveCities(customer, [...cityIds]);

    let filled = 0;
    for (const l of leads) {
      const cityId = l.google_gclid ? cityIdByGclid.get(l.google_gclid) : undefined;
      if (!cityId) continue;
      const ci = info.get(cityId);
      if (!ci) continue;
      await this.prisma.lead.update({
        where: { id: l.id },
        data: {
          inferred_city: ci.name.slice(0, 120),
          inferred_state: ci.uf,
          inferred_geo_at: new Date(),
        },
      });
      filled += 1;
    }
    if (filled) {
      this.logger.log(`[lead-geo] tenant ${tenantId}: ${filled} lead(s) inferido(s).`);
    }
    return filled;
  }

  /** Resolve ids de geo_target_constant → { nome, UF }. */
  private async resolveCities(
    customer: any,
    ids: string[],
  ): Promise<Map<string, { name: string; uf: string | null }>> {
    const map = new Map<string, { name: string; uf: string | null }>();
    if (ids.length === 0) return map;
    try {
      const cons = (await customer.query(`
        SELECT
          geo_target_constant.id,
          geo_target_constant.name,
          geo_target_constant.canonical_name
        FROM geo_target_constant
        WHERE geo_target_constant.id IN (${ids.join(', ')})
      `)) as any[];
      for (const c of cons) {
        const g = c?.geo_target_constant ?? {};
        const parts = String(g.canonical_name ?? '')
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean);
        const region = parts.length >= 2 ? parts[parts.length - 2] : '';
        map.set(String(g.id), {
          name: g.name ?? parts[0] ?? String(g.id),
          uf: regionToUf(region),
        });
      }
    } catch (e: any) {
      this.logger.warn(`[lead-geo] resolve cidades falhou: ${this.errMsg(e)}`);
    }
    return map;
  }

  private errMsg(e: any): string {
    try {
      if (!e) return 'erro desconhecido';
      if (Array.isArray(e.errors) && e.errors.length)
        return e.errors.map((x: any) => x?.message || JSON.stringify(x)).join(' | ');
      if (typeof e.message === 'string' && e.message) return e.message;
      const s = JSON.stringify(e);
      return s && s !== '{}' ? s.slice(0, 300) : String(e);
    } catch {
      return String(e);
    }
  }
}
