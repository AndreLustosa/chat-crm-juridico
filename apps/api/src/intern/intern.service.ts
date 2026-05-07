import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class InternService {
  private readonly logger = new Logger(InternService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Dashboard do estagiário: agrega tarefas, petições e stats.
   * Mostra apenas itens vinculados aos advogados supervisores do estagiário.
   */
  async getDashboard(userId: string, tenantId?: string) {
    // 1. Buscar supervisores (advogados vinculados)
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        supervisors: { select: { id: true, name: true } },
      },
    });
    const supervisorIds = (user?.supervisors || []).map((s: any) => s.id);
    const supervisorNames = (user?.supervisors || []).map((s: any) => s.name);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // 2. Tarefas pendentes — UNIAO de:
    //    a) CalendarEvents tipo TAREFA/PRAZO atribuídos ao estagiário (prazos
    //       processuais e tarefas vinculadas a fase de processo, criadas via
    //       fluxo principal)
    //    b) Tasks orphas (sem calendar_event_id) atribuidas ao estagiario —
    //       criadas via "Nova diligencia" pelo advogado quando ele so quer
    //       delegar uma acao rapida sem precisar de evento processual formal
    //       (ex: "ligar pro cliente e pedir comprovante de residencia").
    //
    //    Ambos shapes sao normalizados pra { kind, id, title, ... } e o
    //    frontend renderiza o mesmo componente; a diferenca eh que TASK usa
    //    EventActionButton com type='TASK' e CALENDAR com type='CALENDAR'.
    // Bug fix 2026-04-27: antes a query (a) puxava TODOS os CalendarEvents
    // type=TAREFA/PRAZO, e a query (b) puxava so Tasks ORFAS (calendar_event_id
    // null). Resultado: Task com due_at virava CalendarEvent (via syncTask
    // ToCalendar) e aparecia no dashboard como kind='event' — perdendo o
    // badge "DILIGÊNCIA" e o modal de conclusao com drop zone.
    //
    // Agora:
    //   - Query (a) puxa CalendarEvents que NAO tem Task linkada (eventos
    //     processuais "puros": prazos manuais, audiencias, pericias)
    //   - Query (b) puxa TODAS as Tasks do estagiario (orfas + sincronizadas
    //     com calendar) — virando kind='task' uniformemente, com badge e
    //     fluxo correto de conclusao (anexos)
    const [pendingEvents, pendingTasks] = await Promise.all([
      this.prisma.calendarEvent.findMany({
        where: {
          assigned_user_id: userId,
          type: { in: ['TAREFA', 'PRAZO'] },
          status: { in: ['AGENDADO', 'CONFIRMADO'] },
          // Exclui CalendarEvents que sao espelho de Task — essas vao
          // aparecer via query (b) com kind='task' pra ter badge correto
          task: null,
          ...(tenantId ? { tenant_id: tenantId } : {}),
        },
        include: {
          lead: { select: { id: true, name: true, phone: true } },
          legal_case: {
            select: {
              id: true, case_number: true, legal_area: true, stage: true,
              tracking_stage: true, opposing_party: true,
              lead: { select: { id: true, name: true, phone: true } },
              lawyer: { select: { id: true, name: true } },
            },
          },
          assigned_user: { select: { id: true, name: true } },
          created_by: { select: { id: true, name: true } },
        },
        orderBy: [{ start_at: 'asc' }],
        take: 50,
      }),
      this.prisma.task.findMany({
        where: {
          assigned_user_id: userId,
          status: { in: ['A_FAZER', 'EM_PROGRESSO'] },
          ...(tenantId ? { tenant_id: tenantId } : {}),
        },
        include: {
          lead: { select: { id: true, name: true, phone: true } },
          legal_case: {
            select: {
              id: true, case_number: true, legal_area: true, stage: true,
              tracking_stage: true, opposing_party: true,
              lead: { select: { id: true, name: true, phone: true } },
              lawyer: { select: { id: true, name: true } },
            },
          },
          assigned_user: { select: { id: true, name: true } },
        },
        orderBy: [{ due_at: 'asc' }, { created_at: 'desc' }],
        take: 50,
      }),
    ]);

    // Normaliza shape — frontend usa `kind` pra decidir endpoint de complete
    // e fallback de campos opcionais (Task nao tem start_at, usa due_at;
    // CalendarEvent nao tem due_at, usa start_at).
    const pending = [
      ...pendingEvents.map((e: any) => ({ ...e, kind: 'event' as const })),
      ...pendingTasks.map((t: any) => ({
        ...t,
        kind: 'task' as const,
        // Compatibilidade: frontend usa `start_at` e `type` em alguns lugares
        start_at: t.due_at || t.created_at,
        type: 'TAREFA',
        // CalendarEvent tem priority — Task nao. Default normal.
        priority: 'NORMAL',
        // Quem criou a Task: created_by_id -> usa relacao opcional.
        // Por simplicidade nao incluimos created_by aqui (UI ja trata null).
        created_by: null,
      })),
    ].sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());

    // 3. Petições em revisão (criadas pelo estagiário, status EM_REVISAO)
    const inReview = await (this.prisma as any).casePetition.findMany({
      where: {
        created_by_id: userId,
        status: 'EM_REVISAO',
      },
      include: {
        legal_case: {
          select: {
            id: true, case_number: true, legal_area: true,
            lead: { select: { id: true, name: true } },
            lawyer: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { updated_at: 'desc' },
      take: 20,
    });

    // 4. Petições com correções solicitadas (RASCUNHO com versões > 1 = já foi revisada)
    const corrections = await (this.prisma as any).casePetition.findMany({
      where: {
        created_by_id: userId,
        status: 'RASCUNHO',
        versions: { some: {} }, // tem pelo menos 1 versão = já foi editada
      },
      include: {
        legal_case: {
          select: {
            id: true, case_number: true, legal_area: true,
            lead: { select: { id: true, name: true } },
            lawyer: { select: { id: true, name: true } },
          },
        },
        versions: {
          orderBy: { version: 'desc' as any },
          take: 1,
          select: { version: true, created_at: true },
        },
      },
      orderBy: { updated_at: 'desc' },
      take: 20,
    });

    // 5. Concluídas hoje — mesma uniao (CalendarEvent + Task orfa)
    const [completedEvents, completedTasks] = await Promise.all([
      this.prisma.calendarEvent.findMany({
        where: {
          assigned_user_id: userId,
          type: { in: ['TAREFA', 'PRAZO'] },
          status: 'CONCLUIDO',
          completed_at: { gte: today, lt: tomorrow },
          // Same dedup: exclui CalendarEvents que sao espelho de Task
          task: null,
          ...(tenantId ? { tenant_id: tenantId } : {}),
        },
        include: {
          lead: { select: { id: true, name: true } },
          legal_case: {
            select: { id: true, case_number: true, legal_area: true },
          },
        },
        orderBy: { completed_at: 'desc' },
        take: 20,
      }),
      this.prisma.task.findMany({
        where: {
          assigned_user_id: userId,
          status: 'CONCLUIDA',
          completed_at: { gte: today, lt: tomorrow },
          ...(tenantId ? { tenant_id: tenantId } : {}),
        },
        include: {
          lead: { select: { id: true, name: true } },
          legal_case: {
            select: { id: true, case_number: true, legal_area: true },
          },
        },
        orderBy: { completed_at: 'desc' },
        take: 20,
      }),
    ]);
    const completedToday = [
      ...completedEvents.map((e: any) => ({ ...e, kind: 'event' as const })),
      ...completedTasks.map((t: any) => ({
        ...t,
        kind: 'task' as const,
        start_at: t.completed_at || t.due_at || t.created_at,
        type: 'TAREFA',
        priority: 'NORMAL',
      })),
    ].sort((a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime());

    // 6. Stats
    const [totalPetitions, approvedPetitions] = await Promise.all([
      (this.prisma as any).casePetition.count({ where: { created_by_id: userId } }),
      (this.prisma as any).casePetition.count({
        where: { created_by_id: userId, status: { in: ['APROVADA', 'PROTOCOLADA'] } },
      }),
    ]);

    return {
      internName: user?.name || '',
      supervisors: user?.supervisors || [],
      pending,
      inReview,
      corrections: corrections.filter((p: any) => (p.versions?.length || 0) > 0),
      completedToday,
      stats: {
        pendingCount: pending.length,
        inReviewCount: inReview.length,
        correctionsCount: corrections.filter((p: any) => (p.versions?.length || 0) > 0).length,
        completedTodayCount: completedToday.length,
        approvalRate: totalPetitions > 0 ? Math.round((approvedPetitions / totalPetitions) * 100) : 0,
      },
    };
  }

  /**
   * Kanban board de petições do estagiário: agrupa por status.
   */
  async getKanbanDashboard(userId: string, tenantId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        supervisors: { select: { id: true, name: true } },
      },
    });

    const petitions = await (this.prisma as any).casePetition.findMany({
      where: {
        created_by_id: userId,
        ...(tenantId ? { tenant_id: tenantId } : {}),
      },
      include: {
        legal_case: {
          select: {
            id: true,
            case_number: true,
            legal_area: true,
            stage: true,
            lead: { select: { id: true, name: true, phone: true } },
            lawyer: { select: { id: true, name: true } },
          },
        },
        reviewed_by: { select: { id: true, name: true } },
        _count: { select: { versions: true } },
      },
      orderBy: [{ deadline_at: 'asc' }, { updated_at: 'desc' }],
    });

    const columns: Record<string, any[]> = {
      RASCUNHO: [],
      EM_REVISAO: [],
      APROVADA: [],
      PROTOCOLADA: [],
    };

    for (const p of petitions) {
      const col = columns[p.status];
      if (col) col.push(p);
    }

    // Stats
    const total = petitions.length;
    const approved = petitions.filter((p: any) => ['APROVADA', 'PROTOCOLADA'].includes(p.status)).length;
    const correctionsCount = columns.RASCUNHO.filter((p: any) => (p._count?.versions || 0) > 0).length;

    return {
      internName: user?.name || '',
      supervisors: user?.supervisors || [],
      columns,
      stats: {
        total,
        rascunho: columns.RASCUNHO.length,
        emRevisao: columns.EM_REVISAO.length,
        aprovada: columns.APROVADA.length,
        protocolada: columns.PROTOCOLADA.length,
        correctionsCount,
        approvalRate: total > 0 ? Math.round((approved / total) * 100) : 0,
      },
    };
  }

  /**
   * Contagem leve para badge na sidebar:
   * petições devolvidas para correção (RASCUNHO com versions > 0)
   */
  async getBadgeCount(userId: string) {
    // Guard defensivo: model casePetition pode nao existir no Prisma client
    // gerado (schema atualiza antes do client). Sem isso, o endpoint quebra
    // a sidebar inteira do estagiario.
    if (!(this.prisma as any).casePetition) {
      return { corrections: 0 };
    }
    const corrections = await (this.prisma as any).casePetition.count({
      where: {
        created_by_id: userId,
        status: 'RASCUNHO',
        versions: { some: {} },
      },
    });

    return { corrections };
  }
}
