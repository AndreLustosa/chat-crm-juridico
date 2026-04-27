import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, NotFoundException, Param, Post, Query, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { ClientJwtAuthGuard } from '../portal-auth/client-jwt-auth.guard';
import { CurrentClient } from '../portal-auth/current-client.decorator';
import type { ClientUser } from '../portal-auth/current-client.decorator';
import { PortalDocumentsService } from './portal-documents.service';
import { PortalDocumentFetcherService } from './portal-document-fetcher.service';

@Controller('portal/documents')
export class PortalDocumentsController {
  constructor(
    private readonly service: PortalDocumentsService,
    private readonly fetcher: PortalDocumentFetcherService,
  ) {}

  @Public()
  @UseGuards(ClientJwtAuthGuard)
  @Get()
  async list(@CurrentClient() client: ClientUser) {
    return this.service.list(client.id);
  }

  /**
   * Lista processos do cliente onde ele pode subir documentos.
   * Frontend usa pra popular o <select> do upload.
   */
  @Public()
  @UseGuards(ClientJwtAuthGuard)
  @Get('uploadable-cases')
  async listUploadableCases(@CurrentClient() client: ClientUser) {
    return this.service.listUploadableCases(client.id);
  }

  /**
   * Upload self-service: cliente sobe doc direto pelo portal.
   * Multipart com campo 'file' + body com case_id, name?, description?.
   *
   * Limites: 25MB, MIME whitelist (PDF/imgs/Office/TXT). Notifica advogado
   * via NotificationsService (delay 5min do WhatsApp respeitando dedup).
   */
  @Public()
  @UseGuards(ClientJwtAuthGuard)
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @CurrentClient() client: ClientUser,
    @UploadedFile() file: any,
    @Body('case_id') caseId: string,
    @Body('name') name?: string,
    @Body('description') description?: string,
  ) {
    if (!caseId) throw new BadRequestException('case_id obrigatorio');
    return this.service.upload(client.id, caseId, file, { name, description });
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

  /**
   * Endpoint INTERNO — chamado pelo worker (Sophia) quando cliente pede
   * documento via WhatsApp. Busca em CaseDocument primeiro, fallback
   * pra scraping do TJAL com auto-cadastro como CaseDocument.
   *
   * Auth: shared secret via header X-Internal-Secret (env INTERNAL_API_SECRET).
   * NAO eh @Public — sem o secret, JwtAuthGuard global bloqueia.
   *
   * Retorna metadados + URL publica assinada pra o worker mandar via Evolution.
   */
  @Public()
  @Post('internal/find-or-fetch')
  async findOrFetchInternal(
    @Headers('x-internal-secret') secret: string,
    @Body() body: { lead_id: string; keyword: string; case_number?: string },
  ) {
    const expected = process.env.INTERNAL_API_SECRET;
    if (!expected || !secret || secret !== expected) {
      throw new ForbiddenException('Acesso interno apenas');
    }
    if (!body.lead_id || !body.keyword) {
      throw new BadRequestException('lead_id e keyword obrigatorios');
    }
    const result = await this.fetcher.findOrFetch(body.lead_id, body.keyword, body.case_number);
    if (!result) throw new NotFoundException('Documento nao encontrado nem disponivel pra scraping');

    const shareUrl = this.service.buildPublicShareUrl(result.id, body.lead_id);
    return {
      ...result,
      share_url: shareUrl,
    };
  }
}
