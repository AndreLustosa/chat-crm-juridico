import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  Req,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediaS3Service } from './s3.service';
import { Public } from '../auth/decorators/public.decorator';

@Public()
@Controller('media')
export class MediaController {
  private readonly logger = new Logger(MediaController.name);

  constructor(
    private prisma: PrismaService,
    private s3: MediaS3Service,
  ) {}

  // Rota pública (sem JWT) para que a Evolution API possa baixar o áudio
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
      const { stream, contentType, contentLength } =
        await this.s3.getObjectStream(media.s3_key);

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
      this.logger.error(`Erro ao servir mídia ${messageId}: ${e.message}`);
      throw new NotFoundException('Arquivo não encontrado no storage');
    }
  }
}
