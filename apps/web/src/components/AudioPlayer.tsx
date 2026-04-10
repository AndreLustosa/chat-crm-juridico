'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Play, Pause, Download, AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import api from '@/lib/api';

const SPEEDS = [1, 1.5, 2];

// Cache de blobs por messageId — compartilhado entre todos os AudioPlayers da sessão.
// Permite que handlers de newMessage pré-busquem o áudio antes de exibir no chat.
const audioBlobCache = new Map<string, string>();

/**
 * Pré-busca o áudio e armazena no cache. Retorna true se bem-sucedido.
 * Deve ser chamado pelo handler de newMessage antes de adicionar ao state.
 */
export async function preFetchAudio(messageId: string, timeout = 8000): Promise<boolean> {
  if (audioBlobCache.has(messageId)) return true;
  const url = `/api/media/${messageId}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return false;
    const rawBlob = await res.blob();
    const blob = rawBlob.type.startsWith('audio/') ? rawBlob : new Blob([rawBlob], { type: 'audio/ogg' });
    audioBlobCache.set(messageId, URL.createObjectURL(blob));
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

interface AudioPlayerProps {
  src: string;
  duration?: number | null;
  isOutgoing?: boolean;
  messageId?: string; // ID da mensagem para retry de download
}

export function AudioPlayer({ src, duration, isOutgoing, messageId }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(duration || 0);
  const [speedIdx, setSpeedIdx] = useState(0);
  // Inicializa com blob do cache se já pré-buscado (exibição instantânea)
  const [blobUrl, setBlobUrl] = useState<string | null>(
    messageId ? (audioBlobCache.get(messageId) ?? null) : null
  );
  const [loading, setLoading] = useState(!messageId || !audioBlobCache.has(messageId));
  const [error, setError] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [fetchKey, setFetchKey] = useState(0); // increment to re-trigger fetch

  const fmt = (secs: number) => {
    const s = Math.floor(secs || 0);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  // Retry manual: re-enfileira download no backend e tenta buscar novamente
  const handleRetryDownload = useCallback(async () => {
    if (!messageId) return;
    setRetrying(true);
    setError(false);
    try {
      await api.post(`/media/${messageId}/retry`);
      // Aguarda o worker processar (3-5s) e tenta buscar o áudio de novo
      setTimeout(() => {
        setFetchKey(k => k + 1); // triggers useEffect re-fetch (retryCount resets via new closure)
        setRetrying(false);
      }, 4000);
    } catch {
      setError(true);
      setRetrying(false);
    }
  }, [messageId]);

  // Buscar audio como blob para evitar problemas de streaming/proxy
  useEffect(() => {
    // Se já temos blob do cache (pré-buscado), não busca de novo
    if (messageId && audioBlobCache.has(messageId) && fetchKey === 0) return;

    let cancelled = false;
    let retryCount = 0;
    const fetchAudio = async () => {
      setLoading(true);
      setError(false);
      try {
        const res = await fetch(src);
        if (!res.ok) {
          // Media pode nao estar pronta (fallback BullMQ processando) — retry
          if (res.status === 404 && retryCount < 3) {
            retryCount++;
            // Backoff progressivo: 3s, 4s, 5s
            const delay = Math.min(3000 + retryCount * 1000, 5000);
            setTimeout(() => { if (!cancelled) fetchAudio(); }, delay);
            return;
          }
          throw new Error(`HTTP ${res.status}`);
        }
        const rawBlob = await res.blob();
        if (cancelled) return;
        // Forçar tipo audio/ogg quando Content-Type vier errado (ex: application/octet-stream)
        const blob = rawBlob.type.startsWith('audio/') ? rawBlob : new Blob([rawBlob], { type: 'audio/ogg' });
        const url = URL.createObjectURL(blob);
        setBlobUrl(url);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchAudio();
    return () => { cancelled = true; };
  }, [src, fetchKey]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [blobUrl]);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a || !blobUrl) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      a.play().then(() => setPlaying(true)).catch(() => setError(true));
    }
  }, [playing, blobUrl]);

  const cycleSpeed = useCallback(() => {
    const next = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(next);
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[next];
  }, [speedIdx]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setCurrent(a.currentTime);
    const onLoad = () => {
      const d = a.duration;
      if (d && isFinite(d) && d > 0) setTotal(d);
    };
    const onEnd = () => { setPlaying(false); setCurrent(0); };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onLoad);
    a.addEventListener('canplaythrough', onLoad);
    a.addEventListener('ended', onEnd);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onLoad);
      a.removeEventListener('canplaythrough', onLoad);
      a.removeEventListener('ended', onEnd);
    };
  }, [blobUrl]);

  const progress = total > 0 ? (current / total) * 100 : 0;
  const speed = SPEEDS[speedIdx];

  const btnClass = isOutgoing
    ? 'bg-white/20 hover:bg-white/30 text-white'
    : 'bg-primary/10 hover:bg-primary/20 text-primary';
  const barBg = isOutgoing ? 'bg-white/30' : 'bg-primary/20';
  const barFill = isOutgoing ? 'bg-white' : 'bg-primary';
  const timeClass = isOutgoing ? 'text-white/60' : 'text-muted-foreground';
  const speedClass = isOutgoing
    ? 'text-white/80 hover:bg-white/20'
    : 'text-primary/80 hover:bg-primary/10';

  // Loading state
  if (loading && !blobUrl) {
    return (
      <div className="flex items-center gap-3 min-w-[200px] max-w-[300px]">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${btnClass}`}>
          <Loader2 size={15} className="animate-spin" />
        </div>
        <div className="flex-1 flex flex-col gap-1.5">
          <div className={`h-1.5 rounded-full ${barBg} animate-pulse`} />
          <span className={`text-[10px] ${timeClass}`}>Carregando...</span>
        </div>
      </div>
    );
  }

  // Loading retry state (after manual retry)
  if (retrying) {
    return (
      <div className="flex items-center gap-3 min-w-[200px] max-w-[300px]">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${btnClass}`}>
          <Loader2 size={15} className="animate-spin" />
        </div>
        <div className="flex-1 flex flex-col gap-1.5">
          <div className={`h-1.5 rounded-full ${barBg} animate-pulse`} />
          <span className={`text-[10px] ${timeClass}`}>Re-baixando audio...</span>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex items-center gap-3 min-w-[200px] max-w-[300px]">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${btnClass} opacity-50`}>
          <AlertCircle size={15} />
        </div>
        <div className="flex-1">
          <span className={`text-[10px] ${timeClass}`}>Audio indisponivel</span>
          <div className="flex items-center gap-2 mt-0.5">
            {messageId && (
              <button
                onClick={handleRetryDownload}
                className={`flex items-center gap-1 text-[10px] underline ${speedClass}`}
              >
                <RefreshCw size={10} />
                Tentar novamente
              </button>
            )}
            <a
              href={`${src}?dl=1`}
              download="audio.ogg"
              className={`text-[10px] underline ${speedClass}`}
            >
              Baixar
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 min-w-[200px] max-w-[300px]">
      {blobUrl && <audio ref={audioRef} src={blobUrl} preload="auto" />}
      <button
        onClick={toggle}
        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-colors ${btnClass}`}
        title={playing ? 'Pausar' : 'Reproduzir'}
      >
        {playing ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
      </button>
      <div className="flex-1 flex flex-col gap-1.5">
        <div
          className={`h-1.5 rounded-full cursor-pointer ${barBg}`}
          onClick={(e) => {
            if (!audioRef.current || !total) return;
            const rect = e.currentTarget.getBoundingClientRect();
            audioRef.current.currentTime = ((e.clientX - rect.left) / rect.width) * total;
          }}
        >
          <div
            className={`h-full rounded-full transition-[width] duration-100 ${barFill}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex items-center justify-between">
          <span className={`text-[10px] ${timeClass}`}>
            {fmt(current)} / {total > 0 ? fmt(total) : '--:--'}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={cycleSpeed}
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded transition-colors ${speedClass}`}
              title="Velocidade de reproducao"
            >
              {speed === 1 ? '1x' : `${speed}x`}
            </button>
            <a
              href={`${src}?dl=1`}
              download="audio.ogg"
              className={`p-0.5 rounded transition-colors ${speedClass}`}
              title="Baixar audio"
            >
              <Download size={11} />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
