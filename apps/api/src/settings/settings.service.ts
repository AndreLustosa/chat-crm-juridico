import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async get(key: string): Promise<string | null> {
    const setting = await this.prisma.globalSetting.findUnique({
      where: { key },
    });
    return setting?.value || null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.prisma.globalSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }

  async getWhatsAppConfig() {
    return {
      apiUrl: await this.get('EVOLUTION_API_URL') || process.env.EVOLUTION_API_URL,
      apiKey: await this.get('EVOLUTION_GLOBAL_APIKEY') || process.env.EVOLUTION_GLOBAL_APIKEY,
    };
  }

  async setWhatsAppConfig(apiUrl: string, apiKey: string) {
    await this.set('EVOLUTION_API_URL', apiUrl);
    await this.set('EVOLUTION_GLOBAL_APIKEY', apiKey);
  }
}
