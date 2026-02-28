import { Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  
  constructor(private readonly settingsService: SettingsService) {}

  private normalizeUrl(url: string): string {
    if (!url) return '';
    let normalized = url.trim().replace(/\/+$/, ''); // Remove barras no final
    if (!/^https?:\/\//i.test(normalized)) {
      normalized = `https://${normalized}`;
    }
    return normalized;
  }

  private async request(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: any,
  ) {
    const config = await this.settingsService.getWhatsAppConfig();
    const baseUrl = this.normalizeUrl(config.apiUrl || '');
    const url = `${baseUrl}/${path}`;
    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          apikey: config.apiKey || '',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return await response.json();
    } catch (e) {
      this.logger.error(`Erro na requisição Evolution API (${path}): ${e}`);
      throw e;
    }
  }

  // --- MENSAGENS ---

  async sendText(number: string, text: string, instanceName?: string) {
    const targetInstance = instanceName || process.env.EVOLUTION_INSTANCE_NAME || 'crm_instance';
    return this.request('POST', `message/sendText/${targetInstance}`, {
      number,
      options: { delay: 1200, presence: 'composing' },
      textMessage: { text },
    });
  }

  async sendMedia(
    number: string,
    mediaType: 'image' | 'audio' | 'document',
    mediaUrl: string,
    caption?: string,
    instanceName?: string,
  ) {
    const targetInstance = instanceName || process.env.EVOLUTION_INSTANCE_NAME || 'crm_instance';
    let endpoint = `message/sendMedia/${targetInstance}`;
    let body: any = {
      number,
      options: { delay: 1200 },
      mediaMessage: { mediatype: mediaType, media: mediaUrl, caption },
    };

    if (mediaType === 'audio') {
      endpoint = `message/sendWhatsAppAudio/${targetInstance}`;
      body = {
        number,
        options: { delay: 1200 },
        audioMessage: { audio: mediaUrl },
      };
    }

    return this.request('POST', endpoint, body);
  }

  // --- GESTÃO DE INSTÂNCIAS ---

  async listInstances() {
    return this.request('GET', 'instance/fetchInstances');
  }

  async createInstance(instanceName: string) {
    return this.request('POST', 'instance/create', {
      instanceName,
      token: '', // Evolution gera dinamicamente se vazio
      qrcode: true,
    });
  }

  async deleteInstance(instanceName: string) {
    return this.request('DELETE', `instance/delete/${instanceName}`);
  }

  async logoutInstance(instanceName: string) {
    return this.request('DELETE', `instance/logout/${instanceName}`);
  }

  async getConnectCode(instanceName: string) {
    return this.request('GET', `instance/connect/${instanceName}`);
  }

  async getConnectionStatus(instanceName: string) {
    return this.request('GET', `instance/connectionStatus/${instanceName}`);
  }

  async setWebhook(instanceName: string, url: string) {
    return this.request('POST', `webhook/set/${instanceName}`, {
      url,
      enabled: true,
      webhook_by_events: false,
      events: [
        'MESSAGES_UPSERT',
        'MESSAGES_UPDATE',
        'MESSAGES_DELETE',
        'SEND_MESSAGE',
        'CONNECTION_UPDATE',
        'PRESENCE_UPDATE',
        'CHATS_UPSERT',
        'CHATS_UPDATE',
        'CHATS_DELETE',
      ],
    });
  }
}
