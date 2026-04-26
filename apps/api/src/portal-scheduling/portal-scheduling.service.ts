import { Injectable, BadRequestException, Logger, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarService } from '../calendar/calendar.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { normalizeBrazilianPhone } from '../common/utils/phone';

/**
 * Agendamento de consulta pelo portal do cliente.
 *
 * 3 modalidades (André, 2026-04-26):
 *   - LIGACAO: 15 min — atendimento por telefone
 *   - VIDEO: 30 min — videochamada
 *   - PRESENCIAL: 30 min — escritorio (Arapiraca - AL)
 *
 * Politica:
 *   - Antecedencia minima: 24h
 *   - Antecedencia maxima: 6 semanas
 *   - Horario: 08h-12h e 13h-18h (almoco bloqueado)
 *   - Dias: seg-sex
 *   - Conflito: qualquer evento ativo do advogado (audiencia, pericia,
 *     prazo, outras consultas) bloqueia o slot. Audiencia tem prioridade
 *     absoluta — nunca permitir consulta no horario de audiencia marcada.
 */

export type ConsultationModality = 'LIGACAO' | 'VIDEO' | 'PRESENCIAL';

const MODALITY_CONFIG: Record<ConsultationModality, {
  label: string;
  durationMinutes: number;
  emoji: string;
  buildLocation: (clientPhone: string) => string;
}> = {
  LIGACAO: {
    label: 'Ligação telefônica',
    durationMinutes: 15,
    emoji: '📞',
    buildLocation: (phone) => `📞 Ligação telefônica para ${phone}`,
  },
  VIDEO: {
    label: 'Videochamada',
    durationMinutes: 30,
    emoji: '💻',
    buildLocation: () => '💻 Videochamada (link enviado pelo advogado antes da reunião)',
  },
  PRESENCIAL: {
    label: 'Atendimento presencial',
    durationMinutes: 30,
    emoji: '📍',
    buildLocation: () => '📍 Escritório — Rua Francisco Rodrigues Viana, 244, Baixa Grande, Arapiraca - AL',
  },
};

@Injectable()
export class PortalSchedulingService {
  private readonly logger = new Logger(PortalSchedulingService.name);

  // Janela comercial Maceio
  private readonly MORNING_START_HOUR = 8;
  private readonly MORNING_END_HOUR = 12;
  private readonly AFTERNOON_START_HOUR = 13;
  private readonly AFTERNOON_END_HOUR = 18;
  private readonly MIN_ADVANCE_HOURS = 24;
  private readonly MAX_ADVANCE_DAYS = 42;

  constructor(
    private prisma: PrismaService,
    private calendar: CalendarService,
    private whatsapp: WhatsappService,
  ) {}

