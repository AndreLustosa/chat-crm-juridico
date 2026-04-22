export const CRM_STAGES = [
  { id: 'QUALIFICANDO',     label: 'Qualificando',              color: '#3b82f6', emoji: '🔍' },
  { id: 'AGUARDANDO_FORM',  label: 'Aguardando formulário',     color: '#f59e0b', emoji: '📋' },
  { id: 'REUNIAO_AGENDADA', label: 'Reunião agendada',          color: '#8b5cf6', emoji: '📅' },
  { id: 'AGUARDANDO_DOCS',  label: 'Aguardando documentos',     color: '#f97316', emoji: '📄' },
  { id: 'AGUARDANDO_PROC',  label: 'Aguardando proc./contrato', color: '#d97706', emoji: '✍️' },
  { id: 'FINALIZADO',       label: 'Finalizado',                color: '#10b981', emoji: '✅' },
  { id: 'PERDIDO',          label: 'Perdido',                   color: '#ef4444', emoji: '❌' },
] as const;

export type CrmStageId = typeof CRM_STAGES[number]['id'];

/** Retorna o stage pelo ID, ou "QUALIFICANDO" (primeira coluna) se não encontrado */
export function findStage(id: string | null | undefined) {
  return CRM_STAGES.find(s => s.id === id) ?? CRM_STAGES[0];
}

/**
 * Normaliza stages legados para QUALIFICANDO (ponto de entrada unificado).
 * Leads antigos no banco com stage 'NOVO', 'INICIAL', 'CONTATADO', etc. sao
 * mapeados transparentemente — a migration SQL opcional atualiza os dados,
 * mas o frontend ja funciona mesmo sem ela.
 */
export function normalizeStage(stage: string | null | undefined): string {
  if (!stage) return 'QUALIFICANDO';
  const known = CRM_STAGES.find(s => s.id === stage);
  if (known) return known.id;
  // Legado: mapeia valores antigos para stages atuais
  const legacyMap: Record<string, string> = {
    // Ponto de entrada unificado em QUALIFICANDO
    NOVO: 'QUALIFICANDO', NEW: 'QUALIFICANDO',
    INICIAL: 'QUALIFICANDO',
    CONTATADO: 'QUALIFICANDO', CONTACTED: 'QUALIFICANDO',
    QUALIFICADO: 'QUALIFICANDO', QUALIFIED: 'QUALIFICANDO',
    EM_ATENDIMENTO: 'QUALIFICANDO',
    // Stages que representam "caso ja existente" → FINALIZADO
    PROCESSO_ATIVO: 'FINALIZADO',     // cliente com processo em andamento
    ENCERRADO: 'FINALIZADO',           // alias antigo de FINALIZADO
    GANHO: 'FINALIZADO', WON: 'FINALIZADO',
    // Proposta/contratação em andamento → formulario
    PROPOSTA: 'AGUARDANDO_FORM', PROPOSAL: 'AGUARDANDO_FORM',
  };
  return legacyMap[stage.toUpperCase()] ?? 'QUALIFICANDO';
}
