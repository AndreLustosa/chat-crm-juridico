import { Controller, Get, NotFoundException, Param, Post, Query, Res, StreamableFile, UseGuards, Body, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { Readable } from 'stream';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import { ClientJwtAuthGuard } from '../portal-auth/client-jwt-auth.guard';
import { CurrentClient } from '../portal-auth/current-client.decorator';
import type { ClientUser } from '../portal-auth/current-client.decorator';
import { PortalProcessesService } from './portal-processes.service';
import { PortalDocumentFetcherService } from '../portal-documents/portal-document-fetcher.service';

/**
 * Endpoints de processos do portal do cliente. Rotas montadas em /portal/processes.
 *
 * Todas exigem ClientJwtAuthGuard (cookie portal_token). @Public() desliga
 * o JwtAuthGuard global do app — o ClientJwtAuthGuard especifico assume.
 *
 * Ownership eh validado dentro do service (lead_id = currentClient.id).
 */
@Controller('portal/processes')
export class PortalProcessesController {
  constructor(
    private readonly service: PortalProcessesService,
    private readonly fetcher: PortalDocumentFetcherService,
  ) {}

  @Public()
  @UseGuards(ClientJwtAuthGuard)
  @Get()
  async list(@CurrentClient() client: ClientUser) {
    return this.service.listProcesses(client.id);
  }

  @Public()
  @UseGuards(ClientJwtAuthGuard)
  @Get(':id')
  async detail(
    @CurrentClient() client: ClientUser,
    @Param('id') caseId: string,
  ) {
    return this.service.getProcessDetail(client.id, caseId);
  }

  @Public()
  @UseGuards(ClientJwtAuthGuard)
  @Get(':id/movements')
  async movements(
    @CurrentClient() client: ClientUser,
    @Param('id') caseId: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    const lim = Math.min(parseInt(limit || '30', 10) || 30, 100);
    return this.service.listMovements(client.id, caseId, lim, before);
  }

  @Public()
  @UseGuards(ClientJwtAuthGuard)
  @Get(':id/events')
  async events(
    @CurrentClient() client: ClientUser,
    @Param('id') caseId: string,
  ) {
    return this.service.listEvents(client.id, caseId);
  }

  /**
   * "Pedir explicacao a Sophia" — IA traduz a movimentacao em linguagem
   * leiga. Cacheado em CaseEvent.client_explanation pra ESAJ; pra DJEN
   * usa o resumo_cliente ja gerado pelo sync.
   *
   * Throttle: 20/min/IP — gasto de tokens controlado mas operacional pro
   * cliente clicar em varias movimentacoes na sequencia.
   */
  @Public()
  @UseGuards(ClientJwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':id/movements/:movId/explain')
  async explain(
    @CurrentClient() client: ClientUser,
    @Param('id') caseId: string,
    @Param('movId') movId: string,
    @Body() body: { kind: 'esaj' | 'djen' },
  ) {
    if (body.kind !== 'esaj' && body.kind !== 'djen') {
      throw new BadRequestException('kind deve ser "esaj" ou "djen"');
    }
    return this.service.explainMovement(client.id, caseId, body.kind, movId);
  }

  /**
   * Baixa PDF de uma movimentacao ESAJ direto do TJAL.
   *
   * Best-effort: so funciona pra movimentacoes que tem documento publico
   * vinculado (sentenca, despacho publico). Sigilosos retornam 404.
   *
   * Cacheado: na primeira chamada, baixa do TJAL e salva como CaseDocument
   * folder=DECISOES. Proximas requests da mesma movimentacao reusam o cache.
   *
   * Throttle 10/min/IP — limite gentil, mas evita abuso massivo.
   */
  @Public()
  @UseGuards(ClientJwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get(':id/movements/:movId/pdf')
  async movementPdf(
    @CurrentClient() client: ClientUser,
    @Param('id') _caseId: string,
    @Param('movId') movId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.fetcher.fetchPdfForCaseEvent(client.id, movId);
    if (!result) {
      throw new NotFoundException(
        'PDF não disponível para esta movimentação. Pode ser sigilosa ou não ter documento anexado no tribunal.',
      );
    }
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(result.fileName)}"`,
    );
    return new StreamableFile(Readable.from(result.buffer));
  }
}
