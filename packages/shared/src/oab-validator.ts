/**
 * OAB Validator (Provimento 205/2021 — CFOAB).
 *
 * Cross-cutting: usado pelo worker (antes de fazer mutate de Ads) e pela API
 * (preview no UI quando admin gera/edita criativo). Pure function — sem I/O.
 *
 * Aplicar em:
 *  - Headlines / descriptions de RSA antes do submit.
 *  - Headlines / descriptions de PMax Asset Group.
 *  - Lead Form headline / description / post-submit.
 *  - Sitelinks / callouts.
 *  - Recomendacoes do Google Ads que sugerem texto de anuncio (filtrar).
 *
 * Regras:
 *  - Nunca usar "garantia", "100%", "melhor", "maior" (em contexto de promessa).
 *  - Nunca prometer resultado ("vitoria certa", "ganho garantido").
 *  - Nunca comparar com colegas ("os melhores advogados").
 *  - Nunca usar testemunhos.
 *  - Numero da OAB visivel em pelo menos 1 ad asset (headline/description/business name).
 *  - Tom sobrio, sem urgencia mercantil exagerada (ex: "ULTIMA CHANCE!!!").
 *
 * Saida: ok=false bloqueia o mutate. severity 'WARN' nao bloqueia mas avisa.
 */

export type OABViolation = {
  rule: string;
  severity: 'BLOCK' | 'WARN';
  match: string;
  field?: string;
  reason: string;
};

export type OABValidationResult = {
  ok: boolean;
  violations: OABViolation[];
};

/**
 * Frases proibidas — bloqueiam o submit. Padroes regex case-insensitive.
 *
 * Heuristica: palavras como "melhor" e "100%" so violam quando combinadas com
 * promessa de servico/resultado. Patterns abaixo capturam o contexto, evitando
 * falso-positivo (ex: "100% online" eh OK; "100% de vitoria" eh BLOCK).
 */
