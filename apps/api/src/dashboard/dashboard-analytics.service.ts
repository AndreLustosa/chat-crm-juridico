import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardAnalyticsService {
  constructor(private prisma: PrismaService) {}

  private tenantWhere(tenantId?: string) {
    return tenantId
      ? { OR: [{ tenant_id: tenantId }, { tenant_id: null }] }
      : {};
  }

  /* ─── Revenue Trend (monthly) ─── */
  async revenueTrend(userId: string, roles: string | string[], tenantId?: string, months = 12) {
    const roleArr = Array.isArray(roles) ? roles : (roles ? [roles] : []);
    const isAdmin = roleArr.includes('ADMIN');
    const tw = this.tenantWhere(tenantId);
    const since = new Date();
    since.setMonth(since.getMonth() - months);

    const caseFilter = isAdmin
      ? { legal_case: { ...tw } }
      : { legal_case: { lawyer_id: userId, ...tw } };

    // Contracted: group CaseHonorario by month of contract_date
    const lawyerClause = isAdmin ? '' : `AND lc.lawyer_id = '${userId}'`;

    const contracted = await this.prisma.$queryRawUnsafe<{ month: string; total: number }[]>(
      `SELECT TO_CHAR(ch.contract_date, 'YYYY-MM') as month, SUM(ch.total_value)::float as total
       FROM "CaseHonorario" ch
       JOIN "LegalCase" lc ON lc.id = ch.legal_case_id
       WHERE ch.contract_date >= $1 ${lawyerClause}
       GROUP BY month ORDER BY month`,
      since,
    ).catch(() => []);

    // Collected: group HonorarioPayment (PAGO) by month of paid_at
    const collected = await this.prisma.$queryRawUnsafe<{ month: string; total: number }[]>(
      `SELECT TO_CHAR(hp.paid_at, 'YYYY-MM') as month, SUM(hp.amount)::float as total
       FROM "HonorarioPayment" hp
       JOIN "CaseHonorario" ch ON ch.id = hp.honorario_id
       JOIN "LegalCase" lc ON lc.id = ch.legal_case_id
       WHERE hp.status = 'PAGO' AND hp.paid_at >= $1 ${lawyerClause}
       GROUP BY month ORDER BY month`,
      since,
    ).catch(() => []);

    // Receivable: group HonorarioPayment (PENDENTE) by month of due_date
    const receivable = await this.prisma.$queryRawUnsafe<{ month: string; total: number }[]>(
      `SELECT TO_CHAR(hp.due_date, 'YYYY-MM') as month, SUM(hp.amount)::float as total
       FROM "HonorarioPayment" hp
       JOIN "CaseHonorario" ch ON ch.id = hp.honorario_id
       JOIN "LegalCase" lc ON lc.id = ch.legal_case_id
       WHERE hp.status = 'PENDENTE' AND hp.due_date >= $1 ${lawyerClause}
       GROUP BY month ORDER BY month`,
      since,
    ).catch(() => []);

    // Merge into unified month array
    const monthMap = new Map<string, { contracted: number; collected: number; receivable: number }>();
    const fill = (arr: { month: string; total: number }[], key: string) => {
      for (const r of arr) {
        const entry = monthMap.get(r.month) || { contracted: 0, collected: 0, receivable: 0 };
        (entry as any)[key] = r.total;
        monthMap.set(r.month, entry);
      }
    };
    fill(contracted, 'contracted');
    fill(collected, 'collected');
    fill(receivable, 'receivable');

    const monthsSorted = [...monthMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, vals]) => ({ month, ...vals }));

    return { months: monthsSorted };
  }

  /* ─── Lead Funnel ─── */
  async leadFunnel(userId: string, roles: string | string[], tenantId?: string, startDate?: string, endDate?: string) {
    const tw = this.tenantWhere(tenantId);
    const dateFilter = startDate && endDate
      ? { created_at: { gte: new Date(startDate), lte: new Date(endDate) } }
      : {};

    const pipeline = await this.prisma.lead.groupBy({
      by: ['stage'],
      _count: true,
      where: { ...tw, ...dateFilter },
    });

    const totalLeads = pipeline.reduce((s, g) => s + g._count, 0);
    const clientCount = await this.prisma.lead.count({
      where: { is_client: true, ...tw, ...dateFilter },
    });

    // Stage history for conversion rates
    const stageOrder = ['INICIAL', 'QUALIFICANDO', 'AGUARDANDO_FORM', 'REUNIAO_AGENDADA', 'AGUARDANDO_DOCS', 'AGUARDANDO_PROC', 'FINALIZADO'];

    const stages = stageOrder.map((stage, i) => {
      const count = pipeline.find((g) => g.stage === stage)?._count || 0;
      const prevCount = i > 0
        ? (pipeline.find((g) => g.stage === stageOrder[i - 1])?._count || 0)
        : totalLeads;
      const conversionRate = prevCount > 0 ? Math.round((count / prevCount) * 100) : 0;

      return { stage, count, conversionRate, avgDays: 0 };
    });

    return {
      stages,
      totalLeads,
      totalClients: clientCount,
      overallConversionRate: totalLeads > 0 ? Math.round((clientCount / totalLeads) * 100) : 0,
    };
  }

  /* ─── Conversion Velocity ─── */
  async conversionVelocity(userId: string, roles: string | string[], tenantId?: string, startDate?: string, endDate?: string) {
    const tw = this.tenantWhere(tenantId);
    const dateFilter: any = { is_client: true, became_client_at: { not: null }, ...tw };
    if (startDate && endDate) {
      dateFilter.became_client_at = { gte: new Date(startDate), lte: new Date(endDate) };
    }

    const clients = await this.prisma.lead.findMany({
      where: dateFilter,
      select: { created_at: true, became_client_at: true },
    });

    if (clients.length === 0) {
      return { avgDays: 0, medianDays: 0, byMonth: [] };
    }

    const durations = clients
      .filter((c) => c.became_client_at)
      .map((c) => {
        const diff = c.became_client_at!.getTime() - c.created_at.getTime();
        return Math.max(0, Math.round(diff / (1000 * 60 * 60 * 24)));
      })
      .sort((a, b) => a - b);

    const avg = durations.reduce((s, d) => s + d, 0) / durations.length;
    const median = durations[Math.floor(durations.length / 2)];

    // Group by month
    const monthMap = new Map<string, { sum: number; count: number }>();
    for (const c of clients) {
      if (!c.became_client_at) continue;
      const m = c.became_client_at.toISOString().slice(0, 7);
      const days = Math.round((c.became_client_at.getTime() - c.created_at.getTime()) / (1000 * 60 * 60 * 24));
      const entry = monthMap.get(m) || { sum: 0, count: 0 };
      entry.sum += days;
      entry.count++;
      monthMap.set(m, entry);
    }

    const byMonth = [...monthMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, v]) => ({ month, avgDays: Math.round(v.sum / v.count), count: v.count }));

    return { avgDays: Math.round(avg), medianDays: median, byMonth };
  }

  /* ─── Task Completion ─── */
  async taskCompletion(userId: string, roles: string | string[], tenantId?: string, startDate?: string, endDate?: string) {
    const roleArr = Array.isArray(roles) ? roles : (roles ? [roles] : []);
    const isAdmin = roleArr.includes('ADMIN');
    const tw = this.tenantWhere(tenantId);
    const baseWhere: any = { type: 'TAREFA', ...tw };
    if (!isAdmin) baseWhere.assigned_user_id = userId;
    if (startDate && endDate) {
      baseWhere.created_at = { gte: new Date(startDate), lte: new Date(endDate) };
    }

    const [completed, pending, overdue] = await Promise.all([
      this.prisma.calendarEvent.count({ where: { ...baseWhere, status: 'CONCLUIDO' } }),
      this.prisma.calendarEvent.count({ where: { ...baseWhere, status: { in: ['AGENDADO', 'CONFIRMADO'] } } }),
      this.prisma.calendarEvent.count({
        where: { ...baseWhere, status: { in: ['AGENDADO', 'CONFIRMADO'] }, start_at: { lt: new Date() } },
      }),
    ]);

    const total = completed + pending;
    return {
      completed,
      pending: pending - overdue,
      overdue,
      completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  }

  /* ─── Case Duration ─── */
  async caseDuration(userId: string, roles: string | string[], tenantId?: string) {
    const roleArr = Array.isArray(roles) ? roles : (roles ? [roles] : []);
    const isAdmin = roleArr.includes('ADMIN');
    const tw = this.tenantWhere(tenantId);

    const cases = await this.prisma.legalCase.findMany({
      where: {
        in_tracking: true,
        archived: false,
        ...(isAdmin ? {} : { lawyer_id: userId }),
        ...tw,
      },
      select: { tracking_stage: true, stage_changed_at: true, created_at: true },
    });

    // Group by tracking_stage, calc avg days since stage_changed_at
    const stageMap = new Map<string, { totalDays: number; count: number }>();
    const now = new Date();
    for (const c of cases) {
      const stage = c.tracking_stage || 'DISTRIBUIDO';
      const ref = c.stage_changed_at || c.created_at;
      const days = Math.round((now.getTime() - ref.getTime()) / (1000 * 60 * 60 * 24));
      const entry = stageMap.get(stage) || { totalDays: 0, count: 0 };
      entry.totalDays += days;
      entry.count++;
      stageMap.set(stage, entry);
    }

    const stages = [...stageMap.entries()]
      .map(([stage, v]) => ({ stage, avgDays: Math.round(v.totalDays / v.count), count: v.count }));

    return { stages };
  }

  /* ─── Financial Aging ─── */
  async financialAging(userId: string, roles: string | string[], tenantId?: string) {
    const roleArr = Array.isArray(roles) ? roles : (roles ? [roles] : []);
    const isAdmin = roleArr.includes('ADMIN');
    const tw = this.tenantWhere(tenantId);
    const now = new Date();

    const overdue = await this.prisma.honorarioPayment.findMany({
      where: {
        status: 'PENDENTE',
        due_date: { lt: now },
        honorario: { legal_case: isAdmin ? { ...tw } : { lawyer_id: userId, ...tw } },
      },
      select: { amount: true, due_date: true },
    });

    const buckets = [
      { range: '0-30 dias', min: 0, max: 30, count: 0, total: 0 },
      { range: '31-60 dias', min: 31, max: 60, count: 0, total: 0 },
      { range: '61-90 dias', min: 61, max: 90, count: 0, total: 0 },
      { range: '90+ dias', min: 91, max: Infinity, count: 0, total: 0 },
    ];

    let grandTotal = 0;
    for (const p of overdue) {
      if (!p.due_date) continue;
      const days = Math.round((now.getTime() - p.due_date.getTime()) / (1000 * 60 * 60 * 24));
      const amount = Number(p.amount);
      grandTotal += amount;
      const bucket = buckets.find((b) => days >= b.min && days <= b.max);
      if (bucket) { bucket.count++; bucket.total += amount; }
    }

    return {
      buckets: buckets.map(({ range, count, total }) => ({ range, count, total })),
      grandTotal,
    };
  }

  /* ─── AI Usage ─── */
  async aiUsage(userId: string, roles: string | string[], tenantId?: string, months = 6) {
    const since = new Date();
    since.setMonth(since.getMonth() - months);

    const usage = await this.prisma.aiUsage.findMany({
      where: { created_at: { gte: since } },
      select: { total_tokens: true, cost_usd: true, model: true, created_at: true },
    });

    // Group by month
    const monthMap = new Map<string, { tokens: number; cost: number }>();
    const modelMap = new Map<string, { tokens: number; cost: number }>();
    let totalCost = 0;

    for (const u of usage) {
      const m = u.created_at.toISOString().slice(0, 7);
      const tokens = u.total_tokens || 0;
      const cost = Number(u.cost_usd || 0);
      totalCost += cost;

      const me = monthMap.get(m) || { tokens: 0, cost: 0 };
      me.tokens += tokens;
      me.cost += cost;
      monthMap.set(m, me);

      const model = u.model || 'unknown';
      const moe = modelMap.get(model) || { tokens: 0, cost: 0 };
      moe.tokens += tokens;
      moe.cost += cost;
      modelMap.set(model, moe);
    }

    return {
      byMonth: [...monthMap.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([month, v]) => ({ month, tokens: v.tokens, cost: Math.round(v.cost * 100) / 100 })),
      byModel: [...modelMap.entries()]
        .map(([model, v]) => ({ model, tokens: v.tokens, cost: Math.round(v.cost * 100) / 100 })),
      totalCost: Math.round(totalCost * 100) / 100,
    };
  }

  /* ─── Lead Sources ─── */
  async leadSources(userId: string, roles: string | string[], tenantId?: string, startDate?: string, endDate?: string) {
    const tw = this.tenantWhere(tenantId);
    const dateFilter = startDate && endDate
      ? { created_at: { gte: new Date(startDate), lte: new Date(endDate) } }
      : {};

    const leads = await this.prisma.lead.groupBy({
      by: ['origin'],
      _count: true,
      where: { ...tw, ...dateFilter },
    });

    const total = leads.reduce((s, g) => s + g._count, 0);
    const sources = leads
      .map((g) => ({
        source: g.origin || 'Desconhecido',
        count: g._count,
        percentage: total > 0 ? Math.round((g._count / total) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    return { sources };
  }

  /* ─── Response Time ─── */
  async responseTime(userId: string, roles: string | string[], tenantId?: string, startDate?: string, endDate?: string) {
    const roleArr = Array.isArray(roles) ? roles : (roles ? [roles] : []);
    const isAdmin = roleArr.includes('ADMIN');
    const tw = this.tenantWhere(tenantId);

    const convWhere: any = { ...tw };
    if (!isAdmin) convWhere.assigned_user_id = userId;
    if (startDate && endDate) {
      convWhere.last_message_at = { gte: new Date(startDate), lte: new Date(endDate) };
    }

    // Get conversations with their first inbound and first outbound message
    const conversations = await this.prisma.conversation.findMany({
      where: convWhere,
      select: {
        id: true,
        last_message_at: true,
      },
      take: 500,
      orderBy: { last_message_at: 'desc' },
    });

    const times: { minutes: number; date: string }[] = [];
    for (const c of conversations) {
      // Get first inbound and first outbound messages per conversation
      const [firstIn, firstOut] = await Promise.all([
        this.prisma.message.findFirst({
          where: { conversation_id: c.id, direction: 'in' },
          orderBy: { created_at: 'asc' },
          select: { created_at: true },
        }),
        this.prisma.message.findFirst({
          where: { conversation_id: c.id, direction: 'out' },
          orderBy: { created_at: 'asc' },
          select: { created_at: true },
        }),
      ]);

      if (!firstIn || !firstOut) continue;
      const diff = (firstOut.created_at.getTime() - firstIn.created_at.getTime()) / (1000 * 60);
      if (diff > 0 && diff < 1440) {
        times.push({ minutes: diff, date: firstIn.created_at.toISOString().slice(0, 10) });
      }
    }

    if (times.length === 0) {
      return { avgMinutes: 0, medianMinutes: 0, byDay: [] };
    }

    const sorted = times.map((t) => t.minutes).sort((a, b) => a - b);
    const avg = sorted.reduce((s, t) => s + t, 0) / sorted.length;
    const median = sorted[Math.floor(sorted.length / 2)];

    // Group by day
    const dayMap = new Map<string, { sum: number; count: number }>();
    for (const t of times) {
      const entry = dayMap.get(t.date) || { sum: 0, count: 0 };
      entry.sum += t.minutes;
      entry.count++;
      dayMap.set(t.date, entry);
    }

    const byDay = [...dayMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, v]) => ({ date, avgMinutes: Math.round(v.sum / v.count) }));

    return { avgMinutes: Math.round(avg), medianMinutes: Math.round(median), byDay };
  }
}
