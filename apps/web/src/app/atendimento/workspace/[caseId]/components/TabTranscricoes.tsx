'use client';

import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLines, Upload, Loader2, Play, Trash2, Download, RefreshCw,
  ArrowLeft, Pencil, Check, X, AlertCircle, CheckCircle2, FileAudio,
  ChevronDown, Clock as ClockIcon,
} from 'lucide-react';
import api, { API_BASE_URL } from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

// ─── Tipos ─────────────────────────────────────────────────────────────────

type TranscriptionStatus =
  | 'PENDING'
  | 'UPLOADING'
  | 'CONVERTING'
  | 'TRANSCRIBING'
  | 'DIARIZING'
  | 'DONE'
  | 'ERROR';

interface TranscricaoListItem {
  id: string;
  title: string;
  status: TranscriptionStatus;
  progress: number;
  error_message: string | null;
  provider: string;
  diarize: boolean;
  duration_sec: number | null;
  language: string | null;
  source_size: number;
  video_s3_key: string | null;
  created_at: string;
  finished_at: string | null;
  uploaded_by: { id: string; name: string } | null;
}

interface Segment {
  start: number;
  end: number;
  text: string;
  speaker?: string | null;
}

interface SpeakerLabel {
  id: string;
  label: string;
  color: string;
}

