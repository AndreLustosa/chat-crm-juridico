import type { PrismaService } from '../../prisma/prisma.service';
import type { ChatGateway } from '../../gateway/chat.gateway';

/**
 * Fecha (marca como GANHO) todos os Deals ABERTOS de um lead.
 *
 * Chamado quando o contato VIRA CLIENTE — seja por finalizar o lead
 * (LeadsService.updateStatus → FINALIZADO) ou por ter um processo cadastrado
 * (LegalCasesService.createDirect / unarchive / syncClientsFromActiveCases).
 * Resultado: o contato SAI do kanban do CRM (deixa de ser "oportunidade aberta")
 * e fica consistente com is_client=true no chat (Leads → Clientes).
 *
 * Cada deal aberto é movido pra etapa GANHO do próprio funil (won_at = agora) e
 * ganha uma entrada em DealStageHistory (moved_via = 'automation'). Se o funil
 * não tiver etapa GANHO, apenas seta won_at — o deal sai do "aberto" do mesmo
 * jeito (o kanban filtra won_at/lost_at IS NULL).
 *
 * Função PURA (recebe prisma + gateway por parâmetro) pra evitar dependência de
 * módulo/DI e qualquer risco de ciclo. É best-effort e idempotente: NUNCA lança
 * (não pode derrubar o fluxo de finalizar/cadastrar) e é no-op se não houver
 * deal aberto. Retorna quantos deals foram fechados.
 */
export async function closeOpenDealsAsWon(
  prisma: PrismaService,
  chatGateway: ChatGateway | null | undefined,
  leadId: string,
  tenantId: string | null | undefined,
  userId?: string,
): Promise<number> {
  try {
    const open = await prisma.deal.findMany({
      where: {
        lead_id: leadId,
        won_at: null,
        lost_at: null,
        ...(tenantId ? { tenant_id: tenantId } : {}),
      },
      include: { stage: { select: { name: true } } },
    });
    if (open.length === 0) return 0;

    const now = new Date();
    for (const d of open) {
      // Etapa GANHO do mesmo funil (se existir) — senão só marca won_at.
      const ganho = await prisma.funnelStage.findFirst({
        where: { funnel_id: d.funnel_id, type: 'GANHO' },
        orderBy: { order: 'asc' },
        select: { id: true, name: true },
      });

      await prisma.deal.update({
        where: { id: d.id },
        data: {
          won_at: now,
          ...(ganho ? { stage_id: ganho.id, stage_entered_at: now } : {}),
        },
      });

      await prisma.dealStageHistory
        .create({
          data: {
            deal_id: d.id,
            from_stage_id: d.stage_id,
            from_stage_name: d.stage?.name ?? null,
            to_stage_id: ganho?.id ?? d.stage_id,
            to_stage_name: ganho?.name ?? d.stage?.name ?? null,
            moved_by_id: userId ?? null,
            moved_via: 'automation',
            reason:
              'Contato virou cliente (lead finalizado / processo cadastrado) — deal fechado automaticamente',
          },
        })
        .catch(() => null);
    }

    chatGateway?.emitConversationsUpdate(tenantId ?? null);
    return open.length;
  } catch {
    // best-effort: nunca quebra o fluxo de negócio que disparou a conversão
    return 0;
  }
}
