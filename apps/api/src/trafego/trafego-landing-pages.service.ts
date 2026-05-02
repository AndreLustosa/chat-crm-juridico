import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import Anthropic from '@anthropic-ai/sdk';

const PAGESPEED_API =
  'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

/**
 * Sprint I — Fase 4f. Gerencia LandingPages e suas análises.
 *
 * Pipeline de analise IA:
 *   1. fetch HTML da URL (timeout 10s, max 200KB)
 *   2. strip de scripts/styles/svg pra economizar tokens
 *   3. Claude API com prompt OAB-aware foca em CRO + headlines + CTA
 *   4. retorna JSON estruturado com sugestões classificadas por severidade
 *
 * Pipeline PageSpeed:
 *   1. chama PageSpeed Insights API (gratuita) com strategy=mobile e desktop
 *   2. extrai scores + Core Web Vitals (LCP, CLS, INP)
 *   3. armazena em LandingPage (cache local)
 */
@Injectable()
export class TrafegoLandingPagesService {
  private readonly logger = new Logger(TrafegoLandingPagesService.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {}

  // ─── CRUD ───────────────────────────────────────────────────────────────

  async list(tenantId: string) {
    await this.syncFromAdFinalUrls(tenantId);

    const items = await this.prisma.landingPage.findMany({
      where: { tenant_id: tenantId },
      orderBy: [{ updated_at: 'desc' }],
      include: {
        campaign: { select: { id: true, name: true } },
      },
    });
    return items.map((i) => ({
      id: i.id,
      url: i.url,
      title: i.title,
      description: i.description,
      campaign_id: i.campaign_id,
      campaign_name: i.campaign?.name ?? null,
      pagespeed_mobile: i.pagespeed_mobile,
      pagespeed_desktop: i.pagespeed_desktop,
      lcp_ms: i.lcp_ms,
      cls_x100: i.cls_x100,
      inp_ms: i.inp_ms,
      last_pagespeed_at: i.last_pagespeed_at,
      last_analyzed_at: i.last_analyzed_at,
      has_analysis: i.analysis !== null,
      clicks_30d: i.clicks_30d,
      conversions_30d: i.conversions_30d,
      created_at: i.created_at,
    }));
  }

  /**
   * Landing pages sao derivadas dos final_urls dos anuncios sincronizados.
   * O cadastro manual continua existindo como fallback, mas a fonte principal
   * da lista deve ser o cache de TrafficAd vindo da Google Ads API.
   */
  private async syncFromAdFinalUrls(tenantId: string): Promise<number> {
    const ads = await this.prisma.trafficAd.findMany({
      where: {
        tenant_id: tenantId,
        status: { not: 'REMOVED' },
      },
      select: {
        account_id: true,
        final_urls: true,
        ad_group: {
          select: {
            campaign_id: true,
            campaign: { select: { name: true } },
          },
        },
      },
    });

    const seen = new Set<string>();
    let createdOrUpdated = 0;

    for (const ad of ads) {
      for (const rawUrl of this.extractFinalUrls(ad.final_urls)) {
        const url = this.normalizeUrl(rawUrl);
        if (!url || seen.has(url)) continue;
        seen.add(url);

        await this.prisma.landingPage.upsert({
          where: {
            tenant_id_url: {
              tenant_id: tenantId,
              url,
            },
          },
          create: {
            tenant_id: tenantId,
            account_id: ad.account_id,
            campaign_id: ad.ad_group?.campaign_id ?? null,
            url,
            title: ad.ad_group?.campaign?.name
              ? `LP - ${ad.ad_group.campaign.name}`
              : null,
          },
          update: {
            account_id: ad.account_id,
            campaign_id: ad.ad_group?.campaign_id ?? undefined,
          },
        });
        createdOrUpdated++;
      }
    }

    return createdOrUpdated;
  }

  async get(tenantId: string, id: string) {
    const page = await this.prisma.landingPage.findFirst({
      where: { id, tenant_id: tenantId },
      include: {
        campaign: { select: { id: true, name: true } },
      },
    });
    if (!page) throw new NotFoundException('Landing page não encontrada');
    return page;
  }

  async create(
    tenantId: string,
    data: {
      url: string;
      title?: string;
      description?: string;
      campaign_id?: string | null;
    },
  ) {
    const url = this.normalizeUrl(data.url);
    if (!url) {
      throw new HttpException(
        'URL inválida. Use http:// ou https://',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Resolve campaign_id pra account_id automaticamente quando vinculado
    let accountId: string | null = null;
    if (data.campaign_id) {
      const camp = await this.prisma.trafficCampaign.findFirst({
        where: { id: data.campaign_id, tenant_id: tenantId },
        select: { account_id: true },
      });
      if (camp) accountId = camp.account_id;
    }

    try {
      return await this.prisma.landingPage.create({
        data: {
          tenant_id: tenantId,
          url,
          title: data.title ?? null,
          description: data.description ?? null,
          campaign_id: data.campaign_id ?? null,
          account_id: accountId,
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new HttpException(
          `Landing page com URL "${url}" já existe.`,
          HttpStatus.CONFLICT,
        );
      }
      throw e;
    }
  }

  async update(
    tenantId: string,
    id: string,
    data: {
      title?: string | null;
      description?: string | null;
      campaign_id?: string | null;
    },
  ) {
    await this.get(tenantId, id);
    const updateData: any = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.campaign_id !== undefined) updateData.campaign_id = data.campaign_id;
    return this.prisma.landingPage.update({
      where: { id },
      data: updateData,
    });
  }

  async remove(tenantId: string, id: string) {
    await this.get(tenantId, id);
    await this.prisma.landingPage.delete({ where: { id } });
    return { ok: true };
  }

  // ─── PageSpeed Insights ────────────────────────────────────────────────

  /**
   * Roda PageSpeed pro URL (mobile + desktop) e atualiza cache.
   * Sem PAGESPEED_INSIGHTS_API_KEY: retorna 412 explícito.
   */
  async refreshPageSpeed(tenantId: string, id: string) {
    const page = await this.get(tenantId, id);
    const key =
      (await this.settings.get('PAGESPEED_INSIGHTS_API_KEY')) ||
      process.env.PAGESPEED_INSIGHTS_API_KEY;
    if (!key) {
      throw new HttpException(
        'PAGESPEED_INSIGHTS_API_KEY não configurada. Crie em Google Cloud Console (PageSpeed Insights API) e configure em Settings > IA.',
        HttpStatus.PRECONDITION_FAILED,
      );
    }

    const [mobile, desktop] = await Promise.all([
      this.fetchPageSpeed(page.url, 'mobile', key),
      this.fetchPageSpeed(page.url, 'desktop', key),
    ]);

    const mobileScore = Math.round(
      (mobile?.lighthouseResult?.categories?.performance?.score ?? 0) * 100,
    );
    const desktopScore = Math.round(
      (desktop?.lighthouseResult?.categories?.performance?.score ?? 0) * 100,
    );

    // Core Web Vitals do mobile (geralmente o mais relevante)
    const audits = mobile?.lighthouseResult?.audits ?? {};
    const lcpMs = parseFloat(audits['largest-contentful-paint']?.numericValue);
    const clsRaw = parseFloat(audits['cumulative-layout-shift']?.numericValue);
    const inpMs = parseFloat(
      audits['interactive']?.numericValue ??
        audits['max-potential-fid']?.numericValue,
    );

    // pagespeed_data: snapshot enxuto pra UI mostrar audits relevantes
    // (não armazenar tudo — JSON inteiro tem ~1MB).
    const slim = {
      mobile: {
        score: mobileScore,
        opportunities: this.pickOpportunities(
          mobile?.lighthouseResult?.audits ?? {},
        ),
      },
      desktop: {
        score: desktopScore,
        opportunities: this.pickOpportunities(
          desktop?.lighthouseResult?.audits ?? {},
        ),
      },
      title: mobile?.lighthouseResult?.finalUrl ?? page.url,
      fetched_at: new Date().toISOString(),
    };

    return this.prisma.landingPage.update({
      where: { id },
      data: {
        pagespeed_mobile: mobileScore,
        pagespeed_desktop: desktopScore,
        lcp_ms: Number.isFinite(lcpMs) ? Math.round(lcpMs) : null,
        cls_x100: Number.isFinite(clsRaw)
          ? Math.round(clsRaw * 100)
          : null,
        inp_ms: Number.isFinite(inpMs) ? Math.round(inpMs) : null,
        last_pagespeed_at: new Date(),
        pagespeed_data: slim as any,
      },
    });
  }

  /**
   * Análise IA: fetch HTML + Claude API. Retorna análise estruturada
   * com sugestões classificadas por severidade.
   */
  async analyzeWithAi(tenantId: string, id: string) {
    const page = await this.get(tenantId, id);

    const key =
      (await this.settings.get('ANTHROPIC_API_KEY')) ||
      process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new HttpException(
        'ANTHROPIC_API_KEY não configurada.',
        HttpStatus.PRECONDITION_FAILED,
      );
    }

    // Fetch HTML — defensivo: timeout 10s, redirect, max 200KB
    let html = '';
    try {
      const resp = await fetch(page.url, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; OrionCRMBot/1.0; +https://andrelustosaadvogados.com.br)',
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) {
        throw new HttpException(
          `LP retornou HTTP ${resp.status} — não foi possível analisar.`,
          HttpStatus.BAD_GATEWAY,
        );
      }
      const text = await resp.text();
      html = text.slice(0, 200_000); // ~200KB
    } catch (e: any) {
      if (e instanceof HttpException) throw e;
      throw new HttpException(
        `Falha ao baixar LP: ${e?.message ?? 'desconhecido'}`,
        HttpStatus.BAD_GATEWAY,
      );
    }

    // Strip scripts/styles/svg pra reduzir tokens
    const stripped = this.stripHtml(html).slice(0, 80_000); // ~80KB texto

    // Recupera modelo do TrafficIAPolicy
    const policy = await this.prisma.trafficIAPolicy.findUnique({
      where: { tenant_id: tenantId },
      select: { llm_summary_model: true },
    });
    const model = policy?.llm_summary_model || 'claude-sonnet-4-6';

    const systemPrompt = `Você é um especialista em CRO (Conversion Rate Optimization) e compliance OAB para landing pages de advocacia brasileira.

REGRAS OAB que você DEVE checar:
- NÃO promete resultado ("garantimos vitória", "100% êxito")
- NÃO usa superlativos sem base ("o melhor", "líder", "número 1")
- NÃO menciona preços/promoções como atrativo
- NÃO compara com outros escritórios diretamente
- NÃO usa termos sensacionalistas ("rápido", "garantido")

CRO checklist:
- Headline acima da dobra com promessa clara mas COMPLIANT
- CTA visível e específico
- Prova social presente (depoimentos, certificações, OAB)
- Form curto (2-4 campos máximo pro lead inicial)
- Mobile-first (texto legível, botões >= 44px)
- Velocidade < 3s (PageSpeed)
- Trust signals (HTTPS, OAB number visível)

Responda em pt-BR APENAS um JSON (sem markdown), formato:
{
  "summary": "1 parágrafo (max 200 chars) com avaliação geral",
  "score_cro": 0-100,
  "issues": [
    {
      "severity": "CRITICAL"|"HIGH"|"MEDIUM"|"LOW",
      "category": "OAB"|"CRO"|"PERFORMANCE"|"COPY"|"UX",
      "title": "1 frase do problema",
      "suggestion": "1-2 frases com o fix recomendado"
    }
  ]
}

Liste no máximo 8 issues — priorize impacto.`;

    const userPrompt = `URL: ${page.url}
${page.title ? `Título manual: ${page.title}` : ''}
${page.description ? `Descrição: ${page.description}` : ''}

PageSpeed mobile: ${page.pagespeed_mobile || 'não medido'}
PageSpeed desktop: ${page.pagespeed_desktop || 'não medido'}
${page.lcp_ms ? `LCP: ${page.lcp_ms}ms` : ''}

HTML (truncado em 80KB, sem scripts/styles):
${stripped}`;

    const client = new Anthropic({ apiKey: key });
    let raw = '';
    try {
      const response = await client.messages.create({
        model,
        max_tokens: 2000,
        temperature: 0.3,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });
      raw = ((response.content[0] as any)?.text || '').trim();
    } catch (e: any) {
      this.logger.error(`[lp-analyze] Anthropic falhou: ${e?.message ?? e}`);
      throw new HttpException(
        `Claude API falhou: ${e?.message ?? 'desconhecido'}`,
        HttpStatus.BAD_GATEWAY,
      );
    }

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new HttpException(
        'IA retornou resposta sem JSON válido — tente novamente.',
        HttpStatus.BAD_GATEWAY,
      );
    }
    let parsed: any;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      throw new HttpException(
        'IA retornou JSON inválido — tente novamente.',
        HttpStatus.BAD_GATEWAY,
      );
    }

    // Normalização defensiva
    const validSeverities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
    const validCategories = ['OAB', 'CRO', 'PERFORMANCE', 'COPY', 'UX'];
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues
          .filter(
            (i: any) =>
              validSeverities.includes(i?.severity) &&
              typeof i?.title === 'string' &&
              typeof i?.suggestion === 'string',
          )
          .map((i: any) => ({
            severity: i.severity,
            category: validCategories.includes(i.category) ? i.category : 'CRO',
            title: String(i.title).slice(0, 200),
            suggestion: String(i.suggestion).slice(0, 500),
          }))
          .slice(0, 12)
      : [];

    const analysis = {
      summary:
        typeof parsed.summary === 'string'
          ? parsed.summary.slice(0, 500)
          : 'Análise indisponível.',
      score_cro:
        typeof parsed.score_cro === 'number' &&
        parsed.score_cro >= 0 &&
        parsed.score_cro <= 100
          ? Math.round(parsed.score_cro)
          : 50,
      issues,
      model,
      analyzed_at: new Date().toISOString(),
    };

    const updated = await this.prisma.landingPage.update({
      where: { id },
      data: {
        last_analyzed_at: new Date(),
        analysis: analysis as any,
      },
    });

    this.logger.log(
      `[lp-analyze] tenant=${tenantId} url=${page.url} score=${analysis.score_cro} issues=${issues.length} model=${model}`,
    );

    return {
      page: {
        id: updated.id,
        url: updated.url,
        last_analyzed_at: updated.last_analyzed_at,
      },
      analysis,
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private async fetchPageSpeed(
    url: string,
    strategy: 'mobile' | 'desktop',
    apiKey: string,
  ): Promise<any> {
    const params = new URLSearchParams({
      url,
      key: apiKey,
      strategy,
      category: 'performance',
    });
    try {
      const resp = await fetch(`${PAGESPEED_API}?${params}`, {
        signal: AbortSignal.timeout(60_000),
      });
      if (!resp.ok) {
        const body = await resp.text();
        throw new HttpException(
          `PageSpeed API HTTP ${resp.status}: ${body.slice(0, 200)}`,
          HttpStatus.BAD_GATEWAY,
        );
      }
      return await resp.json();
    } catch (e: any) {
      if (e instanceof HttpException) throw e;
      throw new HttpException(
        `PageSpeed timeout/erro: ${e?.message ?? 'desconhecido'}`,
        HttpStatus.GATEWAY_TIMEOUT,
      );
    }
  }

  /**
   * Extrai apenas as 5 maiores oportunidades (savings em ms) — evita
   * armazenar 200KB+ do JSON completo do Lighthouse.
   */
  private pickOpportunities(audits: any): any[] {
    const out: any[] = [];
    for (const [key, audit] of Object.entries(audits)) {
      const a = audit as any;
      if (!a) continue;
      if (a.score === null || a.score === 1) continue; // só falhas/parciais
      const savings = a.numericValue ?? a.details?.overallSavingsMs ?? 0;
      if (savings <= 0) continue;
      out.push({
        id: key,
        title: a.title,
        savings_ms: Math.round(savings),
        score: a.score,
      });
    }
    return out
      .sort((a, b) => b.savings_ms - a.savings_ms)
      .slice(0, 5);
  }

  /** Strip tags <script>, <style>, <svg> e atributos inline pra economizar tokens. */
  private stripHtml(html: string): string {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<svg[\s\S]*?<\/svg>/gi, '')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Normaliza URL — força https://, remove trailing slash. */
  private normalizeUrl(raw: string): string | null {
    let s = (raw || '').trim();
    if (!s) return null;
    if (!/^https?:\/\//i.test(s)) {
      s = `https://${s}`;
    }
    try {
      const u = new URL(s);
      u.hash = '';
      for (const key of [...u.searchParams.keys()]) {
        const k = key.toLowerCase();
        if (
          k.startsWith('utm_') ||
          ['gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid'].includes(k)
        ) {
          u.searchParams.delete(key);
        }
      }
      let str = u.toString();
      if (str.endsWith('/') && u.pathname === '/') str = str.slice(0, -1);
      return str;
    } catch {
      return null;
    }
  }

  private extractFinalUrls(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string');
  }
}
