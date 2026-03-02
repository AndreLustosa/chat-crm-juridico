'use client';

import { useState, useRef, useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import api from '@/lib/api';

const ACTIONS = [
  { key: 'corrigir', label: 'Corrigir ortografia', icon: '✏️' },
  { key: 'formalizar', label: 'Formalizar texto', icon: '🎩' },
  { key: 'profissional', label: 'Tom profissional', icon: '💼' },
  { key: 'resumir', label: 'Resumir', icon: '📝' },
  { key: 'simplificar', label: 'Simplificar', icon: '✨' },
];

interface Props {
  text: string;
  onResult: (result: string) => void;
  disabled?: boolean;
  compact?: boolean;
}

export function SophIAButton({ text, onResult, disabled, compact }: Props) {
  const [open, setOpen] = useState(false);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const handleAction = async (action: string) => {
    if (!text.trim() || loadingAction) return;
    setLoadingAction(action);
    try {
      const res = await api.post('/messages/ai-correct', { text, action });
      onResult(res.data.result);
      setOpen(false);
    } catch (e) {
      console.error('Erro ao processar com SophIA', e);
    } finally {
      setLoadingAction(null);
    }
  };

  const isLoading = !!loadingAction;
  const hasText = !!text.trim();

  return (
    <div className="relative shrink-0" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        disabled={disabled || !hasText}
        title="SophIA — Assistente de Escrita"
        className={compact
          ? `p-1.5 rounded-lg transition-colors flex items-center ${
              open ? 'text-violet-400' : 'text-muted-foreground hover:text-violet-400 hover:bg-violet-500/10'
            } disabled:opacity-40 disabled:cursor-not-allowed`
          : `px-3 py-3 rounded-xl border transition-colors flex items-center gap-1.5 text-xs font-semibold ${
              open
                ? 'text-violet-400 border-violet-500/40 bg-violet-500/10'
                : 'text-muted-foreground border-border bg-card hover:text-violet-400 hover:border-violet-500/40 hover:bg-violet-500/10'
            } disabled:opacity-40 disabled:cursor-not-allowed`
        }
      >
        {isLoading ? (
          <div className={`border-2 border-violet-400 border-t-transparent rounded-full animate-spin ${compact ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />
        ) : (
          <Sparkles size={compact ? 16 : 15} />
        )}
        {!compact && <span>SophIA</span>}
      </button>

      {open && (
        <div className="absolute bottom-14 left-0 z-50 w-52 bg-card border border-border rounded-2xl shadow-2xl overflow-hidden py-1">
          <div className="px-3 py-2 border-b border-border mb-0.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles size={10} className="text-violet-400" />
              SophIA · Assistente IA
            </p>
          </div>
          {ACTIONS.map(action => (
            <button
              key={action.key}
              onClick={() => handleAction(action.key)}
              disabled={isLoading}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left hover:bg-muted/60 transition-colors disabled:opacity-50"
            >
              <span className="text-base leading-none">{action.icon}</span>
              <span className="flex-1">{action.label}</span>
              {loadingAction === action.key && (
                <div className="w-3.5 h-3.5 border-2 border-violet-400 border-t-transparent rounded-full animate-spin shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
