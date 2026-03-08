import {
  Controller,
  Get,
  Param,
  Post,
  Patch,
  Delete,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { MessagesService } from './messages.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SendMessageDto } from './dto/send-message.dto';
import { ReactMessageDto } from './dto/react-message.dto';

// Whitelist de MIME types para upload
const ALLOWED_MEDIA_RE = /^(image|video|audio)\//;
const ALLOWED_DOC_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument',
  'application/vnd.ms-excel',
  'text/plain',
  'application/zip',
  'application/x-zip-compressed',
];

@UseGuards(JwtAuthGuard)
@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get('conversation/:id')
  getMessages(
    @Param('id') conversationId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Req() req?: any,
  ) {
    return this.messagesService.getMessages(
      conversationId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 100,
      req?.user?.tenant_id,
    );
  }

  @Get('link-preview')
  getLinkPreview(@Query('url') url: string) {
    if (!url) {
      throw new BadRequestException('URL é obrigatória');
    }
    // Validar esquema — somente http/https
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException('URL inválida');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new BadRequestException('Apenas URLs http/https são permitidas');
    }
    // Bloquear IPs privados / loopback (prevenção SSRF)
    const host = parsed.hostname;
    if (
      host === 'localhost' ||
      host.startsWith('127.') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('0.') ||
      host === '[::1]' ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      throw new BadRequestException('URLs para endereços internos não são permitidas');
    }
    return this.messagesService.getLinkPreview(url);
  }

  @Post('conversation/:id/sync-history')
  syncHistory(@Param('id') conversationId: string) {
    return this.messagesService.syncHistoryFromWhatsApp(conversationId);
  }

  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @Post('send')
  sendMessage(
    @Body() dto: SendMessageDto,
    @Req() req: any,
  ) {
    if (!dto.text || !dto.text.trim()) {
      throw new BadRequestException('Texto nao pode ser vazio');
    }
    return this.messagesService.sendMessage(dto.conversationId, dto.text.trim(), dto.replyToId, req.user?.id);
  }

  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post('send-audio')
  @UseInterceptors(FileInterceptor('audio', {
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype.startsWith('audio/') || file.mimetype === 'video/webm') {
        cb(null, true);
      } else {
        cb(new BadRequestException('Somente arquivos de audio sao permitidos') as any, false);
      }
    },
  }))
  sendAudio(
    @Body('conversationId') conversationId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
  ) {
    // Construir URL pública: usa env var ou deriva dos headers do Traefik
    const publicApiUrl =
      process.env.PUBLIC_API_URL ||
      `${(req.headers['x-forwarded-proto'] as string) || req.protocol}://${(req.headers['x-forwarded-host'] as string) || req.headers['host']}/api`;

    return this.messagesService.sendAudio(conversationId, file, publicApiUrl, req.user?.id);
  }

  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post('send-file')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_MEDIA_RE.test(file.mimetype) || ALLOWED_DOC_TYPES.some(t => file.mimetype.startsWith(t))) {
        cb(null, true);
      } else {
        cb(new BadRequestException(`Tipo de arquivo nao permitido: ${file.mimetype}`) as any, false);
      }
    },
  }))
  sendFile(
    @Body('conversationId') conversationId: string,
    @Body('caption') caption: string | undefined,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
  ) {
    const publicApiUrl =
      process.env.PUBLIC_API_URL ||
      `${(req.headers['x-forwarded-proto'] as string) || req.protocol}://${(req.headers['x-forwarded-host'] as string) || req.headers['host']}/api`;
    return this.messagesService.sendFile(conversationId, file, publicApiUrl, caption, req.user?.id);
  }

  @Post('ai-correct')
  correctText(
    @Body('text') text: string,
    @Body('action') action: string,
  ) {
    return this.messagesService.correctText(text, action);
  }

  @Post(':id/transcribe')
  transcribeAudio(@Param('id') messageId: string) {
    return this.messagesService.transcribeAudio(messageId);
  }

  @Post(':id/react')
  reactToMessage(
    @Param('id') id: string,
    @Body() dto: ReactMessageDto,
    @Req() req: any,
  ) {
    return this.messagesService.reactToMessage(id, dto.emoji, req.user.id);
  }

  @Patch(':id')
  editMessage(
    @Param('id') messageId: string,
    @Body('text') text: string,
  ) {
    return this.messagesService.editMessage(messageId, text);
  }

  @Delete(':id')
  deleteMessage(@Param('id') messageId: string) {
    return this.messagesService.deleteMessage(messageId);
  }
}
