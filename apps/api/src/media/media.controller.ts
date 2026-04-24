import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Res,
  Req,
  NotFoundException,
  HttpException,
  HttpStatus,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediaS3Service } from './s3.service';
import { FileStorageService } from './filesystem.service';
import { MediaDownloadService } from './media-download.service';
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
    private fileStorage: FileStorageService,
    private mediaDownloadService: MediaDownloadService,
  ) {}

  /**
   * POST /media/:messageId/retry — re-baixa mídia que falhou.
   * Chamado pelo frontend quando usuário clica "Recarregar" em áudio/documento.
   */
  @Post(':messageId/retry')
  @UseGuards(JwtAuthGuard)
  async retryMediaDownload(@Param('messageId') messageId: string) {
    const result = await this.mediaDownloadService.retryDownload(messageId);

    if (result.ok) {
      return { ok: true, message: 'Mídia disponível' };
    }

    if (result.reason === 'not_found') {
      throw new NotFoundException('Mensagem não encontrada');
    }

    if (result.reason === 'no_media_data') {
      throw new NotFoundException('Mensagem sem external_message_id — não é possível re-baixar');
    }

    if (result.reason === 'expired') {
      throw new HttpException(
        { ok: false, reason: 'expired', message: 'Mídia expirada no servidor do WhatsApp (>48h)' },
        HttpStatus.GONE, // 410 Gone
      );
    }

    // download_failed: erro transitório — frontend pode tentar de novo
    throw new HttpException(
      { ok: false, reason: 'download_failed', message: 'Falha ao baixar mídia do WhatsApp' },
      HttpStatus.SERVICE_UNAVAILABLE, // 503
    );
  }

  // Rota pública (sem JWT) para que a Evolution API possa baixar a mídia no envio outbound
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
      // ─── 1. Filesystem novo (prioridade) ─────────────────────────
      if (media.file_path && await this.fileStorage.exists(media.file_path)) {
        await this.serveFromFilesystem(media, dl, req, res);
        return;
      }

      // ─── 2. Dual-read: MinIO (mídias antigas) ────────────────────
      if (media.s3_key) {
        try {
          await this.serveFromS3(media, dl, req, res);
          return;
        } catch (s3Err: any) {
          this.logger.warn(`[MediaController] S3 falhou para ${messageId}: ${s3Err.message}`);
          // Cai no fluxo de re-download
        }
      }

      // ─── 3. Re-download via Evolution API ────────────────────────
      // Bug reportado 2026-04-23: quando o arquivo sumia do filesystem
      // (container antigo pre-volume-persistente) e caia direto no proxy
      // de original_url, servia conteudo CRIPTOGRAFADO da CDN do WhatsApp
      // (.enc) — Whisper rejeitava com "400 Audio file might be corrupted".
      //
      // Fix: se filesystem nao tem mas existe external_message_id, tenta
      // re-baixar via Evolution API (getBase64FromMediaMessage — entrega
      // plaintext decriptado). Se sucesso, serve do filesystem recem-escrito.
      if (messageId) {
        this.logger.log(`[MediaController] Arquivo ausente msg=${messageId} — disparando re-download via Evolution`);
        const retry = await this.mediaDownloadService.retryDownload(messageId);
        if (retry.ok) {
          // Re-busca a media atualizada (file_path agora preenchido com arquivo real)
          const refreshed = await this.prisma.media.findUnique({ where: { message_id: messageId } });
          if (refreshed?.file_path && await this.fileStorage.exists(refreshed.file_path)) {
            await this.serveFromFilesystem(refreshed, dl, req, res);
            return;
          }
        } else {
          this.logger.warn(`[MediaController] Re-download falhou msg=${messageId}: ${retry.reason || 'unknown'}`);
        }
      }

      // ─── 4. Ultimo recurso: proxy da Evolution CDN (apenas NAO-WhatsApp) ─
      // URLs do WhatsApp CDN (mmg.whatsapp.net) retornam conteudo encriptado —
      // so servimos se for outra origem (ex: midia ja processada, link publico).
      const isEncryptedWhatsAppUrl = media.original_url &&
        /(\.whatsapp\.net|mmg\.whatsapp)/.test(media.original_url);
      if (media.original_url && !isEncryptedWhatsAppUrl) {
        this.logger.log(`[MediaController] Servindo via original_url (nao-WhatsApp) para ${messageId}`);
        await this.proxyFromEvolutionCdn(media, res);
        return;
      }

      if (isEncryptedWhatsAppUrl) {
        this.logger.warn(
          `[MediaController] Arquivo ${messageId} nao disponivel — original_url eh encriptada do WhatsApp, re-download falhou`,
        );
      }
      throw new NotFoundException('Arquivo não disponível');
    } catch (e) {
      if (e instanceof NotFoundException) throw e;
      this.logger.error(`Erro ao servir mídia ${messageId}: ${(e as Error).message}`);
      throw new NotFoundException('Arquivo não disponível');
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────

  private async serveFromFilesystem(media: any, dl: string, req: any, res: any): Promise<void> {
    const contentType = media.mime_type || 'application/octet-stream';
    const filename = this.resolveFilename(media);
    const disposition = dl === '1' ? 'attachment' : 'inline';
    const safeFilename = encodeURIComponent(filename);
    const contentLength = media.size || await this.fileStorage.getSize(media.file_path);

    // Suporte a Range requests (streaming de áudio/vídeo)
    const rangeHeader = req.headers['range'] as string | undefined;
    if (rangeHeader && contentLength) {
      const [startStr, endStr] = rangeHeader.replace('bytes=', '').split('-');
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : contentLength - 1;
      const chunkSize = end - start + 1;

      const stream = this.fileStorage.readStream(media.file_path, { start, end });
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${contentLength}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', String(chunkSize));
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${safeFilename}`);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      stream.pipe(res);
      return;
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${safeFilename}`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Accept-Ranges', 'bytes');
    if (contentLength) res.setHeader('Content-Length', String(contentLength));

    this.fileStorage.readStream(media.file_path).pipe(res);
  }

  private async serveFromS3(media: any, dl: string, req: any, res: any): Promise<void> {
    const s3Result = await this.s3.getObjectStream(media.s3_key);
    const { stream, contentType, contentLength } = s3Result;
    const filename = this.resolveFilename(media);
    const disposition = dl === '1' ? 'attachment' : 'inline';
    const safeFilename = encodeURIComponent(filename);

    const rangeHeader = req.headers['range'] as string | undefined;
    if (rangeHeader && contentLength) {
      const [startStr, endStr] = rangeHeader.replace('bytes=', '').split('-');
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : contentLength - 1;
      const chunkSize = end - start + 1;

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
  }

  private async proxyFromEvolutionCdn(media: any, res: any): Promise<void> {
    const protocol = media.original_url.startsWith('https') ? https : http;
    await new Promise<void>((resolve, reject) => {
      const req2 = protocol.get(media.original_url!, (proxyRes) => {
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
  }

  private resolveFilename(media: any): string {
    if (media.original_name) return media.original_name;

    // Tenta derivar do file_path ou s3_key
    const source = media.file_path || media.s3_key || '';
    const ext = (source.split('.').pop() || 'bin').split(';')[0].trim();

    const mime = (media.mime_type || '').toLowerCase();
    if (mime.startsWith('image/')) return `imagem.${ext}`;
    if (mime.startsWith('audio/')) return `audio.${ext}`;
    if (mime.startsWith('video/')) return `video.${ext}`;
    return `arquivo.${ext}`;
  }
}
