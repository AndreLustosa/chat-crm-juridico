import { Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { LeadsService } from '../leads/leads.service';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  
  constructor(
    private readonly settingsService: SettingsService,
    private readonly leadsService: LeadsService,
    private readonly prisma: PrismaService,
  ) {}

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

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          `Erro Evolution API (${path}) - Status: ${response.status} - Resposta: ${errorText}`,
        );
        return { statusCode: response.status, error: errorText };
      }

      return await response.json();
    } catch (e) {
      this.logger.error(`Exceção na requisição Evolution API (${path}): ${e}`);
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
        'CONTACTS_UPSERT',
        'CONTACTS_UPDATE',
        'CONTACTS_SET',
      ],
    });
  }

  async fetchContacts(instanceName: string) {
    try {
      // 1. Tenta o endpoint POST /chat/findContacts (Versão v2.1.0+)
      let data = await this.request(
        'POST',
        `chat/findContacts/${instanceName}`,
        {},
      );

      // 2. Fallback: Se falhar (404), tenta o GET principal da v2 (Chat)
      if (!data || (data as any).statusCode === 404 || (data as any).error) {
        this.logger.log(
          `chat/findContacts (POST) indisponível para ${instanceName}, tentando chat/fetchContacts (GET)...`,
        );
        data = await this.request('GET', `chat/fetchContacts/${instanceName}`);
      }

      // 3. Fallback: GET contact/find
      if (
        !data ||
        (data as any).statusCode === 404 ||
        (data as any).error ||
        !((data as any).data || (Array.isArray(data) && data.length > 0))
      ) {
        this.logger.log(
          `chat/fetchContacts (GET) indisponível para ${instanceName}, tentando contact/find (GET)...`,
        );
        data = await this.request('GET', `contact/find/${instanceName}`);
      }

      this.logger.log(
        `Evolution API Contacts Response (Instance: ${instanceName}): ${JSON.stringify(
          data,
        ).substring(0, 500)}...`,
      );

      if (!data || (data as any).statusCode >= 400 || (data as any).error) {
        this.logger.error(
          `Falha definitiva ao buscar contatos para ${instanceName}: ${JSON.stringify(
            data,
          )}`,
        );
        return { data: [] };
      }

      return data;
    } catch (e) {
      this.logger.error(`Erro ao buscar contatos para ${instanceName}: ${e}`);
      return { data: [] };
    }
  }

  async fetchChats(instanceName: string) {
    try {
      const data = await this.request('GET', `chat/fetchChats/${instanceName}`);
      return data;
    } catch (e) {
      this.logger.error(`Erro ao buscar chats para ${instanceName}: ${e}`);
      return { data: [] };
    }
  }

  async syncContacts(instanceName: string, tenantId?: string) {
    const rawContacts = await this.fetchContacts(instanceName);
    const rawChats = await this.fetchChats(instanceName);

    const contactsList = Array.isArray(rawContacts)
      ? rawContacts
      : (rawContacts as any).data || (rawContacts as any).contacts || [];
    
    const chatsList = Array.isArray(rawChats)
      ? rawChats
      : (rawChats as any).data || (rawChats as any).chats || [];

    // Combinar ambos para garantir que pegamos contatos salvos e conversas ativas
    const allEntries = [...contactsList, ...chatsList];

    if (allEntries.length === 0) {
      return { total: 0, synced: 0, error: 'Nenhum contato ou chat encontrado' };
    }

    let updatedCount = 0;
    for (const contact of allEntries) {
      try {
        // Evolution v2: remoteJid costuma ser '55829...@s.whatsapp.net'
        // O campo 'id' na v2 é um hash interno (ex: cmm...) e NÃO deve ser usado como telefone.
        const rawJid = contact.remoteJid || '';
        let phone = '';

        if (rawJid && rawJid.includes('@')) {
          phone = rawJid.split('@')[0];
        } else if (contact.number) {
          phone = contact.number;
        }

        // Normalização: remover qualquer caractere que não seja dígito
        phone = phone.replace(/\D/g, '');

        // Normalização Especial Brasil: Nono Dígito
        phone = this.normalizeBrazilianPhone(phone);

        // Se o número for inválido ou for um ID interno da Evolution (cmm...)
        if (!phone || 
            phone.startsWith('cmm') || 
            phone.includes('broadcast') || 
            phone.includes('status') ||
            phone.length > 20) {
          continue;
        }

        const lead = await this.leadsService.upsert({
          name: (contact.name ||
            contact.pushName ||
            contact.verifiedName ||
            `Contato ${phone}`) as string,
          phone: phone as string,
          origin: 'whatsapp',
          tenant: tenantId ? { connect: { id: tenantId } } : undefined,
          stage: 'NOVO',
        });

        // Para paridade local/produção: cria conversa inicial para que apareça no Chat/CRM
        const existingConv = await this.prisma.conversation.findFirst({
          where: {
            lead_id: lead.id,
            channel: 'whatsapp',
            status: 'ABERTO',
          },
        });

        if (!existingConv) {
          await this.prisma.conversation.create({
            data: {
              lead_id: lead.id,
              channel: 'whatsapp',
              status: 'ABERTO',
              external_id: rawJid || `${phone}@s.whatsapp.net`,
            },
          });
          this.logger.log(`Conversa inicial criada para ${phone}`);
        }

        updatedCount++;
      } catch (e) {
        this.logger.error(
          `Erro ao sincronizar contato ${contact.id || contact.jid}: ${
            e.message
          }`,
        );
      }
    }

    return { total: allEntries.length, synced: updatedCount };
  }

  private normalizeBrazilianPhone(phone: string): string {
    // Se não é Brasil (55), não mexe
    if (!phone.startsWith('55')) return phone;

    // Formato esperado Br: 55 + DDD (2 digitos) + Numero
    // Mobile com 9 digitos: 55 + DD + 9 + 8 digitos = 13 digitos
    // Mobile com 8 digitos (legado): 55 + DD + 8 digitos = 12 digitos

    if (phone.length === 12) {
      const ddd = phone.substring(2, 4);
      const number = phone.substring(4);

      // Se o numero começa com [6, 7, 8, 9], é um celular que precisa de nono dígito
      if (['6', '7', '8', '9'].includes(number[0])) {
        return `55${ddd}9${number}`;
      }
    }

    return phone;
  }
}
