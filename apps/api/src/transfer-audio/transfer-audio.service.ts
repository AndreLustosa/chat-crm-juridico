import { Injectable, Logger, NotFoundException, HttpException, HttpStatus } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MediaS3Service } from '../media/s3.service';

@Injectable()
export class TransferAudioService {
  private readonly logger = new Logger(TransferAudioService.name);

  constructor(
    private prisma: PrismaService,
    private s3: MediaS3Service,
  ) {}

  /** Upload de um áudio de transferência — retorna o registro criado */
  async upload(
    conversationId: string,
    buffer: Buffer,
    mimeType: string,
    size: number,
    uploadedById?: string,
  ) {
    const id = crypto.randomUUID();
    const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm';
    const s3Key = `transfer-audios/${conversationId}/${id}.${ext}`;

    try {
      await this.s3.uploadBuffer(s3Key, buffer, mimeType);
    } catch (err: any) {
      const code = err?.Code || err?.name || '';
      if (code === 'XMinioStorageFull' || err?.$metadata?.httpStatusCode === 507) {
        this.logger.error(`[TransferAudio] MinIO storage full! Key: ${s3Key}`);
        throw new HttpException(
          'Armazenamento do servidor está cheio. Contate o administrador para liberar espaço.',
          HttpStatus.INSUFFICIENT_STORAGE, // 507
        );
      }
      throw err;
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 dias

    const record = await (this.prisma as any).transferAudio.create({
      data: {
        id,
        conversation_id: conversationId,
        s3_key: s3Key,
        mime_type: mimeType,
        size,
        uploaded_by_id: uploadedById ?? null,
        expires_at: expiresAt,
      },
    });

    this.logger.log(`[TransferAudio] Uploaded ${s3Key} (id: ${id})`);
    return record;
  }

  /** Stream de um áudio — verifica expiração antes de servir */
  async stream(id: string) {
    const record = await (this.prisma as any).transferAudio.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Áudio não encontrado');
    if (record.expires_at < new Date()) throw new NotFoundException('Áudio expirado');

    return this.s3.getObjectStream(record.s3_key);
  }

  /** Buscar todos os áudios de uma conversa (não expirados) */
  async findByConversation(conversationId: string) {
    return (this.prisma as any).transferAudio.findMany({
      where: {
        conversation_id: conversationId,
        expires_at: { gt: new Date() },
      },
      orderBy: { created_at: 'asc' },
      select: { id: true, mime_type: true, size: true, created_at: true },
    });
  }

  /** Deletar um áudio imediatamente */
  async delete(id: string) {
    const record = await (this.prisma as any).transferAudio.findUnique({ where: { id } });
    if (!record) return { success: true };

    try {
      await this.s3.deleteObject(record.s3_key);
    } catch (e: any) {
      this.logger.warn(`[TransferAudio] S3 delete failed for ${record.s3_key}: ${e?.message}`);
    }
    await (this.prisma as any).transferAudio.delete({ where: { id } });
    return { success: true };
  }

  /** Cron: toda hora limpa registros expirados */
  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpired() {
    const expired = await (this.prisma as any).transferAudio.findMany({
      where: { expires_at: { lt: new Date() } },
      select: { id: true, s3_key: true },
    });

    if (!expired.length) return;

    this.logger.log(`[TransferAudio] Cleaning up ${expired.length} expired audio(s)...`);

    await Promise.allSettled(
      expired.map(async (rec: any) => {
        try {
          await this.s3.deleteObject(rec.s3_key);
        } catch (e: any) {
          this.logger.warn(`[TransferAudio] S3 delete failed for ${rec.s3_key}: ${e?.message}`);
        }
        await (this.prisma as any).transferAudio.delete({ where: { id: rec.id } });
      }),
    );

    this.logger.log(`[TransferAudio] Cleanup done.`);
  }
}
