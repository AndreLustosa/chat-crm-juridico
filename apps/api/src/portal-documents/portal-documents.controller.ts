import { BadRequestException, Controller, Get, Param, Query, Res, StreamableFile, UseGuards } from '@nestjs/common';
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

  /**
   * Endpoint PUBLICO de share — sem login. Token assinado garante que
   * apenas quem recebeu o link consegue baixar (TTL 7 dias). Usado pela
   * IA Sophia ao mandar documento via WhatsApp e tambem por links que
   * o advogado compartilha.
   *
   * Inline disposition pra que abra direto no WhatsApp/navegador em vez
   * de forcar download.
   */
  @Public()
  @Get('share/:id')
  async share(
    @Param('id') docId: string,
    @Query('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!token) throw new BadRequestException('token obrigatorio');
    const result = await this.service.downloadByShareToken(docId, token);
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(result.fileName)}"`,
    );
    return new StreamableFile(result.stream);
  }
}
