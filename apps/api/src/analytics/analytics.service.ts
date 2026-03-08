import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BetaAnalyticsDataClient } from '@google-analytics/data';

export class TrackEventDto {
  page_path: string;
  event_type: 'view' | 'whatsapp_click';
  visitor_id?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  gclid?: string;
  referrer?: string;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private prisma: PrismaService) {}

  // ── Helpers para globalSetting ────────────────────────────────────────────

  private async getSetting(key: string): Promise<string | null> {
    const row = await this.prisma.globalSetting.findUnique({ where: { key } });
    return row?.value || null;
  }

  private async upsertSetting(key: string, value: string): Promise<void> {
    await this.prisma.globalSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }

  // ── GA4 Config (banco) ────────────────────────────────────────────────────

  async getGa4Config(): Promise<{ isConfigured: boolean; propertyId: string | null }> {
    const propertyId = await this.getSetting('GA4_PROPERTY_ID');
    const b64 = await this.getSetting('GA4_SERVICE_ACCOUNT_B64');
    // Remove o prefixo "properties/" para mostrar só o número na UI
    const numericId = propertyId ? propertyId.replace('properties/', '') : null;
    return { isConfigured: !!(propertyId && b64), propertyId: numericId };
  }

  async saveGa4Config(propertyId: string, serviceAccountJson: string): Promise<void> {
    // Valida o JSON (lança se inválido)
    JSON.parse(serviceAccountJson);
    const b64 = Buffer.from(serviceAccountJson).toString('base64');
    const fullPropertyId = propertyId.startsWith('properties/')
      ? propertyId
      : `properties/${propertyId}`;
    await this.upsertSetting('GA4_PROPERTY_ID', fullPropertyId);
    await this.upsertSetting('GA4_SERVICE_ACCOUNT_B64', b64);
  }

  // ── LP Tracking ───────────────────────────────────────────────────────────

  async track(dto: TrackEventDto) {
    await this.prisma.lpEvent.create({ data: dto });
    return { ok: true };
  }

  /** Detecta a fonte de tráfego com fallback para referrer */
  private detectSource(e: { gclid?: string | null; utm_source?: string | null; referrer?: string | null }): string {
    if (e.gclid) return 'google_ads';
    if (e.utm_source) return e.utm_source.toLowerCase();
    if (e.referrer) {
      const ref = e.referrer.toLowerCase();
      if (ref.includes('google.'))      return 'google_organico';
      if (ref.includes('bing.')  || ref.includes('yahoo.') || ref.includes('duckduckgo.')) return 'busca_organica';
      if (ref.includes('facebook.') || ref.includes('fb.com')) return 'facebook';
      if (ref.includes('instagram.')) return 'instagram';
      if (ref.includes('linkedin.'))  return 'linkedin';
      if (ref.includes('twitter.')  || ref.includes('x.com')) return 'twitter';
      if (ref.includes('youtube.'))   return 'youtube';
      if (ref.includes('whatsapp.'))  return 'whatsapp';
      return 'referencia'; // outro site externo
    }
    return 'direto'; // URL digitada diretamente ou sem referrer
  }

  async getPages() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    // Query única — agrega tudo em memória (muito mais eficiente que N+1)
    const events = await this.prisma.lpEvent.findMany({
      where: { created_at: { gte: thirtyDaysAgo } },
      select: { page_path: true, event_type: true, utm_source: true, gclid: true, referrer: true, created_at: true },
      orderBy: { created_at: 'asc' },
    });

    type PageAgg = {
      views30: number; clicks30: number;
      views7: number; clicks7: number; viewsPrev7: number;
      sourceMap: Record<string, number>;
      dayMap: Record<string, { views: number; clicks: number }>;
    };
    const pageMap: Record<string, PageAgg> = {};

    for (const e of events) {
      if (!pageMap[e.page_path]) {
        const dayMap: Record<string, { views: number; clicks: number }> = {};
        for (let i = 6; i >= 0; i--) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          dayMap[d.toISOString().slice(0, 10)] = { views: 0, clicks: 0 };
        }
        pageMap[e.page_path] = { views30: 0, clicks30: 0, views7: 0, clicks7: 0, viewsPrev7: 0, sourceMap: {}, dayMap };
      }
      const p = pageMap[e.page_path];
      const isView = e.event_type === 'view';
      const isClick = e.event_type === 'whatsapp_click';
      const inLast7 = e.created_at >= sevenDaysAgo;
      const inPrev7 = e.created_at >= fourteenDaysAgo && e.created_at < sevenDaysAgo;

      if (isView) { p.views30++; if (inLast7) p.views7++; if (inPrev7) p.viewsPrev7++; }
      if (isClick) { p.clicks30++; if (inLast7) p.clicks7++; }

      const source = this.detectSource(e);
      p.sourceMap[source] = (p.sourceMap[source] || 0) + 1;

      if (inLast7) {
        const day = e.created_at.toISOString().slice(0, 10);
        if (p.dayMap[day]) {
          if (isView) p.dayMap[day].views++;
          if (isClick) p.dayMap[day].clicks++;
        }
      }
    }

    return Object.entries(pageMap)
      .map(([page_path, data]) => {
        const top_source = Object.entries(data.sourceMap).sort((a, b) => b[1] - a[1])[0]?.[0] || 'organico';
        const by_day = Object.entries(data.dayMap).map(([date, counts]) => ({ date, ...counts }));
        const trend = data.viewsPrev7 > 0
          ? Math.round(((data.views7 - data.viewsPrev7) / data.viewsPrev7) * 100)
          : data.views7 > 0 ? 100 : 0;
        return {
          page_path,
          views: data.views30,
          clicks: data.clicks30,
          conversion_rate: data.views30 > 0 ? ((data.clicks30 / data.views30) * 100).toFixed(1) + '%' : '0%',
          top_source,
          by_day,
          trend,
        };
      })
      .sort((a, b) => b.views - a.views);
  }

  async getPageDetail(page_path: string) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const events = await this.prisma.lpEvent.findMany({
      where: { page_path, created_at: { gte: thirtyDaysAgo } },
      select: { event_type: true, utm_source: true, utm_medium: true, utm_campaign: true, gclid: true, referrer: true, created_at: true },
      orderBy: { created_at: 'asc' },
    });

    const views = events.filter((e) => e.event_type === 'view').length;
    const clicks = events.filter((e) => e.event_type === 'whatsapp_click').length;

    const sourceMap: Record<string, { views: number; clicks: number }> = {};
    for (const e of events) {
      const source = this.detectSource(e);
      const medium = e.utm_medium || (e.gclid ? 'cpc' : null);
      const key = `${source}|${medium || ''}|${e.utm_campaign || ''}`;
      if (!sourceMap[key]) sourceMap[key] = { views: 0, clicks: 0 };
      if (e.event_type === 'view') sourceMap[key].views++;
      else sourceMap[key].clicks++;
    }
    const by_source = Object.entries(sourceMap).map(([key, counts]) => {
      const [source, medium, campaign] = key.split('|');
      return { source, medium: medium || null, campaign: campaign || null, ...counts };
    });

    const dayMap: Record<string, { views: number; clicks: number }> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dayMap[d.toISOString().slice(0, 10)] = { views: 0, clicks: 0 };
    }
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    for (const e of events.filter((e) => e.created_at >= sevenDaysAgo)) {
      const day = e.created_at.toISOString().slice(0, 10);
      if (dayMap[day]) {
        if (e.event_type === 'view') dayMap[day].views++;
        else dayMap[day].clicks++;
      }
    }
    const by_day = Object.entries(dayMap).map(([date, counts]) => ({ date, ...counts }));

    return {
      page_path,
      total_views: views,
      total_clicks: clicks,
      conversion_rate: views > 0 ? ((clicks / views) * 100).toFixed(1) + '%' : '0%',
      by_source,
      by_day,
    };
  }

  // ── GA4 Data API ──────────────────────────────────────────────────────────

  async getGa4Summary() {
    // Prioridade: banco → env var
    const propertyId = (await this.getSetting('GA4_PROPERTY_ID')) || process.env.GA4_PROPERTY_ID;
    const b64 = (await this.getSetting('GA4_SERVICE_ACCOUNT_B64')) || process.env.GA4_SERVICE_ACCOUNT_B64;

    if (!propertyId || !b64) return null;

    try {
      const credentialsJson = Buffer.from(b64, 'base64').toString('utf8');
      const creds = JSON.parse(credentialsJson);

      const client = new BetaAnalyticsDataClient({
        credentials: {
          client_email: creds.client_email,
          private_key: creds.private_key,
        },
      });

      // Relatório principal: métricas por canal (30 dias)
      const [mainReport] = await client.runReport({
        property: propertyId,
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'newUsers' },
          { name: 'bounceRate' },
          { name: 'averageSessionDuration' },
          { name: 'screenPageViews' },
        ],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      });

      // Relatório diário: últimos 7 dias
      const [dailyReport] = await client.runReport({
        property: propertyId,
        dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
        dimensions: [{ name: 'date' }],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
      });

      let totalSessions = 0;
      let totalUsers = 0;
      let totalNewUsers = 0;
      let weightedBounce = 0;
      let weightedDuration = 0;
      let totalPageViews = 0;

      const by_channel: { channel: string; sessions: number; users: number }[] = [];

      for (const row of mainReport.rows || []) {
        const ch = row.dimensionValues?.[0]?.value || 'Other';
        const s = parseInt(row.metricValues?.[0]?.value || '0');
        const u = parseInt(row.metricValues?.[1]?.value || '0');
        const nu = parseInt(row.metricValues?.[2]?.value || '0');
        const br = parseFloat(row.metricValues?.[3]?.value || '0');
        const ad = parseFloat(row.metricValues?.[4]?.value || '0');
        const pv = parseInt(row.metricValues?.[5]?.value || '0');

        totalSessions += s;
        totalUsers += u;
        totalNewUsers += nu;
        weightedBounce += br * s;
        weightedDuration += ad * s;
        totalPageViews += pv;

        by_channel.push({ channel: ch, sessions: s, users: u });
      }

      const bounceRate = totalSessions > 0 ? (weightedBounce / totalSessions) * 100 : 0;
      const avgDuration = totalSessions > 0 ? weightedDuration / totalSessions : 0;

      const by_day = (dailyReport.rows || []).map((row) => {
        const raw = row.dimensionValues?.[0]?.value || '';
        const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
        return {
          date,
          sessions: parseInt(row.metricValues?.[0]?.value || '0'),
          users: parseInt(row.metricValues?.[1]?.value || '0'),
        };
      });

      return {
        sessions: totalSessions,
        users: totalUsers,
        newUsers: totalNewUsers,
        bounceRate: bounceRate.toFixed(1) + '%',
        avgDurationSec: Math.round(avgDuration),
        pageViews: totalPageViews,
        by_channel: by_channel.sort((a, b) => b.sessions - a.sessions),
        by_day,
      };
    } catch (e) {
      this.logger.error('[GA4] Erro ao consultar Analytics Data API:', e);
      return null;
    }
  }
}
