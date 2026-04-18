import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import {
  computeBusinessHoursStatus,
  loadBusinessHoursSettings,
} from '../ai/business-hours.util';

/**
 * AfterHoursService
 * ─────────────────
 * Liga a IA fora do expediente APENAS em conversas de CLIENTES
 * (lead.is_client=true) — eles usam a skill "Acompanhamento de Cliente" e
 * esperam atendimento humano durante o dia. Leads (is_client=false) são
 * atendidos 24/7 pela IA com skills de triagem normais, então o cron NÃO
 * mexe neles.
 *
 * COMPORTAMENTO DA TRANSIÇÃO:
 *  - Fora do expediente → liga IA (`ai_mode=true, source='CRON_AFTER_HOURS'`).
 *  - Entrada no expediente → NÃO desliga a IA. Apenas limpa
 *    `ai_mode_source=NULL`. IA permanece ligada até o operador desligar
 *    manualmente. O prompt da IA usa {{business_hours_info}} (calculado no
 *    processor) para decidir se menciona o horário ao cliente.
 *
 * Conversas em modo MANUAL nunca são mexidas pelo cron.
 *
 * A lógica de horário, feriado e timezone vive em `ai/business-hours.util.ts`
 * e é compartilhada com o ai.processor.
 */
@Injectable()
export class AfterHoursService {
  private readonly logger = new Logger(AfterHoursService.name);

  constructor(private prisma: PrismaService) {}

  /** Roda a cada 5 minutos no timezone de Maceió. */
  @Cron('*/5 * * * *', { timeZone: 'America/Maceio' })
  async tick() {
    let enabled: boolean;
    try {
      enabled = await this.isEnabled();
    } catch (e: any) {
      this.logger.error(`[AfterHours] Falha ao carregar settings: ${e.message}`);
      return;
    }
    if (!enabled) {
      this.logger.debug('[AfterHours] AFTER_HOURS_AI_ENABLED=false — pulando tick');
      return;
    }

    const status = await computeBusinessHoursStatus(this.prisma);
    this.logger.debug(
      `[AfterHours] ${status.currentDayName} ${status.currentTime} businessHour=${status.isBusinessHour} holiday=${status.isHoliday}`,
    );

    if (status.isBusinessHour) {
      await this.restoreBusinessHours();
    } else {
      await this.activateAfterHours();
    }
  }

  // ─── Flag global ON/OFF ────────────────────────────────────────────

  private async isEnabled(): Promise<boolean> {
    const row = await this.prisma.globalSetting.findUnique({
      where: { key: 'AFTER_HOURS_AI_ENABLED' },
    });
    return (row?.value ?? 'true').toLowerCase() !== 'false';
  }

  // ─── Núcleo ────────────────────────────────────────────────────────

  private async activateAfterHours(): Promise<void> {
    // Só age em conversas de CLIENTES (lead.is_client=true).
    // Lógica 3-valores do SQL: `ai_mode_source <> 'MANUAL'` retorna NULL
    // quando a coluna é NULL — cobrimos NULL explicitamente no OR.
    const result = await this.prisma.conversation.updateMany({
      where: {
        status: { notIn: ['FECHADO', 'ENCERRADO'] },
        ai_mode: false,
        lead: { is_client: true },
        OR: [
          { ai_mode_source: null },
          { ai_mode_source: { not: 'MANUAL' } },
        ],
      },
      data: {
        ai_mode: true,
        ai_mode_source: 'CRON_AFTER_HOURS',
        ai_mode_disabled_at: null,
      },
    });

    if (result.count > 0) {
      this.logger.log(`[AfterHours] 🌙 Modo noturno ativado: ${result.count} conversa(s) de cliente com IA ligada`);
    }
  }

  private async restoreBusinessHours(): Promise<void> {
    // Entrada no expediente: IA continua ligada; apenas limpa a origem
    // CRON_AFTER_HOURS. Operador desliga manualmente se quiser assumir.
    const result = await this.prisma.conversation.updateMany({
      where: {
        ai_mode: true,
        ai_mode_source: 'CRON_AFTER_HOURS',
      },
      data: {
        ai_mode_source: null,
      },
    });

    if (result.count > 0) {
      this.logger.log(
        `[AfterHours] ☀️  Transição diurna: ${result.count} conversa(s) de cliente mantêm IA ligada (origem CRON limpa)`,
      );
    }
  }

  // ─── Exposto só para smoke test ────────────────────────────────────
  async loadSettings() {
    return loadBusinessHoursSettings(this.prisma);
  }
}
