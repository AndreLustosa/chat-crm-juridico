import type { ToolHandler, ToolContext } from '../tool-executor';
import { requireTenant } from './tool-guards.util';

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

    // Bug fix 2026-05-11 (Skills PR1 #C7): tenant guard.
    // Lead.findUnique sem tenant_id pode vazar dados pessoais (CPF, processos,
    // calendar_events com nome de outro cliente) se contexto comprometido.
    let tenantId: string;
    try {
      tenantId = requireTenant(context);
    } catch (e: any) {
      return { success: false, message: e.message };
    }

    // findFirst com tenant_id em vez de findUnique pra escopar.
    const lead = await prisma.lead.findFirst({
      where: { id: context.leadId, tenant_id: tenantId },
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

    // Separa tags de CATEGORIA (curtas, ex: "Trabalhista", "VIP") de tags
    // que parecem INSTRUCAO INTERNA pro time (longas, com verbos de acao
    // como "ligar", "enviar", "agendar"). Tags-instrucao NAO sao expostas
    // como tag pro modelo — viram nota interna marcada explicitamente
    // como "nao executavel pela IA". Isso previne IA prometer "vou te
    // ligar" porque viu tag "Realizar ligacao com cliente" (bug 2026-05-08).
    const rawTags = Array.isArray(lead.tags) ? (lead.tags as string[]) : [];
    const INSTRUCTION_VERBS = /\b(ligar|liga[çc][aã]o|telefonar|enviar|email|whatsapp|agendar|marcar|cobrar|protocolar|peticionar|atualizar|verificar|conferir|confirmar|fazer|realizar|tratar|resolver)\b/i;
    const categoryTags: string[] = [];
    const internalInstructions: string[] = [];
    for (const tag of rawTags) {
      // Tag longa OU com verbo de acao = instrucao interna do time
      if (tag.length > 25 || INSTRUCTION_VERBS.test(tag)) {
        internalInstructions.push(tag);
      } else {
        categoryTags.push(tag);
      }
    }

    return {
      success: true,
      lead: {
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        is_client: lead.is_client,
        stage: lead.stage,
        tags: categoryTags, // Apenas categorias (Trabalhista, Familia, VIP, etc.)
        // Instrucoes internas marcadas explicitamente — IA pode usar como
        // CONTEXTO ("entendi que precisa ligar pro cliente") mas NAO pode
        // executar nem prometer executar. CORE_RULES proibe.
        internal_team_instructions: internalInstructions.length > 0
          ? {
              note: 'Estas sao tarefas do TIME interno (advogado/atendente), NAO suas. NAO prometa executar. NAO cite ao cliente.',
              items: internalInstructions,
            }
          : undefined,
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
