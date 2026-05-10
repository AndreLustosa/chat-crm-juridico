import { PrismaService } from '../prisma/prisma.service';

/**
 * Bug fix 2026-05-10 (Memoria PR1 #C2/#C6/#C7 — CRITICO):
 *
 * Cap diario global pra custos do sistema de memoria. Evita que cron noturno
 * (extracao + consolidacao lead + consolidacao org) gere fatura descontrolada
 * de OpenAI quando ha:
 *   - Tenant com 1000+ conversas/dia (raro mas existe)
 *   - Bug em prompt fazendo LLM gerar saida grande
 *   - Loop em job que reprocessa o mesmo lead
 *   - Ataque (criar lead novo + spam de mensagens triggando extracao)
 *
 * Cap padrao US$ 50/dia. Configuravel via GlobalSetting MEMORY_BATCH_DAILY_USD_CAP.
 *
 * Uso compartilhado entre:
 *   - DailyMemoryBatchProcessor (extracao via gpt-4.1)
 *   - ProfileConsolidationProcessor (consolidacao lead via gpt-4.1-mini)
 *   - OrgProfileConsolidationProcessor (consolidacao org via gpt-4.1)
 *
 * Tudo conta no mesmo balde (call_type IN (...)) pra evitar overflow combinado
 * mesmo se cada componente individualmente esta abaixo do "esperado".
 */
export const MEMORY_CALL_TYPES = [
  'memory',
  'memory_batch',
  'profile_consolidation',
  'org_profile_consolidation',
];

export const DEFAULT_DAILY_CAP_USD = 50.0;

export async function checkMemoryDailyCap(
  prisma: PrismaService,
): Promise<{ ok: boolean; spent: number; cap: number }> {
  const capRow = await prisma.globalSetting.findUnique({
    where: { key: 'MEMORY_BATCH_DAILY_USD_CAP' },
  });
  const cap = capRow?.value ? parseFloat(capRow.value) : DEFAULT_DAILY_CAP_USD;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const usage = await (prisma as any)
    .aiUsage.aggregate({
      where: {
        call_type: { in: MEMORY_CALL_TYPES },
        created_at: { gte: since },
      },
      _sum: { cost_usd: true },
    })
    .catch(() => ({ _sum: { cost_usd: 0 } }));
  const spent = Number(usage._sum?.cost_usd || 0);
  return {
    ok: Number.isFinite(cap) && cap > 0 && spent < cap,
    spent,
    cap,
  };
}
