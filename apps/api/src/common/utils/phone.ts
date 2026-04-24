/**
 * Centraliza a normalização de telefones para evitar duplicidades no banco de dados.
 *
 * Formato canônico: 55 + DDD(2) + número(8) = 12 dígitos (sem o nono dígito).
 *
 * Exemplos:
 *   5582999615165 (13 dígitos) → 558299615165 (12 dígitos)
 *   82999615165  (11 dígitos)  → 558299615165 (12 dígitos)
 *   8299615165   (10 dígitos)  → 558299615165 (12 dígitos)
 *   558232123456 (12 dígitos, fixo) → 558232123456 (inalterado)
 */
export function normalizeBrazilianPhone(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');

  // Case 1: Formato internacional completo com prefixo 55
  // 55 + DD(2) + 9(1) + número(8) = 13 dígitos
  if (cleaned.length === 13 && cleaned.startsWith('55')) {
    const ddd = cleaned.substring(2, 4);
    const fifthDigit = cleaned.substring(4, 5);
    const rest = cleaned.substring(5);
    if (fifthDigit === '9') {
      return `55${ddd}${rest}`;
    }
  }

  // Case 2: Formato local sem prefixo 55, COM nono dígito
  // DD(2) + 9(1) + número(8) = 11 dígitos
  if (cleaned.length === 11 && !cleaned.startsWith('55')) {
    const ddd = cleaned.substring(0, 2);
    const thirdDigit = cleaned.substring(2, 3);
    const rest = cleaned.substring(3);
    if (thirdDigit === '9') {
      return `55${ddd}${rest}`;
    }
  }

  // Case 3: Formato local sem prefixo 55, SEM nono dígito
  // DD(2) + número(8) = 10 dígitos → adiciona 55
  if (cleaned.length === 10 && !cleaned.startsWith('55')) {
    return `55${cleaned}`;
  }

  return cleaned;
}

/**
 * Dado um phone normalizado (12 dígitos: 55+DD+8dígitos),
 * retorna a variante com nono dígito (13 dígitos: 55+DD+9+8dígitos).
 * Usado para encontrar registros legados que ainda têm o formato antigo.
 */
export function denormalizeBrazilianPhone(normalizedPhone: string): string {
  const cleaned = normalizedPhone.replace(/\D/g, '');
  if (cleaned.length === 12 && cleaned.startsWith('55')) {
    const ddd = cleaned.substring(2, 4);
    const number = cleaned.substring(4);
    return `55${ddd}9${number}`;
  }
  return cleaned;
}

/**
 * Converte qualquer entrada de telefone pro formato CANONICO do sistema:
 * 55 + DDD(2) + numero(8) = 12 digitos (sem nono digito).
 *
 * Exemplos:
 *   "(82) 9 9913-0127"  -> "558299130127"
 *   "82999130127"       -> "558299130127"
 *   "8299130127"        -> "558299130127"  (sem nono, adiciona 55)
 *   "5582999130127"     -> "558299130127"
 *   "558299130127"      -> "558299130127"  (ja canonico)
 *
 * Retorna null quando a entrada NAO eh um telefone BR plausivel:
 *   - Menos de 10 digitos
 *   - Mais de 13 digitos (internacional nao-BR)
 *   - Prefixo que nao eh DDD BR valido
 *
 * Uso: chamar em TODO ponto de entrada de telefone (webhooks, forms,
 * imports) antes de salvar no banco. Garante formato unico.
 *
 * Novo em 2026-04-24. Substitui as normalizacoes parciais espalhadas
 * (to12Digits em leads.service.ts, normalizacao inline em createDirect,
 * etc) — centraliza a logica num helper unico.
 */
const VALID_BR_DDDS = new Set([
  // SP
  '11', '12', '13', '14', '15', '16', '17', '18', '19',
  // RJ / ES
  '21', '22', '24', '27', '28',
  // MG
  '31', '32', '33', '34', '35', '37', '38',
  // PR / SC / RS
  '41', '42', '43', '44', '45', '46', '47', '48', '49', '51', '53', '54', '55',
  // Centro-Oeste / Norte
  '61', '62', '63', '64', '65', '66', '67', '68', '69',
  // NE
  '71', '73', '74', '75', '77', '79',
  '81', '82', '83', '84', '85', '86', '87', '88', '89',
  // Norte
  '91', '92', '93', '94', '95', '96', '97', '98', '99',
]);

