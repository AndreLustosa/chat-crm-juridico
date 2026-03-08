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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CaseDocumentsService } from './case-documents.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

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
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @Param('caseId') caseId: string,
    @UploadedFile() file: any,
    @Body('folder') folder?: string,
    @Body('description') description?: string,
    @Request() req?: any,
  ) {
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
  update(
    @Param('docId') docId: string,
    @Body() body: { name?: string; folder?: string; description?: string },
    @Request() req?: any,
  ) {
    return this.service.update(docId, body, req.user.tenant_id);
  }

  @Delete(':docId')
  remove(
    @Param('docId') docId: string,
    @Request() req?: any,
  ) {
    return this.service.remove(docId, req.user.tenant_id);
  }

  @Post(':docId/version')
  @UseInterceptors(FileInterceptor('file'))
  uploadVersion(
    @Param('docId') docId: string,
    @UploadedFile() file: any,
    @Request() req?: any,
  ) {
    return this.service.uploadVersion(
      docId,
      file,
      req.user.id,
      req.user.tenant_id,
    );
  }
}
