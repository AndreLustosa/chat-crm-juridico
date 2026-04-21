import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import axios from 'axios';

interface StaleConfig {
  stage: string; days: number; msg: string;
}

@Injectable()
export class FollowupCronService {
  private readonly logger = new Logger(FollowupCronService.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
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
   * Palavras-chave que indicam que o lead NAO tem interesse — usado para pular
   * followup automatico e sinalizar que o lead deve ser arquivado.
   */
  private static readonly DEAD_LEAD_KEYWORDS = [
    'não quero', 'nao quero',
    'sem interesse', 'não tenho interesse', 'nao tenho interesse',
    'desisti', 'ja contratei outro', 'já contratei outro',
    'ja resolvi', 'já resolvi',
    'não precisa mais', 'nao precisa mais',
    'pare de me mandar', 'me deixa em paz',
    'não me incomode', 'nao me incomode',
  ];

  private async legacyStageFollowup() {
    const staleConfigs: StaleConfig[] = [
      { stage: 'AGUARDANDO_DOCS', days: 3, msg: 'Olá {{name}}, tudo bem? Estamos aguardando os documentos para dar continuidade ao seu caso. Precisa de ajuda com isso?' },
      { stage: 'AGUARDANDO_PROC', days: 3, msg: 'Olá {{name}}, a procuração ainda não foi assinada. Precisa de alguma orientação para finalizar?' },
      { stage: 'AGUARDANDO_FORM', days: 2, msg: 'Olá {{name}}, você ainda não concluiu o formulário. Precisa de ajuda para preencher?' },
      { stage: 'QUALIFICANDO', days: 5, msg: 'Olá {{name}}, estamos à disposição para continuar o atendimento do seu caso. Podemos prosseguir?' },
    ];

    let totalSent = 0;
    let totalSkipped = 0;
    for (const config of staleConfigs) {
      try {
        const cutoff = new Date(Date.now() - config.days * 24 * 60 * 60 * 1000);
        const leads: any[] = await (this.prisma as any).lead.findMany({
          where: {
            stage: config.stage,
            updated_at: { lt: cutoff },
            // Atualizado em 2026-04-21: SO envia pra LEADS (nao clientes).
            // Clientes (is_client=true) nao devem receber followup comercial
            // — se precisar reenviar mensagem pra cliente, eh caso de
            // atendimento ativo, nao spam automatico.
            is_client: false,
            // Outras condicoes
            followup_enrollments: { none: { status: 'ATIVO' } },
          },
          include: {
            conversations: {
              where: { status: 'ABERTO' },
              take: 1,
              orderBy: { last_message_at: 'desc' },
              include: {
                // Pegar ultimas 5 mensagens pra analise de contexto
                messages: {
                  orderBy: { created_at: 'desc' },
                  take: 5,
                  select: { direction: true, text: true, created_at: true },
                },
              },
            },
          },
        });

        for (const lead of leads) {
          if (!lead.conversations?.length) continue;
          const convo = lead.conversations[0];

          // Anti-spam: nao reenvia se ultima interacao foi < 24h atras
          if (convo.last_message_at) {
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            if (convo.last_message_at > oneDayAgo) {
              totalSkipped++;
              continue;
            }
          }

          // Analise de contexto: detectar "lead morreu" pelas ultimas mensagens
          const inboundTexts = (convo.messages || [])
            .filter((m: any) => m.direction === 'in' && m.text)
            .map((m: any) => m.text.toLowerCase());

          const deadLeadDetected = inboundTexts.some((text: string) =>
            FollowupCronService.DEAD_LEAD_KEYWORDS.some((kw) => text.includes(kw)),
          );

          if (deadLeadDetected) {
            // Arquivar automaticamente + sair
            await this.prisma.lead.update({
              where: { id: lead.id },
              data: {
                stage: 'PERDIDO',
                loss_reason: 'Lead sinalizou desinteresse (arquivado automaticamente pelo followup)',
                last_followup_at: new Date(), // evita ficar voltando
              },
            });
            this.logger.log(
              `[FOLLOWUP-LEGACY] Lead ${lead.phone} arquivado (sinal de desinteresse detectado)`,
            );
            totalSkipped++;
            continue;
          }

          // Redundancia contextual: se IA ja fez followup recente (qualquer
          // mensagem out nas ultimas 48h), pula — evita insistencia.
          const outRecent = (convo.messages || []).some(
            (m: any) =>
              m.direction === 'out' &&
              m.created_at > new Date(Date.now() - 48 * 60 * 60 * 1000),
          );
          if (outRecent) {
            totalSkipped++;
            continue;
          }

          try {
            await this.sendLegacyFollowup(lead, convo, config.msg);
            totalSent++;
          } catch (err: any) {
            this.logger.warn(`[FOLLOWUP-LEGACY] Falha em ${lead.phone}: ${err.message}`);
          }
        }
      } catch (e: any) {
        this.logger.error(`[FOLLOWUP-LEGACY] Erro stage ${config.stage}: ${e.message}`);
      }
    }
    if (totalSent > 0 || totalSkipped > 0) {
      this.logger.log(
        `[FOLLOWUP-LEGACY] ${totalSent} enviado(s), ${totalSkipped} pulado(s) (anti-spam/dead-lead/contexto)`,
      );
    }
  }

  private async sendLegacyFollowup(lead: any, convo: any, template: string) {
    const { apiUrl, apiKey } = await this.settings.getEvolutionConfig();
    if (!apiUrl) return;
    const instanceName = convo.instance_name || process.env.EVOLUTION_INSTANCE_NAME || '';
    const msg = template.replace(/\{\{name\}\}/g, lead.name || 'cliente');

    // Enviar via Evolution API COM prefixo "Sophia:" (mesmo padrao do AI processor).
    // IMPORTANTE: capturar o key.id retornado pela Evolution pra usar como
    // external_message_id ao salvar. Sem isso, o webhook do Evolution recebe
    // o eco da mensagem enviada e cria uma DUPLICATA no banco (o filtro de
    // dedup do webhook so atualiza mensagens com prefixo "out_" — que e o
    // que usaremos agora).
    const textToSend = `*Sophia:* ${msg}`;
    const sendResult = await axios.post(
      `${apiUrl}/message/sendText/${instanceName}`,
      { number: lead.phone, text: textToSend },
      { headers: { 'Content-Type': 'application/json', apikey: apiKey }, timeout: 15000 },
    );

    // Usa o ID real do WhatsApp se disponivel. Senao, placeholder 'out_followup_legacy_*'
    // que pode ser atualizado pelo webhook posteriormente via filtro startsWith('out_').
    const evoMsgId =
      sendResult?.data?.key?.id ||
      `out_followup_legacy_${Date.now()}`;

    await this.prisma.message.create({
      data: {
        conversation_id: convo.id,
        direction: 'out',
        type: 'text',
        text: msg,
        external_message_id: evoMsgId,
        status: 'enviado',
      },
    });
    await Promise.all([
      this.prisma.conversation.update({ where: { id: convo.id }, data: { last_message_at: new Date() } }),
      this.prisma.lead.update({ where: { id: lead.id }, data: { last_followup_at: new Date() } }),
    ]);
    this.logger.log(`[FOLLOWUP-LEGACY] Enviado para ${lead.phone} (msgId=${evoMsgId.slice(0, 20)}...)`);
  }
}
