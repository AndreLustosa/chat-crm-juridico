import { GroqProvider } from './groq.provider';
import type { TranscriptionProvider } from './types';
import { WhisperLocalProvider } from './whisper-local.provider';

export * from './types';
export { WhisperLocalProvider, GroqProvider };

/**
 * Factory: cria o provider configurado via env.
 *
 *   TRANSCRIPTION_PROVIDER=whisper-local (default)
 *   WHISPER_SERVICE_URL=http://crm-whisper:8000
 *
 *   TRANSCRIPTION_PROVIDER=groq
 *   GROQ_API_KEY=...
 */
export function createTranscriptionProvider(): TranscriptionProvider {
  const provider = (process.env.TRANSCRIPTION_PROVIDER || 'whisper-local').toLowerCase();

  if (provider === 'groq') {
    return new GroqProvider(process.env.GROQ_API_KEY || '');
  }
  return new WhisperLocalProvider(
    process.env.WHISPER_SERVICE_URL || 'http://crm-whisper:8000',
  );
}
