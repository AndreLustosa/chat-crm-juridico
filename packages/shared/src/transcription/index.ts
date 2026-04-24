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
 * Opções do provider — vindas do SettingsService (DB) ou env.
 * Cada campo é opcional: se omitido, cai no env.
 */
export interface ProviderOptions {
  groqApiKey?: string;
  groqModel?: string;
  whisperServiceUrl?: string;
}

/**
 * Cria provider por id — usado quando o upload escolhe explicitamente.
 * Aceita opts pra que API/worker passem config do banco (admin pode trocar
 * a chave Groq pela UI sem redeploy).
 */
export function createProviderById(id: string, opts: ProviderOptions = {}): TranscriptionProvider {
  const lower = id.toLowerCase();
  if (lower === 'groq') {
    return new GroqProvider(
      opts.groqApiKey || process.env.GROQ_API_KEY || '',
      opts.groqModel || process.env.GROQ_MODEL || 'whisper-large-v3',
    );
  }
  return new WhisperLocalProvider(
    opts.whisperServiceUrl || process.env.WHISPER_SERVICE_URL || 'http://crm-whisper:8000',
  );
}
