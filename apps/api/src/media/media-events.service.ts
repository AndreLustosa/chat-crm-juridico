import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { QueueEvents, Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { GoogleDriveService } from '../google-drive/google-drive.service';
import { MediaS3Service } from './s3.service';

@Injectable()
export class MediaEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MediaEventsService.name);
  private queueEvents: QueueEvents;
  private queue: Queue;

  constructor(
    private prisma: PrismaService,
    private chatGateway: ChatGateway,
    private driveService: GoogleDriveService,
    private s3Service: MediaS3Service,
  ) {}

  onModuleInit() {
    const connection = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      maxRetriesPerRequest: null as any,
      enableReadyCheck: false,
    };

    // Queue para buscar dados do job pelo ID
    const prefix = process.env.BULL_PREFIX || 'bull';
    this.queue = new Queue('media-jobs', { connection, prefix });
    this.queueEvents = new QueueEvents('media-jobs', { connection, prefix });

    this.queueEvents.on('completed', async ({ jobId }) => {
      try {
        // Busca o job pelo ID para obter message_id e conversation_id do data
        const job = await this.queue.getJob(jobId);
        if (!job) {
          this.logger.warn(`[WS] Job ${jobId} não encontrado`);
          return;
        }

        const messageId: string = job.data.message_id;
        const conversationId: string = job.data.conversation_id;

        if (!messageId || !conversationId) {
          this.logger.warn(`[WS] Job ${jobId} sem message_id ou conversation_id`);
          return;
        }

        // Busca mensagem atualizada com mídia no banco
        // Retry com delay: o worker pode ter retornado antes do Media record ser visível
        // para esta conexão, ou a mensagem pode estar em commit pendente.
        let message = await this.prisma.message.findUnique({
          where: { id: messageId },
          include: { media: true },
        });

        if (!message || !message.media) {
          // Aguarda 2s e tenta novamente — cobre race conditions de commit
          await new Promise(r => setTimeout(r, 2000));
          message = await this.prisma.message.findUnique({
            where: { id: messageId },
            include: { media: true },
          });
        }

        if (!message) {
          this.logger.warn(`[WS] Mensagem ${messageId} não encontrada após retry`);
          return;
        }

        // Emite evento para o room da conversa (fallback — usado quando download síncrono falhou)
        this.chatGateway.server?.to(conversationId).emit('messageUpdate', message);
        this.logger.log(`[WS] messageUpdate (media fallback) emitido: msg=${messageId} conv=${conversationId}`);

        // Auto-upload de documentos para Google Drive (se lead tem pasta)
        if (message.media && message.direction === 'in') {
          this.uploadMediaToDrive(message, conversationId).catch(e =>
            this.logger.warn(`[DRIVE-SYNC] Falha: ${e.message}`),
          );
        }
      } catch (e: any) {
        this.logger.error(`Erro no MediaEventsService: ${e.message}`);
      }
    });

    this.queueEvents.on('error', (err) => {
      this.logger.error(`[QueueEvents] Erro de conexão: ${err.message}`);
    });

    this.logger.log('Escutando eventos de conclusão de media-jobs via QueueEvents');
  }

  /**
   * Upload automático de mídia do chat para a pasta do lead no Google Drive.
   * Só faz upload de documentos (PDF, DOC, imagens) — ignora áudios curtos.
   */
  private async uploadMediaToDrive(message: any, conversationId: string) {
    const media = message.media;
    if (!media?.s3_key || !media?.mime_type) return;

    // Só fazer upload de documentos e imagens (não áudios de voz)
    const isDocument = media.mime_type.startsWith('application/') || media.mime_type.startsWith('image/');
    if (!isDocument) return;

    // Buscar lead da conversa
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { lead_id: true, lead: { select: { id: true, name: true, google_drive_folder_id: true } } },
    });

    if (!conv?.lead?.google_drive_folder_id) return; // Lead sem pasta no Drive

    try {
      // Verificar se Drive está configurado
      const configured = await this.driveService.isConfigured();
      if (!configured) return;

      // Baixar arquivo do S3
      const fileBuffer = await this.s3Service.getFileBuffer(media.s3_key);
      if (!fileBuffer) return;

      const fileName = media.original_name || `${message.id}${this.getExtension(media.mime_type)}`;

      // Upload para Drive
      await this.driveService.uploadFile(
        conv.lead.google_drive_folder_id,
        fileName,
        media.mime_type,
        fileBuffer,
      );

      this.logger.log(`[DRIVE-SYNC] Arquivo "${fileName}" enviado ao Drive (lead: ${conv.lead.name || conv.lead.id})`);
    } catch (e: any) {
      this.logger.warn(`[DRIVE-SYNC] Erro ao enviar para Drive: ${e.message}`);
    }
  }

  private getExtension(mimeType: string): string {
    const map: Record<string, string> = {
      'application/pdf': '.pdf',
      'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
      'application/msword': '.doc',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    };
    return map[mimeType] || '';
  }

  async onModuleDestroy() {
    await this.queueEvents?.close();
    await this.queue?.close();
  }
}
