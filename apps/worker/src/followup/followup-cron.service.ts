import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import axios from 'axios';

interface StaleConfig {
  stage: string;
  days: number;
  msg: string;
}

@Injectable()
export class FollowupCronService {
  private readonly logger = new Logger(FollowupCronService.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {}

  /**
   * Verifica leads parados em etapas específicas do CRM há mais de N dias.
   * Envia follow-up via WhatsApp (Seg-Sex, 9h horário de Maceió).
   */
  @Cron('0 9 * * 1-5', { timeZone: 'America/Maceio' })
  async checkStaleLeads() {
    this.logger.log('[FOLLOWUP] Iniciando verificação de leads parados...');

    const staleConfigs: StaleConfig[] = [
      {
        stage: 'AGUARDANDO_DOCS',
        days: 3,
        msg: 'Olá {{name}}, tudo bem? Estamos aguardando os documentos para dar continuidade ao seu caso. Precisa de ajuda com isso?',
      },
      {
        stage: 'AGUARDANDO_PROC',
        days: 3,
        msg: 'Olá {{name}}, a procuração ainda não foi assinada. Precisa de alguma orientação para finalizar?',
      },
      {
        stage: 'AGUARDANDO_FORM',
        days: 2,
        msg: 'Olá {{name}}, você ainda não concluiu o formulário. Precisa de ajuda para preencher?',
      },
      {
        stage: 'QUALIFICANDO',
        days: 5,
        msg: 'Olá {{name}}, estamos à disposição para continuar o atendimento do seu caso. Podemos prosseguir?',
      },
    ];

    let totalSent = 0;

    for (const config of staleConfigs) {
      try {
        const cutoff = new Date(Date.now() - config.days * 24 * 60 * 60 * 1000);

        const leads = await this.prisma.lead.findMany({
          where: {
            stage: config.stage,
            updated_at: { lt: cutoff },
            // Anti-spam: não enviar se já fez follow-up nos últimos N dias
            OR: [
              { last_followup_at: null },
              { last_followup_at: { lt: cutoff } },
            ],
          },
          include: {
            conversations: {
              where: { status: 'ABERTO' },
              take: 1,
              orderBy: { last_message_at: 'desc' },
            },
          },
        });

        for (const lead of leads) {
          // Pular se não tem conversa aberta
          if (!lead.conversations?.length) continue;

          const convo = lead.conversations[0];

          // Anti-spam: não enviar se a conversa teve atividade nas últimas 24h
          if (convo.last_message_at) {
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            if (convo.last_message_at > oneDayAgo) continue;
          }

          try {
            await this.sendFollowup(lead, convo, config.msg);
            totalSent++;
          } catch (e: any) {
            this.logger.error(
              `[FOLLOWUP] Falha ao enviar para ${lead.phone}: ${e.message}`,
            );
          }
        }
      } catch (e: any) {
        this.logger.error(
          `[FOLLOWUP] Erro ao processar stage ${config.stage}: ${e.message}`,
        );
      }
    }

    this.logger.log(`[FOLLOWUP] Verificação concluída. ${totalSent} follow-up(s) enviado(s).`);
  }

  private async sendFollowup(lead: any, convo: any, template: string) {
    const { apiUrl, apiKey } = await this.settings.getEvolutionConfig();
    if (!apiUrl) {
      this.logger.warn('[FOLLOWUP] EVOLUTION_API_URL não configurada — ignorando');
      return;
    }

    const instanceName =
      convo.instance_name || process.env.EVOLUTION_INSTANCE_NAME || '';
    const msg = template.replace(/\{\{name\}\}/g, lead.name || 'cliente');

    // Enviar via WhatsApp
    await axios.post(
      `${apiUrl}/message/sendText/${instanceName}`,
      {
        number: lead.phone,
        text: `*Sophia:* ${msg}`,
      },
      {
        headers: { 'Content-Type': 'application/json', apikey: apiKey },
        timeout: 15000,
      },
    );

    // Salvar mensagem no banco
    await this.prisma.message.create({
      data: {
        conversation_id: convo.id,
        direction: 'out',
        type: 'text',
        text: msg,
        external_message_id: `sys_followup_${Date.now()}`,
        status: 'enviado',
      },
    });

    // Atualizar last_message_at da conversa e last_followup_at do lead
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

    this.logger.log(
      `[FOLLOWUP] Enviado para ${lead.phone} (${lead.name || '?'}) — stage: ${lead.stage}`,
    );
  }
}
