/**
 * Persistência local (localStorage) de views salvas, colunas visíveis e ordenação
 * da tabela de Processos. Fase 1a — sem DB, tudo no navegador do usuário.
 */

import type { ProcessosFilters } from './ProcessosFilterDrawer';

// ─── Tipos serializáveis ─────────────────────────────────────

export interface SavedView {
  id: string;
  name: string;
  filters: SerializedFilters;
  createdAt: string;
}

interface SerializedFilters {
  search: string;
  areas: string[];
  priorities: string[];
  lawyerIds: string[];
  trackingStages: string[];
  court: string;
  nextDeadlineDays: number | null;
  withoutMovementDays: number | null;
}

export type SortField =
  | 'priority'
  | 'lead'
  | 'area'
  | 'stage'
  | 'days'
  | 'updated'
  | 'claim_value'
  | 'next_deadline';

export type SortDir = 'asc' | 'desc';

export interface TableColumnsState {
  priority: boolean;
  lead: boolean;
  case_number: boolean;
  area: boolean;
  court: boolean;
  lawyer: boolean;
  stage: boolean;
  days: boolean;
  tasks: boolean;
  djen: boolean;
  updated: boolean;
  claim_value: boolean;
  next_deadline: boolean;
}

export const DEFAULT_COLUMNS: TableColumnsState = {
  priority: true,
  lead: true,
  case_number: true,
  area: true,
  court: true,
  lawyer: true,
  stage: true,
  days: true,
  tasks: true,
  djen: true,
  updated: true,
  claim_value: false,
  next_deadline: false,
};

export const COLUMN_LABELS: Record<keyof TableColumnsState, string> = {
  priority: 'Prior.',
  lead: 'Cliente',
  case_number: 'Nº Processo',
  area: 'Área',
  court: 'Vara',
  lawyer: 'Advogado',
  stage: 'Etapa',
  days: 'Dias',
  tasks: 'Tarefas',
  djen: 'DJEN',
  updated: 'Atualizado',
  claim_value: 'Valor',
  next_deadline: 'Próx. prazo',
};

// ─── Chaves ──────────────────────────────────────────────────

const K_VIEWS = 'processos.savedViews.v1';
const K_COLUMNS = 'processos.tableColumns.v1';
const K_SORT = 'processos.tableSort.v1';

// ─── Filtros → serializável ──────────────────────────────────

export const serializeFilters = (f: ProcessosFilters): SerializedFilters => ({
  search: f.search,
  areas: Array.from(f.areas),
  priorities: Array.from(f.priorities),
  lawyerIds: Array.from(f.lawyerIds),
  trackingStages: Array.from(f.trackingStages),
  court: f.court,
  nextDeadlineDays: f.nextDeadlineDays,
  withoutMovementDays: f.withoutMovementDays,
});

export const deserializeFilters = (s: SerializedFilters): ProcessosFilters => ({
  search: s.search || '',
  areas: new Set(s.areas || []),
  priorities: new Set(s.priorities || []),
  lawyerIds: new Set(s.lawyerIds || []),
  trackingStages: new Set(s.trackingStages || []),
  court: s.court || '',
  nextDeadlineDays: s.nextDeadlineDays ?? null,
  withoutMovementDays: s.withoutMovementDays ?? null,
});

// ─── Views salvas ────────────────────────────────────────────

export const loadSavedViews = (): SavedView[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(K_VIEWS);
    return raw ? (JSON.parse(raw) as SavedView[]) : [];
  } catch {
    return [];
  }
};

export const persistSavedViews = (views: SavedView[]) => {
  try {
    window.localStorage.setItem(K_VIEWS, JSON.stringify(views));
  } catch {}
};

// ─── Colunas visíveis ────────────────────────────────────────

export const loadColumns = (): TableColumnsState => {
  if (typeof window === 'undefined') return DEFAULT_COLUMNS;
  try {
    const raw = window.localStorage.getItem(K_COLUMNS);
    if (!raw) return DEFAULT_COLUMNS;
    return { ...DEFAULT_COLUMNS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_COLUMNS;
  }
};

export const persistColumns = (cols: TableColumnsState) => {
  try {
    window.localStorage.setItem(K_COLUMNS, JSON.stringify(cols));
  } catch {}
};

// ─── Ordenação ───────────────────────────────────────────────

export interface SortState {
  field: SortField;
  dir: SortDir;
}

export const loadSort = (): SortState => {
  if (typeof window === 'undefined') return { field: 'days', dir: 'desc' };
  try {
    const raw = window.localStorage.getItem(K_SORT);
    if (!raw) return { field: 'days', dir: 'desc' };
    return JSON.parse(raw);
  } catch {
    return { field: 'days', dir: 'desc' };
  }
};

export const persistSort = (s: SortState) => {
  try {
    window.localStorage.setItem(K_SORT, JSON.stringify(s));
  } catch {}
};