  /**
   * Resolve qual advogado eh responsavel pelo cliente.
   * Prioridade:
   *   1. lawyer_id do legal_case ativo mais recente do lead
   *   2. cs_user_id (operador que fechou a venda)
   *   3. fallback: primeiro User com role ADVOGADO no tenant
   */
  private async resolveLawyerForLead(leadId: string): Promise<{ id: string; name: string | null; phone: string | null } | null> {
    // 1. Advogado do legal_case ativo
    const activeCase = await this.prisma.legalCase.findFirst({
      where: { lead_id: leadId, archived: false, renounced: false, in_tracking: true },
      orderBy: { stage_changed_at: 'desc' },
      select: {
        lawyer: { select: { id: true, name: true, phone: true } },
      },
    });
    if (activeCase?.lawyer) return activeCase.lawyer;

    // 2. cs_user (CSManager) do lead
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        tenant_id: true,
        cs_user: { select: { id: true, name: true, phone: true } },
      },
    });
    if (lead?.cs_user) return lead.cs_user;

    // 3. Fallback: primeiro advogado do tenant
    const fallback = await this.prisma.user.findFirst({
      where: {
        tenant_id: lead?.tenant_id || undefined,
        roles: { hasSome: ['ADVOGADO', 'Advogados', 'ADMIN'] },
      },
      orderBy: { created_at: 'asc' },
      select: { id: true, name: true, phone: true },
    });
    return fallback;
  }

  /**
   * Lista slots livres dos proximos N dias. Duracao do slot depende da
   * modalidade: LIGACAO 15min, VIDEO/PRESENCIAL 30min.
   *
   * Bloqueios cobrem TODOS os eventos ativos do advogado:
   *   - AUDIENCIA, PERICIA, PRAZO (atos processuais — prioridade absoluta)
   *   - CONSULTA (outros agendamentos)
   *   - TAREFA (interno do advogado)
   * Status CANCELADO/CONCLUIDO ignorados (slot livre de novo).
   */
  async listAvailability(
    leadId: string,
    modality: ConsultationModality,
    fromIso?: string,
    toIso?: string,
  ): Promise<{
    lawyer: { name: string | null };
    modality: { value: ConsultationModality; label: string; duration_minutes: number; emoji: string };
    slots: Array<{ start: string; end: string }>;
  }> {
    const cfg = MODALITY_CONFIG[modality];
    if (!cfg) {
      throw new BadRequestException('Modalidade invalida. Use LIGACAO, VIDEO ou PRESENCIAL.');
    }

    const lawyer = await this.resolveLawyerForLead(leadId);
    if (!lawyer) {
      throw new BadRequestException(
        'Não foi possível identificar seu advogado responsável. Entre em contato pelo WhatsApp.',
      );
    }

    // Janela default: agora+24h ate +42d
    const now = new Date();
    const minAdvance = new Date(now.getTime() + this.MIN_ADVANCE_HOURS * 60 * 60 * 1000);
    const maxAdvance = new Date(now.getTime() + this.MAX_ADVANCE_DAYS * 24 * 60 * 60 * 1000);

    let from = fromIso ? new Date(fromIso) : minAdvance;
    let to = toIso ? new Date(toIso) : maxAdvance;
    if (from < minAdvance) from = minAdvance;
    if (to > maxAdvance) to = maxAdvance;

    // Eventos ja marcados do advogado na janela. Inclui TODOS os tipos —
    // audiencia tem prioridade absoluta sobre consulta (regra André 2026-04-26).
    const busy = await this.prisma.calendarEvent.findMany({
      where: {
        assigned_user_id: lawyer.id,
        status: { notIn: ['CANCELADO', 'CONCLUIDO'] },
        // Janela ampliada um pouco pra capturar eventos que comecam antes
        // mas terminam dentro do range
        start_at: { gte: new Date(from.getTime() - 4 * 60 * 60 * 1000), lte: to },
      },
      select: { start_at: true, end_at: true, type: true },
    });

    // Indexa eventos por dia pra lookup rapido
    const busyMap = new Map<string, Array<{ start: number; end: number; type: string }>>();
    for (const ev of busy) {
      const dayKey = ev.start_at.toISOString().slice(0, 10);
      const arr = busyMap.get(dayKey) || [];
      // Audiencia/pericia: bloqueia 1h se end_at vazio (atos processuais
      // tipicamente duram 1h+); outros tipos: 30min como default.
      const defaultDuration = (ev.type === 'AUDIENCIA' || ev.type === 'PERICIA')
        ? 60 * 60 * 1000
        : 30 * 60 * 1000;
      arr.push({
        start: ev.start_at.getTime(),
        end: ev.end_at?.getTime() || ev.start_at.getTime() + defaultDuration,
        type: ev.type,
      });
      busyMap.set(dayKey, arr);
    }

    // Gera slots na duracao da modalidade
    const slots: Array<{ start: string; end: string }> = [];
    const slotMs = cfg.durationMinutes * 60 * 1000;
    const cursor = new Date(Date.UTC(
      from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 0, 0, 0, 0,
    ));
    const endLoop = new Date(Date.UTC(
      to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate(), 23, 59, 59, 0,
    ));

    while (cursor <= endLoop) {
      const dow = cursor.getUTCDay();
      if (dow === 0 || dow === 6) {
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        continue;
      }

      const dayKey = cursor.toISOString().slice(0, 10);
      const dayBusy = busyMap.get(dayKey) || [];

      // Gera slots de N min em cada bloco horario (manha + tarde),
      // pulando se o slot completo nao cabe ate o fim do bloco.
      this.generateSlotsInBlock(
        cursor,
        this.MORNING_START_HOUR, this.MORNING_END_HOUR,
        slotMs, from, dayBusy, slots,
      );
      this.generateSlotsInBlock(
        cursor,
        this.AFTERNOON_START_HOUR, this.AFTERNOON_END_HOUR,
        slotMs, from, dayBusy, slots,
      );

      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return {
      lawyer: { name: lawyer.name },
      modality: {
        value: modality,
        label: cfg.label,
        duration_minutes: cfg.durationMinutes,
        emoji: cfg.emoji,
      },
      slots,
    };
  }

  private generateSlotsInBlock(
    day: Date,
    blockStartHour: number,
    blockEndHour: number,
    slotMs: number,
    minStart: Date,
    busy: Array<{ start: number; end: number; type: string }>,
    out: Array<{ start: string; end: string }>,
  ) {
    const blockStart = Date.UTC(
      day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(),
      blockStartHour, 0, 0, 0,
    );
    const blockEnd = Date.UTC(
      day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(),
      blockEndHour, 0, 0, 0,
    );

    let slotStart = blockStart;
    while (slotStart + slotMs <= blockEnd) {
      const slotEnd = slotStart + slotMs;
      if (new Date(slotStart) >= minStart && !this.slotConflictsMs(slotStart, slotEnd, busy)) {
        out.push({
          start: new Date(slotStart).toISOString(),
          end: new Date(slotEnd).toISOString(),
        });
      }
      slotStart += slotMs;
    }
  }

  private slotConflictsMs(start: number, end: number, busy: Array<{ start: number; end: number }>): boolean {
    return busy.some(b => start < b.end && end > b.start);
  }

  /**
   * Cria a consulta. Reusa CalendarService.create — guardrail de duplicata
   * (12h) ja eh aplicado la, entao se cliente clicar 2x rapido vira 409.
   */
  async createAppointment(
    leadId: string,
    data: { start_at: string; modality: ConsultationModality; reason: string; notes?: string },
  ) {
    const cfg = MODALITY_CONFIG[data.modality];
    if (!cfg) {
      throw new BadRequestException('Modalidade invalida. Use LIGACAO, VIDEO ou PRESENCIAL.');
    }

    const reason = (data.reason || '').trim().slice(0, 500);
    if (!reason) {
      throw new BadRequestException('Informe o motivo da consulta.');
    }
    const startAt = new Date(data.start_at);
    if (isNaN(startAt.getTime())) {
      throw new BadRequestException('Data invalida.');
    }

    // Valida janela
    const now = Date.now();
    const minAdvanceMs = this.MIN_ADVANCE_HOURS * 60 * 60 * 1000;
    if (startAt.getTime() < now + minAdvanceMs) {
      throw new BadRequestException(
        `Consultas precisam ser marcadas com pelo menos ${this.MIN_ADVANCE_HOURS}h de antecedência.`,
      );
    }
    const maxAdvanceMs = this.MAX_ADVANCE_DAYS * 24 * 60 * 60 * 1000;
    if (startAt.getTime() > now + maxAdvanceMs) {
      throw new BadRequestException(
        `Consultas só podem ser marcadas com até ${this.MAX_ADVANCE_DAYS} dias de antecedência.`,
      );
    }

    const lawyer = await this.resolveLawyerForLead(leadId);
    if (!lawyer) {
      throw new BadRequestException(
        'Não foi possível identificar seu advogado responsável. Entre em contato pelo WhatsApp.',
      );
    }

    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, name: true, phone: true, tenant_id: true },
    });
    if (!lead) throw new BadRequestException('Cliente nao encontrado');

    const endAt = new Date(startAt.getTime() + cfg.durationMinutes * 60 * 1000);

    // Verifica conflito com QUALQUER evento ativo do advogado nessa janela
    // (audiencia, pericia, prazo, outras consultas). Audiencia tem prioridade
    // absoluta — regra explicita do André pra evitar conflito de agenda.
    const conflict = await this.prisma.calendarEvent.findFirst({
      where: {
        assigned_user_id: lawyer.id,
        status: { notIn: ['CANCELADO', 'CONCLUIDO'] },
        AND: [
          { start_at: { lt: endAt } },
          {
            OR: [
              // Eventos sem end_at: assume 1h pra audiencia/pericia, 30min pros outros
              { end_at: null, start_at: { gte: new Date(startAt.getTime() - 60 * 60 * 1000) } },
              { end_at: { gt: startAt } },
            ],
          },
        ],
      },
      select: { id: true, start_at: true, title: true, type: true },
    });
    if (conflict) {
      this.logger.log(
        `[PORTAL/scheduling] Conflito: lead ${leadId} tentou ${data.modality} em ` +
        `${startAt.toISOString()} mas advogado tem ${conflict.type} (${conflict.title}) ` +
        `em ${conflict.start_at.toISOString()}`,
      );
      throw new ConflictException(
        `Esse horário não está mais disponível. Por favor, escolha outro.`,
      );
    }

    const description = [
      `🔵 Agendada pelo cliente via portal.`,
      ``,
      `Modalidade: ${cfg.label} (${cfg.durationMinutes} min)`,
      `Motivo: ${reason}`,
      data.notes ? `\nObservações do cliente: ${data.notes}` : '',
    ].filter(Boolean).join('\n');

    const event = await this.calendar.create({
      type: 'CONSULTA',
      title: `${cfg.emoji} ${cfg.label}: ${lead.name || 'Cliente'} — ${reason.slice(0, 60)}`,
      description,
      location: cfg.buildLocation(lead.phone),
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
      lead_id: lead.id,
      assigned_user_id: lawyer.id,
      tenant_id: lead.tenant_id || undefined,
      created_by_id: lawyer.id,
      priority: 'NORMAL',
    });

    // Notifica advogado via WhatsApp
    if (lawyer.phone) {
      try {
        const phone = normalizeBrazilianPhone(lawyer.phone);
        const dateStr = startAt.toLocaleString('pt-BR', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
          timeZone: 'UTC',
        });
        const msg =
          `📅 *Nova consulta agendada pelo cliente*\n\n` +
          `Cliente: *${lead.name || 'Sem nome'}*\n` +
          `WhatsApp: ${lead.phone}\n` +
          `Modalidade: *${cfg.emoji} ${cfg.label}* (${cfg.durationMinutes} min)\n` +
          `Data/hora: *${dateStr}*\n\n` +
          `📝 Motivo: ${reason}\n` +
          (data.notes ? `Observações: ${data.notes}\n` : '') +
          `\n_Agendamento via portal do cliente._`;
        const inst = process.env.EVOLUTION_INSTANCE_NAME || 'whatsapp';
        await this.whatsapp.sendText(phone, msg, inst);
      } catch (e: any) {
        this.logger.warn(`[PORTAL/scheduling] Falha ao notificar advogado ${lawyer.id}: ${e.message}`);
      }
    }

    this.logger.log(
      `[PORTAL/scheduling] Cliente ${leadId} agendou ${data.modality} (${event.id}) ` +
      `com ${lawyer.name} em ${startAt.toISOString()}`,
    );

    return {
      id: event.id,
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
      lawyer_name: lawyer.name,
      reason,
      modality: data.modality,
      modality_label: cfg.label,
    };
  }

  /**
   * Lista consultas futuras do cliente.
   */
  async listMyAppointments(leadId: string) {
    const events = await this.prisma.calendarEvent.findMany({
      where: {
        lead_id: leadId,
        type: 'CONSULTA',
        status: { notIn: ['CANCELADO', 'CONCLUIDO'] },
        start_at: { gte: new Date() },
      },
      select: {
        id: true, title: true, description: true, start_at: true, end_at: true,
        location: true, status: true,
        assigned_user: { select: { name: true } },
      },
      orderBy: { start_at: 'asc' },
    });

    return events.map(e => ({
      id: e.id,
      title: e.title,
      description: e.description,
      start_at: e.start_at.toISOString(),
      end_at: e.end_at?.toISOString() || null,
      location: e.location,
      status: e.status,
      lawyer_name: e.assigned_user?.name || null,
    }));
  }
}
