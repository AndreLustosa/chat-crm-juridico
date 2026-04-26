import { Injectable, BadRequestException, Logger, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarService } from '../calendar/calendar.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { normalizeBrazilianPhone } from '../common/utils/phone';

/**
 * Agendamento de consulta pelo portal do cliente.
 *
 * Fluxo:
 *   1. GET /portal/scheduling/availability?from=&to=
 *      Retorna slots disponiveis (08h-18h util, exceto almoco 12-13h),
 *      excluindo eventos ja marcados com o advogado responsavel pelo lead.
 *   2. POST /portal/scheduling
 *      Cria CalendarEvent type=CONSULTA, status=AGENDADO. Vincula ao
 *      lead + advogado responsavel. Dispara WhatsApp ao advogado.
 *   3. GET /portal/scheduling/my-appointments
 *      Lista consultas futuras do cliente.
 *
 * Politica:
 *   - Slot = 1 hora (consulta tipica)
 *   - Antecedencia minima: 24h (advogado precisa preparar)
 *   - Antecedencia maxima: 6 semanas
 *   - Horario: 08h-12h e 13h-18h (almoco bloqueado)
 *   - Dias: seg-sex (consultas comerciais)
 *   - Conflito: bloqueia slot se advogado tem outro evento mesmo horario
 *     (ranges sobrepostos com calendar.service.create guardrail).
 */
@Injectable()
export class PortalSchedulingService {
  private readonly logger = new Logger(PortalSchedulingService.name);

  // Janela comercial Maceio
  private readonly SLOT_DURATION_MINUTES = 60;
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
   * Lista slots livres dos proximos N dias. Front passa from/to ISO.
   */
  async listAvailability(
    leadId: string,
    fromIso?: string,
    toIso?: string,
  ): Promise<{ lawyer: { name: string | null }; slots: Array<{ start: string; end: string }> }> {
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

    // Eventos ja marcados do advogado na janela
    const busy = await this.prisma.calendarEvent.findMany({
      where: {
        assigned_user_id: lawyer.id,
        status: { notIn: ['CANCELADO', 'CONCLUIDO'] },
        start_at: { gte: from, lte: to },
      },
      select: { start_at: true, end_at: true },
    });

    // Indexa eventos por dia pra lookup rapido
    const busyMap = new Map<string, Array<{ start: number; end: number }>>();
    for (const ev of busy) {
      const dayKey = ev.start_at.toISOString().slice(0, 10);
      const arr = busyMap.get(dayKey) || [];
      arr.push({
        start: ev.start_at.getTime(),
        end: (ev.end_at?.getTime() || ev.start_at.getTime() + 60 * 60 * 1000),
      });
      busyMap.set(dayKey, arr);
    }

    // Gera slots de 1h em horario comercial pra cada dia util da janela
    const slots: Array<{ start: string; end: string }> = [];
    const cursor = new Date(Date.UTC(
      from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 0, 0, 0, 0,
    ));
    const endLoop = new Date(Date.UTC(
      to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate(), 23, 59, 59, 0,
    ));

    while (cursor <= endLoop) {
      const dow = cursor.getUTCDay();
      // Pula sab/dom
      if (dow === 0 || dow === 6) {
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        continue;
      }

      const dayKey = cursor.toISOString().slice(0, 10);
      const dayBusy = busyMap.get(dayKey) || [];

      // Manha: 8h-12h
      for (let h = this.MORNING_START_HOUR; h < this.MORNING_END_HOUR; h++) {
        const slotStart = new Date(Date.UTC(
          cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate(),
          h, 0, 0, 0,
        ));
        const slotEnd = new Date(slotStart.getTime() + this.SLOT_DURATION_MINUTES * 60 * 1000);
        if (slotStart < from) continue;
        if (this.slotConflicts(slotStart, slotEnd, dayBusy)) continue;
        slots.push({ start: slotStart.toISOString(), end: slotEnd.toISOString() });
      }
      // Tarde: 13h-18h
      for (let h = this.AFTERNOON_START_HOUR; h < this.AFTERNOON_END_HOUR; h++) {
        const slotStart = new Date(Date.UTC(
          cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate(),
          h, 0, 0, 0,
        ));
        const slotEnd = new Date(slotStart.getTime() + this.SLOT_DURATION_MINUTES * 60 * 1000);
        if (slotStart < from) continue;
        if (this.slotConflicts(slotStart, slotEnd, dayBusy)) continue;
        slots.push({ start: slotStart.toISOString(), end: slotEnd.toISOString() });
      }

      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return {
      lawyer: { name: lawyer.name },
      slots,
    };
  }

  private slotConflicts(start: Date, end: Date, busy: Array<{ start: number; end: number }>): boolean {
    const s = start.getTime();
    const e = end.getTime();
    return busy.some(b => s < b.end && e > b.start);
  }

  /**
   * Cria a consulta. Reusa CalendarService.create — guardrail de duplicata
   * (12h) ja eh aplicado la, entao se cliente clicar 2x rapido vira 409.
   */
  async createAppointment(
    leadId: string,
    data: { start_at: string; reason: string; notes?: string },
  ) {
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

    const endAt = new Date(startAt.getTime() + this.SLOT_DURATION_MINUTES * 60 * 1000);

    // Verifica conflito (alem do guardrail do CalendarService.create — esse
    // eh especifico pra AUDIENCIA/PERICIA, nao pega CONSULTA).
    const conflict = await this.prisma.calendarEvent.findFirst({
      where: {
        assigned_user_id: lawyer.id,
        status: { notIn: ['CANCELADO', 'CONCLUIDO'] },
        start_at: { gte: new Date(startAt.getTime() - 30 * 60 * 1000), lt: endAt },
      },
      select: { id: true, start_at: true, title: true },
    });
    if (conflict) {
      throw new ConflictException(
        `Esse horário não está mais disponível. Por favor, escolha outro.`,
      );
    }

    // created_by_id deve referenciar User (FK), nao Lead — viola constraint
    // se passar lead.id. Usa o proprio advogado como creator; a descricao
    // ja deixa claro que foi "agendada pelo cliente via portal".
    const event = await this.calendar.create({
      type: 'CONSULTA',
      title: `Consulta: ${lead.name || 'Cliente'} — ${reason.slice(0, 80)}`,
      description: `🔵 Agendada pelo cliente via portal.\n\nMotivo: ${reason}${data.notes ? `\n\nObservações do cliente: ${data.notes}` : ''}`,
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

    this.logger.log(`[PORTAL/scheduling] Cliente ${leadId} agendou consulta ${event.id} com ${lawyer.name} em ${startAt.toISOString()}`);

    return {
      id: event.id,
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
      lawyer_name: lawyer.name,
      reason,
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
