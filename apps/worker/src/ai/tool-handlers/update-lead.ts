import type { ToolHandler, ToolContext } from '../tool-executor';
import { requireTenant } from './tool-guards.util';

/**
 * Atualiza dados do lead (nome, stage, área jurídica, etc.).
 * Campos permitidos: name, stage, legal_area, notes, lead_summary, next_step.
 *
 * Bug fix 2026-05-11 (Skills PR1 #C10):
 *   - tenant guard nos updateMany (defense-in-depth)
 *   - stage allowlist (IA alucinada nao quebra dashboards com stage inventado)
 *   - cap de tamanho em fields texto (notes, summary)
 */
const ALLOWED_STAGES = new Set([
  'NOVO', 'CONTATADO', 'QUALIFICADO', 'PROPOSTA',
  'NEGOCIACAO', 'GANHO', 'PERDIDO', 'FINALIZADO',
  'VIABILIDADE', 'CONSULTA_AGENDADA', 'CLIENTE_ATIVO',
  'INADIMPLENTE', 'ARQUIVADO',
]);

const MAX_NAME_LENGTH = 200;
const MAX_NOTES_LENGTH = 2000;
const MAX_SUMMARY_LENGTH = 2000;
const MAX_NEXT_STEP_LENGTH = 500;

export class UpdateLeadHandler implements ToolHandler {
  name = 'update_lead';

  async execute(
    params: {
      name?: string;
      stage?: string;
      legal_area?: string;
      notes?: string;
      lead_summary?: string;
      next_step?: string;
    },
    context: ToolContext,
  ): Promise<any> {
    const tenantId = requireTenant(context);
    const leadUpdate: Record<string, any> = {};
    const convUpdate: Record<string, any> = {};

    if (params.name) {
      const n = String(params.name).trim().slice(0, MAX_NAME_LENGTH);
      if (n.length > 0) leadUpdate.name = n;
    }
    if (params.stage) {
      const upperStage = String(params.stage).toUpperCase();
      if (!ALLOWED_STAGES.has(upperStage)) {
        return {
          success: false,
          error: `Stage invalido "${params.stage}". Opcoes: ${[...ALLOWED_STAGES].join(', ')}`,
        };
      }
      leadUpdate.stage = upperStage;
      leadUpdate.stage_entered_at = new Date();
    }
    if (params.notes) {
      leadUpdate.notes = String(params.notes).slice(0, MAX_NOTES_LENGTH);
    }

    if (params.legal_area) convUpdate.legal_area = String(params.legal_area).slice(0, 100);
    if (params.lead_summary) convUpdate.lead_summary = String(params.lead_summary).slice(0, MAX_SUMMARY_LENGTH);
    if (params.next_step) convUpdate.next_step = String(params.next_step).slice(0, MAX_NEXT_STEP_LENGTH);

    if (Object.keys(leadUpdate).length) {
      const result = await context.prisma.lead.updateMany({
        where: { id: context.leadId, tenant_id: tenantId },
        data: leadUpdate,
      });
      if (result.count === 0) {
        return { success: false, error: 'Lead nao encontrado ou nao pertence ao tenant atual' };
      }
    }

    if (Object.keys(convUpdate).length) {
      await context.prisma.conversation.updateMany({
        where: { id: context.conversationId, tenant_id: tenantId },
        data: convUpdate,
      });
    }

    return {
      success: true,
      updated: { ...leadUpdate, ...convUpdate },
    };
  }
}
