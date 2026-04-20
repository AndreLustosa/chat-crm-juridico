/**
 * Limpa informacoes institucionais hardcoded nos prompts das skills que agora
 * sao providas pela variavel {{office_memories}}. Evita duplicacao e
 * inconsistencia quando o admin atualiza dados do escritorio via UI.
 *
 * Seguro: usa regex especificos para linhas conhecidas. Nao toca em nada
 * alem do padrao exato. Idempotente.
 */

export interface CleanupRule {
  /** Descricao humana do que remove */
  description: string;
  /** Regex que casa a linha inteira (incluir \n no final quando apropriado) */
  pattern: RegExp;
}

/**
 * Regras de limpeza. Cada regex e APLICADO COM .replace() — match vira string
 * vazia. Multiline + global. Testado contra os prompts default em
 * apps/api/src/settings/settings.service.ts.
 */
export const CLEANUP_RULES: CleanupRule[] = [
  {
    description: 'Numeros oficiais hardcoded (agora em {{office_memories}})',
    // Captura: "Números oficiais: (82) ... Número diferente = alerta de golpe.\n"
    // Aceita com ou sem trailing newline. \n mantido quando presente para evitar linha vazia.
    pattern: /^Números oficiais:\s*\(82\)[^\n]*\n?/gm,
  },
  {
    description: 'Endereco hardcoded (agora em {{office_memories}})',
    // "Endereço: Rua Francisco Rodrigues Viana..."
    pattern: /^Endereço:\s*Rua Francisco Rodrigues Viana[^\n]*\n?/gm,
  },
  {
    description: 'Bloco Seguranca no INICIO de linha (Consumidor, Previdenciario)',
    // "Segurança: (82) 99913-0127, ..." como linha inteira dedicada.
    // Remove a linha inteira + \n final.
    pattern: /^Segurança:\s*\(82\)[^\n]*\n?/gm,
  },
  {
    description: 'Bloco Seguranca INLINE em meio de linha (6 skills especialistas: Imobiliario, Civil, Geral, Familia, Penal, Empresarial)',
    // "...obrigatório. Segurança: (82) 99913-0127, ..." dentro de uma linha maior.
    // Remove DE " Segurança:" ate o fim da linha, SEM consumir o \n.
    // Evita juntar linhas: " +" exige pelo menos um espaco antes (nao casa se
    // "Segurança:" esta no inicio de linha, pois ai nao ha espaco — esse caso
    // ja e coberto pela regra anterior).
    pattern: / +Segurança:\s*\(82\)[^\n]*/g,
  },
];

export interface CleanupMatch {
  rule: string;
  matched_text: string;
  line_number: number;
}

export interface CleanupResult {
  updated: string;
  changed: boolean;
  matches: CleanupMatch[];
  chars_removed: number;
}

/**
 * Aplica as regras de limpeza. Retorna o texto novo + lista de matches
 * removidos (para audit/preview).
 */
export function cleanHardcodedOrgInfo(prompt: string): CleanupResult {
  if (!prompt || typeof prompt !== 'string') {
    return { updated: prompt, changed: false, matches: [], chars_removed: 0 };
  }

  const matches: CleanupMatch[] = [];

  for (const rule of CLEANUP_RULES) {
    // globalRegex.exec em loop para pegar todos os matches + linha
    const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = regex.exec(prompt)) !== null) {
      const upToMatch = prompt.substring(0, m.index);
      const lineNumber = (upToMatch.match(/\n/g) || []).length + 1;
      matches.push({
        rule: rule.description,
        matched_text: m[0].replace(/\n$/, ''),
        line_number: lineNumber,
      });
      if (m.index === regex.lastIndex) regex.lastIndex++;
    }
  }

  if (matches.length === 0) {
    return { updated: prompt, changed: false, matches: [], chars_removed: 0 };
  }

  let updated = prompt;
  for (const rule of CLEANUP_RULES) {
    updated = updated.replace(rule.pattern, '');
  }

  // Limpa linhas duplas em branco que possam ter ficado
  updated = updated.replace(/\n{3,}/g, '\n\n');

  return {
    updated,
    changed: updated !== prompt,
    matches,
    chars_removed: prompt.length - updated.length,
  };
}
