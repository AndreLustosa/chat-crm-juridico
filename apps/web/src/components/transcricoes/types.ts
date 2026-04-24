export type TranscriptionStatus =
  | 'PENDING'
  | 'UPLOADING'
  | 'CONVERTING'
  | 'TRANSCRIBING'
  | 'DIARIZING'
  | 'DONE'
  | 'ERROR';

export interface TranscricaoListItem {
  id: string;
  title: string;
  status: TranscriptionStatus;
  progress: number;
  error_message: string | null;
  /** 'whisper-local' | 'groq' */
  provider: string;
  diarize: boolean;
  duration_sec: number | null;
  language: string | null;
  source_size: number;
  video_s3_key: string | null;
  created_at: string;
  finished_at: string | null;
  uploaded_by: { id: string; name: string } | null;
  // Presentes apenas na listagem global:
  legal_case_id?: string | null;
  legal_case?: {
    id: string;
    case_number: string | null;
    legal_area: string | null;
    lead: { id: string; name: string } | null;
  } | null;
}

export interface Segment {
  start: number;
  end: number;
  text: string;
  speaker?: string | null;
}

export interface SpeakerLabel {
  id: string;
  label: string;
  color: string;
}

export interface TranscricaoDetail extends TranscricaoListItem {
  text: string | null;
  segments_json: Segment[] | null;
  speakers_json: SpeakerLabel[] | null;
  model: string | null;
}

export const STATUS_META: Record<
  TranscriptionStatus,
  { label: string; color: string; spinning: boolean }
> = {
  PENDING:       { label: 'Na fila',            color: 'text-slate-400',   spinning: true  },
  UPLOADING:     { label: 'Enviando',           color: 'text-blue-400',    spinning: true  },
  CONVERTING:    { label: 'Convertendo vídeo',  color: 'text-cyan-400',    spinning: true  },
  TRANSCRIBING:  { label: 'Transcrevendo',      color: 'text-violet-400',  spinning: true  },
  DIARIZING:     { label: 'Separando falantes', color: 'text-violet-400',  spinning: true  },
  DONE:          { label: 'Pronta',             color: 'text-emerald-400', spinning: false },
  ERROR:         { label: 'Erro',               color: 'text-red-400',     spinning: false },
};

export const SPEAKER_PALETTE = [
  '#3B82F6', '#EF4444', '#10B981', '#F59E0B',
  '#8B5CF6', '#EC4899', '#14B8A6', '#F97316',
];

// ─── Providers ─────────────────────────────────────────────────────────

export interface ProviderInfo {
  id: string;
  label: string;
  available: boolean;
  diarize: boolean;
  speed: 'slow' | 'medium' | 'fast';
}

export interface ProvidersResponse {
  providers: ProviderInfo[];
  default: string;
}

export const PROVIDER_META: Record<string, { label: string; color: string }> = {
  'whisper-local': { label: 'Whisper (servidor)', color: 'text-violet-400' },
  'groq':          { label: 'Groq (nuvem)',       color: 'text-cyan-400'   },
};

export function providerLabel(id: string | null | undefined): string {
  if (!id) return '—';
  return PROVIDER_META[id]?.label || id;
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDuration(sec: number | null | undefined) {
  if (!sec || !isFinite(sec)) return '–';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${m}min`;
  if (m > 0) return `${m}min ${s}s`;
  return `${s}s`;
}

export function formatTimestamp(sec: number) {
  if (!isFinite(sec)) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

export function formatDate(d: string) {
  return new Date(d).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}
