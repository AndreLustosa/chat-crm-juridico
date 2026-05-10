import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { google, searchconsole_v1 } from 'googleapis';
import { PrismaService } from '../prisma/prisma.service';
import { decryptValue, encryptValue } from '../common/utils/crypto.util';
import {
  CreateOrganicLandingPageDto,
  SaveOrganicSearchConfigDto,
  SyncOrganicTrafficDto,
  UpdateOrganicLandingPageDto,
} from './organic-traffic.dto';

type SyncTrigger = 'MANUAL' | 'CRON';

const SEARCH_CONSOLE_SCOPES = [
  'https://www.googleapis.com/auth/webmasters.readonly',
];

const DEFAULT_SITE_BASE =
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.FRONTEND_BASE_URL ||
  'https://andrelustosaadvogados.com.br';

interface OrganicMetricRow {
  date: string;
  page: string;
  query: string;
  country: string;
  device: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface OrganicQuerySummary {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

@Injectable()
export class OrganicTrafficService {
  private readonly logger = new Logger(OrganicTrafficService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getConfig(tenantId: string) {
    const config = await this.prisma.organicSearchConfig.findUnique({
      where: { tenant_id: tenantId },
    });

    return {
      configured: !!(config?.site_url && config.service_account_b64),
      site_url: config?.site_url ?? null,
      property_type: config?.property_type ?? null,
      service_account_email: config?.service_account_email ?? null,
      is_active: config?.is_active ?? false,
      last_sync_at: config?.last_sync_at ?? null,
      last_inspection_at: config?.last_inspection_at ?? null,
      last_error: config?.last_error ?? null,
    };
  }

  async saveConfig(tenantId: string, dto: SaveOrganicSearchConfigDto) {
    const siteUrl = this.normalizeSiteUrl(dto.siteUrl);
    const propertyType = siteUrl.startsWith('sc-domain:')
      ? 'DOMAIN'
      : 'URL_PREFIX';

    let encryptedB64: string | undefined;
    let serviceAccountEmail: string | undefined;

    if (dto.serviceAccountJson?.trim()) {
      const parsed = this.parseServiceAccountJson(dto.serviceAccountJson);
      const b64 = Buffer.from(JSON.stringify(parsed)).toString('base64');
      encryptedB64 = encryptValue(b64);
      serviceAccountEmail = parsed.client_email;
    }

    const existing = await this.prisma.organicSearchConfig.findUnique({
      where: { tenant_id: tenantId },
    });

    if (!existing && !encryptedB64) {
      throw new HttpException(
        'Cole o JSON da Service Account para configurar o Search Console.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const config = await this.prisma.organicSearchConfig.upsert({
      where: { tenant_id: tenantId },
      create: {
        tenant_id: tenantId,
        site_url: siteUrl,
        property_type: propertyType,
        service_account_b64: encryptedB64,
        service_account_email: serviceAccountEmail,
        is_active: true,
      },
      update: {
        site_url: siteUrl,
        property_type: propertyType,
        service_account_b64: encryptedB64 ?? undefined,
        service_account_email: serviceAccountEmail ?? undefined,
        is_active: true,
        last_error: null,
      },
    });

    return {
      configured: !!config.service_account_b64,
      site_url: config.site_url,
      property_type: config.property_type,
      service_account_email: config.service_account_email,
      is_active: config.is_active,
    };
  }

  async testConfig(tenantId: string) {
    const { config, client } = await this.getSearchConsoleClient(tenantId);
    const site = await client.sites.get({ siteUrl: config.site_url });
    return {
      ok: true,
      site: site.data,
    };
  }

  async listSitemaps(tenantId: string) {
    const { config, client } = await this.getSearchConsoleClient(tenantId);
    const response = await client.sitemaps.list({ siteUrl: config.site_url });
    return response.data.sitemap ?? [];
  }

  async seedDefaultPages(tenantId: string) {
    const base = DEFAULT_SITE_BASE.replace(/\/$/, '');
    const defaults = [
      {
        url: `${base}/`,
        path: '/',
        title: 'Home',
        city: null,
        state: null,
        practice_area: 'Institucional',
        target_keywords: ['advogado em alagoas', 'andre lustosa advogados'],
      },
      {
        url: `${base}/geral/arapiraca`,
        path: '/geral/arapiraca',
        title: 'Arapiraca - Geral',
        city: 'Arapiraca',
        state: 'AL',
        practice_area: 'Institucional',
        target_keywords: ['advogado em arapiraca'],
      },
      {
        url: `${base}/arapiraca/trabalhista`,
        path: '/arapiraca/trabalhista',
        title: 'Arapiraca - Trabalhista',
        city: 'Arapiraca',
        state: 'AL',
        practice_area: 'Trabalhista',
        target_keywords: ['advogado trabalhista arapiraca'],
      },
      {
        url: `${base}/arapiraca/trabalhista/sem-carteira-assinada`,
        path: '/arapiraca/trabalhista/sem-carteira-assinada',
        title: 'Arapiraca - Sem Carteira Assinada',
        city: 'Arapiraca',
        state: 'AL',
        practice_area: 'Trabalhista',
        target_keywords: ['trabalhei sem carteira assinada arapiraca'],
      },
      {
        url: `${base}/arapiraca/criminal`,
        path: '/arapiraca/criminal',
        title: 'Arapiraca - Criminal',
        city: 'Arapiraca',
        state: 'AL',
        practice_area: 'Criminal',
        target_keywords: [
          'advogado criminal arapiraca',
          'advogado criminalista arapiraca',
        ],
      },
    ];

    let count = 0;
    for (const item of defaults) {
      await this.prisma.organicLandingPage.upsert({
        where: {
          tenant_id_url: {
            tenant_id: tenantId,
            url: item.url,
          },
        },
        create: {
          tenant_id: tenantId,
          sitemap_url: `${base}/sitemap.xml`,
          ...item,
        },
        update: {
          title: item.title,
          path: item.path,
          city: item.city,
          state: item.state,
          practice_area: item.practice_area,
          target_keywords: item.target_keywords,
          sitemap_url: `${base}/sitemap.xml`,
        },
      });
      count++;
    }

    await this.refreshCachedMetrics(tenantId);
    return { ok: true, count };
  }

  async listPages(tenantId: string) {
    const count = await this.prisma.organicLandingPage.count({
      where: { tenant_id: tenantId },
    });
    if (count === 0) {
      await this.seedDefaultPages(tenantId);
    } else {
      await this.refreshCachedMetrics(tenantId);
    }

    return this.prisma.organicLandingPage.findMany({
      where: { tenant_id: tenantId },
      orderBy: [
        { city: 'asc' },
        { practice_area: 'asc' },
        { title: 'asc' },
      ],
    });
  }

  async getPage(tenantId: string, id: string) {
    const page = await this.prisma.organicLandingPage.findFirst({
      where: { id, tenant_id: tenantId },
      include: {
        inspections: {
          orderBy: { inspected_at: 'desc' },
          take: 5,
        },
      },
    });
    if (!page) throw new NotFoundException('Landing page organica nao encontrada');
    return page;
  }

  async createPage(tenantId: string, dto: CreateOrganicLandingPageDto) {
    const normalized = this.normalizeLandingUrl(dto.url);
    const path = this.extractPath(normalized);
    const page = await this.prisma.organicLandingPage.create({
      data: {
        tenant_id: tenantId,
        url: normalized,
        path,
        title: dto.title.trim(),
        city: this.nullable(dto.city),
        state: this.nullable(dto.state),
        practice_area: this.nullable(dto.practiceArea),
        target_keywords: this.cleanKeywords(dto.targetKeywords),
        sitemap_url: this.nullable(dto.sitemapUrl),
        notes: this.nullable(dto.notes),
      },
    });
    await this.refreshCachedMetrics(tenantId, [page.id]);
    return page;
  }

  async updatePage(
    tenantId: string,
    id: string,
    dto: UpdateOrganicLandingPageDto,
  ) {
    await this.getPage(tenantId, id);
    const page = await this.prisma.organicLandingPage.update({
      where: { id },
      data: {
        title: dto.title?.trim() || undefined,
        city: dto.city === undefined ? undefined : this.nullable(dto.city),
        state: dto.state === undefined ? undefined : this.nullable(dto.state),
        practice_area:
          dto.practiceArea === undefined
            ? undefined
            : this.nullable(dto.practiceArea),
        target_keywords:
          dto.targetKeywords === undefined
            ? undefined
            : this.cleanKeywords(dto.targetKeywords),
        sitemap_url:
          dto.sitemapUrl === undefined
            ? undefined
            : this.nullable(dto.sitemapUrl),
        notes: dto.notes === undefined ? undefined : this.nullable(dto.notes),
        is_active: dto.isActive,
      },
    });
    await this.refreshCachedMetrics(tenantId, [id]);
    return page;
  }

  async deletePage(tenantId: string, id: string) {
    await this.getPage(tenantId, id);
    await this.prisma.organicLandingPage.delete({ where: { id } });
    return { ok: true };
  }

  async getSummary(tenantId: string) {
    const [config, pages, logs, queries] = await Promise.all([
      this.getConfig(tenantId),
      this.listPages(tenantId),
      this.prisma.organicSyncLog.findMany({
        where: { tenant_id: tenantId },
        orderBy: { started_at: 'desc' },
        take: 5,
      }),
      this.getQueries(tenantId, { limit: 10 }),
    ]);

    const totals = pages.reduce(
      (acc, page) => {
        acc.clicks += page.clicks_30d;
        acc.impressions += page.impressions_30d;
        acc.whatsapp_clicks += page.whatsapp_clicks_30d;
        acc.lp_views += page.lp_views_30d;
        if (page.index_verdict === 'PASS') acc.indexed++;
        return acc;
      },
      {
        clicks: 0,
        impressions: 0,
        whatsapp_clicks: 0,
        lp_views: 0,
        indexed: 0,
      },
    );

    const weightedPosition = this.weightedPosition(
      pages.map((p) => ({
        position: p.position_30d,
        impressions: p.impressions_30d,
      })),
    );

    return {
      config,
      totals: {
        ...totals,
        ctr: totals.impressions > 0 ? totals.clicks / totals.impressions : 0,
        position: weightedPosition,
        pages: pages.length,
        active_pages: pages.filter((p) => p.is_active).length,
      },
      top_queries: queries,
      recent_logs: logs,
    };
  }

  async getQueries(
    tenantId: string,
    opts: { pageId?: string; days?: number; limit?: number } = {},
  ): Promise<OrganicQuerySummary[]> {
    const days = opts.days ?? 30;
    const limit = opts.limit ?? 50;
    const from = new Date();
    from.setDate(from.getDate() - days);

    const metrics = await this.prisma.organicSearchMetric.findMany({
      where: {
        tenant_id: tenantId,
        page_id: opts.pageId,
        date: { gte: this.toDateOnly(from) },
        query: { not: '' },
      },
      select: {
        query: true,
        clicks: true,
        impressions: true,
        position: true,
      },
    });

    const byQuery = new Map<string, OrganicQuerySummary>();
    for (const metric of metrics) {
      const current =
        byQuery.get(metric.query) ??
        ({ query: metric.query, clicks: 0, impressions: 0, ctr: 0, position: 0 });
      current.clicks += metric.clicks;
      current.impressions += metric.impressions;
      current.position += metric.position * Math.max(metric.impressions, 1);
      byQuery.set(metric.query, current);
    }

    return [...byQuery.values()]
      .map((item) => ({
        ...item,
        ctr: item.impressions > 0 ? item.clicks / item.impressions : 0,
        position:
          item.impressions > 0 ? item.position / item.impressions : item.position,
      }))
      .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks)
      .slice(0, limit);
  }

  async syncSearchAnalytics(
    tenantId: string,
    trigger: SyncTrigger,
    dto: SyncOrganicTrafficDto = {},
  ) {
    const startedAt = new Date();
    const dateRange = this.resolveDateRange(dto);
    const log = await this.prisma.organicSyncLog.create({
      data: {
        tenant_id: tenantId,
        trigger,
        status: 'RUNNING',
        date_from: this.dateStringToDate(dateRange.startDate),
        date_to: this.dateStringToDate(dateRange.endDate),
      },
    });

    let rowsUpserted = 0;
    let inspected = 0;
    let pagesSeen = 0;

    try {
      const { config, client } = await this.getSearchConsoleClient(tenantId);
      const pages = await this.prisma.organicLandingPage.findMany({
        where: {
          tenant_id: tenantId,
          is_active: true,
          id: dto.pageId,
        },
      });
      pagesSeen = pages.length;

      for (const page of pages) {
        const rows = await this.fetchMetricsForPage(
          client,
          config.site_url,
          page.url,
          dateRange.startDate,
          dateRange.endDate,
        );
        await this.replaceMetrics(tenantId, page.id, dateRange, rows);
        rowsUpserted += rows.length;

        await this.prisma.organicLandingPage.update({
          where: { id: page.id },
          data: { last_search_sync_at: new Date() },
        });

        if (dto.inspect) {
          await this.inspectPage(tenantId, page.id);
          inspected++;
        }
      }

      await this.refreshCachedMetrics(tenantId, pages.map((p) => p.id));
      await this.prisma.organicSearchConfig.update({
        where: { tenant_id: tenantId },
        data: { last_sync_at: new Date(), last_error: null },
      });

      const duration = Date.now() - startedAt.getTime();
      await this.prisma.organicSyncLog.update({
        where: { id: log.id },
        data: {
          status: 'SUCCESS',
          pages_seen: pagesSeen,
          rows_upserted: rowsUpserted,
          inspected,
          duration_ms: duration,
          finished_at: new Date(),
        },
      });

      return {
        ok: true,
        pages_seen: pagesSeen,
        rows_upserted: rowsUpserted,
        inspected,
        date_from: dateRange.startDate,
        date_to: dateRange.endDate,
      };
    } catch (e: any) {
      const message = e?.message ?? 'Erro desconhecido no sync organico';
      await Promise.all([
        this.prisma.organicSyncLog.update({
          where: { id: log.id },
          data: {
            status: 'ERROR',
            pages_seen: pagesSeen,
            rows_upserted: rowsUpserted,
            inspected,
            error_message: message,
            duration_ms: Date.now() - startedAt.getTime(),
            finished_at: new Date(),
          },
        }),
        this.prisma.organicSearchConfig
          .update({
            where: { tenant_id: tenantId },
            data: { last_error: message },
          })
          .catch(() => null),
      ]);
      throw e;
    }
  }

  async inspectPage(tenantId: string, id: string) {
    const page = await this.getPage(tenantId, id);
    const { config, client } = await this.getSearchConsoleClient(tenantId);

    const response = await client.urlInspection.index.inspect({
      requestBody: {
        inspectionUrl: page.url,
        siteUrl: config.site_url,
        languageCode: 'pt-BR',
      },
    });

    const result = response.data.inspectionResult;
    const index = result?.indexStatusResult;
    const lastCrawl = index?.lastCrawlTime
      ? new Date(index.lastCrawlTime)
      : null;

    const snapshot = await this.prisma.organicInspectionSnapshot.create({
      data: {
        tenant_id: tenantId,
        page_id: id,
        inspection_url: page.url,
        site_url: config.site_url,
        verdict: index?.verdict ?? null,
        coverage_state: index?.coverageState ?? null,
        indexing_state: index?.indexingState ?? null,
        page_fetch_state: index?.pageFetchState ?? null,
        robots_txt_state: index?.robotsTxtState ?? null,
        google_canonical: index?.googleCanonical ?? null,
        user_canonical: index?.userCanonical ?? null,
        last_crawl_time: lastCrawl,
        raw: response.data as any,
      },
    });

    await Promise.all([
      this.prisma.organicLandingPage.update({
        where: { id },
        data: {
          index_verdict: index?.verdict ?? null,
          coverage_state: index?.coverageState ?? null,
          indexing_state: index?.indexingState ?? null,
          page_fetch_state: index?.pageFetchState ?? null,
          robots_txt_state: index?.robotsTxtState ?? null,
          google_canonical: index?.googleCanonical ?? null,
          user_canonical: index?.userCanonical ?? null,
          last_crawl_time: lastCrawl,
          last_inspected_at: snapshot.inspected_at,
        },
      }),
      this.prisma.organicSearchConfig.update({
        where: { tenant_id: tenantId },
        data: { last_inspection_at: new Date(), last_error: null },
      }),
    ]);

    return {
      page_id: id,
      inspection: snapshot,
    };
  }

  private async getSearchConsoleClient(tenantId: string) {
    const config = await this.prisma.organicSearchConfig.findUnique({
      where: { tenant_id: tenantId },
    });
    if (!config?.site_url || !config.service_account_b64 || !config.is_active) {
      throw new HttpException(
        'Search Console nao configurado para este tenant.',
        HttpStatus.PRECONDITION_FAILED,
      );
    }

    const b64 = decryptValue(config.service_account_b64);
    const credentials = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: SEARCH_CONSOLE_SCOPES,
    });
    const authClient = await auth.getClient();
    const client = google.searchconsole({
      version: 'v1',
      auth: authClient as any,
    });

    return { config, client };
  }

