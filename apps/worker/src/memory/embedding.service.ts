import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { SettingsService } from '../settings/settings.service';
import { getOpenAIClient } from './memory-llm.util';

/**
 * Bug fix 2026-05-10 (Memoria PR1 #C4 — CRITICO LGPD):
 * Antes embeddings recebiam memorias com CPF/RG/processo/endereco
 * em plaintext direto pra OpenAI. Toda memoria do escritorio passava
 * por la sem ofuscacao. Quebra de sigilo profissional advogado
 * (Art. 7 §1 EAOAB) + risco LGPD.
 *
 * Estrategia: mascara minima ANTES de enviar pra embeddings. Embedding
 * semantico mantem-se relevante (mascaras genericas tipo <CPF> nao
 * mudam vetor significativamente; mas previnem reconstrucao de PII
 * via reverse lookup do indice OpenAI).
 *
 * Patterns mascarados:
 *   CPF: 11 digitos com ou sem formatacao
 *   CNPJ: 14 digitos
 *   RG: 7-9 digitos com sufixo opcional
 *   Processo: NNNNNNN-DD.AAAA.J.TR.OOOO (CNJ)
 *   Email: <local>@<domain>
 *   Telefone BR: +55, DDD, etc
 */
function maskPiiInText(text: string): string {
  if (!text) return text;
  return text
    // CPF: 123.456.789-00 ou 12345678900
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '<CPF>')
    // CNPJ: 12.345.678/0001-23 ou 12345678000123
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '<CNPJ>')
    // Numero de processo CNJ: 1234567-89.2026.5.04.0001
    .replace(/\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/g, '<PROCESSO>')
    // Email
    .replace(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, '<EMAIL>')
    // Telefone BR (com DDI 55, opcional 9): +55 82 99999-8888 ou 5582999998888
    .replace(/\b(?:\+?55\s?)?\(?\d{2}\)?\s?9?\s?\d{4,5}-?\d{4}\b/g, '<TELEFONE>');
}

/**
 * EmbeddingService
 * ────────────────
 * Gera vetores (1536-dim) para memorias usando text-embedding-3-small.
 * Cache in-memory por hash do texto — evita regenerar embeddings identicos
 * dentro do mesmo processo (util em extracoes batch com textos repetidos).
 *
 * Custo: ~$0.02 por 1M tokens. Uma memoria de 50 palavras = ~$0.000002.
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly cache = new Map<string, number[]>();
  private readonly maxCacheEntries = 2000;

  constructor(private readonly settings: SettingsService) {}

  /**
   * Bug fix 2026-05-11 (Memoria PR2 #A3): client reusado via cache global
   * em memory-llm.util.ts. Antes cada EmbeddingService instanciava o seu
   * proprio client; agora compartilha com profile/org/batch processors,
   * reusando keepAlive agent e sockets sob carga.
   */
  private async getClient() {
    const apiKey = await this.settings.getOpenAiKey();
    if (!apiKey) throw new Error('OPENAI_API_KEY nao configurado');
    return getOpenAIClient(apiKey);
  }

  private hashText(text: string): string {
    return createHash('md5').update(text).digest('hex');
  }

  private evictIfNeeded() {
    if (this.cache.size <= this.maxCacheEntries) return;
    // FIFO eviction — descarta os 500 mais antigos
    const toRemove = 500;
    let i = 0;
    for (const key of this.cache.keys()) {
      if (i++ >= toRemove) break;
      this.cache.delete(key);
    }
  }

  /** Gera embedding para um unico texto. Usa cache.
   *
   * Bug fix 2026-05-10 (PR1 #C4): mascara PII antes de enviar pra
   * OpenAI embeddings. Cache key usa texto MASCARADO (consistente
   * com o que vai pra IA).
   */
  async generate(text: string): Promise<number[]> {
    const masked = maskPiiInText(text);
    const hash = this.hashText(masked);
    const cached = this.cache.get(hash);
    if (cached) return cached;

    const client = await this.getClient();
    const response = await client.embeddings.create({
      model: 'text-embedding-3-small',
      input: masked,
      dimensions: 1536,
    });
    const embedding = response.data[0].embedding;
    this.evictIfNeeded();
    this.cache.set(hash, embedding);
    return embedding;
  }

  /** Gera embeddings em lote (mais barato — 1 request por ate 2048 textos).
   *  Bug fix 2026-05-10 (PR1 #C4): mascara PII em batch tambem.
   */
  async generateBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const maskedTexts = texts.map(t => maskPiiInText(t));
    // Checa cache primeiro (key = masked)
    const results: (number[] | null)[] = new Array(maskedTexts.length).fill(null);
    const missingIdx: number[] = [];
    const missingTexts: string[] = [];
    for (let i = 0; i < maskedTexts.length; i++) {
      const cached = this.cache.get(this.hashText(maskedTexts[i]));
      if (cached) results[i] = cached;
      else {
        missingIdx.push(i);
        missingTexts.push(maskedTexts[i]);
      }
    }
    if (missingTexts.length === 0) return results as number[][];

    const client = await this.getClient();
    const response = await client.embeddings.create({
      model: 'text-embedding-3-small',
      input: missingTexts,
      dimensions: 1536,
    });
    for (let i = 0; i < missingTexts.length; i++) {
      const emb = response.data[i].embedding;
      results[missingIdx[i]] = emb;
      this.evictIfNeeded();
      this.cache.set(this.hashText(missingTexts[i]), emb);
    }
    return results as number[][];
  }

  /** Converte number[] para literal pgvector (ex: '[0.1,0.2,...]') para $queryRaw. */
  toVectorLiteral(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }
}
