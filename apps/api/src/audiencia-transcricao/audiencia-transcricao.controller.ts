import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { join } from 'path';
import type { Response } from 'express';
import { AudienciaTranscricaoService } from './audiencia-transcricao.service';
import { UpdateSpeakersDto, UpdateTranscriptionDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

const MAX_UPLOAD_BYTES = 3 * 1024 * 1024 * 1024; // 3GB

// Tipos MIME aceitos — cobrimos ASF/WMV/MP4/MKV/AVI/MOV/WEBM e áudio puro
const ACCEPTED_MIMES = [
  'video/x-ms-asf',
  'video/x-ms-wmv',
  'video/mp4',
  'video/x-matroska',
  'video/x-msvideo',
  'video/quicktime',
  'video/webm',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'application/octet-stream', // ASF às vezes vem sem mime reconhecido
];

@UseGuards(JwtAuthGuard)
@Controller('transcriptions')
export class AudienciaTranscricaoController {
  constructor(private readonly service: AudienciaTranscricaoService) {}

  /**
   * POST /transcriptions?caseId=xxx
   * Upload multipart (campo "file"). Cria registro PENDING e enfileira job.
   */
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: tmpdir(),
        filename: (_req, _file, cb) => cb(null, `transcr-${randomUUID()}`),
      }),
      limits: { fileSize: MAX_UPLOAD_BYTES },
      fileFilter: (_req, file, cb) => {
        // aceita qualquer mime de vídeo/áudio, mesmo que não reconhecido exatamente
        const mime = (file.mimetype || '').toLowerCase();
        const looksMedia = mime.startsWith('video/') || mime.startsWith('audio/');
        const ok = ACCEPTED_MIMES.includes(mime) || looksMedia;
        cb(null, ok);
      },
    }),
  )
  async upload(
    @Query('caseId') caseId: string,
    @Query('title') title: string | undefined,
    @Query('minSpeakers') minSpeakers: string | undefined,
    @Query('maxSpeakers') maxSpeakers: string | undefined,
    @UploadedFile() file: Express.Multer.File,
    @Request() req: any,
  ) {
    if (!caseId) throw new BadRequestException('caseId é obrigatório');
    if (!file) throw new BadRequestException('Arquivo obrigatório no campo "file"');

    const tmpPath = (file as any).path || join(tmpdir(), (file as any).filename);
    const record = await this.service.createFromUpload({
      caseId,
      title: title || file.originalname,
      tmpPath,
      originalName: file.originalname,
      mime: file.mimetype || 'application/octet-stream',
      size: file.size,
      userId: req.user?.id,
      tenantId: req.user?.tenant_id,
      minSpeakers: minSpeakers ? parseInt(minSpeakers, 10) : undefined,
      maxSpeakers: maxSpeakers ? parseInt(maxSpeakers, 10) : undefined,
    });
    return {
      id: record.id,
      status: record.status,
      title: record.title,
      created_at: record.created_at,
    };
  }

  /** GET /transcriptions?caseId=xxx — lista de um processo */
  @Get()
  list(@Query('caseId') caseId: string) {
    if (!caseId) throw new BadRequestException('caseId é obrigatório');
    return this.service.listByCase(caseId);
  }

  /** GET /transcriptions/meta/health — status do provider (Whisper) */
  @Get('meta/health')
  health() {
    return this.service.providerHealth();
  }

  /** GET /transcriptions/:id — detalhe completo (texto, segmentos, speakers) */
  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.getById(id);
  }

  /** GET /transcriptions/:id/video — stream MP4 (Range requests) */
  @Get(':id/video')
  async streamVideo(
    @Param('id') id: string,
    @Request() req: any,
    @Res() res: Response,
  ) {
    const range = req.headers.range as string | undefined;
    let rangeStart: number | undefined;
    let rangeEnd: number | undefined;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      if (m) {
        rangeStart = m[1] ? parseInt(m[1], 10) : undefined;
        rangeEnd = m[2] ? parseInt(m[2], 10) : undefined;
      }
    }

    const { stream, contentType, contentLength } = await this.service.getVideoStream(
      id,
      rangeStart,
      rangeEnd,
    );
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', contentType || 'video/mp4');
    if (contentLength) res.setHeader('Content-Length', contentLength);
    if (range) res.status(206);
    stream.pipe(res);
  }

  /** GET /transcriptions/:id/export/:format (txt|srt|vtt) */
  @Get(':id/export/:format')
  async export(
    @Param('id') id: string,
    @Param('format') format: string,
    @Res() res: Response,
  ) {
    if (!['txt', 'srt', 'vtt'].includes(format)) {
      throw new BadRequestException('format deve ser txt|srt|vtt');
    }
    const { content, filename, contentType } = await this.service.exportText(
      id,
      format as 'txt' | 'srt' | 'vtt',
    );
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(content);
  }

  /** PATCH /transcriptions/:id — update metadados (ex: title) */
  @Patch(':id')
  update(@Param('id') id: string, @Body() data: UpdateTranscriptionDto) {
    return this.service.update(id, data);
  }

  /** PATCH /transcriptions/:id/speakers — renomear falantes */
  @Patch(':id/speakers')
  updateSpeakers(@Param('id') id: string, @Body() data: UpdateSpeakersDto) {
    return this.service.updateSpeakers(id, data);
  }

  /** POST /transcriptions/:id/retry — reprocessa transcrição em ERROR */
  @Post(':id/retry')
  retry(@Param('id') id: string) {
    return this.service.retry(id);
  }

  /** DELETE /transcriptions/:id */
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}
