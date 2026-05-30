/**
 * Identidade do escritório (white-label da IA) — resolvida por tenant.
 *
 * A IA do sistema é GLOBAL (skills, API, pipeline), mas cada escritório escolhe
 * o NOME da IA e fornece os dados do escritório (nome, endereço, etc.) que são
 * injetados nos prompts via {{ai_name}}, {{firm_name}}, {{firm_address}}...
 *
 * Esta função centraliza a resolução: dado o tenant da conversa/followup,
 * retorna os valores com FALLBACK para o padrão histórico ("Sophia" /
 * "André Lustosa Advogados") — garantindo ZERO regressão para quem ainda não
 * configurou (campos nulos no Tenant) ou para conversas sem tenant (órfãs).
 *
 * Usada por: ai.processor (atendimento), followup.processor, followup-cron,
 * followup-analyzer, book-appointment (persona da IA nos follow-ups/agenda).
 */

export interface FirmIdentity {
  /** Nome da IA atendente (ex.: "Sophia"). */
  aiName: string;
  /** Nome do escritório (ex.: "André Lustosa Advogados"). */
  firmName: string;
  phone: string;
  address: string;
  email: string;
  oab: string;
  site: string;
  /** Tom/persona/saudação opcional definida pelo escritório. */
  tone: string;
  /** Gate master da IA (#77): false = a IA não deve responder a este escritório. */
  aiEnabled: boolean;
}

/** Padrões históricos — usados como fallback quando o tenant não configurou. */
export const DEFAULT_AI_NAME = 'Sophia';
export const DEFAULT_FIRM_NAME = 'André Lustosa Advogados';

export const FIRM_IDENTITY_FALLBACK: FirmIdentity = {
  aiName: DEFAULT_AI_NAME,
  firmName: DEFAULT_FIRM_NAME,
  phone: '',
  address: '',
  email: '',
  oab: '',
  site: '',
  tone: '',
  aiEnabled: true, // sem tenant/erro → não bloqueia (comportamento atual)
};

/**
 * Carrega a identidade do escritório a partir do tenant.
 * Nunca lança: em qualquer falha (tenant nulo, erro de DB) retorna o fallback.
 */
export async function resolveFirmIdentity(
  prisma: any,
  tenantId?: string | null,
): Promise<FirmIdentity> {
  if (!tenantId) return { ...FIRM_IDENTITY_FALLBACK };
  try {
    const t = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        name: true,
        phone: true,
        address: true,
        email: true,
        oab: true,
        site: true,
        ai_assistant_name: true,
        ai_tone: true,
        ai_enabled: true,
      },
    });
    if (!t) return { ...FIRM_IDENTITY_FALLBACK };
    return {
      aiName: (t.ai_assistant_name || '').trim() || DEFAULT_AI_NAME,
      firmName: (t.name || '').trim() || DEFAULT_FIRM_NAME,
      phone: t.phone || '',
      address: t.address || '',
      email: t.email || '',
      oab: t.oab || '',
      site: t.site || '',
      tone: t.ai_tone || '',
      aiEnabled: t.ai_enabled !== false, // default true; só bloqueia se explicitamente false
    };
  } catch {
    return { ...FIRM_IDENTITY_FALLBACK };
  }
}
