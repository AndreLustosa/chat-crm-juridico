import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Reativa automaticamente o ai_mode em conversas onde a IA ficou desligada
 * por mais de 24 horas sem resposta do operador.
 *
 * Critérios para reativação:
 * - ai_mode = false (IA desligada)
 * - ai_mode_disabled_at < 24h atrás
 * - Última mensagem é do cliente (operador não respondeu)
 * - Conversa não está FECHADO ou ADIADO
 *
 * Roda a cada hora, todos os dias.
 */
@Injectable()
export class AiReactivationCronService {
  private readonly logger = new Logger(AiReactivationCronService.name);

  constructor(private prisma: PrismaService) {}

  @Cron('17 * * * *', { timeZone: 'America/Maceio' }) // Minuto 17 de cada hora (evita :00)
  async reactivateStaleConversations() {
    this.logger.log('[AI-REACTIVATION] Verificando conversas com IA desligada há 24h+...');

    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // Busca conversas candidatas: ai_mode desligado há 24h+ em conversas abertas
      const candidates = await this.prisma.conversation.findMany({
        where: {
          ai_mode: false,
          ai_mode_disabled_at: { lt: twentyFourHoursAgo },
          status: { notIn: ['FECHADO'] },
          // Apenas conversas com lead ativo (não PERDIDO/FINALIZADO)
          lead: { stage: { notIn: ['PERDIDO', 'FINALIZADO'] } },
        },
        select: {
          id: true,
          assigned_user_id: true,
          lead: { select: { id: true, name: true } },
          messages: {
            orderBy: { created_at: 'desc' },
            take: 1,
            select: { direction: true },
          },
        },
      });

      let reactivatedCount = 0;

      for (const conv of candidates) {
        // Só reativa se a última mensagem for do cliente (operador não respondeu)
        const lastMsg = conv.messages[0];
        if (!lastMsg || lastMsg.direction !== 'in') continue;

        await this.prisma.conversation.update({
          where: { id: conv.id },
          data: {
            ai_mode: true,
            ai_mode_disabled_at: null,
          },
        });

        reactivatedCount++;
        this.logger.log(
          `[AI-REACTIVATION] IA reativada na conversa ${conv.id} (lead: ${conv.lead?.name || conv.lead?.id}) — operador ${conv.assigned_user_id || 'N/A'} não respondeu em 24h`,
        );
      }

      if (reactivatedCount > 0) {
        this.logger.log(`[AI-REACTIVATION] ✅ ${reactivatedCount} conversa(s) reativada(s) de ${candidates.length} candidata(s)`);
      } else {
        this.logger.log(`[AI-REACTIVATION] Nenhuma conversa para reativar (${candidates.length} candidata(s) verificadas)`);
      }
    } catch (e: any) {
      this.logger.error(`[AI-REACTIVATION] Erro ao verificar conversas: ${e.message}`);
    }
  }
}
