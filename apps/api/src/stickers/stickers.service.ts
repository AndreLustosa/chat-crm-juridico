import { Injectable, BadRequestException, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FileStorageService } from '../media/filesystem.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { SettingsService } from '../settings/settings.service';

/**
 * Biblioteca compartilhada de figurinhas do escritorio. Cada tenant tem sua
 * propria colecao — admin/operador sobe um WebP/PNG e todos da equipe veem
 * e podem enviar pelos chats.
 *
 * Storage: reusa o FileStorageService do MediaModule (mesma pasta MEDIA_STORAGE_PATH
 * em subpasta "stickers/"). URL publica em GET /stickers/:id/file (sem token
 * — a Evolution precisa baixar pra mandar pro WhatsApp).
 *
 * Ao deletar um sticker da biblioteca, o ARQUIVO no disco fica (pode estar
 * referenciado por Messages ja enviadas). Apenas a row da Sticker some, e a
 * UI para de listar.
 */
@Injectable()
export class StickersService {
  private readonly logger = new Logger(StickersService.name);

  constructor(
    private prisma: PrismaService,
    private fileStorage: FileStorageService,
    private whatsapp: WhatsappService,
    private chatGateway: ChatGateway,
    private settings: SettingsService,
  ) {}

  /** Lista os stickers do escritorio (mais recentes primeiro). */
  async list(tenantId: string) {
    return this.prisma.sticker.findMany({
      where: { tenant_id: tenantId },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        mime_type: true,
        size: true,
        original_name: true,
        created_at: true,
        created_by: { select: { id: true, name: true } },
      },
    });
  }

  /** Salva um novo sticker na biblioteca (WebP ou PNG, max 5MB — controller valida). */
  async upload(tenantId: string, file: Express.Multer.File, userId?: string) {
    if (!file) throw new BadRequestException('Arquivo ausente');
    const ext = file.mimetype === 'image/webp' ? 'webp' : 'png';
    // Reusa o FileStorage do MediaModule. generatePath usa o id passado pra criar
    // o caminho — geramos um id ad-hoc agora e usamos depois pra criar a row.
    const stickerId = (await import('crypto')).randomUUID();
    const filePath = this.fileStorage.generatePath(`stickers/${stickerId}`, ext);
    await this.fileStorage.write(filePath, file.buffer);

    const sticker = await this.prisma.sticker.create({
      data: {
        id: stickerId,
        tenant_id: tenantId,
        file_path: filePath,
        mime_type: file.mimetype,
        size: file.size,
        original_name: file.originalname || null,
        ...(userId ? { created_by_id: userId } : {}),
      },
      select: {
        id: true,
        mime_type: true,
        size: true,
        original_name: true,
        created_at: true,
        created_by: { select: { id: true, name: true } },
      },
    });
    this.logger.log(`[STICKER] Novo na biblioteca tenant=${tenantId} id=${stickerId} size=${file.size}`);
    return sticker;
  }

  /** Remove o sticker da biblioteca. O arquivo no disco fica (Messages historicas
   *  podem referenciar). */
  async remove(stickerId: string, tenantId: string) {
    const sticker = await this.prisma.sticker.findUnique({ where: { id: stickerId } });
    if (!sticker) throw new NotFoundException('Sticker nao encontrado');
    if (sticker.tenant_id !== tenantId) throw new ForbiddenException('Sticker de outro escritorio');
    await this.prisma.sticker.delete({ where: { id: stickerId } });
    return { ok: true };
  }

  /** Retorna o arquivo bruto do sticker (usado pelo GET publico e pelo Evolution). */
  async getFile(stickerId: string) {
    const sticker = await this.prisma.sticker.findUnique({ where: { id: stickerId } });
    if (!sticker) throw new NotFoundException('Sticker nao encontrado');
    if (!(await this.fileStorage.exists(sticker.file_path))) {
      throw new NotFoundException('Arquivo do sticker indisponivel');
    }
    return {
      sticker,
      stream: this.fileStorage.readStream(sticker.file_path),
      size: sticker.size,
    };
  }

  /** Envia um sticker salvo da biblioteca pra uma conversa. Cria mensagem
   *  type='sticker' + Media (compartilhando file_path), dispara Evolution
   *  sendSticker e emite socket. */
  async sendSaved(conversationId: string, stickerId: string, senderTenantId: string, senderId?: string) {
    const sticker = await this.prisma.sticker.findUnique({ where: { id: stickerId } });
    if (!sticker) throw new NotFoundException('Sticker nao encontrado');
    if (sticker.tenant_id !== senderTenantId) throw new ForbiddenException('Sticker de outro escritorio');

    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { lead: true },
    });
    if (!convo || !convo.lead) throw new BadRequestException('Conversa invalida');
    if (convo.tenant_id && convo.tenant_id !== senderTenantId) {
      throw new ForbiddenException('Conversa de outro escritorio');
    }

    const tempExtId = `out_sticker_lib_${Date.now()}`;
    const msg = await this.prisma.message.create({
      data: {
        conversation_id: convo.id,
        direction: 'out',
        type: 'sticker',
        text: null,
        external_message_id: tempExtId,
        status: 'enviado',
      },
    });

    // Media row referenciando o MESMO arquivo do sticker — economiza disco.
    // Ao deletar o sticker da biblioteca o file_path fica preservado, entao
    // a mensagem historica continua acessivel.
    await this.prisma.media.create({
      data: {
        message_id: msg.id,
        file_path: sticker.file_path,
        mime_type: sticker.mime_type,
        size: sticker.size,
        original_name: sticker.original_name,
      },
    });

    // Resolve URL publica do backend pra Evolution baixar o sticker.
    const apiUrl = process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 3001}`;
    const stickerUrl = `${apiUrl}/media/${msg.id}`;
    this.logger.log(`[STICKER-LIB] Enviando via Evolution: ${stickerUrl}`);

    try {
      const result = await this.whatsapp.sendSticker(
        convo.lead.phone,
        stickerUrl,
        convo.instance_name || undefined,
      );
      if (result?.statusCode >= 400 || result?.error) {
        this.logger.error(`Evolution API erro ao enviar sticker: ${JSON.stringify(result)}`);
        await this.prisma.message.update({ where: { id: msg.id }, data: { status: 'erro' } });
      } else {
        const extId = result?.key?.id;
        if (extId) {
          await this.prisma.message.update({ where: { id: msg.id }, data: { external_message_id: extId } });
        }
      }
    } catch (e: any) {
      this.logger.error(`Excecao ao enviar sticker via WhatsApp: ${e.message}`);
      await this.prisma.message.update({ where: { id: msg.id }, data: { status: 'erro' } });
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
    this.chatGateway.emitConversationsUpdate(convo.tenant_id ?? null);

    return msgWithMedia;
  }
}
