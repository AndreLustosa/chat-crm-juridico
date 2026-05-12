import type { ToolHandler, ToolContext } from '../tool-executor';
import { requireTenant } from './tool-guards.util';

/**
 * Salva campo(s) da ficha trabalhista (ou outra ficha futura).
 * Usa o mesmo endpoint interno que o frontend usa.
 *
 * Bug fix 2026-05-12 (Skills PR2 #A7 — ALTO):
 *
 * Antes: upsert seguido de update separados — duas chamadas paralelas
 * (IA disparando 2x o mesmo campo, ou worker concorrente) podiam resultar
 * em "ultima-grava-vence" perdendo dados intermediarios. Tambem
 * completion_pct ficava fora de sincronia.
 *
 * Agora: $transaction com FOR UPDATE lock no row. Garante atomicidade:
 * leitura + merge + write num passo so. Concorrentes esperam.
 */
export class SaveFormFieldHandler implements ToolHandler {
  name = 'save_form_field';

  async execute(
    params: { fields: Record<string, string> },
    context: ToolContext,
  ): Promise<any> {
    const fields = params.fields || {};
    if (!Object.keys(fields).length) {
      return { success: false, message: 'Nenhum campo fornecido' };
    }

    // Tenant guard (defense-in-depth via util compartilhado)
    let tenantId: string;
    try {
      tenantId = requireTenant(context);
    } catch (e: any) {
      return { success: false, message: e.message };
    }

    const lead = await context.prisma.lead.findUnique({
      where: { id: context.leadId },
      select: { tenant_id: true },
    });
    if (!lead) {
      return { success: false, message: 'Lead nao encontrado' };
    }
    if (lead.tenant_id !== tenantId) {
      return {
        success: false,
        message: 'Lead nao pertence ao tenant atual — operacao bloqueada',
      };
    }

    // Cap em quantidade de fields por chamada (evita LLM tentar gravar 100
    // campos numa hora — limita escopo). Cap 20 campos por turno.
    const FIELD_KEYS = Object.keys(fields);
    if (FIELD_KEYS.length > 20) {
      return {
        success: false,
        message: 'Maximo 20 campos por chamada de save_form_field',
      };
    }

    // Cap no tamanho dos values (evita injection de blob gigante no JSONB)
    for (const [k, v] of Object.entries(fields)) {
      if (typeof v === 'string' && v.length > 2000) {
        return {
          success: false,
          message: `Campo "${k}" muito longo (max 2000 chars)`,
        };
      }
    }

    // Bug fix #A7: transação atômica.
    // Step 1: upsert + select FOR UPDATE (lock no row durante a tx)
    // Step 2: merge data
    // Step 3: update no mesmo row
    // Concorrentes em outra tx ficam waiting ate commit.
    const TOTAL_FIELDS = 75;
    let pct = 0;
    try {
      pct = await context.prisma.$transaction(async (tx: any) => {
        // Upsert primeiro pra garantir row existir
        await tx.fichaTrabalhista.upsert({
          where: { lead_id: context.leadId },
          update: {},
          create: { lead_id: context.leadId, data: {} },
        });

        // Lock o row pra leitura coerente. Postgres-specific.
        const locked = (await tx.$queryRawUnsafe(
          `SELECT data FROM "FichaTrabalhista" WHERE lead_id = $1 FOR UPDATE`,
          context.leadId,
        )) as any[];
        const oldData = (locked[0]?.data as Record<string, any>) || {};
        const merged = { ...oldData, ...fields };

        const filled = Object.values(merged).filter(
          (v) => v !== null && v !== undefined && v !== '',
        ).length;
        const computedPct = Math.min(100, Math.round((filled / TOTAL_FIELDS) * 100));

        await tx.fichaTrabalhista.update({
          where: { lead_id: context.leadId },
          data: {
            data: merged,
            completion_pct: computedPct,
            filled_by: 'ai',
            ...(fields.nome_completo ? { nome_completo: fields.nome_completo } : {}),
            ...(fields.nome_empregador ? { nome_empregador: fields.nome_empregador } : {}),
          },
        });

        return computedPct;
      }, {
        // timeout transacao (5s suficiente — sem chamadas externas)
        timeout: 5_000,
      });
    } catch (e: any) {
      return {
        success: false,
        message: `Falha ao salvar ficha: ${e.message}`,
      };
    }

    return {
      success: true,
      fields_saved: FIELD_KEYS,
      completion_pct: pct,
    };
  }
}
