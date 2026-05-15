import { Injectable, NotFoundException, BadRequestException, ForbiddenException, ConflictException, Inject, forwardRef, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { CalendarService } from '../calendar/calendar.service';
import { SettingsService } from '../settings/settings.service';
import { TrafegoEventsService } from '../trafego/trafego-events.service';
import { EsajTjalScraper } from '../court-scraper/scrapers/esaj-tjal.scraper';
import { LEGAL_STAGES, TRACKING_STAGES } from './legal-stages';
import { phoneVariants, toCanonicalBrPhone } from '../common/utils/phone';
import { tenantOrDefault } from '../common/constants/tenant';
import { BusinessDaysCalc } from '@crm/shared';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { buildTokenParam } from '../common/utils/openai-token-param.util';

const CASE_WELCOME_DELAY_MS = 5 * 60 * 1000; // 5 minutos

/** Formata 20 dígitos no padrão CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO */
function formatCnj(digits: string): string {
  const d = (digits || '').replace(/\D/g, '');
  if (d.length !== 20) return digits;
  return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16, 20)}`;
}

@Injectable()
export class LegalCasesService {
  private readonly logger = new Logger(LegalCasesService.name);

  constructor(
    private prisma: PrismaService,
    private chatGateway: ChatGateway,
    @Inject(forwardRef(() => WhatsappService)) private whatsappService: WhatsappService,
    private calendarService: CalendarService,
    private settings: SettingsService,
    private trafegoEvents: TrafegoEventsService,
    @InjectQueue('followup-jobs') private followupQueue: Queue,
  ) {}

  private async scheduleCaseWelcomeMessage(caseId: string) {
    try {
      await this.followupQueue.add(
        'case-welcome-message',
        { case_id: caseId },
        {
          delay: CASE_WELCOME_DELAY_MS,
          jobId: `case-welcome-${caseId}`,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
      this.logger.log(`[CASE-WELCOME] Agendado para processo ${caseId} (+5min)`);
    } catch (e: any) {
      this.logger.warn(`[CASE-WELCOME] Falha ao agendar para ${caseId}: ${e.message}`);
    }
  }

  private tenantWhere(tenantId?: string) {
    return tenantId ? { tenant_id: tenantId } : {};
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
    /** Descricao do novo assunto — prepende nas notes do caso */
    subject?: string;
    /** URGENTE | NORMAL | BAIXA (default NORMAL) */
    priority?: string;
  }) {
    // Pré-preencher com dados do LeadProfile (sistema novo).
    //
    // Atualizado em 2026-04-20 (fase 2d-1): antes lia AiMemory.facts_json.
    // LeadProfile.facts tem cases[] mas NAO tem opposing_party — advogado
    // preenche manualmente se precisar.
    let opposing_party: string | null = null;
    let notes: string | null = null;
    let resolvedArea = data.legal_area || null;

    try {
      const profile = await this.prisma.leadProfile.findUnique({
        where: { lead_id: data.lead_id },
        select: { summary: true, facts: true },
      });
      if (profile) {
        const facts: any = profile.facts || {};
        const caseData = facts.cases?.[0] || {};
        if (!resolvedArea && caseData.type) resolvedArea = caseData.type;
        if (profile.summary) notes = profile.summary.slice(0, 500);
      }
    } catch (e: any) {
      this.logger.warn(`[LEGAL] Falha ao pré-preencher caso com LeadProfile: ${e.message}`);
    }

    // Se subject foi passado pelo frontend (botao "Novo caso" do ClientPanel),
    // prepende no notes pra ficar visivel pro advogado ao abrir o workspace.
    if (data.subject && data.subject.trim()) {
      const header = [
        '== Novo caso aberto pelo advogado ==',
        `Descricao: ${data.subject.trim()}`,
        `Aberto em: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Maceio' })}`,
      ].join('\n');
      notes = notes ? `${header}\n\n--- Perfil do cliente ---\n${notes}` : header;
    }

    // Normalizar prioridade (default NORMAL)
    const validPriorities = ['URGENTE', 'NORMAL', 'BAIXA'];
    const priority = data.priority && validPriorities.includes(data.priority.toUpperCase())
      ? data.priority.toUpperCase()
      : 'NORMAL';

    const legalCase = await this.prisma.legalCase.create({
      data: {
        lead_id: data.lead_id,
        conversation_id: data.conversation_id,
        lawyer_id: data.lawyer_id,
        legal_area: resolvedArea,
        tenant_id: tenantOrDefault(data.tenant_id),
        stage: 'VIABILIDADE',
        priority,
        opposing_party,
        notes,
      },
      include: { lead: true },
    });

    // Converter lead em cliente ao criar processo
    await this.prisma.lead.update({
      where: { id: data.lead_id },
      data: {
        is_client: true,
        became_client_at: new Date(),
        stage: 'FINALIZADO',
        stage_entered_at: new Date(),
      },
    }).catch(() => {});

    // Trafego: dispara OCI upload pra evento 'client.signed'.
    // Silencioso (errors logados, nunca propagados).
    if (data.tenant_id) {
      this.trafegoEvents
        .onClientSigned(data.lead_id, data.tenant_id)
        .catch((err) =>
          this.logger.warn(`[trafego-events] onClientSigned lead=${data.lead_id}: ${err}`),
        );
    }

    // Atribuir advogado nas conversas do lead
    await this.prisma.conversation.updateMany({
      where: { lead_id: data.lead_id, assigned_lawyer_id: null },
      data: { assigned_lawyer_id: data.lawyer_id },
    }).catch(() => {});

    // Promover honorários negociados do lead → CaseHonorario
    await this.promoteLeadHonorarios(data.lead_id, legalCase.id, data.tenant_id).catch(e =>
      this.logger.warn(`[LEGAL] Falha ao promover honorários negociados: ${e.message}`),
    );

    // Vincular publicações DJEN existentes com o mesmo número de processo
    await this.reconcileDjenPublications(legalCase.id, (legalCase as any).case_number);

    // Agendar comunicado de boas-vindas / alerta golpe (+5min)
    await this.scheduleCaseWelcomeMessage(legalCase.id);

    return legalCase;
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
          status: true,
          start_at: true,
          title: true,
          location: true,
          completion_note: true,
          completed_at: true,
          completed_by: { select: { id: true, name: true } },
        },
      },
      // Resumo financeiro para badge no kanban
      honorarios: {
        where: { status: 'ATIVO' },
        select: {
          total_value: true,
          type: true,
          payments: {
            select: { amount: true, status: true },
          },
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
        // Lawyer incluido pro frontend pre-popular o select de advogado
        // responsavel no ProcessoDetailPanel (state: lawyerSelectId usa
        // legalCase.lawyer?.id). Sem isso, o select mostrava "Selecionar
        // advogado..." mesmo com o campo preenchido no banco.
        // Bug reportado 2026-04-24.
        lawyer: { select: { id: true, name: true } },
        conversation: {
          select: {
            id: true,
            instance_name: true,
            status: true,
            legal_area: true,
            // Atendente responsavel herdado da conversation — permite o
            // frontend mostrar quem esta atendendo o cliente.
            assigned_user_id: true,
            assigned_user: { select: { id: true, name: true } },
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
        // Apenas leads FINALIZADOS (convertidos em cliente) que ainda não têm caso aberto
        lead: {
          stage: 'FINALIZADO',
          is_client: true,
          ...(existingLeadIds.length > 0
            ? { id: { notIn: existingLeadIds } }
            : {}),
        },
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

  async updateStage(
    id: string,
    newStage: string,
    userId: string,
    tenantId?: string,
    // Opts adicionados 2026-05-13 pra fluxo novo da Triagem: ao arrastar
    // card pra PROTOCOLO, o frontend envia caseNumber + clientIsAuthor
    // junto com o stage e o backend ja agenda enriquecimento +24h. Sem
    // os opts, comportamento eh igual ao anterior (so muda stage) —
    // mantem compat pra outras transicoes e edicoes manuais.
    opts?: { caseNumber?: string; clientIsAuthor?: boolean },
  ) {
    await this.verifyTenantOwnership(id, tenantId);
    const validStage = LEGAL_STAGES.find(s => s.id === newStage);
    if (!validStage) throw new BadRequestException(`Stage inválido: ${newStage}`);

    // Montagem do data — campos extras so quando newStage === PROTOCOLO E
    // operador informou caseNumber. Em qualquer outro caminho, fica como antes.
    const data: any = { stage: newStage, stage_changed_at: new Date() };
    if (newStage === 'PROTOCOLO' && opts?.caseNumber?.trim()) {
      data.case_number = opts.caseNumber.trim();
      data.filed_at = new Date();
      if (typeof opts.clientIsAuthor === 'boolean') {
        data.client_is_author = opts.clientIsAuthor;
      }
      // O delay de 24h comeca no momento que o card entra em PROTOCOLO —
      // protocolo recem-feito precisa desse tempo pro tribunal indexar.
      data.enrichment_status = 'PENDING';
      data.enrichment_scheduled_for = new Date(Date.now() + 24 * 60 * 60 * 1000);
      data.enrichment_attempts = 0;
      data.enrichment_error = null;
    }

    const updated = await this.prisma.legalCase.update({
      where: { id },
      data,
      include: { lead: { select: { name: true, id: true } } },
    });

    // Auto-criar tarefa para o novo estágio
    this.createStageTask(updated.id, newStage, updated.lawyer_id, updated.tenant_id, updated.lead?.id).catch(e =>
      this.logger.warn(`[LEGAL] Falha ao criar tarefa automática para ${newStage}: ${e.message}`),
    );

    try {
      this.chatGateway.emitLegalCaseUpdate(updated.lawyer_id, {
        caseId: id,
        action: 'stage_changed',
        stage: newStage,
      });
    } catch {}

    return updated;
  }

  // ─── AUTO-TASK POR ESTÁGIO ─────────────────────────────────────

  private static readonly STAGE_TASKS: Record<string, { title: string; description: string; dueDays: number; priority: string }> = {
    DOCUMENTACAO: {
      title: 'Coletar documentos do caso',
      description: 'Solicitar e reunir todos os documentos necessários para o caso (contratos, comprovantes, laudos, fotos, etc).',
      dueDays: 5,
      priority: 'NORMAL',
    },
    PETICAO: {
      title: 'Redigir petição inicial',
      description: 'Elaborar a petição inicial com base nos fatos e documentos coletados.',
      dueDays: 10,
      priority: 'NORMAL',
    },
    REVISAO: {
      title: 'Revisar petição antes de protocolar',
      description: 'Revisar a petição inicial: verificar fundamentação, pedidos, provas e formatação.',
      dueDays: 3,
      priority: 'URGENTE',
    },
    PROTOCOLO: {
      title: 'Protocolar processo no tribunal',
      description: 'Protocolar a petição inicial no sistema do tribunal e obter o número do processo.',
      dueDays: 2,
      priority: 'URGENTE',
    },
  };

  private async createStageTask(caseId: string, stage: string, lawyerId: string, tenantId: string | null, leadId?: string | null): Promise<void> {
    const taskDef = LegalCasesService.STAGE_TASKS[stage];
    if (!taskDef) return; // VIABILIDADE ou estágio sem tarefa

    // Deduplica: não criar se já existe tarefa idêntica nos últimos 7 dias
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const existing = await this.prisma.calendarEvent.findFirst({
      where: {
        legal_case_id: caseId,
        title: taskDef.title,
        created_at: { gte: sevenDaysAgo },
      },
      select: { id: true },
    });
    if (existing) return;

    // Calcular data de vencimento (dias úteis) — usa BusinessDaysCalc
    // do @crm/shared que considera feriados nacionais + recesso CPC
    // art. 220 + custom holidays do tenant. Bug fix 2026-05-08.
    const customHolidays = tenantId
      ? await this.prisma.holiday.findMany({
          where: { tenant_id: tenantId },
          select: { date: true, recurring_yearly: true },
        })
      : [];
    const calc = new BusinessDaysCalc({ holidays: customHolidays });
    const dueAt = calc.addBusinessDays(new Date(), taskDef.dueDays);

    await this.calendarService.create({
      type: 'TAREFA',
      title: taskDef.title,
      description: taskDef.description,
      start_at: dueAt.toISOString(),
      end_at: new Date(dueAt.getTime() + 30 * 60000).toISOString(),
      priority: taskDef.priority,
      legal_case_id: caseId,
      assigned_user_id: lawyerId,
      created_by_id: lawyerId,
      lead_id: leadId || undefined,
      tenant_id: tenantId || undefined,
    });

    this.logger.log(`[LEGAL] Tarefa automática criada: "${taskDef.title}" para caso ${caseId} (prazo: ${taskDef.dueDays} dias úteis)`);
  }

  // addBusinessDays REMOVIDO em 2026-05-08 — substituido por
  // BusinessDaysCalc do @crm/shared que considera feriados nacionais,
  // moveis (Carnaval, Corpus Christi), recesso CPC art. 220 e holidays
  // customizados do tenant. A antiga so pulava sabado/domingo.

  // ─── CONCLUIR TAREFAS DO ESTÁGIO ──────────────────────────────

  /** Marca todas as tarefas pendentes de um caso como CONCLUIDO */
  async completeStageTasks(caseId: string, tenantId?: string): Promise<number> {
    await this.verifyTenantOwnership(caseId, tenantId);
    const result = await this.prisma.calendarEvent.updateMany({
      where: {
        legal_case_id: caseId,
        type: 'TAREFA',
        status: { in: ['AGENDADO', 'CONFIRMADO'] },
      },
      data: { status: 'CONCLUIDO' },
    });
    this.logger.log(`[LEGAL] ${result.count} tarefa(s) concluída(s) para caso ${caseId}`);
    return result.count;
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
        // Dados do caso pra IA contextualizar mensagem de arquivamento (2026-05-15)
        lawyer: { select: { name: true } },
      },
    });

    if (notifyLead && legalCase.lead?.phone) {
      // Bug fix 2026-05-15 (Andre): mensagem hardcoded dizia "nao eh possivel
      // prosseguir" mesmo quando o processo era ENCERRADO com sucesso (motivo
      // "Processo Finalizado") — soava como negativa ao cliente. Agora a IA
      // gera mensagem personalizada conforme o motivo + dados do caso.
      const msg = await this.generateArchiveMessage(legalCase as any, reason);
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

    // Sync da memoria IA ao arquivar caso REMOVIDO em 2026-04-20 (fase 2d-1).
    // O campo LegalCase.archived = true ja e suficiente — ProfileConsolidationProcessor
    // filtra por `where: { archived: false }` ao incluir casos no LeadProfile.

    return legalCase;
  }

  /**
   * Gera mensagem personalizada de arquivamento via IA (2026-05-15).
   *
   * Antes: texto hardcoded "nao eh possivel prosseguir" — incorreto pra
   * processos ENCERRADOS com sucesso (acordo, sentenca favoravel, alvara).
   *
   * Agora: IA recebe o motivo + dados do processo (numero, classe, area,
   * parte contraria) e gera mensagem com tom apropriado:
   *   - Encerramento POSITIVO ("Acordo cumprido", "Sentenca favoravel",
   *     "Processo Finalizado", "Alvara liberado") -> agradecimento +
   *     convite pra seguir o escritorio
   *   - Encerramento NEGATIVO/NEUTRO ("Sem viabilidade", "Cliente desistiu",
   *     "Inadimplencia") -> mensagem formal de encerramento
   *
   * Sempre inclui:
   *   - Site: andrelustosaadvogados.com.br
   *   - Instagram: @andrelustosaadvogados
   *
   * Fallback: se IA falhar, usa texto generico mas profissional.
   */
  private async generateArchiveMessage(legalCase: any, reason: string): Promise<string> {
    const leadName = (legalCase.lead?.name || 'cliente').split(' ')[0];
    const advogado = legalCase.lawyer?.name || 'André Lustosa';
    const escritorio = 'Lustosa Advogados';

    const dadosProcesso = [
      legalCase.case_number ? `- Numero: ${legalCase.case_number}` : null,
      legalCase.action_type ? `- Tipo: ${legalCase.action_type}` : null,
      legalCase.legal_area ? `- Area: ${legalCase.legal_area}` : null,
      legalCase.opposing_party ? `- Parte contraria: ${legalCase.opposing_party}` : null,
      legalCase.tracking_stage ? `- Ultima etapa: ${legalCase.tracking_stage}` : null,
    ].filter(Boolean).join('\n');

    const systemPrompt = `Voce eh ${advogado}, advogado do escritorio ${escritorio}.
Esta enviando uma mensagem de WhatsApp ao cliente ${legalCase.lead?.name || 'cliente'} comunicando que o processo dele(a) foi ENCERRADO/ARQUIVADO no sistema do escritorio.

REGRAS ABSOLUTAS:
1. NUNCA revele que eh IA ou mensagem automatica
2. Tom profissional, caloroso e humano — entre 100-180 palavras
3. Comece com saudacao curta personalizada (ex: "Ola, ${leadName}!" ou "Prezado(a) ${leadName},")
4. Explique brevemente que o caso foi finalizado conforme o MOTIVO informado
5. Adapte o tom AO MOTIVO:
   - Se eh ENCERRAMENTO POSITIVO (palavras-chave: "acordo", "sentenca favoravel",
     "ganho", "vitoria", "alvara", "finalizado", "concluido", "transitado",
     "cumprido", "exito", "procedente") -> tom de AGRADECIMENTO + comemoracao
     pelo bom resultado + "foi um prazer atender"
   - Se eh ENCERRAMENTO NEGATIVO ("sem viabilidade", "improcedente", "perdemos")
     -> tom de respeito, gratidao pela confianca + se coloca a disposicao
     pra futuras demandas
   - Se eh ENCERRAMENTO NEUTRO ("desistencia", "renuncia", "inadimplencia",
     "sem retorno") -> tom formal mas cordial
6. SEMPRE incluir no final:
   - Site: www.andrelustosaadvogados.com.br
   - Instagram: @andrelustosaadvogados
7. NAO use frases burocraticas ("venho por meio desta", "informamos que apos
   analise de viabilidade juridica")
8. NAO invente fatos do processo que nao estejam nos DADOS abaixo
9. Use *negrito* (com asteriscos do WhatsApp) somente em 1-2 destaques

DADOS DO PROCESSO:
${dadosProcesso || '- (sem dados especificos disponiveis)'}

MOTIVO DO ENCERRAMENTO INFORMADO PELO ADVOGADO:
"${reason}"

Gere APENAS o texto da mensagem, sem introducoes ou explicacoes.`;

    try {
      const aiConfig = await this.settings.getAiConfig();
      const model = aiConfig.defaultModel || 'gpt-4.1-mini';
      const openaiKey = (await this.settings.get('OPENAI_API_KEY')) || process.env.OPENAI_API_KEY;
      if (!openaiKey) {
        this.logger.warn('[ARCHIVE-MSG] Sem OPENAI_API_KEY — usando fallback');
        return this.fallbackArchiveMessage(legalCase, reason);
      }
      const openai = new OpenAI({ apiKey: openaiKey });
      const completion = await openai.chat.completions.create({
        model,
        messages: [{ role: 'system', content: systemPrompt }],
        ...buildTokenParam(model, 600),
        temperature: 0.85,
      });
      const text = completion.choices[0]?.message?.content?.trim();
      return text || this.fallbackArchiveMessage(legalCase, reason);
    } catch (e: any) {
      this.logger.warn(`[ARCHIVE-MSG] IA indisponivel, usando fallback: ${e.message}`);
      return this.fallbackArchiveMessage(legalCase, reason);
    }
  }

  /** Fallback inteligente: detecta tom positivo/negativo via regex no motivo. */
  private fallbackArchiveMessage(legalCase: any, reason: string): string {
    const leadName = (legalCase.lead?.name || 'cliente').split(' ')[0];
    const isPositive = /acordo|sentenca favoravel|ganho|vit[oó]ria|alvar[aá]|finaliza|conclu[ií]|transitado|cumprido|[eê]xito|procedente/i.test(reason);

    if (isPositive) {
      return `Olá, ${leadName}! Tudo bem?\n\nGostaria de comunicar que o seu processo foi *concluído* com sucesso. Foi um prazer poder atendê-lo(a) e contar com a sua confiança ao longo dessa jornada.\n\nNosso escritório segue à disposição para qualquer demanda futura. Se possível, nos siga nas redes:\n\n🌐 www.andrelustosaadvogados.com.br\n📷 Instagram: @andrelustosaadvogados\n\nUm forte abraço!`;
    }

    return `Prezado(a) ${leadName},\n\nInformo que o seu processo foi encerrado em nosso sistema. Motivo: ${reason}.\n\nAgradecemos a confiança depositada em nosso escritório. Permanecemos à disposição para futuras demandas ou qualquer esclarecimento.\n\n🌐 www.andrelustosaadvogados.com.br\n📷 Instagram: @andrelustosaadvogados\n\nAtenciosamente,\nLustosa Advogados`;
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

  // ─── RENOUNCE (renúncia — advogado não atua mais) ──────────

  async renounce(id: string, tenantId?: string) {
    await this.verifyTenantOwnership(id, tenantId);
    const legalCase = await this.prisma.legalCase.update({
      where: { id },
      data: { renounced: true, renounced_at: new Date() },
    });

    // Auto-arquivar publicações DJEN existentes desse caso
    const archived = await this.prisma.djenPublication.updateMany({
      where: { legal_case_id: id, archived: false },
      data: { archived: true, viewed_at: new Date() },
    });

    this.logger.log(`[RENOUNCE] Caso ${id} marcado como renunciado — ${archived.count} publicação(ões) arquivada(s)`);
    return legalCase;
  }

  async unrenounce(id: string, tenantId?: string) {
    await this.verifyTenantOwnership(id, tenantId);
    return this.prisma.legalCase.update({
      where: { id },
      data: { renounced: false, renounced_at: null },
    });
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
    /**
     * Quando true (default), o CalendarEvent criado automaticamente pra
     * audiencias/pericias dispara notificacao imediata ao cliente
     * (1 min apos criacao). Quando false, evento eh criado em modo
     * "interno" — sem WhatsApp pro cliente.
     *
     * Bug fix 2026-05-08: antes nao havia controle. Admin que criava
     * audiencia via UI legalCase nao percebia que cliente recebia WA
     * 1 min depois.
     */
    notify_client?: boolean;
  }, tenantId?: string) {
    await this.verifyTenantOwnership(caseId, tenantId);
    const caseEvent = await this.prisma.caseEvent.create({
      data: {
        case_id: caseId,
        // Bug fix 2026-05-08: passa tenant_id direto pra defesa multi-tenant
        tenant_id: tenantId,
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
          // Bug fix 2026-05-08: notify_client default true mantem comportamento
          // atual (audiencia notifica cliente 1 min depois). UI pode passar
          // false pra criar evento interno sem aviso ao cliente.
          const shouldNotifyClient = data.notify_client !== false;
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
            // Default true; UI pode passar false pra evento interno
            notify_client: shouldNotifyClient,
          } as any);
          this.logger.log(
            `CalendarEvent ${calType} criado automaticamente para caso ${caseId}` +
            (shouldNotifyClient ? ' (cliente sera notificado em 1min)' : ' (modo interno — sem WhatsApp ao cliente)'),
          );
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

  // ─── RE-SYNC DE MOVIMENTACOES VIA SCRAPER TJAL ─────────────────────
  //
  // Faz nova consulta ao TJAL e persiste as movimentacoes atuais como
  // CaseEvent. O scraper retorna TODAS as movimentacoes do processo (le
  // direto do HTML do show.do — sem precisar de AJAX adicional). Idempotente
  // via movement_hash (unique em CaseEvent): movs ja persistidas sao
  // ignoradas pelo createMany skipDuplicates.
  //
  // Supported: TJAL (e-SAJ). Outros tribunais retornam erro explicito.
  async resyncMovementsFromScraper(caseId: string, tenantId?: string) {
    const startedAt = Date.now();
    await this.verifyTenantOwnership(caseId, tenantId);

    const legalCase = await this.prisma.legalCase.findUnique({
      where: { id: caseId },
      select: {
        id: true, case_number: true, court: true, lead_id: true, tenant_id: true,
        // Campos extras pra sincronizacao de metadados vazios
        legal_area: true, action_type: true, judge: true, claim_value: true,
        opposing_party: true, filed_at: true,
      },
    });
    if (!legalCase) throw new NotFoundException('Processo nao encontrado');
    if (!legalCase.case_number) {
      throw new BadRequestException('Processo sem numero cadastrado');
    }

    // Hoje suportamos apenas TJAL (8.02). Para outros tribunais, retornar erro
    // explicito em vez de tentar e falhar silenciosamente.
    const digits = legalCase.case_number.replace(/\D/g, '');
    const tribunalCode = digits.slice(13, 16); // ex: "802" para TJAL
    if (tribunalCode !== '802') {
      throw new BadRequestException(
        `Sincronizacao automatica disponivel apenas para TJAL (codigo 8.02). Este processo e do tribunal ${tribunalCode}.`,
      );
    }

    const scraper = new EsajTjalScraper();
    const data = await scraper.searchByNumber(legalCase.case_number).catch((err: any) => {
      this.logger.warn(`[RESYNC] Erro ao buscar ${legalCase.case_number}: ${err?.message}`);
      throw new BadRequestException(`Falha ao consultar TJAL: ${err?.message || 'erro desconhecido'}`);
    });

    if (!data) {
      throw new NotFoundException(`Processo ${legalCase.case_number} nao encontrado no TJAL`);
    }

    const movements = data.movements || [];
    if (movements.length === 0) {
      // Scraper nao encontrou movimentacoes. Pode ser layout novo — deixa log
      // pra investigacao mas nao e erro (processo pode realmente ter 0 movs).
      this.logger.warn(
        `[RESYNC] Processo ${legalCase.case_number}: scraper retornou 0 movimentacoes. ` +
        `Pode indicar layout nao suportado pelas 4 estrategias de extracao.`,
      );
      return {
        scraped: 0,
        created: 0,
        already_existed: 0,
        total_now: 0,
        source: 'ESAJ_TJAL',
        duration_ms: Date.now() - startedAt,
        warning: 'Scraper nao encontrou movimentacoes — processo pode ter layout novo',
      };
    }

    // Persistir com dedup via movement_hash
    const movementRows = movements.map((m: any) => ({
      case_id: caseId,
      // Bug fix 2026-05-08: tenant_id direto
      tenant_id: legalCase.tenant_id,
      type: 'MOVIMENTACAO',
      source: 'ESAJ',
      title: m.description.slice(0, 120),
      description: m.description,
      event_date: this.parseEsajDateSafe(m.date),
      movement_hash: createHash('sha256')
        .update(`${legalCase.case_number}|${m.date}|${m.description}`)
        .digest('hex'),
      source_raw: {
        raw_date: m.date,
        raw_description: m.description,
        // cd_movimentacao + processo_codigo permitem baixar PDF do TJAL
        // direto pelo portal (botao "Baixar PDF" na movimentacao).
        ...(m.cd_movimentacao ? { cd_movimentacao: m.cd_movimentacao } : {}),
        ...(m.document_type ? { document_type: m.document_type } : {}),
        ...(data.processo_codigo ? { processo_codigo: data.processo_codigo } : {}),
      } as any,
    }));

    const createResult = await this.prisma.caseEvent.createMany({
      data: movementRows,
      skipDuplicates: true,
    });

    // Contar total atual de CaseEvents tipo MOVIMENTACAO para este processo
    const totalNow = await this.prisma.caseEvent.count({
      where: { case_id: caseId, type: 'MOVIMENTACAO' },
    });

    // ── Sincronizar metadados vazios do LegalCase com dados do ESAJ ─────────
    // Preenche APENAS campos null/vazios — nao sobrescreve edicoes manuais.
    // Usecase: processo cadastrado antes dos fixes de persistencia, ou ESAJ
    // nao retornou alguns dados na epoca.
    const metadataPatch: any = {};
    const metadataUpdated: string[] = [];
    if (!legalCase.legal_area && data.legal_area) {
      metadataPatch.legal_area = data.legal_area;
      metadataUpdated.push('Área jurídica');
    }
    if (!legalCase.action_type && data.action_type) {
      metadataPatch.action_type = data.action_type;
      metadataUpdated.push('Tipo de ação');
    }
    if (!legalCase.court && data.court) {
      metadataPatch.court = data.court;
      metadataUpdated.push('Vara/Tribunal');
    }
    if (!legalCase.judge && data.judge) {
      metadataPatch.judge = data.judge;
      metadataUpdated.push('Juiz');
    }
    if (!legalCase.claim_value && data.claim_value) {
      metadataPatch.claim_value = data.claim_value;
      metadataUpdated.push('Valor da causa');
    }
    if (!legalCase.filed_at && data.filed_at) {
      metadataPatch.filed_at = new Date(data.filed_at);
      metadataUpdated.push('Data de ajuizamento');
    }
    // Parte contraria: pega reu dos parties[]
    if (!legalCase.opposing_party && data.parties?.length) {
      const reu = data.parties.find((p: any) =>
        /r[eé]u|requerido|executado|reclamado|denunciado/i.test(p.role),
      );
      if (reu?.name) {
        metadataPatch.opposing_party = reu.name;
        metadataUpdated.push('Parte contrária');
      }
    }

    if (Object.keys(metadataPatch).length > 0) {
      await this.prisma.legalCase.update({
        where: { id: caseId },
        data: metadataPatch,
      });
      this.logger.log(
        `[RESYNC] ${legalCase.case_number}: metadados preenchidos: ${metadataUpdated.join(', ')}`,
      );
    }

    this.logger.log(
      `[RESYNC] ${legalCase.case_number}: ${createResult.count} novas / ${movements.length - createResult.count} ja existiam. Total agora: ${totalNow}`,
    );

    // Re-consolidacao automatica do LeadProfile REMOVIDA em 2026-04-21.
    // Motivo: pivotamos pra arquitetura on-demand — IA agora busca movimentacoes
    // via tool call get_case_movements quando o cliente pergunta. Evita gastar
    // LLM com consolidacao que muitas vezes ninguem vai consultar.

    return {
      scraped: movements.length,
      created: createResult.count,
      already_existed: movements.length - createResult.count,
      total_now: totalNow,
      source: 'ESAJ_TJAL',
      duration_ms: Date.now() - startedAt,
      metadata_updated: metadataUpdated, // novo campo — lista de campos preenchidos
    };
  }

  /** Converte "dd/mm/yyyy" -> Date (UTC 12h). Retorna null se nao parse. */
  private parseEsajDateSafe(dateStr: string): Date | null {
    const m = dateStr?.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!m) return null;
    return new Date(`${m[3]}-${m[2]}-${m[1]}T12:00:00Z`);
  }

  // ─── AUTO-CREATION (hook do FINALIZADO) ─────────────────────────

  async createFromFinalizado(
    leadId: string,
    lawyerId: string,
    conversationId?: string,
    tenantId?: string,
  ) {
    // Transação para evitar race condition (duplicatas se chamado 2x rapidamente)
    return this.prisma.$transaction(async (tx) => {
      // Verifica se já existe um caso para este lead + advogado (dentro da transação)
      const existing = await tx.legalCase.findFirst({
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
        const lead = await tx.lead.findUnique({
          where: { id: leadId },
          select: { name: true },
        });
        this.chatGateway.emitNewLegalCase(lawyerId, {
          caseId: created.id,
          leadName: lead?.name || 'Contato',
        });
      } catch {}

      return created;
    });
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
    // Atendente responsável (operador)
    assigned_user_id?: string;
    // Polo processual do cliente (default true = autor)
    client_is_author?: boolean;
  }) {
    const VALID_TRACKING = TRACKING_STAGES.map(s => s.id) as string[];
    const trackingStage = (
      data.tracking_stage && VALID_TRACKING.includes(data.tracking_stage)
        ? data.tracking_stage
        : 'DISTRIBUIDO'
    ) as string;

    // ─── Checagem de duplicidade por número de processo ─────────────
    // O cadastro em lote via OAB estava criando duplicatas porque não havia
    // verificação prévia. Comparamos por dígitos para tolerar mistura de
    // formatos no banco (mascarado "0707175-85..." vs digits-only).
    const inputDigits = (data.case_number || '').replace(/\D/g, '');
    if (inputDigits.length >= 15) {
      const inputFormatted = formatCnj(inputDigits);
      const existingByCnj = await this.prisma.legalCase.findFirst({
        where: {
          OR: [
            { case_number: data.case_number },
            { case_number: inputDigits },
            { case_number: inputFormatted },
          ],
          ...(data.tenant_id ? { tenant_id: data.tenant_id } : {}),
        },
        select: { id: true, case_number: true, lead: { select: { name: true } } },
      });
      if (existingByCnj) {
        const leadLabel = existingByCnj.lead?.name ? ` (cliente: ${existingByCnj.lead.name})` : '';
        throw new ConflictException(
          `Processo ${existingByCnj.case_number} já está cadastrado${leadLabel}.`,
        );
      }
    }

    const VALID_PRIORITIES = ['URGENTE', 'NORMAL', 'BAIXA'];
    const priority = (
      data.priority && VALID_PRIORITIES.includes(data.priority)
        ? data.priority
        : 'NORMAL'
    ) as string;

    // ─── Validacao de advogado responsavel ──────────────────────
    // Schema tem lawyer_id NOT NULL, mas se ADMIN passar override_lawyer_id
    // com UUID invalido/inexistente, o Prisma lanca P2003 (FK constraint)
    // com mensagem tecnica. Validamos antes pra retornar erro claro.
    const effectiveLawyerId = data.override_lawyer_id || data.lawyer_id;
    if (!effectiveLawyerId) {
      throw new BadRequestException('Advogado responsavel eh obrigatorio pra cadastrar processo.');
    }
    const lawyer = await this.prisma.user.findUnique({
      where: { id: effectiveLawyerId },
      select: { id: true, roles: true, tenant_id: true },
    });
    if (!lawyer) {
      throw new BadRequestException(`Advogado ${effectiveLawyerId} nao encontrado.`);
    }
    const isLawyerRole = Array.isArray(lawyer.roles) &&
      lawyer.roles.some(r => ['ADMIN', 'ADVOGADO', 'Advogados'].includes(r));
    if (!isLawyerRole) {
      throw new BadRequestException('O usuario selecionado nao tem permissao de advogado.');
    }
    if (data.tenant_id && lawyer.tenant_id && lawyer.tenant_id !== data.tenant_id) {
      throw new BadRequestException('Advogado pertence a outra organizacao.');
    }

    // ─── Dedup de case_number ──────────────────────────────────
    // Import ESAJ (court-scraper.service.ts:325) ja validava, mas Cadastro
    // Direto nao — usuario podia cadastrar o mesmo processo 2x sem erro,
    // gerando 2 LegalCases distintos com mesmo case_number. Fix: valida
    // case_number antes de criar.
    const caseNumberDigits = (data.case_number || '').replace(/\D/g, '');
    if (caseNumberDigits.length >= 13) {
      const duplicate = await this.prisma.legalCase.findFirst({
        where: { case_number: { contains: caseNumberDigits.slice(0, 13) } },
        select: { id: true, case_number: true, archived: true },
      });
      if (duplicate) {
        throw new BadRequestException(
          `Processo ${data.case_number} ja cadastrado no sistema${duplicate.archived ? ' (arquivado)' : ''}.`,
        );
      }
    }

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
      // Normaliza pro formato canonico via helper unificado (common/utils/phone.ts).
      // Antes tinha lógica inline divergente das outras partes do sistema.
      const normalizedPhone = toCanonicalBrPhone(data.lead_phone);
      if (!normalizedPhone) {
        throw new BadRequestException(
          `Telefone invalido: "${data.lead_phone}". Informe um celular brasileiro com DDD valido.`,
        );
      }

      // Busca robusta por variantes do telefone (cobre 10/11/12/13 digitos).
      // Antes usava `contains` (preso em 1 formato) — lead em formato
      // diferente nao era encontrado. Bug reportado 2026-04-24:
      // telefone 8296316935 existia como Lead PERDIDO mas o sistema
      // oferecia "Novo cliente" em vez de vincular ao existente.
      const variants = phoneVariants(normalizedPhone);
      // CRITICAL: filtrar por tenant_id — sem isso, o cadastro de processo no
      // tenant A acaba reaproveitando um Lead do tenant B (mesmo telefone),
      // vazando o cliente entre escritorios. Bug 2026-04-29.
      const byPhone = variants.length > 0
        ? await this.prisma.lead.findFirst({
            where: {
              phone: { in: variants },
              ...(data.tenant_id ? { tenant_id: data.tenant_id } : {}),
            },
            select: { id: true, name: true, stage: true, loss_reason: true },
          })
        : null;

      if (byPhone) {
        leadId = byPhone.id;

        const updateData: any = {};
        const nameIsBetter = data.lead_name &&
          (!byPhone.name || byPhone.name.startsWith('[Processo]'));
        if (nameIsBetter) updateData.name = data.lead_name;
        if (data.lead_email) updateData.email = data.lead_email;

        // Log de reativacao — o stage FINALIZADO + is_client=true sao
        // aplicados na secao "Promover lead para cliente" mais abaixo,
        // que transforma qualquer lead (ativo/PERDIDO/etc) em cliente ativo.
        if (byPhone.stage === 'PERDIDO' || byPhone.loss_reason) {
          this.logger.log(
            `[createDirect] Reativando lead ${byPhone.id} (estava ${byPhone.stage}` +
            (byPhone.loss_reason ? `, motivo: ${byPhone.loss_reason}` : '') +
            `) via cadastro de processo`,
          );
        }

        if (Object.keys(updateData).length > 0) {
          await this.prisma.lead.update({
            where: { id: byPhone.id },
            data: updateData,
          });
        }

        leadDisplayName = (nameIsBetter && data.lead_name)
          ? data.lead_name
          : (byPhone.name || normalizedPhone);
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
      throw new BadRequestException('Informe o cliente (lead_id ou telefone) para criar o processo.');
    }

    // Garantir que o lead tenha pelo menos uma conversa (para aparecer no chat)
    const existingConvo = await this.prisma.conversation.findFirst({
      where: { lead_id: leadId },
      select: { id: true },
    });
    let linkedConversationId: string;
    if (existingConvo) {
      linkedConversationId = existingConvo.id;
    } else {
      const newConvo = await this.prisma.conversation.create({
        data: {
          lead_id: leadId,
          tenant_id: tenantOrDefault(data.tenant_id),
          instance_name: process.env.EVOLUTION_INSTANCE_NAME || 'whatsapp',
          status: 'ABERTO',
          last_message_at: new Date(),
        },
        select: { id: true },
      });
      linkedConversationId = newConvo.id;
      this.logger.log(`[LEGAL] Conversa criada para lead ${leadId} (sem WhatsApp prévio)`);
    }

    // effectiveLawyerId foi validado no topo do metodo (existencia + role)
    const legalCase = await this.prisma.legalCase.create({
      data: {
        lead_id: leadId,
        lawyer_id: effectiveLawyerId,
        conversation_id: linkedConversationId,
        tenant_id: tenantOrDefault(data.tenant_id),
        case_number: data.case_number,
        legal_area: data.legal_area,
        action_type: data.action_type,
        opposing_party: data.opposing_party,
        // Polo do cliente: true=autor, false=reu. Default true pro caso
        // comum (cliente autorando a acao). Frontend envia explicitamente
        // baseado no toggle "Escritorio representa: Autor | Reu".
        client_is_author: data.client_is_author ?? true,
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
        // Lawyer incluido pra o frontend pre-popular o select de advogado
        // quando o painel abre automaticamente apos cadastro (fix UX
        // commit 1f92740). Sem isso o campo aparecia vazio.
        lawyer: { select: { id: true, name: true } },
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

    // Atribuir advogado, atendente e área jurídica nas conversas do lead
    const convUpdate: any = {
      assigned_lawyer_id: effectiveLawyerId,
      legal_area: data.legal_area || null,
    };

    // Atendente: usar o informado ou resolver automaticamente
    if (data.assigned_user_id) {
      convUpdate.assigned_user_id = data.assigned_user_id;
    } else {
      // 1ª tentativa: OPERADOR ou COMERCIAL
      // 2ª tentativa: ADVOGADO ou ADMIN (escritórios sem operadores dedicados)
      // 3ª tentativa: usar o próprio advogado responsável pelo processo
      try {
        let candidates = await this.prisma.user.findMany({
          where: {
            roles: { hasSome: ['OPERADOR', 'COMERCIAL'] },
            ...(data.tenant_id ? { tenant_id: data.tenant_id } : {}),
          },
          select: { id: true },
        });
        if (candidates.length === 0) {
          candidates = await this.prisma.user.findMany({
            where: {
              roles: { hasSome: ['ADVOGADO', 'ADMIN'] },
              ...(data.tenant_id ? { tenant_id: data.tenant_id } : {}),
            },
            select: { id: true },
          });
        }
        if (candidates.length > 0) {
          const picked = candidates[Math.floor(Math.random() * candidates.length)];
          convUpdate.assigned_user_id = picked.id;
          this.logger.log(`[LEGAL] Atendente resolvido: ${picked.id} (de ${candidates.length} candidatos)`);
        } else {
          // Fallback final: o próprio advogado do caso
          convUpdate.assigned_user_id = effectiveLawyerId;
          this.logger.log(`[LEGAL] Atendente fallback: advogado ${effectiveLawyerId}`);
        }
      } catch {}
    }

    await this.prisma.conversation.updateMany({
      where: { lead_id: leadId },
      data: convUpdate,
    }).catch(() => {});

    try {
      this.chatGateway.emitNewLegalCase(effectiveLawyerId, {
        caseId: legalCase.id,
        leadName: leadDisplayName,
      });
    } catch {}

    // Vincular publicações DJEN existentes com o mesmo número de processo
    await this.reconcileDjenPublications(legalCase.id, data.case_number);

    // Agendar comunicado de boas-vindas / alerta golpe (+5min)
    await this.scheduleCaseWelcomeMessage(legalCase.id);

    return legalCase;
  }

  // ─── Promover honorários negociados → CaseHonorario ────────────

  private async promoteLeadHonorarios(leadId: string, caseId: string, tenantId?: string) {
    const pending = await this.prisma.leadHonorario.findMany({
      where: { lead_id: leadId, status: { in: ['ACEITO', 'NEGOCIANDO'] } },
      include: { payments: true },
    });

    if (!pending.length) return;

    for (const lh of pending) {
      const totalValue = Number(lh.total_value);

      // Transferir parcelas existentes do LeadHonorario para CaseHonorario
      // Parcelas PENDENTE/ATRASADO viram HonorarioPayment; PAGO ficam no histórico
      const pendingPayments = lh.payments.filter((p: any) => p.status !== 'PAGO');
      const payments = pendingPayments.map((p: any) => ({
        amount: Number(p.amount),
        due_date: p.due_date,
        status: p.status,
        payment_method: p.payment_method,
        notes: p.notes,
      }));

      // Se não há parcelas pendentes, gerar uma parcela única
      if (payments.length === 0) {
        payments.push({ amount: totalValue, due_date: null, status: 'PENDENTE', payment_method: null, notes: null });
      }

      const honorario = await this.prisma.caseHonorario.create({
        data: {
          legal_case_id: caseId,
          tenant_id: tenantId || lh.tenant_id,
          type: lh.type,
          total_value: totalValue,
          success_percentage: lh.success_percentage ? Number(lh.success_percentage) : null,
          installment_count: payments.length,
          contract_date: new Date(),
          notes: lh.notes,
          status: 'ATIVO',
          payments: { create: payments },
        },
      });

      await this.prisma.leadHonorario.update({
        where: { id: lh.id },
        data: { status: 'CONVERTIDO', promoted_to_id: honorario.id },
      });
    }

    this.logger.log(`[LEGAL] ${pending.length} honorário(s) negociado(s) promovido(s) para caso ${caseId}`);
  }

  // ─── Vincular publicações DJEN ao processo recém-criado ─────────

  private async reconcileDjenPublications(caseId: string, caseNumber?: string) {
    if (!caseNumber) return;
    try {
      const digits = caseNumber.replace(/\D/g, '');
      // O banco de djenPublication tem mistura de formatos (alguns DJENs
      // retornam mascarado, outros digits-only). Casamos AMBOS no mesmo
      // updateMany para garantir vinculação independente do formato.
      const orConditions: any[] = [
        { numero_processo: caseNumber },
      ];
      if (digits && digits !== caseNumber) {
        orConditions.push({ numero_processo: digits });
      }
      if (digits.length === 20) {
        const formatted = formatCnj(digits);
        if (formatted !== caseNumber) orConditions.push({ numero_processo: formatted });
      }

      const result = await this.prisma.djenPublication.updateMany({
        where: { legal_case_id: null, OR: orConditions },
        data: { legal_case_id: caseId },
      });

      if (result.count > 0) {
        this.logger.log(`[LEGAL] ${result.count} publicação(ões) DJEN vinculadas ao processo ${caseId}`);
      }
    } catch (e: any) {
      this.logger.warn(`[LEGAL] Falha ao reconciliar DJEN: ${e.message}`);
    }
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
      // Normaliza pro canonico via helper unificado
      const normalizedPhone = toCanonicalBrPhone(data.lead_phone);
      if (!normalizedPhone) {
        throw new BadRequestException(
          `Telefone invalido: "${data.lead_phone}". Informe um celular brasileiro com DDD valido.`,
        );
      }

      // Busca robusta por variantes — filtra por tenant pra nao
      // vincular processo a Lead de outro escritorio (vide bug
      // 2026-04-29 sobre vazamento entre tenants).
      const variants = phoneVariants(normalizedPhone);
      const byPhone = await this.prisma.lead.findFirst({
        where: {
          phone: { in: variants },
          ...(data.tenant_id ? { tenant_id: data.tenant_id } : {}),
        },
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

  // ─── PROTOCOLO → ENRIQUECIMENTO ASYNC → PROCESSOS ──────────────
  //
  // Refatorado 2026-05-13:
  // Antes: PATCH /send-to-tracking exigia caseNumber + court e movia
  //   imediatamente pro menu Processos (in_tracking=true) com info crua.
  //   Resultado: cases chegavam no kanban Processos sem vara, juiz, valor
  //   da causa, partes, classe — operador tinha que preencher tudo manual.
  //
  // Agora: aceita caseNumber + clientIsAuthor. Marca enrichment_status=PENDING
  //   e enrichment_scheduled_for=now+24h. O caso fica na Triagem na etapa
  //   PROTOCOLO ate o cron de enriquecimento rodar, consultar o tribunal
  //   (court-scraper) e preencher os campos. So entao in_tracking flipa
  //   pra true e o caso aparece no menu Processos na etapa derivada dos
  //   movimentos (DISTRIBUIDO/CITACAO/etc).
  //
  // Delay de 24h porque protocolo recem-feito normalmente nao foi indexado
  // pelo tribunal ainda. Court continua opcional pra retro-compat — se
  // operador quiser preencher manual antes de enriquecer, aceita.
  async sendToTracking(
    id: string,
    caseNumber: string,
    court?: string,
    tenantId?: string,
    clientIsAuthor?: boolean,
  ) {
    await this.verifyTenantOwnership(id, tenantId);
    const lc = await this.prisma.legalCase.findUnique({ where: { id } });
    if (!lc) throw new NotFoundException('Caso não encontrado');
    if (lc.archived) throw new BadRequestException('Caso arquivado não pode ser protocolado.');
    if (lc.stage !== 'PROTOCOLO') throw new BadRequestException('Caso deve estar no stage PROTOCOLO para ser protocolado');

    // Janela de 24h pro tribunal indexar o processo recem-protocolado.
    const scheduledFor = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const updated = await this.prisma.legalCase.update({
      where: { id },
      data: {
        case_number: caseNumber,
        court: court ?? lc.court,
        filed_at: lc.filed_at ?? new Date(),
        ...(typeof clientIsAuthor === 'boolean' ? { client_is_author: clientIsAuthor } : {}),
        // Enfileira enriquecimento assincrono. NAO flipa in_tracking ainda.
        enrichment_status: 'PENDING',
        enrichment_scheduled_for: scheduledFor,
        enrichment_attempts: 0,
        enrichment_error: null,
      } as any,
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
      select: { tracking_stage: true, lead_id: true, case_number: true, legal_area: true, in_tracking: true },
    });

    if (!current?.in_tracking) {
      throw new BadRequestException('Este caso ainda não foi enviado para acompanhamento. Use "Enviar para Processos" primeiro.');
    }

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
      // appendCaseStageToMemory REMOVIDO em 2026-04-20 (fase 2d-1). O historico
      // de etapas fica em LegalCase.tracking_stage — consulta direta.
    }

    return result;
  }

  // appendCaseStageToMemory() REMOVIDO em 2026-04-20 (fase 2d-1).

  // ─── WORKSPACE ──────────────────────────────────────────────────

  async getWorkspaceData(id: string, tenantId?: string) {
    await this.verifyTenantOwnership(id, tenantId);

    const legalCase = await this.prisma.legalCase.findUnique({
      where: { id },
      include: {
        lead: {
          include: {
            // `memory` (AiMemory) removido em 2026-04-20 (fase 2d-1).
            // Clientes que precisem do perfil devem consultar LeadProfile separado.
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
      select: { id: true, name: true, roles: true },
    });
    if (!lawyer) throw new BadRequestException('Advogado não encontrado.');
    if (!lawyer.roles?.some((r: string) => ['ADMIN', 'ADVOGADO'].includes(r))) {
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

    // Resolve API key: settings (admin panel) > env var. Alinha com o padrao
    // do resto do sistema (calendar-reminder.worker, followup, etc) — antes
    // esse metodo so lia env var, entao se o admin configurasse via UI a key
    // nao era encontrada e dava erro falso-positivo.
    // Bug reportado 2026-04-23 (Briefing IA do Alecio Diogo retornava erro).
    const aiConfig = await this.settings.getAiConfig();
    const model = aiConfig.defaultModel || 'gpt-4.1-mini';
    const isAnthropic = model.startsWith('claude');

    const legalCase: any = await this.prisma.legalCase.findUnique({
      where: { id },
      include: {
        lead: {
          include: {
            profile: { select: { summary: true } }, // LeadProfile (sistema novo — 2026-04-20)
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
          take: 10, // 2026-04-23: era 3, subiu pra 10 pra cobrir intimacoes
          // recentes ao gerar briefing (usuario reclamou que publicacao
          // de hoje nao aparecia quando havia outras pubs mais antigas
          // empurrando ela pra fora do top-3).
          // Sem filtro de viewed_at/archived — briefing ve TUDO, mesmo
          // publicacoes ja lidas ou arquivadas.
          select: { tipo_comunicacao: true, data_disponibilizacao: true, assunto: true, conteudo: true, viewed_at: true, archived: true },
        },
        documents: {
          take: 5,
          orderBy: { created_at: 'desc' },
          select: { name: true, created_at: true },
        },
        transcriptions: {
          where: { status: 'DONE' },
          orderBy: { created_at: 'desc' },
          take: 3,
          select: {
            title: true,
            created_at: true,
            duration_sec: true,
            text: true,
            speakers_json: true,
          },
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
- Polo do cliente: ${legalCase.client_is_author === false ? 'RÉU (polo passivo — está sendo processado)' : 'AUTOR (polo ativo — é quem move a ação)'}
- Parte contrária: ${legalCase.opposing_party || '—'}
- Juiz/Desembargador: ${legalCase.judge || '—'}
- Valor da causa: ${fmtBRL(legalCase.claim_value)}
- Estágio atual: ${legalCase.stage}
- Acompanhamento processual: ${legalCase.in_tracking ? `Sim (${legalCase.tracking_stage || '—'})` : 'Não'}
- Data de abertura: ${fmtDate(legalCase.created_at)}

PERFIL DO CLIENTE (consolidado automaticamente pela IA):
${legalCase.lead?.profile?.summary || 'Sem perfil consolidado — cliente novo ou sem conversa recente'}

NOTAS INTERNAS:
${legalCase.notes || 'Sem anotações'}

PRAZOS PENDENTES (${legalCase.deadlines?.length || 0}):
${legalCase.deadlines?.map((d: any) => `- ${d.title} | Vence: ${fmtDate(d.due_at)} | Tipo: ${d.type}`).join('\n') || 'Nenhum prazo pendente'}

TAREFAS ABERTAS (${legalCase.tasks?.length || 0}):
${legalCase.tasks?.map((t: any) => `- ${t.title} | Status: ${t.status}${t.due_at ? ` | Prazo: ${fmtDate(t.due_at)}` : ''}`).join('\n') || 'Nenhuma tarefa aberta'}

ÚLTIMAS PUBLICAÇÕES DJEN (${legalCase.djen_publications?.length || 0} mais recentes, incluindo lidas e arquivadas):
${legalCase.djen_publications?.map((d: any) => {
  const tipo = d.tipo_comunicacao || 'Publicação';
  const data = fmtDate(d.data_disponibilizacao);
  const assunto = d.assunto ? ` | ${d.assunto}` : '';
  const flags = [d.viewed_at ? 'lida' : 'não lida', d.archived ? 'arquivada' : null].filter(Boolean).join(', ');
  const snippet = (d.conteudo || '').slice(0, 300).replace(/\s+/g, ' ').trim();
  return `- ${data} | ${tipo}${assunto} [${flags}]${snippet ? `\n    ${snippet}${d.conteudo?.length > 300 ? '…' : ''}` : ''}`;
}).join('\n') || 'Nenhuma publicação'}

DOCUMENTOS RECENTES:
${legalCase.documents?.map((d: any) => `- ${d.name} (${fmtDate(d.created_at)})`).join('\n') || 'Nenhum documento'}

TRANSCRIÇÕES DE AUDIÊNCIAS (${legalCase.transcriptions?.length || 0} mais recentes):
${legalCase.transcriptions?.map((t: any) => {
  const dur = t.duration_sec ? `${Math.round(t.duration_sec / 60)}min` : '—';
  const speakers = Array.isArray(t.speakers_json)
    ? t.speakers_json.map((s: any) => s.label).join(', ')
    : 'sem diarização';
  const text = (t.text || '').replace(/\s+/g, ' ').trim();
  // Limita pra não explodir contexto — IA vê o suficiente pra entender o caso.
  const MAX_CHARS = 2500;
  const excerpt = text.length > MAX_CHARS
    ? `${text.slice(0, MAX_CHARS)}… [transcrição truncada — ${text.length} chars no total]`
    : text;
  return `### ${t.title} (${fmtDate(t.created_at)}) — ${dur}, falantes: ${speakers}\n${excerpt || '[transcrição vazia]'}`;
}).join('\n\n') || 'Nenhuma transcrição de audiência'}

FICHA TRABALHISTA: ${legalCase.lead?.ficha_trabalhista ? `${legalCase.lead.ficha_trabalhista.completion_pct}% preenchida${legalCase.lead.ficha_trabalhista.finalizado ? ' (finalizada)' : ''}` : 'Não aplicável'}
`.trim();

    const systemPrompt = `Você é um assistente jurídico especializado. Gere briefings de casos concisos e bem estruturados para advogados brasileiros. Use linguagem profissional e direta. Formate em seções claras usando markdown simples (## para títulos, - para listas). Seja objetivo — máximo 400 palavras.`;
    const userPrompt = `Com base nas informações abaixo, gere um briefing estruturado do caso incluindo: (1) Resumo executivo, (2) Situação atual, (3) Próximos passos prioritários, (4) Pontos de atenção/riscos.\n\n${context}`;

    let briefing = '';

    if (isAnthropic) {
      const anthropicKey = (await this.settings.get('ANTHROPIC_API_KEY')) || process.env.ANTHROPIC_API_KEY;
      if (!anthropicKey) {
        throw new BadRequestException('ANTHROPIC_API_KEY nao configurada. Configure em Configurações > IA ou como variável de ambiente.');
      }
      const client = new Anthropic({ apiKey: anthropicKey });
      const response = await client.messages.create({
        model,
        max_tokens: 800,
        temperature: 0.3,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });
      briefing = ((response.content[0] as any)?.text || '').trim();
    } else {
      const openaiKey = (await this.settings.get('OPENAI_API_KEY')) || process.env.OPENAI_API_KEY;
      if (!openaiKey) {
        throw new BadRequestException('OPENAI_API_KEY nao configurada. Configure em Configurações > IA ou como variável de ambiente.');
      }
      const openai = new OpenAI({ apiKey: openaiKey });
      const completion = await openai.chat.completions.create({
        model,
        temperature: 0.3,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });
      briefing = (completion.choices[0]?.message?.content || '').trim();
    }

    if (!briefing) briefing = 'Não foi possível gerar o briefing.';
    return { briefing };
  }
}
