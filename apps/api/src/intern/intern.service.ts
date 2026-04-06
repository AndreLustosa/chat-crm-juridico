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

    // 2. Tarefas pendentes (CalendarEvents tipo TAREFA/PRAZO atribuídos ao estagiário)
    const pending = await this.prisma.calendarEvent.findMany({
      where: {
        assigned_user_id: userId,
        type: { in: ['TAREFA', 'PRAZO'] },
        status: { in: ['AGENDADO', 'CONFIRMADO'] },
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
    });

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

    // 5. Concluídas hoje
    const completedToday = await this.prisma.calendarEvent.findMany({
      where: {
        assigned_user_id: userId,
        type: { in: ['TAREFA', 'PRAZO'] },
        status: 'CONCLUIDO',
        start_at: { gte: today, lt: tomorrow },
        ...(tenantId ? { tenant_id: tenantId } : {}),
      },
      include: {
        lead: { select: { id: true, name: true } },
        legal_case: {
          select: { id: true, case_number: true, legal_area: true },
        },
      },
      orderBy: { start_at: 'desc' },
      take: 20,
    });

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
}
