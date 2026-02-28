import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async get(key: string): Promise<string | null> {
    try {
      const setting = await this.prisma.globalSetting.findUnique({
        where: { key },
      });
      return setting?.value || null;
    } catch (e) {
      console.error(`Erro ao buscar configuração [${key}] do banco:`, e.message);
      return null; // Retorna null para disparar o fallback da Env
    }
  }

  async set(key: string, value: string): Promise<void> {
    await this.prisma.globalSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }

  async getWhatsAppConfig() {
    const dbApiUrl = await this.get('EVOLUTION_API_URL');
    const dbApiKey = await this.get('EVOLUTION_GLOBAL_APIKEY');
    const dbWebhookUrl = await this.get('WEBHOOK_URL');

    console.log('Configurações carregadas do Banco:', { dbApiUrl, dbApiKey, dbWebhookUrl });

    return {
      apiUrl: dbApiUrl || process.env.EVOLUTION_API_URL,
      apiKey: dbApiKey || process.env.EVOLUTION_GLOBAL_APIKEY,
      webhookUrl: dbWebhookUrl || 'https://atendimento.andrelustosaadvogados.com.br/api/webhooks/evolution',
    };
  }

  async setWhatsAppConfig(apiUrl: string, apiKey: string, webhookUrl?: string) {
    await this.set('EVOLUTION_API_URL', apiUrl);
    await this.set('EVOLUTION_GLOBAL_APIKEY', apiKey);
    if (webhookUrl) {
      await this.set('WEBHOOK_URL', webhookUrl);
    }
  }
}
