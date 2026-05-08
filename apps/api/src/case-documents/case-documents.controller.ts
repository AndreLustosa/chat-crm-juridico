import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
  Res,
  StreamableFile,
  BadRequestException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CaseDocumentsService } from './case-documents.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';

// Bug fix 2026-05-08: antes upload aceitava QUALQUER tamanho/MIME.
// 50MB cobre PDFs grandes de processo + foto de documento. MIME
// whitelist bloqueia executaveis e scripts maliciosos.
const MAX_DOC_BYTES = 50 * 1024 * 1024; // 50 MB
const ALLOWED_DOC_MIMES = new Set<string>([
  // PDFs
  'application/pdf',
  // Imagens (foto de documento, prints)
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
  // Office
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Texto
  'text/plain', 'text/csv',
  // Email
  'message/rfc822',
  // Audio/video em audiencia (raro mas pode acontecer)
  'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg',
  'video/mp4', 'video/quicktime',
]);

const docFileFilter = (_req: any, file: any, cb: any) => {
  if (!file?.mimetype) return cb(new BadRequestException('Arquivo sem MIME type'), false);
  if (!ALLOWED_DOC_MIMES.has(file.mimetype.toLowerCase())) {
    return cb(new BadRequestException(`Tipo de arquivo nao permitido: ${file.mimetype}. Aceitos: PDF, imagens, Office, texto, audio/video.`), false);
  }
  cb(null, true);
};

@UseGuards(JwtAuthGuard)
@Controller('case-documents')
export class CaseDocumentsController {
  constructor(private readonly service: CaseDocumentsService) {}

  @Get(':caseId')
  findByCaseId(
    @Param('caseId') caseId: string,
    @Query('folder') folder?: string,
    @Request() req?: any,
  ) {
    return this.service.findByCaseId(caseId, req.user.tenant_id, folder);
  }

  @Post(':caseId/upload')
  @Roles('ADMIN', 'ADVOGADO')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: MAX_DOC_BYTES },
    fileFilter: docFileFilter,
  }))
  upload(
    @Param('caseId') caseId: string,
    @UploadedFile() file: any,
    @Body('folder') folder?: string,
    @Body('description') description?: string,
    @Request() req?: any,
  ) {
    if (!file) throw new BadRequestException('Arquivo obrigatorio');
    // Multer ja deveria barrar por limits, mas double-check
    if (file.size && file.size > MAX_DOC_BYTES) {
      throw new PayloadTooLargeException(`Arquivo excede ${MAX_DOC_BYTES / 1024 / 1024}MB`);
    }
    return this.service.upload(
      caseId,
      file,
      req.user.id,
      req.user.tenant_id,
      folder,
      description,
    );
  }

  @Get(':docId/download')
  async download(
    @Param('docId') docId: string,
    @Res({ passthrough: true }) res: any,
    @Request() req?: any,
  ) {
    const result = await this.service.download(docId, req.user.tenant_id);

    res.set({
      'Content-Type': result.mimeType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(result.fileName)}"`,
      ...(result.contentLength ? { 'Content-Length': result.contentLength.toString() } : {}),
    });

    return new StreamableFile(result.stream);
  }

  @Patch(':docId')
  @Roles('ADMIN', 'ADVOGADO')
  update(
    @Param('docId') docId: string,
    @Body() body: { name?: string; folder?: string; description?: string },
    @Request() req?: any,
  ) {
    return this.service.update(docId, body, req.user.tenant_id);
  }

  @Delete(':docId')
  @Roles('ADMIN', 'ADVOGADO')
  remove(
    @Param('docId') docId: string,
    @Request() req?: any,
  ) {
    return this.service.remove(docId, req.user.tenant_id);
  }

  @Post(':docId/version')
  @Roles('ADMIN', 'ADVOGADO')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: MAX_DOC_BYTES },
    fileFilter: docFileFilter,
  }))
  uploadVersion(
    @Param('docId') docId: string,
    @UploadedFile() file: any,
    @Request() req?: any,
  ) {
    if (!file) throw new BadRequestException('Arquivo obrigatorio');
    if (file.size && file.size > MAX_DOC_BYTES) {
      throw new PayloadTooLargeException(`Arquivo excede ${MAX_DOC_BYTES / 1024 / 1024}MB`);
    }
    return this.service.uploadVersion(
      docId,
      file,
      req.user.id,
      req.user.tenant_id,
    );
  }
}
