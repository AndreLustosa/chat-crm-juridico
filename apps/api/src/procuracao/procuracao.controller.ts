import {
  Controller, Get, Post, Patch, Body, Query, Req, Res,
  UseGuards, UseInterceptors, UploadedFile, BadRequestException, UnauthorizedException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsObject, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ProcuracaoService } from './procuracao.service';

const MAX_LETTERHEAD_BYTES = 10 * 1024 * 1024; // 10 MB

class SaveConfigDto {
  @IsOptional() @IsString() template?: string;
  @IsOptional() @IsObject() margins?: { top: number; bottom: number; left: number; right: number };
  @IsOptional() @IsObject() style?: { font?: string; size?: number; lineSpacing?: number; justify?: boolean; autoFit?: boolean; upperName?: boolean };
}
class GenerateDto {
  @IsString() leadId: string;
}

@UseGuards(JwtAuthGuard)
@Controller('procuracao')
export class ProcuracaoController {
  constructor(private readonly svc: ProcuracaoService) {}

  private tenant(req: any): string {
    if (!req.user?.tenant_id) throw new UnauthorizedException('Token sem tenant_id');
    return req.user.tenant_id;
  }

  // Config (timbrado + texto) — escrita restrita a ADMIN; tudo escopado ao tenant.
  @Get('config')
  getConfig(@Req() req: any) {
    return this.svc.getConfig(this.tenant(req));
  }

  @Patch('config')
  @Roles('ADMIN')
  saveConfig(@Body() body: SaveConfigDto, @Req() req: any) {
    return this.svc.saveConfig(this.tenant(req), body);
  }

  @Post('letterhead')
  @Roles('ADMIN')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_LETTERHEAD_BYTES } }))
  uploadLetterhead(@UploadedFile() file: any, @Req() req: any) {
    if (!file?.buffer) throw new BadRequestException('Arquivo ausente.');
    if (file.size && file.size > MAX_LETTERHEAD_BYTES) {
      throw new PayloadTooLargeException(`O timbrado excede ${MAX_LETTERHEAD_BYTES / 1024 / 1024}MB.`);
    }
    return this.svc.uploadLetterhead(this.tenant(req), file.buffer, file.mimetype);
  }

  // Preview do texto preenchido + campos faltando (pro contato).
  @Get('preview')
  preview(@Query('leadId') leadId: string, @Req() req: any) {
    return this.svc.getPreview(leadId, this.tenant(req));
  }

  // Gera a procuração e ENVIA o PDF pro cliente no WhatsApp da conversa.
  @Post('enviar-whatsapp')
  async enviarWhatsapp(@Body() body: { conversationId?: string }, @Req() req: any) {
    if (!body?.conversationId) throw new BadRequestException('conversationId obrigatório');
    return this.svc.sendViaWhatsapp(body.conversationId, this.tenant(req));
  }

  // IA lê a foto do documento (RG/CNH) que o cliente mandou na conversa e
  // preenche a qualificação do contato (só campos vazios; 1x por contato).
  @Post('auto-preencher')
  async autoPreencher(@Body() body: { conversationId?: string }, @Req() req: any) {
    if (!body?.conversationId) throw new BadRequestException('conversationId obrigatório');
    return this.svc.autoPreencherDocumento(body.conversationId, req.user?.id, this.tenant(req));
  }

  // Config da IA que lê os documentos da procuração (chaves + modelos + liga/desliga).
  // RESTRITA AO ADMIN MASTER — mexe em chaves/infra global de IA.
  @Get('ai-config')
  @Roles('SUPER_ADMIN')
  getAiConfig(@Req() req: any) {
    this.tenant(req); // garante token/tenant válido
    return this.svc.getAiConfig();
  }

  @Patch('ai-config')
  @Roles('SUPER_ADMIN')
  saveAiConfig(
    @Body() body: { docModel?: string; docAnthropicModel?: string; prompt?: string },
    @Req() req: any,
  ) {
    this.tenant(req);
    return this.svc.saveAiConfig(body || {});
  }

  // Gera o PDF preenchido e devolve pra download (botão "baixar/imprimir/enviar").
  @Post('generate')
  async generate(@Body() body: GenerateDto, @Req() req: any, @Res() res: any) {
    const { buffer, nome } = await this.svc.generatePdf(body.leadId, this.tenant(req));
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${nome}"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  // Modelo de exemplo com dados fictícios (botão "Baixar modelo" da config).
  // Usa o texto/estilo/margens enviados (edição atual, ainda não salva) ou os salvos.
  @Post('sample')
  @Roles('ADMIN')
  async sample(@Body() body: SaveConfigDto, @Req() req: any, @Res() res: any) {
    const buffer = await this.svc.generateSample(this.tenant(req), body);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="Procuracao_modelo.pdf"',
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }
}
