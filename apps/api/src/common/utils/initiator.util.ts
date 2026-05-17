import type { Request } from 'express';

/**
 * Resolve o `initiator` que vai pro TrafficMutateLog (e qualquer outro audit
 * log que precise distinguir AGENTE da acao).
 *
 * Prioridade:
 *   1. Header `X-Initiator` enviado pelo cliente (validado contra whitelist
 *      de prefixos confiaveis: mcp:, ai_agent:). Util pra que o
 *      traffic-mcp-server marque acoes do Claude como `mcp:claude:<tool_call_id>`
 *      em vez de cair no fallback `user:<admin_id>` (o admin gerou o token,
 *      mas quem agiu foi o Claude).
 *   2. Fallback: `user:<req.user.id>`.
 *
 * SECURITY: nao confiamos no header de qualquer um — so aceitamos prefixos
 * conhecidos. Sem whitelist, qualquer admin podia mascarar acoes manuais
 * como se fossem do Claude, contaminando o audit trail.
 */
const ALLOWED_PREFIXES = ['mcp:', 'ai_agent:'];
const MAX_INITIATOR_LENGTH = 120;

export function resolveInitiator(req: Request): string {
  const headerValue = req.headers['x-initiator'];
  const raw =
    typeof headerValue === 'string'
      ? headerValue
      : Array.isArray(headerValue)
        ? headerValue[0]
        : undefined;

  if (raw) {
    const trimmed = raw.trim();
    if (
      trimmed.length > 0 &&
      trimmed.length <= MAX_INITIATOR_LENGTH &&
      ALLOWED_PREFIXES.some((p) => trimmed.startsWith(p)) &&
      /^[a-zA-Z0-9_:\-./]+$/.test(trimmed)
    ) {
      return trimmed;
    }
  }

  const userId = (req as any)?.user?.id;
  return userId ? `user:${userId}` : 'user:unknown';
}
