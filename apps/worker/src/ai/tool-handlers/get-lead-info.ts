import type { ToolHandler, ToolContext } from '../tool-executor';

/**
 * get_lead_info — retorna dados cadastrais e situacao atual do lead.
 *
 * Use quando precisar saber:
 *  - Nome, telefone, email, CPF (se cadastrado)
 *  - Processos ativos do cliente (numero, area, vara, advogado)
 *  - Fase no funil de atendimento (stage)
 *  - Tags e notas internas
 *  - Ultimos eventos do calendario (audiencias, pericias, prazos)
 *
 * Use antes de:
 *  - Saudar o cliente pelo nome (se nao souber)
 *  - Responder duvidas sobre o caso
 *  - Agendar algo (pra nao dupliciar eventos existentes)
 *
 * Input tokens sao baratos, entao a resposta pode ser completa sem problema.
 */
export class GetLeadInfoHandler implements ToolHandler {
  name = 'get_lead_info';

  async execute(
    _params: Record<string, never>,
    context: ToolContext,
  ): Promise<any> {
    const prisma = context.prisma;
    if (!prisma || !context.leadId) {
      return { success: false, message: 'Contexto invalido' };
    }

    const lead = await prisma.lead.findUnique({
      where: { id: context.leadId },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        is_client: true,
        stage: true,
        tags: true,
        origin: true,
        notes: true,
        created_at: true,
        legal_cases: {
          where: { archived: false },
          select: {
            case_number: true,
            legal_area: true,
            tracking_stage: true,
            stage: true,
            court: true,
            opposing_party: true,
            judge: true,
            action_type: true,
            claim_value: true,
            filed_at: true,
            lawyer: { select: { name: true } },
          },
          orderBy: { created_at: 'desc' },
        },
        calendar_events: {
          where: { status: { not: 'CANCELADO' } },
          select: {
            type: true,
            title: true,
            start_at: true,
            location: true,
            status: true,
          },
          orderBy: { start_at: 'desc' },
          take: 10,
        },
      },
    });

    if (!lead) {
      return { success: false, message: 'Lead nao encontrado' };
    }

    return {
      success: true,
      lead: {
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        is_client: lead.is_client,
        stage: lead.stage,
        tags: lead.tags,
        origin: lead.origin,
        notes: lead.notes,
        registered_since: lead.created_at,
      },
      cases: lead.legal_cases.map((c: any) => ({
        case_number: c.case_number,
        legal_area: c.legal_area,
        tracking_stage: c.tracking_stage,
        stage: c.stage,
        court: c.court,
        opposing_party: c.opposing_party,
        judge: c.judge,
        action_type: c.action_type,
        claim_value: c.claim_value,
        filed_at: c.filed_at,
        lawyer: c.lawyer?.name,
      })),
      upcoming_and_recent_events: lead.calendar_events.map((e: any) => ({
        type: e.type,
        title: e.title,
        date: e.start_at,
        location: e.location,
        status: e.status,
      })),
    };
  }
}
