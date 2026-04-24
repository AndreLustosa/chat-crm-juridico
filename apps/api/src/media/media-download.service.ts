import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FileStorageService } from './filesystem.service';
import { SettingsService } from '../settings/settings.service';
import { GoogleDriveService } from '../google-drive/google-drive.service';
import { ChatGateway } from '../gateway/chat.gateway';
import axios from 'axios';
import * as crypto from 'crypto';

/**
 * Servico de download sincrono de midia — estilo Chatwoot simplificado.
 *
 * Baixa midia da Evolution API, escreve no filesystem local e cria o record Media,
 * tudo no mesmo processo da API (sem BullMQ worker). Se falhar, frontend pode
 * clicar "Recarregar" e o retryDownload() tenta de novo.
 *
 * Fluxo de uso:
 * 1. EvolutionService dispara downloadAndStore() em background (sem await)
 * 2. Service faz retry interno (3x com backoff 2s/5s/10s)
 * 3. Emite messageUpdate via ChatGateway ao final (sucesso ou falha total)
 */
@Injectable()
export class MediaDownloadService {
  private readonly logger = new Logger(MediaDownloadService.name);

  /** Timeout para baixar mídia da Evolution API (60s cobre PDFs de 16MB) */
  private static readonly DOWNLOAD_TIMEOUT = 60_000;

  /** Backoff em ms entre tentativas */
  private static readonly RETRY_DELAYS = [2_000, 5_000, 10_000];

  constructor(
    private prisma: PrismaService,
    private fileStorage: FileStorageService,
    private settings: SettingsService,
    @Inject(forwardRef(() => GoogleDriveService))
    private driveService: GoogleDriveService,
    @Inject(forwardRef(() => ChatGateway))
    private chatGateway: ChatGateway,
  ) {}

  /**
   * Baixa mídia da Evolution API, escreve no filesystem, cria record no Prisma.
   * Retry interno: tenta até 3 vezes com backoff.
   * Emite messageUpdate no final (sucesso ou falha definitiva).
   * Retorna true se salvou com sucesso, false caso contrário.
   */
  async downloadAndStore(params: {
    messageId: string;
    conversationId: string;
    externalMessageId: string;
    instanceName?: string;
    mediaData: any;
  }): Promise<boolean> {
    const { messageId, conversationId, externalMessageId, instanceName, mediaData } = params;

    for (let attempt = 1; attempt <= 3; attempt++) {
      const success = await this.attemptDownload({
        messageId,
        conversationId,
        externalMessageId,
        instanceName,
        mediaData,
        attempt,
      });

      if (success) {
        // Emite messageUpdate com mídia pronta
        await this.emitMessageUpdate(messageId);
        return true;
      }

      // Aguarda backoff antes da próxima tentativa (se houver)
      if (attempt < 3) {
        const delay = MediaDownloadService.RETRY_DELAYS[attempt - 1];
        this.logger.warn(`[MEDIA-SYNC] Tentativa ${attempt}/3 falhou para msg ${messageId} — retry em ${delay / 1000}s`);
        await new Promise(r => setTimeout(r, delay));
      }
    }

    // Todas as tentativas falharam — ainda emite messageUpdate para frontend
    // saber que pode mostrar botão "Recarregar" (Media record ficou null)
    this.logger.error(`[MEDIA-SYNC] Download falhou definitivamente após 3 tentativas para msg ${messageId}`);
    await this.emitMessageUpdate(messageId);
    return false;
  }

