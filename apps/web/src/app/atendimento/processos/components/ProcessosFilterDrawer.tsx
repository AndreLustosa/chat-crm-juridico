'use client';

import { X, RotateCcw, Save } from 'lucide-react';
import { TRACKING_STAGES } from '@/lib/legalStages';

// ─── Tipos compartilhados ────────────────────────────────────

export interface ProcessosFilters {
  search: string;
  areas: Set<string>;
  priorities: Set<string>;
  lawyerIds: Set<string>;
  trackingStages: Set<string>;
  court: string;
  nextDeadlineDays: number | null;    // 7 | 15 | 30 | null
  withoutMovementDays: number | null; // 15 | 30 | 60 | null
}

export const emptyFilters = (): ProcessosFilters => ({
  search: '',
  areas: new Set(),
  priorities: new Set(),
  lawyerIds: new Set(),
  trackingStages: new Set(),
  court: '',
  nextDeadlineDays: null,
  withoutMovementDays: null,
});

export const countActiveFilters = (f: ProcessosFilters): number => {
  let n = 0;
  if (f.search.trim()) n++;
  n += f.areas.size;
  n += f.priorities.size;
  n += f.lawyerIds.size;
  n += f.trackingStages.size;
  if (f.court.trim()) n++;
  if (f.nextDeadlineDays !== null) n++;
  if (f.withoutMovementDays !== null) n++;
  return n;
};

// ─── Drawer ──────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  filters: ProcessosFilters;
  onChange: (f: ProcessosFilters) => void;
  availableAreas: string[];
  availableLawyers: Array<{ id: string; name: string | null }>;
  onClear: () => void;
  onSaveView: () => void;
}

export function ProcessosFilterDrawer({
  open,
  onClose,
  filters,
  onChange,
  availableAreas,
  availableLawyers,
  onClear,
  onSaveView,
}: Props) {
  if (!open) return null;

  const toggleIn = <T,>(set: Set<T>, value: T): Set<T> => {
    const n = new Set(set);
    if (n.has(value)) n.delete(value);
    else n.add(value);
    return n;
  };

  const patch = (p: Partial<ProcessosFilters>) => onChange({ ...filters, ...p });

  const labelCls = 'text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5 block';
  const chipCls = (active: boolean) =>
    `text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all cursor-pointer ${
      active
        ? 'bg-primary/15 border-primary/40 text-primary'
        : 'bg-card border-border text-muted-foreground hover:border-primary/30'
    }`;

  return (
    <div className="fixed inset-0 z-[150] flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" />
      <div
        className="relative w-full max-w-sm bg-card border-l border-border h-full flex flex-col animate-in slide-in-from-right duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-bold text-foreground">Filtros avançados</h2>
            <p className="text-[11px] text-muted-foreground">Refine a lista de processos</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 custom-scrollbar">
          {/* Prioridade */}
          <div>
            <label className={labelCls}>Prioridade</label>
            <div className="flex flex-wrap gap-1.5">
              {['URGENTE', 'NORMAL', 'BAIXA'].map(p => (
                <button
                  key={p}
                  onClick={() => patch({ priorities: toggleIn(filters.priorities, p) })}
                  className={chipCls(filters.priorities.has(p))}
                >
                  {p === 'URGENTE' ? '🔴 Urgente' : p === 'NORMAL' ? '🟡 Normal' : '⬜ Baixa'}
                </button>
              ))}
            </div>
          </div>

          {/* Área jurídica */}
          {availableAreas.length > 0 && (
            <div>
              <label className={labelCls}>Área jurídica</label>
              <div className="flex flex-wrap gap-1.5">
                {availableAreas.map(a => (
                  <button
                    key={a}
                    onClick={() => patch({ areas: toggleIn(filters.areas, a) })}
                    className={chipCls(filters.areas.has(a))}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Advogado */}
          {availableLawyers.length > 0 && (
            <div>
              <label className={labelCls}>Advogado responsável</label>
              <div className="flex flex-wrap gap-1.5">
                {availableLawyers.map(l => (
                  <button
                    key={l.id}
                    onClick={() => patch({ lawyerIds: toggleIn(filters.lawyerIds, l.id) })}
                    className={chipCls(filters.lawyerIds.has(l.id))}
                  >
                    {l.name || '—'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Etapa do processo */}
          <div>
            <label className={labelCls}>Etapa processual</label>
            <div className="flex flex-wrap gap-1.5">
              {TRACKING_STAGES.map(s => (
                <button
                  key={s.id}
                  onClick={() => patch({ trackingStages: toggleIn(filters.trackingStages, s.id) })}
                  className={chipCls(filters.trackingStages.has(s.id))}
                >
                  {s.emoji} {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Vara */}
          <div>
            <label className={labelCls}>Vara / Comarca</label>
            <input
              type="text"
              value={filters.court}
              onChange={e => patch({ court: e.target.value })}
              placeholder="Ex: 10ª Vara Cível de Arapiraca"
              className="w-full px-3 py-2 text-[12px] bg-accent/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>

          {/* Próximo prazo */}
          <div>
            <label className={labelCls}>Próximo prazo/audiência em</label>
            <div className="flex flex-wrap gap-1.5">
              {[
                { value: 7, label: '7 dias' },
                { value: 15, label: '15 dias' },
                { value: 30, label: '30 dias' },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() =>
                    patch({ nextDeadlineDays: filters.nextDeadlineDays === opt.value ? null : opt.value })
                  }
                  className={chipCls(filters.nextDeadlineDays === opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Sem movimentação há */}
          <div>
            <label className={labelCls}>Sem movimentação há mais de</label>
            <div className="flex flex-wrap gap-1.5">
              {[
                { value: 15, label: '15 dias' },
                { value: 30, label: '30 dias' },
                { value: 60, label: '60 dias' },
                { value: 90, label: '90 dias' },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() =>
                    patch({ withoutMovementDays: filters.withoutMovementDays === opt.value ? null : opt.value })
                  }
                  className={chipCls(filters.withoutMovementDays === opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex items-center justify-between gap-2 shrink-0">
          <button
            onClick={onClear}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-all"
          >
            <RotateCcw size={12} /> Limpar tudo
          </button>
          <button
            onClick={onSaveView}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-primary/10 text-primary hover:bg-primary/20 rounded-lg transition-all"
            disabled={countActiveFilters(filters) === 0}
          >
            <Save size={12} /> Salvar como view
          </button>
        </div>
      </div>
    </div>
  );
}