export function toCanonicalBrPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/\D/g, '');
  if (!cleaned) return null;

  // Extrai DDD + corpo (8 digitos sem o nono) nos 4 formatos possiveis
  let ddd = '';
  let body = '';

  if (cleaned.length === 13 && cleaned.startsWith('55') && cleaned.charAt(4) === '9') {
    // 55 + DD + 9 + 8dig
    ddd = cleaned.substring(2, 4);
    body = cleaned.substring(5);
  } else if (cleaned.length === 12 && cleaned.startsWith('55')) {
    // 55 + DD + 8dig  (canonico)
    ddd = cleaned.substring(2, 4);
    body = cleaned.substring(4);
  } else if (cleaned.length === 11 && cleaned.charAt(2) === '9') {
    // DD + 9 + 8dig (sem DDI)
    ddd = cleaned.substring(0, 2);
    body = cleaned.substring(3);
  } else if (cleaned.length === 10) {
    // DD + 8dig (fixo ou celular antigo sem DDI)
    ddd = cleaned.substring(0, 2);
    body = cleaned.substring(2);
  } else {
    return null; // formato nao plausivel
  }

  if (body.length !== 8) return null;
  if (!VALID_BR_DDDS.has(ddd)) return null;

  return `55${ddd}${body}`;
}

/**
 * Formata telefone canonico pra exibicao visual: "82 99913-0127".
 * Espera entrada canonica (12 digitos, 55+DDD+8dig). Retorna input
 * inalterado se nao for canonico.
 */
export function formatBrPhoneForDisplay(canonical: string): string {
  const d = (canonical || '').replace(/\D/g, '');
  if (d.length !== 12 || !d.startsWith('55')) return canonical;
  const ddd = d.substring(2, 4);
  const rest = d.substring(4); // 8 digitos
  // Reconstitui com o "9" presumido pra exibicao natural
  return `${ddd} 9${rest.substring(0, 4)}-${rest.substring(4)}`;
}

/**
 * Retorna TODAS as variantes plausíveis de um telefone BR pra busca robusta.
 * Cobre os 4 formatos que podem existir no banco devido a historico de
 * diferentes normalizacoes:
 *
 *   - 8299123456    (10 digitos, sem DDI sem 9)
 *   - 82999123456   (11 digitos, sem DDI com 9)
 *   - 558299123456  (12 digitos, com DDI sem 9 — canonico)
 *   - 5582999123456 (13 digitos, com DDI com 9)
 *
 * Uso tipico:
 *   const variants = phoneVariants(userInput);
 *   prisma.lead.findFirst({ where: { phone: { in: variants } } })
 *
 * Deduplica e filtra vazios. Entrada com formatacao (parenteses, espacos,
 * hifens) eh aceita — so considera digitos.
 */
export function phoneVariants(phone: string): string[] {
  const cleaned = (phone || '').replace(/\D/g, '');
  if (!cleaned) return [];

  const variants = new Set<string>();
  variants.add(cleaned);

  // Extrai o "corpo" canonico: DDD(2) + numero sem nono dígito (8 digitos)
  let ddd = '';
  let body = ''; // 8 digitos sem o nono

  if (cleaned.length === 13 && cleaned.startsWith('55') && cleaned.charAt(4) === '9') {
    // 5582 9 99123456
    ddd = cleaned.substring(2, 4);
    body = cleaned.substring(5);
  } else if (cleaned.length === 12 && cleaned.startsWith('55')) {
    // 5582 99123456
    ddd = cleaned.substring(2, 4);
    body = cleaned.substring(4);
  } else if (cleaned.length === 11 && cleaned.charAt(2) === '9') {
    // 82 9 99123456
    ddd = cleaned.substring(0, 2);
    body = cleaned.substring(3);
  } else if (cleaned.length === 10) {
    // 82 99123456
    ddd = cleaned.substring(0, 2);
    body = cleaned.substring(2);
  }

  if (ddd && body && body.length === 8) {
    variants.add(`${ddd}${body}`);            // 10 dig
    variants.add(`${ddd}9${body}`);           // 11 dig
    variants.add(`55${ddd}${body}`);          // 12 dig (canonico)
    variants.add(`55${ddd}9${body}`);         // 13 dig
  }

  return Array.from(variants).filter(v => v.length >= 8);
}