interface TranscricaoDetail extends TranscricaoListItem {
  text: string | null;
  segments_json: Segment[] | null;
  speakers_json: SpeakerLabel[] | null;
  model: string | null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(sec: number | null | undefined) {
  if (!sec || !isFinite(sec)) return '–';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${m}min`;
  if (m > 0) return `${m}min ${s}s`;
  return `${s}s`;
}

function formatTimestamp(sec: number) {
  if (!isFinite(sec)) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

function formatDate(d: string) {
  return new Date(d).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

const STATUS_META: Record<TranscriptionStatus, { label: string; color: string; spinning: boolean }> = {
  PENDING:       { label: 'Na fila',            color: 'text-slate-400',   spinning: true  },
  UPLOADING:     { label: 'Enviando',           color: 'text-blue-400',    spinning: true  },
  CONVERTING:    { label: 'Convertendo vídeo',  color: 'text-cyan-400',    spinning: true  },
  TRANSCRIBING:  { label: 'Transcrevendo',      color: 'text-violet-400',  spinning: true  },
  DIARIZING:     { label: 'Separando falantes', color: 'text-violet-400',  spinning: true  },
  DONE:          { label: 'Pronta',             color: 'text-emerald-400', spinning: false },
  ERROR:         { label: 'Erro',               color: 'text-red-400',     spinning: false },
};

const SPEAKER_PALETTE = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316'];

// ─── Componente principal ─────────────────────────────────────────────────

export default function TabTranscricoes({ caseId }: { caseId: string }) {
  const [items, setItems] = useState<TranscricaoListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchList = useCallback(async () => {
    try {
      const r = await api.get(`/transcriptions?caseId=${caseId}`);
      setItems(r.data);
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao carregar transcrições');
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => { fetchList(); }, [fetchList]);

  // Polling enquanto houver algo em processamento
  useEffect(() => {
    const hasActive = items.some(
      (i) => i.status !== 'DONE' && i.status !== 'ERROR',
    );
    if (!hasActive) return;
    const t = setInterval(fetchList, 8000);
    return () => clearInterval(t);
  }, [items, fetchList]);

  const handleFilePick = () => fileInputRef.current?.click();

  const handleUpload = async (file: File) => {
    setUploading(true);
    setUploadProgress(0);
    const form = new FormData();
    form.append('file', file);
    try {
      await api.post(`/transcriptions?caseId=${caseId}`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (pe) => {
          if (pe.total) setUploadProgress(Math.round((pe.loaded / pe.total) * 100));
        },
      });
      showSuccess('Upload concluído. Transcrição enfileirada.');
      fetchList();
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro no upload');
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Deletar esta transcrição? O vídeo e o texto serão perdidos.')) return;
    try {
      await api.delete(`/transcriptions/${id}`);
      showSuccess('Transcrição deletada');
      fetchList();
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao deletar');
    }
  };

  const handleRetry = async (id: string) => {
    try {
      await api.post(`/transcriptions/${id}/retry`);
      showSuccess('Reenfileirada para processamento');
      fetchList();
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao reprocessar');
    }
  };

  if (selectedId) {
    return (
      <TranscricaoViewer
        id={selectedId}
        onBack={() => { setSelectedId(null); fetchList(); }}
      />
    );
  }

  // ─── Lista ─────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-base-content flex items-center gap-2">
            <AudioLines className="h-5 w-5 text-primary" /> Transcrições de Audiência
          </h2>
          <p className="text-sm text-base-content/60 mt-1">
            Upload de vídeo (ASF/MP4/etc.) → conversão → transcrição com separação de falantes
          </p>
        </div>
        <button
          onClick={handleFilePick}
          disabled={uploading}
          className="btn btn-primary btn-sm gap-2"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {uploading ? `Enviando ${uploadProgress}%` : 'Nova transcrição'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*,audio/*,.asf,.wmv,.mkv,.avi,.mov,.mp4,.webm,.mp3,.wav,.m4a,.ogg"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleUpload(f);
          }}
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-border rounded-lg">
          <AudioLines className="h-10 w-10 mx-auto text-base-content/30" />
          <p className="mt-4 text-base-content/60">Nenhuma transcrição ainda</p>
          <p className="text-sm text-base-content/40 mt-1">
            Arquivos aceitos: ASF, WMV, MP4, MKV, MOV, WEBM, MP3, WAV... (até 3GB)
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((t) => (
            <TranscricaoCard
              key={t.id}
              item={t}
              onOpen={() => setSelectedId(t.id)}
              onDelete={() => handleDelete(t.id)}
              onRetry={() => handleRetry(t.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Card de uma transcrição ──────────────────────────────────────────────

function TranscricaoCard({
  item, onOpen, onDelete, onRetry,
}: {
  item: TranscricaoListItem;
  onOpen: () => void;
  onDelete: () => void;
  onRetry: () => void;
}) {
  const meta = STATUS_META[item.status];
  const done = item.status === 'DONE';
  const error = item.status === 'ERROR';

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-accent/10 hover:bg-accent/20 transition">
      <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${done ? 'bg-emerald-500/10' : error ? 'bg-red-500/10' : 'bg-violet-500/10'}`}>
        {done ? <CheckCircle2 className="h-5 w-5 text-emerald-400" /> :
         error ? <AlertCircle className="h-5 w-5 text-red-400" /> :
         <Loader2 className={`h-5 w-5 animate-spin text-violet-400`} />}
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
        </div>
        <div className="flex items-center gap-3 text-xs text-base-content/50 mt-0.5">
          <span>{formatSize(item.source_size)}</span>
          {item.duration_sec && <span className="flex items-center gap-1"><ClockIcon className="h-3 w-3" />{formatDuration(item.duration_sec)}</span>}
          <span>{formatDate(item.created_at)}</span>
          {item.uploaded_by && <span>por {item.uploaded_by.name}</span>}
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
          <button
            onClick={onOpen}
            className="btn btn-ghost btn-xs gap-1"
            title="Abrir"
          >
            <Play className="h-3.5 w-3.5" /> Abrir
          </button>
        )}
        {error && (
          <button
            onClick={onRetry}
            className="btn btn-ghost btn-xs gap-1"
            title="Reprocessar"
          >
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

// ─── Viewer (player + texto sincronizado) ────────────────────────────────

function TranscricaoViewer({ id, onBack }: { id: string; onBack: () => void }) {
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

  // Auto-scroll pro segmento ativo
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
    // Usamos fetch pra anexar Authorization e baixar como blob
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
      {/* Header */}
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
        <div className="flex items-center gap-1">
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
      </div>

      {/* Split: player | texto */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 p-4 min-h-0">
        {/* Vídeo */}
        <div className="flex flex-col min-h-0">
          <div className="bg-black rounded-lg overflow-hidden aspect-video">
            {/* MediaSource não aceita Authorization header direto; usamos um truque:
                anexar token como query param NÃO funciona pro JwtAuthGuard atual.
                Então fazemos fetch+blob para permitir streaming autenticado. */}
            <AuthenticatedVideo
              ref={videoRef}
              src={videoUrl}
              token={token}
              onTimeUpdate={(e) => setCurrentTime((e.target as HTMLVideoElement).currentTime)}
            />
          </div>

          {/* Legenda de falantes */}
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

        {/* Texto sincronizado */}
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
                    <span
                      className="font-medium"
                      style={{ color }}
                    >
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

// ─── Video com Authorization header ───────────────────────────────────────

/**
 * Baixa o vídeo via fetch autenticado e cria um blob URL.
 * Trade-off: precisa baixar tudo antes de tocar (não faz streaming progressivo).
 * Aceitável pra audiências já convertidas em MP4 faststart.
 */
interface AuthenticatedVideoProps {
  src: string;
  token: string;
  onTimeUpdate?: (e: React.SyntheticEvent<HTMLVideoElement>) => void;
}

const AuthenticatedVideo = forwardRef<HTMLVideoElement, AuthenticatedVideoProps>(
  function AuthenticatedVideo({ src, token, onTimeUpdate }, ref) {
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      let cancelled = false;
      let createdUrl: string | null = null;
      (async () => {
        try {
          const r = await fetch(src, { headers: { Authorization: `Bearer ${token}` } });
          if (!r.ok) throw new Error('fetch video failed');
          const blob = await r.blob();
          if (cancelled) return;
          createdUrl = URL.createObjectURL(blob);
          setBlobUrl(createdUrl);
        } catch {
          if (!cancelled) showError('Erro ao carregar vídeo');
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
        if (createdUrl) URL.revokeObjectURL(createdUrl);
      };
    }, [src, token]);

    if (loading) {
      return (
        <div className="h-full w-full flex items-center justify-center text-base-content/60">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      );
    }
    if (!blobUrl) {
      return (
        <div className="h-full w-full flex items-center justify-center text-base-content/60 gap-2">
          <FileAudio className="h-5 w-5" /> Vídeo indisponível
        </div>
      );
    }
    return (
      <video
        ref={ref}
        src={blobUrl}
        controls
        onTimeUpdate={onTimeUpdate}
        className="h-full w-full"
      />
    );
  },
);
