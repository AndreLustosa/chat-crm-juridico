import { Injectable, BadRequestException, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { MediaS3Service } from '../media/s3.service';
import { SettingsService } from '../settings/settings.service';
import { Readable } from 'stream';
import OpenAI, { toFile } from 'openai';

/** Mapeia MIME type para extensão de arquivo correta */
function mimeToExt(mime: string): string {
  const clean = mime.split(';')[0].trim().toLowerCase();
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/svg+xml': 'svg',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'video/x-msvideo': 'avi',
    'audio/ogg': 'ogg',
    'audio/webm': 'webm',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/mp4': 'mp4',
    'audio/wav': 'wav',
    'audio/wave': 'wav',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'application/zip': 'zip',
    'application/x-zip-compressed': 'zip',
    'application/x-rar-compressed': 'rar',
    'text/plain': 'txt',
    'text/csv': 'csv',
  };
  // Retorna do mapa ou usa a parte após última '/' e último '.' como fallback
  return map[clean] || clean.split('/').pop()?.split('.').pop()?.split('+').pop() || 'bin';
}

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

  async getMessages(conversationId: string, page = 1, limit = 100, tenantId?: string) {
    // Verificar ownership da conversa
    if (tenantId) {
      const conv = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { tenant_id: true },
      });
      if (conv?.tenant_id && conv.tenant_id !== tenantId) {
        throw new ForbiddenException('Acesso negado a este recurso');
      }
    }

    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 500);

    const where = { conversation_id: conversationId };
    const [data, total] = await Promise.all([
      this.prisma.message.findMany({
        where,
        orderBy: { created_at: 'asc' },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
        include: { media: true, reactions: true, skill: { select: { id: true, name: true, area: true } } },
      }),
      this.prisma.message.count({ where }),
    ]);

    return { data, total, page: safePage, limit: safeLimit, totalPages: Math.ceil(total / safeLimit) };
  }

  /**
   * Fetches message history from Evolution API and imports missing messages.
   * Idempotent — already-saved messages (matched by external_message_id) are skipped.
   * Only runs when explicitly triggered (on chat open), never for inactive contacts.
   */
  async syncHistoryFromWhatsApp(conversationId: string): Promise<{ imported: number; total: number }> {
    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { lead: true },
    });

    if (!convo?.lead?.phone || !convo?.instance_name) {
      return { imported: 0, total: 0 };
    }

    const remoteJid = `${convo.lead.phone}@s.whatsapp.net`;
    const rawMessages = await this.whatsapp.fetchMessages(convo.instance_name, remoteJid);

    if (!rawMessages.length) return { imported: 0, total: 0 };

    let imported = 0;
    for (const msg of rawMessages) {
      try {
        const externalId: string | undefined = msg.key?.id || msg.id;
        if (!externalId) continue;

        const exists = await this.prisma.message.findUnique({
          where: { external_message_id: externalId },
        });
        if (exists) continue;

        const text: string =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          (msg.messageType && msg.messageType !== 'conversation' ? `[${msg.messageType}]` : '') ||
          '';

        const fromMe: boolean = msg.key?.fromMe === true;
        const ts: Date = msg.messageTimestamp
          ? new Date(Number(msg.messageTimestamp) * 1000)
          : new Date();

        await this.prisma.message.create({
          data: {
            conversation_id: conversationId,
            direction: fromMe ? 'out' : 'in',
            type: 'text',
            text,
            external_message_id: externalId,
            status: fromMe ? 'enviado' : 'recebido',
            created_at: ts,
          },
        });
        imported++;
      } catch (e: any) {
        this.logger.warn(`[syncHistory] Erro ao importar msg: ${e.message}`);
      }
    }

    if (imported > 0) {
      this.logger.log(`[syncHistory] ${imported}/${rawMessages.length} mensagens importadas para conversa ${conversationId}`);
      // Update conversation timestamp to the most recent message
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { last_message_at: new Date() },
      });
    }

    return { imported, total: rawMessages.length };
  }

  /** Re-assigns the conversation to senderId if it is currently assigned to someone else. */
  private async autoReassignIfNeeded(convo: any, senderId: string | undefined): Promise<void> {
    if (!senderId) return;
    if (convo.assigned_user_id === senderId) return;
    await this.prisma.conversation.update({
      where: { id: convo.id },
      data: { assigned_user_id: senderId },
    });
    this.logger.log(
      `[AutoReassign] Conversa ${convo.id}: ${convo.assigned_user_id ?? 'sem operador'} → ${senderId}`,
    );
    this.chatGateway.emitConversationsUpdate(null);
  }

  async sendMessage(conversationId: string, text: string, replyToId?: string, senderId?: string) {
    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { lead: true }
    });

    if (!convo || !convo.lead) {
      throw new BadRequestException('Conversa inválida');
    }

    await this.autoReassignIfNeeded(convo, senderId);

    // Buscar nome do atendente para assinatura (ex: "*Dr. André:*\n")
    let senderName: string | null = null;
    if (senderId) {
      const sender = await this.prisma.user.findUnique({
        where: { id: senderId },
        select: { name: true },
      });
      senderName = sender?.name || null;
    }

    // Look up the quoted message if replying
    let quotedPayload: any = undefined;
    let replyToText: string | null = null;
    if (replyToId) {
      const quoted = await this.prisma.message.findUnique({ where: { id: replyToId } });
      if (quoted?.external_message_id) {
        const remoteJid = `${convo.lead.phone}@s.whatsapp.net`;
        replyToText = quoted.text || null;
        quotedPayload = {
          key: {
            remoteJid,
            fromMe: quoted.direction === 'out',
            id: quoted.external_message_id,
          },
          message: { conversation: quoted.text || '' },
        };
      }
    }

    // 1. Send via Evolution API (com assinatura em negrito se houver atendente)
    // O DB salva o texto limpo; o WhatsApp recebe com assinatura
    const textToSend = senderName ? `*${senderName}:* ${text}` : text;

    let externalMsg: any;
    let sendStatus = 'enviado';
    try {
      externalMsg = await this.whatsapp.sendText(
        convo.lead.phone,
        textToSend,
        convo.instance_name || undefined,
        quotedPayload,
      );
      if (externalMsg?.statusCode >= 400 || externalMsg?.error) {
        this.logger.error(`Evolution API erro ao enviar texto: ${JSON.stringify(externalMsg)}`);
        sendStatus = 'erro';
      }
    } catch (e) {
      this.logger.error(`Exceção ao enviar texto: ${e.message}`);
      sendStatus = 'erro';
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
        status: sendStatus,
        reply_to_id: replyToId || null,
        reply_to_text: replyToText,
      }
    });

    if (sendStatus === 'erro') {
      this.chatGateway.emitNewMessage(convo.id, msg);
      this.chatGateway.emitConversationsUpdate(null);
      throw new BadRequestException('Falha ao enviar mensagem via WhatsApp');
    }

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

  /** Resolve a URL pública da API: prioriza o valor salvo pelo admin no banco (CONTRACT_CONFIG),
   *  depois a variável de ambiente, por último o header do reverse proxy. */
  private async resolvePublicApiUrl(fallbackFromRequest?: string): Promise<string> {
    try {
      const contract = await this.settings.getContractConfig();
      if (contract?.publicApiUrl?.startsWith('http')) return contract.publicApiUrl;
    } catch {
      // ignorar erro ao buscar settings
    }
    return process.env.PUBLIC_API_URL || fallbackFromRequest || '';
  }

  async sendAudio(
    conversationId: string,
    file: Express.Multer.File,
    senderId?: string,
  ) {
    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { lead: true },
    });
    if (!convo || !convo.lead) throw new BadRequestException('Conversa inválida');

    await this.autoReassignIfNeeded(convo, senderId);

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
    const ext = mimeToExt(file.mimetype);
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

    // 4. URL pública que a Evolution API vai baixar (prioridade: banco → env → fallback)
    const resolvedApiUrl = await this.resolvePublicApiUrl();
    const mediaUrl = `${resolvedApiUrl}/media/${msg.id}`;
    this.logger.log(`[AUDIO] Enviando áudio via Evolution: ${mediaUrl}`);

    // 5. Enviar via Evolution API
    let audioSendStatus = 'enviado';
    try {
      const result = await this.whatsapp.sendMedia(
        convo.lead.phone,
        'audio',
        mediaUrl,
        undefined,
        convo.instance_name || undefined,
      );
      if (result?.statusCode >= 400 || result?.error) {
        this.logger.error(`Evolution API erro ao enviar áudio: ${JSON.stringify(result)}`);
        audioSendStatus = 'erro';
      } else {
        const extId = result?.key?.id;
        if (extId) {
          await this.prisma.message.update({
            where: { id: msg.id },
            data: { external_message_id: extId },
          });
        }
      }
    } catch (e) {
      this.logger.error(`Exceção ao enviar áudio: ${e.message}`);
      audioSendStatus = 'erro';
    }

    if (audioSendStatus === 'erro') {
      await this.prisma.message.update({
        where: { id: msg.id },
        data: { status: 'erro' },
      });
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

  async sendFile(
    conversationId: string,
    file: Express.Multer.File,
    caption?: string,
    senderId?: string,
  ) {
    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { lead: true },
    });
    if (!convo || !convo.lead) throw new BadRequestException('Conversa inválida');

    await this.autoReassignIfNeeded(convo, senderId);

    const mime = file.mimetype;
    let mediaType: 'image' | 'document' | 'video';
    if (mime.startsWith('image/')) mediaType = 'image';
    else if (mime.startsWith('video/')) mediaType = 'video';
    else mediaType = 'document';

    const tempExtId = `out_file_${Date.now()}`;
    const msg = await this.prisma.message.create({
      data: {
        conversation_id: convo.id,
        direction: 'out',
        type: mediaType,
        text: caption || null,
        external_message_id: tempExtId,
        status: 'enviado',
      },
    });

    const ext = mimeToExt(mime);
    const s3Key = `media/${msg.id}.${ext}`;
    await this.s3.uploadBuffer(s3Key, file.buffer, mime);

    await this.prisma.media.create({
      data: {
        message_id: msg.id,
        s3_key: s3Key,
        mime_type: mime,
        size: file.size,
        original_name: file.originalname || null,
      },
    });

    const resolvedApiUrl = await this.resolvePublicApiUrl();
    const mediaUrl = `${resolvedApiUrl}/media/${msg.id}`;
    this.logger.log(`[FILE] Enviando ${mediaType} via Evolution: ${mediaUrl}`);
    try {
      const result = await this.whatsapp.sendMedia(
        convo.lead.phone,
        mediaType,
        mediaUrl,
        caption,
        convo.instance_name || undefined,
        file.originalname,
      );
      if (result?.statusCode >= 400 || result?.error) {
        this.logger.error(`Evolution API erro ao enviar arquivo: ${JSON.stringify(result)}`);
        await this.prisma.message.update({
          where: { id: msg.id },
          data: { status: 'erro' },
        });
      } else {
        const extId = result?.key?.id;
        if (extId) {
          await this.prisma.message.update({
            where: { id: msg.id },
            data: { external_message_id: extId },
          });
        }
      }
    } catch (e) {
      this.logger.error(`Exceção ao enviar arquivo via WhatsApp: ${e.message}`);
      await this.prisma.message.update({
        where: { id: msg.id },
        data: { status: 'erro' },
      });
    }

    await this.prisma.conversation.update({
      where: { id: convo.id },
      data: { last_message_at: new Date() },
    });

    const msgWithMedia = await this.prisma.message.findUnique({
      where: { id: msg.id },
      include: { media: true },
    });

    this.chatGateway.emitNewMessage(convo.id, msgWithMedia);
    this.chatGateway.emitConversationsUpdate(null);

    return msgWithMedia;
  }

  async editMessage(messageId: string, newText: string) {
    if (!newText?.trim()) throw new BadRequestException('Texto não pode ser vazio');

    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { conversation: { include: { lead: true } } },
    });

    if (!message) throw new NotFoundException('Mensagem não encontrada');
    if (message.direction !== 'out') throw new BadRequestException('Só é possível editar mensagens enviadas');
    if (message.type === 'deleted') throw new BadRequestException('Mensagem apagada não pode ser editada');
    if (message.type !== 'text') throw new BadRequestException('Só é possível editar mensagens de texto');

    // Tentar editar no WhatsApp (best-effort — mesma abordagem do delete)
    if (message.external_message_id && message.conversation.lead?.phone) {
      try {
        await this.whatsapp.editMessage(
          message.conversation.instance_name || '',
          message.conversation.lead.phone,
          message.external_message_id,
          newText.trim(),
        );
      } catch (e) {
        this.logger.warn(`Falha ao editar no WhatsApp: ${e.message}`);
      }
    }

    // Atualizar texto no banco
    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { text: newText.trim() },
    });

    // Emitir atualização via WebSocket
    this.chatGateway.emitMessageUpdate(message.conversation_id, updated);

    return updated;
  }

  async deleteMessage(messageId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { conversation: { include: { lead: true } } },
    });

    if (!message) throw new NotFoundException('Mensagem não encontrada');

    // Tentar apagar no WhatsApp (best-effort)
    if (message.external_message_id) {
      const fromMe = message.direction === 'out';
      const remoteJid = message.conversation.lead?.phone
        ? `${message.conversation.lead.phone}@s.whatsapp.net`
        : '';
      try {
        await this.whatsapp.deleteForEveryone(
          message.conversation.instance_name || '',
          remoteJid,
          message.external_message_id,
          fromMe,
        );
      } catch (e) {
        this.logger.warn(`Falha ao apagar no WhatsApp: ${e.message}`);
      }
    }

    // Marcar como apagada no banco
    const deleted = await this.prisma.message.update({
      where: { id: messageId },
      data: { type: 'deleted', text: null },
    });

    // Emitir atualização via WebSocket
    this.chatGateway.emitMessageUpdate(message.conversation_id, deleted);

    return deleted;
  }

  async transcribeAudio(messageId: string): Promise<{ transcription: string }> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { media: true },
    });

    if (!message) throw new NotFoundException('Mensagem não encontrada');
    if (message.type !== 'audio') throw new BadRequestException('Mensagem não é um áudio');
    if (!message.media) throw new BadRequestException('Mídia ainda não processada');

    const { apiKey: openAiKey } = await this.settings.getAiConfig();
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

  async correctText(text: string, action: string): Promise<{ result: string }> {
    const { apiKey } = await this.settings.getAiConfig();
    if (!apiKey) throw new BadRequestException('OPENAI_API_KEY não configurada');

    const prompts: Record<string, string> = {
      corrigir: 'Corrija a ortografia e gramática do texto a seguir. Retorne apenas o texto corrigido, sem nenhuma explicação.',
      formalizar: 'Reescreva o texto a seguir de forma mais formal e profissional. Retorne apenas o texto reescrito, sem nenhuma explicação.',
      profissional: 'Reescreva o texto a seguir de forma profissional, adequada para comunicação jurídica. Retorne apenas o texto reescrito, sem nenhuma explicação.',
      resumir: 'Resuma o texto a seguir de forma concisa. Retorne apenas o resumo, sem nenhuma explicação.',
      simplificar: 'Simplifique o texto a seguir, tornando-o mais claro e direto ao ponto. Retorne apenas o texto simplificado, sem nenhuma explicação.',
    };

    const systemPrompt = prompts[action] ?? prompts['corrigir'];

    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
    });

    const result = completion.choices[0]?.message?.content?.trim() || text;
    return { result };
  }

  async getLinkPreview(url: string): Promise<{
    url: string;
    title: string | null;
    description: string | null;
    image: string | null;
    domain: string;
  }> {
    const domain = (() => {
      try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
    })();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; LinkPreviewBot/1.0)',
          Accept: 'text/html',
        },
        redirect: 'follow',
      }).finally(() => clearTimeout(timeout));

      if (!res.ok) return { url, title: null, description: null, image: null, domain };

      const html = await res.text();

      const getOg = (prop: string): string | null => {
        const m = html.match(new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']+)["']`, 'i'))
          || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${prop}["']`, 'i'));
        return m ? m[1].trim() : null;
      };

      const getMeta = (name: string): string | null => {
        const m = html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'))
          || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`, 'i'));
        return m ? m[1].trim() : null;
      };

      const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);

      const title = getOg('title') || getMeta('title') || (titleTag ? titleTag[1].trim() : null);
      const description = getOg('description') || getMeta('description');
      let image = getOg('image');

      // Make relative image URLs absolute
      if (image && !image.startsWith('http')) {
        try {
          const base = new URL(url);
          image = new URL(image, base.origin).toString();
        } catch { image = null; }
      }

      return { url, title, description, image, domain };
    } catch (e: any) {
      this.logger.warn(`[LinkPreview] Falha ao obter preview para ${url}: ${e.message}`);
      return { url, title: null, description: null, image: null, domain };
    }
  }

  async reactToMessage(messageId: string, emoji: string, userId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { conversation: { include: { lead: true } } },
    });

    if (!message) throw new NotFoundException('Mensagem não encontrada');

    // Best-effort: send reaction to WhatsApp
    if (message.external_message_id && message.conversation.lead?.phone) {
      const remoteJid = `${message.conversation.lead.phone}@s.whatsapp.net`;
      try {
        await this.whatsapp.sendReaction(
          message.conversation.instance_name || '',
          {
            remoteJid,
            fromMe: message.direction === 'out',
            id: message.external_message_id,
          },
          emoji,
        );
      } catch (e) {
        this.logger.warn(`Falha ao enviar reação via WhatsApp: ${e.message}`);
      }
    }

    // Upsert or delete reaction in DB
    if (!emoji || emoji === '') {
      await (this.prisma as any).messageReaction.deleteMany({
        where: { message_id: messageId, user_id: userId },
      });
    } else {
      await (this.prisma as any).messageReaction.upsert({
        where: { message_id_user_id: { message_id: messageId, user_id: userId } },
        update: { emoji },
        create: { message_id: messageId, user_id: userId, emoji },
      });
    }

    // Fetch all reactions and broadcast
    const reactions = await (this.prisma as any).messageReaction.findMany({
      where: { message_id: messageId },
    });

    this.chatGateway.emitMessageReaction(message.conversation_id, {
      messageId,
      reactions,
    });

    return { messageId, reactions };
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
