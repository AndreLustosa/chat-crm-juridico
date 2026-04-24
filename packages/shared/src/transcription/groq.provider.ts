import { createReadStream, statSync } from 'fs';
import { basename } from 'path';
import { randomUUID } from 'crypto';
import type {
  TranscribeInput,
  TranscriptionJobStatus,
  TranscriptionProvider,
  TranscriptionResult,
  TranscriptionSegment,
  TranscriptionWord,
} from './types';

/**
 * Groq Cloud Whisper (whisper-large-v3 ou whisper-large-v3-turbo).
 *
 * - Síncrono na origem: Groq retorna o resultado direto na chamada HTTP.
 *   Pra manter a interface (submit/status polling), seguramos um job-registry
 *   em memória — submit dispara em background, status retorna quando pronto.
 * - Sem diarização nativa (não separa falantes).
 * - Custo: ~$0.02/hora de áudio.
 * - Limite: 25MB por requisição. Worker deve comprimir antes de chamar
 *   (extrai áudio mono 16kHz em MP3 ~32kbps cabe ~2h em 25MB).
 *
 * Modelos:
 *   - whisper-large-v3       (mais preciso, ~30s pra 1h de áudio)
 *   - whisper-large-v3-turbo (mais rápido, qualidade levemente menor)
 */
export class GroqProvider implements TranscriptionProvider {
  readonly name = 'groq';

  private readonly endpoint = 'https://api.groq.com/openai/v1/audio/transcriptions';
  private readonly model: string;
  private readonly jobs = new Map<string, TranscriptionJobStatus>();

  constructor(
    private readonly apiKey: string,
    model: string = 'whisper-large-v3',
  ) {
    this.model = model;
  }

  async submit(input: TranscribeInput): Promise<{ job_id: string }> {
    if (!this.apiKey) throw new Error('GROQ_API_KEY não configurada');
    if (!input.local_path) {
      throw new Error('Groq exige local_path (worker deve baixar/comprimir antes)');
    }

    const jobId = randomUUID();
    this.jobs.set(jobId, { id: jobId, status: 'queued', progress: 0 });

    // Processa em background — não bloqueia a chamada do worker
    this.process(jobId, input).catch((err) => {
      this.jobs.set(jobId, {
        id: jobId,
        status: 'error',
        progress: 0,
        error: err?.message || String(err),
      });
    });

    return { job_id: jobId };
  }

  async status(jobId: string): Promise<TranscriptionJobStatus> {
    const job = this.jobs.get(jobId);
    if (!job) return { id: jobId, status: 'error', progress: 0, error: 'job_lost' };
    return job;
  }

  async health(): Promise<{ ok: boolean; details?: Record<string, unknown> }> {
    if (!this.apiKey) return { ok: false, details: { error: 'no_api_key' } };
    try {
      // Groq tem endpoint /v1/models pra listar — usamos como health check
      const r = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      return { ok: r.ok, details: { http_status: r.status, model: this.model } };
    } catch (e: any) {
      return { ok: false, details: { error: e?.message ?? String(e) } };
    }
  }

  private async process(jobId: string, input: TranscribeInput) {
    const path = input.local_path!;
    this.jobs.set(jobId, { id: jobId, status: 'transcribing', progress: 30 });

    const sizeBytes = statSync(path).size;
    if (sizeBytes > 25 * 1024 * 1024) {
      throw new Error(
        `Arquivo de ${(sizeBytes / 1024 / 1024).toFixed(1)}MB excede limite Groq (25MB). ` +
        `Worker deveria ter comprimido antes.`,
      );
    }

    // Multipart manual (FormData nativo do Node 18+ funciona com fetch)
    const form = new FormData();
    const buf = await readFileBlob(path);
    form.append('file', buf, basename(path));
    form.append('model', this.model);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');
    form.append('timestamp_granularities[]', 'word');
    if (input.diarize !== false) {
      // Groq não faz diarização, mas mantemos a flag — passa "language: pt"
      // pra ajudar o modelo
    }
    form.append('language', 'pt');

    const r = await fetch(this.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(`Groq ${r.status}: ${txt.slice(0, 500)}`);
    }

    const json = (await r.json()) as GroqResponse;
    const result = mapGroqResponse(json);

    this.jobs.set(jobId, {
      id: jobId,
      status: 'done',
      progress: 100,
      result,
    });
  }
}

// Helper pra ler arquivo como Blob (FormData espera Blob/File)
async function readFileBlob(path: string): Promise<Blob> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    createReadStream(path)
      .on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
      .on('end', () => resolve(new Blob([Buffer.concat(chunks)])))
      .on('error', reject);
  });
}

// ─── Mapping Groq → nosso schema ─────────────────────────────────────

interface GroqSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  tokens?: number[];
  words?: GroqWord[];
}

interface GroqWord {
  word: string;
  start: number;
  end: number;
}

interface GroqResponse {
  task: string;
  language: string;
  duration: number;
  text: string;
  segments?: GroqSegment[];
  words?: GroqWord[];
}

function mapGroqResponse(g: GroqResponse): TranscriptionResult {
  const segments: TranscriptionSegment[] = (g.segments || []).map((s) => ({
    start: round(s.start),
    end: round(s.end),
    text: (s.text || '').trim(),
    speaker: null, // Groq não diariza
  }));

  const words: TranscriptionWord[] = [];
  // Tenta words top-level primeiro (timestamp_granularities=word retorna assim)
  const allWords = g.words?.length ? g.words : (g.segments || []).flatMap((s) => s.words || []);
  for (const w of allWords) {
    words.push({
      start: round(w.start),
      end: round(w.end),
      word: w.word,
      speaker: null,
      score: null,
    });
  }

  return {
    text: (g.text || '').trim(),
    language: normalizeLanguage(g.language),
    duration_sec: g.duration || 0,
    segments,
    words,
  };
}

function round(v: number, nd = 2): number {
  if (!Number.isFinite(v)) return 0;
  const m = 10 ** nd;
  return Math.round(v * m) / m;
}

function normalizeLanguage(lang: string): string {
  // Groq retorna "portuguese", queremos "pt"
  const map: Record<string, string> = {
    portuguese: 'pt',
    english: 'en',
    spanish: 'es',
  };
  return map[lang?.toLowerCase()] || lang || 'pt';
}
