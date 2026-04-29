import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

/**
 * Cripto AES-256-GCM para refresh tokens do Google Ads OAuth.
 *
 * Formato armazenado: "<iv_b64>:<authTag_b64>:<ciphertext_b64>"
 *
 * Chave: TRAFEGO_ENCRYPTION_KEY (env). 32 bytes (256 bits) em hex (64 chars).
 * Gere com: `openssl rand -hex 32` e coloque no .env / Portainer secrets.
 *
 * NUNCA logue o resultado de decrypt. Trate o plaintext como segredo,
 * mantenha em memoria apenas durante a chamada da API e descarte.
 */
@Injectable()
export class TrafegoCryptoService {
  private readonly logger = new Logger(TrafegoCryptoService.name);
  private readonly key: Buffer;
  private readonly algorithm = 'aes-256-gcm';

  constructor() {
    const hexKey = process.env.TRAFEGO_ENCRYPTION_KEY;
    if (!hexKey) {
      // Em dev, geramos uma chave volatil (refresh tokens nao persistem entre restarts)
      // Em prod, missing key = crash precoce eh melhor que silently broken.
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          'TRAFEGO_ENCRYPTION_KEY missing. Generate with `openssl rand -hex 32` and set in env.',
        );
      }
      this.logger.warn(
        '[TRAFEGO_CRYPTO] TRAFEGO_ENCRYPTION_KEY ausente — gerando chave volatil para dev. Tokens nao persistirao entre restarts.',
      );
      this.key = crypto.randomBytes(32);
      return;
    }

    if (hexKey.length !== 64) {
      throw new Error(
        `TRAFEGO_ENCRYPTION_KEY deve ter 64 chars hex (32 bytes). Atual: ${hexKey.length} chars.`,
      );
    }
    this.key = Buffer.from(hexKey, 'hex');
  }

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(12); // GCM standard IV: 12 bytes
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
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
    const parts = encrypted.split(':');
    if (parts.length !== 3) {
      throw new Error('Formato de token criptografado invalido');
    }
    const [ivB64, authTagB64, ciphertextB64] = parts;
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(authTagB64, 'base64');
    const ciphertext = Buffer.from(ciphertextB64, 'base64');

    const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }
}
