import { Injectable } from '@nestjs/common';
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
      apiKey: apiKeyRow?.value || process.env.EVOLUTION_GLOBAL_APIKEY || '',
    };
  }

  async getOpenAiKey(): Promise<string | null> {
    const row = await this.prisma.globalSetting.findUnique({ where: { key: 'OPENAI_API_KEY' } });
    return row?.value || process.env.OPENAI_API_KEY || null;
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
    for (const r of rows) cfg[r.key] = r.value;
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
}
