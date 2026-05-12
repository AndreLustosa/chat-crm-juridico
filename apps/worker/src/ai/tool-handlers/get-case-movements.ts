import { Logger } from '@nestjs/common';
import type { ToolHandler, ToolContext } from '../tool-executor';
import { requireTenant } from './tool-guards.util';

/**
 * get_case_movements — busca TODAS as movimentacoes judiciais de um processo
 * do lead atual. Use quando o cliente perguntar sobre andamento, status,
 * decisoes, audiencias, ou qualquer detalhe processual.
 *
 * Retorna as movimentacoes ordenadas por data (mais recente primeiro) com
 * titulo, descricao completa, fonte (ESAJ/DJEN/MANUAL) e data do evento.
 *
 * Se o lead tem multiplos processos, traz de todos. Se informar case_number,
 * filtra apenas aquele processo (comparacao e feita por digitos normalizados,
 * independente de formatacao — "0706801-69.2026.8.02.0058", "07068016920268020058"
 * e "0706801" todos batem).
 *
 * Input tokens sao baratos ($2/1M no GPT-4.1), entao a tool pode retornar
 * muitas movimentacoes (ate ~500) sem problema. O LLM filtra o relevante
 * na hora de responder ao cliente.
 */
export class GetCaseMovementsHandler implements ToolHandler {
  name = 'get_case_movements';
  private readonly logger = new Logger(GetCaseMovementsHandler.name);

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

    // Bug fix 2026-05-11 (Skills PR1 #C7): tenant guard. PII de processo
    // (case_number, opposing_party, descricao) e altamente sensivel.
    let tenantId: string;
    try {
      tenantId = requireTenant(context);
    } catch (e: any) {
      return { success: false, message: e.message };
    }

    const limit = Math.min(params.limit ?? 200, 500);

    // Buscar TODOS os processos ativos do lead primeiro (normalmente <5)
    const allCases = await prisma.legalCase.findMany({
      where: { lead_id: leadId, tenant_id: tenantId, archived: false },
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

    // Filtro por case_number (se informado) — normaliza ambos os lados
    // removendo separadores (-.spaces) e compara por prefix dos digitos.
    // Isso e robusto contra variacoes de formatacao que o LLM possa passar.
    let legalCases = allCases;
    if (params.case_number) {
      const paramDigits = params.case_number.replace(/\D/g, '');
      legalCases = allCases.filter((c: any) => {
        const caseDigits = (c.case_number || '').replace(/\D/g, '');
        // Match exato (20 digitos) ou prefix (user passou so parte do numero)
        return caseDigits === paramDigits ||
               (paramDigits.length > 0 && caseDigits.startsWith(paramDigits));
      });

      // Se o filtro nao achou nada mas o lead tem processos, retorna TODOS
      // e avisa no message — melhor dar contexto ao LLM do que retornar vazio
      // quando a pessoa so errou na formatacao do numero.
      if (legalCases.length === 0 && allCases.length > 0) {
        this.logger.warn(
          `[get_case_movements] case_number="${params.case_number}" (digits=${paramDigits}) nao bateu com nenhum processo do lead ${leadId}. Retornando TODOS (${allCases.length}) pra nao perder contexto.`,
        );
        legalCases = allCases;
      }
    }

    if (legalCases.length === 0) {
      return {
        success: true,
        cases: [],
        movements: [],
        message: 'Lead nao tem processos cadastrados em acompanhamento.',
      };
    }

    const caseIds = legalCases.map((c: any) => c.id);

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

    this.logger.log(
      `[get_case_movements] lead=${leadId} cases=${legalCases.length} movs=${events.length} (case_number filter=${params.case_number || 'none'})`,
    );

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