  private async fetchMetricsForPage(
    client: searchconsole_v1.Searchconsole,
    siteUrl: string,
    pageUrl: string,
    startDate: string,
    endDate: string,
  ): Promise<OrganicMetricRow[]> {
    const response = await client.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate,
        endDate,
        dimensions: ['date', 'page', 'query', 'country', 'device'],
        dimensionFilterGroups: [
          {
            filters: [
              {
                dimension: 'page',
                operator: 'equals',
                expression: pageUrl,
              },
            ],
          },
        ],
        rowLimit: 25000,
        dataState: 'final',
      },
    });

    return (response.data.rows ?? []).map((row) =>
      this.mapSearchConsoleRow(row),
    );
  }

  private mapSearchConsoleRow(
    row: searchconsole_v1.Schema$ApiDataRow,
  ): OrganicMetricRow {
    const keys = row.keys ?? [];
    return {
      date: keys[0] ?? '',
      page: keys[1] ?? '',
      query: keys[2] ?? '',
      country: keys[3] ?? '',
      device: keys[4] ?? '',
      clicks: Math.round(row.clicks ?? 0),
      impressions: Math.round(row.impressions ?? 0),
      ctr: row.ctr ?? 0,
      position: row.position ?? 0,
    };
  }

  private async replaceMetrics(
    tenantId: string,
    pageId: string,
    range: { startDate: string; endDate: string },
    rows: OrganicMetricRow[],
  ) {
    await this.prisma.organicSearchMetric.deleteMany({
      where: {
        page_id: pageId,
        date: {
          gte: this.dateStringToDate(range.startDate),
          lte: this.dateStringToDate(range.endDate),
        },
      },
    });

    if (rows.length === 0) return;

    await this.prisma.organicSearchMetric.createMany({
      data: rows
        .filter((row) => row.date)
        .map((row) => ({
          tenant_id: tenantId,
          page_id: pageId,
          date: this.dateStringToDate(row.date),
          query: row.query || '',
          country: row.country || '',
          device: row.device || '',
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          position: row.position,
        })),
      skipDuplicates: true,
    });
  }

  private async refreshCachedMetrics(tenantId: string, pageIds?: string[]) {
    const pages = await this.prisma.organicLandingPage.findMany({
      where: {
        tenant_id: tenantId,
        id: pageIds ? { in: pageIds } : undefined,
      },
    });
    const from = new Date();
    from.setDate(from.getDate() - 30);
    const fromDate = this.toDateOnly(from);

    for (const page of pages) {
      const [metrics, events] = await Promise.all([
        this.prisma.organicSearchMetric.findMany({
          where: {
            tenant_id: tenantId,
            page_id: page.id,
            date: { gte: fromDate },
          },
          select: {
            clicks: true,
            impressions: true,
            position: true,
          },
        }),
        this.prisma.lpEvent.groupBy({
          by: ['event_type'],
          where: {
            page_path: page.path,
            created_at: { gte: from },
          },
          _count: { _all: true },
        }),
      ]);

      const clicks = metrics.reduce((sum, item) => sum + item.clicks, 0);
      const impressions = metrics.reduce(
        (sum, item) => sum + item.impressions,
        0,
      );
      const position = this.weightedPosition(metrics);
      const views =
        events.find((event) => event.event_type === 'view')?._count._all ?? 0;
      const whatsapp =
        events.find((event) => event.event_type === 'whatsapp_click')?._count
          ._all ?? 0;

      await this.prisma.organicLandingPage.update({
        where: { id: page.id },
        data: {
          clicks_30d: clicks,
          impressions_30d: impressions,
          ctr_30d: impressions > 0 ? clicks / impressions : 0,
          position_30d: position,
          lp_views_30d: views,
          whatsapp_clicks_30d: whatsapp,
        },
      });
    }
  }

  private weightedPosition(
    rows: { position: number; impressions: number }[],
  ): number {
    const impressions = rows.reduce((sum, item) => sum + item.impressions, 0);
    if (impressions <= 0) return 0;
    return (
      rows.reduce(
        (sum, item) => sum + item.position * Math.max(item.impressions, 0),
        0,
      ) / impressions
    );
  }

  private resolveDateRange(dto: SyncOrganicTrafficDto) {
    const end = new Date();
    end.setDate(end.getDate() - 1);
    const start = new Date(end);
    start.setDate(start.getDate() - 30);

    return {
      startDate: this.validateDateString(dto.startDate) ?? this.formatDate(start),
      endDate: this.validateDateString(dto.endDate) ?? this.formatDate(end),
    };
  }

  private normalizeSiteUrl(raw: string): string {
    const value = raw.trim();
    if (!value) {
      throw new HttpException('Informe a propriedade do Search Console.', HttpStatus.BAD_REQUEST);
    }
    if (value.startsWith('sc-domain:')) return value.toLowerCase();
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
      return `${url.protocol}//${url.host}${url.pathname === '/' ? '/' : url.pathname}`;
    } catch {
      throw new HttpException(
        'Propriedade invalida. Use sc-domain:dominio.com.br ou uma URL com http/https.',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private normalizeLandingUrl(raw: string): string {
    try {
      const url = new URL(raw.trim());
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
      const pathname = url.pathname === '/' ? '/' : url.pathname.replace(/\/$/, '');
      return `${url.protocol}//${url.host}${pathname}${url.search}`;
    } catch {
      throw new HttpException('URL da landing page invalida.', HttpStatus.BAD_REQUEST);
    }
  }

  private extractPath(url: string): string {
    const parsed = new URL(url);
    return parsed.pathname || '/';
  }

  private parseServiceAccountJson(raw: string): {
    client_email: string;
    private_key: string;
    [key: string]: unknown;
  } {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed.client_email || !parsed.private_key) {
        throw new Error('JSON sem client_email/private_key');
      }
      return parsed;
    } catch {
      throw new HttpException(
        'JSON da Service Account invalido.',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private cleanKeywords(value?: string[]): string[] {
    return [...new Set((value ?? []).map((item) => item.trim()).filter(Boolean))];
  }

  private nullable(value?: string | null): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private validateDateString(value?: string): string | null {
    if (!value) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new HttpException(
        'Data invalida. Use o formato YYYY-MM-DD.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return value;
  }

  private dateStringToDate(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`);
  }

  private toDateOnly(value: Date): Date {
    return this.dateStringToDate(this.formatDate(value));
  }

  private formatDate(value: Date): string {
    return value.toISOString().slice(0, 10);
  }
}
