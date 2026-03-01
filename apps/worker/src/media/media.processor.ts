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
    this.logger.log(`Iniciando job de mídia: ${job.id}`);

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
}
