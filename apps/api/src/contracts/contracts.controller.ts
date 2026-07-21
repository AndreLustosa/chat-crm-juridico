import {
  Controller, Get, Post, Body, Query, Req, Res,
  UseGuards, Logger,
} from '@nestjs/common';
import { IsString, IsObject } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ContractsService } from './contracts.service';
import type { ContratoVariaveis } from './contracts.service';

// ─── DTOs ─────────────────────────────────────────────────────────────────────

class SendContractDto {
  @IsString()
  conversationId: string;

  @IsObject()
  variaveis: ContratoVariaveis;
}

class DownloadContractDto {
  @IsObject()
  variaveis: ContratoVariaveis;
}

// Emissão de contrato é operação de atendimento/jurídico — nunca de
// ESTAGIARIO/FINANCEIRO. SUPER_ADMIN passa por padrão no RolesGuard global.
@UseGuards(JwtAuthGuard)
@Roles('ADMIN', 'ADVOGADO', 'COMERCIAL', 'OPERADOR')
@Controller('contracts')
export class ContractsController {
  private readonly logger = new Logger(ContractsController.name);

  constructor(private readonly contracts: ContractsService) {}

  /**
   * GET /contracts/trabalhista/preview?conversationId=X
   * Retorna variáveis pré-preenchidas a partir dos dados do lead/ficha/memória.
   * Escopado ao tenant do usuário (não vaza ficha de outro escritório).
   */
  @Get('trabalhista/preview')
  async preview(@Query('conversationId') conversationId: string, @Req() req: any) {
    return this.contracts.getPreview(conversationId, req.user?.tenant_id);
  }

  /**
   * POST /contracts/trabalhista/send
   * Gera o DOCX, faz upload no S3, envia via WhatsApp e salva a mensagem no banco.
   */
  @Post('trabalhista/send')
  async send(
    @Body() body: SendContractDto,
    @Req() req: any,
  ) {
    // Deriva a URL pública da API a partir do request (igual ao sendAudio)
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const publicApiUrl = `${protocol}://${host}`;

    const senderId = (req.user as any)?.userId;
    const tenantId = (req.user as any)?.tenant_id;

    return this.contracts.generateAndSend(
      body.conversationId,
      body.variaveis,
      publicApiUrl,
      senderId,
      tenantId,
    );
  }

  /**
   * POST /contracts/trabalhista/download
   * Gera o DOCX e retorna como download direto (sem enviar via WhatsApp).
   */
  @Post('trabalhista/download')
  async download(
    @Body() body: DownloadContractDto,
    @Res() res: any,
  ) {
    const buffer = await this.contracts.generateBuffer(body.variaveis);
    const clientName = (body.variaveis.NOME_CONTRATANTE || 'contrato')
      .split(' ')[0]
      .replace(/\s+/g, '_');
    const fileName = `Contrato_Trabalhista_${clientName}.docx`;

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }
}
