import { randomBytes } from 'crypto';
import { Logger } from '@nestjs/common';

/**
 * Util centralizado para resolver JWT_SECRET de forma segura.
 *
 * Producao: exige JWT_SECRET definida e diferente dos valores conhecidos
 * inseguros. Caso contrario, encerra o processo no boot (process.exit).
 *
 * Dev: se JWT_SECRET nao estiver definida, gera uma chave aleatoria por
 * processo (cacheada em modulo). Cada restart inviabiliza tokens antigos —
 * o que torna obvio que esta faltando configurar a env real.
 *
 * Use UMA UNICA vez por chamada de bootstrap (NestJS instancia modulos uma
 * vez); a cache de processo garante que multiplos consumidores recebam
 * a mesma chave dentro do mesmo runtime.
 */
const INSECURE_KNOWN_VALUES = new Set([
  '__INSECURE_DEV_FALLBACK_CHANGE_ME__',
  'fallback-secret',
  'troque_esta_secret',
  'secret',
  'changeme',
]);

let cachedDevSecret: string | null = null;
const logger = new Logger('JwtSecret');

export function getJwtSecret(): string {
  const env = process.env.JWT_SECRET;
  const isProd = process.env.NODE_ENV === 'production';

  if (env && env.trim().length >= 16 && !INSECURE_KNOWN_VALUES.has(env)) {
    return env;
  }

  if (isProd) {
    if (!env) {
      logger.error('FATAL: JWT_SECRET nao definida em producao. Encerrando.');
    } else if (INSECURE_KNOWN_VALUES.has(env)) {
      logger.error('FATAL: JWT_SECRET com valor inseguro conhecido em producao. Encerrando.');
    } else {
      logger.error('FATAL: JWT_SECRET muito curta (<16 chars) em producao. Encerrando.');
    }
    process.exit(1);
  }

  if (!cachedDevSecret) {
    cachedDevSecret = randomBytes(32).toString('hex');
    logger.warn(
      'JWT_SECRET nao definida em DEV. Gerada chave aleatoria por processo. ' +
        'Tokens existentes vao falhar a cada restart ate JWT_SECRET ser definida no .env.',
    );
  }
  return cachedDevSecret;
}
