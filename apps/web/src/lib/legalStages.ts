// Stages do menu "Advogado" (Preparação — até o protocolo)
export const LEGAL_STAGES = [
  { id: 'VIABILIDADE',   label: 'Viabilidade',     color: '#6366f1', emoji: '🔎' },
  { id: 'DOCUMENTACAO',  label: 'Documentação',    color: '#f59e0b', emoji: '📑' },
  { id: 'PETICAO',       label: 'Petição Inicial', color: '#3b82f6', emoji: '📝' },
  { id: 'REVISAO',       label: 'Revisão',         color: '#8b5cf6', emoji: '🔍' },
  { id: 'PROTOCOLO',     label: 'Protocolo',       color: '#ec4899', emoji: '🏛️' },
] as const;

// Stages do menu "Processos" (Acompanhamento — pós-protocolo)
export const TRACKING_STAGES = [
  { id: 'DISTRIBUIDO',  label: 'Distribuído',          color: '#6366f1', emoji: '📬' },
  { id: 'CITACAO',      label: 'Citação/Intimação',    color: '#f59e0b', emoji: '📩' },
  { id: 'CONTESTACAO',  label: 'Contestação',          color: '#3b82f6', emoji: '🛡️' },
  { id: 'REPLICA',      label: 'Réplica',              color: '#06b6d4', emoji: '↩️' },
  { id: 'INSTRUCAO',    label: 'Audiência/Instrução',  color: '#8b5cf6', emoji: '🎙️' },
  { id: 'JULGAMENTO',   label: 'Julgamento/Sentença',  color: '#ec4899', emoji: '⚖️' },
  { id: 'RECURSO',      label: 'Recurso',              color: '#f97316', emoji: '📜' },
  { id: 'TRANSITADO',   label: 'Trânsito em Julgado',  color: '#10b981', emoji: '✅' },
  { id: 'EXECUCAO',     label: 'Execução',             color: '#06b6d4', emoji: '🔨' },
  { id: 'ENCERRADO',    label: 'Encerrado',            color: '#6b7280', emoji: '🗂️' },
] as const;

export type LegalStageId    = typeof LEGAL_STAGES[number]['id'];
export type TrackingStageId = typeof TRACKING_STAGES[number]['id'];

/** Retorna o stage pelo ID, ou VIABILIDADE se não encontrado */
export function findLegalStage(id: string | null | undefined) {
  return LEGAL_STAGES.find(s => s.id === id) ?? LEGAL_STAGES[0];
}

/** Retorna o tracking stage pelo ID, ou DISTRIBUIDO se não encontrado */
export function findTrackingStage(id: string | null | undefined) {
  return TRACKING_STAGES.find(s => s.id === id) ?? TRACKING_STAGES[0];
}
