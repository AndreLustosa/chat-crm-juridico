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
  @IsOptional() @IsObject() style?: { font?: string; size?: number; lineSpacing?: number; justify?: boolean; autoFit?: boolean };
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
}
