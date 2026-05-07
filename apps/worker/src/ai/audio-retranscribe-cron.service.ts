import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { CronRunnerService } from '../common/cron/cron-runner.service';

/**
 * Cron de retry de transcricao de audios que ficaram sem texto.
 *
 * Contexto (2026-04-23):
 *   autoTranscribeAudios so roda dentro de AiProcessor.process, que eh
 *   acionado quando chega mensagem nova do cliente na conversa. Se a
 *   primeira tentativa falha (ex: race condition no deploy quebrando o
 *   endpoint HTTP, timeout da OpenAI, filesystem perdido), o audio fica
 *   orfao com `text = ''` ou `text = null` ate o cliente mandar outra msg.
 *
 *   Em cenarios extremos o cliente pode nunca mais escrever na conversa
 *   (ex: audio sobre desistencia) — aí a transcricao nunca acontece.
 *
 * Solucao:
 *   A cada 15 min, este cron busca audios `in` (recebidos) dos ultimos
 *   3 dias sem transcricao e enfileira job de IA na conversa. O proprio
 *   AiProcessor ja tem o loop de autoTranscribeAudios, que vai re-tentar.
 *
 *   Agrupa por conversation_id — 1 job por conversa, nao 1 por audio —
 *   pra evitar floodar a fila.
 *
 *   Janela de 3 dias porque apos isso eh raro o arquivo ainda existir
 *   no filesystem local (se nao tiver volume persistente). Alem disso,
 *   contexto da conversa ja eh antigo demais pra transcricao fazer diferenca.
 */
@Injectable()
export class AudioRetranscribeCronService {
  private readonly logger = new Logger(AudioRetranscribeCronService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('ai-jobs') private aiQueue: Queue,
    private cronRunner: CronRunnerService,
  ) {}

  @Cron('*/15 * * * *', { timeZone: 'America/Maceio' })
  async retryPendingTranscriptions() {
    await this.cronRunner.run(
      'ai-audio-retranscribe',
      14 * 60,
      async () => {
      // Audios sem texto (null ou vazio) dos ultimos 3 dias COM file_path
      // (indica que o download inicial funcionou mas transcricao falhou)
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const audioMessages = await this.prisma.message.findMany({
        where: {
          type: 'audio',
          direction: 'in',
          created_at: { gte: threeDaysAgo },
          OR: [{ text: null }, { text: '' }],
          media: {
            is: {
              // So retry se tem file_path (download original deu certo).
              // Se nao tem file_path nem s3_key, o download original falhou
              // e retry aqui nao resolveria (precisa retry do download).
              OR: [
                { file_path: { not: null } },
                { s3_key: { not: null } },
              ],
            },
          },
        },
        select: {
          id: true,
          conversation_id: true,
        },
      });

      if (audioMessages.length === 0) return;

      // Antes de enfileirar retry, faz HEAD/GET nos audios cujo file_path
      // no DB existe mas o arquivo fisico pode ter sumido (cenario classico
      // de volume nao montado — bug 2026-04-27). O endpoint @Public GET
      // /media/:id ja tem auto-retry interno: se o arquivo nao existe
      // no FS, dispara retryDownload via Evolution (se < 48h). Sem este
      // pre-fetch, o retry de transcricao ia bater no mesmo file_path
      // orfao no AiProcessor.
      //
      // Best-effort: se nao conseguir, segue pra enfileirar IA mesmo
      // assim. Audios do WhatsApp sao pequenos (~5KB), entao o GET pleno
      // nao adiciona overhead significativo. Usa Range: bytes=0-0 pra so
      // pegar 1 byte (o controller ainda dispara o fluxo de retryDownload
      // se o arquivo nao existir antes de servir).
      const apiInternalUrl = process.env.API_INTERNAL_URL || 'http://crm-api:3001';
      let recovered = 0;
      let recoveryFailed = 0;
      for (const m of audioMessages) {
        try {
          const r = await axios.get(`${apiInternalUrl}/media/${m.id}`, {
            timeout: 60_000,
            responseType: 'arraybuffer',
            headers: { Range: 'bytes=0-0' },
            validateStatus: (s) => s < 500,
          });
          if (r.status === 200 || r.status === 206) recovered++;
          else recoveryFailed++;
        } catch {
          recoveryFailed++;
        }
      }
      if (recovered > 0 || recoveryFailed > 0) {
        this.logger.log(
          `[AUDIO-RETRY] Pre-recovery: ${recovered} arquivos OK, ${recoveryFailed} irrecuperaveis`,
        );
      }

      // Agrupa por conversation_id (1 job por conversa)
      const conversationIds = Array.from(
        new Set(audioMessages.map((m) => m.conversation_id).filter(Boolean)),
      );

      this.logger.log(
        `[AUDIO-RETRY] ${audioMessages.length} audio(s) sem transcricao em ${conversationIds.length} conversa(s) — enfileirando retry`,
      );

      for (const conversationId of conversationIds) {
        try {
          // jobId deterministico evita duplicar jobs quando o cron roda
          // varias vezes antes do anterior terminar. BullMQ deduplica por jobId.
          const jobId = `audio-retry-${conversationId}-${Math.floor(Date.now() / (15 * 60 * 1000))}`;
          // Payload com `transcribe_only: true` — AiProcessor detecta esse
          // flag e pula a geracao de resposta, so atualiza text no banco.
          // Evita spammar cliente inativo com mensagem "surpresa" da IA.
          await this.aiQueue.add(
            'process_ai_response',
            { conversation_id: conversationId, transcribe_only: true },
            {
              jobId,
              attempts: 2,
              removeOnComplete: true,
              removeOnFail: 20,
            },
          );
        } catch (e: any) {
          // Job ja existe (dedup) — nao tem erro
          if (!e?.message?.includes('already exists')) {
            this.logger.warn(
              `[AUDIO-RETRY] Falha ao enfileirar conv ${conversationId}: ${e?.message || e}`,
            );
          }
        }
      }
      },
      { description: 'Re-enfileira transcricao de audios sem texto (3d janela, agrupado por conv)', schedule: '*/15 * * * *' },
    );
  }
}
