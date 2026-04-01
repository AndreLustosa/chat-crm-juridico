import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { LeadsService } from '../leads/leads.service';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  
  constructor(
    private readonly settingsService: SettingsService,
    @Inject(forwardRef(() => LeadsService)) private readonly leadsService: LeadsService,
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

  async sendText(number: string, text: string, instanceName?: string, quoted?: { key: { remoteJid: string; fromMe: boolean; id: string }; message: { conversation: string } }) {
    const targetInstance = instanceName || process.env.EVOLUTION_INSTANCE_NAME || 'crm_instance';
    const payload: any = { number, text };
    if (quoted) payload.quoted = quoted;
    return this.request('POST', `message/sendText/${targetInstance}`, payload);
  }

  async deleteForEveryone(instanceName: string, remoteJid: string, externalMessageId: string, fromMe: boolean) {
    const targetInstance = instanceName || process.env.EVOLUTION_INSTANCE_NAME || 'crm_instance';
    return this.request('DELETE', `chat/deleteMessageForEveryone/${targetInstance}`, {
      id: externalMessageId,
      remoteJid,
      fromMe,
    });
  }

  async editMessage(instanceName: string, number: string, externalMessageId: string, newText: string) {
    const targetInstance = instanceName || process.env.EVOLUTION_INSTANCE_NAME || 'crm_instance';
    const remoteJid = `${number}@s.whatsapp.net`;
    return this.request('POST', `chat/updateMessage/${targetInstance}`, {
      number,
      text: newText,
      key: {
        id: externalMessageId,
        fromMe: true,
        remoteJid,
      },
    });
  }

  async sendMedia(
    number: string,
    mediaType: 'image' | 'audio' | 'document' | 'video',
    mediaUrl: string,
    caption?: string,
    instanceName?: string,
    fileName?: string,
  ) {
    const targetInstance = instanceName || process.env.EVOLUTION_INSTANCE_NAME || 'crm_instance';

    if (mediaType === 'audio') {
      return this.request('POST', `message/sendWhatsAppAudio/${targetInstance}`, {
        number,
        audio: mediaUrl,
      });
    }

    return this.request('POST', `message/sendMedia/${targetInstance}`, {
      number,
      mediatype: mediaType,
      media: mediaUrl,
      caption: caption || '',
      ...(fileName ? { fileName } : {}),
    });
  }

  // --- REAÇÕES ---

  async sendReaction(instanceName: string, key: { remoteJid: string; fromMe: boolean; id: string }, emoji: string) {
    const inst = instanceName || process.env.EVOLUTION_INSTANCE_NAME || 'crm_instance';
    return this.request('POST', `message/sendReaction/${inst}`, { key, reaction: emoji });
  }

  // --- PRESENÇA & LEITURA ---

  async markAsRead(instanceName: string, readMessages: { remoteJid: string; fromMe: false; id: string }[]) {
    const inst = instanceName || process.env.EVOLUTION_INSTANCE_NAME || 'crm_instance';
    return this.request('POST', `chat/markMessageAsRead/${inst}`, { readMessages });
  }

  async sendPresence(instanceName: string, number: string, presence: 'composing' | 'recording' | 'paused') {
    const inst = instanceName || process.env.EVOLUTION_INSTANCE_NAME || 'crm_instance';
    return this.request('POST', `chat/sendPresence/${inst}`, {
      number,
      options: { delay: 2000, presence },
    });
  }

  // --- CONFIGURAÇÕES DE INSTÂNCIA ---

  async setInstanceSettings(instanceName: string, settings: Record<string, any>) {
    const inst = instanceName || process.env.EVOLUTION_INSTANCE_NAME || 'crm_instance';
    return this.request('POST', `settings/set/${inst}`, settings);
  }

  // --- GESTÃO DE INSTÂNCIAS ---

  async listInstances() {
    const data = await this.request('GET', 'instance/fetchInstances');
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
      rejectCall: true,
      msgCall: 'No momento estamos atendendo apenas por mensagem de texto. Por favor, envie sua mensagem aqui.',
      alwaysOnline: true,
    };

    // Automação: Configurar Webhook diretamente no create para Evolution v2
    if (config.webhookUrl) {
      this.logger.log(`Provisionando instância ${instanceName} com webhook automático: ${config.webhookUrl}`);
      payload.webhook = {
        enabled: true,
        url: config.webhookUrl,
        byEvents: false,
        base64: false,
        retryDelay: 5000,
        maxRetries: 5,
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
      // Retry automático: tenta reenviar até 5 vezes com intervalo de 5s
      // Garante entrega mesmo se o CRM estiver temporariamente indisponível
      retryDelay: 5000,
      maxRetries: 5,
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
      // POST /chat/findContacts com { where: {} } para trazer TODOS os contatos
      let data = await this.request(
        'POST',
        `chat/findContacts/${instanceName}`,
        { where: {} },
      );

      // Fallback: GET endpoints antigos
      if (!data || (data as any).statusCode === 404 || (data as any).error) {
        this.logger.log(`findContacts indisponível para ${instanceName}, tentando fetchContacts...`);
        data = await this.request('GET', `chat/fetchContacts/${instanceName}`);
      }
      if (!data || (data as any).statusCode === 404 || (data as any).error ||
          !((data as any).data || (Array.isArray(data) && data.length > 0))) {
        this.logger.log(`fetchContacts indisponível para ${instanceName}, tentando contact/find...`);
        data = await this.request('GET', `contact/find/${instanceName}`);
      }

      const list = Array.isArray(data) ? data : (data as any)?.data || [];
      this.logger.log(`fetchContacts ${instanceName}: ${list.length} contatos retornados`);
      return list;
    } catch (e) {
      this.logger.error(`Erro ao buscar contatos para ${instanceName}: ${e}`);
      return [];
    }
  }

  async fetchProfilePicture(instanceName: string, number: string) {
    try {
      // Evolution API aceita tanto "5511999..." quanto "5511999...@s.whatsapp.net"
      const cleanNumber = number.replace(/@s\.whatsapp\.net$/, '');
      const data = await this.request(
        'POST',
        `chat/fetchProfilePictureUrl/${instanceName}`,
        { number: cleanNumber },
      );
      const url = data?.profilePictureUrl || data?.profile_picture || data?.data?.profile_picture || data?.url || null;
      if (!url) {
        this.logger.debug(`[fetchProfilePicture] Sem foto para ${cleanNumber} na instância ${instanceName}. Resposta: ${JSON.stringify(data)}`);
      }
      return url;
    } catch (e: any) {
      this.logger.debug(`[fetchProfilePicture] Erro ao buscar foto de ${number}: ${e?.message}`);
      return null;
    }
  }

  async fetchMessages(instanceName: string, remoteJid: string): Promise<any[]> {
    // Evolution API v2.3+ retorna: { messages: { total, pages, currentPage, records: [...] } }
    // Versões mais antigas retornam um array direto — tratamos os dois formatos.
    let allMessages: any[] = [];

    try {
      let currentPage = 1;
      let totalPages = 1;

      do {
        const data: any = await this.request(
          'POST',
          `chat/findMessages/${instanceName}`,
          { where: { key: { remoteJid } }, page: currentPage },
        );

        if (data?.error || data?.statusCode >= 400) {
          this.logger.warn(`fetchMessages error for ${remoteJid}: ${JSON.stringify(data)}`);
          break;
        }

        // Normaliza os dois formatos de resposta
        let records: any[];
        if (Array.isArray(data)) {
          // Formato antigo: array direto
          records = data;
          totalPages = 1; // sem paginação neste formato
        } else if (data?.messages?.records) {
          // Formato v2.3+: { messages: { total, pages, currentPage, records } }
          records = data.messages.records;
          totalPages = data.messages.pages ?? 1;
        } else if (Array.isArray(data?.messages)) {
          // Formato intermediário: { messages: [...] }
          records = data.messages;
          totalPages = 1;
        } else {
          records = data?.data || [];
          totalPages = 1;
        }

        if (records.length === 0) break;

        allMessages = allMessages.concat(records);
        this.logger.log(
          `fetchMessages ${instanceName}/${remoteJid} page ${currentPage}/${totalPages}: ${records.length} msgs (total: ${allMessages.length})`,
        );

        currentPage++;
      } while (currentPage <= totalPages);

      // Ordena cronologicamente (mais antigo primeiro)
      allMessages.sort((a, b) => {
        const ta = Number(a.messageTimestamp ?? a.key?.timestamp ?? 0);
        const tb = Number(b.messageTimestamp ?? b.key?.timestamp ?? 0);
        return ta - tb;
      });

      this.logger.log(`fetchMessages ${instanceName}/${remoteJid}: ${allMessages.length} msgs totais`);
      return allMessages;
    } catch (e) {
      this.logger.error(`Erro ao buscar mensagens para ${remoteJid}: ${e}`);
      return allMessages;
    }
  }

  async fetchChats(instanceName: string) {
    try {
      // POST /chat/findChats com { where: {} } para trazer TODOS os chats (incluindo não salvos)
      let data = await this.request(
        'POST',
        `chat/findChats/${instanceName}`,
        { where: {} },
      );

      // Fallback: GET /chat/fetchChats
      if (!data || (data as any).statusCode === 404 || (data as any).error) {
        this.logger.log(`findChats indisponível para ${instanceName}, tentando fetchChats (GET)...`);
        data = await this.request('GET', `chat/fetchChats/${instanceName}`);
      }

      if (!data || (data as any).statusCode >= 400 || (data as any).error) {
        this.logger.error(`Falha ao buscar chats para ${instanceName}: ${JSON.stringify(data)}`);
        return [];
      }

      const list = Array.isArray(data) ? data : (data as any)?.data || [];
      this.logger.log(`fetchChats ${instanceName}: ${list.length} chats retornados`);

      // Se poucos resultados, tentar paginar (algumas versões limitam por padrão)
      if (list.length > 0) {
        let allChats = [...list];
        let page = 2;
        const pageSize = list.length; // usar o tamanho da primeira página como referência

        // Se a primeira página retornou um número "redondo" (múltiplo de 50/100), provavelmente há mais
        while (pageSize >= 50 && page <= 20) {
          try {
            const moreData = await this.request(
              'POST',
              `chat/findChats/${instanceName}`,
              { where: {}, page, limit: pageSize },
            );
            const moreList = Array.isArray(moreData) ? moreData : (moreData as any)?.data || [];
            if (moreList.length === 0) break;
            allChats = [...allChats, ...moreList];
            this.logger.log(`fetchChats ${instanceName} page ${page}: +${moreList.length} chats`);
            if (moreList.length < pageSize) break; // última página
            page++;
          } catch {
            break; // paginação não suportada nesta versão
          }
        }

        if (allChats.length > list.length) {
          this.logger.log(`fetchChats ${instanceName}: total ${allChats.length} chats após paginação`);
        }
        return allChats;
      }

      return list;
    } catch (e) {
      this.logger.error(`Erro ao buscar chats para ${instanceName}: ${e}`);
      return [];
    }
  }

  async syncContacts(instanceName: string, tenantId?: string) {
    // 0. Buscar o inbox vinculado a esta instância para marcar as conversas corretamente
    const inbox = await (this.prisma as any).instance.findUnique({
      where: { name: instanceName },
      include: { inbox: true }
    });
    const inboxId = inbox?.inbox_id || null;

    // Busca apenas chats — inclui contatos não salvos na agenda (via pushName do WhatsApp)
    // findContacts só retorna quem está salvo na agenda e foi removido propositalmente
    const chatsList = await this.fetchChats(instanceName);

    this.logger.log(`Sync ${instanceName}: ${chatsList.length} chats para o setor ${inbox?.inbox?.name || 'Nenhum'}`);

    // Log amostra da estrutura para debug
    if (chatsList.length > 0) {
      this.logger.log(`Amostra chat[0] keys: ${Object.keys(chatsList[0]).join(', ')}`);
      this.logger.log(`Amostra chat[0]: ${JSON.stringify(chatsList[0]).substring(0, 300)}`);
    }

    const allEntries = chatsList;

    if (allEntries.length === 0) {
      return { total: 0, synced: 0, error: 'Nenhum chat encontrado' };
    }

    const seenPhones = new Set<string>();
    let updatedCount = 0;
    let skippedGroups = 0;
    let skippedInvalid = 0;

    for (const entry of allEntries) {
      try {
        // findChats retorna: { remoteJid, isGroup, pushName, profilePicUrl, ... }
        // findContacts retorna: { remoteJid, pushName, number, ... }
        const remoteJid: string = entry.remoteJid || '';

        // ---- FILTRAR GRUPOS, BROADCASTS, STATUS ----
        if (entry.isGroup === true) { skippedGroups++; continue; }
        if (remoteJid.includes('@g.us'))        { skippedGroups++; continue; }
        if (remoteJid.includes('@broadcast'))   { skippedGroups++; continue; }
        if (remoteJid.includes('status@'))      { skippedGroups++; continue; }
        if (remoteJid === 'status@broadcast')   { skippedGroups++; continue; }

        // ---- EXTRAIR PHONE ----
        let phone = '';

        const finalRemoteJid = entry.remoteJidAlt || entry.remoteJid || '';

        if (finalRemoteJid.includes('@s.whatsapp.net')) {
          phone = finalRemoteJid.split('@')[0];
        } else if (entry.number) {
          phone = String(entry.number);
        }

        phone = phone.replace(/\D/g, '');

        // Descartar inválidos
        if (!phone || phone.length < 10 || phone.length > 15) {
          skippedInvalid++;
          continue;
        }

        // Dedup: mesmo phone de contacts e chats
        if (seenPhones.has(phone)) continue;
        seenPhones.add(phone);

        // Jid para external_id da conversa
        const jid = remoteJid || `${phone}@s.whatsapp.net`;

        // Foto de perfil (usa profilePicUrl do findChats se disponível)
        const profilePictureUrl = entry.profilePicUrl ||
          await this.fetchProfilePicture(instanceName, phone);

        const lead = await this.leadsService.upsert({
          name: (entry.pushName || entry.name || entry.verifiedName || null) as string | null,
          phone: phone as string,
          profile_picture_url: profilePictureUrl || null,
          origin: 'whatsapp',
          tenant: tenantId ? { connect: { id: tenantId } } : undefined,
          stage: 'NOVO',
        });

        // Cria conversa se não existir ou atualiza metadados se faltarem
        let existingConv = await this.prisma.conversation.findFirst({
          where: {
            lead_id: lead.id,
            channel: 'whatsapp',
            status: 'ABERTO',
            // Se já tiver uma com o mesmo instance_name, OK. 
            // Se não tiver instance_name, tentamos achar pelo lead_id + canal
          },
        });

        if (!existingConv) {
          existingConv = await this.prisma.conversation.create({
            data: {
              lead_id: lead.id,
              channel: 'whatsapp',
              status: 'ABERTO',
              external_id: jid,
              instance_name: instanceName,
              inbox_id: inboxId,
              tenant_id: tenantId,
            },
          });
        } else {
          // Garante que a conversa tenha os metadados corretos
          existingConv = await this.prisma.conversation.update({
            where: { id: existingConv.id },
            data: {
              instance_name: instanceName,
              inbox_id: inboxId,
              external_id: jid,
              tenant_id: tenantId || existingConv.tenant_id,
            },
          });
        }

        // 3. Sincronizar a Última Mensagem (para a conversa aparecer no Chat)
        if (entry.lastMessage && existingConv) {
          const lm = entry.lastMessage;
          const msgId = lm.key?.id || lm.id;
          const msgText = lm.message?.conversation || 
                          lm.message?.extendedTextMessage?.text || 
                          lm.message?.imageMessage?.caption || 
                          (lm.messageType !== 'conversation' ? `[${lm.messageType}]` : '');

          if (msgId && msgText) {
            await this.prisma.message.upsert({
              where: { external_message_id: msgId },
              update: {
                status: lm.status || 'recebido',
                text: msgText,
              },
              create: {
                conversation_id: existingConv.id,
                direction: lm.key?.fromMe ? 'out' : 'in',
                type: 'text', // Simplificado para o sync inicial
                text: msgText,
                external_message_id: msgId,
                status: lm.status || 'recebido',
                created_at: lm.messageTimestamp ? new Date(lm.messageTimestamp * 1000) : new Date(),
              },
            });

            // Atualiza o timestamp da conversa
            await this.prisma.conversation.update({
              where: { id: existingConv.id },
              data: { last_message_at: lm.messageTimestamp ? new Date(lm.messageTimestamp * 1000) : new Date() }
            });
          }
        }

        updatedCount++;
      } catch (e) {
        this.logger.error(
          `Erro ao sincronizar entrada: ${JSON.stringify(entry).substring(0, 200)} - ${e.message}`,
        );
      }
    }

    this.logger.log(
      `Sync ${instanceName} concluído: ${updatedCount} sincronizados, ` +
      `${skippedGroups} grupos/broadcasts ignorados, ${skippedInvalid} inválidos, ` +
      `${seenPhones.size} phones únicos de ${allEntries.length} chats`,
    );
    return { total: allEntries.length, synced: updatedCount, skippedGroups, skippedInvalid, uniquePhones: seenPhones.size };
  }

}
