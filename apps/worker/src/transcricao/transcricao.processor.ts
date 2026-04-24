import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';
import { createProviderById } from '@crm/shared';
import type { TranscriptionJobStatus, TranscriptionProvider } from '@crm/shared';
import { convertToMp4, extractAudioWav, extractAudioMp3 } from './ffmpeg.util';

/**
 * Pipeline de transcrição de audiência:
 *
 *   1. Baixa source do S3 (ASF/MP4/etc.) pra disco
 *   2. ffmpeg: source → MP4 web-friendly
 *   3. Upload do MP4 pro S3 (video_s3_key) — já dá pro usuário assistir
 *   4. ffmpeg: source → WAV 16kHz mono
 *   5. Upload do WAV pro S3 (audio_s3_key)
 *   6. Submit pro crm-whisper via provider pluggable
 *   7. Polling do job (a cada 15s) — atualiza progress no banco
 *   8. Quando done: salva text + segments + detecta speakers únicos
 *
 * Se o container crm-whisper reiniciar no meio, o polling detecta `job_lost`
 * e reenfileira automaticamente (via BullMQ attempts).
 */
@Processor('transcription-jobs')
export class TranscricaoProcessor extends WorkerHost {
  private readonly logger = new Logger(TranscricaoProcessor.name);
  private readonly providers = new Map<string, TranscriptionProvider>();

  // Polling: a cada 15s durante job ativo. Timeout duro de 12h (audiência grande).
  private readonly POLL_INTERVAL_MS = 15_000;
  private readonly MAX_WAIT_MS = 12 * 60 * 60 * 1000;

  /** Lazy: instancia o provider só na primeira vez que precisar dele. */
  private getProvider(id: string): TranscriptionProvider {
    let p = this.providers.get(id);
    if (!p) {
      p = createProviderById(id);
      this.providers.set(id, p);
    }
    return p;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    if (job.name !== 'transcribe') {
      this.logger.warn(`Job desconhecido "${job.name}" — ignorando`);
      return null;
    }
    return this.runTranscribe(job);
  }

