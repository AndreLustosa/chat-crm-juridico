import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Inject, forwardRef, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { CalendarService } from '../calendar/calendar.service';
import { LEGAL_STAGES, TRACKING_STAGES } from './legal-stages';
import OpenAI from 'openai';

@Injectable()
export class LegalCasesService {
  private readonly logger = new Logger(LegalCasesService.name);

  constructor(
    private prisma: PrismaService,
    private chatGateway: ChatGateway,
    @Inject(forwardRef(() => WhatsappService)) private whatsappService: WhatsappService,
    private calendarService: CalendarService,
  ) {}

  private tenantWhere(tenantId?: string) {
    return tenantId ? { OR: [{ tenant_id: tenantId }, { tenant_id: null }] } : {};
  }

  private async verifyTenantOwnership(id: string, tenantId?: string) {
    if (!tenantId) return;
    const lc = await this.prisma.legalCase.findUnique({ where: { id }, select: { tenant_id: true } });
    if (lc?.tenant_id && lc.tenant_id !== tenantId) {
      throw new ForbiddenException('Acesso negado a este recurso');
    }
  }

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

  async findAll(lawyerId?: string, stage?: string, archived?: boolean, inTracking?: boolean, page?: number, limit?: number, tenantId?: string, leadId?: string, caseNumber?: string) {
    const where: any = { ...this.tenantWhere(tenantId) };
    if (lawyerId) where.lawyer_id = lawyerId;
    if (stage) where.stage = stage;
    if (archived !== undefined) where.archived = archived;
    if (inTracking !== undefined) where.in_tracking = inTracking;
    if (leadId) where.lead_id = leadId;
    if (caseNumber) where.case_number = { contains: caseNumber, mode: 'insensitive' };

    const now = new Date();
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
      lawyer: {
        select: {
          id: true,
          name: true,
        },
      },
      // Próximos eventos (audiências, perícias, prazos, tarefas — últimos 30d ou futuros)
      calendar_events: {
        where: {
          start_at: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) },
          status: { notIn: ['CANCELADO', 'CONCLUIDO'] },
        },
        orderBy: { start_at: 'asc' as const },
        take: 5,
        select: {
          id: true,
          type: true,
          start_at: true,
          title: true,
          location: true,
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

  async findOne(id: string, tenantId?: string) {
    await this.verifyTenantOwnership(id, tenantId);
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

  async updateStage(id: string, newStage: string, userId: string, tenantId?: string) {
    await this.verifyTenantOwnership(id, tenantId);
    const validStage = LEGAL_STAGES.find(s => s.id === newStage);
    if (!validStage) throw new BadRequestException(`Stage inválido: ${newStage}`);

    const updated = await this.prisma.legalCase.update({
      where: { id },
      data: { stage: newStage, stage_changed_at: new Date() },
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

  async archive(id: string, reason: string, notifyLead: boolean, tenantId?: string) {
    await this.verifyTenantOwnership(id, tenantId);
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

    // Ao arquivar: reverter lead para não-cliente (processo encerrado definitivamente)
    const activeCases = await this.prisma.legalCase.count({
      where: { lead_id: legalCase.lead_id, archived: false },
    });

    if (activeCases === 0 && legalCase.lead?.is_client) {
      await this.prisma.lead.update({
        where: { id: legalCase.lead_id },
        data: {
          is_client: false,
          stage: 'ENCERRADO',
          stage_entered_at: new Date(),
          loss_reason: `Processo arquivado: ${reason}`,
        },
      });
      this.logger.log(`[ARCHIVE] Lead ${legalCase.lead_id} marcado como encerrado`);
    }

    return legalCase;
  }

  async unarchive(id: string, tenantId?: string) {
    await this.verifyTenantOwnership(id, tenantId);
    const legalCase = await this.prisma.legalCase.update({
      where: { id },
      data: { archived: false, archive_reason: null, stage: 'VIABILIDADE' },
      include: { lead: { select: { id: true, is_client: true } } },
    });

    // ── Restaurar lead como cliente se teve um processo reativado ──
    if (legalCase.lead && !legalCase.lead.is_client) {
      await this.prisma.lead.update({
        where: { id: legalCase.lead.id },
        data: {
          is_client: true,
          became_client_at: new Date(),
          stage: 'FINALIZADO',
          stage_entered_at: new Date(),
          loss_reason: null,
        },
      });
      this.logger.log(`[UNARCHIVE] Lead ${legalCase.lead.id} restaurado como cliente`);
    }

    return legalCase;
  }

  async findPendingClosure(tenantId?: string) {
    return this.prisma.legalCase.findMany({
      where: {
        tracking_stage: 'ENCERRADO',
        archived: false,
        in_tracking: true,
        ...(tenantId ? { tenant_id: tenantId } : {}),
      },
      include: {
        lead: { select: { id: true, name: true, phone: true, profile_picture_url: true } },
        lawyer: { select: { id: true, name: true } },
        _count: { select: { tasks: true, events: true } },
      },
      orderBy: { stage_changed_at: 'asc' },
    });
  }

  // ─── CASE NUMBER ────────────────────────────────────────────────

  async setCaseNumber(id: string, caseNumber: string, court?: string, tenantId?: string) {
    await this.verifyTenantOwnership(id, tenantId);
    return this.prisma.legalCase.update({
      where: { id },
      data: {
        case_number: caseNumber,
        ...(court ? { court } : {}),
      },
    });
  }

  async updateNotes(id: string, notes: string, tenantId?: string) {
    await this.verifyTenantOwnership(id, tenantId);
    return this.prisma.legalCase.update({
      where: { id },
      data: { notes },
    });
  }

  async updateCourt(id: string, court: string, tenantId?: string) {
    await this.verifyTenantOwnership(id, tenantId);
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
  }, tenantId?: string) {
    await this.verifyTenantOwnership(caseId, tenantId);
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

  async findEvents(caseId: string, tenantId?: string) {
    await this.verifyTenantOwnership(caseId, tenantId);
    return this.prisma.caseEvent.findMany({
      where: { case_id: caseId },
      orderBy: { event_date: 'desc' },
    });
  }

  async deleteEvent(eventId: string, tenantId?: string) {
    if (tenantId) {
      const ev = await this.prisma.caseEvent.findUnique({
        where: { id: eventId },
        select: { case_id: true },
      });
      if (ev) await this.verifyTenantOwnership(ev.case_id, tenantId);
    }
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

  // ─── CADASTRO DIRETO (processo já em andamento, sem WhatsApp) ──

  async createDirect(data: {
    lawyer_id: string;
    override_lawyer_id?: string; // ADMIN pode escolher outro advogado
    tenant_id?: string;
    case_number: string;
    legal_area?: string;
    action_type?: string;
    opposing_party?: string;
    claim_value?: number;
    court?: string;
    judge?: string;
    tracking_stage?: string;
    priority?: string;
    notes?: string;
    filed_at?: string;
    // Integração lead: informar lead_id existente OU dados para criar novo lead real
    lead_id?: string;
    lead_name?: string;
    lead_phone?: string;
    lead_email?: string;
  }) {
    const VALID_TRACKING = TRACKING_STAGES.map(s => s.id) as string[];
    const trackingStage = (
      data.tracking_stage && VALID_TRACKING.includes(data.tracking_stage)
        ? data.tracking_stage
        : 'DISTRIBUIDO'
    ) as string;

    const VALID_PRIORITIES = ['URGENTE', 'NORMAL', 'BAIXA'];
    const priority = (
      data.priority && VALID_PRIORITIES.includes(data.priority)
        ? data.priority
        : 'NORMAL'
    ) as string;

    let leadId: string;
    let leadDisplayName: string;

    if (data.lead_id) {
      // Caminho A: lead existente informado pelo usuário
      const existing = await this.prisma.lead.findUnique({
        where: { id: data.lead_id },
        select: { id: true, name: true },
      });
      if (!existing) throw new BadRequestException('Lead informado não encontrado.');
      leadId = existing.id;
      leadDisplayName = existing.name || data.lead_id;

    } else if (data.lead_phone) {
      // Caminho B: criar novo lead real com telefone/nome fornecidos
      const normalizedPhone = data.lead_phone.replace(/\D/g, '');
      if (!normalizedPhone) throw new BadRequestException('Telefone inválido para o cliente.');

      // Verifica se já existe lead com esse telefone
      const byPhone = await this.prisma.lead.findFirst({
        where: { phone: { contains: normalizedPhone } },
        select: { id: true, name: true },
      });

      if (byPhone) {
        leadId = byPhone.id;
        leadDisplayName = byPhone.name || normalizedPhone;
      } else {
        const newLead = await this.prisma.lead.create({
          data: {
            phone: normalizedPhone,
            name: data.lead_name || null,
            email: data.lead_email || null,
            tenant_id: data.tenant_id,
            origin: 'CADASTRO_PROCESSO',
          },
          select: { id: true, name: true },
        });
        leadId = newLead.id;
        leadDisplayName = newLead.name || normalizedPhone;
      }

    } else {
      // Caminho C: fallback — lead placeholder (retrocompatibilidade)
      const placeholderPhone = `PROC_${data.case_number.replace(/\D/g, '')}`;
      leadDisplayName = data.opposing_party
        ? `[Processo] ${data.opposing_party}`
        : `[Processo] ${data.case_number}`;

      let lead = await this.prisma.lead.findFirst({
        where: { phone: placeholderPhone },
        select: { id: true },
      });
      if (!lead) {
        lead = await this.prisma.lead.create({
          data: {
            phone: placeholderPhone,
            name: leadDisplayName,
            tenant_id: data.tenant_id,
            origin: 'CADASTRO_DIRETO',
          },
          select: { id: true },
        });
      }
      leadId = lead.id;
    }

    // Se ADMIN passou override_lawyer_id, usa ele; caso contrário usa o usuário logado
    const effectiveLawyerId = data.override_lawyer_id || data.lawyer_id;

    const legalCase = await this.prisma.legalCase.create({
      data: {
        lead_id: leadId,
        lawyer_id: effectiveLawyerId,
        tenant_id: data.tenant_id,
        case_number: data.case_number,
        legal_area: data.legal_area,
        action_type: data.action_type,
        opposing_party: data.opposing_party,
        claim_value: data.claim_value,
        court: data.court,
        judge: data.judge,
        notes: data.notes,
        priority,
        stage: 'PROTOCOLO',
        in_tracking: true,
        tracking_stage: trackingStage,
        filed_at: data.filed_at ? new Date(data.filed_at) : new Date(),
        stage_changed_at: new Date(),
      },
      include: {
        lead: { select: { id: true, name: true, phone: true, profile_picture_url: true, email: true } },
        _count: { select: { tasks: true, events: true, djen_publications: true } },
      },
    });

    // ── Promover lead para cliente (is_client = true) ──────────────
    // Processo cadastrado diretamente = lead já é cliente ativo
    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        is_client: true,
        became_client_at: new Date(),
        stage: 'FINALIZADO',
        stage_entered_at: new Date(),
        loss_reason: null,
      },
    });

    try {
      this.chatGateway.emitNewLegalCase(effectiveLawyerId, {
        caseId: legalCase.id,
        leadName: leadDisplayName,
      });
    } catch {}

    return legalCase;
  }

  // ─── REPARO: promove leads com processo ativo para is_client ────

  async syncClientsFromActiveCases(tenantId?: string) {
    // Busca todos os leads com pelo menos 1 processo ativo e is_client = false
    const cases = await this.prisma.legalCase.findMany({
      where: {
        archived: false,
        in_tracking: true,
        ...(tenantId ? { tenant_id: tenantId } : {}),
        lead: { is_client: false },
      },
      select: { lead_id: true },
      distinct: ['lead_id'],
    });

    if (cases.length === 0) return { updated: 0 };

    const leadIds = cases.map(c => c.lead_id);
    const result = await this.prisma.lead.updateMany({
      where: { id: { in: leadIds } },
      data: {
        is_client: true,
        became_client_at: new Date(),
        stage: 'FINALIZADO',
        loss_reason: null,
      },
    });

    this.logger.log(`[SYNC-CLIENTS] ${result.count} leads promovidos para cliente`);
    return { updated: result.count, lead_ids: leadIds };
  }

  // ─── VINCULAR / CRIAR CLIENTE (LEAD) ──────────────────────────

  async updateLead(id: string, data: {
    lead_id?: string;
    lead_phone?: string;
    lead_name?: string;
    lead_email?: string;
    tenant_id?: string;
  }) {
    await this.verifyTenantOwnership(id, data.tenant_id);

    const lc = await this.prisma.legalCase.findUnique({
      where: { id },
      select: { id: true, lead_id: true, lead: { select: { phone: true, name: true } } },
    });
    if (!lc) throw new NotFoundException('Processo não encontrado');

    let finalLeadId: string;

    if (data.lead_id) {
      const existing = await this.prisma.lead.findUnique({ where: { id: data.lead_id }, select: { id: true } });
      if (!existing) throw new BadRequestException('Lead informado não encontrado.');
      finalLeadId = data.lead_id;

    } else if (data.lead_phone) {
      const normalizedPhone = data.lead_phone.replace(/\D/g, '');
      if (!normalizedPhone) throw new BadRequestException('Telefone inválido.');

      // Verifica se já existe lead com esse telefone
      const byPhone = await this.prisma.lead.findFirst({
        where: { phone: { contains: normalizedPhone } },
        select: { id: true },
      });

      if (byPhone) {
        finalLeadId = byPhone.id;
      } else {
        const newLead = await this.prisma.lead.create({
          data: {
            phone: normalizedPhone,
            name: data.lead_name || null,
            email: data.lead_email || null,
            tenant_id: data.tenant_id,
            origin: 'CADASTRO_PROCESSO',
          },
          select: { id: true },
        });
        finalLeadId = newLead.id;
      }
    } else {
      throw new BadRequestException('Informe lead_id ou lead_phone.');
    }

    // Atualiza o lead_id PRIMEIRO (antes de qualquer deleção) para evitar cascade delete no LegalCase
    const updated = await this.prisma.legalCase.update({
      where: { id },
      data: { lead_id: finalLeadId },
      include: {
        lead: { select: { id: true, name: true, phone: true, email: true, profile_picture_url: true } },
        _count: { select: { tasks: true, events: true, djen_publications: true } },
      },
    });

    // Após atualizar, remove o lead placeholder antigo se era PROC_xxx e não tem outros processos
    // (o LegalCase já aponta pro novo lead, então o cascade delete não afeta mais este processo)
    const oldIsPlaceholder = lc.lead?.phone?.startsWith('PROC_') || lc.lead?.name?.startsWith('[Processo]');
    if (oldIsPlaceholder && lc.lead_id !== finalLeadId) {
      const otherCases = await this.prisma.legalCase.count({ where: { lead_id: lc.lead_id } });
      if (otherCases === 0) {
        await this.prisma.lead.delete({ where: { id: lc.lead_id } }).catch(() => {});
      }
    }

    return updated;
  }

  // ─── PROTOCOLO → PROCESSOS ─────────────────────────────────────

  async sendToTracking(id: string, caseNumber: string, court?: string, tenantId?: string) {
    await this.verifyTenantOwnership(id, tenantId);
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

  async updateTrackingStage(
    id: string,
    trackingStage: string,
    tenantId?: string,
    sentenceData?: { sentence_value?: number; sentence_date?: string; sentence_type?: string },
  ) {
    await this.verifyTenantOwnership(id, tenantId);
    const valid = TRACKING_STAGES.find(s => s.id === trackingStage);
    if (!valid) throw new BadRequestException(`Stage inválido: ${trackingStage}`);

    const current = await this.prisma.legalCase.findUnique({
      where: { id },
      select: { tracking_stage: true, lead_id: true, case_number: true, legal_area: true },
    });

    // Dados adicionais para EXECUCAO: valor da condenação + sentença
    const extraData: any = {};
    if (trackingStage === 'EXECUCAO' && sentenceData) {
      if (sentenceData.sentence_value !== undefined && sentenceData.sentence_value !== null) {
        extraData.sentence_value = sentenceData.sentence_value;
      }
      if (sentenceData.sentence_date) {
        extraData.sentence_date = new Date(sentenceData.sentence_date);
      }
      if (sentenceData.sentence_type) {
        extraData.sentence_type = sentenceData.sentence_type;
      }
    }

    const result = await this.prisma.legalCase.update({
      where: { id },
      data: { tracking_stage: trackingStage, stage_changed_at: new Date(), ...extraData },
    });

    // Recalcular honorários de êxito quando sentence_value é preenchido
    if (extraData.sentence_value) {
      try {
        const { HonorariosService } = await import('../honorarios/honorarios.service');
        // Dynamic import para evitar circular dependency — recalcula no próprio Prisma
        const exitoHonorarios = await this.prisma.caseHonorario.findMany({
          where: { legal_case_id: id, type: { in: ['EXITO', 'MISTO'] }, success_percentage: { not: null }, status: 'ATIVO' },
        });
        const sentenceValue = Number(extraData.sentence_value);
        for (const h of exitoHonorarios) {
          const percentage = Number(h.success_percentage);
          const calculatedValue = Math.round(sentenceValue * percentage) / 100;
          await this.prisma.caseHonorario.update({ where: { id: h.id }, data: { calculated_value: calculatedValue } });
          this.logger.log(`[EXECUCAO] Êxito recalculado: ${h.id} | ${percentage}% de R$ ${sentenceValue} = R$ ${calculatedValue}`);
        }
      } catch (e: any) {
        this.logger.warn(`[EXECUCAO] Falha ao recalcular êxito: ${e.message}`);
      }
    }

    if (current?.lead_id) {
      this.appendCaseStageToMemory(current.lead_id, current.tracking_stage, trackingStage, valid.label, current.case_number, current.legal_area).catch(err =>
        this.logger.warn(`[MEMORY] Falha ao registrar etapa do processo na memória: ${err}`),
      );
    }

    return result;
  }

  private async appendCaseStageToMemory(leadId: string, fromStage: string | null, toStage: string, toLabel: string, caseNumber: string | null, legalArea: string | null): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const fromLabel = TRACKING_STAGES.find(s => s.id === fromStage)?.label || fromStage || 'início';
    const entry = { from: fromStage, to: toStage, date: today, case_number: caseNumber, legal_area: legalArea };

    const existing = await this.prisma.aiMemory.findUnique({ where: { lead_id: leadId } });
    let facts: any = {};
    try { facts = existing?.facts_json ? (typeof existing.facts_json === 'string' ? JSON.parse(existing.facts_json as string) : existing.facts_json) : {}; } catch { facts = {}; }
    const timeline: any[] = facts.case_timeline || [];
    timeline.push(entry);
    if (timeline.length > 30) timeline.splice(0, timeline.length - 30);
    facts.case_timeline = timeline;

    const summaryLine = `[PROCESSO ${today}] ${fromLabel} → ${toLabel}${caseNumber ? ` (Proc. ${caseNumber})` : ''}`;
    const newSummary = (summaryLine + (existing?.summary ? '\n' + existing.summary : '')).slice(0, 2000);

    if (existing) {
      await this.prisma.aiMemory.update({
        where: { lead_id: leadId },
        data: { facts_json: facts, summary: newSummary, last_updated_at: new Date(), version: { increment: 1 } },
      });
    } else {
      await this.prisma.aiMemory.create({ data: { lead_id: leadId, summary: newSummary, facts_json: facts } });
    }
  }

  // ─── WORKSPACE ──────────────────────────────────────────────────

  async getWorkspaceData(id: string, tenantId?: string) {
    await this.verifyTenantOwnership(id, tenantId);

    const legalCase = await this.prisma.legalCase.findUnique({
      where: { id },
      include: {
        lead: {
          include: {
            memory: { select: { summary: true, facts_json: true } },
            ficha_trabalhista: { select: { data: true, completion_pct: true, finalizado: true } },
          },
        },
        conversation: {
          select: { id: true, instance_name: true, status: true, legal_area: true },
        },
        lawyer: { select: { id: true, name: true, email: true } },
        _count: {
          select: {
            tasks: true,
            events: true,
            documents: true,
            deadlines: true,
            djen_publications: true,
            calendar_events: true,
          },
        },
      },
    });

    if (!legalCase) throw new NotFoundException('Caso jurídico não encontrado');
    return legalCase;
  }

  async updateDetails(
    id: string,
    data: {
      action_type?: string;
      claim_value?: number;
      opposing_party?: string;
      judge?: string;
      notes?: string;
      court?: string;
      legal_area?: string;
      priority?: string;
    },
    tenantId?: string,
  ) {
    await this.verifyTenantOwnership(id, tenantId);

    const VALID_PRIORITIES = ['URGENTE', 'NORMAL', 'BAIXA'];
    const updateData: any = {};
    if (data.action_type !== undefined) updateData.action_type = data.action_type;
    if (data.claim_value !== undefined) updateData.claim_value = data.claim_value;
    if (data.opposing_party !== undefined) updateData.opposing_party = data.opposing_party;
    if (data.judge !== undefined) updateData.judge = data.judge;
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.court !== undefined) updateData.court = data.court;
    if (data.legal_area !== undefined) updateData.legal_area = data.legal_area;
    if (data.priority !== undefined && VALID_PRIORITIES.includes(data.priority)) updateData.priority = data.priority;

    return this.prisma.legalCase.update({
      where: { id },
      data: updateData,
    });
  }

  async getCommunications(id: string, page: number, limit: number, tenantId?: string) {
    await this.verifyTenantOwnership(id, tenantId);

    const legalCase = await this.prisma.legalCase.findUnique({
      where: { id },
      select: { conversation_id: true },
    });
    if (!legalCase) throw new NotFoundException('Caso não encontrado');
    if (!legalCase.conversation_id) return { data: [], total: 0, page, limit };

    const where = { conversation_id: legalCase.conversation_id };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.message.findMany({
        where,
        include: {
          media: { select: { id: true, mime_type: true, s3_key: true, original_name: true } },
        },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.message.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  // ─── ADVOGADO RESPONSÁVEL ──────────────────────────────────────

  async updateLawyer(id: string, lawyerId: string, tenantId?: string) {
    await this.verifyTenantOwnership(id, tenantId);

    const lawyer = await this.prisma.user.findUnique({
      where: { id: lawyerId },
      select: { id: true, name: true, role: true },
    });
    if (!lawyer) throw new BadRequestException('Advogado não encontrado.');
    if (!['ADMIN', 'ADVOGADO'].includes(lawyer.role)) {
      throw new BadRequestException('Usuário não tem perfil de advogado.');
    }

    const updated = await this.prisma.legalCase.update({
      where: { id },
      data: { lawyer_id: lawyerId },
      include: {
        lead: { select: { id: true, name: true, phone: true, email: true, profile_picture_url: true } },
        lawyer: { select: { id: true, name: true } },
        _count: { select: { tasks: true, events: true, djen_publications: true } },
      },
    });

    // Reatribui todos os eventos do processo que ainda não foram concluídos/cancelados
    await this.prisma.calendarEvent.updateMany({
      where: {
        legal_case_id: id,
        status: { notIn: ['CONCLUIDO', 'CANCELADO'] },
      },
      data: { assigned_user_id: lawyerId },
    });

    try {
      this.chatGateway.emitLegalCaseUpdate(lawyerId, {
        caseId: id,
        action: 'lawyer_changed',
        lawyerName: lawyer.name,
      });
    } catch {}

    return updated;
  }

  // ─── STAGES LIST ────────────────────────────────────────────────

  getStages() {
    return LEGAL_STAGES;
  }

  getTrackingStages() {
    return TRACKING_STAGES;
  }

  // ─── CASE BRIEFING IA ─────────────────────────────────────────────────────

  async generateBriefing(id: string, tenantId?: string): Promise<{ briefing: string }> {
    await this.verifyTenantOwnership(id, tenantId);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new BadRequestException('OPENAI_API_KEY não configurada. Configure a variável de ambiente para usar o Briefing IA.');
    }

    const legalCase: any = await this.prisma.legalCase.findUnique({
      where: { id },
      include: {
        lead: {
          include: {
            memory: { select: { summary: true } },
            ficha_trabalhista: { select: { completion_pct: true, finalizado: true } },
          },
        },
        lawyer: { select: { name: true } },
        deadlines: {
          where: { completed: false },
          orderBy: { due_at: 'asc' },
          take: 5,
          select: { title: true, due_at: true, type: true, completed: true },
        },
        tasks: {
          where: { status: { not: 'CONCLUIDA' } },
          orderBy: { due_at: 'asc' },
          take: 5,
          select: { title: true, due_at: true, status: true },
        },
        djen_publications: {
          orderBy: { data_disponibilizacao: 'desc' },
          take: 3,
          select: { tipo_comunicacao: true, data_disponibilizacao: true, assunto: true },
        },
        documents: {
          take: 5,
          orderBy: { created_at: 'desc' },
          select: { name: true, created_at: true },
        },
      },
    });

    if (!legalCase) throw new NotFoundException('Caso não encontrado');

    const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString('pt-BR') : '—';
    const fmtBRL = (v: any) => v != null ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v) : '—';

    const context = `
CASO JURÍDICO — BRIEFING SOLICITADO EM ${new Date().toLocaleDateString('pt-BR')}

IDENTIFICAÇÃO
- Cliente: ${legalCase.lead?.name || 'Não informado'}
- Telefone: ${legalCase.lead?.phone || '—'}
- Advogado responsável: ${legalCase.lawyer?.name || '—'}
- Número do processo: ${legalCase.case_number || 'Não distribuído'}
- Área jurídica: ${legalCase.legal_area || '—'}
- Tipo de ação: ${legalCase.action_type || '—'}
- Vara/Tribunal: ${legalCase.court || '—'}
- Parte contrária: ${legalCase.opposing_party || '—'}
- Juiz/Desembargador: ${legalCase.judge || '—'}
- Valor da causa: ${fmtBRL(legalCase.claim_value)}
- Estágio atual: ${legalCase.stage}
- Acompanhamento processual: ${legalCase.in_tracking ? `Sim (${legalCase.tracking_stage || '—'})` : 'Não'}
- Data de abertura: ${fmtDate(legalCase.created_at)}

MEMÓRIA DA IA (histórico de conversas com o cliente):
${legalCase.lead?.memory?.summary || 'Sem memória registrada'}

NOTAS INTERNAS:
${legalCase.notes || 'Sem anotações'}

PRAZOS PENDENTES (${legalCase.deadlines?.length || 0}):
${legalCase.deadlines?.map((d: any) => `- ${d.title} | Vence: ${fmtDate(d.due_at)} | Tipo: ${d.type}`).join('\n') || 'Nenhum prazo pendente'}

TAREFAS ABERTAS (${legalCase.tasks?.length || 0}):
${legalCase.tasks?.map((t: any) => `- ${t.title} | Status: ${t.status}${t.due_at ? ` | Prazo: ${fmtDate(t.due_at)}` : ''}`).join('\n') || 'Nenhuma tarefa aberta'}

ÚLTIMAS PUBLICAÇÕES DJEN:
${legalCase.djen_publications?.map((d: any) => `- ${d.tipo_comunicacao || 'Publicação'} | ${fmtDate(d.data_disponibilizacao)}${d.assunto ? ` | ${d.assunto}` : ''}`).join('\n') || 'Nenhuma publicação'}

DOCUMENTOS RECENTES:
${legalCase.documents?.map((d: any) => `- ${d.name} (${fmtDate(d.created_at)})`).join('\n') || 'Nenhum documento'}

FICHA TRABALHISTA: ${legalCase.lead?.ficha_trabalhista ? `${legalCase.lead.ficha_trabalhista.completion_pct}% preenchida${legalCase.lead.ficha_trabalhista.finalizado ? ' (finalizada)' : ''}` : 'Não aplicável'}
`.trim();

    const openai = new OpenAI({ apiKey });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content: `Você é um assistente jurídico especializado. Gere briefings de casos concisos e bem estruturados para advogados brasileiros. Use linguagem profissional e direta. Formate em seções claras usando markdown simples (## para títulos, - para listas). Seja objetivo — máximo 400 palavras.`,
        },
        {
          role: 'user',
          content: `Com base nas informações abaixo, gere um briefing estruturado do caso incluindo: (1) Resumo executivo, (2) Situação atual, (3) Próximos passos prioritários, (4) Pontos de atenção/riscos.\n\n${context}`,
        },
      ],
    });

    const briefing = completion.choices[0]?.message?.content || 'Não foi possível gerar o briefing.';
    return { briefing };
  }
}
