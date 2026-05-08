import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { tenantOrDefault, DEFAULT_TENANT_ID } from '../common/constants/tenant';
import OpenAI from 'openai';

// ─── Tipos internos ───────────────────────────────────────────────────────────

interface DossieCompleto {
  pessoa: {
    id: string; nome: string; telefone: string; email?: string;
    tipo: 'lead' | 'cliente'; estagio: string; canal_preferido: string;
    dias_sem_contato: number; inadimplente: boolean; origin?: string;
  };
  historico: {
    total_msgs: number; ultima_msg_resumo: string; ultima_msg_direcao: string;
    dias_sem_resposta: number; sentimento: string;
    ultimas_msgs: Array<{ direcao: string; text: string; created_at: string }>;
  };
  processual?: {
    processos: Array<{ numero: string; tipo: string; status: string; proximo_andamento?: string }>;
  };
  tarefa: {
    sequencia_nome: string; step_position: number; total_steps: number;
    tentativa_numero: number; objetivo: string; tom: string; canal: string;
    mensagens_anteriores: string[];
  };
  financeiro?: { inadimplente: boolean; valor_devido?: number };
  /**
   * Identidade do escritorio + advogado responsavel — usado pra assinar a
   * mensagem com o nome correto do tenant (multi-tenant safe). Fallback
   * pra valores genericos se OrganizationProfile/Tenant.name nao tiverem.
   */
  escritorio?: {
    nome: string;
    advogado_nome: string;
  };
  data_hora_atual: string; dia_semana: string;
}

@Injectable()
export class FollowupService {
  private readonly logger = new Logger(FollowupService.name);
  private _openai: OpenAI | null = null;

  private get openai(): OpenAI {
    if (!this._openai) {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error('OPENAI_API_KEY não configurada. Configure a variável de ambiente para usar o Follow-up IA.');
      this._openai = new OpenAI({ apiKey });
    }
    return this._openai;
  }

  constructor(
    private prisma: PrismaService,
    @InjectQueue('followup-jobs') private followupQueue: Queue,
  ) {}

  // ─── CRUD Sequências ─────────────────────────────────────────────────────

  async listSequences(tenantId?: string) {
    return this.prisma.followupSequence.findMany({
      where: tenantId ? { tenant_id: tenantId } : {},
      include: { steps: { orderBy: { position: 'asc' } }, _count: { select: { enrollments: true } } },
      orderBy: { created_at: 'desc' },
    });
  }

  async createSequence(data: {
    name: string; description?: string; category?: string;
    auto_enroll_stages?: string[]; max_attempts?: number; tenant_id?: string;
    steps?: Array<{ position: number; delay_hours: number; channel: string; tone: string; objective: string; custom_prompt?: string; auto_send?: boolean }>;
  }) {
    const { steps, ...seqData } = data;
    return this.prisma.followupSequence.create({
      data: {
        ...seqData,
        tenant_id: tenantOrDefault(seqData.tenant_id),
        steps: steps ? { create: steps } : undefined,
      },
      include: { steps: { orderBy: { position: 'asc' } } },
    });
  }

  async updateSequence(id: string, data: Partial<{
    name: string; description: string; category: string; active: boolean;
    auto_enroll_stages: string[]; max_attempts: number;
  }>) {
    return this.prisma.followupSequence.update({ where: { id }, data,
      include: { steps: { orderBy: { position: 'asc' } } },
    });
  }

  async deleteSequence(id: string) {
    // Cancelar enrollments ativos antes de deletar
    await this.prisma.followupEnrollment.updateMany({
      where: { sequence_id: id, status: { in: ['ATIVO', 'PAUSADO'] } },
      data: { status: 'CANCELADO' },
    });
    await this.prisma.followupSequence.delete({ where: { id } });
    return { ok: true };
  }

  async addStep(sequenceId: string, data: {
    position: number; delay_hours: number; channel: string; tone: string;
    objective: string; custom_prompt?: string; auto_send?: boolean;
  }) {
    return this.prisma.followupStep.create({ data: { sequence_id: sequenceId, ...data } });
  }

  async updateStep(stepId: string, data: Partial<{
    position: number; delay_hours: number; channel: string; tone: string;
    objective: string; custom_prompt: string; auto_send: boolean;
  }>) {
    return this.prisma.followupStep.update({ where: { id: stepId }, data });
  }

  async deleteStep(stepId: string) {
    await this.prisma.followupStep.delete({ where: { id: stepId } });
    return { ok: true };
  }

  // ─── Fila de Followup (leads aptos a receber) ──────────────────────────

  /**
   * Retorna lista unificada de leads aptos a receber followup:
   *
   * 1. ENROLLMENTS: leads em sequencias customizadas com status='ATIVO'
   *    — mostra step atual, ultima mensagem, next_send_at.
   *
   * 2. LEGACY: leads em stages {AGUARDANDO_DOCS, AGUARDANDO_PROC, AGUARDANDO_FORM,
   *    QUALIFICANDO}, com is_client=false, inativos ha N dias (usando os mesmos
   *    cutoffs do legacyStageFollowup), sem enrollment ativo.
   *
   * Ambos retornam formato unificado — frontend renderiza em uma unica tabela.
   */
  /**
   * Lista a fila unificada.
   * @param tenantId Filtro de tenant (opcional).
   * @param minDays Sobrescreve o cutoff de inatividade (em dias) pra todos os
   *   stages do legacy. Se undefined/null: usa defaults por stage (3/3/2/5).
   *   Se 0: mostra todos os leads dos 4 stages elegíveis sem exigir inatividade.
   */
  async getQueue(tenantId?: string, minDays?: number | null) {
    const enrollmentItems = await this.getQueueFromEnrollments(tenantId);
    const legacyItems = await this.getQueueFromLegacy(tenantId, minDays);

    return {
      total: enrollmentItems.length + legacyItems.length,
      enrollment_count: enrollmentItems.length,
      legacy_count: legacyItems.length,
      min_days_applied: minDays ?? null,
      items: [...enrollmentItems, ...legacyItems].sort((a, b) => {
        // Ordenar: primeiro os que tem next_send_at mais proximo/passado
        const aNext = a.next_scheduled_at?.getTime() ?? Infinity;
        const bNext = b.next_scheduled_at?.getTime() ?? Infinity;
        return aNext - bNext;
      }),
    };
  }

