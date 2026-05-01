'use client';

import { ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight } from 'lucide-react';

/**
 * Controle de paginação client-side reusável.
 *
 * Convenção: páginas indexadas a partir de 1 (1, 2, 3...). Total = total
 * de itens (não páginas). Renderiza:
 *   ┌──────────────────────────────────────────────────────┐
 *   │ Mostrando 21-30 de 153    « ‹ 1 2 [3] 4 5 ... 16 › » │
 *   └──────────────────────────────────────────────────────┘
 *
 * Esconde-se sozinho quando total <= pageSize (não há nada pra paginar).
 *
 * Hook companion `usePagination(items, pageSize)` em SearchTermsCard etc
 * mantém o slice + reset automático quando filtros mudam.
 */
export function Pagination({
  total,
  pageSize,
  currentPage,
  onPageChange,
  itemLabel = 'item',
}: {
  total: number;
  pageSize: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  /** ex: "termo", "keyword", "alerta" — vira plural automático */
  itemLabel?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;

  // Clamp current
  const page = Math.max(1, Math.min(totalPages, currentPage));
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);

  // Páginas visíveis: até 7 botões com elipses
  const pages = computePagesShown(page, totalPages);

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 border-t border-border text-xs flex-wrap">
      <span className="text-muted-foreground">
        Mostrando{' '}
        <strong className="text-foreground tabular-nums">{start}</strong>–
        <strong className="text-foreground tabular-nums">{end}</strong> de{' '}
        <strong className="text-foreground tabular-nums">{total}</strong>{' '}
        {itemLabel}
        {total === 1 ? '' : 's'}
      </span>

      <div className="flex items-center gap-0.5">
        <PaginationButton
          disabled={page === 1}
          onClick={() => onPageChange(1)}
          title="Primeira"
        >
          <ChevronsLeft size={14} />
        </PaginationButton>
        <PaginationButton
          disabled={page === 1}
          onClick={() => onPageChange(page - 1)}
          title="Anterior"
        >
          <ChevronLeft size={14} />
        </PaginationButton>

        {pages.map((p, idx) =>
          p === '...' ? (
            <span
              key={`gap-${idx}`}
              className="px-1.5 text-muted-foreground"
            >
              …
            </span>
          ) : (
            <PaginationButton
              key={p}
              active={p === page}
              onClick={() => onPageChange(p as number)}
            >
              {p}
            </PaginationButton>
          ),
        )}

        <PaginationButton
          disabled={page === totalPages}
          onClick={() => onPageChange(page + 1)}
          title="Próxima"
        >
          <ChevronRight size={14} />
        </PaginationButton>
        <PaginationButton
          disabled={page === totalPages}
          onClick={() => onPageChange(totalPages)}
          title="Última"
        >
          <ChevronsRight size={14} />
        </PaginationButton>
      </div>
    </div>
  );
}

function PaginationButton({
  children,
  onClick,
  disabled,
  active,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`min-w-[28px] h-7 px-2 rounded text-xs font-semibold tabular-nums transition-colors ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Calcula até 7 botões: sempre 1 + last, current ± 1, com elipses no meio.
 * Exemplos (current=5, total=20): [1, ..., 4, 5, 6, ..., 20]
 *           (current=2, total=20): [1, 2, 3, 4, ..., 20]
 *           (current=19, total=20): [1, ..., 17, 18, 19, 20]
 *           (current=3, total=5):   [1, 2, 3, 4, 5]
 */
function computePagesShown(
  current: number,
  total: number,
): (number | '...')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const out: (number | '...')[] = [1];
  const left = Math.max(2, current - 1);
  const right = Math.min(total - 1, current + 1);
  if (left > 2) out.push('...');
  for (let i = left; i <= right; i++) out.push(i);
  if (right < total - 1) out.push('...');
  out.push(total);
  return out;
}
