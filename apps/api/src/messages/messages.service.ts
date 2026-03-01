import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { MediaS3Service } from '../media/s3.service';
import { SettingsService } from '../settings/settings.service';
import { Readable } from 'stream';
import OpenAI, { toFile } from 'openai';

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private prisma: PrismaService,
    private whatsapp: WhatsappService,
    private chatGateway: ChatGateway,
    private s3: MediaS3Service,
    private settings: SettingsService,
  ) {}

  async getMessages(conversationId: string) {
    return this.prisma.message.findMany({
      where: { conversation_id: conversationId },
      orderBy: { created_at: 'asc' },
      include: { media: true }
    });
  }

  async sendMessage(conversationId: string, text: string) {
    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { lead: true }
    });

    if (!convo || !convo.lead) {
      throw new BadRequestException('Conversa inválida');
    }

    // 1. Send via Evolution API
    let externalMsg;
    try {
      externalMsg = await this.whatsapp.sendText(
        convo.lead.phone,
        text,
        convo.instance_name || undefined
      );
    } catch (e) {
      throw new BadRequestException('Falha ao enviar webhook WhatsApp');
    }

    // 2. Persist in DB
    const externalId = externalMsg?.key?.id || `out_${Date.now()}`;
    const msg = await this.prisma.message.create({
      data: {
        conversation_id: convo.id,
        direction: 'out',
        type: 'text',
        text,
        external_message_id: externalId,
        status: 'enviado'
      }
    });

    // 3. Update Convo
    await this.prisma.conversation.update({
      where: { id: convo.id },
      data: { last_message_at: new Date() }
    });

    // 4. Emit real-time events via WebSocket
    this.chatGateway.emitNewMessage(convo.id, msg);
    this.chatGateway.emitConversationsUpdate(null);

    return msg;
  }

  async sendAudio(
    conversationId: string,
    file: Express.Multer.File,
    publicApiUrl: string,
  ) {
    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { lead: true },
    });
    if (!convo || !convo.lead) throw new BadRequestException('Conversa inválida');

    // 1. Criar registro da mensagem no banco para obter o ID
    const tempExtId = `out_audio_${Date.now()}`;
    const msg = await this.prisma.message.create({
      data: {
        conversation_id: convo.id,
        direction: 'out',
        type: 'audio',
        external_message_id: tempExtId,
        status: 'enviado',
      },
    });

    // 2. Upload para S3 usando o ID da mensagem como chave
    const ext = file.mimetype.includes('ogg')
      ? 'ogg'
      : file.mimetype.includes('mp4')
        ? 'mp4'
        : 'webm';
    const s3Key = `media/${msg.id}.${ext}`;
    await this.s3.uploadBuffer(s3Key, file.buffer, file.mimetype);

    // 3. Criar registro de mídia
    await this.prisma.media.create({
      data: {
        message_id: msg.id,
        s3_key: s3Key,
        mime_type: file.mimetype,
        size: file.size,
      },
    });

    // 4. URL pública que a Evolution API vai baixar
    const mediaUrl = `${publicApiUrl}/media/${msg.id}`;
    this.logger.log(`[AUDIO] Enviando áudio via Evolution: ${mediaUrl}`);

    // 5. Enviar via Evolution API
    try {
      const result = await this.whatsapp.sendMedia(
        convo.lead.phone,
        'audio',
        mediaUrl,
        undefined,
        convo.instance_name || undefined,
      );
      const extId = result?.key?.id;
      if (extId) {
        await this.prisma.message.update({
          where: { id: msg.id },
          data: { external_message_id: extId },
        });
      }
    } catch (e) {
      this.logger.warn(`Falha ao enviar áudio via WhatsApp: ${e.message}`);
    }

    // 6. Atualizar conversa
    await this.prisma.conversation.update({
      where: { id: convo.id },
      data: { last_message_at: new Date() },
    });

    // 7. Buscar mensagem com mídia para emitir e retornar
    const msgWithMedia = await this.prisma.message.findUnique({
      where: { id: msg.id },
      include: { media: true },
    });

    this.chatGateway.emitNewMessage(convo.id, msgWithMedia);
    this.chatGateway.emitConversationsUpdate(null);

    return msgWithMedia;
  }

  async transcribeAudio(messageId: string): Promise<{ transcription: string }> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { media: true },
    });

    if (!message) throw new NotFoundException('Mensagem não encontrada');
    if (message.type !== 'audio') throw new BadRequestException('Mensagem não é um áudio');
    if (!message.media) throw new BadRequestException('Mídia ainda não processada');

    const openAiKey = await this.settings.getOpenAiKey();
    if (!openAiKey) throw new BadRequestException('OPENAI_API_KEY não configurada');

    // Download do S3
    const { stream, contentType } = await this.s3.getObjectStream(message.media.s3_key);
    const buffer = await this.streamToBuffer(stream);

    const mimeBase = (contentType || message.media.mime_type).split(';')[0].trim();
    const ext = mimeBase.split('/')[1] || 'ogg';

    // Transcrição via Whisper
    const openai = new OpenAI({ apiKey: openAiKey });
    const file = await toFile(buffer, `audio.${ext}`, { type: mimeBase });
    const result = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      language: 'pt',
    });

    const transcription = result.text?.trim() || '';

    // Salvar no banco
    await this.prisma.message.update({
      where: { id: messageId },
      data: { text: transcription },
    });

    this.logger.log(`[Whisper] Transcrição salva para msg ${messageId}`);
    return { transcription };
  }

  private streamToBuffer(stream: Readable): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }
}
