'use client';

/**
 * Barra horizontal de impression share (0-100%) com cor por faixa:
 *   <25% vermelho — perdendo demanda significativa
 *   25-50% amarelo — espaço pra crescer
 *   >=50% verde — boa cobertura
 *
 * Quando `share === null`, mostra "—" (fora de cobertura SEARCH ou sem dados).
 */
export function ImpressionShareBar({
  share,
}: {
  share: number | null;
}) {
  if (share === null || share === undefined) {
    return (
      <span className="text-[11px] text-muted-foreground" title="Sem dados ou campanha não-Search">
        —
      </span>
    );
  }
  const pct = Math.max(0, Math.min(100, share * 100));
  const barColor =
    pct >= 50 ? 'bg-emerald-500' : pct >= 25 ? 'bg-amber-500' : 'bg-red-500';
  const textColor =
    pct >= 50
      ? 'text-emerald-700 dark:text-emerald-400'
      : pct >= 25
        ? 'text-amber-700 dark:text-amber-400'
        : 'text-red-700 dark:text-red-400';

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden min-w-[40px]">
        <div
          className={`h-full transition-all ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-[11px] font-bold tabular-nums ${textColor}`}>
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}

/**
 * Barra de saúde da campanha — segmenta visualmente os 3 buckets:
 *   verde   = onde aparece (impression_share)
 *   amarelo = perdido por orçamento (lost_is_budget)
 *   vermelho= perdido por qualidade/rank (lost_is_rank)
 *   cinza   = restante desconhecido (1 - soma dos 3)
 */
export function ImpressionShareSegmentedBar({
  share,
  lostBudget,
  lostRank,
}: {
  share: number | null;
  lostBudget: number | null;
  lostRank: number | null;
}) {
  const s = Math.max(0, Math.min(1, share ?? 0));
  const lb = Math.max(0, Math.min(1, lostBudget ?? 0));
  const lr = Math.max(0, Math.min(1, lostRank ?? 0));
  const total = s + lb + lr;
  // Se as 3 ultrapassam 1 (raro — Google às vezes arredonda em ±0.01),
  // normaliza pra somar exatamente 100%.
  const norm = total > 1 ? 1 / total : 1;
  const sPct = s * norm * 100;
  const lbPct = lb * norm * 100;
  const lrPct = lr * norm * 100;
  const unkPct = Math.max(0, 100 - sPct - lbPct - lrPct);

  if (share === null && lostBudget === null && lostRank === null) {
    return (
      <div className="bg-muted/30 rounded-lg p-4 text-center text-xs text-muted-foreground">
        Sem dados de impression share — esta campanha pode não ser tipo
        Search ou ainda não tem volume suficiente.
      </div>
    );
  }

  return (
    <div>
      <div className="flex h-3 rounded-full overflow-hidden bg-muted">
        {sPct > 0 && (
          <div
            className="bg-emerald-500 transition-all"
            style={{ width: `${sPct}%` }}
            title={`Aparece: ${sPct.toFixed(0)}%`}
          />
        )}
        {lbPct > 0 && (
          <div
            className="bg-amber-500 transition-all"
            style={{ width: `${lbPct}%` }}
            title={`Perdido por orçamento: ${lbPct.toFixed(0)}%`}
          />
        )}
        {lrPct > 0 && (
          <div
            className="bg-red-500 transition-all"
            style={{ width: `${lrPct}%` }}
            title={`Perdido por qualidade: ${lrPct.toFixed(0)}%`}
          />
        )}
        {unkPct > 0 && (
          <div
            className="bg-muted-foreground/20 transition-all"
            style={{ width: `${unkPct}%` }}
            title={`Indeterminado: ${unkPct.toFixed(0)}%`}
          />
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-[11px]">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded bg-emerald-500" />
          <span className="text-muted-foreground">
            Aparece:{' '}
            <strong className="text-foreground">{sPct.toFixed(0)}%</strong>
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded bg-amber-500" />
          <span className="text-muted-foreground">
            Perde budget:{' '}
            <strong className="text-foreground">{lbPct.toFixed(0)}%</strong>
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded bg-red-500" />
          <span className="text-muted-foreground">
            Perde qualidade:{' '}
            <strong className="text-foreground">{lrPct.toFixed(0)}%</strong>
          </span>
        </div>
        {unkPct > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded bg-muted-foreground/40" />
            <span className="text-muted-foreground">
              Outros:{' '}
              <strong className="text-foreground">{unkPct.toFixed(0)}%</strong>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
