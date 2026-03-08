import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { CalendarService } from '../calendar/calendar.service';
import { LEGAL_STAGES, TRACKING_STAGES } from './legal-stages';

@Injectable()
export class LegalCasesService {
  private readonly logger = new Logger(LegalCasesService.name);

  constructor(
    private prisma: PrismaService,
    private chatGateway: ChatGateway,
    @Inject(forwardRef(() => WhatsappService)) private whatsappService: WhatsappService,
    private calendarService: CalendarService,
  ) {}

  // ─── CRUD ───────────────────────────────────────────────────────

  async create(data: {
    lead_id: string;
    conversation_id?: string;
    lawyer_id: string;
    legal_area?: string;
    tenant_id?: string;
  }) {
    return this.prisma.legalCase.create({
      data: {
        lead_id: data.lead_id,
        conversation_id: data.conversation_id,
        lawyer_id: data.lawyer_id,
        legal_area: data.legal_area,
        tenant_id: data.tenant_id,
        stage: 'VIABILIDADE',
      },
      include: { lead: true },
    });
  }

  async findAll(lawyerId?: string, stage?: string, archived?: boolean, inTracking?: boolean, page?: number, limit?: number) {
    const where: any = {};
    if (lawyerId) where.lawyer_id = lawyerId;
    if (stage) where.stage = stage;
    if (archived !== undefined) where.archived = archived;
    if (inTracking !== undefined) where.in_tracking = inTracking;

    const includeOpts = {
      lead: {
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          profile_picture_url: true,
          stage: true,
        },
      },
      _count: {
        select: {
          tasks: true,
          events: true,
          djen_publications: true,
        },
      },
    };

    if (page && limit) {
      const [data, total] = await this.prisma.$transaction([
        this.prisma.legalCase.findMany({
          where,
          include: includeOpts,
          orderBy: { updated_at: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.prisma.legalCase.count({ where }),
      ]);
      return { data, total, page, limit };
    }

    return this.prisma.legalCase.findMany({
      where,
      include: includeOpts,
      orderBy: { updated_at: 'desc' },
    });
  }

  async findOne(id: string) {
    const legalCase = await this.prisma.legalCase.findUnique({
      where: { id },
      include: {
        lead: true,
        conversation: {
          select: {
            id: true,
            instance_name: true,
            status: true,
            legal_area: true,
          },
        },
        tasks: {
          include: {
            assigned_user: { select: { id: true, name: true } },
            _count: { select: { comments: true } },
          },
          orderBy: { created_at: 'desc' },
        },
        events: {
          orderBy: { event_date: 'desc' },
        },
      },
    });

    if (!legalCase) throw new NotFoundException('Caso jurídico não encontrado');
    return legalCase;
  }

  // ─── INCOMING ───────────────────────────────────────────────────

  async findIncoming(lawyerId: string) {
    // Busca leads que têm conversations com assigned_lawyer_id = lawyerId
    // MAS que NÃO possuem um LegalCase criado ainda para este advogado
    const existingCases = await this.prisma.legalCase.findMany({
      where: { lawyer_id: lawyerId },
      select: { lead_id: true },
    });
    const existingLeadIds = existingCases.map(c => c.lead_id);

    const conversations = await this.prisma.conversation.findMany({
      where: {
        assigned_lawyer_id: lawyerId,
        status: 'ABERTO',
        ...(existingLeadIds.length > 0
          ? { lead_id: { notIn: existingLeadIds } }
          : {}),
      },
      include: {
        lead: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            profile_picture_url: true,
            stage: true,
          },
        },
      },
      orderBy: { last_message_at: 'desc' },
    });

    return conversations.map(conv => ({
      conversationId: conv.id,
      lead: conv.lead,
      legalArea: conv.legal_area,
      instanceName: conv.instance_name,
      lastMessageAt: conv.last_message_at,
    }));
  }

  // ─── STAGE TRANSITIONS ─────────────────────────────────────────

  async updateStage(id: string, newStage: string, userId: string) {
    const validStage = LEGAL_STAGES.find(s => s.id === newStage);
    if (!validStage) throw new BadRequestException(`Stage inválido: ${newStage}`);

    const updated = await this.prisma.legalCase.update({
      where: { id },
      data: { stage: newStage },
      include: { lead: { select: { name: true } } },
    });

    try {
      this.chatGateway.emitLegalCaseUpdate(updated.lawyer_id, {
        caseId: id,
        action: 'stage_changed',
        stage: newStage,
      });
    } catch {}

    return updated;
  }

  // ─── ARCHIVE / UNARCHIVE ───────────────────────────────────────

  async archive(id: string, reason: string, notifyLead: boolean) {
    const legalCase = await this.prisma.legalCase.update({
      where: { id },
      data: { archived: true, archive_reason: reason },
      include: {
        lead: true,
        conversation: { select: { instance_name: true } },
      },
    });

    if (notifyLead && legalCase.lead?.phone) {
      const leadName = legalCase.lead.name || 'cliente';
      const msg = `Prezado(a) ${leadName}, informamos que após análise de viabilidade jurídica, verificamos que não é possível prosseguir com o seu caso neste momento. Motivo: ${reason}. Caso tenha dúvidas, entre em contato conosco.`;
      try {
        await this.whatsappService.sendText(
          legalCase.lead.phone,
          msg,
          legalCase.conversation?.instance_name ?? undefined,
        );
      } catch (e) {
        this.logger.error('Erro ao enviar notificação de arquivamento:', e);
      }
    }

    return legalCase;
  }

