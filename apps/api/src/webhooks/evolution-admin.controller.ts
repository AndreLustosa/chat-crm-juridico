import { Controller, Post, Param, Query, Logger, BadRequestException } from '@nestjs/common';
import { EvolutionService } from './evolution.service';

/**
 * Endpoint administrativo para disparar manualmente o resync de mensagens
 * de uma instância do WhatsApp.
 *
 * Use quando:
 *  - O CRM caiu e mensagens chegaram durante a queda
 *  - Você suspeita que webhooks da Evolution API falharam silenciosamente
 *  - Precisa recuperar um histórico maior que a janela padrão do cron (2h)
 *
 * Protegido pelo JwtAuthGuard global — requer token de usuário logado.
 */
@Controller('whatsapp/instances')
export class EvolutionAdminController {
  private readonly logger = new Logger(EvolutionAdminController.name);

  constructor(private readonly evolutionService: EvolutionService) {}

  /**
   * POST /whatsapp/instances/:name/resync?hours=168
   *
   * Query params:
   *  - hours: janela de tempo a recuperar (1–720, default 168 = 7 dias)
   */
  @Post(':name/resync')
  async resync(
    @Param('name') name: string,
    @Query('hours') hours?: string,
  ): Promise<{
    scheduled: true;
    instance: string;
    cutoffHours: number;
    newConvsCreated: number;
    conversationsResynced: number;
    message: string;
  }> {
    const parsed = hours ? parseInt(hours, 10) : 168;
    if (Number.isNaN(parsed) || parsed < 1 || parsed > 720) {
      throw new BadRequestException('hours deve ser um inteiro entre 1 e 720');
    }

    this.logger.log(`[MANUAL RESYNC] Instância=${name}, janela=${parsed}h`);

    const result = await this.evolutionService.scheduleResyncAfterReconnect(name, {
      cutoffHours: parsed,
      stabilizeDelayMs: 0, // manual → roda imediato
      triggerReason: 'manual',
    });

    return {
      scheduled: true,
      instance: name,
      cutoffHours: parsed,
      newConvsCreated: result.newConvsCreated,
      conversationsResynced: result.conversationsResynced,
      message:
        `Resync manual agendado para instância "${name}" (últimas ${parsed}h). ` +
        `${result.newConvsCreated} conversa(s) nova(s) criada(s) a partir de chats recentes. ` +
        `${result.conversationsResynced} conversa(s) ativa(s) enfileirada(s) para importação de mensagens.`,
    };
  }
}
