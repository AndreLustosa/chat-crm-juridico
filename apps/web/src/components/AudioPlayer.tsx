'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Play, Pause, Download, AlertCircle, Loader2 } from 'lucide-react';

const SPEEDS = [1, 1.5, 2];

interface AudioPlayerProps {
  src: string;
  duration?: number | null;
  isOutgoing?: boolean;
}

export function AudioPlayer({ src, duration, isOutgoing }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(duration || 0);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const retryCount = useRef(0);

  const fmt = (secs: number) => {
    const s = Math.floor(secs || 0);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  // Buscar audio como blob para evitar problemas de streaming/proxy
  useEffect(() => {
    let cancelled = false;
    const fetchAudio = async () => {
      setLoading(true);
      setError(false);
      try {
        const res = await fetch(src);
        if (!res.ok) {
          // Media pode nao estar pronta ainda (worker processando) — retry
          if (res.status === 404 && retryCount.current < 5) {
            retryCount.current++;
            setTimeout(() => { if (!cancelled) fetchAudio(); }, 3000);
            return;
          }
          throw new Error(`HTTP ${res.status}`);
        }
        const blob = await res.blob();
        if (cancelled) return;
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
  }, [src]);

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

  // Error state
  if (error) {
    return (
      <div className="flex items-center gap-3 min-w-[200px] max-w-[300px]">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${btnClass} opacity-50`}>
          <AlertCircle size={15} />
        </div>
        <div className="flex-1">
          <span className={`text-[10px] ${timeClass}`}>Audio indisponivel</span>
          <a
            href={`${src}?dl=1`}
            download="audio.ogg"
            className={`block text-[10px] mt-0.5 underline ${speedClass}`}
          >
            Tentar baixar
          </a>
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
