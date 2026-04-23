import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createReadStream, promises as fs } from 'fs';
import { basename } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { MediaS3Service } from '../media/s3.service';
import { createTranscriptionProvider } from '@crm/shared';
import { UpdateSpeakersDto, UpdateTranscriptionDto } from './dto';

export const TRANSCRIPTION_QUEUE = 'transcription-jobs';

type TranscriptionStatus =
  | 'PENDING'
  | 'UPLOADING'
  | 'CONVERTING'
  | 'TRANSCRIBING'
  | 'DIARIZING'
  | 'DONE'
  | 'ERROR';

@Injectable()
export class AudienciaTranscricaoService {
  private readonly logger = new Logger(AudienciaTranscricaoService.name);
  private readonly provider = createTranscriptionProvider();

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: MediaS3Service,
    @InjectQueue(TRANSCRIPTION_QUEUE) private readonly queue: Queue,
  ) {}

  // ─── Upload + kickoff ────────────────────────────────────────────────────

  /**
   * Cria registro, faz upload do arquivo pro S3 e enfileira job.
   * O `tmpPath` é o caminho onde o multer salvou o arquivo (diskStorage).
   */
  async createFromUpload(params: {
    caseId: string;
    title: string;
    tmpPath: string;
    originalName: string;
    mime: string;
    size: number;
    userId: string;
    tenantId?: string | null;
    minSpeakers?: number;
    maxSpeakers?: number;
  }) {
    const legalCase = await (this.prisma as any).legalCase.findUnique({
      where: { id: params.caseId },
      select: { id: true, tenant_id: true },
    });
    if (!legalCase) throw new NotFoundException('Processo não encontrado');

    // Ext do arquivo (pra compor a s3_key). Fallback pra "bin" se não vier.
    const ext = (params.originalName.split('.').pop() || 'bin')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');

    const record = await (this.prisma as any).caseTranscription.create({
      data: {
        legal_case_id: params.caseId,
        tenant_id: legalCase.tenant_id ?? params.tenantId ?? null,
        uploaded_by_id: params.userId,
        title: params.title || params.originalName,
        status: 'UPLOADING' as TranscriptionStatus,
        progress: 0,
        provider: this.provider.name,
        model: process.env.WHISPER_MODEL || 'large-v3',
        diarize: true,
        source_s3_key: '', // preenchido após upload
        source_mime: params.mime,
        source_size: params.size,
      },
    });

    try {
      const s3Key = `transcricoes/${params.caseId}/${record.id}/source.${ext}`;
      await this.s3.uploadStream(
        s3Key,
        createReadStream(params.tmpPath),
        params.mime,
        params.size,
      );
      await fs.unlink(params.tmpPath).catch(() => {});

      await (this.prisma as any).caseTranscription.update({
        where: { id: record.id },
        data: {
          source_s3_key: s3Key,
          status: 'PENDING' as TranscriptionStatus,
        },
      });

      await this.queue.add(
        'transcribe',
        {
          transcriptionId: record.id,
          sourceS3Key: s3Key,
          sourceMime: params.mime,
          minSpeakers: params.minSpeakers,
          maxSpeakers: params.maxSpeakers,
        },
        {
          attempts: 2,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );

      this.logger.log(`[Transcricao] Job enfileirado id=${record.id} case=${params.caseId} size=${params.size}`);
      return record;
    } catch (err: any) {
      this.logger.error(`[Transcricao] Upload falhou id=${record.id}: ${err?.message}`);
      await (this.prisma as any).caseTranscription.update({
        where: { id: record.id },
        data: {
          status: 'ERROR' as TranscriptionStatus,
          error_message: `Upload falhou: ${err?.message || String(err)}`,
        },
      });
      await fs.unlink(params.tmpPath).catch(() => {});
      throw err;
    }
  }

  // ─── Queries ─────────────────────────────────────────────────────────────

  async listByCase(caseId: string) {
    return (this.prisma as any).caseTranscription.findMany({
      where: { legal_case_id: caseId },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        title: true,
        status: true,
        progress: true,
        error_message: true,
        provider: true,
        diarize: true,
        duration_sec: true,
        language: true,
        source_size: true,
        video_s3_key: true,
        created_at: true,
        finished_at: true,
        uploaded_by: { select: { id: true, name: true } },
      },
    });
  }

  async getById(id: string) {
    const t = await (this.prisma as any).caseTranscription.findUnique({
      where: { id },
      include: { uploaded_by: { select: { id: true, name: true } } },
    });
    if (!t) throw new NotFoundException('Transcrição não encontrada');
    return t;
  }

  // ─── Mutations ───────────────────────────────────────────────────────────

  async update(id: string, data: UpdateTranscriptionDto) {
    await this.getById(id);
    return (this.prisma as any).caseTranscription.update({
      where: { id },
      data: { title: data.title },
    });
  }

  async updateSpeakers(id: string, data: UpdateSpeakersDto) {
    await this.getById(id);
    return (this.prisma as any).caseTranscription.update({
      where: { id },
      data: { speakers_json: data.speakers as any },
    });
  }

  async retry(id: string) {
    const t = await this.getById(id);
    if (t.status !== 'ERROR') {
      throw new BadRequestException('Só posso reprocessar transcrições com status ERROR');
    }
    if (!t.source_s3_key) {
      throw new BadRequestException('Arquivo original não encontrado no S3');
    }
    await (this.prisma as any).caseTranscription.update({
      where: { id },
      data: { status: 'PENDING', progress: 0, error_message: null },
    });
    await this.queue.add(
      'transcribe',
      { transcriptionId: id, sourceS3Key: t.source_s3_key, sourceMime: t.source_mime },
      { attempts: 2, removeOnComplete: true },
    );
    return { ok: true };
  }

  async delete(id: string) {
    const t = await this.getById(id);
    // Remove arquivos do S3 best-effort
    for (const key of [t.source_s3_key, t.video_s3_key, t.audio_s3_key].filter(Boolean)) {
      try {
        await this.s3.deleteObject(key as string);
      } catch (e: any) {
        this.logger.warn(`[Transcricao] S3 delete falhou ${key}: ${e?.message}`);
      }
    }
    await (this.prisma as any).caseTranscription.delete({ where: { id } });
    return { ok: true };
  }

  // ─── Stream vídeo convertido ────────────────────────────────────────────

  async getVideoStream(id: string, rangeStart?: number, rangeEnd?: number) {
    const t = await this.getById(id);
    if (!t.video_s3_key) {
      throw new BadRequestException('Vídeo ainda não foi convertido');
    }
    return this.s3.getObjectStream(t.video_s3_key, rangeStart, rangeEnd);
  }

  // ─── Export TXT / SRT / VTT ─────────────────────────────────────────────

  async exportText(id: string, format: 'txt' | 'srt' | 'vtt'): Promise<{
    content: string;
    filename: string;
    contentType: string;
  }> {
    const t = await this.getById(id);
    if (t.status !== 'DONE' || !t.text) {
      throw new BadRequestException('Transcrição ainda não está pronta');
    }

    const speakers = (t.speakers_json as Array<{ id: string; label: string }>) || [];
    const speakerMap = new Map(speakers.map((s) => [s.id, s.label]));
    const segments = (t.segments_json as Array<any>) || [];
    const base = (t.title || 'transcricao').replace(/[^\w.-]+/g, '_').slice(0, 80);

    if (format === 'txt') {
      const lines: string[] = [];
      let lastSpeaker = '';
      for (const seg of segments) {
        const speaker = speakerMap.get(seg.speaker) || seg.speaker || '';
        if (speaker && speaker !== lastSpeaker) {
          lines.push(`\n${speaker}:`);
          lastSpeaker = speaker;
        }
        lines.push(seg.text.trim());
      }
      return {
        content: lines.join('\n').trim() + '\n',
        filename: `${base}.txt`,
        contentType: 'text/plain; charset=utf-8',
      };
    }

    if (format === 'srt') {
      const lines: string[] = [];
      segments.forEach((seg, i) => {
        const speaker = speakerMap.get(seg.speaker) || seg.speaker || '';
        const prefix = speaker ? `[${speaker}] ` : '';
        lines.push(String(i + 1));
        lines.push(`${srtTime(seg.start)} --> ${srtTime(seg.end)}`);
        lines.push(prefix + (seg.text || '').trim());
        lines.push('');
      });
      return {
        content: lines.join('\n'),
        filename: `${base}.srt`,
        contentType: 'application/x-subrip; charset=utf-8',
      };
    }

    // vtt
    const lines: string[] = ['WEBVTT', ''];
    segments.forEach((seg) => {
      const speaker = speakerMap.get(seg.speaker) || seg.speaker || '';
      lines.push(`${vttTime(seg.start)} --> ${vttTime(seg.end)}`);
      const prefix = speaker ? `<v ${speaker}>` : '';
      lines.push(prefix + (seg.text || '').trim());
      lines.push('');
    });
    return {
      content: lines.join('\n'),
      filename: `${base}.vtt`,
      contentType: 'text/vtt; charset=utf-8',
    };
  }

  async providerHealth() {
    return this.provider.health();
  }
}

function pad(n: number, z = 2) {
  return String(n).padStart(z, '0');
}
function srtTime(sec: number) {
  if (!Number.isFinite(sec)) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec - Math.floor(sec)) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}
function vttTime(sec: number) {
  return srtTime(sec).replace(',', '.');
}
