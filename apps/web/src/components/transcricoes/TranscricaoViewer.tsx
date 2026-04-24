'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, ArrowLeft, Pencil, Check, X, Download, ChevronDown,
} from 'lucide-react';
import api, { API_BASE_URL } from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';
import type { Segment, SpeakerLabel, TranscricaoDetail } from './types';
import { SPEAKER_PALETTE, formatDuration, formatTimestamp } from './types';

interface Props {
  id: string;
  onBack: () => void;
}

/**
 * Viewer fullscreen de uma transcrição pronta:
 *  - player MP4 à esquerda
 *  - texto à direita com cada segmento clicável (pula vídeo pro tempo)
 *  - segmento ativo destacado + auto-scroll
 *  - falantes coloridos + rename inline
 *  - export TXT/SRT/VTT
 *
 * Usado tanto na aba Transcrições do processo quanto no menu Ferramentas.
 */
export function TranscricaoViewer({ id, onBack }: Props) {
  const [data, setData] = useState<TranscricaoDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [speakers, setSpeakers] = useState<SpeakerLabel[]>([]);
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const textContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get(`/transcriptions/${id}`);
        setData(r.data);
        setSpeakers(r.data.speakers_json || []);
      } catch (e: any) {
        showError(e?.response?.data?.message || 'Erro ao carregar');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const speakerMap = useMemo(() => {
    const m = new Map<string, SpeakerLabel>();
    speakers.forEach((s) => m.set(s.id, s));
    return m;
  }, [speakers]);

  const segments: Segment[] = data?.segments_json || [];
  const activeIdx = useMemo(() => {
    return segments.findIndex(
      (s) => currentTime >= s.start && currentTime <= s.end,
    );
  }, [segments, currentTime]);

  useEffect(() => {
    if (activeIdx < 0 || !textContainerRef.current) return;
    const el = textContainerRef.current.querySelector(`[data-idx="${activeIdx}"]`);
    if (el) (el as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeIdx]);

  const jumpTo = (sec: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = sec;
      videoRef.current.play().catch(() => {});
    }
  };

  const saveSpeakerLabel = async (speakerId: string, newLabel: string) => {
    if (!data) return;
    const updated = speakers.map((s) =>
      s.id === speakerId ? { ...s, label: newLabel.trim() || s.id } : s,
    );
    setSpeakers(updated);
    setEditingSpeaker(null);
    try {
      await api.patch(`/transcriptions/${id}/speakers`, { speakers: updated });
      showSuccess('Falante renomeado');
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao renomear');
    }
  };

  const exportAs = (format: 'txt' | 'srt' | 'vtt') => {
    const url = `${API_BASE_URL}/transcriptions/${id}/export/${format}`;
    const token = localStorage.getItem('access_token') || '';
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const dlUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = dlUrl;
        a.download = `${(data?.title || 'transcricao').replace(/[^\w.-]+/g, '_')}.${format}`;
        a.click();
        URL.revokeObjectURL(dlUrl);
      })
      .catch(() => showError('Erro ao baixar'));
  };

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const videoUrl = `${API_BASE_URL}/transcriptions/${id}/video`;
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') || '' : '';

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border flex items-center gap-3">
        <button onClick={onBack} className="btn btn-ghost btn-sm gap-1">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-base-content truncate">{data.title}</h2>
          <div className="flex items-center gap-3 text-xs text-base-content/50 mt-0.5">
            <span>{formatDuration(data.duration_sec)}</span>
            <span>{speakers.length} falantes</span>
            <span>{data.model || 'whisper-large-v3'}</span>
            <span>{data.language}</span>
          </div>
        </div>
        <div className="dropdown dropdown-end">
          <button tabIndex={0} className="btn btn-sm gap-1">
            <Download className="h-4 w-4" /> Exportar <ChevronDown className="h-3 w-3" />
          </button>
          <ul tabIndex={0} className="dropdown-content menu bg-base-200 rounded-box w-36 shadow z-10">
            <li><button onClick={() => exportAs('txt')}>TXT</button></li>
            <li><button onClick={() => exportAs('srt')}>SRT (legendas)</button></li>
            <li><button onClick={() => exportAs('vtt')}>VTT (web)</button></li>
          </ul>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 p-4 min-h-0">
        <div className="flex flex-col min-h-0">
          <div className="bg-black rounded-lg overflow-hidden aspect-video">
            {/* Streaming nativo: <video src> faz Range requests automaticamente,
                tocar enquanto baixa, sem carregar o arquivo inteiro em RAM.
                Token vai na query (JwtStrategy aceita via fromUrlQueryParameter). */}
            <video
              ref={videoRef}
              src={`${videoUrl}?token=${encodeURIComponent(token)}`}
              controls
              preload="metadata"
              onTimeUpdate={(e) => setCurrentTime((e.target as HTMLVideoElement).currentTime)}
              className="h-full w-full"
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {speakers.map((s, idx) => {
              const editing = editingSpeaker === s.id;
              const color = s.color || SPEAKER_PALETTE[idx % SPEAKER_PALETTE.length];
              return (
                <div key={s.id} className="flex items-center gap-2 bg-accent/30 rounded-full px-3 py-1">
                  <div
                    className="h-3 w-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  {editing ? (
                    <div className="flex items-center gap-1">
                      <input
                        className="input input-xs input-bordered w-28 text-xs"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveSpeakerLabel(s.id, editValue);
                          if (e.key === 'Escape') setEditingSpeaker(null);
                        }}
                        autoFocus
                      />
                      <button onClick={() => saveSpeakerLabel(s.id, editValue)} className="text-emerald-400">
                        <Check className="h-3 w-3" />
                      </button>
                      <button onClick={() => setEditingSpeaker(null)} className="text-red-400">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="text-xs text-base-content">{s.label}</span>
                      <button
                        onClick={() => { setEditingSpeaker(s.id); setEditValue(s.label); }}
                        className="text-base-content/40 hover:text-base-content"
                        title="Renomear"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div ref={textContainerRef} className="overflow-y-auto border border-border rounded-lg p-4 bg-accent/5">
          {segments.map((seg, idx) => {
            const speaker = seg.speaker ? speakerMap.get(seg.speaker) : null;
            const color = speaker?.color || '#9CA3AF';
            const label = speaker?.label || seg.speaker || '';
            const isActive = idx === activeIdx;
            return (
              <button
                key={idx}
                data-idx={idx}
                onClick={() => jumpTo(seg.start)}
                className={`block w-full text-left rounded-md p-2 mb-1 transition ${
                  isActive ? 'bg-primary/20 ring-1 ring-primary/40' : 'hover:bg-accent/20'
                }`}
              >
                <div className="flex items-center gap-2 text-xs">
                  {label && (
                    <span className="font-medium" style={{ color }}>
                      {label}
                    </span>
                  )}
                  <span className="text-base-content/40 font-mono">
                    {formatTimestamp(seg.start)}
                  </span>
                </div>
                <p className="text-sm text-base-content mt-0.5 leading-relaxed">
                  {seg.text}
                </p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

