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
  /** Chave no bucket S3/MinIO. Mutuamente exclusivo com `url`. */
  s3_key?: string;
  /** URL HTTP(S) pública do áudio. */
  url?: string;
  /** Ativa/desativa diarização (se omitido, usa default do provider). */
  diarize?: boolean;
  min_speakers?: number;
  max_speakers?: number;
}

export interface TranscriptionProvider {
  readonly name: string;
  /** Enfileira/dispara job. Retorna job_id pra polling. */
  submit(input: TranscribeInput): Promise<{ job_id: string }>;
  /** Consulta status do job. */
  status(jobId: string): Promise<TranscriptionJobStatus>;
  /** Health-check do backend (pra mostrar no admin). */
  health(): Promise<{ ok: boolean; details?: Record<string, unknown> }>;
}
