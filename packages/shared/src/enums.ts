// ─── Conversation Status ────────────────────────────────────────────────────
export const ConversationStatus = {
  ABERTO: 'ABERTO',
  FECHADO: 'FECHADO',
} as const;
export type ConversationStatus = (typeof ConversationStatus)[keyof typeof ConversationStatus];

// Status derivado no frontend (calculado a partir de ai_mode / assigned_user_id)
export const ConversationDisplayStatus = {
  BOT: 'BOT',
  ACTIVE: 'ACTIVE',
  WAITING: 'WAITING',
  CLOSED: 'CLOSED',
} as const;
export type ConversationDisplayStatus = (typeof ConversationDisplayStatus)[keyof typeof ConversationDisplayStatus];

// ─── Lead Stage ─────────────────────────────────────────────────────────────
export const LeadStage = {
  NOVO: 'NOVO',
  QUALIFICADO: 'QUALIFICADO',
  REUNIAO: 'REUNIAO',
  CONTRATO: 'CONTRATO',
  FECHADO_GANHO: 'FECHADO_GANHO',
  PERDIDO: 'PERDIDO',
} as const;
export type LeadStage = (typeof LeadStage)[keyof typeof LeadStage];

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  NOVO: 'Novo',
  QUALIFICADO: 'Qualificado',
  REUNIAO: 'Reunião',
  CONTRATO: 'Contrato',
  FECHADO_GANHO: 'Fechado (Ganho)',
  PERDIDO: 'Perdido',
};

// ─── Legal Case Stage ───────────────────────────────────────────────────────
export const LegalCaseStage = {
  VIABILIDADE: 'VIABILIDADE',
  DOCUMENTACAO: 'DOCUMENTACAO',
  ELABORACAO: 'ELABORACAO',
  REVISAO: 'REVISAO',
  PROTOCOLADO: 'PROTOCOLADO',
  ARQUIVADO: 'ARQUIVADO',
} as const;
export type LegalCaseStage = (typeof LegalCaseStage)[keyof typeof LegalCaseStage];

export const LEGAL_CASE_STAGE_LABELS: Record<LegalCaseStage, string> = {
  VIABILIDADE: 'Viabilidade',
  DOCUMENTACAO: 'Documentação',
  ELABORACAO: 'Elaboração',
  REVISAO: 'Revisão',
  PROTOCOLADO: 'Protocolado',
  ARQUIVADO: 'Arquivado',
};

// ─── Task Status ────────────────────────────────────────────────────────────
export const TaskStatus = {
  A_FAZER: 'A_FAZER',
  EM_ANDAMENTO: 'EM_ANDAMENTO',
  CONCLUIDA: 'CONCLUIDA',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

// ─── Message Direction ──────────────────────────────────────────────────────
export const MessageDirection = {
  IN: 'in',
  OUT: 'out',
} as const;
export type MessageDirection = (typeof MessageDirection)[keyof typeof MessageDirection];

// ─── User Role ──────────────────────────────────────────────────────────────
export const UserRole = {
  ADMIN: 'ADMIN',
  OPERATOR: 'OPERATOR',
  LAWYER: 'LAWYER',
  INTERN: 'INTERN',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];
