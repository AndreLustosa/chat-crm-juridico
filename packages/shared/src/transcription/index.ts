import { GroqProvider } from './groq.provider';
import type { TranscriptionProvider } from './types';
import { WhisperLocalProvider } from './whisper-local.provider';

export * from './types';
export { WhisperLocalProvider, GroqProvider };

/**
 * Factory: cria o provider configurado via env.
 *
 * Modo legacy: providers globais via env (default usado quando upload não
 * especifica). Pra escolha por-upload, use {@link createProviderById}.
 */
export function createTranscriptionProvider(): TranscriptionProvider {
  const provider = (process.env.TRANSCRIPTION_PROVIDER || 'whisper-local').toLowerCase();
  return createProviderById(provider);
}

/**
 * Cria provider por id — usado quando o upload escolhe explicitamente.
 * Permite ter os 2 ativos simultaneamente (cada job usa o que pediu).
 */
export function createProviderById(id: string): TranscriptionProvider {
  const lower = id.toLowerCase();
  if (lower === 'groq') {
    return new GroqProvider(
      process.env.GROQ_API_KEY || '',
      process.env.GROQ_MODEL || 'whisper-large-v3',
    );
  }
  return new WhisperLocalProvider(
    process.env.WHISPER_SERVICE_URL || 'http://crm-whisper:8000',
  );
}
