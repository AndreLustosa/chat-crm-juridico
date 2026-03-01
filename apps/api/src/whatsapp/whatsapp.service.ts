import { Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import * as crypto from 'crypto';

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
    const data = await this.request('GET', 'instance/fetchInstances');
    this.logger.log(`Evolution API Response structure: ${Object.keys(data || {}).join(', ')}`);
    this.logger.log(`Evolution API Raw Data: ${JSON.stringify(data)}`);
    
    // Na v2, a Evolution retorna [{ instance: { ... } }] ou um objeto com { data: [...] }
    let instancesArray = (data as any)?.instances || (data as any)?.data || data;
    
    if (Array.isArray(instancesArray)) {
      return instancesArray.map(item => {
        const inst = item.instance || item;
        
        // Tenta encontrar o status em vários lugares comuns na v2 e v1
        const rawStatus = (
          inst.status || 
          inst.state || 
          inst.connectionStatus || 
          inst.connection?.state || 
          'connecting'
        ).toString().toLowerCase();
        
        // Mapeamento extra-robusto para 'open' (o que o front espera)
        const isOnline = ['open', 'connected', 'online', 'authenticated'].includes(rawStatus);
        const finalStatus = isOnline ? 'open' : rawStatus;

        this.logger.log(`Instance: ${inst.instanceName || inst.name} | Raw: ${rawStatus} | Final: ${finalStatus}`);

        return {
          ...inst,
          instanceName: inst.instanceName || inst.name || inst.id || 'Instância sem Nome',
          status: finalStatus
        };
      });
    }
    
    return data;
  }

  async createInstance(instanceName: string) {
    const randomToken = crypto.randomBytes(12).toString('hex');
    const config = await this.settingsService.getWhatsAppConfig();
    
    const payload: any = {
      instanceName,
      token: randomToken,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
    };

    // Automação: Configurar Webhook diretamente no create para Evolution v2
    if (config.webhookUrl) {
      this.logger.log(`Provisionando instância ${instanceName} com webhook automático: ${config.webhookUrl}`);
      payload.webhook = {
        enabled: true,
        url: config.webhookUrl,
        byEvents: false,
        base64: false,
        events: [
          'APPLICATION_STARTUP',
          'QRCODE_UPDATED',
          'MESSAGES_SET',
          'MESSAGES_UPSERT',
          'MESSAGES_UPDATE',
          'MESSAGES_DELETE',
          'SEND_MESSAGE',
          'CONTACTS_SET',
          'CONTACTS_UPSERT',
          'CONTACTS_UPDATE',
          'PRESENCE_UPDATE',
          'CHATS_SET',
          'CHATS_UPSERT',
          'CHATS_UPDATE',
          'CHATS_DELETE',
          'GROUP_PARTICIPANTS_UPDATE',
          'GROUP_UPDATE',
          'GROUPS_UPSERT',
          'CONNECTION_UPDATE',
          'CALL',
          'TYPEBOT_START',
          'TYPEBOT_CHANGE_STATUS'
        ]
      };
    } else {
      this.logger.warn(`⚠️ Webhook não configurado na criação de ${instanceName}: webhookUrl global está vazio.`);
    }

    const result = await this.request('POST', 'instance/create', payload);
    this.logger.log(`✅ Instância ${instanceName} criada com provisionamento automático.`);
    
    return result;
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

  async fetchContacts(instanceName: string) {
    return this.request('GET', `chat/fetchContacts/${instanceName}`);
  }
}
