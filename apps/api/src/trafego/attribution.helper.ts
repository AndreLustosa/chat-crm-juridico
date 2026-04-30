/**
 * Helper de captura de atribuicao (gclid/utm) pra Lead.
 *
 * Onde usar:
 *  - Endpoint POST /leads (admin form CRM pode passar via body).
 *  - Webhook do WhatsApp (gclid pode vir via UTM no link inicial — capturar
 *    via UrlMappingService ou redirector quando o lead clicar no anuncio).
 *  - Webhook de Lead Form Asset (Google Ads — gclid vem direto no payload).
 *  - Public landing pages (formulario de contato com hidden fields gclid/utm).
 *
 * NOTA: gclid em query string da landing page eh o caminho canonico
 * (https://andrelustosaadvogados.com.br/?gclid=Cj0KCQ...). O frontend
 * persiste em sessionStorage/cookie e injeta como hidden field no form
 * de contato. Servidor recebe no body e usa este helper pra extrair.
 */

export type AttributionInput = {
  body?: Record<string, any>;
  query?: Record<string, any>;
  headers?: Record<string, any>;
};

export type AttributionFields = {
  google_gclid?: string | null;
  google_gbraid?: string | null;
  google_wbraid?: string | null;
  google_click_at?: Date | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
};

/**
 * Extrai campos de attribution de body, query e/ou headers (ordem de
 * preferencia: body > query > header). Retorna apenas os campos presentes
 * (omite undefined) — pronto pra spread em Prisma.LeadCreateInput.
 */
export function extractAttribution(input: AttributionInput): AttributionFields {
  const out: AttributionFields = {};
  const pick = (key: string): string | null => {
    const fromBody = input.body?.[key];
    const fromQuery = input.query?.[key];
    const fromHeader = input.headers?.[key];
    const value = fromBody ?? fromQuery ?? fromHeader;
    if (value === null || value === undefined || value === '') return null;
    return String(value).slice(0, 512); // trunca pra evitar payload absurdo
  };

  const gclid = pick('gclid') ?? pick('google_gclid');
  const gbraid = pick('gbraid') ?? pick('google_gbraid');
  const wbraid = pick('wbraid') ?? pick('google_wbraid');

  if (gclid !== null) out.google_gclid = gclid;
  if (gbraid !== null) out.google_gbraid = gbraid;
  if (wbraid !== null) out.google_wbraid = wbraid;

  // Click timestamp — frontend deveria mandar (sessao); fallback now().
  // Validamos a string parseada pra evitar Invalid Date entrando no Prisma
  // (gera erro 500 em POST /leads quando body vem com timestamp malformado).
  if (gclid || gbraid || wbraid) {
    const clickAt = pick('click_at') ?? pick('google_click_at');
    if (clickAt) {
      const parsed = new Date(clickAt);
      out.google_click_at = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    } else {
      out.google_click_at = new Date();
    }
  }

  const utmSource = pick('utm_source');
  const utmMedium = pick('utm_medium');
  const utmCampaign = pick('utm_campaign');
  const utmContent = pick('utm_content');
  const utmTerm = pick('utm_term');

  if (utmSource !== null) out.utm_source = utmSource;
  if (utmMedium !== null) out.utm_medium = utmMedium;
  if (utmCampaign !== null) out.utm_campaign = utmCampaign;
  if (utmContent !== null) out.utm_content = utmContent;
  if (utmTerm !== null) out.utm_term = utmTerm;

  return out;
}
