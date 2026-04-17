'use client';

import { useEffect, useState, useCallback } from 'react';
import { Loader2, RefreshCw, AlertCircle } from 'lucide-react';
import api from '@/lib/api';

interface MediaLoadingStateProps {
  messageId: string;
  type: 'audio' | 'image' | 'video' | 'document';
  isOutgoing?: boolean;
}

const TYPE_LABELS = {
  audio: { loading: 'Baixando áudio...', failed: 'Áudio indisponível', expired: 'Áudio expirado no WhatsApp', emoji: '🎵' },
  image: { loading: 'Baixando imagem...', failed: 'Imagem indisponível', expired: 'Imagem expirada no WhatsApp', emoji: '🖼️' },
  video: { loading: 'Baixando vídeo...',  failed: 'Vídeo indisponível',  expired: 'Vídeo expirado no WhatsApp',  emoji: '🎬' },
  document: { loading: 'Baixando documento...', failed: 'Documento indisponível', expired: 'Documento expirado no WhatsApp', emoji: '📄' },
} as const;

/**
 * Estado de carregamento/erro de mídia recebida.
 * Após 10s sem a mídia chegar, mostra botão "Recarregar" manual.
 */
export function MediaLoadingState({ messageId, type, isOutgoing }: MediaLoadingStateProps) {
  const [showRetry, setShowRetry] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<'failed' | 'expired' | null>(null);
  const labels = TYPE_LABELS[type];

  // Após 10s sem chegar, mostra botão recarregar
  useEffect(() => {
    const timer = setTimeout(() => setShowRetry(true), 10_000);
    return () => clearTimeout(timer);
  }, []);

  const handleRetry = useCallback(async () => {
    setRetrying(true);
    setError(null);
    try {
      await api.post(`/media/${messageId}/retry`);
      // Sucesso → messageUpdate via socket vai hidratar o componente
      // (ele será remontado com msg.media populada)
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 410) {
        setError('expired');
      } else {
        setError('failed');
      }
    } finally {
      setRetrying(false);
    }
  }, [messageId]);

  const mutedColor = isOutgoing ? 'text-white/60' : 'text-muted-foreground';
  const linkColor = isOutgoing ? 'text-white/80 hover:text-white' : 'text-primary/80 hover:text-primary';

  // Estado de erro (retry falhou)
  if (error) {
    return (
      <div className={`flex items-start gap-2 text-[12px] ${mutedColor} min-w-[200px]`}>
        <AlertCircle size={13} className="shrink-0 mt-0.5 text-red-400" />
        <div>
          <p>{error === 'expired' ? labels.expired : labels.failed}</p>
          {error === 'failed' && (
            <button
              onClick={handleRetry}
              className={`mt-1 inline-flex items-center gap-1 text-[11px] underline ${linkColor}`}
            >
              <RefreshCw size={10} />
              Tentar novamente
            </button>
          )}
        </div>
      </div>
    );
  }

  // Estado de retry em andamento
  if (retrying) {
    return (
      <div className={`flex items-center gap-2 text-[12px] ${mutedColor}`}>
        <Loader2 size={13} className="animate-spin shrink-0" />
        <span>Recarregando...</span>
      </div>
    );
  }

  // Estado inicial: baixando (com botão Recarregar após 10s)
  return (
    <div className={`flex items-center gap-2 text-[12px] ${mutedColor}`}>
      <Loader2 size={13} className="animate-spin shrink-0" />
      <span>{labels.loading}</span>
      {showRetry && (
        <button
          onClick={handleRetry}
          className={`ml-1 inline-flex items-center gap-1 text-[11px] underline ${linkColor}`}
          title="A mídia está demorando — clique para tentar novamente"
        >
          <RefreshCw size={10} />
          Recarregar
        </button>
      )}
    </div>
  );
}