  /**
   * Retry manual acionado pelo frontend (POST /media/:id/retry).
   * Usa mesma lógica mas retorna erro detalhado para o controller.
   */
  async retryDownload(messageId: string): Promise<{ ok: boolean; reason?: 'not_found' | 'no_media_data' | 'expired' | 'download_failed' }> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        conversation_id: true,
        external_message_id: true,
        type: true,
        conversation: { select: { instance_name: true } },
        media: true,
      },
    });

    if (!message) return { ok: false, reason: 'not_found' };

    // Se já tem mídia salva, só emite e retorna ok
    if (message.media?.file_path || message.media?.s3_key) {
      await this.emitMessageUpdate(messageId);
      return { ok: true };
    }

    if (!message.external_message_id) {
      return { ok: false, reason: 'no_media_data' };
    }

    this.logger.log(`[MEDIA-RETRY] Tentativa manual para msg ${messageId}`);

    const success = await this.downloadAndStore({
      messageId: message.id,
      conversationId: message.conversation_id,
      externalMessageId: message.external_message_id,
      instanceName: message.conversation?.instance_name || undefined,
      mediaData: { url: (message.media as any)?.original_url },
    });

    if (success) return { ok: true };

    // Se URL Evolution expirou (>48h desde criação), retorna erro específico
    const messageAge = Date.now() - new Date((await this.prisma.message.findUnique({ where: { id: messageId }, select: { created_at: true } }))!.created_at).getTime();
    if (messageAge > 48 * 60 * 60 * 1000) {
      return { ok: false, reason: 'expired' };
    }

    return { ok: false, reason: 'download_failed' };
  }

  // ─── Implementação interna ──────────────────────────────────────

  private async attemptDownload(params: {
    messageId: string;
    conversationId: string;
    externalMessageId: string;
    instanceName?: string;
    mediaData: any;
    attempt: number;
  }): Promise<boolean> {
    const { messageId, conversationId, externalMessageId, instanceName, mediaData, attempt } = params;

    try {
      const { apiUrl, apiKey } = await this.settings.getWhatsAppConfig();
      if (!apiUrl) {
        this.logger.warn('[MEDIA-SYNC] EVOLUTION_API_URL não configurada');
        return false;
      }

      const instance = instanceName || process.env.EVOLUTION_INSTANCE_NAME || '';

      const response = await axios.post(
        `${apiUrl}/chat/getBase64FromMediaMessage/${instance}`,
        { message: { key: { id: externalMessageId } } },
        {
          headers: { apikey: apiKey },
          timeout: MediaDownloadService.DOWNLOAD_TIMEOUT,
          maxContentLength: 30 * 1024 * 1024, // 30MB limite de segurança
        },
      );

      const base64Data = response.data?.base64;
      const mimeType = response.data?.mimetype || 'application/octet-stream';

      if (!base64Data) {
        this.logger.warn(`[MEDIA-SYNC] Sem base64 retornado para msg ${messageId} (tentativa ${attempt})`);
        return false;
      }

      const buffer = Buffer.from(base64Data, 'base64');
      const checksum = crypto.createHash('md5').update(buffer).digest('hex');
      const size = buffer.length;

      // Gera path particionado YYYY/MM/{msgId}.{ext}
      const mimeBase = mimeType.split(';')[0].trim();
      const ext = mimeBase.split('/')[1] || 'bin';
      const filePath = this.fileStorage.generatePath(messageId, ext);

      // Escreve no filesystem — abordagem estilo Chatwoot. Upload S3 foi
      // removido propositalmente (complexidade + latencia + erros). Worker
      // de IA busca via HTTP interno (GET /media/:id no crm-api).
      await this.fileStorage.write(filePath, buffer);

      // Upsert Media record (se retry, atualiza; se primeiro, cria)
      const media = await this.prisma.media.upsert({
        where: { message_id: messageId },
        create: {
          message_id: messageId,
          file_path: filePath,
          mime_type: mimeType,
          size,
          checksum,
          duration: mediaData?.seconds ?? null,
          original_url: mediaData?.url ?? null,
          original_name: mediaData?.fileName ?? null,
        },
        update: {
          file_path: filePath,
          mime_type: mimeType,
          size,
          checksum,
          duration: mediaData?.seconds ?? null,
        },
      });

      this.logger.log(`[MEDIA-SYNC] Mídia salva: ${filePath} (${(size / 1024).toFixed(0)}KB, tentativa ${attempt})`);

      // Google Drive auto-upload (fire-and-forget)
      this.uploadToDriveIfNeeded(media, messageId, conversationId).catch(e =>
        this.logger.warn(`[MEDIA-SYNC][DRIVE] Falha: ${e.message}`),
      );

      return true;
    } catch (e: any) {
      const reason = e.code === 'ECONNABORTED' ? 'timeout' : (e.response?.status ? `HTTP ${e.response.status}` : e.message);
      this.logger.warn(`[MEDIA-SYNC] Tentativa ${attempt} falhou para msg ${messageId}: ${reason}`);
      return false;
    }
  }

  /** Busca a mensagem completa e emite messageUpdate via socket */
  private async emitMessageUpdate(messageId: string): Promise<void> {
    try {
      const message = await this.prisma.message.findUnique({
        where: { id: messageId },
        include: { media: true, skill: { select: { id: true, name: true, area: true } } },
      });
      if (message) {
        this.chatGateway.emitMessageUpdate(message.conversation_id, message);
      }
    } catch (e: any) {
      this.logger.warn(`[MEDIA-SYNC] Falha ao emitir messageUpdate para ${messageId}: ${e.message}`);
    }
  }

  /** Upload automático de documentos/imagens para Google Drive do lead */
  private async uploadToDriveIfNeeded(media: any, messageId: string, conversationId: string): Promise<void> {
    if (!media?.mime_type || !media?.file_path) return;

    const isDocument = media.mime_type.startsWith('application/') || media.mime_type.startsWith('image/');
    if (!isDocument) return;

    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { lead: { select: { id: true, name: true, google_drive_folder_id: true } } },
    });

    if (!conv?.lead?.google_drive_folder_id) return;

    const configured = await this.driveService.isConfigured();
    if (!configured) return;

    const fileBuffer = await this.fileStorage.read(media.file_path);
    if (!fileBuffer) return;

    const fileName = media.original_name || `${messageId}${this.getExtension(media.mime_type)}`;

    await this.driveService.uploadFile(
      conv.lead.google_drive_folder_id,
      fileName,
      media.mime_type,
      fileBuffer,
    );

    this.logger.log(`[MEDIA-SYNC][DRIVE] "${fileName}" enviado ao Drive`);
  }

  private getExtension(mimeType: string): string {
    const map: Record<string, string> = {
      'application/pdf': '.pdf',
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
      'application/msword': '.doc',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    };
    return map[mimeType] || '';
  }
}