  private async runTranscribe(job: Job) {
    const data = job.data as {
      transcriptionId: string;
      sourceS3Key: string;
      sourceMime: string;
      providerId?: string; // 'whisper-local' | 'groq' (default whisper-local)
      minSpeakers?: number;
      maxSpeakers?: number;
    };
    const { transcriptionId } = data;
    const providerId = data.providerId || process.env.TRANSCRIPTION_PROVIDER || 'whisper-local';
    const provider = this.getProvider(providerId);
    const isGroq = providerId === 'groq';

    const workDir = join(tmpdir(), `transcr-${transcriptionId}-${randomUUID()}`);
    await fs.mkdir(workDir, { recursive: true });

    try {
      await this.updateStatus(transcriptionId, {
        status: 'CONVERTING',
        progress: 5,
        provider: providerId,
        started_at: new Date(),
      });

      // 1. Download do source (ASF/MP4/etc.)
      const sourcePath = join(workDir, 'source.bin');
      this.logger.log(`[${transcriptionId}] baixando source do S3 (provider=${providerId})`);
      await this.s3.downloadToFile(data.sourceS3Key, sourcePath);
      await this.updateStatus(transcriptionId, { progress: 15 });

      // 2. Converte pra MP4 web-friendly (pro player do frontend)
      const mp4Path = join(workDir, 'video.mp4');
      this.logger.log(`[${transcriptionId}] convertendo pra MP4`);
      await convertToMp4(sourcePath, mp4Path);
      await this.updateStatus(transcriptionId, { progress: 25 });

      // 3. Upload MP4 pro S3
      const caseIdFromKey = data.sourceS3Key.split('/')[1];
      const videoKey = `transcricoes/${caseIdFromKey}/${transcriptionId}/video.mp4`;
      await this.s3.uploadFile(videoKey, mp4Path, 'video/mp4');
      await this.updateStatus(transcriptionId, {
        progress: 35,
        video_s3_key: videoKey,
      });

      // 4. Extrai áudio — formato depende do provider
      //    - whisper-local: WAV 16kHz mono (sem perdas, container Python lê do S3)
      //    - groq: MP3 32kbps mono (precisa caber em 25MB, enviado direto via multipart)
      const audioPath = isGroq
        ? join(workDir, 'audio.mp3')
        : join(workDir, 'audio.wav');
      const audioMime = isGroq ? 'audio/mpeg' : 'audio/wav';
      const audioExt = isGroq ? 'mp3' : 'wav';

      this.logger.log(`[${transcriptionId}] extraindo áudio (${isGroq ? 'MP3 32kbps pro Groq' : 'WAV 16kHz pro Whisper local'})`);
      if (isGroq) {
        await extractAudioMp3(sourcePath, audioPath);
      } else {
        await extractAudioWav(sourcePath, audioPath);
      }
      await this.updateStatus(transcriptionId, { progress: 40 });

      // 5. Upload do áudio pro S3 (mantém histórico em ambos os casos —
      //    permite reprocessar com outro provider depois sem refazer ffmpeg)
      const audioKey = `transcricoes/${caseIdFromKey}/${transcriptionId}/audio.${audioExt}`;
      await this.s3.uploadFile(audioKey, audioPath, audioMime);
      await this.updateStatus(transcriptionId, {
        progress: 45,
        audio_s3_key: audioKey,
        status: 'TRANSCRIBING',
      });

      // 6. Dispara o job no provider escolhido
      //    - whisper-local: passa s3_key (Python baixa do MinIO)
      //    - groq: passa local_path (provider lê o arquivo e manda multipart)
      const submitInput = isGroq
        ? {
            local_path: audioPath,
            diarize: false, // Groq não diariza
          }
        : {
            s3_key: audioKey,
            diarize: true,
            min_speakers: data.minSpeakers,
            max_speakers: data.maxSpeakers,
          };

      const { job_id } = await provider.submit(submitInput);
      await this.updateStatus(transcriptionId, { external_job_id: job_id });
      this.logger.log(`[${transcriptionId}] submetido ao ${providerId} job=${job_id}`);

      // 7. Polling
      const result = await this.pollUntilDone(transcriptionId, provider, job_id);

      // 8. Salva resultado
      const speakersList = this.extractSpeakers(result.segments);
      await (this.prisma as any).caseTranscription.update({
        where: { id: transcriptionId },
        data: {
          status: 'DONE',
          progress: 100,
          text: result.text,
          language: result.language,
          duration_sec: result.duration_sec,
          segments_json: result.segments as any,
          words_json: result.words as any,
          speakers_json: speakersList as any,
          finished_at: new Date(),
        },
      });

      this.logger.log(
        `[${transcriptionId}] concluído: ${result.duration_sec?.toFixed(0)}s áudio, ` +
        `${result.segments.length} segmentos, ${speakersList.length} falantes`,
      );

      return { ok: true, transcriptionId };
    } catch (err: any) {
      this.logger.error(`[${transcriptionId}] falhou: ${err?.message}`, err?.stack);
      await (this.prisma as any).caseTranscription.update({
        where: { id: transcriptionId },
        data: {
          status: 'ERROR',
          error_message: err?.message || String(err),
          finished_at: new Date(),
        },
      });
      throw err; // BullMQ aplica attempts/backoff
    } finally {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async pollUntilDone(
    transcriptionId: string,
    provider: TranscriptionProvider,
    jobId: string,
  ) {
    const deadline = Date.now() + this.MAX_WAIT_MS;
    let lastProgress = 45;

    while (Date.now() < deadline) {
      await sleep(this.POLL_INTERVAL_MS);
      let status: TranscriptionJobStatus;
      try {
        status = await provider.status(jobId);
      } catch (e: any) {
        this.logger.warn(`[${transcriptionId}] polling falhou: ${e?.message} — reintentando`);
        continue;
      }

      if (status.status === 'done' && status.result) {
        return status.result;
      }
      if (status.status === 'error') {
        throw new Error(status.error || 'whisper retornou error sem mensagem');
      }

      // Mapeia progress do whisper pro nosso range (45-99%)
      const mapped = 45 + Math.floor((status.progress / 100) * 54);
      if (mapped > lastProgress) {
        lastProgress = mapped;
        await this.updateStatus(transcriptionId, {
          progress: mapped,
          status: status.status === 'diarizing' ? 'DIARIZING' : 'TRANSCRIBING',
        });
      }
    }
    throw new Error(`Timeout de ${this.MAX_WAIT_MS / 1000 / 60}min esperando whisper`);
  }

  private extractSpeakers(segments: Array<{ speaker?: string | null }>) {
    const ids = new Set<string>();
    for (const s of segments) {
      if (s.speaker) ids.add(s.speaker);
    }
    const palette = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899'];
    return Array.from(ids)
      .sort()
      .map((id, idx) => ({
        id,
        label: humanLabel(id, idx),
        color: palette[idx % palette.length],
      }));
  }

  private async updateStatus(id: string, patch: Record<string, any>) {
    await (this.prisma as any).caseTranscription.update({
      where: { id },
      data: patch,
    });
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function humanLabel(speakerId: string, idx: number): string {
  // SPEAKER_00 → "Falante 1"
  const m = /SPEAKER_(\d+)/i.exec(speakerId);
  const n = m ? parseInt(m[1], 10) + 1 : idx + 1;
  return `Falante ${n}`;
}
