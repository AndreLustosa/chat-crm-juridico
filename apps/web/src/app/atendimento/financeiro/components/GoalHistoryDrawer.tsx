'use client';

/**
 * Drawer lateral que mostra o historico de versoes de uma meta.
 * Cada linha = 1 versao (ativa ou soft-deleted) com valor, quem criou, quando.
 *
 * Acessivel da tela de Gestao via botao "Historico" em cada linha da tabela.
 * Backend: GET /financeiro/goals/history/:scope/:kind/:year/:month
 */

import { useEffect, useState } from 'react';
import { X, Clock, User, Loader2, History } from 'lucide-react';
import api from '@/lib/api';
import { showError } from '@/lib/toast';

interface GoalVersion {
  id: string;
  value: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  createdBy: { id: string; name: string } | null;
}

interface GoalHistoryDrawerProps {
  scope: 'OFFICE' | string;
  kind: 'REALIZED' | 'CONTRACTED';
  year: number;
  month: number;
  /** Label legivel pra contexto (ex: "Abril/2026 — Escritório, Realizada") */
  contextLabel: string;
  onClose: () => void;
}

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 }).format(v || 0);

const fmtDateTime = (iso: string) => {
  const dt = new Date(iso);
  const date = `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
  const time = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
  return `${date} ${time}`;
};

export default function GoalHistoryDrawer({
  scope, kind, year, month, contextLabel, onClose,
}: GoalHistoryDrawerProps) {
  const [versions, setVersions] = useState<GoalVersion[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .get(`/financeiro/goals/history/${scope}/${kind}/${year}/${month}`)
      .then((r) => setVersions(r.data))
      .catch((e: any) => {
        showError(e?.response?.data?.message || 'Erro ao carregar histórico');
        setVersions([]);
      })
      .finally(() => setLoading(false));
  }, [scope, kind, year, month]);

  // ESC fecha
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/50">
      <div className="bg-card border-l border-border shadow-xl w-full max-w-md flex flex-col">
        {/* Header */}
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History size={16} className="text-purple-400" />
            <div>
              <h3 className="text-sm font-bold text-foreground">Histórico de versões</h3>
              <p className="text-[10px] text-muted-foreground">{contextLabel}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-accent/30 text-muted-foreground hover:text-foreground"
            title="Fechar (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading && (
            <div className="flex items-center justify-center h-32">
              <Loader2 size={16} className="animate-spin text-muted-foreground" />
            </div>
          )}

          {!loading && versions && versions.length === 0 && (
            <div className="text-center text-xs text-muted-foreground py-8">
              Nenhuma versão registrada.
            </div>
          )}

          {!loading && versions && versions.length > 0 && (
            <ol className="space-y-2.5">
              {versions.map((v, i) => (
                <li
                  key={v.id}
                  className={`relative pl-5 pb-2 ${
                    i < versions.length - 1 ? 'border-l-2 border-border ml-1.5' : ''
                  }`}
                >
                  {/* Bullet */}
                  <span
                    className={`absolute left-0 top-1 w-3 h-3 rounded-full border-2 ${
                      v.isActive
                        ? 'bg-emerald-400 border-emerald-400'
                        : 'bg-muted border-muted-foreground'
                    } ${i < versions.length - 1 ? '-ml-1.5' : '-ml-1.5'}`}
                  />

                  <div className="text-xs">
                    <div className="flex items-center gap-2">
                      <span
                        className={`font-bold tabular-nums ${
                          v.isActive ? 'text-foreground' : 'text-muted-foreground line-through'
                        }`}
                      >
                        {fmt(v.value)}
                      </span>
                      {v.isActive && (
                        <span className="text-[9px] font-semibold uppercase tracking-wide bg-emerald-500/15 text-emerald-400 rounded px-1.5 py-0.5">
                          Atual
                        </span>
                      )}
                      {!v.isActive && (
                        <span className="text-[9px] font-semibold uppercase tracking-wide bg-muted/40 text-muted-foreground rounded px-1.5 py-0.5">
                          Sobrescrita
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-0.5">
                      <Clock size={10} />
                      <span>Criada em {fmtDateTime(v.createdAt)}</span>
                    </div>

                    {v.createdBy && (
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-0.5">
                        <User size={10} />
                        <span>por {v.createdBy.name}</span>
                      </div>
                    )}

                    {v.deletedAt && (
                      <div className="text-[10px] text-muted-foreground/70 mt-0.5">
                        Sobrescrita em {fmtDateTime(v.deletedAt)}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
