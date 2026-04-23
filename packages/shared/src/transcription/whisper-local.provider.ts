import type {
  TranscribeInput,
  TranscriptionJobStatus,
  TranscriptionProvider,
} from './types';

/**
 * Chama o container crm-whisper via HTTP interno da rede Docker.
 * Default: http://crm-whisper:8000
 */
export class WhisperLocalProvider implements TranscriptionProvider {
  readonly name = 'whisper-local';

  constructor(private readonly baseUrl: string) {}

  async submit(input: TranscribeInput): Promise<{ job_id: string }> {
    const r = await fetch(`${this.baseUrl}/transcribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!r.ok) {
      throw new Error(`crm-whisper submit ${r.status}: ${await r.text()}`);
    }
    const json = (await r.json()) as { job_id: string };
    return { job_id: json.job_id };
  }

  async status(jobId: string): Promise<TranscriptionJobStatus> {
    const r = await fetch(`${this.baseUrl}/jobs/${jobId}`);
    if (r.status === 404) {
      // Container reiniciou e perdeu o job in-memory — worker vai reenfileirar.
      return { id: jobId, status: 'error', progress: 0, error: 'job_lost' };
    }
    if (!r.ok) {
      throw new Error(`crm-whisper status ${r.status}: ${await r.text()}`);
    }
    return (await r.json()) as TranscriptionJobStatus;
  }

  async health(): Promise<{ ok: boolean; details?: Record<string, unknown> }> {
    try {
      const r = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) return { ok: false, details: { http_status: r.status } };
      return { ok: true, details: (await r.json()) as Record<string, unknown> };
    } catch (e: any) {
      return { ok: false, details: { error: e?.message ?? String(e) } };
    }
  }
}
