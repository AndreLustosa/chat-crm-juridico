// Permissoes granulares por escritorio (RBAC editavel).
//
// CAPABILITIES sao "areas" do sistema. A matriz padrao (papel -> capacidades)
// ESPELHA o comportamento atual; sem nenhum override, nada muda. ADMIN tem tudo
// sempre (nao editavel, anti-lockout).

export const CAPABILITIES = [
  'atendimento',
  'contatos',
  'processos_ver',
  'processos_editar',
  'financeiro',
  'analytics',
  'configuracoes',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

// Papeis editaveis na matriz (ADMIN fica de fora — sempre tem tudo).
export const EDITABLE_ROLES = ['ADVOGADO', 'COMERCIAL', 'ESTAGIARIO', 'FINANCEIRO'] as const;
export type EditableRole = (typeof EDITABLE_ROLES)[number];

// Matriz PADRAO (espelha os @Roles + roles.ts de hoje). ADMIN tratado a parte.
export const DEFAULT_MATRIX: Record<EditableRole, Capability[]> = {
  ADVOGADO: ['atendimento', 'contatos', 'processos_ver', 'processos_editar', 'financeiro'],
  COMERCIAL: ['atendimento', 'contatos'],
  ESTAGIARIO: ['atendimento', 'contatos', 'processos_ver'],
  FINANCEIRO: ['contatos', 'financeiro'],
};

// Capacidades realmente CHECADAS no backend (CapabilityGuard). `contatos` fica
// de fora de proposito: GET /leads e aberto a qualquer autenticado (busca global,
// agenda, financeiro) — gatear quebraria esses fluxos; `contatos` so esconde o
// menu no front. `cockpit` e sempre on.
export const BACKEND_ENFORCED: ReadonlySet<Capability> = new Set<Capability>([
  'atendimento',
  'processos_ver',
  'processos_editar',
  'financeiro',
  'analytics',
  'configuracoes',
]);

/** Normaliza papel cru do JWT para a chave da matriz (OPERADOR -> COMERCIAL). */
export function normalizeRole(raw: string): EditableRole | 'ADMIN' | null {
  const r = (raw ?? '').trim().toUpperCase();
  if (r === 'ADMIN') return 'ADMIN';
  if (r === 'OPERADOR' || r === 'COMERCIAL') return 'COMERCIAL';
  return (EDITABLE_ROLES as readonly string[]).includes(r) ? (r as EditableRole) : null;
}

export function isCapability(v: string): v is Capability {
  return (CAPABILITIES as readonly string[]).includes(v);
}
export function isEditableRole(v: string): v is EditableRole {
  return (EDITABLE_ROLES as readonly string[]).includes(v);
}
