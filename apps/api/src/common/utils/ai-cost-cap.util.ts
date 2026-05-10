import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Cost cap pra chamadas IA (OpenAI/Anthropic).
 *
 * Bug fix 2026-05-10 (Peticoes PR1 #6):
 * Antes nao havia contagem agregada de tokens/USD por user/tenant
 * antes de chamar IA. Estagiario rodava script de geracao 100x →
 * 50 peticoes x 4096 tokens output gpt-4o = ~US$ 3 por peticao =
 * US$ 150 em 1 hora (US$ 1.230 com gpt-5).
 *
 * Estrategia:
 *   - Cap diario por user_id (default 50 chamadas) e por tenant
 *     (default 500 chamadas)
 *   - Cap em USD acumulado: 5/usuario/dia, 50/tenant/dia (defaults
 *     conservadores — admin pode aumentar via Settings futuro)
 *   - Conta TODOS os AiUsage do dia (qualquer modulo, qualquer modelo)
 *   - Bloqueio: ForbiddenException com mensagem clara
 *   - "Soft cap" (warn em 80%) reservado pra v2 com notification
 */

export const AI_COST_CAP_USD_PER_USER_DAY = 5.0;
export const AI_COST_CAP_USD_PER_TENANT_DAY = 50.0;
export const AI_CALLS_CAP_PER_USER_DAY = 50;
export const AI_CALLS_CAP_PER_TENANT_DAY = 500;

export async function assertAiCostCap(
  prisma: PrismaService,
  userId: string | null | undefined,
  tenantId: string | null | undefined,
): Promise<void> {
  // Janela: ultimas 24h (rolling, nao calendario)
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Cap por user (mais restritivo — bloqueia primeiro)
  if (userId) {
    const userUsage = await (prisma as any).aiUsage.aggregate({
      where: { user_id: userId, created_at: { gte: since } },
      _sum: { cost_usd: true },
      _count: { id: true },
    }).catch(() => ({ _sum: { cost_usd: 0 }, _count: { id: 0 } }));

    const userCost = Number(userUsage._sum?.cost_usd || 0);
    const userCalls = Number(userUsage._count?.id || 0);

    if (userCalls >= AI_CALLS_CAP_PER_USER_DAY) {
      throw new ForbiddenException(
        `Cap diario de chamadas IA atingido (${userCalls}/${AI_CALLS_CAP_PER_USER_DAY}). ` +
        `Aguarde 24h ou peca pro admin aumentar o limite.`,
      );
    }
    if (userCost >= AI_COST_CAP_USD_PER_USER_DAY) {
      throw new ForbiddenException(
        `Cap diario de custo IA atingido (US$ ${userCost.toFixed(2)}/${AI_COST_CAP_USD_PER_USER_DAY}). ` +
        `Aguarde 24h ou peca pro admin aumentar o limite.`,
      );
    }
  }

  // Cap por tenant (mais alto, evita um user travar todo o escritorio)
  if (tenantId) {
    const tenantUsage = await (prisma as any).aiUsage.aggregate({
      where: { tenant_id: tenantId, created_at: { gte: since } },
      _sum: { cost_usd: true },
      _count: { id: true },
    }).catch(() => ({ _sum: { cost_usd: 0 }, _count: { id: 0 } }));

    const tenantCost = Number(tenantUsage._sum?.cost_usd || 0);
    const tenantCalls = Number(tenantUsage._count?.id || 0);

    if (tenantCalls >= AI_CALLS_CAP_PER_TENANT_DAY) {
      throw new ForbiddenException(
        `Cap diario de chamadas IA do escritorio atingido ` +
        `(${tenantCalls}/${AI_CALLS_CAP_PER_TENANT_DAY}). Contate o admin.`,
      );
    }
    if (tenantCost >= AI_COST_CAP_USD_PER_TENANT_DAY) {
      throw new ForbiddenException(
        `Cap diario de custo IA do escritorio atingido ` +
        `(US$ ${tenantCost.toFixed(2)}/${AI_COST_CAP_USD_PER_TENANT_DAY}). Contate o admin.`,
      );
    }
  }
}
