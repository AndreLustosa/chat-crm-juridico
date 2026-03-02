import {
  Controller,
  Get,
  Param,
  Post,
  Delete,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MessagesService } from './messages.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get('conversation/:id')
  getMessages(@Param('id') conversationId: string) {
    return this.messagesService.getMessages(conversationId);
  }

  @Post('send')
  sendMessage(
    @Body('conversationId') conversationId: string,
    @Body('text') text: string
  ) {
    return this.messagesService.sendMessage(conversationId, text);
  }

  @Post('send-audio')
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: 25 * 1024 * 1024 } }))
  sendAudio(
    @Body('conversationId') conversationId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
  ) {
    // Construir URL pública: usa env var ou deriva dos headers do Traefik
    const publicApiUrl =
      process.env.PUBLIC_API_URL ||
      `${(req.headers['x-forwarded-proto'] as string) || req.protocol}://${(req.headers['x-forwarded-host'] as string) || req.headers['host']}/api`;

    return this.messagesService.sendAudio(conversationId, file, publicApiUrl);
  }

  @Post('send-file')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  sendFile(
    @Body('conversationId') conversationId: string,
    @Body('caption') caption: string | undefined,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
  ) {
    const publicApiUrl =
      process.env.PUBLIC_API_URL ||
      `${(req.headers['x-forwarded-proto'] as string) || req.protocol}://${(req.headers['x-forwarded-host'] as string) || req.headers['host']}/api`;
    return this.messagesService.sendFile(conversationId, file, publicApiUrl, caption);
  }

  @Post(':id/transcribe')
  transcribeAudio(@Param('id') messageId: string) {
    return this.messagesService.transcribeAudio(messageId);
  }

  @Delete(':id')
  deleteMessage(@Param('id') messageId: string) {
    return this.messagesService.deleteMessage(messageId);
  }
}
