import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Mutex distribuído via Redis — protege jobs de longa duração contra execução
 * concorrente entre réplicas da API/worker.
 *
 * Antes (mutex em memória):
 *   private syncing = false;  // funciona com 1 réplica só
 *
 *   if (this.syncing) return;
 *   this.syncing = true;
 *   try { ... } finally { this.syncing = false; }
 *
 * O mutex em memória vaza no momento que sobem 2+ réplicas no Swarm/k8s ou
 * durante rolling-update (a versão antiga ainda está rodando enquanto a nova
 * sobe). Resultado: 2 cron jobs disparam o sync em paralelo, cada um envia
 * mensagens duplicadas ao advogado.
 *
 * Esta classe usa SET key value NX EX ttl — atomico no Redis. Apenas uma
 * réplica consegue adquirir; as outras recebem null e abortam.
 *
 * Kill switch: TTL impede deadlock se o processo crashar antes do release.
 *
 * Uso típico:
 *   await this.lock.withLock('esaj-sync', 30 * 60, async () => {
 *     // codigo critico — apenas 1 replica roda por vez, max 30min
 *   });
 */
@Injectable()
export class LockService implements OnModuleDestroy {
  private readonly logger = new Logger(LockService.name);
  private readonly redis: Redis;
  // Identidade unica do processo — usada como valor do lock pra debug
  // (`redis-cli get esaj-sync:lock` mostra qual replica esta rodando).
  private readonly owner = `${process.env.HOSTNAME || 'unknown'}-${process.pid}`;

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      // Importante: mesma config de retry que o BullMQ usa, pra comportamento
      // consistente em failover do Redis.
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      retryStrategy(times) {
        return Math.min(times * 50, 2000);
      },
    });
    this.redis.on('error', (err) => {
      this.logger.warn(`Redis lock error: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    await this.redis.quit().catch(() => {});
  }

  /**
   * Tenta adquirir o lock atomicamente. Retorna true se conseguiu, false caso
   * contrario (outra replica ja esta rodando).
   *
   * @param key — chave logica do lock (ex: 'esaj-sync', 'djen-sync')
   * @param ttlSeconds — tempo de vida do lock. Deve ser > duracao maxima
   *   esperada do job. Se job demorar mais, lock expira e outra replica pode
   *   pegar — risco de double-run, entao escolha generosamente.
   */
  async acquire(key: string, ttlSeconds: number): Promise<boolean> {
    const fullKey = `lock:${key}`;
    try {
      const result = await this.redis.set(fullKey, this.owner, 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    } catch (err: any) {
      // Em caso de Redis fora do ar, NAO tenta executar — eh mais seguro
      // skipar o sync do que rodar duplicado (advogado prefere atraso de 6h
      // pro proximo cron a 2 mensagens duplicadas).
      this.logger.warn(`Falha ao adquirir lock "${key}": ${err.message} — skipando job`);
      return false;
    }
  }

  /**
   * Libera o lock. Idempotente: se ja expirou ou outro dono pegou, no-op.
   * Usa Lua script pra fazer check-and-delete atomico — evita race onde A
   * libera o lock que B ja pegou apos expiracao.
   */
  async release(key: string): Promise<void> {
    const fullKey = `lock:${key}`;
    const luaScript = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    try {
      await this.redis.eval(luaScript, 1, fullKey, this.owner);
    } catch (err: any) {
      this.logger.warn(`Falha ao liberar lock "${key}": ${err.message}`);
    }
  }

  /**
   * Helper pra rodar funcao sob o lock — adquire, executa, libera no finally.
   * Retorna o resultado da funcao ou null se nao conseguiu o lock.
   *
   * Convenção: retorna null pra "skipped" (lock nao disponivel) e o resultado
   * legitimo caso contrario. Caller distingue pelo tipo do retorno.
   */
  async withLock<T>(
    key: string,
    ttlSeconds: number,
    fn: () => Promise<T>,
  ): Promise<T | null> {
    const acquired = await this.acquire(key, ttlSeconds);
    if (!acquired) {
      this.logger.log(`[LOCK] "${key}" ja em uso por outra replica — skipando`);
      return null;
    }
    this.logger.log(`[LOCK] "${key}" adquirido por ${this.owner} (TTL ${ttlSeconds}s)`);
    try {
      return await fn();
    } finally {
      await this.release(key);
    }
  }
}
