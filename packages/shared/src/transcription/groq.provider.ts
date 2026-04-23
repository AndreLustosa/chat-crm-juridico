import type {
  TranscribeInput,
  TranscriptionJobStatus,
  TranscriptionProvider,
} from './types';

/**
 * Stub do provider Groq — não implementado ainda.
 * Preparado pra plugar no dia que quisermos trocar (env TRANSCRIPTION_PROVIDER=groq).
 *
 * Diferenças com whisper-local:
 *   - Síncrono (Groq devolve a transcrição direto, sem polling)
 *   - Sem diarização nativa (precisaria combinar com outro serviço)
 *   - Paga por uso (~$0.02/hora)
 */
export class GroqProvider implements TranscriptionProvider {
  readonly name = 'groq';

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(private readonly apiKey: string) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  submit(_input: TranscribeInput): Promise<{ job_id: string }> {
    throw new Error('GroqProvider: não implementado. Configure TRANSCRIPTION_PROVIDER=whisper-local.');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  status(_jobId: string): Promise<TranscriptionJobStatus> {
    throw new Error('GroqProvider: não implementado.');
  }

  async health(): Promise<{ ok: boolean; details?: Record<string, unknown> }> {
    return { ok: false, details: { error: 'not-implemented' } };
  }
}
