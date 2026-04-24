/**
 * Interface pluggable de transcrição.
 *
 * Backends possíveis:
 *   - whisper-local   → container crm-whisper (WhisperX + pyannote, roda na VPS)
 *   - groq            → Groq Cloud whisper-large-v3 (stub, fallback futuro)
 *
 * Toda implementação recebe um áudio/vídeo (via S3 key ou URL) e retorna um
 * job_id pra polling. Job completo traz texto corrido + segmentos com
 * timestamps + speaker labels (quando diarize=true).
 */

export type TranscriptionStatus =
  | 'queued'
  | 'downloading'
  | 'transcribing'
  | 'diarizing'
  | 'done'
  | 'error';

export interface TranscriptionSegment {
  start: number; // segundos
  end: number;
  text: string;
  speaker?: string | null; // ex: "SPEAKER_00"
}

export interface TranscriptionWord {
  start: number | null;
  end: number | null;
  word: string;
  speaker?: string | null;
  score?: number | null;
}

export interface TranscriptionResult {
  text: string;
  language: string;
  duration_sec: number;
  segments: TranscriptionSegment[];
  words: TranscriptionWord[];
}

export interface TranscriptionJobStatus {
  id: string;
  status: TranscriptionStatus;
  progress: number; // 0-100
  error?: string | null;
  result?: TranscriptionResult | null;
}

export interface TranscribeInput {
  /** Chave no bucket S3/MinIO. Usado pelo whisper-local (Python baixa). */
  s3_key?: string;
  /** URL HTTP(S) pública do áudio. */
  url?: string;
  /**
   * Caminho local de arquivo já baixado/preparado no disco do worker.
   * Necessário pro Groq (envia via multipart). Worker faz download/conversão
   * antes de chamar o provider.
   */
  local_path?: string;
  /** Ativa/desativa diarização (se omitido, usa default do provider). */
  diarize?: boolean;
  min_speakers?: number;
  max_speakers?: number;
}

/**
 * Capacidades de cada provider — usado pelo frontend pra mostrar os tradeoffs.
 */
export interface ProviderInfo {
  id: string;
  label: string;
  description: string;
  diarize: boolean; // separa falantes nativamente?
  speed: 'slow' | 'medium' | 'fast'; // tempo relativo de processamento
  cost: 'free' | 'paid'; // custo por uso
}

export const PROVIDER_CATALOG: ProviderInfo[] = [
  {
    id: 'whisper-local',
    label: 'Whisper (servidor)',
    description: 'Roda na sua VPS, separa falantes (Juiz/Advogado/...). Lento em CPU.',
    diarize: true,
    speed: 'slow',
    cost: 'free',
  },
  {
    id: 'groq',
    label: 'Groq Whisper (nuvem)',
    description: 'Whisper large-v3 na nuvem Groq. ~30s por hora de áudio. Sem separação de falantes.',
    diarize: false,
    speed: 'fast',
    cost: 'paid',
  },
];

export interface TranscriptionProvider {
  readonly name: string;
  /** Enfileira/dispara job. Retorna job_id pra polling. */
  submit(input: TranscribeInput): Promise<{ job_id: string }>;
  /** Consulta status do job. */
  status(jobId: string): Promise<TranscriptionJobStatus>;
  /** Health-check do backend (pra mostrar no admin). */
  health(): Promise<{ ok: boolean; details?: Record<string, unknown> }>;
}