  private async getQueueFromEnrollments(tenantId?: string) {
    const enrollments = await this.prisma.followupEnrollment.findMany({
      where: {
        status: 'ATIVO',
        ...(tenantId && { lead: { tenant_id: tenantId } }),
      },
      include: {
        lead: { select: { id: true, name: true, phone: true, stage: true, is_client: true, updated_at: true } },
        sequence: { include: { steps: { select: { id: true, position: true } } } },
        messages: {
          where: { status: { in: ['ENVIADO', 'APROVADO'] } },
          orderBy: { created_at: 'desc' },
          take: 1,
          select: { sent_text: true, generated_text: true, sent_at: true, created_at: true, status: true },
        },
      },
      orderBy: { next_send_at: 'asc' },
    });

    return enrollments
      .filter((e: any) => !e.lead.is_client) // clientes nao aparecem na fila
      .map((e: any) => {
        const lastMsg = e.messages[0];
        const totalSteps = e.sequence?.steps?.length || 0;
        const daysInactive = e.lead.updated_at
          ? Math.floor((Date.now() - new Date(e.lead.updated_at).getTime()) / 86400000)
          : 0;
        return {
          lead_id: e.lead.id,
          lead_name: e.lead.name,
          lead_phone: e.lead.phone,
          lead_stage: e.lead.stage,
          source: 'enrollment' as const,
          enrollment_id: e.id,
          sequence_name: e.sequence?.name || null,
          current_step: e.current_step,
          total_steps: totalSteps,
          last_followup: lastMsg
            ? {
                text: lastMsg.sent_text || lastMsg.generated_text,
                sent_at: lastMsg.sent_at || lastMsg.created_at,
                status: lastMsg.status,
              }
            : null,
          next_scheduled_at: e.next_send_at,
          days_inactive: daysInactive,
        };
      });
  }

  private async getQueueFromLegacy(tenantId?: string, minDays?: number | null) {
    // Cutoffs default por stage (mesmos do FollowupCronService.legacyStageFollowup).
    // Se minDays for passado (>=0), sobrescreve todos com esse valor.
    const DEFAULT_CONFIGS: Array<{ stage: string; days: number }> = [
      { stage: 'AGUARDANDO_DOCS', days: 3 },
      { stage: 'AGUARDANDO_PROC', days: 3 },
      { stage: 'AGUARDANDO_FORM', days: 2 },
      { stage: 'QUALIFICANDO', days: 5 },
    ];
    const STALE_CONFIGS = minDays != null && minDays >= 0
      ? DEFAULT_CONFIGS.map(c => ({ stage: c.stage, days: minDays }))
      : DEFAULT_CONFIGS;

    const items: any[] = [];
    for (const config of STALE_CONFIGS) {
      // Se days === 0, nao filtra por updated_at (mostra todos do stage).
      const updatedAtFilter = config.days > 0
        ? { updated_at: { lt: new Date(Date.now() - config.days * 86400000) } }
        : {};
      const leads: any[] = await (this.prisma as any).lead.findMany({
        where: {
          stage: config.stage,
          ...updatedAtFilter,
          is_client: false,
          followup_enrollments: { none: { status: 'ATIVO' } },
          ...(tenantId && { tenant_id: tenantId }),
        },
        include: {
          conversations: {
            where: { status: 'ABERTO' },
            take: 1,
            orderBy: { last_message_at: 'desc' },
            include: {
              messages: {
                where: { direction: 'out' },
                orderBy: { created_at: 'desc' },
                take: 1,
                select: { text: true, created_at: true },
              },
            },
          },
        },
      });

      for (const lead of leads) {
        if (!lead.conversations?.length) continue;
        const convo = lead.conversations[0];
        const lastOut = convo.messages?.[0];
        const daysInactive = lead.updated_at
          ? Math.floor((Date.now() - new Date(lead.updated_at).getTime()) / 86400000)
          : 0;
        items.push({
          lead_id: lead.id,
          lead_name: lead.name,
          lead_phone: lead.phone,
          lead_stage: lead.stage,
          source: 'legacy' as const,
          enrollment_id: null,
          sequence_name: null,
          current_step: null,
          total_steps: null,
          last_followup: lastOut
            ? {
                text: lastOut.text,
                sent_at: lastOut.created_at,
                status: 'ENVIADO',
              }
            : null,
          // Legacy nao tem next_send_at — proximo cron sera 9h do proximo dia util.
          next_scheduled_at: this.nextLegacyCronTime(),
          days_inactive: daysInactive,
        });
      }
    }
    return items;
  }

  /** Calcula o proximo horario das 9h em dia util (seg-sex) em America/Maceio. */
  private nextLegacyCronTime(): Date {
    const now = new Date();
    const maceio = new Date(now.getTime() - 3 * 3600000); // aprox UTC-3
    const hour = maceio.getUTCHours();
    const day = maceio.getUTCDay();

    // Se ja passou das 9h hoje ou e fim de semana, avanca
    let next = new Date(now);
    if (day === 0 || day === 6 || hour >= 9) {
      next.setUTCDate(next.getUTCDate() + 1);
    }
    // Pular fim de semana
    let nextDay = next.getUTCDay();
    while (nextDay === 0 || nextDay === 6) {
      next.setUTCDate(next.getUTCDate() + 1);
      nextDay = next.getUTCDay();
    }
    // Setar 12h UTC = 9h BRT
    next.setUTCHours(12, 0, 0, 0);
    return next;
  }

