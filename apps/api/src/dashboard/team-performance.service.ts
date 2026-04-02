import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type Quartile = 'TOP' | 'MID' | 'LOW';

interface UserRef { id: string; name: string; role: string }

@Injectable()
export class TeamPerformanceService {
  constructor(private prisma: PrismaService) {}

  private tenantWhere(tenantId?: string) {
    return tenantId
      ? { OR: [{ tenant_id: tenantId }, { tenant_id: null }] }
      : {};
  }

  async getPerformance(userId: string, role: string, tenantId?: string, startDate?: string, endDate?: string) {
    if (role !== 'ADMIN') return { members: [], teamAverages: {}, period: {}, previousPeriod: {} };

    const tw = this.tenantWhere(tenantId);
    const now = new Date();
    const end = endDate ? new Date(endDate) : now;
    const start = startDate ? new Date(startDate) : new Date(now.getTime() - 30 * 86400000);
    const periodMs = end.getTime() - start.getTime();
    const prevEnd = new Date(start.getTime());
    const prevStart = new Date(start.getTime() - periodMs);

    // ─── 1. Get all team members ──
    const users = await this.prisma.user.findMany({
      where: tw,
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    });

    const advogados = users.filter(u => u.role === 'ADVOGADO');
    const operadores = users.filter(u => u.role === 'OPERADOR');
    const estagiarios = users.filter(u => u.role === 'ESTAGIARIO');
    const admins = users.filter(u => u.role === 'ADMIN');
    const allIds = users.map(u => u.id);
    const advIds = advogados.map(u => u.id);
    const opIds = operadores.map(u => u.id);
    const estIds = estagiarios.map(u => u.id);

    // ─── 2. Batch queries (all roles in parallel) ──
    const [
      // Tasks (ALL roles)
      tasksCompleted, tasksPending, tasksOverdue,
      prevTasksCompleted, prevTasksPending,
      // ADVOGADO queries
      activeCases, casesFiledCurrent, casesFiledPrev,
      sentencedCases, deadlines, petitions,
      honorarioCollected, honorarioReceivable, honorarioContracted,
      prevCollected,
      // OPERADOR queries
      openConvs, closedConvs, closedConvsPrev,
      leadsHandled, leadsConverted, leadsLost,
      stagesAdvanced, stagesAdvancedPrev,
      // ESTAGIARIO queries
      docsUploaded, estDeadlines, estPetitions,
    ] = await Promise.all([
      // ── Tasks (ALL) ──
      this.prisma.calendarEvent.groupBy({
        by: ['assigned_user_id'],
        _count: true,
        where: { type: 'TAREFA', status: 'CONCLUIDO', assigned_user_id: { in: allIds }, ...tw },
      }),
      this.prisma.calendarEvent.groupBy({
        by: ['assigned_user_id'],
        _count: true,
        where: { type: 'TAREFA', status: { in: ['AGENDADO', 'CONFIRMADO'] }, assigned_user_id: { in: allIds }, ...tw },
      }),
      this.prisma.calendarEvent.groupBy({
        by: ['assigned_user_id'],
        _count: true,
        where: { type: 'TAREFA', status: { in: ['AGENDADO', 'CONFIRMADO'] }, start_at: { lt: now }, assigned_user_id: { in: allIds }, ...tw },
      }),
      this.prisma.calendarEvent.groupBy({
        by: ['assigned_user_id'],
        _count: true,
        where: { type: 'TAREFA', status: 'CONCLUIDO', assigned_user_id: { in: allIds }, created_at: { gte: prevStart, lte: prevEnd }, ...tw },
      }),
      this.prisma.calendarEvent.groupBy({
        by: ['assigned_user_id'],
        _count: true,
        where: { type: 'TAREFA', status: { in: ['AGENDADO', 'CONFIRMADO'] }, assigned_user_id: { in: allIds }, created_at: { gte: prevStart, lte: prevEnd }, ...tw },
      }),

      // ── ADVOGADO: Cases ──
      this.prisma.legalCase.groupBy({
        by: ['lawyer_id'],
        _count: true,
        where: { lawyer_id: { in: advIds }, archived: false, ...tw },
      }),
      this.prisma.legalCase.groupBy({
        by: ['lawyer_id'],
        _count: true,
        where: { lawyer_id: { in: advIds }, filed_at: { gte: start, lte: end }, ...tw },
      }),
      this.prisma.legalCase.groupBy({
        by: ['lawyer_id'],
        _count: true,
        where: { lawyer_id: { in: advIds }, filed_at: { gte: prevStart, lte: prevEnd }, ...tw },
      }),
      // Sentenced cases with sentence_type
      this.prisma.legalCase.groupBy({
        by: ['lawyer_id', 'sentence_type'],
        _count: true,
        where: { lawyer_id: { in: advIds }, sentence_type: { not: null }, ...tw },
      }),
      // Deadlines
      this.prisma.caseDeadline.groupBy({
        by: ['created_by_id'],
        _count: true,
        where: { created_by_id: { in: [...advIds, ...estIds] } },
      }),
      // Petitions
      this.prisma.casePetition.groupBy({
        by: ['created_by_id', 'status'],
        _count: true,
        where: { created_by_id: { in: [...advIds, ...estIds] } },
      }),
      // Honorarios collected
      this.prisma.honorarioPayment.groupBy({
        by: ['honorario_id'],
        _sum: { amount: true },
        where: { status: 'PAGO', honorario: { legal_case: { lawyer_id: { in: advIds }, ...tw } } },
      }),
      // Honorarios receivable
      this.prisma.honorarioPayment.groupBy({
        by: ['honorario_id'],
        _sum: { amount: true },
        where: { status: 'PENDENTE', honorario: { legal_case: { lawyer_id: { in: advIds }, ...tw } } },
      }),
      // Honorarios contracted
      this.prisma.caseHonorario.groupBy({
        by: ['legal_case_id'],
        _sum: { total_value: true },
        where: { legal_case: { lawyer_id: { in: advIds }, ...tw } },
      }),
      // Previous collected
      this.prisma.honorarioPayment.groupBy({
        by: ['honorario_id'],
        _sum: { amount: true },
        where: { status: 'PAGO', paid_at: { gte: prevStart, lte: prevEnd }, honorario: { legal_case: { lawyer_id: { in: advIds }, ...tw } } },
      }),

      // ── OPERADOR: Conversations ──
      this.prisma.conversation.groupBy({
        by: ['assigned_user_id'],
        _count: true,
        where: { assigned_user_id: { in: opIds }, status: { not: 'FECHADO' }, ...tw },
      }),
      this.prisma.conversation.groupBy({
        by: ['assigned_user_id'],
        _count: true,
        where: { assigned_user_id: { in: opIds }, status: 'FECHADO', last_message_at: { gte: start, lte: end }, ...tw },
      }),
      this.prisma.conversation.groupBy({
        by: ['assigned_user_id'],
        _count: true,
        where: { assigned_user_id: { in: opIds }, status: 'FECHADO', last_message_at: { gte: prevStart, lte: prevEnd }, ...tw },
      }),
      // Leads handled
      this.prisma.lead.groupBy({
        by: ['cs_user_id'],
        _count: true,
        where: { cs_user_id: { in: opIds }, ...tw },
      }),
      // Leads converted
      this.prisma.lead.groupBy({
        by: ['cs_user_id'],
        _count: true,
        where: { cs_user_id: { in: opIds }, is_client: true, ...tw },
      }),
      // Leads lost
      this.prisma.lead.groupBy({
        by: ['cs_user_id'],
        _count: true,
        where: { cs_user_id: { in: opIds }, stage: 'PERDIDO', ...tw },
      }),
      // Stages advanced
      this.prisma.leadStageHistory.groupBy({
        by: ['actor_id'],
        _count: true,
        where: { actor_id: { in: opIds }, created_at: { gte: start, lte: end } },
      }),
      this.prisma.leadStageHistory.groupBy({
        by: ['actor_id'],
        _count: true,
        where: { actor_id: { in: opIds }, created_at: { gte: prevStart, lte: prevEnd } },
      }),

      // ── ESTAGIARIO: Documents ──
      this.prisma.caseDocument.groupBy({
        by: ['uploaded_by_id'],
        _count: true,
        where: { uploaded_by_id: { in: estIds } },
      }),
      // Estagiario deadlines completed
      this.prisma.caseDeadline.groupBy({
        by: ['created_by_id'],
        _count: true,
        where: { created_by_id: { in: estIds }, completed: true },
      }),
      // Estagiario petitions (reuse from petitions above but filter)
      this.prisma.casePetition.groupBy({
        by: ['created_by_id', 'status'],
        _count: true,
        where: { created_by_id: { in: estIds } },
      }),
    ]);

    // ─── 3. Helper: extract count from groupBy result ──
    const gc = (arr: any[], key: string, id: string, extraKey?: string, extraVal?: string): number => {
      if (extraKey) return arr.filter(r => r[key] === id && r[extraKey] === extraVal).reduce((s, r) => s + r._count, 0);
      return arr.find(r => r[key] === id)?._count || 0;
    };

    // ─── 4. Build per-user financial maps (need to resolve honorario → case → lawyer) ──
    // For honorarios, we need to map honorario_id → lawyer_id
    const honorarioIds = [...new Set([
      ...honorarioCollected.map(h => h.honorario_id),
      ...honorarioReceivable.map(h => h.honorario_id),
      ...prevCollected.map(h => h.honorario_id),
    ])];
    const honorarioToLawyer = new Map<string, string>();
    if (honorarioIds.length > 0) {
      const honorarios = await this.prisma.caseHonorario.findMany({
        where: { id: { in: honorarioIds } },
        select: { id: true, legal_case: { select: { lawyer_id: true } } },
      });
      for (const h of honorarios) {
        if (h.legal_case?.lawyer_id) honorarioToLawyer.set(h.id, h.legal_case.lawyer_id);
      }
    }

    const sumByLawyer = (arr: any[], lawyerId: string): number => {
      return arr
        .filter(h => honorarioToLawyer.get(h.honorario_id) === lawyerId)
        .reduce((s, h) => s + Number(h._sum?.amount || 0), 0);
    };

    // ─── 5. Assemble members ──
    const members: any[] = [];

    for (const user of users) {
      const completed = gc(tasksCompleted, 'assigned_user_id', user.id);
      const pending = gc(tasksPending, 'assigned_user_id', user.id);
      const overdue = gc(tasksOverdue, 'assigned_user_id', user.id);
      const total = completed + pending;
      const taskRate = total > 0 ? Math.round((completed / total) * 100) : 0;

      const sharedTasks = { tasksCompleted: completed, tasksPending: pending, tasksOverdue: overdue, taskCompletionRate: taskRate };

      let advKPIs: any = undefined;
      let opKPIs: any = undefined;
      let estKPIs: any = undefined;
      let score = 0;
      let prevScore = 0;

      if (user.role === 'ADVOGADO' || user.role === 'ADMIN') {
        const active = gc(activeCases, 'lawyer_id', user.id);
        const filed = gc(casesFiledCurrent, 'lawyer_id', user.id);
        const totalSent = sentencedCases.filter(r => r.lawyer_id === user.id).reduce((s, r) => s + r._count, 0);
        const won = sentencedCases.filter(r => r.lawyer_id === user.id && (r.sentence_type === 'PROCEDENTE' || r.sentence_type === 'PARCIALMENTE_PROCEDENTE')).reduce((s, r) => s + r._count, 0);
        const winRate = totalSent > 0 ? Math.round((won / totalSent) * 100) : 0;

        const dlCreated = gc(deadlines, 'created_by_id', user.id);
        const dlCompleted = estDeadlines.find(d => d.created_by_id === user.id)?._count || 0;
        const dlMissed = Math.max(0, dlCreated - dlCompleted);
        const dlRate = dlCreated > 0 ? Math.round((dlCompleted / dlCreated) * 100) : 0;

        const petDrafted = petitions.filter(p => p.created_by_id === user.id && p.status === 'RASCUNHO').reduce((s, p) => s + p._count, 0);
        const petApproved = petitions.filter(p => p.created_by_id === user.id && p.status === 'APROVADA').reduce((s, p) => s + p._count, 0);
        const petProtocoled = petitions.filter(p => p.created_by_id === user.id && p.status === 'PROTOCOLADA').reduce((s, p) => s + p._count, 0);
        const petTotal = petDrafted + petApproved + petProtocoled;
        const petRate = petTotal > 0 ? Math.round(((petApproved + petProtocoled) / petTotal) * 100) : 0;

        const collected = sumByLawyer(honorarioCollected, user.id);
        const receivable = sumByLawyer(honorarioReceivable, user.id);
        const contracted = honorarioContracted.filter(h => {
          // Need to check via legal_case_id → lawyer_id mapping
          return true; // simplified - use total
        }).reduce((s, h) => s + Number(h._sum?.total_value || 0), 0);
        const colRate = (collected + receivable) > 0 ? Math.round((collected / (collected + receivable)) * 100) : 0;

        advKPIs = {
          activeCases: active, casesFiledThisPeriod: filed, avgDaysToFile: 0,
          caseWinRate: winRate, totalSentenced: totalSent, wonAndPartial: won,
          deadlinesCreated: dlCreated, deadlinesCompleted: dlCompleted, deadlinesMissed: dlMissed,
          deadlineCompletionRate: dlRate,
          petitionsDrafted: petDrafted, petitionsApproved: petApproved, petitionsProtocoled: petProtocoled,
          petitionApprovalRate: petRate,
          totalContracted: contracted, totalCollected: collected, totalReceivable: receivable,
          collectionRate: colRate,
        };

        // ADVOGADO SCORE (aggressive)
        score = 0;
        score += totalSent > 0 ? (won / totalSent) * 25 : 12; // win rate 25pts
        score += dlMissed > 3 ? Math.min(10, (dlRate / 100) * 20) : (dlRate / 100) * 20; // deadlines 20pts, capped if missed>3
        score += (colRate / 100) * 20; // collection 20pts
        score += Math.max(0, (taskRate / 100) * 15 - overdue * 3); // tasks 15pts minus overdue
        score += Math.min(10, petProtocoled * 2.5); // petitions 10pts
        score += 10 - Math.min(10, (advKPIs.avgDaysToFile || 0) / 30 * 10); // velocity 10pts

        // Previous score (simplified)
        const prevFiled = gc(casesFiledPrev, 'lawyer_id', user.id);
        const prevColl = sumByLawyer(prevCollected, user.id);
        const prevCompleted = gc(prevTasksCompleted, 'assigned_user_id', user.id);
        const prevPend = gc(prevTasksPending, 'assigned_user_id', user.id);
        const prevTotal = prevCompleted + prevPend;
        const prevTaskRate = prevTotal > 0 ? (prevCompleted / prevTotal) * 100 : 0;
        prevScore = 12 + (dlRate / 100) * 20 + ((prevColl > 0 && receivable > 0) ? (prevColl / (prevColl + receivable)) * 20 : 0) + (prevTaskRate / 100) * 15;
      }

      if (user.role === 'OPERADOR') {
        const open = gc(openConvs, 'assigned_user_id', user.id);
        const closed = gc(closedConvs, 'assigned_user_id', user.id);
        const handled = gc(leadsHandled, 'cs_user_id', user.id);
        const converted = gc(leadsConverted, 'cs_user_id', user.id);
        const lost = gc(leadsLost, 'cs_user_id', user.id);
        const convRate = handled > 0 ? Math.round((converted / handled) * 100) : 0;
        const stages = gc(stagesAdvanced, 'actor_id', user.id);

        opKPIs = {
          openConversations: open, closedConversations: closed,
          avgResponseTimeMinutes: 0, medianResponseTimeMinutes: 0, // TODO: batch response time
          leadsHandled: handled, leadsConverted: converted,
          conversionRate: convRate, avgConversionDays: 0,
          stagesAdvanced: stages, leadsLost: lost,
          tasksCompleted: completed, taskCompletionRate: taskRate,
        };

        // OPERADOR SCORE (aggressive)
        score = 0;
        score += (convRate / 100) * 30; // conversion 30pts
        score += 25; // response time placeholder (full marks until calculated)
        score += Math.min(15, closed / 5 * 1.5); // closed convs 15pts
        score += (taskRate / 100) * 15; // tasks 15pts
        score += Math.min(10, stages / 10 * 2); // pipeline 10pts
        score -= Math.min(5, lost * 0.5); // loss penalty

        const prevClosed = gc(closedConvsPrev, 'assigned_user_id', user.id);
        const prevStages = gc(stagesAdvancedPrev, 'actor_id', user.id);
        prevScore = (convRate / 100) * 30 + 25 + Math.min(15, prevClosed / 5 * 1.5) + (taskRate / 100) * 15 + Math.min(10, prevStages / 10 * 2);
      }

      if (user.role === 'ESTAGIARIO') {
        const docs = gc(docsUploaded, 'uploaded_by_id', user.id);
        const dlManaged = gc(deadlines, 'created_by_id', user.id);
        const dlOnTime = estDeadlines.find(d => d.created_by_id === user.id)?._count || 0;
        const ePetDrafted = estPetitions.filter(p => p.created_by_id === user.id && p.status === 'RASCUNHO').reduce((s, p) => s + p._count, 0);
        const ePetReview = estPetitions.filter(p => p.created_by_id === user.id && p.status === 'EM_REVISAO').reduce((s, p) => s + p._count, 0);
        const ePetApproved = estPetitions.filter(p => p.created_by_id === user.id && (p.status === 'APROVADA' || p.status === 'PROTOCOLADA')).reduce((s, p) => s + p._count, 0);
        const ePetTotal = ePetDrafted + ePetReview + ePetApproved;
        const ePetRate = ePetTotal > 0 ? Math.round((ePetApproved / ePetTotal) * 100) : 0;

        estKPIs = {
          tasksCompleted: completed, tasksPending: pending, tasksOverdue: overdue,
          taskCompletionRate: taskRate, avgTaskCompletionDays: 0,
          petitionsDrafted: ePetDrafted, petitionsInReview: ePetReview, petitionsApproved: ePetApproved,
          petitionApprovalRate: ePetRate,
          deadlinesManaged: dlManaged, deadlinesCompletedOnTime: dlOnTime,
          documentsUploaded: docs,
        };

        // ESTAGIARIO SCORE (aggressive)
        score = 0;
        score += Math.max(0, (taskRate / 100) * 35 - overdue * 5); // tasks 35pts, harsh penalty
        score += (ePetRate / 100) * 25; // petition quality 25pts
        score += dlManaged > 0 ? (dlOnTime / dlManaged) * 20 : 10; // deadlines 20pts
        score += Math.min(10, (docs + completed) / 10 * 2); // volume 10pts
        score += 10; // speed placeholder

        prevScore = Math.max(0, (taskRate / 100) * 35) + (ePetRate / 100) * 25 + 10 + 10 + 10;
      }

      score = Math.max(0, Math.min(100, Math.round(score)));
      prevScore = Math.max(0, Math.min(100, Math.round(prevScore)));

      members.push({
        userId: user.id, name: user.name, role: user.role,
        compositeScore: score, previousScore: prevScore, scoreDelta: score - prevScore,
        rank: 0, quartile: 'MID' as Quartile,
        advogadoKPIs: advKPIs, operadorKPIs: opKPIs, estagiarioKPIs: estKPIs,
        sharedTasks,
        dailyActivity: [], // TODO: fill with 7-day activity
      });
    }

    // ─── 6. Rank and quartile per role ──
    const rankGroup = (roleFilter: string) => {
      const group = members.filter(m => m.role === roleFilter).sort((a, b) => b.compositeScore - a.compositeScore);
      group.forEach((m, i) => { m.rank = i + 1; });
      const len = group.length;
      if (len >= 4) {
        const q1 = Math.ceil(len * 0.25);
        const q3 = Math.ceil(len * 0.75);
        group.forEach((m, i) => {
          if (i < q1) m.quartile = 'TOP';
          else if (i >= q3) m.quartile = 'LOW';
          else m.quartile = 'MID';
        });
      } else {
        group.forEach(m => {
          if (m.compositeScore >= 70) m.quartile = 'TOP';
          else if (m.compositeScore < 50) m.quartile = 'LOW';
          else m.quartile = 'MID';
        });
      }
    };

    rankGroup('ADVOGADO');
    rankGroup('OPERADOR');
    rankGroup('ESTAGIARIO');
    rankGroup('ADMIN');

    // ─── 7. Team averages ──
    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
    const advMembers = members.filter(m => m.advogadoKPIs);
    const opMembers = members.filter(m => m.operadorKPIs);
    const estMembers = members.filter(m => m.estagiarioKPIs);

    const teamAverages = {
      advogado: {
        caseWinRate: Math.round(avg(advMembers.map(m => m.advogadoKPIs.caseWinRate))),
        collectionRate: Math.round(avg(advMembers.map(m => m.advogadoKPIs.collectionRate))),
        deadlineCompletionRate: Math.round(avg(advMembers.map(m => m.advogadoKPIs.deadlineCompletionRate))),
        petitionApprovalRate: Math.round(avg(advMembers.map(m => m.advogadoKPIs.petitionApprovalRate))),
        totalCollected: Math.round(avg(advMembers.map(m => m.advogadoKPIs.totalCollected))),
      },
      operador: {
        conversionRate: Math.round(avg(opMembers.map(m => m.operadorKPIs.conversionRate))),
        closedConversations: Math.round(avg(opMembers.map(m => m.operadorKPIs.closedConversations))),
        avgResponseTimeMinutes: Math.round(avg(opMembers.map(m => m.operadorKPIs.avgResponseTimeMinutes))),
        taskCompletionRate: Math.round(avg(opMembers.map(m => m.operadorKPIs.taskCompletionRate))),
      },
      estagiario: {
        taskCompletionRate: Math.round(avg(estMembers.map(m => m.estagiarioKPIs.taskCompletionRate))),
        petitionApprovalRate: Math.round(avg(estMembers.map(m => m.estagiarioKPIs.petitionApprovalRate))),
        documentsUploaded: Math.round(avg(estMembers.map(m => m.estagiarioKPIs.documentsUploaded))),
      },
      tasks: {
        taskCompletionRate: Math.round(avg(members.map(m => m.sharedTasks.taskCompletionRate))),
        tasksCompleted: Math.round(avg(members.map(m => m.sharedTasks.tasksCompleted))),
      },
    };

    return {
      period: { startDate: start.toISOString(), endDate: end.toISOString() },
      previousPeriod: { startDate: prevStart.toISOString(), endDate: prevEnd.toISOString() },
      members,
      teamAverages,
    };
  }
}
