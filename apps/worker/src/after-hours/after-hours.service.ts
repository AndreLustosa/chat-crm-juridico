import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/**
 * AfterHoursService
 * ─────────────────
 * Liga a IA fora do expediente APENAS em conversas de CLIENTES
 * (lead.is_client=true) — eles usam a skill "Acompanhamento de Cliente" e
 * esperam atendimento humano durante o dia. Leads (is_client=false) são
 * atendidos 24/7 pela IA com skills de triagem normais, então o cron NÃO
 * mexe neles.
 *
 * Diferencia conversas que foram ativadas MANUALMENTE pelo operador —
 * essas NUNCA são mexidas pelo cron. Só as ativadas pelo próprio cron
 * (ai_mode_source = 'CRON_AFTER_HOURS') voltam ao estado anterior quando
 * abre o expediente.
 *
 * Configurações lidas de GlobalSetting (com fallback para defaults):
 *  - AFTER_HOURS_AI_ENABLED   (default: "true")
 *  - AFTER_HOURS_START        (default: "17:00") — quando IA noturna liga
 *  - AFTER_HOURS_END          (default: "08:00") — quando IA noturna desliga
 *  - BUSINESS_DAYS            (default: "1,2,3,4,5") — seg=1 ... dom=0
 *  - TIMEZONE                 (default: "America/Maceio")
 */
@Injectable()
export class AfterHoursService {
  private readonly logger = new Logger(AfterHoursService.name);

  constructor(private prisma: PrismaService) {}

  /** Roda a cada 5 minutos no timezone de Maceió (fallback interno faz nova leitura do tz). */
  @Cron('*/5 * * * *', { timeZone: 'America/Maceio' })
  async tick() {
    let settings;
    try {
      settings = await this.loadSettings();
    } catch (e: any) {
      this.logger.error(`[AfterHours] Falha ao carregar settings: ${e.message}`);
      return;
    }

    if (!settings.enabled) {
      this.logger.debug('[AfterHours] AFTER_HOURS_AI_ENABLED=false — pulando tick');
      return;
    }

    const now = this.nowInTimezone(settings.timezone);
    const isBusinessHour = this.isBusinessHour(now, settings);

    this.logger.debug(
      `[AfterHours] now=${now.toISOString()} businessHour=${isBusinessHour} tz=${settings.timezone}`,
    );

    if (isBusinessHour) {
      await this.restoreBusinessHours();
    } else {
      await this.activateAfterHours();
    }
  }

  // ─── Core logic ────────────────────────────────────────────────────

  private async activateAfterHours(): Promise<void> {
    // Só age em conversas de CLIENTES (lead.is_client=true).
    // Leads são atendidos 24/7 pela IA com skills de triagem — o cron não toca.
    // Também só mexe em conversas que NÃO estão em modo MANUAL.
    //
    // Lógica 3-valores do SQL: `ai_mode_source <> 'MANUAL'` retorna NULL quando
    // a coluna é NULL, o que é tratado como false no WHERE — excluindo conversas
    // novas. Precisamos cobrir NULL explicitamente.
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
    // Volta IA para desligada APENAS em conversas que foram ligadas pelo cron.
    // Conversas com ai_mode_source='MANUAL' (operador ativou dentro do expediente) são preservadas.
    // Leads nem precisam ser filtrados aqui porque o ativateAfterHours nunca ligou neles.
    const result = await this.prisma.conversation.updateMany({
      where: {
        ai_mode: true,
        ai_mode_source: 'CRON_AFTER_HOURS',
      },
      data: {
        ai_mode: false,
        ai_mode_source: null,
        ai_mode_disabled_at: new Date(),
      },
    });

    if (result.count > 0) {
      this.logger.log(`[AfterHours] ☀️  Modo diurno restaurado: ${result.count} conversa(s) com IA desligada`);
    }
  }

  // ─── Settings & time helpers ───────────────────────────────────────

  private async loadSettings(): Promise<{
    enabled: boolean;
    start: { h: number; m: number }; // ex: 17:00
    end: { h: number; m: number };   // ex: 08:00
    businessDays: Set<number>;       // ex: {1,2,3,4,5}
    timezone: string;
  }> {
    const rows = await this.prisma.globalSetting.findMany({
      where: {
        key: {
          in: [
            'AFTER_HOURS_AI_ENABLED',
            'AFTER_HOURS_START',
            'AFTER_HOURS_END',
            'BUSINESS_DAYS',
            'TIMEZONE',
          ],
        },
      },
    });

    const map = new Map(rows.map((r) => [r.key, r.value]));

    const enabled = (map.get('AFTER_HOURS_AI_ENABLED') ?? 'true').toLowerCase() !== 'false';
    const start = this.parseHHMM(map.get('AFTER_HOURS_START') ?? '17:00');
    const end = this.parseHHMM(map.get('AFTER_HOURS_END') ?? '08:00');
    const businessDays = this.parseBusinessDays(map.get('BUSINESS_DAYS') ?? '1,2,3,4,5');
    const timezone = map.get('TIMEZONE') || 'America/Maceio';

    return { enabled, start, end, businessDays, timezone };
  }

  private parseHHMM(value: string): { h: number; m: number } {
    const parts = value.split(':');
    const h = Number.parseInt(parts[0] ?? '0', 10);
    const m = Number.parseInt(parts[1] ?? '0', 10);
    return {
      h: Number.isFinite(h) && h >= 0 && h < 24 ? h : 0,
      m: Number.isFinite(m) && m >= 0 && m < 60 ? m : 0,
    };
  }

  private parseBusinessDays(value: string): Set<number> {
    const days = value
      .split(',')
      .map((v) => Number.parseInt(v.trim(), 10))
      .filter((n) => Number.isFinite(n) && n >= 0 && n <= 6);
    return new Set(days.length > 0 ? days : [1, 2, 3, 4, 5]);
  }

  /**
   * Retorna um Date cujos getUTCHours()/getUTCMinutes() correspondem à hora
   * LOCAL no timezone informado. A data em si não é um instante fiel — ela
   * serve apenas para extrair hora/minuto/dia da semana.
   */
  private nowInTimezone(timezone: string): Date {
    const iso = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(new Date());

    const parts: Record<string, string> = {};
    for (const p of iso) {
      if (p.type !== 'literal') parts[p.type] = p.value;
    }
    // Build "YYYY-MM-DDTHH:mm:ssZ" (trata como UTC para extração subsequente)
    const hourStr = parts.hour === '24' ? '00' : parts.hour;
    return new Date(
      `${parts.year}-${parts.month}-${parts.day}T${hourStr}:${parts.minute}:${parts.second}Z`,
    );
  }

  /** Dentro do expediente? true = operadores atuam, IA deve estar desligada. */
  private isBusinessHour(
    now: Date,
    settings: { start: { h: number; m: number }; end: { h: number; m: number }; businessDays: Set<number> },
  ): boolean {
    const dow = now.getUTCDay();
    if (!settings.businessDays.has(dow)) return false;

    const minutesNow = now.getUTCHours() * 60 + now.getUTCMinutes();
    // expediente = [END ... START). Ex: [08:00 ... 17:00)
    const startMinutes = settings.end.h * 60 + settings.end.m;       // 08:00
    const endMinutes = settings.start.h * 60 + settings.start.m;     // 17:00
    return minutesNow >= startMinutes && minutesNow < endMinutes;
  }
}
