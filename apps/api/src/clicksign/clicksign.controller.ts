import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  Body,
  Headers,
  Req,
  Res,
  HttpCode,
  UseGuards,
  Logger,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { IsString, IsObject } from 'class-validator';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';
import { ClicksignService } from './clicksign.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ContratoVariaveis } from '../contracts/contracts.service';

// ─── DTO ──────────────────────────────────────────────────────────────────────

class RequestSignatureDto {
  @IsString()
  conversationId: string;

  @IsObject()
  variaveis: ContratoVariaveis;
}

// ─── Controller autenticado (operadores) ──────────────────────────────────────

@UseGuards(JwtAuthGuard)
@Controller('contracts/clicksign')
export class ClicksignController {
  private readonly logger = new Logger(ClicksignController.name);

  constructor(private readonly clicksign: ClicksignService) {}

  /**
   * POST /contracts/clicksign/request
   * Gera o contrato, faz upload no Clicksign, cria signatário e envia link via WhatsApp.
   */
  @Post('request')
  async requestSignature(@Body() body: RequestSignatureDto) {
    if (!body.conversationId) throw new BadRequestException('conversationId obrigatório');
    if (!body.variaveis) throw new BadRequestException('variaveis obrigatório');
    return this.clicksign.requestSignature({
      conversationId: body.conversationId,
      variaveis: body.variaveis,
    });
  }

  /**
   * GET /contracts/clicksign/status/:conversationId
   * Retorna o status do ContractSignature mais recente da conversa,
   * incluindo a URL do painel Clicksign para download manual.
   */
  @Get('status/:conversationId')
  async getStatus(@Param('conversationId') conversationId: string) {
    const sig = await this.clicksign['prisma'].contractSignature.findFirst({
      where: { conversation_id: conversationId, document_kind: { not: 'PROCURACAO' } },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        status: true,
        signing_url: true,
        signed_at: true,
        created_at: true,
        cs_document_key: true,
        signed_s3_key: true,
      },
    });
    if (!sig) return null;

    // URL do painel Clicksign para download manual (útil quando sandbox não serve o PDF)
    const cfg = await this.clicksign['getCfg']();
    const dashboardUrl = sig.cs_document_key
      ? `${cfg.baseUrl}/documents/${sig.cs_document_key}`
      : null;

    return {
      id: sig.id,
      status: sig.status,
      signing_url: sig.signing_url,
      signed_at: sig.signed_at,
      created_at: sig.created_at,
      has_pdf: !!sig.signed_s3_key,    // indica se PDF já está no S3
      dashboard_url: dashboardUrl,      // link direto ao documento no Clicksign
    };
  }

  /**
   * GET /contracts/clicksign/signed-pdf/:signatureId
   * Serve o PDF assinado armazenado no S3 (para encaminhar ao WhatsApp).
   */
  @Get('signed-pdf/:signatureId')
  async serveSignedPdf(@Param('signatureId') signatureId: string, @Res() res: any) {
    const { stream, contentType, contentLength } =
      await this.clicksign.getSignedPdfStream(signatureId);

    const headers: Record<string, string | number> = {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="contrato_assinado_${signatureId}.pdf"`,
    };
    if (contentLength) headers['Content-Length'] = contentLength;
    res.set(headers);
    stream.pipe(res);
  }
}

// ─── Controller de assinatura de PROCURAÇÃO (chat) ─────────────────────────────
// Mesmo fluxo Clicksign do contrato, escopado ao tenant. Vive aqui (ClicksignModule)
// pra reusar o ClicksignService sem dependência circular com o ProcuracaoModule.

@UseGuards(JwtAuthGuard)
@Controller('procuracao/assinatura')
export class ProcuracaoSignatureController {
  constructor(
    private readonly clicksign: ClicksignService,
    private readonly prisma: PrismaService,
  ) {}

  private tenant(req: any): string {
    if (!req.user?.tenant_id) throw new UnauthorizedException('Token sem tenant_id');
    return req.user.tenant_id;
  }

  /** POST /procuracao/assinatura — gera a procuração e envia pro cliente assinar (Clicksign). */
  @Post()
  async enviar(@Body() body: { conversationId?: string }, @Req() req: any) {
    if (!body?.conversationId) throw new BadRequestException('conversationId obrigatório');
    return this.clicksign.requestSignatureForProcuracao({
      conversationId: body.conversationId,
      tenantId: this.tenant(req),
    });
  }

  /** GET /procuracao/assinatura/status?conversationId= — status da procuração mais recente da conversa. */
  @Get('status')
  async status(@Query('conversationId') conversationId: string, @Req() req: any) {
    const tenantId = this.tenant(req);
    if (!conversationId) return null;
    const convo = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenant_id: tenantId },
      select: { id: true },
    });
    if (!convo) return null;
    const sig = await this.prisma.contractSignature.findFirst({
      where: { conversation_id: conversationId, document_kind: 'PROCURACAO' },
      orderBy: { created_at: 'desc' },
      select: { id: true, status: true, signing_url: true, signed_at: true, created_at: true, signed_s3_key: true },
    });
    if (!sig) return null;
    return {
      id: sig.id,
      status: sig.status,
      signing_url: sig.signing_url,
      signed_at: sig.signed_at,
      created_at: sig.created_at,
      has_pdf: !!sig.signed_s3_key,
    };
  }

  /** GET /procuracao/assinatura/:id/pdf — baixa a procuração ASSINADA (escopado ao tenant). */
  @Get(':id/pdf')
  async pdf(@Param('id') id: string, @Req() req: any, @Res() res: any) {
    const tenantId = this.tenant(req);
    const sig = await this.prisma.contractSignature.findFirst({
      where: { id, document_kind: 'PROCURACAO', lead: { tenant_id: tenantId } },
      select: { id: true },
    });
    if (!sig) throw new BadRequestException('Assinatura não encontrada.');
    const { stream, contentType, contentLength } = await this.clicksign.getSignedPdfStream(id);
    const headers: Record<string, string | number> = {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="procuracao_assinada_${id}.pdf"`,
    };
    if (contentLength) headers['Content-Length'] = contentLength;
    res.set(headers);
    stream.pipe(res);
  }
}

// ─── Controller público (webhook do Clicksign) ────────────────────────────────

@Public()
@SkipThrottle()
@Controller('webhooks/clicksign')
export class ClicksignWebhookController {
  private readonly logger = new Logger(ClicksignWebhookController.name);

  constructor(private readonly clicksign: ClicksignService) {}

  @Post()
  @HttpCode(200)
  async handleWebhook(
    @Body() payload: any,
    @Headers('x-clicksign-hmac-sha256') hmacHeader: string,
    @Req() req: any,
  ) {
    // Validar assinatura HMAC quando configurada
    const rawBody =
      typeof req.rawBody === 'string'
        ? req.rawBody
        : JSON.stringify(payload);
    const signature = hmacHeader ?? '';

    if (signature && !(await this.clicksign.verifyWebhookSignature(rawBody, signature))) {
      this.logger.warn('[Clicksign] Assinatura HMAC inválida no webhook — rejeitado');
      throw new UnauthorizedException('Webhook signature inválida');
    }

    await this.clicksign.handleWebhookEvent(payload);
    return { ok: true };
  }
}
