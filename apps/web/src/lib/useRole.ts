'use client';

import { useMemo } from 'react';

export type AppRole = 'ADMIN' | 'ADVOGADO' | 'OPERADOR' | 'COMERCIAL' | 'ESTAGIARIO' | 'FINANCEIRO';

export interface RoleInfo {
  role: AppRole | null;       // Primeiro role (backward compat)
  roles: AppRole[];           // Todos os roles do usuário
  userId: string | null;
  isAdmin: boolean;
  isAdvogado: boolean;
  isOperador: boolean;
  isComercial: boolean;
  isEstagiario: boolean;
  isFinanceiro: boolean;
  canManageLegalCases: boolean;  // criar, editar, arquivar processos
  canViewLegalCases: boolean;    // visualizar processos
  canManageSettings: boolean;    // configurações do sistema
  canViewDashboard: boolean;     // dashboard
  canViewAnalytics: boolean;     // analytics/marketing
  canViewDjen: boolean;          // publicações DJEN
  canViewFinanceiro: boolean;    // módulo financeiro
  canViewAdvogado: boolean;      // triagem e peticionamento
}

/** Lê os roles do JWT salvo no localStorage e retorna helpers de permissão. */
export function useRole(): RoleInfo {
  return useMemo(() => {
    if (typeof window === 'undefined') return buildInfo([], null);
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        console.warn('[useRole] Sem token no localStorage — roles=[]');
        return buildInfo([], null);
      }
      // JWT base64url → base64 standard para atob()
      const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(b64));
      // Backward compat: tokens antigos têm 'role' (string), novos têm 'roles' (array)
      const roles: string[] = Array.isArray(payload?.roles)
        ? payload.roles
        : (payload?.role ? [payload.role] : []);
      if (roles.length === 0) {
        console.warn('[useRole] Token decodificado mas sem roles:', payload);
      }
      return buildInfo(roles as AppRole[], payload?.sub ?? null);
    } catch (e) {
      console.error('[useRole] ERRO ao decodificar token:', e);
      return buildInfo([], null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function buildInfo(roles: AppRole[], userId: string | null): RoleInfo {
  const has = (allowed: AppRole[]) => roles.some(r => allowed.includes(r));

  return {
    role: roles[0] || null,  // Backward compat: primeiro role
    roles,
    userId,
    isAdmin: roles.includes('ADMIN'),
    isAdvogado: roles.includes('ADVOGADO'),
    isOperador: roles.includes('OPERADOR') || roles.includes('COMERCIAL'),
    isComercial: roles.includes('COMERCIAL'),
    isEstagiario: roles.includes('ESTAGIARIO'),
    isFinanceiro: roles.includes('FINANCEIRO'),
    canManageLegalCases: has(['ADMIN', 'ADVOGADO']),
    canViewLegalCases: has(['ADMIN', 'ADVOGADO']),
    canManageSettings: roles.includes('ADMIN'),
    canViewDashboard: has(['ADMIN', 'ADVOGADO', 'OPERADOR', 'COMERCIAL']),
    canViewAnalytics: has(['ADMIN']),
    canViewDjen: has(['ADMIN', 'ADVOGADO']),
    canViewFinanceiro: has(['ADMIN', 'FINANCEIRO', 'ADVOGADO']),
    canViewAdvogado: has(['ADMIN', 'ADVOGADO']),
  };
}
