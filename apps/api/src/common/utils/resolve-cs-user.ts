/**
 * Resolve o operador (cs_user_id) a creditar quando um lead vira cliente.
 *
 * Regra (decisão do dono, 2026-06): NUNCA deixar um cliente "sem operador".
 * Ordem de prioridade:
 *   1) cs_user_id já gravado no lead  → preserva (não rouba crédito de quem fechou antes);
 *   2) candidatos `preferred` do caller (ex.: atendente escolhido no cadastro, dono do deal);
 *   3) atendente da conversa mais recente (assigned_user_id — separado do advogado).
 * O CALLER aplica o fallback final (o ator / quem fez a ação) com `?? actorId`,
 * de modo que, para ações humanas, sempre sobra ao menos o ator → nunca nulo.
 *
 * Observação: `cs_user_id` só era gravado na finalização via funil; conversões via
 * cadastro de processo / ganho no funil deixavam o lead sem operador (26 de 30 no
 * escritório). Este helper centraliza a atribuição em todos os caminhos.
 */
export async function resolveCsUser(
  prisma: any,
  leadId: string,
  preferred: Array<string | null | undefined> = [],
): Promise<string | null> {
  if (!leadId) return null;
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      cs_user_id: true,
      conversations: {
        select: { assigned_user_id: true },
        orderBy: { last_message_at: 'desc' },
        take: 1,
      },
    },
  });
  const candidates: Array<string | null | undefined> = [
    lead?.cs_user_id,
    ...preferred,
    lead?.conversations?.[0]?.assigned_user_id,
  ];
  return candidates.find((x): x is string => typeof x === 'string' && x.length > 0) ?? null;
}
