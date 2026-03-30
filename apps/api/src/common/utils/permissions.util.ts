/**
 * Utilitário centralizado de permissões por role.
 * Use estas funções para checagens em services e controllers.
 * Para guards de rota, prefira o decorador @Roles().
 */

export const ROLES = {
  ADMIN: 'ADMIN',
  ADVOGADO: 'ADVOGADO',
  OPERADOR: 'OPERADOR',
  ESTAGIARIO: 'ESTAGIARIO',
} as const;

export type AppRole = (typeof ROLES)[keyof typeof ROLES];

/** Verifica se o role é ADMIN */
export function isAdmin(role: string): boolean {
  return role === ROLES.ADMIN;
}

/** Verifica se pode gerenciar processos (criar, editar, arquivar) */
export function canManageLegalCases(role: string): boolean {
  return [ROLES.ADMIN, ROLES.ADVOGADO].includes(role as AppRole);
}

/** Verifica se pode visualizar processos */
export function canViewLegalCases(role: string): boolean {
  return [ROLES.ADMIN, ROLES.ADVOGADO, ROLES.ESTAGIARIO].includes(role as AppRole);
}

/** Verifica se pode gerenciar leads/clientes */
export function canManageLeads(role: string): boolean {
  return [ROLES.ADMIN, ROLES.ADVOGADO, ROLES.OPERADOR].includes(role as AppRole);
}

/** Verifica se tem acesso ao modo cliente no chat */
export function canViewClients(role: string): boolean {
  return [ROLES.ADMIN, ROLES.ADVOGADO, ROLES.OPERADOR].includes(role as AppRole);
}

/** Verifica se pode gerenciar configurações do sistema */
export function canManageSettings(role: string): boolean {
  return role === ROLES.ADMIN;
}

/** Verifica se pode gerenciar usuários */
export function canManageUsers(role: string): boolean {
  return role === ROLES.ADMIN;
}
