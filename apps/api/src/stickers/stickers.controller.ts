import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  Req,
  Res,
  BadRequestException,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { StickersService } from './stickers.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequireCapability } from '../permissions/require-capability.decorator';
import { Public } from '../auth/decorators/public.decorator';

@Controller('stickers')
export class StickersController {
  constructor(private readonly stickersService: StickersService) {}

  /** Lista os stickers da biblioteca do escritorio logado. */
  @UseGuards(JwtAuthGuard)
  @RequireCapability('atendimento')
  @Get()
  list(@Req() req: any) {
    return this.stickersService.list(req.user.tenant_id);
  }

  /** Sobe um novo sticker pra biblioteca. WebP nativo do WhatsApp ou PNG
   *  (Evolution converte). Limite 5 MB. */
  @UseGuards(JwtAuthGuard)
  @RequireCapability('atendimento')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post()
  @UseInterceptors(FileInterceptor('sticker', {
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype === 'image/webp' || file.mimetype === 'image/png') {
        cb(null, true);
      } else {
        cb(new BadRequestException(`Sticker deve ser WebP ou PNG (recebido: ${file.mimetype})`) as any, false);
      }
    },
  }))
  upload(@UploadedFile() file: Express.Multer.File, @Req() req: any) {
    return this.stickersService.upload(req.user.tenant_id, file, req.user?.id);
  }

  /** Remove o sticker da biblioteca (apenas a row — o arquivo no disco fica
   *  pra preservar mensagens historicas). */
  @UseGuards(JwtAuthGuard)
  @RequireCapability('atendimento')
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.stickersService.remove(id, req.user.tenant_id);
  }

  /** Envia um sticker salvo pra uma conversa. */
  @UseGuards(JwtAuthGuard)
  @RequireCapability('atendimento')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post(':id/send')
  send(
    @Param('id') id: string,
    @Body('conversationId') conversationId: string,
    @Req() req: any,
  ) {
    if (!conversationId) throw new BadRequestException('conversationId obrigatorio');
    return this.stickersService.sendSaved(conversationId, id, req.user.tenant_id, req.user?.id);
  }

  /** Arquivo bruto do sticker. PUBLICO (igual /media/:id) porque a Evolution
   *  precisa baixar pra mandar pro WhatsApp. */
  @Public()
  @Get(':id/file')
  async getFile(@Param('id') id: string, @Res() res: any) {
    const { sticker, stream, size } = await this.stickersService.getFile(id);
    res.setHeader('Content-Type', sticker.mime_type || 'image/webp');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Accept-Ranges', 'bytes');
    if (size) res.setHeader('Content-Length', String(size));
    res.status(HttpStatus.OK);
    stream.pipe(res);
  }
}