const FORBIDDEN_PATTERNS: Array<{ regex: RegExp; rule: string; reason: string }> = [
  {
    regex: /\bgarantia\s+de\s+(?:vitoria|vitória|sucesso|resultado|ganho|indeniza)/i,
    rule: 'GARANTIA_DE_RESULTADO',
    reason: 'Promessa de resultado proibida pela OAB',
  },
  {
    regex: /\b(?:vitoria|vitória|sucesso|resultado)\s+(?:certo|certa|certos|certas|garantido|garantida|garantidos|garantidas)\b/i,
    rule: 'PROMESSA_VITORIA',
    reason: 'Promessa de resultado proibida pela OAB',
  },
  {
    regex: /\b100\s*%\s+(?:de\s+)?(?:vitoria|vitória|sucesso|chance|garantia|aprovacao|aprovação|aproveitamento)/i,
    rule: 'CEM_PORCENTO_PROMESSA',
    reason: 'Promessa absoluta proibida pela OAB',
  },
  {
    regex: /\b(?:os?|as?)\s+(?:melhores?|maiores?|top|n[uú]mero\s+1|#?\s*1\b)\s+(?:advogados?|advogadas?|escritorios?|escritórios?|profissionais?)/i,
    rule: 'COMPARACAO_MELHOR',
    reason: 'Comparacao com colegas proibida pela OAB',
  },
  {
    regex: /\bmelhor\s+(?:advogado|advogada|escritorio|escritório)\b/i,
    rule: 'COMPARACAO_MELHOR_ADVOGADO',
    reason: 'Auto-qualificacao "melhor advogado" proibida pela OAB',
  },
  {
    regex: /\b(?:imbat[ií]vel|invenc[ií]vel|infal[ií]vel|sem\s+perder)\b/i,
    rule: 'PROMESSA_ABSOLUTA',
    reason: 'Promessa absoluta proibida pela OAB',
  },
  {
    regex: /\brecupere\s+at[eé]\s+r\$/i,
    rule: 'RECUPERACAO_ESPECIFICA',
    reason: 'Promessa de valor especifico proibida pela OAB',
  },
  {
    regex: /\bganhe\s+(?:certo|garantido|garantida|com\s+certeza)/i,
    rule: 'GANHE_GARANTIDO',
    reason: 'Promessa de ganho proibida pela OAB',
  },
  {
    regex: /\b(?:50|60|70|80|90|100)\s*%\s+(?:de\s+)?(?:desconto|off|graça|grátis|gratis)/i,
    rule: 'DESCONTO_MERCANTIL',
    reason: 'Mercantilizacao do servico advocaticio (Codigo de Etica OAB)',
  },
  {
    regex: /\b(?:depoimento|testemunho|recomendaç[aã]o)\s+(?:de\s+)?(?:cliente|clientes?|usu[aá]rios?)/i,
    rule: 'TESTEMUNHO',
    reason: 'Testemunhos de clientes proibidos pela OAB',
  },
  {
    regex: /(?:cliente|clientes?)\s+(?:satisfeit[oa]s?|aprovad[oa]s?|recuperad[oa]s?)\s*[:!.,]/i,
    rule: 'TESTEMUNHO_INDIRETO',
    reason: 'Testemunhos de clientes proibidos pela OAB',
  },
  {
    regex: /\b(?:sucesso|vitoria|vitória)\s+em\s+\d+\s*%/i,
    rule: 'TAXA_DE_SUCESSO',
    reason: 'Divulgacao de taxa de sucesso proibida pela OAB',
  },
  {
    regex: /\bganha(?:m|mos)?\s+(?:sempre|todos\s+os\s+casos)\b/i,
    rule: 'GANHA_SEMPRE',
    reason: 'Promessa de resultado proibida pela OAB',
  },
];

/**
 * Padroes de aviso (WARN) — nao bloqueiam mas sinalizam tom inadequado.
 */
const WARN_PATTERNS: Array<{ regex: RegExp; rule: string; reason: string }> = [
  {
    regex: /[!]{2,}/,
    rule: 'PONTUACAO_EXCESSIVA',
    reason: 'Multiplos pontos de exclamacao — tom mercantil',
  },
  {
    regex: /\b(?:ULTIMA|ÚLTIMA)\s+CHANCE\b/i,
    rule: 'URGENCIA_EXAGERADA',
    reason: 'Urgencia mercantil exagerada — tom inadequado para advocacia',
  },
  {
    regex: /\b(?:CORRA|CLIQUE\s+J[AÁ]|N[AÃ]O\s+PERCA|APROVEITE\s+J[AÁ])\b/i,
    rule: 'CTA_AGRESSIVO',
    reason: 'CTA com urgencia mercantil — tom inadequado para advocacia',
  },
  {
    regex: /\b(?:GR[AÁ]TIS|FREE)\b/i,
    rule: 'CONSULTA_GRATIS',
    reason: 'Verificar se enquadra como captacao indevida (consulta gratis OK se de qualificaçao)',
  },
];

/**
 * Regex pra detectar mencao OAB no texto. Aceita formatos:
 *  - "OAB/AL 12345"
 *  - "OAB AL 12345"
 *  - "OAB/AL: 12345"
 *  - "OAB-AL 12345"
 *  - "OAB AL N 12345"
 */
const OAB_MENTION_REGEX = /\bOAB[\s/\-:]?\s*[A-Z]{2}[\s\d:./N]*\d{2,}/i;

/**
 * Valida um texto unico (1 headline, 1 description, etc).
 */
export function validateText(text: string, field?: string): OABViolation[] {
  const violations: OABViolation[] = [];
  if (!text) return violations;

  for (const p of FORBIDDEN_PATTERNS) {
    const m = text.match(p.regex);
    if (m) {
      violations.push({
        rule: p.rule,
        severity: 'BLOCK',
        match: m[0],
        field,
        reason: p.reason,
      });
    }
  }

  for (const p of WARN_PATTERNS) {
    const m = text.match(p.regex);
    if (m) {
      violations.push({
        rule: p.rule,
        severity: 'WARN',
        match: m[0],
        field,
        reason: p.reason,
      });
    }
  }

  return violations;
}

/**
 * Valida um array de textos (ex: headlines de RSA). Cada item gera violations
 * com field='headlines[i]'.
 */
export function validateTextArray(texts: string[], fieldPrefix: string): OABViolation[] {
  const violations: OABViolation[] = [];
  texts.forEach((text, i) => {
    violations.push(...validateText(text, `${fieldPrefix}[${i}]`));
  });
  return violations;
}

/**
 * Verifica se algum texto do array tem mencao OAB.
 * Necessario em pelo menos 1 lugar (headline OU description OU business_name).
 */
export function hasOABMention(texts: string[]): boolean {
  return texts.some((text) => OAB_MENTION_REGEX.test(text));
}

/**
 * Validacao de RSA (Responsive Search Ad). Bloqueia se:
 *  - Qualquer headline ou description tiver violation BLOCK.
 *  - Nenhum texto contiver mencao OAB (a menos que oab_in_business_name=true).
 */
export type AdContent = {
  headlines: string[];
  descriptions: string[];
  /// Quando true, OAB ja esta no business_name asset — nao precisa estar nos headlines/descriptions.
  oab_in_business_name?: boolean;
  /// Final URL — validado superficialmente (deve ser https).
  final_url?: string;
};

export function validateAd(content: AdContent): OABValidationResult {
  const violations: OABViolation[] = [];

  violations.push(...validateTextArray(content.headlines, 'headlines'));
  violations.push(...validateTextArray(content.descriptions, 'descriptions'));

  // OAB obrigatorio em pelo menos 1 ponto
  if (!content.oab_in_business_name) {
    const allTexts = [...content.headlines, ...content.descriptions];
    if (!hasOABMention(allTexts)) {
      violations.push({
        rule: 'OAB_NUMBER_MISSING',
        severity: 'BLOCK',
        match: '',
        reason:
          'Numero da OAB nao encontrado em headlines/descriptions. Provimento 205/2021 exige identificacao do escritorio em todo anuncio (use formato "OAB/UF 12345" ou inclua no business_name).',
      });
    }
  }

  if (content.final_url && !/^https:/i.test(content.final_url)) {
    violations.push({
      rule: 'FINAL_URL_NOT_HTTPS',
      severity: 'WARN',
      match: content.final_url,
      field: 'final_url',
      reason: 'Final URL deve ser HTTPS',
    });
  }

  const blockingViolations = violations.filter((v) => v.severity === 'BLOCK');
  return {
    ok: blockingViolations.length === 0,
    violations,
  };
}

/**
 * Validacao de keyword text antes de adicionar.
 * Bloqueia keywords que tenham termos comparativos.
 */
export function validateKeyword(text: string): OABValidationResult {
  const violations = validateText(text, 'keyword');
  const blocking = violations.filter((v) => v.severity === 'BLOCK');
  return {
    ok: blocking.length === 0,
    violations,
  };
}

/**
 * Helper pra renderizar violations em mensagem human-friendly (PT-BR).
 */
export function formatViolations(violations: OABViolation[]): string {
  if (violations.length === 0) return 'Sem violacoes.';
  return violations
    .map((v) => {
      const tag = v.severity === 'BLOCK' ? '[BLOQUEIO]' : '[AVISO]';
      const where = v.field ? ` (${v.field})` : '';
      const matched = v.match ? `: "${v.match}"` : '';
      return `${tag}${where} ${v.rule}${matched} — ${v.reason}`;
    })
    .join('\n');
}