  async unarchive(id: string) {
    return this.prisma.legalCase.update({
      where: { id },
      data: { archived: false, archive_reason: null, stage: 'VIABILIDADE' },
    });
  }

  // ─── CASE NUMBER ────────────────────────────────────────────────

  async setCaseNumber(id: string, caseNumber: string, court?: string) {
    return this.prisma.legalCase.update({
      where: { id },
      data: {
        case_number: caseNumber,
        ...(court ? { court } : {}),
      },
    });
  }

  async updateNotes(id: string, notes: string) {
    return this.prisma.legalCase.update({
      where: { id },
      data: { notes },
    });
  }

  async updateCourt(id: string, court: string) {
    return this.prisma.legalCase.update({
      where: { id },
      data: { court },
    });
  }

  // ─── EVENTS (Publicações / Movimentações) ──────────────────────

  async addEvent(caseId: string, data: {
    type: string;
    title: string;
    description?: string;
    source?: string;
    reference_url?: string;
    event_date?: Date;
  }) {
    const caseEvent = await this.prisma.caseEvent.create({
      data: {
        case_id: caseId,
        type: data.type,
        title: data.title,
        description: data.description,
        source: data.source,
        reference_url: data.reference_url,
        event_date: data.event_date ? new Date(data.event_date) : null,
      },
    });

    // Auto-create CalendarEvent for audiencia/prazo types with date
    if (data.event_date && ['audiencia', 'prazo'].includes(data.type?.toLowerCase())) {
      try {
        const legalCase = await this.prisma.legalCase.findUnique({
          where: { id: caseId },
          select: { lawyer_id: true, lead_id: true, tenant_id: true },
        });
        if (legalCase?.lawyer_id) {
          const calType = data.type.toLowerCase() === 'audiencia' ? 'AUDIENCIA' : 'PRAZO';
          await this.calendarService.create({
            type: calType,
            title: data.title,
            description: data.description,
            start_at: new Date(data.event_date).toISOString(),
            end_at: new Date(new Date(data.event_date).getTime() + 60 * 60000).toISOString(),
            assigned_user_id: legalCase.lawyer_id,
            lead_id: legalCase.lead_id || undefined,
            legal_case_id: caseId,
            created_by_id: legalCase.lawyer_id,
            tenant_id: legalCase.tenant_id || undefined,
            reminders: [{ minutes_before: 1440, channel: 'PUSH' }, { minutes_before: 60, channel: 'PUSH' }],
          });
          this.logger.log(`CalendarEvent ${calType} criado automaticamente para caso ${caseId}`);
        }
      } catch (e: any) {
        this.logger.warn(`Erro ao criar CalendarEvent para CaseEvent: ${e.message}`);
      }
    }

    return caseEvent;
  }

  async findEvents(caseId: string) {
    return this.prisma.caseEvent.findMany({
      where: { case_id: caseId },
      orderBy: { event_date: 'desc' },
    });
  }

  async deleteEvent(eventId: string) {
    return this.prisma.caseEvent.delete({ where: { id: eventId } });
  }

  // ─── AUTO-CREATION (hook do FINALIZADO) ─────────────────────────

  async createFromFinalizado(
    leadId: string,
    lawyerId: string,
    conversationId?: string,
    tenantId?: string,
  ) {
    // Verifica se já existe um caso para este lead + advogado
    const existing = await this.prisma.legalCase.findFirst({
      where: { lead_id: leadId, lawyer_id: lawyerId },
    });
    if (existing) return existing; // já existe, não duplica

    const created = await this.create({
      lead_id: leadId,
      conversation_id: conversationId,
      lawyer_id: lawyerId,
      tenant_id: tenantId,
    });

    try {
      const lead = await this.prisma.lead.findUnique({
        where: { id: leadId },
        select: { name: true },
      });
      this.chatGateway.emitNewLegalCase(lawyerId, {
        caseId: created.id,
        leadName: lead?.name || 'Contato',
      });
    } catch {}

    return created;
  }

  // ─── PROTOCOLO → PROCESSOS ─────────────────────────────────────

  async sendToTracking(id: string, caseNumber: string, court?: string) {
    const lc = await this.prisma.legalCase.findUnique({ where: { id } });
    if (!lc) throw new NotFoundException('Caso não encontrado');
    if (lc.archived) throw new BadRequestException('Caso arquivado não pode ser protocolado.');
    if (lc.stage !== 'PROTOCOLO') throw new BadRequestException('Caso deve estar no stage PROTOCOLO para ser protocolado');

    const updated = await this.prisma.legalCase.update({
      where: { id },
      data: {
        case_number: caseNumber,
        court: court ?? lc.court,
        in_tracking: true,
        tracking_stage: 'DISTRIBUIDO',
        filed_at: new Date(),
      },
      include: { lead: { select: { name: true } } },
    });

    try {
      this.chatGateway.emitLegalCaseUpdate(updated.lawyer_id, {
        caseId: id,
        action: 'sent_to_tracking',
        caseNumber,
      });
    } catch {}

    return updated;
  }

  async updateTrackingStage(id: string, trackingStage: string) {
    const valid = TRACKING_STAGES.find(s => s.id === trackingStage);
    if (!valid) throw new BadRequestException(`Stage inválido: ${trackingStage}`);

    return this.prisma.legalCase.update({
      where: { id },
      data: { tracking_stage: trackingStage },
    });
  }

  // ─── STAGES LIST ────────────────────────────────────────────────

  getStages() {
    return LEGAL_STAGES;
  }

  getTrackingStages() {
    return TRACKING_STAGES;
  }
}
