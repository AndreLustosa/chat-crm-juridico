import type { RoleInfo } from '@/lib/useRole';

export type SectionId = 'geral' | 'advogados' | 'comercial' | 'financeiro' | 'estagiarios';

export type Scope = 'comercial' | 'juridico' | 'financeiro' | 'estagiarios';

/** Quais seções cada papel pode ver. */
export function visibleSections(role: RoleInfo): SectionId[] {
  if (role.isAdmin) {
    return ['geral', 'advogados', 'comercial', 'financeiro', 'estagiarios'];
  }
  if (role.isAdvogado) {
    return ['advogados', 'comercial', 'financeiro', 'estagiarios'];
  }
  if (role.isComercial || role.isOperador) {
    return ['comercial'];
  }
  if (role.isFinanceiro) {
    return ['financeiro'];
  }
  if (role.isEstagiario) {
    return ['estagiarios'];
  }
  return [];
}

/**
 * Escopo a ser aplicado nas chamadas de API para cada seção, por papel.
 * Backend interpreta o scope + papel do requisitante para aplicar filtros extra
 * (ex: advogado em scope=financeiro filtra por lawyer_id = self).
 */
export function scopeForSection(id: SectionId, role: RoleInfo): Scope | undefined {
  if (id === 'geral') return undefined; // visão consolidada
  if (id === 'advogados') return 'juridico';
  if (id === 'comercial') return 'comercial';
  if (id === 'financeiro') return 'financeiro';
  if (id === 'estagiarios') return 'estagiarios';
  return undefined;
}

export const SECTION_META: Record<SectionId, { title: string; subtitle: string }> = {
  geral: {
    title: 'Visão Geral',
    subtitle: 'KPIs consolidados do escritório',
  },
  advogados: {
    title: 'Advogados',
    subtitle: 'Processos, prazos e publicações',
  },
  comercial: {
    title: 'Comercial',
    subtitle: 'Leads, conversão e atendimento',
  },
  financeiro: {
    title: 'Financeiro',
    subtitle: 'Receita, recebimentos e aging',
  },
  estagiarios: {
    title: 'Estagiários',
    subtitle: 'Tarefas e produtividade',
  },
};
