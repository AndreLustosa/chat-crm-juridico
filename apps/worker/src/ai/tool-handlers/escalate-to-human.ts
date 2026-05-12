import type { ToolHandler, ToolContext } from '../tool-executor';
import { requireTenant } from './tool-guards.util';

/**
 * Escala a conversa para atendimento humano.
 * Desativa o modo IA e opcionalmente registra o motivo.
 *
 * Bug fix 2026-05-11 (Skills PR1 #C10): tenant guard no where do update.
 * Antes: update por id sem tenant_id — se contexto comprometido, IA desligava
 * ai_mode de conversation de outro tenant.
 */
export class EscalateToHumanHandler implements ToolHandler {
  name = 'escalate_to_human';

  async execute(params: { reason?: string }, context: ToolContext): Promise<any> {
    const tenantId = requireTenant(context);
    // updateMany com tenant_id no where + checa count: defense-in-depth.
    const result = await context.prisma.conversation.updateMany({
      where: { id: context.conversationId, tenant_id: tenantId },
      data: { ai_mode: false },
    });
    if (result.count === 0) {
      return {
        success: false,
        error: 'Conversa nao encontrada ou nao pertence ao tenant atual',
      };
    }

    return {
      success: true,
      message: 'Conversa escalada para atendimento humano',
      reason: params.reason || 'solicitação do agente',
    };
  }
}
