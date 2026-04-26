import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Servico de processos pra portal do cliente. Sempre filtra por
 * `lead_id = currentClient.id` — cliente NUNCA ve processo de outro.
 *
 * Reusa dados da IA do DJEN (`client_analysis.resumo_cliente`, etc) pra
 * exibir movimentacoes em linguagem leiga sem chamar IA novamente. Se nao
 * tem analise (publicacao antiga ou movimento ESAJ), usa fallback.
 */
@Injectable()
export class PortalProcessesService {
  private readonly logger = new Logger(PortalProcessesService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Lista processos do cliente — visao "kanban" simplificada com proximo
   * evento e ultima movimentacao em destaque.
   */
  async listProcesses(leadId: string) {
    const cases = await this.prisma.legalCase.findMany({
      where: {
        lead_id: leadId,
        archived: false,
        renounced: false,
      },
      select: {
        id: true,
        case_number: true,
        action_type: true,
        legal_area: true,
        tracking_stage: true,
        stage_changed_at: true,
        opposing_party: true,
        client_is_author: true,
        in_tracking: true,
        priority: true,
        court: true,
      },
      orderBy: { stage_changed_at: 'desc' },
    });

    if (cases.length === 0) return [];

    // Bulk fetch: proximos eventos + ultimas movimentacoes (uma query por
    // lista, em vez de N+1 por processo).
    const caseIds = cases.map(c => c.id);
    const nowUtc = new Date();

    const [nextEvents, lastMovements, lastDjen] = await Promise.all([
      this.prisma.calendarEvent.findMany({
        where: {
          legal_case_id: { in: caseIds },
          status: { notIn: ['CANCELADO', 'CONCLUIDO'] },
          start_at: { gte: nowUtc },
          type: { in: ['AUDIENCIA', 'PERICIA', 'PRAZO'] },
        },
        select: { id: true, type: true, title: true, start_at: true, legal_case_id: true },
        orderBy: { start_at: 'asc' },
      }),
      this.prisma.caseEvent.findMany({
        where: {
          case_id: { in: caseIds },
          type: 'MOVIMENTACAO',
        },
        select: {
          id: true, case_id: true, title: true, description: true,
          event_date: true, created_at: true,
        },
        orderBy: { event_date: 'desc' },
      }),
      this.prisma.djenPublication.findMany({
        where: {
          legal_case_id: { in: caseIds },
          archived: false,
        },
        select: {
          id: true, legal_case_id: true, tipo_comunicacao: true, assunto: true,
          data_disponibilizacao: true, client_analysis: true,
        },
        orderBy: { data_disponibilizacao: 'desc' },
      }),
    ]);

    // Indexa pra lookup O(1) — pega APENAS o primeiro de cada (mais recente).
    const nextEventBy = new Map<string, typeof nextEvents[0]>();
    for (const e of nextEvents) {
      if (e.legal_case_id && !nextEventBy.has(e.legal_case_id)) nextEventBy.set(e.legal_case_id, e);
    }
    const lastMovBy = new Map<string, typeof lastMovements[0]>();
    for (const m of lastMovements) {
      if (!lastMovBy.has(m.case_id)) lastMovBy.set(m.case_id, m);
    }
    const lastDjenBy = new Map<string, typeof lastDjen[0]>();
    for (const d of lastDjen) {
      if (d.legal_case_id && !lastDjenBy.has(d.legal_case_id)) lastDjenBy.set(d.legal_case_id, d);
    }

    return cases.map(c => {
      const nextEv = nextEventBy.get(c.id);
      const lastMov = lastMovBy.get(c.id);
      const lastDj = lastDjenBy.get(c.id);

      // Pega a movimentacao MAIS RECENTE entre ESAJ (lastMov) e DJEN (lastDj)
      const lastMovDate = lastMov?.event_date || lastMov?.created_at || null;
      const lastDjDate = lastDj?.data_disponibilizacao || null;
      let lastUpdate: { date: Date; summary: string } | null = null;
      if (lastDjDate && (!lastMovDate || lastDjDate > lastMovDate)) {
        const ca = (lastDj!.client_analysis as any) || {};
        lastUpdate = {
          date: lastDjDate,
          summary: ca.resumo_cliente || lastDj!.assunto || lastDj!.tipo_comunicacao || 'Nova publicação',
        };
      } else if (lastMov) {
        lastUpdate = {
          date: lastMov.event_date || lastMov.created_at,
          summary: (lastMov.title || lastMov.description || '').slice(0, 200),
        };
      }

      return {
        id: c.id,
        case_number: c.case_number,
        action_type: c.action_type,
        legal_area: c.legal_area,
        tracking_stage: c.tracking_stage,
        opposing_party: c.opposing_party,
        client_is_author: c.client_is_author,
        priority: c.priority,
        court: c.court,
        next_event: nextEv ? {
          id: nextEv.id,
          type: nextEv.type,
          title: nextEv.title,
          start_at: nextEv.start_at.toISOString(),
        } : null,
        last_update: lastUpdate ? {
          date: lastUpdate.date.toISOString(),
          summary: lastUpdate.summary,
        } : null,
      };
    });
  }

  /**
   * Detalhe de UM processo — verifica que pertence ao cliente.
   */
  async getProcessDetail(leadId: string, caseId: string) {
    const lc = await this.prisma.legalCase.findFirst({
      where: { id: caseId, lead_id: leadId },
      select: {
        id: true, case_number: true, action_type: true, legal_area: true,
        tracking_stage: true, stage_changed_at: true, opposing_party: true,
        client_is_author: true, court: true, judge: true, claim_value: true,
        priority: true, in_tracking: true, archived: true, renounced: true,
        filed_at: true, created_at: true, notes: true,
        sentence_date: true, sentence_type: true, sentence_value: true,
      },
    });
    if (!lc || lc.archived || lc.renounced) {
      throw new NotFoundException('Processo nao encontrado');
    }

    // Counts pra UI mostrar badges
    const [movCount, docCount, eventCount] = await Promise.all([
      this.prisma.caseEvent.count({
        where: { case_id: caseId, type: 'MOVIMENTACAO' },
      }),
      this.prisma.caseDocument.count({ where: { legal_case_id: caseId } }),
      this.prisma.calendarEvent.count({
        where: {
          legal_case_id: caseId,
          status: { notIn: ['CANCELADO', 'CONCLUIDO'] },
          start_at: { gte: new Date() },
        },
      }),
    ]);

    return {
      ...lc,
      claim_value: lc.claim_value?.toString() || null,
      sentence_value: lc.sentence_value?.toString() || null,
      counts: {
        movements: movCount,
        documents: docCount,
        upcoming_events: eventCount,
      },
    };
  }

  /**
   * Timeline de movimentacoes unificada (DJEN + ESAJ + eventos do calendar).
   * Paginada por cursor (created_at desc).
   */
  async listMovements(leadId: string, caseId: string, limit = 30, beforeIso?: string) {
    // Verifica ownership primeiro
    const lc = await this.prisma.legalCase.findFirst({
      where: { id: caseId, lead_id: leadId },
      select: { id: true },
    });
    if (!lc) throw new NotFoundException('Processo nao encontrado');

    const before = beforeIso ? new Date(beforeIso) : null;
    const oversampled = limit + 5; // pega um pouco mais pra pagination resilience

    const [esajMovements, djenPubs] = await Promise.all([
      this.prisma.caseEvent.findMany({
        where: {
          case_id: caseId,
          type: 'MOVIMENTACAO',
          ...(before ? { event_date: { lt: before } } : {}),
        },
        select: {
          id: true, title: true, description: true,
          event_date: true, created_at: true, source: true,
        },
        orderBy: [{ event_date: 'desc' }, { created_at: 'desc' }],
        take: oversampled,
      }),
      this.prisma.djenPublication.findMany({
        where: {
          legal_case_id: caseId,
          archived: false,
          ...(before ? { data_disponibilizacao: { lt: before } } : {}),
        },
        select: {
          id: true, tipo_comunicacao: true, assunto: true, conteudo: true,
          data_disponibilizacao: true, client_analysis: true,
        },
        orderBy: { data_disponibilizacao: 'desc' },
        take: oversampled,
      }),
    ]);

    // Unifica em um array unico tipado
    type TimelineItem = {
      kind: 'esaj' | 'djen';
      id: string;
      date: string; // ISO
      title: string;
      summary_lay: string;     // texto leigo (IA ou fallback)
      detail_technical: string; // texto cru / juridico
      // Campos opcionais especificos do DJEN
      next_step_lay?: string | null;
      stage_lay?: string | null;
      deadline_lay?: string | null;
      orientation_lay?: string | null;
    };

    const items: TimelineItem[] = [];

    for (const m of esajMovements) {
      items.push({
        kind: 'esaj',
        id: m.id,
        date: (m.event_date || m.created_at).toISOString(),
        title: (m.title || 'Movimentação processual').slice(0, 200),
        summary_lay: (m.description || m.title || '').slice(0, 500),
        detail_technical: m.description || m.title || '',
      });
    }

    for (const p of djenPubs) {
      const ca: any = p.client_analysis || {};
      items.push({
        kind: 'djen',
        id: p.id,
        date: p.data_disponibilizacao.toISOString(),
        title: p.assunto || p.tipo_comunicacao || 'Publicação',
        summary_lay: ca.resumo_cliente || (p.conteudo || '').slice(0, 500),
        detail_technical: p.conteudo || '',
        next_step_lay: ca.proximo_passo_cliente || null,
        stage_lay: ca.fase_processo_cliente || null,
        deadline_lay: ca.prazo_cliente || null,
        orientation_lay: ca.orientacao_cliente || null,
      });
    }

    // Ordem cronologica desc
    items.sort((a, b) => b.date.localeCompare(a.date));

    const paginated = items.slice(0, limit);
    const next_cursor = paginated.length === limit ? paginated[paginated.length - 1].date : null;

    return {
      items: paginated,
      next_cursor,
      total: items.length, // nao eh total absoluto, mas total no buffer atual — UI usa pra "carregar mais"
    };
  }

  /**
   * Eventos futuros (audiencia, pericia, prazo) do processo.
   */
  async listEvents(leadId: string, caseId: string) {
    const lc = await this.prisma.legalCase.findFirst({
      where: { id: caseId, lead_id: leadId },
      select: { id: true },
    });
    if (!lc) throw new NotFoundException('Processo nao encontrado');

    const events = await this.prisma.calendarEvent.findMany({
      where: {
        legal_case_id: caseId,
        status: { notIn: ['CANCELADO', 'CONCLUIDO'] },
        start_at: { gte: new Date() },
        type: { in: ['AUDIENCIA', 'PERICIA', 'PRAZO', 'TAREFA'] },
      },
      select: {
        id: true, type: true, title: true, description: true,
        start_at: true, end_at: true, location: true, priority: true,
      },
      orderBy: { start_at: 'asc' },
      take: 50,
    });

    return events.map(e => ({
      ...e,
      start_at: e.start_at.toISOString(),
      end_at: e.end_at?.toISOString() || null,
    }));
  }
}
