export const CRM_STAGES = [
  { id: 'INICIAL',          label: 'Inicial',                   color: '#6b7280', emoji: '👋' },
  { id: 'QUALIFICANDO',     label: 'Qualificando',              color: '#3b82f6', emoji: '🔍' },
  { id: 'AGUARDANDO_FORM',  label: 'Aguardando formulário',     color: '#f59e0b', emoji: '📋' },
  { id: 'REUNIAO_AGENDADA', label: 'Reunião agendada',          color: '#8b5cf6', emoji: '📅' },
  { id: 'AGUARDANDO_DOCS',  label: 'Aguardando documentos',     color: '#f97316', emoji: '📄' },
  { id: 'AGUARDANDO_PROC',  label: 'Aguardando proc./contrato', color: '#d97706', emoji: '✍️' },
  { id: 'FINALIZADO',       label: 'Finalizado',                color: '#10b981', emoji: '✅' },
  { id: 'PERDIDO',          label: 'Perdido',                   color: '#ef4444', emoji: '❌' },
] as const;

export type CrmStageId = typeof CRM_STAGES[number]['id'];

/** Retorna o stage pelo ID, ou "INICIAL" se não encontrado */
export function findStage(id: string | null | undefined) {
  return CRM_STAGES.find(s => s.id === id) ?? CRM_STAGES[0];
}

/** Normaliza stages legados (NOVO, NEW, etc.) para INICIAL */
export function normalizeStage(stage: string | null | undefined): string {
  if (!stage) return 'INICIAL';
  const known = CRM_STAGES.find(s => s.id === stage);
  if (known) return known.id;
  // Legado: mapeia valores antigos
  const legacyMap: Record<string, string> = {
    NOVO: 'INICIAL', NEW: 'INICIAL',
    CONTATADO: 'QUALIFICANDO', CONTACTED: 'QUALIFICANDO',
    QUALIFICADO: 'QUALIFICANDO', QUALIFIED: 'QUALIFICANDO',
    PROPOSTA: 'AGUARDANDO_FORM', PROPOSAL: 'AGUARDANDO_FORM',
    GANHO: 'FINALIZADO', WON: 'FINALIZADO',
  };
  return legacyMap[stage.toUpperCase()] ?? 'INICIAL';
}
