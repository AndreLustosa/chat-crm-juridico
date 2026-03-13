import { Injectable } from '@nestjs/common';
import { createDecipheriv, scryptSync } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async getEvolutionConfig() {
    const [apiUrlRow, apiKeyRow] = await Promise.all([
      this.prisma.globalSetting.findUnique({ where: { key: 'EVOLUTION_API_URL' } }),
      this.prisma.globalSetting.findUnique({ where: { key: 'EVOLUTION_GLOBAL_APIKEY' } }),
    ]);

    let apiUrl = apiUrlRow?.value || process.env.EVOLUTION_API_URL || '';
    if (apiUrl && !/^https?:\/\//i.test(apiUrl)) apiUrl = `https://${apiUrl}`;
    apiUrl = apiUrl.replace(/\/+$/, '');

    return {
      apiUrl,
      apiKey: this.decryptIfNeeded(apiKeyRow?.value || process.env.EVOLUTION_GLOBAL_APIKEY || ''),
    };
  }

  async getOpenAiKey(): Promise<string | null> {
    const row = await this.prisma.globalSetting.findUnique({ where: { key: 'OPENAI_API_KEY' } });
    const raw = row?.value || process.env.OPENAI_API_KEY || null;
    return raw ? this.decryptIfNeeded(raw) : null;
  }

  async getDefaultModel(): Promise<string> {
    const row = await this.prisma.globalSetting.findUnique({ where: { key: 'OPENAI_DEFAULT_MODEL' } });
    return row?.value || 'gpt-4o-mini';
  }

  async getActiveSkills(): Promise<any[]> {
    return (this.prisma as any).promptSkill.findMany({
      where: { active: true },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
    });
  }

  async getSmtpConfig() {
    const keys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];
    const rows = await this.prisma.globalSetting.findMany({
      where: { key: { in: keys } },
    });
    const cfg: Record<string, string> = {};
    for (const r of rows) cfg[r.key] = this.decryptIfNeeded(r.value);
    return {
      host: cfg.SMTP_HOST || '',
      port: parseInt(cfg.SMTP_PORT || '587'),
      user: cfg.SMTP_USER || '',
      pass: cfg.SMTP_PASS || '',
      from: cfg.SMTP_FROM || '',
    };
  }

  private async get(key: string): Promise<string | null> {
    const row = await this.prisma.globalSetting.findUnique({ where: { key } });
    return row?.value || null;
  }

  async getMemoryModel(): Promise<string> {
    return (await this.get('AI_MEMORY_MODEL')) || 'gpt-4.1';
  }

  /** Cooldown em ms entre respostas da IA na mesma conversa (padrão: 8s) */
  async getCooldownMs(): Promise<number> {
    const val = await this.get('AI_COOLDOWN_SECONDS');
    const seconds = val ? parseInt(val, 10) : 8;
    return (isNaN(seconds) ? 8 : seconds) * 1000;
  }

  // ─── TTS ──────────────────────────────────────────────────────────────────

  /** Descriptografa valores salvos pela API (formato enc:<iv>:<tag>:<data>) */
  private decryptIfNeeded(value: string): string {
    const ENCRYPTED_PREFIX = 'enc:';
    if (!value.startsWith(ENCRYPTED_PREFIX)) return value;
    try {
      const secret = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET;
      if (!secret) return value;
      const key = scryptSync(secret, 'crm-settings-salt', 32);
      const parts = value.slice(ENCRYPTED_PREFIX.length).split(':');
      if (parts.length !== 3) return value;
      const [ivHex, tagHex, encHex] = parts;
      const iv        = Buffer.from(ivHex,  'hex');
      const tag       = Buffer.from(tagHex, 'hex');
      const encrypted = Buffer.from(encHex, 'hex');
      const decipher  = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
    } catch {
      return value;
    }
  }

  async getTtsConfig() {
    const keys = ['TTS_ENABLED', 'GOOGLE_TTS_API_KEY', 'TTS_VOICE', 'TTS_LANGUAGE'];
    const rows = await this.prisma.globalSetting.findMany({ where: { key: { in: keys } } });
    const cfg: Record<string, string> = {};
    for (const r of rows) cfg[r.key] = this.decryptIfNeeded(r.value);
    return {
      enabled:      cfg.TTS_ENABLED === 'true',
      googleApiKey: cfg.GOOGLE_TTS_API_KEY || '',
      voice:        cfg.TTS_VOICE    || 'pt-BR-Neural2-B',
      language:     cfg.TTS_LANGUAGE || 'pt-BR',
    };
  }
}
