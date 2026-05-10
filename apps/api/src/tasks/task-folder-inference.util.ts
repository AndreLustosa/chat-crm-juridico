/**
 * Sugestao automatica de pasta CaseDocument baseada no titulo da Task.
 *
 * Bug fix 2026-05-10 (PR3 baixo #9): extraido de tasks.service.ts pra
 * facilitar adicionar novas categorias / testar / ler. Acerta ~80% dos
 * casos comuns; estagiario pode trocar manualmente no UI.
 *
 * Calibrado em titulos reais do escritorio:
 *   "Pegar comprovante de residencia" → CLIENTE
 *   "Buscar RG/CPF do cliente" → CLIENTE
 *   "Imprimir contrato de honorarios" → CONTRATOS
 *   "Anexar procuracao assinada" → PROCURACOES
 *   "Baixar decisao do TJ" → DECISOES
 */

export const VALID_FOLDERS = new Set([
  'CLIENTE', 'PROVAS', 'CONTRATOS', 'PETICOES',
  'DECISOES', 'PROCURACOES', 'OUTROS',
]);

type FolderRule = { regex: RegExp; folder: string };

// Tabela de regras — ordem importa (primeiro match vence). Adicionar
// novas categorias eh acrescentar 1 entrada aqui sem tocar service.
const FOLDER_RULES: FolderRule[] = [
  { regex: /\b(rg|cpf|comprovante|endere[cç]o|cnh|carteira|identidade)\b/, folder: 'CLIENTE' },
  { regex: /\b(contrato|honor[aá]rio|honorarios)\b/, folder: 'CONTRATOS' },
  { regex: /\b(procura[cç][aã]o|procuracao)\b/, folder: 'PROCURACOES' },
  { regex: /\b(decis[aã]o|senten[cç]a|ac[oó]rd[aã]o|despacho)\b/, folder: 'DECISOES' },
  { regex: /\b(prova|laudo|per[ií]cia|testemunho)\b/, folder: 'PROVAS' },
  { regex: /\b(peti[cç][aã]o|peticao)\b/, folder: 'PETICOES' },
];

export function inferFolder(title: string): string {
  const t = (title || '').toLowerCase();
  for (const rule of FOLDER_RULES) {
    if (rule.regex.test(t)) return rule.folder;
  }
  return 'OUTROS';
}
