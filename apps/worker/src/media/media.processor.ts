import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import axios from 'axios';

/**
 * Worker da queue `media-jobs` — AGORA só processa resync de mensagens.
 *
 * O job `download_media` foi REMOVIDO nesta versão. Download de mídia
 * agora é síncrono dentro da API (MediaDownloadService), sem BullMQ.
 *
 * Jobs ativos:
 * - `sync_missed_messages`: busca mensagens da Evolution API após reconexão
 *   e importa as que não estão no banco.
 */
@Processor('media-jobs')
export class MediaProcessor extends WorkerHost {
  private readonly logger = new Logger(MediaProcessor.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`Iniciando job: ${job.id} (name=${job.name})`);

    if (job.name === 'sync_missed_messages') {
      return this.syncMissedMessages(job.data);
    }

    // Job desconhecido (ex: download_media antigo que ainda esteja na queue)
    // Ignora silenciosamente para não spammear logs.
    this.logger.warn(`[MEDIA-WORKER] Job name desconhecido "${job.name}" — ignorando`);
    return null;
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

    // Cutoff: só importar mensagens posteriores à criação do lead atual.
    // Evita reimportar histórico de leads excluídos (a Evolution mantém o chat).
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversation_id },
      include: { lead: { select: { created_at: true } } },
    });
    if (!conv) {
      this.logger.warn(`[RESYNC] Conversa ${conversation_id} não encontrada — abortando resync`);
      return { imported: 0 };
    }
    const cutoffTs = conv?.lead?.created_at
      ? Math.floor(new Date(conv.lead.created_at).getTime() / 1000)
      : 0;

    let imported = 0;
    let latestTs: Date | null = null;
    for (const msg of rawMessages) {
      try {
        const externalId: string | undefined = msg.key?.id || msg.id;
        if (!externalId) continue;

        const msgTs = Number(msg.messageTimestamp || 0);
        if (cutoffTs > 0 && msgTs > 0 && msgTs < cutoffTs) continue;

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

        if (!latestTs || ts > latestTs) latestTs = ts;

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
      const updateTs = latestTs && conv.last_message_at && latestTs > conv.last_message_at
        ? latestTs
        : latestTs || conv.last_message_at || new Date();
      await this.prisma.conversation.update({
        where: { id: conversation_id },
        data: { last_message_at: updateTs },
      });
    }

    return { imported };
  }
}
