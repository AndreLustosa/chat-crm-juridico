import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';
import { SettingsService } from '../settings/settings.service';
import axios from 'axios';
import * as crypto from 'crypto';

@Processor('media-jobs')
export class MediaProcessor extends WorkerHost {
  private readonly logger = new Logger(MediaProcessor.name);

  constructor(
    private prisma: PrismaService,
    private s3Service: S3Service,
    private settings: SettingsService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`Iniciando job de mídia: ${job.id} (name=${job.name})`);

    // ── Resync de mensagens perdidas após reconexão da instância ──────────────
    if (job.name === 'sync_missed_messages') {
      return this.syncMissedMessages(job.data);
    }

    const { message_id, conversation_id, remote_jid, msg_id, media_data, instance_name } = job.data;

    try {
      // 1. Ler config da Evolution do banco de dados
      const { apiUrl, apiKey } = await this.settings.getEvolutionConfig();

      if (!apiUrl) {
        this.logger.warn('EVOLUTION_API_URL não configurada no banco — abortando job de mídia');
        return;
      }

      // Instância: vem do job ou cai no env var como fallback
      const instance = instance_name || process.env.EVOLUTION_INSTANCE_NAME || '';

      // 2. Chamar a Evolution para baixar o content (base64)
      const downloadResponse = await axios.post(
        `${apiUrl}/chat/getBase64FromMediaMessage/${instance}`,
        { message: { key: { id: msg_id } } },
        { headers: { apikey: apiKey } }
      );

      const base64Data = downloadResponse.data.base64;
      const mimeType = downloadResponse.data.mimetype || 'application/octet-stream';

      if (!base64Data) {
        throw new Error('Sem base64 retornado da Evolution API');
      }

      // 3. Buffer & Checksum
      const buffer = Buffer.from(base64Data, 'base64');
      const checksum = crypto.createHash('md5').update(buffer).digest('hex');
      const size = buffer.length;

      // 4. Upload S3
      // Limpa parâmetros do mimetype: "audio/ogg; codecs=opus" → "ogg"
      const mimeBase = mimeType.split(';')[0].trim();
      const ext = mimeBase.split('/')[1] || 'bin';
      const s3Key = `media/${message_id}.${ext}`;
      await this.s3Service.uploadBuffer(s3Key, buffer, mimeType);

      this.logger.log(`Mídia subida com sucesso: ${s3Key}`);

      // 5. Update Prisma (Database)
      const duration: number | null = media_data?.seconds ?? null;
      const originalUrl: string | null = media_data?.url ?? null;
      // Para documentos, a Evolution API fornece o nome original do arquivo
      const originalName: string | null = media_data?.fileName ?? null;

      await this.prisma.media.create({
        data: {
          message_id: message_id,
          s3_key: s3Key,
          mime_type: mimeType,
          size,
          checksum,
          duration,
          original_url: originalUrl,
          original_name: originalName,
        }
      });

      this.logger.log(`Mídia processada e salva com sucesso: ${s3Key}`);

      // Retorna IDs para a API ouvir via QueueEvents e emitir WebSocket
      return { messageId: message_id, conversationId: conversation_id };
    } catch (e: any) {
      this.logger.error(`Erro ao processar mídia: ${e.message}`);
      throw e;
    }
  }

  /**
   * Busca mensagens recentes da Evolution API para uma conversa e importa
   * as que ainda não estão no banco. Usado após reconexão da instância WhatsApp
   * para recuperar mensagens perdidas durante a queda.
   */
  private async syncMissedMessages(data: { conversation_id: string; instance_name: string; phone: string }): Promise<{ imported: number }> {
    const { conversation_id, instance_name, phone } = data;
    const { apiUrl, apiKey } = await this.settings.getEvolutionConfig();

    if (!apiUrl) {
      this.logger.warn('[RESYNC] EVOLUTION_API_URL não configurada — abortando resync');
      return { imported: 0 };
    }

    const remoteJid = `${phone}@s.whatsapp.net`;

    // Evolution API v2.3+ retorna { messages: { total, pages, currentPage, records: [] } }
    let rawMessages: any[] = [];
    try {
      let currentPage = 1;
      let totalPages = 1;
      do {
        const response = await axios.post(
          `${apiUrl}/chat/findMessages/${instance_name}`,
          { where: { key: { remoteJid } }, page: currentPage },
          { headers: { apikey: apiKey } },
        );
        const data = response.data;
        let records: any[];
        if (Array.isArray(data)) {
          records = data; totalPages = 1;
        } else if (data?.messages?.records) {
          records = data.messages.records;
          totalPages = data.messages.pages ?? 1;
        } else if (Array.isArray(data?.messages)) {
          records = data.messages; totalPages = 1;
        } else {
          records = data?.data || []; totalPages = 1;
        }
        if (!records.length) break;
        rawMessages = rawMessages.concat(records);
        currentPage++;
      } while (currentPage <= totalPages);
    } catch (e: any) {
      this.logger.warn(`[RESYNC] Falha ao buscar mensagens para ${phone}: ${e.message}`);
      return { imported: 0 };
    }

    if (!rawMessages.length) return { imported: 0 };

    let imported = 0;
    for (const msg of rawMessages) {
      try {
        const externalId: string | undefined = msg.key?.id || msg.id;
        if (!externalId) continue;

        const exists = await this.prisma.message.findUnique({
          where: { external_message_id: externalId },
        });
        if (exists) continue;

        const text: string =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          (msg.messageType && msg.messageType !== 'conversation' ? `[${msg.messageType}]` : '') ||
          '';

        const fromMe: boolean = msg.key?.fromMe === true;
        const ts: Date = msg.messageTimestamp
          ? new Date(Number(msg.messageTimestamp) * 1000)
          : new Date();

        await this.prisma.message.create({
          data: {
            conversation_id,
            direction: fromMe ? 'out' : 'in',
            type: 'text',
            text,
            external_message_id: externalId,
            status: fromMe ? 'enviado' : 'recebido',
            created_at: ts,
          },
        });
        imported++;
      } catch (e: any) {
        this.logger.warn(`[RESYNC] Erro ao importar msg: ${e.message}`);
      }
    }

    if (imported > 0) {
      this.logger.log(`[RESYNC] ${imported}/${rawMessages.length} mensagens importadas para conversa ${conversation_id}`);
      await this.prisma.conversation.update({
        where: { id: conversation_id },
        data: { last_message_at: new Date() },
      });
    }

    return { imported };
  }
}
