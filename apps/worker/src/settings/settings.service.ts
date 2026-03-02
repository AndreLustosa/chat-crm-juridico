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
}
