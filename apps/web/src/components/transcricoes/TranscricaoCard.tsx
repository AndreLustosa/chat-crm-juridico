'use client';

import {
  Loader2, Play, Trash2, RefreshCw, AlertCircle, CheckCircle2, Clock as ClockIcon,
  Briefcase, Unlink, Cpu, Cloud,
} from 'lucide-react';
import type { TranscricaoListItem } from './types';
import { STATUS_META, formatSize, formatDuration, formatDate, PROVIDER_META } from './types';

interface Props {
  item: TranscricaoListItem;
  onOpen: () => void;
  onDelete: () => void;
  onRetry: () => void;
  /** Mostrar badge com processo/cliente vinculado. True no modo global. */
  showLink?: boolean;
}

export function TranscricaoCard({ item, onOpen, onDelete, onRetry, showLink }: Props) {
  const meta = STATUS_META[item.status];
  const done = item.status === 'DONE';
  const error = item.status === 'ERROR';
  const linked = !!item.legal_case_id;

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-accent/10 hover:bg-accent/20 transition">
      <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${done ? 'bg-emerald-500/10' : error ? 'bg-red-500/10' : 'bg-violet-500/10'}`}>
        {done ? <CheckCircle2 className="h-5 w-5 text-emerald-400" /> :
         error ? <AlertCircle className="h-5 w-5 text-red-400" /> :
         <Loader2 className="h-5 w-5 animate-spin text-violet-400" />}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <button
            onClick={done ? onOpen : undefined}
            disabled={!done}
            className={`truncate text-sm font-medium text-base-content ${done ? 'hover:underline cursor-pointer' : 'cursor-default'}`}
            title={item.title}
          >
            {item.title}
          </button>
          <span className={`text-xs ${meta.color}`}>{meta.label}</span>
          {showLink && (
            linked ? (
              <span
                className="inline-flex items-center gap-1 text-xs text-primary bg-primary/10 rounded-full px-2 py-0.5"
                title={item.legal_case?.case_number || ''}
              >
                <Briefcase className="h-3 w-3" />
                {item.legal_case?.lead?.name || item.legal_case?.case_number || 'Processo'}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs text-base-content/50 bg-accent/30 rounded-full px-2 py-0.5">
                <Unlink className="h-3 w-3" /> Avulsa
              </span>
            )
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-base-content/50 mt-0.5">
          <span>{formatSize(item.source_size)}</span>
          {item.duration_sec && (
            <span className="flex items-center gap-1">
              <ClockIcon className="h-3 w-3" />{formatDuration(item.duration_sec)}
            </span>
          )}
          <span>{formatDate(item.created_at)}</span>
          {item.uploaded_by && <span>por {item.uploaded_by.name}</span>}
          {item.provider && (
            <span
              className={`inline-flex items-center gap-1 ${PROVIDER_META[item.provider]?.color || 'text-base-content/40'}`}
              title={`Provider: ${item.provider}`}
            >
              {item.provider === 'groq' ? <Cloud className="h-3 w-3" /> : <Cpu className="h-3 w-3" />}
              {PROVIDER_META[item.provider]?.label || item.provider}
            </span>
          )}
        </div>
        {!done && !error && (
          <div className="mt-2 w-full bg-accent/30 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-violet-500 h-full transition-all"
              style={{ width: `${item.progress}%` }}
            />
          </div>
        )}
        {error && item.error_message && (
          <p className="text-xs text-red-400 mt-1 line-clamp-2">{item.error_message}</p>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {done && (
          <button onClick={onOpen} className="btn btn-ghost btn-xs gap-1" title="Abrir">
            <Play className="h-3.5 w-3.5" /> Abrir
          </button>
        )}
        {error && (
          <button onClick={onRetry} className="btn btn-ghost btn-xs gap-1" title="Reprocessar">
            <RefreshCw className="h-3.5 w-3.5" /> Reprocessar
          </button>
        )}
        <button
          onClick={onDelete}
          className="btn btn-ghost btn-xs text-red-400 hover:bg-red-500/10"
          title="Deletar"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
