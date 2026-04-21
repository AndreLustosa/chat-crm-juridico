import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { FollowupAnalyzerService } from './followup-analyzer.service';
import axios from 'axios';

interface StaleConfig {
  stage: string;
  days: number;
  /** Hint opcional que orienta o LLM sobre o motivo do followup */
  hint?: string;
}

@Injectable()
export class FollowupCronService {
  private readonly logger = new Logger(FollowupCronService.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private analyzer: FollowupAnalyzerService,
    @InjectQueue('followup-jobs') private followupQueue: Queue,
  ) {}

  /**
   * Seg-Sex 9h — Processa enrollments com next_send_at vencido + legacy follow-up de estágios
   */
  @Cron('0 9 * * 1-5', { timeZone: 'America/Maceio' })
  async checkStaleLeads() {
    this.logger.log('[FOLLOWUP] Iniciando verificação...');
    await Promise.all([
      this.processEnrollments(),
      this.legacyStageFollowup(),
    ]);
  }

  /**
   * A cada hora — processa enrollments prontos para envio
   */
  @Cron('0 * * * *', { timeZone: 'America/Maceio' })
  async processEnrollments() {
    const now = new Date();
    const enrollments = await this.prisma.followupEnrollment.findMany({
      where: { status: 'ATIVO', next_send_at: { lte: now } },
      select: { id: true },
      take: 50,
    });

    this.logger.log(`[FOLLOWUP] ${enrollments.length} enrollment(s) prontos para processamento`);

    for (const e of enrollments) {
      await this.followupQueue.add('process-step', { enrollment_id: e.id }, {
        jobId: `enroll-${e.id}-${Date.now()}`, removeOnComplete: true,
      });
    }
  }

  /**
   * Legacy: follow-up básico para stages hardcoded (fallback sem sequência configurada)
   */
  /**
   * Cron de followup automatico. Usa IA pra decidir o que fazer com cada lead
   * elegivel — SEND (mensagem gerada pela IA), SKIP (nao envia agora) ou
   * ARCHIVE (arquiva como PERDIDO).
   *
   * Atualizado em 2026-04-21: antes usava templates fixos + keywords hardcoded
   * pra detectar "dead leads". Agora delega toda analise ao FollowupAnalyzerService
   * que usa LLM com historico completo da conversa.
   */
  private async legacyStageFollowup() {
    const staleConfigs: StaleConfig[] = [
      { stage: 'AGUARDANDO_DOCS', days: 3, hint: 'aguardando documentos pendentes' },
      { stage: 'AGUARDANDO_PROC', days: 3, hint: 'procuracao ainda nao assinada' },
      { stage: 'AGUARDANDO_FORM', days: 2, hint: 'ficha/formulario incompleto' },
      { stage: 'QUALIFICANDO', days: 5, hint: 'em qualificacao, parou de responder' },
    ];

    let totalSent = 0;
    let totalSkipped = 0;
    let totalArchived = 0;

    for (const config of staleConfigs) {
      try {
        const cutoff = new Date(Date.now() - config.days * 24 * 60 * 60 * 1000);
        const leads: any[] = await (this.prisma as any).lead.findMany({
          where: {
            stage: config.stage,
            updated_at: { lt: cutoff },
            // So envia pra LEADS (nao clientes contratados).
            is_client: false,
            // Pular leads ja em sequencia customizada ativa
            followup_enrollments: { none: { status: 'ATIVO' } },
          },
          include: {
            conversations: {
              where: { status: 'ABERTO' },
              take: 1,
              orderBy: { last_message_at: 'desc' },
              select: { id: true, instance_name: true, last_message_at: true },
            },
          },
        });

        for (const lead of leads) {
          if (!lead.conversations?.length) continue;
          const convo = lead.conversations[0];

          // Anti-spam basico: se ultima interacao foi < 24h atras, pula sem
          // sequer gastar LLM.
          if (convo.last_message_at) {
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            if (convo.last_message_at > oneDayAgo) {
              totalSkipped++;
              continue;
            }
          }

          // Delega decisao ao analyzer (usa IA com historico completo)
          const decision = await this.analyzer.analyzeAndDecide({
            leadId: lead.id,
            conversationId: convo.id,
            stage: config.stage,
            stageHint: config.hint,
          });

          if (decision.action === 'ARCHIVE') {
            await this.prisma.lead.update({
              where: { id: lead.id },
              data: {
                stage: 'PERDIDO',
                loss_reason: decision.reason || 'Arquivado automaticamente pelo followup (IA detectou desengajamento)',
                last_followup_at: new Date(),
              },
            });
            this.logger.log(
              `[FOLLOWUP-IA] Lead ${lead.phone} ARQUIVADO: ${decision.reason}`,
            );
            totalArchived++;
            continue;
          }

          if (decision.action === 'SKIP') {
            this.logger.debug(
              `[FOLLOWUP-IA] Lead ${lead.phone} PULADO: ${decision.reason}`,
            );
            totalSkipped++;
            continue;
          }

          if (decision.action === 'SEND' && decision.message) {
            try {
              await this.sendGeneratedFollowup(lead, convo, decision.message);
              totalSent++;
              this.logger.log(
                `[FOLLOWUP-IA] Lead ${lead.phone} ENVIADO: "${decision.message.slice(0, 60)}..."`,
              );
            } catch (err: any) {
              this.logger.warn(`[FOLLOWUP-IA] Falha em ${lead.phone}: ${err.message}`);
            }
          }
        }
      } catch (e: any) {
        this.logger.error(`[FOLLOWUP-IA] Erro stage ${config.stage}: ${e.message}`);
      }
    }

    if (totalSent + totalSkipped + totalArchived > 0) {
      this.logger.log(
        `[FOLLOWUP-IA] Resumo: ${totalSent} enviado(s), ${totalSkipped} pulado(s), ${totalArchived} arquivado(s)`,
      );
    }
  }

  /**
   * Envia mensagem de followup gerada pela IA via Evolution API.
   * Usa o mesmo padrao do AI processor (prefixo *Sophia:*, captura do
   * key.id retornado pela Evolution pra evitar duplicatas no banco).
   */
  private async sendGeneratedFollowup(lead: any, convo: any, generatedMessage: string) {
    const { apiUrl, apiKey } = await this.settings.getEvolutionConfig();
    if (!apiUrl) return;
    const instanceName = convo.instance_name || process.env.EVOLUTION_INSTANCE_NAME || '';

    const textToSend = `*Sophia:* ${generatedMessage}`;
    const sendResult = await axios.post(
      `${apiUrl}/message/sendText/${instanceName}`,
      { number: lead.phone, text: textToSend },
      { headers: { 'Content-Type': 'application/json', apikey: apiKey }, timeout: 15000 },
    );

    const evoMsgId =
      sendResult?.data?.key?.id ||
      `out_followup_ia_${Date.now()}`;

    await this.prisma.message.create({
      data: {
        conversation_id: convo.id,
        direction: 'out',
        type: 'text',
        text: generatedMessage,
        external_message_id: evoMsgId,
        status: 'enviado',
      },
    });
    await Promise.all([
      this.prisma.conversation.update({
        where: { id: convo.id },
        data: { last_message_at: new Date() },
      }),
      this.prisma.lead.update({
        where: { id: lead.id },
        data: { last_followup_at: new Date() },
      }),
    ]);
  }
}
