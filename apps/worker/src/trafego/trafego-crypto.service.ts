import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import * as crypto from 'crypto';

/**
 * Cripto AES-256-GCM para refresh tokens do Google Ads OAuth.
 *
 * Formato armazenado: "<iv_b64>:<authTag_b64>:<ciphertext_b64>"
 *
 * Chave: TRAFEGO_ENCRYPTION_KEY (env). 32 bytes (256 bits) em hex (64 chars).
 * Gere com: `openssl rand -hex 32` e coloque no .env / Portainer secrets.
 *
 * Estrategia em prod: NAO crasha o boot se a env estiver ausente — apenas
 * deixa o modulo de trafego inoperante (encrypt/decrypt lancam 503). Crashar
 * a API inteira por causa de uma feature opcional eh inaceitavel.
 *
 * NUNCA logue o resultado de decrypt. Trate o plaintext como segredo,
 * mantenha em memoria apenas durante a chamada da API e descarte.
 */
@Injectable()
export class TrafegoCryptoService {
  private readonly logger = new Logger(TrafegoCryptoService.name);
  /** null quando a env nao foi configurada — modulo desabilitado mas API sobe. */
  private readonly key: Buffer | null;
  private readonly algorithm = 'aes-256-gcm';

  constructor() {
    const hexKey = process.env.TRAFEGO_ENCRYPTION_KEY;
    if (!hexKey) {
      this.logger.warn(
        '[TRAFEGO_CRYPTO] TRAFEGO_ENCRYPTION_KEY ausente — modulo de trafego DESABILITADO. ' +
          'Gere com `openssl rand -hex 32` e configure a env para habilitar.',
      );
      this.key = null;
      return;
    }

    if (hexKey.length !== 64) {
      this.logger.error(
        `[TRAFEGO_CRYPTO] TRAFEGO_ENCRYPTION_KEY com formato invalido (${hexKey.length} chars, esperado 64 hex). Modulo de trafego DESABILITADO.`,
      );
      this.key = null;
      return;
    }

    this.key = Buffer.from(hexKey, 'hex');
  }

  /** True se a chave foi configurada e o modulo pode operar. */
  isAvailable(): boolean {
    return this.key !== null;
  }

  private requireKey(): Buffer {
    if (!this.key) {
      throw new ServiceUnavailableException(
        'Modulo de trafego desabilitado: TRAFEGO_ENCRYPTION_KEY nao configurada no servidor. ' +
          'Contate o administrador.',
      );
    }
    return this.key;
  }

  encrypt(plaintext: string): string {
    const key = this.requireKey();
    const iv = crypto.randomBytes(12); // GCM standard IV: 12 bytes
    const cipher = crypto.createCipheriv(this.algorithm, key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [
      iv.toString('base64'),
      authTag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  decrypt(encrypted: string): string {
    const key = this.requireKey();
    const parts = encrypted.split(':');
    if (parts.length !== 3) {
      throw new Error('Formato de token criptografado invalido');
    }
    const [ivB64, authTagB64, ciphertextB64] = parts;
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(authTagB64, 'base64');
    const ciphertext = Buffer.from(ciphertextB64, 'base64');

    const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }
}
