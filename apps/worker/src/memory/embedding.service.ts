import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import OpenAI from 'openai';
import { SettingsService } from '../settings/settings.service';

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
  private client: OpenAI | null = null;

  constructor(private readonly settings: SettingsService) {}

  private async getClient(): Promise<OpenAI> {
    if (this.client) return this.client;
    const apiKey = await this.settings.getOpenAiKey();
    if (!apiKey) throw new Error('OPENAI_API_KEY nao configurado');
    this.client = new OpenAI({ apiKey });
    return this.client;
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

  /** Gera embedding para um unico texto. Usa cache. */
  async generate(text: string): Promise<number[]> {
    const hash = this.hashText(text);
    const cached = this.cache.get(hash);
    if (cached) return cached;

    const client = await this.getClient();
    const response = await client.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
      dimensions: 1536,
    });
    const embedding = response.data[0].embedding;
    this.evictIfNeeded();
    this.cache.set(hash, embedding);
    return embedding;
  }

  /** Gera embeddings em lote (mais barato — 1 request por ate 2048 textos). */
  async generateBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    // Checa cache primeiro
    const results: (number[] | null)[] = new Array(texts.length).fill(null);
    const missingIdx: number[] = [];
    const missingTexts: string[] = [];
    for (let i = 0; i < texts.length; i++) {
      const cached = this.cache.get(this.hashText(texts[i]));
      if (cached) results[i] = cached;
      else {
        missingIdx.push(i);
        missingTexts.push(texts[i]);
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
