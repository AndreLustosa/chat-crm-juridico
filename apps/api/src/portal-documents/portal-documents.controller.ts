import { Controller, Get, Param, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { ClientJwtAuthGuard } from '../portal-auth/client-jwt-auth.guard';
import { CurrentClient } from '../portal-auth/current-client.decorator';
import type { ClientUser } from '../portal-auth/current-client.decorator';
import { PortalDocumentsService } from './portal-documents.service';

@Controller('portal/documents')
export class PortalDocumentsController {
  constructor(private readonly service: PortalDocumentsService) {}

  @Public()
  @UseGuards(ClientJwtAuthGuard)
  @Get()
  async list(@CurrentClient() client: ClientUser) {
    return this.service.list(client.id);
  }

  @Public()
  @UseGuards(ClientJwtAuthGuard)
  @Get(':id/download')
  async download(
    @CurrentClient() client: ClientUser,
    @Param('id') docId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.service.download(client.id, docId);
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(result.fileName)}"`,
    );
    return new StreamableFile(result.stream);
  }
}
