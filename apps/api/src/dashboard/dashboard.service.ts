import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  private tenantWhere(tenantId?: string) {
    return tenantId
      ? { tenant_id: tenantId }
      : {};
  }

  async aggregate(userId: string, roles: string | string[], tenantId?: string) {
    const roleArr = Array.isArray(roles) ? roles : (roles ? [roles] : []);
    const isAdmin = roleArr.includes('ADMIN');
    const tw = this.tenantWhere(tenantId);
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - now.getDay()); startOfWeek.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // ─── Resolve user inbox IDs (for non-admin conversation counting) ──
    let userInboxIds: string[] = [];
    if (!isAdmin) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { inboxes: { select: { id: true } } },
      });
      userInboxIds = (user?.inboxes || []).map((i) => i.id);
    }

    // ─── Build conversation where clause ──
    const convWhere = isAdmin
      ? { status: { not: 'FECHADO' }, ...tw }
      : {
          status: { not: 'FECHADO' },
          ...(userInboxIds.length > 0
            ? { inbox_id: { in: userInboxIds } }
            : { assigned_user_id: userId }),
        };

    const pendingTransferWhere = isAdmin
      ? { pending_transfer_to_id: { not: null }, status: { not: 'FECHADO' }, ...tw }
      : { pending_transfer_to_id: userId, status: { not: 'FECHADO' } };

    // ─── Case filters ──
    const caseWhere = isAdmin
      ? { archived: false, ...tw }
      : { archived: false, lawyer_id: userId, ...tw };

    // ─── Task filters (CalendarEvent type=TAREFA) ──
    const calTaskWhere = (statuses: string[]) =>
      isAdmin
        ? { type: 'TAREFA', status: { in: statuses }, ...tw }
        : { type: 'TAREFA', status: { in: statuses }, assigned_user_id: userId, ...tw };

    // ─── Event filters ──
    const eventWhere = {
      start_at: { gte: now, lte: sevenDaysFromNow },
      status: { notIn: ['CANCELADO', 'CONCLUIDO'] },
      ...(isAdmin ? {} : { assigned_user_id: userId }),
      ...tw,
    };

    // ─── Honorário payment filters ──
    const paymentCaseFilter = isAdmin
      ? { honorario: { legal_case: { ...tw } } }
      : { honorario: { legal_case: { lawyer_id: userId, ...tw } } };

    // ─── Leads em atendimento: leads ainda ativos (não-clientes, fora de
    // PERDIDO/FINALIZADO). Mesmo filtro usado pelo Inbox (Leads tab).
    // Não-admin ve apenas os leads atribuidos a ele via cs_user_id.
    const leadsInServiceWhere: any = {
      is_client: false,
      stage: { notIn: ['PERDIDO', 'FINALIZADO'] },
      ...(isAdmin ? {} : { cs_user_id: userId }),
      ...tw,
    };

    // ─── Leads no geral: todos os leads exceto os PERDIDOs (inclui ativos + FINALIZADOs) ──
    const leadsTotalWhere: any = {
      stage: { not: 'PERDIDO' },
      ...(isAdmin ? {} : { cs_user_id: userId }),
      ...tw,
    };

    // ─── Leads perdidos: stage = PERDIDO ──
    const leadsLostWhere: any = {
      stage: 'PERDIDO',
      ...(isAdmin ? {} : { cs_user_id: userId }),
      ...tw,
    };

    // ─── Run all queries in parallel ──
    const [
      userName,
      openConvCount,
      pendingTransferCount,
      leadsInServiceCount,
      leadsTotalCount,
      leadsLostCount,
      leadPipelineRaw,
      legalCasesRaw,
      trackingCasesRaw,
      upcomingEvents,
      tasksPending,
      tasksInProgress,
      tasksOverdue,
      totalContracted,
      totalCollected,
      totalReceivable,
      totalOverdue,
      overdueCount,
      recentDjen,
      teamUsers,
      closedToday,
      closedThisWeek,
      closedThisMonth,
    ] = await Promise.all([
      // 1. User name
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      }),
      // 2. Open conversations
      this.prisma.conversation.count({ where: convWhere }),
      // 3. Pending transfers
      this.prisma.conversation.count({ where: pendingTransferWhere }),
      // 3b. Leads em atendimento (cs_user_id atribuído e ainda não cliente)
      this.prisma.lead.count({ where: leadsInServiceWhere }),
      // 3c. Leads no geral (exclui PERDIDO — inclui ativos + FINALIZADOs)
      this.prisma.lead.count({ where: leadsTotalWhere }),
      // 3d. Leads perdidos (stage = PERDIDO)
      this.prisma.lead.count({ where: leadsLostWhere }),
      // 4. Lead pipeline
      this.prisma.lead.groupBy({
        by: ['stage'],
        _count: true,
        where: tw,
      }),
      // 5. Legal cases (pre-tracking)
      this.prisma.legalCase.groupBy({
        by: ['stage'],
        _count: true,
        where: { ...caseWhere, in_tracking: false },
      }),
      // 6. Tracking cases
      this.prisma.legalCase.groupBy({
        by: ['tracking_stage'],
        _count: true,
        where: { ...caseWhere, in_tracking: true },
      }),
      // 7. Upcoming events
      this.prisma.calendarEvent.findMany({
        where: eventWhere,
        select: {
          id: true,
          type: true,
          title: true,
          start_at: true,
          end_at: true,
          status: true,
          priority: true,
          lead: { select: { name: true } },
          legal_case_id: true,
        },
        orderBy: { start_at: 'asc' },
        take: 20,
      }),
      // 8. Tasks pending (CalendarEvent TAREFA com status AGENDADO)
      this.prisma.calendarEvent.count({ where: calTaskWhere(['AGENDADO']) }),
      // 9. Tasks in progress (CalendarEvent TAREFA com status CONFIRMADO)
      this.prisma.calendarEvent.count({ where: calTaskWhere(['CONFIRMADO']) }),
      // 10. Tasks overdue (TAREFA pendente com start_at no passado)
      this.prisma.calendarEvent.count({
        where: {
          ...calTaskWhere(['AGENDADO', 'CONFIRMADO']),
          start_at: { lt: now },
        },
      }),
      // 11. Total contracted (sum of honorario total_value)
      this.prisma.caseHonorario.aggregate({
        _sum: { total_value: true },
        where: isAdmin
          ? { legal_case: { archived: false, ...tw } }
          : { legal_case: { lawyer_id: userId, archived: false, ...tw } },
      }),
      // 12. Total collected (PAGO payments)
      this.prisma.honorarioPayment.aggregate({
        _sum: { amount: true },
        where: { status: 'PAGO', ...paymentCaseFilter },
      }),
      // 13. Total receivable (PENDENTE payments)
      this.prisma.honorarioPayment.aggregate({
        _sum: { amount: true },
        where: { status: 'PENDENTE', ...paymentCaseFilter },
      }),
      // 14. Total overdue (PENDENTE + due_date < now)
      this.prisma.honorarioPayment.aggregate({
        _sum: { amount: true },
        where: {
          status: 'PENDENTE',
          due_date: { lt: now },
          ...paymentCaseFilter,
        },
      }),
      // 15. Overdue count
      this.prisma.honorarioPayment.count({
        where: {
          status: 'PENDENTE',
          due_date: { lt: now },
          ...paymentCaseFilter,
        },
      }),
      // 16. Recent DJEN
      this.prisma.djenPublication.findMany({
        where: {
          data_disponibilizacao: { gte: sevenDaysAgo },
          ...(isAdmin
            ? {}
            : { legal_case: { lawyer_id: userId } }),
        },
        select: {
          id: true,
          numero_processo: true,
          tipo_comunicacao: true,
          data_disponibilizacao: true,
          legal_case: {
            select: {
              id: true,
              lead: { select: { name: true } },
            },
          },
        },
        orderBy: { data_disponibilizacao: 'desc' },
        take: 10,
      }),
      // 17. Team users (ADMIN only)
      isAdmin
        ? this.prisma.user.findMany({
            where: tw,
            select: { id: true, name: true, roles: true },
            orderBy: { name: 'asc' },
          })
        : Promise.resolve([]),
      // 18. Conversas encerradas hoje
      this.prisma.conversation.count({
        where: { status: 'FECHADO', last_message_at: { gte: startOfToday }, ...tw },
      }),
      // 19. Conversas encerradas esta semana
      this.prisma.conversation.count({
        where: { status: 'FECHADO', last_message_at: { gte: startOfWeek }, ...tw },
      }),
      // 20. Conversas encerradas este mês
      this.prisma.conversation.count({
        where: { status: 'FECHADO', last_message_at: { gte: startOfMonth }, ...tw },
      }),
    ]);

    // ─── Build team metrics (ADMIN only) ──
    let teamMetrics: any[] = [];
    if (isAdmin && teamUsers.length > 0) {
      teamMetrics = await Promise.all(
        teamUsers.map(async (member) => {
          const [
            openConversations,
            activeCases,
            pendingTasks,
            overdueTasks,
            memberCollected,
            memberReceivable,
          ] = await Promise.all([
            this.prisma.conversation.count({
              where: {
                assigned_user_id: member.id,
                status: { not: 'FECHADO' },
              },
            }),
            this.prisma.legalCase.count({
              where: { lawyer_id: member.id, archived: false, ...tw },
            }),
            this.prisma.calendarEvent.count({
              where: {
                type: 'TAREFA',
                assigned_user_id: member.id,
                status: { in: ['AGENDADO', 'CONFIRMADO'] },
              },
            }),
            this.prisma.calendarEvent.count({
              where: {
                type: 'TAREFA',
                assigned_user_id: member.id,
                status: { in: ['AGENDADO', 'CONFIRMADO'] },
                start_at: { lt: now },
              },
            }),
            this.prisma.honorarioPayment.aggregate({
              _sum: { amount: true },
              where: {
                status: 'PAGO',
                honorario: { legal_case: { lawyer_id: member.id, ...tw } },
              },
            }),
            this.prisma.honorarioPayment.aggregate({
              _sum: { amount: true },
              where: {
                status: 'PENDENTE',
                honorario: { legal_case: { lawyer_id: member.id, ...tw } },
              },
            }),
          ]);

          return {
            userId: member.id,
            name: member.name,
            role: member.roles?.[0] ?? 'OPERADOR',
            openConversations,
            activeCases,
            pendingTasks,
            overdueTasks,
            totalCollected: Number(memberCollected._sum.amount || 0),
            totalReceivable: Number(memberReceivable._sum.amount || 0),
          };
        }),
      );
    }

    // ─── Assemble response ──
    const legalTotal = legalCasesRaw.reduce((s, g) => s + g._count, 0);
    const trackingTotal = trackingCasesRaw.reduce((s, g) => s + g._count, 0);

    return {
      user: {
        id: userId,
        name: userName?.name || 'Usuário',
        roles: roleArr,
      },
      conversations: {
        open: openConvCount,
        pendingTransfers: pendingTransferCount,
      },
      leadsInService: leadsInServiceCount,
      leadsTotal: leadsTotalCount,
      leadsLost: leadsLostCount,
      leadPipeline: leadPipelineRaw.map((g) => ({
        stage: g.stage || 'QUALIFICANDO',
        count: g._count,
      })),
      legalCases: {
        total: legalTotal,
        byStage: legalCasesRaw.map((g) => ({
          stage: g.stage,
          count: g._count,
        })),
      },
      trackingCases: {
        total: trackingTotal,
        byStage: trackingCasesRaw.map((g) => ({
          stage: g.tracking_stage || 'DISTRIBUIDO',
          count: g._count,
        })),
      },
      upcomingEvents: upcomingEvents.map((e) => ({
        id: e.id,
        type: e.type,
        title: e.title,
        start_at: e.start_at.toISOString(),
        end_at: e.end_at?.toISOString() || null,
        status: e.status,
        priority: e.priority,
        lead_name: e.lead?.name || null,
        legal_case_id: e.legal_case_id,
      })),
      tasks: {
        pending: tasksPending,
        inProgress: tasksInProgress,
        overdue: tasksOverdue,
      },
      financials: {
        totalContracted: Number(totalContracted._sum.total_value || 0),
        totalCollected: Number(totalCollected._sum.amount || 0),
        totalReceivable: Number(totalReceivable._sum.amount || 0),
        totalOverdue: Number(totalOverdue._sum.amount || 0),
        overdueCount,
      },
      recentDjen: recentDjen.map((d) => ({
        id: d.id,
        numero_processo: d.numero_processo,
        tipo_comunicacao: d.tipo_comunicacao,
        data_disponibilizacao: d.data_disponibilizacao,
        lead_name: d.legal_case?.lead?.name || null,
        legal_case_id: d.legal_case?.id || null,
      })),
      teamMetrics,
      inboxStats: {
        closedToday,
        closedThisWeek,
        closedThisMonth,
      },
    };
  }

  /* ──────────────────────────────────────────────────────────────────
   * Comparações — retorna as 6 métricas do StatsGrid em 3 janelas:
   *   - current: [start, end]
   *   - previousPeriod: período equivalente imediatamente anterior
   *   - previousYear: mesmo [start, end] de um ano atrás
   * ────────────────────────────────────────────────────────────────── */
  async comparisons(
    userId: string,
    roles: string | string[],
    tenantId?: string,
    startDate?: string,
    endDate?: string,
  ) {
    const roleArr = Array.isArray(roles) ? roles : (roles ? [roles] : []);
    const isAdmin = roleArr.includes('ADMIN');
    const tw = this.tenantWhere(tenantId);
    const now = new Date();

    const end = endDate ? new Date(endDate) : now;
    const start = startDate ? new Date(startDate) : new Date(end.getTime() - 30 * 86400000);
    const periodMs = end.getTime() - start.getTime();
    const prevEnd = new Date(start.getTime());
    const prevStart = new Date(start.getTime() - periodMs);

    const yearEnd = new Date(end); yearEnd.setFullYear(yearEnd.getFullYear() - 1);
    const yearStart = new Date(start); yearStart.setFullYear(yearStart.getFullYear() - 1);

    const userFilter = isAdmin ? {} : { cs_user_id: userId };
    const lawyerFilter = isAdmin ? {} : { lawyer_id: userId };
    const taskUserFilter = isAdmin ? {} : { assigned_user_id: userId };

    // Helper: conta leads dentro de uma janela por um campo de data
    const countLeads = (dateField: string, extraWhere: any, wStart: Date, wEnd: Date) =>
      this.prisma.lead.count({
        where: { ...extraWhere, ...userFilter, ...tw, [dateField]: { gte: wStart, lte: wEnd } },
      });
    const countCases = (wStart: Date, wEnd: Date) =>
      this.prisma.legalCase.count({
        where: { archived: false, ...lawyerFilter, ...tw, created_at: { gte: wStart, lte: wEnd } },
      });
    const countTracking = (wStart: Date, wEnd: Date) =>
      this.prisma.legalCase.count({
        where: { in_tracking: true, archived: false, ...lawyerFilter, ...tw, created_at: { gte: wStart, lte: wEnd } },
      });
    const countOverdueTasks = (wStart: Date, wEnd: Date) =>
      this.prisma.calendarEvent.count({
        where: {
          type: 'TAREFA',
          status: { in: ['AGENDADO', 'CONFIRMADO'] },
          start_at: { gte: wStart, lte: wEnd },
          ...taskUserFilter,
          ...tw,
        },
      });

    const windows: { key: 'current' | 'previousPeriod' | 'previousYear'; start: Date; end: Date }[] = [
      { key: 'current', start, end },
      { key: 'previousPeriod', start: prevStart, end: prevEnd },
      { key: 'previousYear', start: yearStart, end: yearEnd },
    ];

    const perWindow: Record<string, any> = {};
    for (const w of windows) {
      const [leadsTotal, leadsInService, leadsConverted, leadsLost, cases, tracking, overdue] = await Promise.all([
        countLeads('created_at', { stage: { not: 'PERDIDO' } }, w.start, w.end),
        countLeads(
          'stage_entered_at',
          { is_client: false, stage: { notIn: ['PERDIDO', 'FINALIZADO'] } },
          w.start, w.end,
        ),
        countLeads('became_client_at', { is_client: true }, w.start, w.end),
        countLeads('stage_entered_at', { stage: 'PERDIDO' }, w.start, w.end),
        countCases(w.start, w.end),
        countTracking(w.start, w.end),
        countOverdueTasks(w.start, w.end),
      ]);

      const convRate = leadsTotal > 0 ? Math.round((leadsConverted / leadsTotal) * 1000) / 10 : 0;

      perWindow[w.key] = {
        leadsTotal,
        leadsInService,
        leadsConverted,
        leadsLost,
        conversionRate: convRate,
        overdueTasks: overdue,
        activeCases: cases,
        trackingCases: tracking,
      };
    }

    const pct = (curr: number, prev: number): number | null => {
      if (prev === 0) return curr === 0 ? 0 : null; // null = sem base de comparação
      return Math.round(((curr - prev) / prev) * 1000) / 10;
    };

    const metricKeys = [
      { key: 'leadsTotal', label: 'Leads Geral' },
      { key: 'leadsInService', label: 'Leads em Atendimento' },
      { key: 'leadsConverted', label: 'Leads Convertidos' },
      { key: 'leadsLost', label: 'Leads Perdidos' },
      { key: 'conversionRate', label: 'Taxa de Conversão', suffix: '%' as const },
      { key: 'overdueTasks', label: 'Tarefas Atrasadas' },
      { key: 'activeCases', label: 'Casos Ativos' },
      { key: 'trackingCases', label: 'Processos' },
    ];

    const metrics = metricKeys.map((m) => {
      const c = perWindow.current[m.key];
      const p = perWindow.previousPeriod[m.key];
      const y = perWindow.previousYear[m.key];
      return {
        key: m.key,
        label: m.label,
        suffix: (m as any).suffix,
        current: c,
        previousPeriod: p,
        previousYear: y,
        pctVsPrev: pct(c, p),
        pctVsYear: pct(c, y),
      };
    });

    return {
      windows: {
        current: { start: start.toISOString(), end: end.toISOString() },
        previousPeriod: { start: prevStart.toISOString(), end: prevEnd.toISOString() },
        previousYear: { start: yearStart.toISOString(), end: yearEnd.toISOString() },
      },
      metrics,
    };
  }
}
