import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Res,
  Req,
  NotFoundException,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { MediaS3Service } from './s3.service';
import { Public } from '../auth/decorators/public.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import * as https from 'https';
import * as http from 'http';

@Controller('media')
export class MediaController {
  private readonly logger = new Logger(MediaController.name);

  constructor(
    private prisma: PrismaService,
    private s3: MediaS3Service,
    @InjectQueue('media-jobs') private mediaQueue: Queue,
  ) {}

  /**
   * POST /media/:messageId/retry — re-enfileira download de mídia para mensagens com problema.
   * Usado quando o worker falhou ou o áudio ficou indisponível.
   */
  @Post(':messageId/retry')
  @UseGuards(JwtAuthGuard)
  async retryMediaDownload(@Param('messageId') messageId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { media: true, conversation: { select: { id: true, instance_name: true } } },
    });

    if (!message) throw new NotFoundException('Mensagem não encontrada');

    // Se já tem mídia no S3, não precisa re-baixar
    if (message.media) {
      try {
        await this.s3.getObjectStream(message.media.s3_key);
        return { ok: true, message: 'Mídia já existe no storage', alreadyExists: true };
      } catch {
        // Mídia no banco mas não no S3 — deletar record e re-baixar
        await this.prisma.media.delete({ where: { id: message.media.id } });
        this.logger.warn(`[RETRY] Media record deletado para msg ${messageId} (S3 key ausente)`);
      }
    }

    if (!message.external_message_id) {
      throw new NotFoundException('Mensagem sem external_message_id — não é possível re-baixar');
    }

    const instanceName = message.conversation?.instance_name
      || process.env.EVOLUTION_INSTANCE_NAME || '';

    await this.mediaQueue.add('download_media', {
      message_id: message.id,
      conversation_id: message.conversation_id,
      media_data: null, // Dados originais perdidos, worker baixará o essencial
      remote_jid: null,
      msg_id: message.external_message_id,
      instance_name: instanceName,
    });

    this.logger.log(`[RETRY] Job de mídia re-enfileirado para msg ${messageId}`);
    return { ok: true, message: 'Download de mídia re-enfileirado' };
  }

  // Rota pública (sem JWT) para que a Evolution API possa baixar o áudio
  @Public()
  @Get(':messageId')
  async getMedia(
    @Param('messageId') messageId: string,
    @Query('dl') dl: string,
    @Req() req: any,
    @Res() res: any,
  ) {
    const media = await this.prisma.media.findUnique({
      where: { message_id: messageId },
    });

    if (!media) throw new NotFoundException('Mídia não encontrada');

    try {
      // Tenta servir do S3/MinIO primeiro
      let s3Available = true;
      let s3Result: Awaited<ReturnType<typeof this.s3.getObjectStream>> | null = null;
      try {
        s3Result = await this.s3.getObjectStream(media.s3_key);
      } catch (s3Err) {
        s3Available = false;
        this.logger.warn(`[MediaController] S3 key ausente para ${messageId}: ${(s3Err as Error).message}`);
      }

      // Fallback: proxy do original_url (Evolution API CDN) quando o S3 não tem o arquivo
      if (!s3Available && media.original_url) {
        this.logger.log(`[MediaController] Servindo via original_url para ${messageId}`);
        const protocol = media.original_url.startsWith('https') ? https : http;
        await new Promise<void>((resolve, reject) => {
          const req2 = protocol.get(media.original_url!, (proxyRes) => {
            // Forçar mime_type do banco quando proxy retorna genérico (ex: application/octet-stream)
            const proxyCt = proxyRes.headers['content-type'] || '';
            const ct = (proxyCt && proxyCt !== 'application/octet-stream') ? proxyCt : (media.mime_type || 'application/octet-stream');
            const cl = proxyRes.headers['content-length'];
            res.setHeader('Content-Type', ct);
            res.setHeader('Cache-Control', 'private, max-age=86400');
            res.setHeader('Accept-Ranges', 'none');
            if (cl) res.setHeader('Content-Length', cl);
            proxyRes.pipe(res);
            proxyRes.on('end', resolve);
            proxyRes.on('error', reject);
          });
          req2.on('error', reject);
        });
        return;
      }

      if (!s3Available) {
        throw new NotFoundException('Arquivo não encontrado no storage e sem URL de origem');
      }

      const { stream, contentType, contentLength } = s3Result!;

      // Extrai extensão da s3_key, limpando possíveis parâmetros residuais
      const ext = (media.s3_key.split('.').pop() || 'bin').split(';')[0].trim();

      // Nome do arquivo: usa original_name se disponível (documentos),
      // caso contrário deriva do mime_type
      let filename: string;
      if (media.original_name) {
        filename = media.original_name;
      } else {
        const mime = (media.mime_type || '').toLowerCase();
        if (mime.startsWith('image/')) {
          filename = `imagem.${ext}`;
        } else if (mime.startsWith('audio/')) {
          filename = `audio.${ext}`;
        } else if (mime.startsWith('video/')) {
          filename = `video.${ext}`;
        } else {
          filename = `arquivo.${ext}`;
        }
      }

      const disposition = dl === '1' ? 'attachment' : 'inline';
      const safeFilename = encodeURIComponent(filename);

      // Suporte a Range requests (necessário para streaming de áudio/vídeo)
      const rangeHeader = req.headers['range'] as string | undefined;
      if (rangeHeader && contentLength) {
        const [startStr, endStr] = rangeHeader.replace('bytes=', '').split('-');
        const start = parseInt(startStr, 10);
        const end = endStr ? parseInt(endStr, 10) : contentLength - 1;
        const chunkSize = end - start + 1;

        // Re-fetch do S3 com range (se o stream já foi iniciado, destroi e recria)
        stream.destroy();
        const ranged = await this.s3.getObjectStream(media.s3_key, start, end);
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${contentLength}`);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Length', String(chunkSize));
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${safeFilename}`);
        res.setHeader('Cache-Control', 'private, max-age=3600');
        ranged.stream.pipe(res);
        return;
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${safeFilename}`);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.setHeader('Accept-Ranges', 'bytes');
      if (contentLength) res.setHeader('Content-Length', String(contentLength));

      stream.pipe(res);
    } catch (e) {
      if (e instanceof NotFoundException) throw e;
      this.logger.error(`Erro inesperado ao servir mídia ${messageId}: ${(e as Error).message}`);
      throw new NotFoundException('Arquivo não encontrado no storage');
    }
  }
}