  /**
   * Dispara followup manual pra um lead — antes do cron agendado.
   * Funciona tanto pra enrollments (enfileira 'process-step') quanto pra
   * legacy (enfileira 'manual-legacy-followup' que o worker processa igual
   * ao cron mas pra um lead so).
   */
  async triggerManualFollowup(leadId: string, tenantId?: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, tenant_id: true, is_client: true, stage: true },
    });
    if (!lead) throw new NotFoundException('Lead nao encontrado');
    if (tenantId && lead.tenant_id && lead.tenant_id !== tenantId) {
      throw new BadRequestException('Lead de outro tenant');
    }
    if (lead.is_client) {
      throw new BadRequestException('Followup nao aplicavel — lead ja e cliente contratado');
    }

    // Se tem enrollment ativo, enfileira process-step pra rodar IMEDIATAMENTE
    const enrollment = await this.prisma.followupEnrollment.findFirst({
      where: { lead_id: leadId, status: 'ATIVO' },
      select: { id: true },
    });

    if (enrollment) {
      // Atualiza next_send_at pra agora e enfileira
      await this.prisma.followupEnrollment.update({
        where: { id: enrollment.id },
        data: { next_send_at: new Date() },
      });
      await this.followupQueue.add(
        'process-step',
        { enrollment_id: enrollment.id },
        { jobId: `manual-${enrollment.id}-${Date.now()}`, removeOnComplete: true, attempts: 2 },
      );
      return { ok: true, source: 'enrollment', enrollment_id: enrollment.id };
    }

    // Sem enrollment — trata como legacy. Enfileira job customizado pro worker.
    await this.followupQueue.add(
      'manual-legacy-followup',
      { lead_id: leadId, stage: lead.stage },
      { jobId: `manual-legacy-${leadId}-${Date.now()}`, removeOnComplete: true, attempts: 2 },
    );
    return { ok: true, source: 'legacy', lead_id: leadId };
  }

  // ─── Enrollments ─────────────────────────────────────────────────────────

  async listEnrollments(filters: { status?: string; sequence_id?: string; lead_id?: string } = {}) {
    return this.prisma.followupEnrollment.findMany({
      where: {
        ...(filters.status && { status: filters.status }),
        ...(filters.sequence_id && { sequence_id: filters.sequence_id }),
        ...(filters.lead_id && { lead_id: filters.lead_id }),
      },
      include: {
        lead: { select: { id: true, name: true, phone: true, stage: true } },
        sequence: { select: { id: true, name: true, category: true } },
        messages: { orderBy: { created_at: 'desc' }, take: 1 },
      },
      orderBy: { next_send_at: 'asc' },
    });
  }

  async enrollLead(leadId: string, sequenceId: string) {
    const [lead, sequence] = await Promise.all([
      this.prisma.lead.findUnique({ where: { id: leadId } }),
      this.prisma.followupSequence.findUnique({ where: { id: sequenceId }, include: { steps: { orderBy: { position: 'asc' }, take: 1 } } }),
    ]);
    if (!lead) throw new NotFoundException('Lead não encontrado');
    if (!sequence) throw new NotFoundException('Sequência não encontrada');
    if (!sequence.active) throw new BadRequestException('Sequência inativa');

    // Verificar se já existe enrollment concluído — não re-enrolar automaticamente
    const existing = await this.prisma.followupEnrollment.findUnique({
      where: { lead_id_sequence_id: { lead_id: leadId, sequence_id: sequenceId } },
    });
    if (existing && existing.status === 'CONCLUIDO') {
      throw new BadRequestException('Lead já concluiu esta sequência. Cancele antes de re-enrolar.');
    }

    const firstStep = sequence.steps[0];
    const nextSendAt = firstStep ? new Date(Date.now() + firstStep.delay_hours * 3600 * 1000) : null;

    const enrollment = await this.prisma.followupEnrollment.upsert({
      where: { lead_id_sequence_id: { lead_id: leadId, sequence_id: sequenceId } },
      create: { lead_id: leadId, sequence_id: sequenceId, next_send_at: nextSendAt, status: 'ATIVO' },
      update: { status: 'ATIVO', current_step: 1, next_send_at: nextSendAt, paused_reason: null },
    });

    if (nextSendAt && firstStep) {
      const delay = Math.max(0, nextSendAt.getTime() - Date.now());
      await this.followupQueue.add('process-step', { enrollment_id: enrollment.id }, { delay, jobId: `enroll-${enrollment.id}-step-1`, removeOnComplete: true });
    }

    return enrollment;
  }

  async pauseEnrollment(enrollmentId: string, reason?: string) {
    return this.prisma.followupEnrollment.update({
      where: { id: enrollmentId },
      data: { status: 'PAUSADO', paused_reason: reason },
    });
  }

  async resumeEnrollment(enrollmentId: string) {
    const enrollment = await this.prisma.followupEnrollment.findUnique({
      where: { id: enrollmentId },
      include: { sequence: { include: { steps: { orderBy: { position: 'asc' } } } } },
    });
    if (!enrollment) throw new NotFoundException('Enrollment não encontrado');
    if (enrollment.status !== 'PAUSADO') throw new BadRequestException('Enrollment não está pausado');

    const currentStep = enrollment.sequence.steps.find(s => s.position === enrollment.current_step);
    const nextSendAt = currentStep ? new Date(Date.now() + currentStep.delay_hours * 3600 * 1000) : new Date(Date.now() + 3600000);

    const updated = await this.prisma.followupEnrollment.update({
      where: { id: enrollmentId },
      data: { status: 'ATIVO', paused_reason: null, next_send_at: nextSendAt },
    });

    await this.followupQueue.add('process-step', { enrollment_id: enrollmentId }, {
      delay: Math.max(0, nextSendAt.getTime() - Date.now()),
      jobId: `resume-${enrollmentId}-${Date.now()}`,
      removeOnComplete: true,
    });

    return updated;
  }

  async cancelEnrollment(enrollmentId: string) {
    return this.prisma.followupEnrollment.update({
      where: { id: enrollmentId },
      data: { status: 'CANCELADO' },
    });
  }

  async markConverted(enrollmentId: string) {
    return this.prisma.followupEnrollment.update({
      where: { id: enrollmentId },
      data: { status: 'CONVERTIDO' },
    });
  }

  // ─── Fila de Aprovação ───────────────────────────────────────────────────

  async listPendingApprovals(tenantId?: string) {
    return this.prisma.followupMessage.findMany({
      where: {
        status: 'PENDENTE_APROVACAO',
        ...(tenantId && { enrollment: { lead: { tenant_id: tenantId } } }),
      },
      include: {
        enrollment: {
          include: {
            lead: { select: { id: true, name: true, phone: true, stage: true } },
            sequence: { select: { id: true, name: true } },
            messages: { orderBy: { created_at: 'desc' }, take: 5, select: { id: true, generated_text: true, sent_text: true, status: true, created_at: true, channel: true } },
          },
        },
        step: { select: { position: true, channel: true, tone: true, objective: true } },
      },
      orderBy: { created_at: 'asc' },
    });
  }

  async approveMessage(messageId: string, approvedBy: string, editedText?: string) {
    const msg = await this.prisma.followupMessage.update({
      where: { id: messageId },
      data: {
        status: 'APROVADO',
        approved_by: approvedBy,
        approved_at: new Date(),
        sent_text: editedText || undefined,
      },
    });
    // Enfileira envio imediato
    await this.followupQueue.add('send-message', { message_id: messageId }, { jobId: `send-${messageId}`, removeOnComplete: true });
    return msg;
  }

  async rejectMessage(messageId: string, approvedBy: string) {
    return this.prisma.followupMessage.update({
      where: { id: messageId },
      data: { status: 'REJEITADO', approved_by: approvedBy, approved_at: new Date() },
    });
  }

  async regenerateMessage(messageId: string) {
    const msg = await this.prisma.followupMessage.findUnique({
      where: { id: messageId },
      include: {
        enrollment: { include: { lead: true, sequence: true } },
        step: true,
      },
    });
    if (!msg) throw new NotFoundException('Mensagem não encontrada');

    const dossie = await this.buildDossie(msg.enrollment, msg.step, msg.enrollment.lead);
    const newText = await this.generateMessage(dossie, msg.step.custom_prompt);

    return this.prisma.followupMessage.update({
      where: { id: messageId },
      data: { generated_text: newText, context_json: dossie as any, status: 'PENDENTE_APROVACAO' },
    });
  }

  // ─── Context Assembler ───────────────────────────────────────────────────

  async buildDossie(enrollment: any, step: any, lead: any): Promise<DossieCompleto> {
    // Identidade do escritorio + advogado responsavel — multi-tenant safe.
    // Estrategia em ordem de prioridade:
    //   1. OrganizationProfile.facts.office_info.name (se admin populou)
    //   2. Tenant.name (sempre existe pra tenant valido)
    //   3. fallback generico
    // Pro advogado: lead.cs_user (gerente do lead) → lead.assigned_lawyer →
    //   primeiro user ADMIN do tenant → fallback generico.
    let escritorioNome: string | null = null;
    let advogadoNome: string | null = null;
    if (lead.tenant_id) {
      const [tenant, orgProfile, csUser] = await Promise.all([
        this.prisma.tenant.findUnique({
          where: { id: lead.tenant_id },
          select: { name: true },
        }),
        this.prisma.organizationProfile.findUnique({
          where: { tenant_id: lead.tenant_id },
          select: { facts: true },
        }),
        lead.cs_user_id
          ? this.prisma.user.findUnique({
              where: { id: lead.cs_user_id },
              select: { name: true },
            })
          : null,
      ]);
      const facts = (orgProfile?.facts as any) || {};
      escritorioNome = facts?.office_info?.name || tenant?.name || null;
      advogadoNome = csUser?.name || facts?.office_info?.lawyer_name || null;
    }

    // Conversa ativa
    const convo = await this.prisma.conversation.findFirst({
      where: { lead_id: lead.id, status: 'ABERTO' },
      orderBy: { last_message_at: 'desc' },
    });

    // Últimas mensagens
    const ultimasMsgs = convo ? await this.prisma.message.findMany({
      where: { conversation_id: convo.id, type: { not: 'note' } },
      orderBy: { created_at: 'desc' }, take: 10,
      select: { direction: true, text: true, created_at: true },
    }) : [];

    const diasSemContato = convo?.last_message_at
      ? Math.floor((Date.now() - convo.last_message_at.getTime()) / 86400000) : 999;

    // Processos
    const casos = await this.prisma.legalCase.findMany({
      where: { lead_id: lead.id },
      select: { case_number: true, action_type: true, stage: true, legal_area: true },
      take: 5,
    });

    // Mensagens anteriores desta sequência (para não repetir)
    const msgsAnteriores = await this.prisma.followupMessage.findMany({
      where: { enrollment_id: enrollment.id, status: { in: ['ENVIADO', 'APROVADO'] } },
      select: { sent_text: true, generated_text: true },
      orderBy: { created_at: 'desc' }, take: 5,
    });

    const hoje = new Date();
    const diasSemana = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];

    return {
      pessoa: {
        id: lead.id, nome: lead.name || 'Cliente', telefone: lead.phone,
        email: lead.email, tipo: casos.length > 0 ? 'cliente' : 'lead',
        estagio: lead.stage, canal_preferido: 'whatsapp',
        dias_sem_contato: diasSemContato, inadimplente: false, origin: lead.origin,
      },
      historico: {
        total_msgs: ultimasMsgs.length,
        ultima_msg_resumo: ultimasMsgs[0]?.text?.substring(0, 200) || 'Sem mensagens anteriores',
        ultima_msg_direcao: ultimasMsgs[0]?.direction || 'N/A',
        dias_sem_resposta: diasSemContato,
        sentimento: diasSemContato > 14 ? 'frio' : diasSemContato > 7 ? 'morno' : 'ativo',
        ultimas_msgs: ultimasMsgs.reverse().map(m => ({
          direcao: m.direction, text: m.text?.substring(0, 300) || '', created_at: m.created_at.toISOString(),
        })),
      },
      processual: casos.length > 0 ? {
        processos: casos.map(c => ({
          numero: c.case_number || 'Sem número', tipo: c.action_type || 'Geral',
          area: c.legal_area || 'Geral', status: c.stage || 'Em andamento',
        })),
      } : undefined,
      tarefa: {
        sequencia_nome: enrollment.sequence?.name || 'Follow-up',
        step_position: step.position, total_steps: enrollment.sequence?.steps?.length || step.position,
        tentativa_numero: enrollment.current_step,
        objetivo: step.objective, tom: step.tone, canal: step.channel,
        mensagens_anteriores: msgsAnteriores.map(m => m.sent_text || m.generated_text),
      },
      data_hora_atual: hoje.toLocaleString('pt-BR', { timeZone: 'America/Maceio' }),
      dia_semana: diasSemana[hoje.getDay()],
      escritorio: (escritorioNome || advogadoNome) ? {
        nome: escritorioNome || 'o escritório',
        advogado_nome: advogadoNome || 'sua equipe juridica',
      } : undefined,
    };
  }

  // ─── Message Generator ───────────────────────────────────────────────────

  async generateMessage(dossie: DossieCompleto, customPrompt?: string | null): Promise<string> {
    // Multi-tenant safe: usa identidade do escritorio do tenant do lead.
    // Fallback pra valor generico ("o escritorio" / "sua equipe") se nao
    // houver OrganizationProfile/Tenant.name. Antes era hardcoded "Lustosa
    // Advogados" / "Andre Lustosa" — quebrava em deploys multi-tenant.
    const escritorioNome = dossie.escritorio?.nome || 'o escritório';
    const advogadoNome = dossie.escritorio?.advogado_nome || 'sua equipe jurídica';

    const systemPrompt = `Você é ${advogadoNome}, advogado do escritório ${escritorioNome}.
Está escrevendo uma mensagem de follow-up via ${dossie.tarefa.canal} para ${dossie.pessoa.nome}.

REGRAS ABSOLUTAS:
1. Nunca revele que é IA ou que a mensagem foi gerada automaticamente
2. Use o nome da pessoa naturalmente (não repita a cada frase)
3. Nunca invente fatos sobre processos — use APENAS as informações fornecidas
4. NÃO faça promessas sobre resultados de processos
5. NÃO mencione valores de honorários (a menos que seja cobrança explícita)
6. WhatsApp: máx 250 palavras, direto ao ponto, termine com pergunta aberta
7. Email: assunto na primeira linha como "ASSUNTO: ...", corpo mais elaborado
8. NUNCA copie mensagens anteriores — sempre uma abordagem diferente
9. Tom obrigatório: ${dossie.tarefa.tom}
10. Sem frases genéricas: "venho por meio desta", "nesta oportunidade", "sem mais para o momento"

CONTEXTO COMPLETO:
${JSON.stringify(dossie, null, 2)}

OBJETIVO DESTE FOLLOW-UP:
${dossie.tarefa.objetivo}

MENSAGENS ANTERIORES (NÃO REPITA):
${dossie.tarefa.mensagens_anteriores.length > 0 ? dossie.tarefa.mensagens_anteriores.join('\n---\n') : 'Nenhuma mensagem anterior nesta sequência.'}

${customPrompt ? `INSTRUÇÃO ADICIONAL:\n${customPrompt}` : ''}

Gere APENAS o texto da mensagem, sem introduções ou explicações.`;

    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [{ role: 'system', content: systemPrompt }],
      max_tokens: 600,
      temperature: 0.85,
    });

    return completion.choices[0]?.message?.content?.trim() || 'Olá! Gostaríamos de dar continuidade ao seu atendimento. Podemos conversar?';
  }

  // ─── Risk Classifier ─────────────────────────────────────────────────────

  classifyRisk(dossie: DossieCompleto, step: any): 'baixo' | 'medio' | 'alto' {
    let score = 0;
    if (dossie.historico.sentimento === 'frio' && dossie.tarefa.tentativa_numero > 3) score += 2;
    if (dossie.financeiro?.inadimplente && dossie.tarefa.tentativa_numero >= 3) score += 2;
    if (dossie.tarefa.tom === 'firme' && dossie.tarefa.tentativa_numero >= 2) score += 2;
    if (dossie.pessoa.tipo === 'cliente' && dossie.historico.dias_sem_resposta > 30) score += 1;
    if (score >= 4) return 'alto';
    if (score >= 2) return 'medio';
    return 'baixo';
  }

  // ─── Stats ───────────────────────────────────────────────────────────────

  async getStats(tenantId?: string) {
    const tenantFilter = tenantId ? { lead: { tenant_id: tenantId } } : {};
    const msgTenantFilter = tenantId ? { enrollment: { lead: { tenant_id: tenantId } } } : {};
    const [total, ativos, pendentes, enviados, convertidos, legacy] = await Promise.all([
      this.prisma.followupEnrollment.count({ where: tenantFilter }),
      this.prisma.followupEnrollment.count({ where: { status: 'ATIVO', ...tenantFilter } }),
      this.prisma.followupMessage.count({ where: { status: 'PENDENTE_APROVACAO', ...msgTenantFilter } }),
      this.prisma.followupMessage.count({ where: { status: 'ENVIADO', ...msgTenantFilter } }),
      this.prisma.followupEnrollment.count({ where: { status: 'CONVERTIDO', ...tenantFilter } }),
      this.getLegacyStats(tenantId),
    ]);
    const taxaConversao = total > 0 ? Math.round((convertidos / total) * 1000) / 10 : 0;
    return {
      total_enrollments: total,
      ativos,
      pendentes_aprovacao: pendentes,
      total_enviados: enviados,
      convertidos,
      taxa_conversao: taxaConversao,
      legacy,
    };
  }

  /**
   * Metricas do cron legacy + disparo manual.
   *
   * O cron das 9h (seg-sex) e o botao "Disparar agora" da Fila usam a IA
   * (FollowupAnalyzerService) mas NAO criam FollowupMessage — mandam direto
   * via Evolution API e registram um Message com prefix conhecido no
   * external_message_id:
   *   - out_followup_ia_*       : cron legacy (FollowupCronService)
   *   - sys_followup_ia_*       : enrollment path (FollowupProcessor.sendMessageDirect)
   *   - out_followup_manual_*   : disparo manual pela Fila (processManualLegacy)
   *
   * Por isso o getStats "oficial" (FollowupMessage) mostra zero quando so o
   * legacy ta rodando. Aqui contamos as Message direto.
   */
  private async getLegacyStats(tenantId?: string) {
    const now = Date.now();
    const h24 = new Date(now - 24 * 3600000);
    const d7 = new Date(now - 7 * 86400000);
    const d30 = new Date(now - 30 * 86400000);

    // Filtro base: Message out com prefix de followup + (tenant opcional via Conversation.Lead)
    const baseWhere: any = {
      direction: 'out',
      OR: [
        { external_message_id: { startsWith: 'out_followup_ia_' } },
        { external_message_id: { startsWith: 'sys_followup_ia_' } },
        { external_message_id: { startsWith: 'out_followup_manual_' } },
      ],
      ...(tenantId && { conversation: { lead: { tenant_id: tenantId } } }),
    };

    const [enviados24h, enviados7d, enviados30d, enviadosTotal, ultimoEnvio, arquivados7d, arquivados30d] = await Promise.all([
      this.prisma.message.count({ where: { ...baseWhere, created_at: { gte: h24 } } }),
      this.prisma.message.count({ where: { ...baseWhere, created_at: { gte: d7 } } }),
      this.prisma.message.count({ where: { ...baseWhere, created_at: { gte: d30 } } }),
      this.prisma.message.count({ where: baseWhere }),
      this.prisma.message.findFirst({
        where: baseWhere,
        orderBy: { created_at: 'desc' },
        select: { created_at: true },
      }),
      // Arquivados pela IA: leads que viraram PERDIDO com last_followup_at recente
      // (heuristica — o cron/processor setam last_followup_at ao arquivar).
      this.prisma.lead.count({
        where: {
          stage: 'PERDIDO',
          last_followup_at: { gte: d7 },
          ...(tenantId && { tenant_id: tenantId }),
        },
      }),
      this.prisma.lead.count({
        where: {
          stage: 'PERDIDO',
          last_followup_at: { gte: d30 },
          ...(tenantId && { tenant_id: tenantId }),
        },
      }),
    ]);

    return {
      enviados_24h: enviados24h,
      enviados_7d: enviados7d,
      enviados_30d: enviados30d,
      enviados_total: enviadosTotal,
      arquivados_ia_7d: arquivados7d,
      arquivados_ia_30d: arquivados30d,
      ultimo_envio_at: ultimoEnvio?.created_at ?? null,
      proximo_cron_at: this.nextLegacyCronTime(),
    };
  }

  // ─── Disparos em Massa (Broadcasts) ─────────────────────────────────────

  async previewBroadcast(type: string, daysAhead: number, tenantId?: string) {
    // COMUNICADO: busca todos os clientes com processo ativo (não depende de CalendarEvent)
    if (type === 'COMUNICADO') {
      const cases = await this.prisma.legalCase.findMany({
        where: {
          archived: false,
          lead: {
            phone: { not: '' },
            is_client: true,
            ...(tenantId ? { tenant_id: tenantId } : {}),
          },
        },
        include: {
          lead: { select: { id: true, name: true, phone: true, stage: true } },
        },
        orderBy: { created_at: 'desc' },
      });

      // Deduplica por lead_id (um lead pode ter vários processos)
      const seen = new Set<string>();
      return cases
        .filter(c => { if (seen.has(c.lead_id)) return false; seen.add(c.lead_id); return true; })
        .map(c => ({
          event_id: null,
          event_title: null,
          event_date: null,
          event_location: null,
          lead_id: c.lead!.id,
          lead_name: c.lead!.name,
          lead_phone: c.lead!.phone,
          lead_stage: c.lead!.stage,
          case_number: c.case_number,
          case_type: c.action_type,
          court: c.court,
        }));
    }

    // Tipos com CalendarEvent (AUDIENCIA, PERICIA, PRAZO)
    const now = new Date();
    const until = new Date(Date.now() + daysAhead * 86400000);

    const events = await this.prisma.calendarEvent.findMany({
      where: {
        type: type,
        start_at: { gte: now, lte: until },
        status: { in: ['AGENDADO', 'CONFIRMADO'] },
        lead_id: { not: null },
        lead: { phone: { not: '' }, ...(tenantId ? { tenant_id: tenantId } : {}) },
      },
      include: {
        lead: { select: { id: true, name: true, phone: true, stage: true } },
        legal_case: { select: { id: true, case_number: true, action_type: true, court: true, opposing_party: true } },
      },
      orderBy: { start_at: 'asc' },
    });

    return events.map(e => ({
      event_id: e.id,
      event_title: e.title,
      event_date: e.start_at,
      event_location: e.location,
      lead_id: e.lead!.id,
      lead_name: e.lead!.name,
      lead_phone: e.lead!.phone,
      lead_stage: e.lead!.stage,
      case_number: e.legal_case?.case_number,
      case_type: e.legal_case?.action_type,
      court: e.legal_case?.court,
    }));
  }

  async createBroadcast(data: { type: string; days_ahead: number; interval_ms: number; custom_prompt?: string }, userId: string, tenantId?: string) {
    const targets = await this.previewBroadcast(data.type, data.days_ahead, tenantId);
    if (targets.length === 0) throw new BadRequestException('Nenhum alvo encontrado para este disparo');

    // Deduplicate by lead_id (same lead may have multiple events)
    const uniqueTargets = targets.filter((t, i, arr) => arr.findIndex(x => x.lead_id === t.lead_id) === i);

    const typeLabels: Record<string, string> = { AUDIENCIA: 'Audiências', PERICIA: 'Perícias', PRAZO: 'Prazos', COMUNICADO: 'Comunicados' };
    const today = new Date().toLocaleDateString('pt-BR');
    const name = `Lembrete ${typeLabels[data.type] || data.type} — ${today}`;

    const broadcast = await this.prisma.broadcastJob.create({
      data: {
        name,
        type: data.type,
        tenant_id: tenantOrDefault(tenantId),
        created_by_id: userId,
        total_targets: uniqueTargets.length,
        interval_ms: Math.max(5000, Math.min(3600000, data.interval_ms)),
        custom_prompt: data.custom_prompt,
        filter_json: { type: data.type, days_ahead: data.days_ahead },
        status: 'ENVIANDO',
        started_at: new Date(),
        items: {
          create: uniqueTargets.map(t => ({
            lead_id: t.lead_id,
            ...(t.event_id ? { event_id: t.event_id } : {}),
            phone: t.lead_phone,
          })),
        },
      },
      include: { items: true },
    });

    // Enqueue each item with staggered delay
    for (let i = 0; i < broadcast.items.length; i++) {
      const item = broadcast.items[i];
      const delay = i * broadcast.interval_ms;
      await this.followupQueue.add('broadcast-send', {
        broadcast_id: broadcast.id,
        item_id: item.id,
        custom_prompt: data.custom_prompt,
      }, {
        delay,
        jobId: `broadcast-${broadcast.id}-${item.id}`,
        removeOnComplete: true,
      });
    }

    this.logger.log(`[BROADCAST] Criado "${name}" com ${broadcast.items.length} alvos, intervalo ${broadcast.interval_ms}ms`);
    return broadcast;
  }

  async listBroadcasts(tenantId?: string) {
    return this.prisma.broadcastJob.findMany({
      where: tenantId ? { tenant_id: tenantId } : {},
      include: { created_by: { select: { name: true } }, _count: { select: { items: true } } },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
  }

  async getBroadcast(id: string) {
    const broadcast = await this.prisma.broadcastJob.findUnique({
      where: { id },
      include: {
        items: {
          orderBy: { created_at: 'asc' },
          include: { lead: { select: { name: true } } },
        },
        created_by: { select: { name: true } },
      },
    });
    if (!broadcast) throw new NotFoundException('Disparo não encontrado');
    return broadcast;
  }

  async cancelBroadcast(id: string) {
    const broadcast = await this.prisma.broadcastJob.findUnique({ where: { id } });
    if (!broadcast) throw new NotFoundException('Disparo não encontrado');
    if (broadcast.status !== 'ENVIANDO') throw new BadRequestException('Disparo não está em andamento');

    // Cancel pending items
    await this.prisma.broadcastItem.updateMany({
      where: { broadcast_id: id, status: 'PENDENTE' },
      data: { status: 'PULADO' },
    });

    return this.prisma.broadcastJob.update({
      where: { id },
      data: { status: 'CANCELADO', completed_at: new Date() },
    });
  }

  // ─── Auto-enroll por stage ───────────────────────────────────────────────

  async autoEnrollByStage(leadId: string, stage: string) {
    const sequences = await this.prisma.followupSequence.findMany({
      where: { active: true, auto_enroll_stages: { has: stage } },
    });
    for (const seq of sequences) {
      try {
        await this.enrollLead(leadId, seq.id);
        this.logger.log(`[FOLLOWUP] Auto-enroll lead ${leadId} → sequência "${seq.name}" (stage: ${stage})`);
      } catch { /* já enrolled ou outro erro — ignorar */ }
    }
  }

  // ─── Análise de Resposta (Response Listener) — usada pelo API diretamente ─

  async analyzeResponse(text: string, dossie: any): Promise<{
    sentimento: string; intencao: string; urgencia: string;
    requer_humano: boolean; resumo: string; proxima_acao: string;
  }> {
    const prompt = `Analise esta resposta de um lead/cliente jurídico e retorne JSON.

RESPOSTA DO LEAD: "${text}"

CONTEXTO: Lead "${dossie.pessoa?.nome}" no estágio "${dossie.pessoa?.estagio}".

Retorne APENAS este JSON (sem markdown):
{
  "sentimento": "positivo|neutro|negativo",
  "intencao": "quer_contratar|pedindo_informacao|negociando|recusando|pedindo_prazo|insatisfeito|pedindo_atualizacao|confirmando|incerto",
  "urgencia": "alta|media|baixa",
  "requer_humano": true|false,
  "resumo": "Uma frase resumindo a resposta",
  "proxima_acao": "O que fazer a seguir"
}

Considere requer_humano=true se:
- Menciona trocar de advogado ou insatisfação grave
- Assunto sensível (luto, separação, prisão de familiar)
- Negociação de valores ou acordos
- Reclamação de serviço`;

    try {
      const r = await this.openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300, temperature: 0.3,
        response_format: { type: 'json_object' },
      });
      const json = JSON.parse(r.choices[0]?.message?.content || '{}');
      return {
        sentimento: json.sentimento || 'neutro',
        intencao: json.intencao || 'incerto',
        urgencia: json.urgencia || 'media',
        requer_humano: json.requer_humano || false,
        resumo: json.resumo || 'Sem resumo',
        proxima_acao: json.proxima_acao || 'Aguardar próximo passo',
      };
    } catch {
      return { sentimento: 'neutro', intencao: 'incerto', urgencia: 'media', requer_humano: false, resumo: 'Sem análise', proxima_acao: 'Revisar manualmente' };
    }
  }

  // ─── Seed de Sequências Padrão ───────────────────────────────────────────

  async seedDefaultSequences() {
    type StepDef = {
      position: number; delay_hours: number; channel: string;
      tone: string; objective: string; auto_send: boolean; custom_prompt?: string;
    };
    type SeqDef = {
      name: string; description: string; category: string;
      auto_enroll_stages: string[]; max_attempts: number; steps: StepDef[];
    };
    const sequences: SeqDef[] = [
      {
        name: 'Novo Lead — Captação',
        description: 'Sequência padrão para novos leads que ainda não contrataram',
        category: 'LEADS',
        auto_enroll_stages: ['QUALIFICANDO'],
        max_attempts: 9,
        steps: [
          { position: 1, delay_hours: 0, channel: 'whatsapp', tone: 'amigavel', objective: 'Apresentar o escritório e entender a necessidade do lead', auto_send: true },
          { position: 2, delay_hours: 2, channel: 'whatsapp', tone: 'amigavel', objective: 'Complemento com informação útil sobre o tipo de caso', auto_send: true },
          { position: 3, delay_hours: 48, channel: 'whatsapp', tone: 'profissional', objective: 'Abordagem diferente, oferecer consulta gratuita', auto_send: true },
          { position: 4, delay_hours: 96, channel: 'whatsapp', tone: 'empatico', objective: 'Demonstrar empatia com a situação do lead', auto_send: false },
          { position: 5, delay_hours: 168, channel: 'email', tone: 'profissional', objective: 'Email elaborado com credenciais do escritório e casos de sucesso', auto_send: false },
          { position: 6, delay_hours: 336, channel: 'whatsapp', tone: 'amigavel', objective: 'Última tentativa direta — perguntar se ainda tem interesse', auto_send: false },
          { position: 7, delay_hours: 720, channel: 'email', tone: 'amigavel', objective: 'Nurturing: conteúdo informativo relevante para o tipo de caso', auto_send: true },
          { position: 8, delay_hours: 1440, channel: 'email', tone: 'amigavel', objective: 'Nurturing: mudança de lei ou prazo prescricional relevante', auto_send: true },
          { position: 9, delay_hours: 2160, channel: 'whatsapp', tone: 'amigavel', objective: 'Reengajamento gentil após 3 meses', auto_send: false },
        ],
      },
      {
        name: 'Pós-Consulta — Não Contratou',
        description: 'Para leads que fizeram consulta mas ainda não fecharam',
        category: 'LEADS',
        auto_enroll_stages: ['QUALIFICANDO'],
        max_attempts: 6,
        steps: [
          { position: 1, delay_hours: 24, channel: 'whatsapp', tone: 'amigavel', objective: 'Agradecer pela consulta e manter o contato aberto', auto_send: true },
          { position: 2, delay_hours: 72, channel: 'email', tone: 'profissional', objective: 'Resumo do que foi discutido e próximos passos sugeridos', auto_send: false },
          { position: 3, delay_hours: 168, channel: 'whatsapp', tone: 'amigavel', objective: 'Verificar se conseguiu pensar sobre o que foi discutido', auto_send: false },
          { position: 4, delay_hours: 336, channel: 'whatsapp', tone: 'empatico', objective: 'Verificar objeções e oferecer soluções', auto_send: false },
          { position: 5, delay_hours: 720, channel: 'email', tone: 'profissional', objective: 'Caso relevante semelhante ou mudança de cenário favorável', auto_send: false },
          { position: 6, delay_hours: 1440, channel: 'whatsapp', tone: 'amigavel', objective: 'Reengajamento após 2 meses', auto_send: false },
        ],
      },
      {
        name: 'Cliente Ativo — Manutenção',
        description: 'Manutenção de relacionamento com clientes com processos ativos',
        category: 'CLIENTS',
        auto_enroll_stages: ['FINALIZADO'],
        max_attempts: 4,
        steps: [
          { position: 1, delay_hours: 360, channel: 'whatsapp', tone: 'profissional', objective: 'Atualização quinzenal do andamento processual em linguagem simples', auto_send: false },
          { position: 2, delay_hours: 360, channel: 'whatsapp', tone: 'profissional', objective: 'Segunda atualização — informar próximos passos', auto_send: false },
          { position: 3, delay_hours: 360, channel: 'whatsapp', tone: 'empatico', objective: 'Verificar se cliente tem dúvidas ou preocupações', auto_send: false },
          { position: 4, delay_hours: 360, channel: 'whatsapp', tone: 'amigavel', objective: 'Check-in de relacionamento — manter cliente informado', auto_send: false },
        ],
      },
      {
        name: 'Cobrança de Honorários',
        description: 'Sequência de cobrança de honorários em atraso — escalada gradual',
        category: 'COBRANCA',
        auto_enroll_stages: [] as string[],
        max_attempts: 5,
        steps: [
          { position: 1, delay_hours: 24, channel: 'whatsapp', tone: 'amigavel', objective: 'Lembrete amigável de pagamento com dados de PIX', auto_send: true, custom_prompt: undefined as string | undefined },
          { position: 2, delay_hours: 120, channel: 'whatsapp', tone: 'profissional', objective: 'Segundo lembrete, oferecer parcelamento como alternativa', auto_send: false, custom_prompt: undefined as string | undefined },
          { position: 3, delay_hours: 240, channel: 'email', tone: 'profissional', objective: 'Notificação formal por email, mencionar prazo para regularizar', auto_send: false, custom_prompt: undefined as string | undefined },
          { position: 4, delay_hours: 360, channel: 'email', tone: 'firme', objective: 'Aviso de possível suspensão de trabalhos por inadimplência', auto_send: false, custom_prompt: undefined as string | undefined },
          { position: 5, delay_hours: 1080, channel: 'whatsapp', tone: 'firme', objective: 'Última tentativa antes de medidas administrativas', auto_send: false, custom_prompt: 'Esta é a última mensagem antes de encaminhar para providências administrativas. Seja firme mas profissional. Mencione que o prazo para regularização está se esgotando.' },
        ],
      },
    ];

    const created: string[] = [];
    for (const seq of sequences) {
      const existing = await this.prisma.followupSequence.findFirst({ where: { name: seq.name } });
      if (!existing) {
        const { steps, ...seqData } = seq;
        const createdSeq = await this.prisma.followupSequence.create({
          data: {
            ...seqData,
            // Sequencias seed sao globais — antes ficavam com tenant_id NULL.
            // Apos NOT NULL, vinculadas ao tenant default. Multi-tenant futuro
            // precisa de seed por tenant ou flag is_global em outro mecanismo.
            tenant_id: DEFAULT_TENANT_ID,
            steps: {
              create: steps.map(({ custom_prompt, ...rest }) => ({
                ...rest,
                ...(custom_prompt ? { custom_prompt } : {}),
              })),
            },
          },
          include: { steps: true },
        });
        created.push(createdSeq.name);
      }
    }

    return { created, message: `${created.length} sequência(s) padrão criada(s)` };
  }
}
