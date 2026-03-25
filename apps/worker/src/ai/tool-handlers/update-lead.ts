import type { ToolHandler, ToolContext } from '../tool-executor';

/**
 * Atualiza dados do lead (nome, stage, área jurídica, etc.).
 * Campos permitidos: name, stage, legal_area, notes, lead_summary, next_step.
 */
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
    const leadUpdate: Record<string, any> = {};
    const convUpdate: Record<string, any> = {};

    if (params.name) leadUpdate.name = params.name;
    if (params.stage) {
      leadUpdate.stage = params.stage;
      leadUpdate.stage_entered_at = new Date();
    }
    if (params.notes) leadUpdate.notes = params.notes;

    if (params.legal_area) convUpdate.legal_area = params.legal_area;
    if (params.lead_summary) convUpdate.lead_summary = params.lead_summary;
    if (params.next_step) convUpdate.next_step = params.next_step;

    if (Object.keys(leadUpdate).length) {
      await context.prisma.lead.update({
        where: { id: context.leadId },
        data: leadUpdate,
      });
    }

    if (Object.keys(convUpdate).length) {
      await context.prisma.conversation.update({
        where: { id: context.conversationId },
        data: convUpdate,
      });
    }

    return {
      success: true,
      updated: { ...leadUpdate, ...convUpdate },
    };
  }
}
