import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Mutex distribuído via Redis — protege jobs de longa duração contra execução
 * concorrente entre réplicas do worker. Espelha apps/api/src/common/locks.
 *
 * Uso típico:
 *   await this.lock.withLock('payment-due-reminders', 30 * 60, async () => {
 *     // codigo critico — apenas 1 replica roda por vez, max 30min
 *   });
 */
@Injectable()
export class LockService implements OnModuleDestroy {
  private readonly logger = new Logger(LockService.name);
  private readonly redis: Redis;
  private readonly owner = `${process.env.HOSTNAME || 'unknown'}-${process.pid}`;

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
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

  async acquire(key: string, ttlSeconds: number): Promise<boolean> {
    const fullKey = `lock:${key}`;
    try {
      const result = await this.redis.set(fullKey, this.owner, 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    } catch (err: any) {
      this.logger.warn(`Falha ao adquirir lock "${key}": ${err.message} — skipando job`);
      return false;
    }
  }

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
