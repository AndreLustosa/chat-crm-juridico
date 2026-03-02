import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface TrackEventDto {
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
  constructor(private prisma: PrismaService) {}

  async track(dto: TrackEventDto) {
    await this.prisma.lpEvent.create({ data: dto });
    return { ok: true };
  }

  async getPages() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const rows = await this.prisma.lpEvent.groupBy({
      by: ['page_path'],
      _count: { id: true },
      where: { created_at: { gte: thirtyDaysAgo } },
      orderBy: { _count: { id: 'desc' } },
    });

    const result = await Promise.all(
      rows.map(async (row) => {
        const views = await this.prisma.lpEvent.count({
          where: { page_path: row.page_path, event_type: 'view', created_at: { gte: thirtyDaysAgo } },
        });
        const clicks = await this.prisma.lpEvent.count({
          where: { page_path: row.page_path, event_type: 'whatsapp_click', created_at: { gte: thirtyDaysAgo } },
        });
        const topSourceRow = await this.prisma.lpEvent.groupBy({
          by: ['utm_source'],
          where: { page_path: row.page_path, event_type: 'view', created_at: { gte: thirtyDaysAgo } },
          _count: { id: true },
          orderBy: { _count: { id: 'desc' } },
          take: 1,
        });
        const top_source = topSourceRow[0]?.utm_source || 'organico';
        const conversion_rate = views > 0 ? ((clicks / views) * 100).toFixed(1) + '%' : '0%';
        return { page_path: row.page_path, views, clicks, conversion_rate, top_source };
      }),
    );

    return result;
  }

  async getPageDetail(page_path: string) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const events = await this.prisma.lpEvent.findMany({
      where: { page_path, created_at: { gte: thirtyDaysAgo } },
      select: { event_type: true, utm_source: true, utm_medium: true, utm_campaign: true, gclid: true, created_at: true },
      orderBy: { created_at: 'asc' },
    });

    const views = events.filter((e) => e.event_type === 'view').length;
    const clicks = events.filter((e) => e.event_type === 'whatsapp_click').length;

    // By source
    const sourceMap: Record<string, { views: number; clicks: number }> = {};
    for (const e of events) {
      const source = e.gclid ? 'google_ads' : e.utm_source || 'organico';
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

    // Last 7 days
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
}
