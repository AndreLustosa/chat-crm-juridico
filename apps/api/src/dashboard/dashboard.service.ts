import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  private tenantWhere(tenantId?: string) {
    return tenantId
      ? { OR: [{ tenant_id: tenantId }, { tenant_id: null }] }
      : {};
  }

  async aggregate(userId: string, role: string, tenantId?: string) {
    const isAdmin = role === 'ADMIN';
    const tw = this.tenantWhere(tenantId);
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

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
      ? { pending_transfer_to: { not: null }, status: { not: 'FECHADO' }, ...tw }
      : { pending_transfer_to: userId, status: { not: 'FECHADO' } };

    // ─── Case filters ──
    const caseWhere = isAdmin
      ? { archived: false, ...tw }
      : { archived: false, lawyer_id: userId, ...tw };

    // ─── Task filters ──
    const taskWhere = (statuses: string[]) =>
      isAdmin
        ? { status: { in: statuses }, ...tw }
        : { status: { in: statuses }, assigned_user_id: userId, ...tw };

    // ─── Event filters ──
    const eventWhere = {
      start_at: { gte: now, lte: sevenDaysFromNow },
      status: { not: 'CANCELADO' },
      ...(isAdmin ? {} : { assigned_user_id: userId }),
      ...tw,
    };

    // ─── Honorário payment filters ──
    const paymentCaseFilter = isAdmin
      ? { honorario: { legal_case: { ...tw } } }
      : { honorario: { legal_case: { lawyer_id: userId, ...tw } } };

    // ─── Run all queries in parallel ──
    const [
      userName,
      openConvCount,
      pendingTransferCount,
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
      // 8. Tasks pending
      this.prisma.task.count({ where: taskWhere(['A_FAZER']) }),
      // 9. Tasks in progress
      this.prisma.task.count({ where: taskWhere(['FAZENDO']) }),
      // 10. Tasks overdue
      this.prisma.task.count({
        where: {
          ...taskWhere(['A_FAZER', 'FAZENDO']),
          due_at: { lt: now },
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
            select: { id: true, name: true, role: true },
            orderBy: { name: 'asc' },
          })
        : Promise.resolve([]),
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
            this.prisma.task.count({
              where: {
                assigned_user_id: member.id,
                status: { in: ['A_FAZER', 'FAZENDO'] },
              },
            }),
            this.prisma.task.count({
              where: {
                assigned_user_id: member.id,
                status: { in: ['A_FAZER', 'FAZENDO'] },
                due_at: { lt: now },
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
            role: member.role,
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
        role,
      },
      conversations: {
        open: openConvCount,
        pendingTransfers: pendingTransferCount,
      },
      leadPipeline: leadPipelineRaw.map((g) => ({
        stage: g.stage || 'INICIAL',
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
    };
  }
}
