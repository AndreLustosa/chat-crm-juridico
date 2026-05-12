import * as crypto from 'crypto';

/**
 * Helper de tokens compartilhaveis pra recursos do portal — usado quando a IA
 * precisa enviar um documento via WhatsApp pra cliente.
 *
 * Formato: `${payloadB64url}.${signatureB64url}`
 *   payload = { sub, lead_id, exp } JSON em base64url
 *   signature = HMAC-SHA256(payload, JWT_SECRET) em base64url
 *
 * Diferencas pra JWT real:
 *   - Sem header (header eh implicito: HS256)
 *   - 100% Node crypto, sem dependencia externa (worker nao tem @nestjs/jwt)
 *
 * Uso:
 *   - Worker (gera URL): signShareToken({ sub: docId, lead_id }, secret)
 *   - API (valida): verifyShareToken(token, secret) -> payload ou null
 */

export interface ShareTokenPayload {
  sub: string;        // ID do recurso (doc_id, etc)
  lead_id: string;    // dono — pra dupla-checagem de ownership
  tenant_id?: string; // tenant — defense-in-depth contra cross-tenant via token
  aud: string;        // "doc-share" pra documentos, futuro pode ter outros
  exp: number;        // unix epoch seconds
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(str: string): Buffer {
  // Pad de volta pra base64 padrao
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(b64, 'base64');
}

/**
 * Gera token assinado. ttlSeconds default 1 hora.
 */
export function signShareToken(
  payload: Omit<ShareTokenPayload, 'exp'>,
  secret: string,
  ttlSeconds = 3600,
): string {
  const fullPayload: ShareTokenPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const json = JSON.stringify(fullPayload);
  const payloadB64 = base64UrlEncode(Buffer.from(json, 'utf-8'));
  const sig = crypto
    .createHmac('sha256', secret)
    .update(payloadB64)
    .digest();
  const sigB64 = base64UrlEncode(sig);
  return `${payloadB64}.${sigB64}`;
}

/**
 * Valida token. Retorna payload se valido, null caso contrario.
 *
 * Verifica:
 *   - Formato correto (2 partes)
 *   - Assinatura HMAC bate
 *   - Nao expirou
 */
export function verifyShareToken(token: string, secret: string): ShareTokenPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;

  // Recomputa assinatura
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(payloadB64)
    .digest();
  let providedSig: Buffer;
  try {
    providedSig = base64UrlDecode(sigB64);
  } catch {
    return null;
  }
  if (expectedSig.length !== providedSig.length) return null;
  if (!crypto.timingSafeEqual(expectedSig, providedSig)) return null;

  // Decodifica payload
  let payload: ShareTokenPayload;
  try {
    const json = base64UrlDecode(payloadB64).toString('utf-8');
    payload = JSON.parse(json);
  } catch {
    return null;
  }

  // Valida campos obrigatorios e expiracao
  if (!payload.sub || !payload.lead_id || !payload.aud || !payload.exp) return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;

  return payload;
}
