import type { ToolHandler, ToolContext } from '../tool-executor';

/**
 * get_case_movements — busca TODAS as movimentacoes judiciais de um processo
 * do lead atual. Use quando o cliente perguntar sobre andamento, status,
 * decisoes, audiencias, ou qualquer detalhe processual.
 *
 * Retorna as movimentacoes ordenadas por data (mais recente primeiro) com
 * titulo, descricao completa, fonte (ESAJ/DJEN/MANUAL) e data do evento.
 *
 * Se o lead tem multiplos processos, traz de todos. Se informar case_number,
 * filtra apenas aquele processo.
 *
 * Input tokens sao baratos ($2/1M no GPT-4.1), entao a tool pode retornar
 * muitas movimentacoes (ate ~200) sem problema. O LLM filtra o relevante
 * na hora de responder ao cliente.
 */
export class GetCaseMovementsHandler implements ToolHandler {
  name = 'get_case_movements';

  async execute(
    params: { case_number?: string; limit?: number },
    context: ToolContext,
  ): Promise<any> {
    const prisma = context.prisma;
    if (!prisma) {
      return { success: false, message: 'Prisma indisponivel' };
    }

    const leadId = context.leadId;
    if (!leadId) {
      return { success: false, message: 'Lead nao identificado no contexto' };
    }

    // Limite padrao 200 (cobre casos extremos). User pediu "todas" — input
    // tokens sao baratos, deixar generoso.
    const limit = Math.min(params.limit ?? 200, 500);

    // Buscar processos do lead
    const legalCases = await prisma.legalCase.findMany({
      where: {
        lead_id: leadId,
        archived: false,
        ...(params.case_number
          ? { case_number: { contains: params.case_number.replace(/\D/g, '').slice(0, 13) } }
          : {}),
      },
      select: {
        id: true,
        case_number: true,
        legal_area: true,
        tracking_stage: true,
        court: true,
        opposing_party: true,
        lawyer: { select: { name: true } },
      },
    });

    if (legalCases.length === 0) {
      return {
        success: true,
        cases: [],
        movements: [],
        message: params.case_number
          ? `Nenhum processo encontrado com numero ${params.case_number}.`
          : 'Lead nao tem processos cadastrados em acompanhamento.',
      };
    }

    const caseIds = legalCases.map((c: any) => c.id);

    // Buscar CaseEvents (movimentacoes + eventos) dos processos
    const events = await prisma.caseEvent.findMany({
      where: {
        case_id: { in: caseIds },
        type: 'MOVIMENTACAO',
      },
      orderBy: [{ event_date: 'desc' }, { created_at: 'desc' }],
      take: limit,
      select: {
        event_date: true,
        title: true,
        description: true,
        source: true,
        case_id: true,
      },
    });

    // Mapa case_id -> case_number para referenciar no retorno
    const caseNumberById = new Map(legalCases.map((c: any) => [c.id, c.case_number]));

    return {
      success: true,
      cases: legalCases.map((c: any) => ({
        case_number: c.case_number,
        legal_area: c.legal_area,
        tracking_stage: c.tracking_stage,
        court: c.court,
        opposing_party: c.opposing_party,
        lawyer: c.lawyer?.name,
      })),
      movements_count: events.length,
      movements: events.map((e: any) => ({
        case_number: caseNumberById.get(e.case_id),
        date: e.event_date,
        title: e.title,
        description: e.description,
        source: e.source,
      })),
    };
  }
}
