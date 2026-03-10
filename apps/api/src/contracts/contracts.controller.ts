import {
  Controller, Get, Post, Body, Query, Req,
  UseGuards, Logger,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ContractsService, ContratoVariaveis } from './contracts.service';

@UseGuards(JwtAuthGuard)
@Controller('contracts')
export class ContractsController {
  private readonly logger = new Logger(ContractsController.name);

  constructor(private readonly contracts: ContractsService) {}

  /**
   * GET /contracts/trabalhista/preview?conversationId=X
   * Retorna variáveis pré-preenchidas a partir dos dados do lead/ficha/memória.
   */
  @Get('trabalhista/preview')
  async preview(@Query('conversationId') conversationId: string) {
    return this.contracts.getPreview(conversationId);
  }

  /**
   * POST /contracts/trabalhista/send
   * Gera o DOCX, faz upload no S3, envia via WhatsApp e salva a mensagem no banco.
   */
  @Post('trabalhista/send')
  async send(
    @Body() body: { conversationId: string; variaveis: ContratoVariaveis },
    @Req() req: any,
  ) {
    // Deriva a URL pública da API a partir do request (igual ao sendAudio)
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const publicApiUrl = `${protocol}://${host}`;

    const senderId = (req.user as any)?.userId;

    return this.contracts.generateAndSend(
      body.conversationId,
      body.variaveis,
      publicApiUrl,
      senderId,
    );
  }
}
