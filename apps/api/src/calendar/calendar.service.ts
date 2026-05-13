import { Injectable, NotFoundException, BadRequestException, ConflictException, ForbiddenException, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { isAdmin } from '../common/utils/permissions.util';
import { brazilNaiveToRealEpoch, brazilRealNowToNaive } from '../common/utils/timezone.util';
import { tenantOrDefault } from '../common/constants/tenant';

const EVENT_TYPES = ['CONSULTA', 'TAREFA', 'AUDIENCIA', 'PERICIA', 'PRAZO', 'OUTRO'] as const;
const EVENT_STATUSES = ['AGENDADO', 'CONFIRMADO', 'CONCLUIDO', 'CANCELADO', 'ADIADO'] as const;

/**
 * Reminders default por tipo de evento — usados quando o frontend/outra via
 * nao especifica `reminders` no payload do create(). Garante que TODO evento
 * criado tem lembrete automatico, sem depender do usuario configurar manualmente.
 *
 * Atualizado em 2026-04-22: antes, eventos criados via book_appointment da IA,
 * child events de recorrencia, etc. ficavam sem nenhum reminder e nunca
 * disparavam notificacao.
 */
const DEFAULT_REMINDERS_BY_TYPE: Record<string, { minutes_before: number; channel: string }[]> = {
  AUDIENCIA: [
    { minutes_before: 1440, channel: 'WHATSAPP' },   // 1 dia antes — WhatsApp pro cliente e advogado
    { minutes_before: 1440, channel: 'PUSH' },        // 1 dia antes — push visual
    { minutes_before: 60,   channel: 'WHATSAPP' },   // 1h antes
    { minutes_before: 60,   channel: 'PUSH' },
  ],
  PERICIA: [
    { minutes_before: 1440, channel: 'WHATSAPP' },
    { minutes_before: 1440, channel: 'PUSH' },
    { minutes_before: 60,   channel: 'WHATSAPP' },
    { minutes_before: 60,   channel: 'PUSH' },
  ],
  PRAZO: [
    { minutes_before: 2880, channel: 'PUSH' },       // 2 dias antes
    { minutes_before: 1440, channel: 'WHATSAPP' },   // 1 dia antes
    { minutes_before: 1440, channel: 'PUSH' },
    { minutes_before: 60,   channel: 'PUSH' },       // 1h antes
  ],
  CONSULTA: [
    { minutes_before: 60,   channel: 'PUSH' },
    { minutes_before: 30,   channel: 'WHATSAPP' },
  ],
  TAREFA: [
    { minutes_before: 60, channel: 'PUSH' },
  ],
  OUTRO: [
    { minutes_before: 30, channel: 'PUSH' },
  ],
};

@Injectable()
export class CalendarService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CalendarService.name);

  constructor(
    private prisma: PrismaService,
    private chatGateway: ChatGateway,
    @InjectQueue('calendar-reminders') private reminderQueue: Queue,
  ) {}

  /**
   * Re-enfileira todos os reminders pendentes (sent_at=null) de eventos
   * futuros quando a API sobe. Necessario apos 2026-04-23 porque o fix
   * do bug de timezone mudou a formula do `triggerAt` — jobs ja na fila
   * BullMQ estavam com delay 3h adiantado. Este sweep usa a formula nova.
   *
   * Idempotente: `enqueueReminders` remove job antigo antes de adicionar
   * o novo (via jobId deterministico `reminder-${id}`). Roda 1x por boot.
   *
   * Depois que todos os reminders afetados ja passaram pelo sweep,
   * este metodo pode ser removido sem efeitos colaterais.
   */
  async onApplicationBootstrap() {
    try {
      const nowNaive = brazilRealNowToNaive();
      const pendingReminders = await this.prisma.eventReminder.findMany({
        where: {
          sent_at: null,
          channel: { in: ['WHATSAPP', 'EMAIL'] },
          event: {
            start_at: { gt: nowNaive },
            status: { notIn: ['CANCELADO', 'CONCLUIDO'] },
          },
        },
        select: {
          id: true,
          minutes_before: true,
          channel: true,
          event_id: true,
          event: { select: { id: true, start_at: true } },
        },
      });

      if (pendingReminders.length === 0) {
        this.logger.log('[BOOT-TZ] Nenhum reminder pendente pra re-enfileirar');
        return;
      }

      this.logger.log(`[BOOT-TZ] Re-enfileirando ${pendingReminders.length} reminder(s) pendente(s) com delay corrigido…`);

      // Agrupa por event_id pra chamar enqueueReminders uma vez por evento
      const byEvent = new Map<string, { id: string; start_at: Date; reminders: { id: string; minutes_before: number; channel: string }[] }>();
      for (const r of pendingReminders) {
        if (!r.event) continue;
        if (!byEvent.has(r.event.id)) {
          byEvent.set(r.event.id, { id: r.event.id, start_at: r.event.start_at, reminders: [] });
        }
        byEvent.get(r.event.id)!.reminders.push({ id: r.id, minutes_before: r.minutes_before, channel: r.channel });
      }

      for (const ev of byEvent.values()) {
        await this.enqueueReminders(ev.id, ev.start_at, ev.reminders);
      }

      this.logger.log(`[BOOT-TZ] Re-enfileiramento concluido para ${byEvent.size} evento(s)`);
    } catch (e: any) {
      this.logger.warn(`[BOOT-TZ] Falha no re-enfileiramento: ${e.message}`);
    }
  }

  // ─── CRUD Events ──────────────────────────────────────

  async findAll(query: {
    start?: string;
    end?: string;
    type?: string;
    userId?: string;
    leadId?: string;
    legalCaseId?: string;
    tenantId?: string;
    search?: string;
  }) {
    const where: any = {};

    if (query.tenantId) {
      where.tenant_id = query.tenantId;
    }
    if (query.type) where.type = query.type;
    if (query.leadId) where.lead_id = query.leadId;
    if (query.legalCaseId) where.legal_case_id = query.legalCaseId;

    // Filtrar por userId:
    // - Se o evento TEM um responsável (assigned_user_id preenchido), apenas ele vê.
    // - Se o evento NÃO TEM responsável, o criador (created_by_id) vê.
    // Isso garante que ao trocar o advogado, o antigo para de ver o evento.
    if (query.userId) {
      if (!where.AND) where.AND = [];
      where.AND.push({
        OR: [
          { assigned_user_id: query.userId },
          { assigned_user_id: null, created_by_id: query.userId },
        ],
      });
    }

    if (query.search) {
      if (!where.AND) where.AND = [];
      where.AND.push({
        OR: [
          { title: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } },
        ],
      });
    }

    if (query.start || query.end) {
      // Schedule-x pode enviar datas em vários formatos:
      // - "2026-03-09T07:00:00+00:00[UTC]" → remover sufixo IANA
      // - "2026-03-09 00:00" → converter espaço para T
      // - "2026-03-09" → date-only
      const parseDate = (s: string) => {
        const cleaned = s.replace(/\[.*?\]$/, '').trim();
        // Se é formato "YYYY-MM-DD HH:mm", converter para ISO
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(cleaned)) {
          return new Date(cleaned.replace(' ', 'T'));
        }
        return new Date(cleaned);
      };
      // Overlap query: inclui eventos que começam antes do range mas terminam dentro dele
      // Evento visível se: start_at < rangeEnd AND (end_at > rangeStart OR end_at IS NULL AND start_at >= rangeStart)
      if (query.start && query.end) {
        const rangeStart = parseDate(query.start);
        const rangeEnd = parseDate(query.end);
        // Defensive: skip filter if dates are invalid
        if (isNaN(rangeStart.getTime()) || isNaN(rangeEnd.getTime())) {
          this.logger.warn(`[findAll] Invalid date range: start=${query.start}, end=${query.end}`);
        } else {
          where.start_at = { lt: rangeEnd };
          if (!where.AND) where.AND = [];
          where.AND.push({
            OR: [
              { end_at: { gt: rangeStart } },
              { end_at: null, start_at: { gte: rangeStart } },
            ],
          });
        }
      } else {
        where.start_at = {};
        if (query.start) where.start_at.gte = parseDate(query.start);
        if (query.end) where.start_at.lte = parseDate(query.end);
      }
    }

    // Bug fix 2026-05-10 (PR3 medio #1): cap de 1000 eventos por request.
    // Antes findMany sem take retornava todos os eventos do range com 7
    // includes pesados — escritorio com 1000+ eventos no mes travava o
    // frontend e o pool de conexao. Caller pode passar `start`/`end`
    // mais estreitos pra ver o que falta. Limit logado pra alertar UX.
    const FINDALL_LIMIT = 1000;
    const events = await (this.prisma.calendarEvent.findMany as any)({
      where,
      include: {
        assigned_user: { select: { id: true, name: true } },
        created_by: { select: { id: true, name: true } },
        lead: { select: { id: true, name: true, phone: true } },
        legal_case: { select: { id: true, case_number: true, legal_area: true, tracking_stage: true, in_tracking: true, lead: { select: { name: true } } } },
        appointment_type: true,
        reminders: true,
        // Feature 2026-05-12 (pedido Andre): retorna apenas o ID da
        // publicacao DJEN. Frontend usa pra mostrar botao "Ver analise IA"
        // no card; click busca a analise completa via findOne.
        djen_publication: { select: { id: true } },
        _count: { select: { comments: true } },
      },
      orderBy: { start_at: 'asc' },
      take: FINDALL_LIMIT,
    });
    if (events.length === FINDALL_LIMIT) {
      this.logger.warn(`[findAll] Cap de ${FINDALL_LIMIT} atingido — frontend pode estar pedindo range muito largo (start=${query.start}, end=${query.end})`);
    }
    return events;
  }

  async findOne(id: string) {
    const event = await (this.prisma.calendarEvent.findUnique as any)({
      where: { id },
      include: {
        assigned_user: { select: { id: true, name: true } },
        created_by: { select: { id: true, name: true } },
        lead: { select: { id: true, name: true, phone: true } },
        legal_case: { select: { id: true, case_number: true, legal_area: true, tracking_stage: true, in_tracking: true, lead: { select: { name: true } } } },
        appointment_type: true,
        reminders: true,
        // Feature 2026-05-12 (pedido Andre):
        // Inclui a publicacao DJEN que originou o evento (se houver) com
        // a analise IA completa pra tela "Advogado — Preparacao" mostrar
        // contexto rico no card de prazo.
        djen_publication: {
          select: {
            id: true,
            numero_processo: true,
            conteudo: true,
            data_disponibilizacao: true,
            tipo_comunicacao: true,
            lawyer_analysis: true,
            analyzed_at: true,
          },
        },
        _count: { select: { comments: true } },
      },
    });
    if (!event) throw new NotFoundException('Evento nao encontrado');
    return event;
  }

  async create(data: {
    type: string;
    title: string;
    description?: string;
    start_at: string;
    end_at?: string;
    all_day?: boolean;
    status?: string;
    priority?: string;
    color?: string;
    location?: string;
    lead_id?: string;
    conversation_id?: string;
    legal_case_id?: string;
    assigned_user_id?: string;
    created_by_id: string;
    appointment_type_id?: string;
    djen_publication_id?: string;
    tenant_id?: string;
    reminders?: { minutes_before: number; channel?: string }[];
    recurrence_rule?: string;
    recurrence_end?: string;
    recurrence_days?: number[];
  }) {
    if (!EVENT_TYPES.includes(data.type as any)) {
      throw new BadRequestException(`Tipo invalido: ${data.type}. Use: ${EVENT_TYPES.join(', ')}`);
    }

    // ─── Guardrail: dedup AUDIENCIA/PERICIA por processo + janela de 12h ───
    //
    // Bug reportado 2026-04-26 (cliente Alecio): mesma audiencia foi cadastrada
    // 2x — uma pelo painel DJEN (08:30 BRT), outra pela tela de Processos
    // (11:30 UTC bugado, ja corrigido). Ambas dispararam notify-hearing-scheduled
    // e o cliente recebeu mensagens conflitantes.
    //
    // Janela de 12h cobre:
    //  - Arredondamento de minutos pela IA
    //  - Fuso (start_at armazenado como UTC naive BRT — diff zero quando sao a mesma)
    //  - Diferenca de horas dentro do MESMO DIA que ainda eh a mesma audiencia
    //    (ex: IA detecta 14:00, operador conclui que eh as 09:00 e cria manual —
    //    mesma audiencia, hora corrigida — bloqueia duplicacao). A IA do
    //    servidor sugeriu 12h em 2026-04-26 e validou em prod.
    // Status CANCELADO/CONCLUIDO ignorado pra permitir re-agendamento legitimo
    // (operador cancela primeira, cria nova >12h depois — nao bloqueia).
    if ((data.type === 'AUDIENCIA' || data.type === 'PERICIA') && data.legal_case_id && data.start_at) {
      const target = new Date(data.start_at);
      const before = new Date(target.getTime() - 12 * 60 * 60 * 1000);
      const after = new Date(target.getTime() + 12 * 60 * 60 * 1000);
      const existing = await this.prisma.calendarEvent.findFirst({
        where: {
          legal_case_id: data.legal_case_id,
          type: data.type,
          status: { notIn: ['CANCELADO', 'CONCLUIDO'] },
          start_at: { gte: before, lte: after },
        },
        select: { id: true, title: true, start_at: true },
      });
      if (existing) {
        const tipo = data.type === 'PERICIA' ? 'perícia' : 'audiência';
        const dataExistente = existing.start_at.toLocaleString('pt-BR', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
        });
        this.logger.warn(
          `[CALENDAR] Duplicata bloqueada: ${data.type} ja existe pra case ${data.legal_case_id} ` +
          `em ${existing.start_at.toISOString()} (existing id=${existing.id}, title="${existing.title}")`,
        );
        throw new ConflictException(
          `Já existe ${tipo} agendada neste processo em ${dataExistente} ("${existing.title}"). ` +
          `Verifique antes de criar outra — se for um agendamento diferente, separe por mais de 2h ou cancele o anterior.`,
        );
      }
    }

    // Auto-preencher lead_id + assigned_user_id a partir do processo vinculado,
    // se não informados. LegalCase.lawyer_id eh sempre preenchido (NOT NULL
    // no schema). Antes assigned_user_id ficava null em eventos criados por
    // fluxos que nao passavam explicitamente (ex: case-deadlines, DJEN auto-task),
    // fazendo prazos aparecerem como "Sem responsavel" na Triagem.
    // Bug reportado 2026-04-24. Fix: fallback generico aqui cobre todos os
    // pontos de criacao de CalendarEvent com legal_case_id.
    let resolvedLeadId = data.lead_id;
    let resolvedAssignedUserId = data.assigned_user_id;
    if (data.legal_case_id && (!resolvedLeadId || !resolvedAssignedUserId)) {
      const legalCase = await this.prisma.legalCase.findUnique({
        where: { id: data.legal_case_id },
        select: { lead_id: true, lawyer_id: true },
      });
      if (legalCase?.lead_id && !resolvedLeadId) resolvedLeadId = legalCase.lead_id;
      if (legalCase?.lawyer_id && !resolvedAssignedUserId) {
        resolvedAssignedUserId = legalCase.lawyer_id;
      }
    }

    // Reminders: se frontend/via nao especificou, usa defaults do tipo.
    // Se passou array vazio explicito [], respeita (sem reminders).
    // Se passou array com items, usa eles.
    const effectiveReminders =
      data.reminders === undefined
        ? (DEFAULT_REMINDERS_BY_TYPE[data.type] || [{ minutes_before: 30, channel: 'PUSH' }])
        : data.reminders;

    const event = await this.prisma.calendarEvent.create({
      data: {
        type: data.type,
        title: data.title,
        description: data.description,
        start_at: new Date(data.start_at),
        end_at: data.end_at ? new Date(data.end_at) : null,
        all_day: data.all_day ?? false,
        status: data.status ?? 'AGENDADO',
        priority: data.priority ?? 'NORMAL',
        color: data.color,
        location: data.location,
        lead_id: resolvedLeadId,
        conversation_id: data.conversation_id,
        legal_case_id: data.legal_case_id,
        assigned_user_id: resolvedAssignedUserId,
        created_by_id: data.created_by_id,
        appointment_type_id: data.appointment_type_id,
        tenant_id: tenantOrDefault(data.tenant_id),
        recurrence_rule: data.recurrence_rule,
        recurrence_end: data.recurrence_end ? new Date(data.recurrence_end) : null,
        recurrence_days: data.recurrence_days ?? [],
        // Feature 2026-05-12: link com publicacao DJEN que originou
        // NOTE: campo novo — Prisma generate na VPS ainda nao rodou pra esse
        // commit. Cast pra any ate o build do container regenerar o client.
        ...(data.djen_publication_id ? { djen_publication_id: data.djen_publication_id } : {}) as any,
        reminders: effectiveReminders.length
          ? {
              create: effectiveReminders.map((r) => ({
                minutes_before: r.minutes_before,
                channel: r.channel ?? 'PUSH',
              })),
            }
          : undefined,
      },
      include: {
        assigned_user: { select: { id: true, name: true } },
        lead: { select: { id: true, name: true, phone: true } },
        reminders: true,
      },
    });

    // Notificar advogado atribuido via socket
    if (event.assigned_user_id) {
      try {
        this.chatGateway.emitCalendarUpdate(event.assigned_user_id, {
          eventId: event.id,
          action: 'created',
          title: event.title,
          type: event.type,
          start_at: event.start_at.toISOString(),
        });
      } catch {}
    }

    // Enqueue WhatsApp + Email reminders
    await this.enqueueReminders(event.id, event.start_at, event.reminders || []);

    // Se não tem lead direto mas tem processo, buscar lead do processo
    let leadPhone: string | undefined = event.lead?.phone || undefined;
    if (!leadPhone && data.legal_case_id) {
      try {
        const lc = await this.prisma.legalCase.findUnique({
          where: { id: data.legal_case_id },
          select: { lead_id: true, lead: { select: { phone: true } } },
        });
        leadPhone = lc?.lead?.phone || undefined;
        // Vincular lead_id ao evento para futuras referências
        if (lc?.lead_id && !event.lead_id) {
          await this.prisma.calendarEvent.update({
            where: { id: event.id },
            data: { lead_id: lc.lead_id },
          }).catch(() => {});
        }
      } catch {}
    }

    // Notificação imediata ao cliente (1 min de delay) quando audiência ou perícia é agendada.
    // Bug fix 2026-05-08: respeita data.notify_client (default true). UI pode
    // passar false pra criar evento "interno" sem WhatsApp ao cliente.
    const shouldNotifyClient = (data as any).notify_client !== false;
    if ((data.type === 'AUDIENCIA' || data.type === 'PERICIA') && leadPhone && shouldNotifyClient) {
      try {
        await this.reminderQueue.add(
          'notify-hearing-scheduled',
          { eventId: event.id },
          {
            delay: 60_000, // 1 minuto — dá tempo ao operador de corrigir antes do envio
            jobId: `hearing-notify-${event.id}`,
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: true,
            removeOnFail: 50,
          },
        );
        this.logger.log(`[NOTIFY] Notificação ${data.type} agendada ao cliente em 1 min (evento ${event.id}, lead: ${event.lead?.phone})`);
      } catch (e: any) {
        this.logger.error(`[NOTIFY] Erro ao enfileirar notificação ${data.type}: ${e.message}`);
      }
    }

    // Expand recurrence if rule set
    if (data.recurrence_rule) {
      await this.expandRecurrence(event);
    }

    // ── Auto-promocao do tracking_stage do processo ────────────────────────
    // Ao criar CalendarEvent futuro tipo AUDIENCIA ou PERICIA vinculado a um
    // LegalCase, avanca automaticamente o tracking_stage pra coluna
    // correspondente no kanban. Nunca regressa (so avanca se target > atual).
    if (data.legal_case_id && ['AUDIENCIA', 'PERICIA'].includes(data.type)) {
      const isFuture = new Date(data.start_at) > new Date();
      if (isFuture) {
        await this.autoPromoteTrackingStage(
          data.legal_case_id,
          data.type as 'AUDIENCIA' | 'PERICIA',
        ).catch((e) => {
          this.logger.warn(`[AUTO-STAGE] Falha ao promover processo ${data.legal_case_id}: ${e.message}`);
        });
      }
    }

    return event;
  }

  /**
   * Avanca o tracking_stage do LegalCase automaticamente quando um
   * CalendarEvent AUDIENCIA ou PERICIA e agendado.
   *
   * Regras:
   *   - AUDIENCIA -> INSTRUCAO (indice 5)
   *   - PERICIA   -> PERICIA_AGENDADA (indice 4)
   *   - So avanca se tracking_stage atual e MENOR que o target (nao regressa)
   *   - Nao mexe em casos arquivados, encerrados ou em etapas finais
   *     (JULGAMENTO, RECURSO, TRANSITADO, EXECUCAO, ENCERRADO)
   */
  private async autoPromoteTrackingStage(
    legalCaseId: string,
    eventType: 'AUDIENCIA' | 'PERICIA',
  ) {
    // Ordem canonica dos tracking_stages (indice = posicao no kanban)
    const ORDER = [
      'DISTRIBUIDO',       // 0
      'CITACAO',           // 1
      'CONTESTACAO',       // 2
      'REPLICA',           // 3
      'PERICIA_AGENDADA',  // 4
      'INSTRUCAO',         // 5 — Audiencia/Instrucao
      'ALEGACOES_FINAIS',  // 6
      'AGUARDANDO_SENTENCA', // 7
      'JULGAMENTO',        // 8
      'RECURSO',           // 9
      'TRANSITADO',        // 10
      'EXECUCAO',          // 11
      'ENCERRADO',         // 12
    ];
    const targetStage = eventType === 'AUDIENCIA' ? 'INSTRUCAO' : 'PERICIA_AGENDADA';
    const targetIdx = ORDER.indexOf(targetStage);

    const lc = await this.prisma.legalCase.findUnique({
      where: { id: legalCaseId },
      select: { id: true, tracking_stage: true, archived: true, case_number: true },
    });
    if (!lc || lc.archived) return;

    const currentIdx = ORDER.indexOf(lc.tracking_stage || 'DISTRIBUIDO');
    // Se o stage atual nao e reconhecido (nao ta no ORDER), indice = -1.
    // Nesse caso, tratamos como 'inicio' (0) pra permitir promocao.
    const effectiveCurrentIdx = currentIdx < 0 ? 0 : currentIdx;

    if (effectiveCurrentIdx >= targetIdx) {
      // Ja esta no target ou mais avancado — nao mexe
      return;
    }

    await this.prisma.legalCase.update({
      where: { id: legalCaseId },
      data: { tracking_stage: targetStage, stage_changed_at: new Date() },
    });
    this.logger.log(
      `[AUTO-STAGE] ${lc.case_number} ${lc.tracking_stage || '-'} -> ${targetStage} (evento ${eventType} agendado)`,
    );
  }

  private async enqueueReminders(eventId: string, startAt: Date, reminders: { id: string; minutes_before: number; channel: string }[]) {
    // Bug fix 2026-05-10 (PR3 medio #3): paraleliza I/O Redis. Antes loop
    // serial fazia 3N round-trips (getJob+remove+add por reminder) — criar
    // evento com 4 reminders = 12 round-trips bloqueantes. Agora:
    //   1. Filtra/computa em memoria (sync)
    //   2. Remove jobs antigos em paralelo (Promise.all)
    //   3. Adiciona novos jobs em batch (addBulk)
    // Ganho: 12 round-trips → 2 (1 paralelo + 1 batch).

    // Etapa 1: prepara payload + filtra retroativos
    const nowMs = Date.now();
    const retroactiveIds: string[] = [];
    const jobsToAdd: Array<{ name: string; data: any; opts: any }> = [];
    const jobsToRemove: string[] = [];

    for (const r of reminders) {
      if (r.channel !== 'WHATSAPP' && r.channel !== 'EMAIL') continue; // PUSH handled by cron
      // startAt eh "UTC naive" (horario BRT armazenado como UTC no banco) —
      // brazilNaiveToRealEpoch converte pro epoch real antes de calcular delay.
      // Sem isso o trigger sai 3h adiantado. Bug reportado 2026-04-23.
      const triggerAt = brazilNaiveToRealEpoch(startAt) - r.minutes_before * 60 * 1000;

      // Bug fix 2026-05-10 (PR2 #7): skip reminders retroativos.
      if (triggerAt < nowMs - 60_000) {
        this.logger.log(
          `[REMINDER] Skip retroativo: ${r.id} (channel=${r.channel}, trigger ` +
          `${Math.round((nowMs - triggerAt) / 60000)}min no passado, evento ${eventId})`,
        );
        retroactiveIds.push(r.id);
        continue;
      }

      const delay = Math.max(triggerAt - nowMs, 1000);
      const jobId = `reminder-${r.id}`;
      jobsToRemove.push(jobId);
      jobsToAdd.push({
        name: 'send-reminder',
        data: { reminderId: r.id, eventId, channel: r.channel },
        opts: {
          delay,
          jobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: 50,
        },
      });
    }

    // Etapa 2: marca retroativos como sent_at em batch (sem bloquear queue)
    if (retroactiveIds.length > 0) {
      this.prisma.eventReminder.updateMany({
        where: { id: { in: retroactiveIds } },
        data: { sent_at: new Date() },
      }).catch(() => { /* fire-and-forget — apenas evita re-processamento */ });
    }

    // Etapa 3: remove jobs antigos em paralelo (idempotencia em re-agendamento)
    await Promise.all(
      jobsToRemove.map(jobId =>
        this.reminderQueue.getJob(jobId)
          .then(job => job?.remove())
          .catch(() => { /* no-op */ })
      )
    );

    // Etapa 4: addBulk — 1 round-trip pra todos os jobs
    if (jobsToAdd.length > 0) {
      try {
        await this.reminderQueue.addBulk(jobsToAdd);
        for (const j of jobsToAdd) {
          this.logger.log(`Lembrete ${j.data.reminderId} enfileirado: canal=${j.data.channel}, delay=${Math.round(j.opts.delay / 60000)}min`);
        }
      } catch (e: any) {
        this.logger.error(`Erro no addBulk de ${jobsToAdd.length} reminders: ${e.message}`);
      }
    }
  }

  /** Remove todos os jobs de lembrete de um evento da fila BullMQ */
  private async cancelReminderJobs(eventId: string) {
    try {
      const reminders = await this.prisma.eventReminder.findMany({
        where: { event_id: eventId },
        select: { id: true },
      });
      for (const r of reminders) {
        try {
          const job = await this.reminderQueue.getJob(`reminder-${r.id}`);
          if (job) await job.remove();
        } catch {}
      }
    } catch (e: any) {
      this.logger.warn(`Erro ao cancelar jobs de lembrete do evento ${eventId}: ${e.message}`);
    }
  }

  async update(
    id: string,
    data: {
      title?: string;
      description?: string;
      start_at?: string;
      end_at?: string;
      all_day?: boolean;
      status?: string;
      priority?: string;
      color?: string;
      location?: string;
      type?: string;
      lead_id?: string | null;
      conversation_id?: string | null;
      legal_case_id?: string | null;
      assigned_user_id?: string | null;
      appointment_type_id?: string | null;
    },
  ) {
    if (data.type && !EVENT_TYPES.includes(data.type as any)) {
      throw new BadRequestException(`Tipo invalido: ${data.type}`);
    }
    if (data.status && !EVENT_STATUSES.includes(data.status as any)) {
      throw new BadRequestException(`Status invalido: ${data.status}`);
    }

    const updateData: any = { ...data };
    if (data.start_at) updateData.start_at = new Date(data.start_at);
    if (data.end_at) updateData.end_at = new Date(data.end_at);
    if (data.end_at === null) updateData.end_at = null;

    // Auto-preencher lead_id a partir do processo vinculado, se legal_case_id mudou e lead_id não foi informado
    if (data.legal_case_id && data.lead_id === undefined) {
      const legalCase = await this.prisma.legalCase.findUnique({
        where: { id: data.legal_case_id },
        select: { lead_id: true },
      });
      if (legalCase?.lead_id) updateData.lead_id = legalCase.lead_id;
    }

    // Carrega estado anterior para detectar mudanças relevantes na audiência
    const before = await this.prisma.calendarEvent.findUnique({
      where: { id },
      select: { type: true, start_at: true, location: true, lead_id: true, assigned_user_id: true, title: true },
    });

    const event = await this.prisma.calendarEvent.update({
      where: { id },
      data: updateData,
      include: {
        assigned_user: { select: { id: true, name: true } },
        lead: { select: { id: true, name: true, phone: true } },
        reminders: true,
      },
    });

    // Se start_at mudou, re-enfileirar todos os lembretes com o novo delay
    if (data.start_at && event.reminders?.length) {
      await this.enqueueReminders(event.id, event.start_at, event.reminders);
      this.logger.log(`Lembretes re-enfileirados para evento ${event.id} (start_at alterado)`);
    }

    // Bug fix 2026-05-10 (PR2 #8): se assigned_user_id mudou, antigo
    // responsavel ainda recebia reminder + novo nao sabia da
    // atribuicao. Re-enqueue dos reminders garante que disparem com
    // dados atuais (template usa assigned_user.name); notify ao novo
    // garante que ele saiba SEM esperar o reminder.
    const reassigned = data.assigned_user_id !== undefined
      && before?.assigned_user_id !== event.assigned_user_id;
    if (reassigned) {
      // Re-enfileira reminders pra garantir que template puxe assigned_user atualizado
      if (event.reminders?.length && !data.start_at) {
        await this.enqueueReminders(event.id, event.start_at, event.reminders);
        this.logger.log(`Lembretes re-enfileirados para evento ${event.id} (assigned_user_id alterado: ${before?.assigned_user_id} → ${event.assigned_user_id})`);
      }
      // Notifica novo responsavel se existir
      if (event.assigned_user_id) {
        try {
          this.chatGateway.emitCalendarReminder(event.assigned_user_id, {
            eventId: event.id,
            title: event.title,
            type: event.type,
            start_at: event.start_at.toISOString(),
            minutesBefore: 0,
          });
        } catch (e: any) {
          this.logger.warn(`Falha ao notificar novo responsavel ${event.assigned_user_id}: ${e.message}`);
        }
      }
    }

    // Se é AUDIÊNCIA ou PERÍCIA e data ou local mudaram → notificar cliente sobre a remarcação
    const isAudiencia = ['AUDIENCIA', 'PERICIA'].includes(before?.type ?? event.type);
    const dateChanged = data.start_at && new Date(data.start_at).getTime() !== before?.start_at?.getTime();
    const locationChanged = data.location !== undefined && data.location !== before?.location;
    if (isAudiencia && (dateChanged || locationChanged) && event.lead?.phone) {
      try {
        // Cancela notificação anterior pendente (se operador ainda não enviou)
        const oldJob = await this.reminderQueue.getJob(`hearing-notify-${event.id}`);
        if (oldJob) await oldJob.remove();
        // Enfileira nova notificação de remarcação com 1 minuto de delay
        await this.reminderQueue.add(
          'notify-hearing-rescheduled',
          { eventId: event.id },
          {
            delay: 60_000,
            jobId: `hearing-notify-${event.id}`,
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: true,
            removeOnFail: 50,
          },
        );
        this.logger.log(`[AUDIENCIA] Notificação de remarcação enfileirada para evento ${event.id}`);
      } catch (e: any) {
        this.logger.error(`[AUDIENCIA] Erro ao enfileirar notificação de remarcação: ${e.message}`);
      }
    }

    if (event.assigned_user_id) {
      try {
        this.chatGateway.emitCalendarUpdate(event.assigned_user_id, {
          eventId: event.id,
          action: 'updated',
          title: event.title,
          type: event.type,
        });
      } catch {}
    }

    return event;
  }

  async updateStatus(id: string, status: string, completionNote?: string, userId?: string) {
    if (!EVENT_STATUSES.includes(status as any)) {
      throw new BadRequestException(`Status invalido: ${status}`);
    }

    // Audit: seta completed_at/completed_by/note quando entra em estado terminal.
    // Se volta pra AGENDADO/CONFIRMADO (reopen), limpa pra nao ter audit falso.
    const isTerminal = ['CONCLUIDO', 'CANCELADO', 'ADIADO'].includes(status);
    const auditData: any = {};
    if (isTerminal) {
      auditData.completed_at = new Date();
      if (userId) auditData.completed_by_id = userId;
      if (completionNote) auditData.completion_note = completionNote;
    } else {
      // Reopen — limpa audit
      auditData.completed_at = null;
      auditData.completed_by_id = null;
      auditData.completion_note = null;
    }

    const event = await this.prisma.calendarEvent.update({
      where: { id },
      data: { status, ...auditData },
      include: {
        assigned_user: { select: { id: true, name: true } },
        task: { select: { id: true, status: true } },
        deadline: { select: { id: true, completed: true } },
      },
    });

    // Cancelar jobs de lembrete quando evento é cancelado/concluído
    if (['CANCELADO', 'CONCLUIDO'].includes(status)) {
      await this.cancelReminderJobs(id);
      this.logger.log(`Lembretes cancelados para evento ${id} (status → ${status})`);
    }

    // ── Sync bidirecional: Calendar → Task ────────────────────────────────
    // Antes so existia o sentido Task → Calendar. Se o advogado cumpria na
    // agenda, a Task vinculada ficava presa em A_FAZER em outras telas.
    // Corrigido em 2026-04-22: qualquer mudanca de status no Calendar
    // propaga pra Task linkada via calendar_event_id.
    if ((event as any).task?.id) {
      const calToTaskStatus: Record<string, string> = {
        'CONCLUIDO': 'CONCLUIDA',
        'CANCELADO': 'CANCELADA',
        'CONFIRMADO': 'EM_PROGRESSO',
        'AGENDADO': 'A_FAZER',
        'ADIADO': 'A_FAZER', // Adiado vira "a fazer" de novo (evento foi remarcado)
      };
      const taskStatus = calToTaskStatus[status];
      if (taskStatus && (event as any).task.status !== taskStatus) {
        try {
          // Espelha audit no Task se chegou em estado terminal
          const isTaskTerminal = ['CONCLUIDA', 'CANCELADA'].includes(taskStatus);
          await this.prisma.task.update({
            where: { id: (event as any).task.id },
            data: {
              status: taskStatus,
              ...(isTaskTerminal ? {
                completed_at: new Date(),
                ...(userId ? { completed_by_id: userId } : {}),
                ...(completionNote ? { completion_note: completionNote } : {}),
              } : {
                completed_at: null,
                completed_by_id: null,
              }),
            },
          });
          this.logger.log(
            `[Sync] Task ${(event as any).task.id} sincronizada: ${(event as any).task.status} → ${taskStatus}`,
          );
        } catch (e: any) {
          this.logger.warn(`[Sync] Falha ao sincronizar Task ${(event as any).task.id}: ${e.message}`);
        }
      }
    }

    // ── Sync bidirecional: Calendar → CaseDeadline ─────────────────────────
    // CaseDeadline agora tem enum `status` (PENDENTE/CONCLUIDO/CANCELADO/
    // ADIADO) + campo shortcut `completed` pra compat com queries legadas.
    // Mapeamento direto de Calendar.status -> Deadline.status.
    if ((event as any).deadline?.id) {
      const calToDeadlineStatus: Record<string, string> = {
        'CONCLUIDO': 'CONCLUIDO',
        'CANCELADO': 'CANCELADO',
        'ADIADO': 'ADIADO',
        'AGENDADO': 'PENDENTE',
        'CONFIRMADO': 'PENDENTE',
      };
      const deadlineStatus = calToDeadlineStatus[status] ?? 'PENDENTE';
      const isTerminal = ['CONCLUIDO', 'CANCELADO'].includes(status);

      try {
        await this.prisma.caseDeadline.update({
          where: { id: (event as any).deadline.id },
          data: {
            status: deadlineStatus,
            completed: isTerminal,
            completed_at: isTerminal ? new Date() : null,
            ...(isTerminal && userId ? { completed_by_id: userId } : {}),
            ...(isTerminal && completionNote ? { completion_note: completionNote } : {}),
            ...(!isTerminal ? { completed_by_id: null, completion_note: null } : {}),
          },
        });
        this.logger.log(
          `[Sync] CaseDeadline ${(event as any).deadline.id} sincronizado: status=${deadlineStatus}`,
        );
      } catch (e: any) {
        this.logger.warn(`[Sync] Falha ao sincronizar CaseDeadline: ${e.message}`);
      }
    }

    // Notificar advogado
    if (event.assigned_user_id) {
      try {
        this.chatGateway.emitCalendarUpdate(event.assigned_user_id, {
          eventId: id,
          action: 'status_changed',
          title: event.title,
          type: event.type,
        });
      } catch {}
    }

    return event;
  }

  async remove(id: string) {
    const event = await this.prisma.calendarEvent.findUnique({ where: { id } });
    if (!event) throw new NotFoundException('Evento nao encontrado');

    // Cancelar jobs de lembrete pendentes na fila BullMQ antes de deletar
    await this.cancelReminderJobs(id);

    await this.prisma.calendarEvent.delete({ where: { id } });

    if (event.assigned_user_id) {
      try {
        this.chatGateway.emitCalendarUpdate(event.assigned_user_id, {
          eventId: id,
          action: 'deleted',
          title: event.title,
        });
      } catch {}
    }

    return { deleted: true };
  }

  // ─── Conflict Detection ─────────────────────────────────

  async checkConflicts(userId: string, startAt: string, endAt: string, excludeEventId?: string, tenantId?: string) {
    const start = new Date(startAt);
    const end = new Date(endAt);
    const where: any = {
      assigned_user_id: userId,
      status: { notIn: ['CANCELADO', 'CONCLUIDO'] },
      // Overlap: evento começa antes do fim do range E (termina após início do range OU sem end_at mas começa dentro do range)
      start_at: { lt: end },
      OR: [
        { end_at: { gt: start } },
        { end_at: null, start_at: { gte: start } },
      ],
    };
    // Isolamento de tenant: admin de um tenant não vê agenda de outro tenant
    if (tenantId) {
      where.AND = [
        ...(where.AND || []),
        { tenant_id: tenantId },
      ];
    }
    if (excludeEventId) where.id = { not: excludeEventId };
    return this.prisma.calendarEvent.findMany({
      where,
      select: { id: true, title: true, start_at: true, end_at: true },
    });
  }

  // ─── Availability ─────────────────────────────────────

  async getSchedule(userId: string) {
    return this.prisma.userSchedule.findMany({
      where: { user_id: userId },
      orderBy: { day_of_week: 'asc' },
    });
  }

  async setSchedule(
    userId: string,
    slots: { day_of_week: number; start_time: string; end_time: string; lunch_start?: string | null; lunch_end?: string | null }[],
    tenantId?: string,
  ) {
    // Bug fix 2026-05-09: validar tenant + dados antes de gravar.
    // Antes nao validava tenant nem ranges → invasor sequestrava agenda
    // de advogado de outro escritorio + nao validava start<lunch<end.
    if (tenantId) {
      const targetUser = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { tenant_id: true },
      });
      if (!targetUser) throw new NotFoundException('User nao encontrado');
      if (targetUser.tenant_id !== tenantId) {
        throw new ForbiddenException('User pertence a outro tenant');
      }
    }

    // Validar cada slot
    const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;
    for (const s of slots) {
      if (!Number.isInteger(s.day_of_week) || s.day_of_week < 0 || s.day_of_week > 6) {
        throw new BadRequestException(`day_of_week invalido (${s.day_of_week}): use 0=domingo a 6=sabado`);
      }
      if (!HHMM.test(s.start_time) || !HHMM.test(s.end_time)) {
        throw new BadRequestException(`Horarios devem ser HH:MM (got start=${s.start_time}, end=${s.end_time})`);
      }
      if (s.start_time >= s.end_time) {
        throw new BadRequestException(`start_time (${s.start_time}) deve ser < end_time (${s.end_time})`);
      }
      if (s.lunch_start || s.lunch_end) {
        if (!s.lunch_start || !s.lunch_end) {
          throw new BadRequestException('lunch_start e lunch_end devem ser ambos preenchidos ou ambos null');
        }
        if (!HHMM.test(s.lunch_start) || !HHMM.test(s.lunch_end)) {
          throw new BadRequestException('lunch_start e lunch_end devem ser HH:MM');
        }
        if (s.lunch_start >= s.lunch_end) {
          throw new BadRequestException(`lunch_start (${s.lunch_start}) deve ser < lunch_end (${s.lunch_end})`);
        }
        if (s.lunch_start <= s.start_time || s.lunch_end >= s.end_time) {
          throw new BadRequestException('Pausa de almoco deve estar dentro do expediente (start < lunch_start < lunch_end < end)');
        }
      }
    }

    const results = await Promise.all(
      slots.map((s) =>
        this.prisma.userSchedule.upsert({
          where: { user_id_day_of_week: { user_id: userId, day_of_week: s.day_of_week } },
          create: {
            user_id: userId,
            day_of_week: s.day_of_week,
            start_time: s.start_time,
            end_time: s.end_time,
            lunch_start: s.lunch_start ?? null,
            lunch_end: s.lunch_end ?? null,
          },
          update: {
            start_time: s.start_time,
            end_time: s.end_time,
            lunch_start: s.lunch_start ?? null,
            lunch_end: s.lunch_end ?? null,
          },
        }),
      ),
    );
    return results;
  }

  async getAvailability(userId: string, dateStr: string, durationMinutes: number, tenantId?: string) {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      throw new BadRequestException('Data inválida');
    }
    // UTC naive: datas armazenadas como horário local em UTC — usar getUTCDay()
    const dayOfWeek = date.getUTCDay(); // 0=dom..6=sab

    // 0. Verificar se e feriado (com filtro de tenant)
    const isHoliday = await this.isHoliday(date, tenantId);
    if (isHoliday) return [];

    // 1. Horario de trabalho do dia
    const schedule = await this.prisma.userSchedule.findUnique({
      where: { user_id_day_of_week: { user_id: userId, day_of_week: dayOfWeek } },
    });
    if (!schedule) return [];

    // 2. Eventos existentes nesse dia (inclui eventos que começaram antes mas terminam durante o dia)
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    const events = await this.prisma.calendarEvent.findMany({
      where: {
        assigned_user_id: userId,
        // Overlap: evento começa antes do fim do dia E (termina após início do dia OU sem end_at mas começa no dia)
        start_at: { lte: dayEnd },
        OR: [
          { end_at: { gte: dayStart } },
          { end_at: null, start_at: { gte: dayStart } },
        ],
        status: { notIn: ['CANCELADO', 'CONCLUIDO'] },
      },
      select: { start_at: true, end_at: true },
      orderBy: { start_at: 'asc' },
    });

    // 3. Calcular slots livres
    const [startH, startM] = schedule.start_time.split(':').map(Number);
    const [endH, endM] = schedule.end_time.split(':').map(Number);
    const workStart = startH * 60 + startM;
    const workEnd = endH * 60 + endM;

    // UTC naive: extrair hora/minuto direto em UTC (datas armazenadas como horário local)
    const toLocalMinutes = (d: Date): number => {
      return d.getUTCHours() * 60 + d.getUTCMinutes();
    };

    const busy = events.map((e) => {
      const s = Math.max(toLocalMinutes(e.start_at), workStart);
      const eEnd = e.end_at
        ? Math.min(toLocalMinutes(e.end_at), workEnd)
        : Math.min(s + durationMinutes, workEnd);
      return { start: s, end: eEnd };
    });

    // Adicionar pausa de almoço como período ocupado
    if (schedule.lunch_start && schedule.lunch_end) {
      const [lsH, lsM] = schedule.lunch_start.split(':').map(Number);
      const [leH, leM] = schedule.lunch_end.split(':').map(Number);
      busy.push({ start: lsH * 60 + lsM, end: leH * 60 + leM });
      busy.sort((a, b) => a.start - b.start);
    }

    const slots: { start: string; end: string }[] = [];
    let cursor = workStart;
    for (const b of busy) {
      while (cursor + durationMinutes <= b.start) {
        const slotEnd = cursor + durationMinutes;
        slots.push({
          start: `${String(Math.floor(cursor / 60)).padStart(2, '0')}:${String(cursor % 60).padStart(2, '0')}`,
          end: `${String(Math.floor(slotEnd / 60)).padStart(2, '0')}:${String(slotEnd % 60).padStart(2, '0')}`,
        });
        cursor = slotEnd;
      }
      if (b.end > cursor) cursor = b.end;
    }
    while (cursor + durationMinutes <= workEnd) {
      const slotEnd = cursor + durationMinutes;
      slots.push({
        start: `${String(Math.floor(cursor / 60)).padStart(2, '0')}:${String(cursor % 60).padStart(2, '0')}`,
        end: `${String(Math.floor(slotEnd / 60)).padStart(2, '0')}:${String(slotEnd % 60).padStart(2, '0')}`,
      });
      cursor = slotEnd;
    }

    return slots;
  }

  // ─── Appointment Types ────────────────────────────────

  async findAppointmentTypes(tenantId?: string) {
    return this.prisma.appointmentType.findMany({
      where: tenantId ? { tenant_id: tenantId } : {},
      orderBy: { name: 'asc' },
    });
  }

  // Bug fix 2026-05-10 (PR3 medio #6): audit log em mutacoes de
  // configuracao (appointment-types + holidays). Antes admin podia
  // alterar/deletar tipo de consulta ou feriado sem audit — investigar
  // config corrompida (cliente reclamou que feriado sumiu) era
  // impossivel. Audit fire-and-forget, nao bloqueia operacao.
  private auditFireAndForget(actorUserId: string | undefined, action: string, entity: string, entityId: string, meta?: any) {
    this.prisma.auditLog.create({
      data: {
        actor_user_id: actorUserId || null,
        action,
        entity,
        entity_id: entityId,
        meta_json: meta || undefined,
      },
    }).catch((e: any) => {
      this.logger.warn(`[AUDIT] Falha ao gravar log ${entity}.${action}: ${e.message}`);
    });
  }

  async createAppointmentType(data: {
    name: string;
    duration: number;
    color?: string;
    tenant_id?: string;
  }, actorUserId?: string) {
    const created = await this.prisma.appointmentType.create({ data });
    this.auditFireAndForget(actorUserId, 'create', 'AppointmentType', created.id, { name: data.name, duration: data.duration });
    return created;
  }

  async updateAppointmentType(id: string, data: { name?: string; duration?: number; color?: string; active?: boolean }, actorUserId?: string) {
    const before = await this.prisma.appointmentType.findUnique({ where: { id } });
    const updated = await this.prisma.appointmentType.update({ where: { id }, data });
    this.auditFireAndForget(actorUserId, 'update', 'AppointmentType', id, { before, after: data });
    return updated;
  }

  async deleteAppointmentType(id: string, actorUserId?: string) {
    const before = await this.prisma.appointmentType.findUnique({ where: { id } });
    await this.prisma.appointmentType.delete({ where: { id } });
    this.auditFireAndForget(actorUserId, 'delete', 'AppointmentType', id, { before });
    return { deleted: true };
  }

  // ─── Holidays ─────────────────────────────────────────

  async findHolidays(tenantId?: string) {
    return this.prisma.holiday.findMany({
      where: tenantId ? { tenant_id: tenantId } : {},
      orderBy: { date: 'asc' },
    });
  }

  async createHoliday(data: { date: string; name: string; recurring_yearly?: boolean; tenant_id?: string }, actorUserId?: string) {
    const created = await this.prisma.holiday.create({
      data: {
        date: new Date(data.date),
        name: data.name,
        recurring_yearly: data.recurring_yearly ?? false,
        tenant_id: data.tenant_id,
      },
    });
    this.auditFireAndForget(actorUserId, 'create', 'Holiday', created.id, { date: data.date, name: data.name });
    return created;
  }

  async updateHoliday(id: string, data: { date?: string; name?: string; recurring_yearly?: boolean }, actorUserId?: string) {
    const before = await this.prisma.holiday.findUnique({ where: { id } });
    const updateData: any = {};
    if (data.date) updateData.date = new Date(data.date);
    if (data.name !== undefined) updateData.name = data.name;
    if (data.recurring_yearly !== undefined) updateData.recurring_yearly = data.recurring_yearly;
    const updated = await this.prisma.holiday.update({ where: { id }, data: updateData });
    this.auditFireAndForget(actorUserId, 'update', 'Holiday', id, { before, after: data });
    return updated;
  }

  async deleteHoliday(id: string, actorUserId?: string) {
    const before = await this.prisma.holiday.findUnique({ where: { id } });
    await this.prisma.holiday.delete({ where: { id } });
    this.auditFireAndForget(actorUserId, 'delete', 'Holiday', id, { before });
    return { deleted: true };
  }

  private async isHoliday(date: Date, tenantId?: string): Promise<boolean> {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    // Filtro de tenant: feriados globais (tenant_id NULL) + feriados do tenant
    const tenantFilter = tenantId
      ? { tenant_id: tenantId }
      : {};

    // Check exact date holidays
    const exactMatch = await this.prisma.holiday.findFirst({
      where: {
        date: { gte: dayStart, lte: dayEnd },
        recurring_yearly: false,
        ...tenantFilter,
      },
    });
    if (exactMatch) return true;

    // Check recurring yearly holidays (same month + day, any year)
    const month = date.getMonth() + 1;
    const day = date.getDate();
    if (tenantId) {
      const recurringMatch = await this.prisma.$queryRaw`
        SELECT id FROM "Holiday"
        WHERE recurring_yearly = true
          AND EXTRACT(MONTH FROM date) = ${month}
          AND EXTRACT(DAY FROM date) = ${day}
          AND (tenant_id = ${tenantId} OR tenant_id IS NULL)
        LIMIT 1
      ` as any[];
      return recurringMatch.length > 0;
    }
    const recurringMatch = await this.prisma.$queryRaw`
      SELECT id FROM "Holiday"
      WHERE recurring_yearly = true
        AND EXTRACT(MONTH FROM date) = ${month}
        AND EXTRACT(DAY FROM date) = ${day}
      LIMIT 1
    ` as any[];
    return recurringMatch.length > 0;
  }

  // ─── Recurrence ───────────────────────────────────────

  async expandRecurrence(parentEvent: any) {
    const rule = parentEvent.recurrence_rule;
    if (!rule) return [];

    const startAt = new Date(parentEvent.start_at);
    const endAt = parentEvent.end_at ? new Date(parentEvent.end_at) : null;

    // Calcular duração: prioridade → end_at, appointment_type.duration, fallback 30min
    let duration: number;
    if (endAt) {
      duration = endAt.getTime() - startAt.getTime();
    } else if (parentEvent.appointment_type_id) {
      const apptType = parentEvent.appointment_type?.duration
        ?? (await this.prisma.appointmentType.findUnique({
            where: { id: parentEvent.appointment_type_id },
            select: { duration: true },
          }))?.duration;
      duration = (apptType || 30) * 60 * 1000;
    } else {
      duration = 30 * 60 * 1000;
    }
    const recurrenceEnd = parentEvent.recurrence_end
      ? new Date(parentEvent.recurrence_end)
      : new Date(startAt.getTime() + 90 * 24 * 60 * 60 * 1000); // 90 dias

    const dates: Date[] = [];
    let cursor = new Date(startAt);

    const advanceCursor = () => {
      switch (rule) {
        case 'DAILY':
          cursor.setDate(cursor.getDate() + 1);
          break;
        case 'WEEKLY':
          cursor.setDate(cursor.getDate() + 7);
          break;
        case 'BIWEEKLY':
          cursor.setDate(cursor.getDate() + 14);
          break;
        case 'MONTHLY':
          cursor.setMonth(cursor.getMonth() + 1);
          break;
        case 'CUSTOM':
          cursor.setDate(cursor.getDate() + 1);
          break;
      }
    };

    // Gerar datas (pular a primeira que ja e o pai)
    advanceCursor();
    while (cursor <= recurrenceEnd && dates.length < 365) {
      if (rule === 'CUSTOM') {
        const dow = cursor.getDay();
        if ((parentEvent.recurrence_days || []).includes(dow)) {
          dates.push(new Date(cursor));
        }
      } else {
        dates.push(new Date(cursor));
      }
      advanceCursor();
    }

    // Criar instancias filhas em batch
    if (dates.length === 0) return [];

    // Buscar lembretes do evento pai para replicar nos filhos
    const parentReminders = parentEvent.reminders?.length
      ? parentEvent.reminders
      : await this.prisma.eventReminder.findMany({
          where: { event_id: parentEvent.id },
          select: { minutes_before: true, channel: true },
        });

    // Processar em lotes de 20 para não sobrecarregar o pool de conexões do DB
    const BATCH_SIZE = 20;
    const children: any[] = [];
    const createChild = async (d: Date) => {
      const childStart = new Date(d);
      childStart.setHours(startAt.getHours(), startAt.getMinutes(), startAt.getSeconds());
      const childEnd = new Date(childStart.getTime() + duration);

      // Bug fix 2026-05-10 (PR1 #8): tenant_id do parent pode ser null em
      // eventos criados antes do hardening 2026-05-07 (legacy). Sem o
      // tenantOrDefault, child herda null → quebra com Prisma NOT NULL
      // violation OU vaza pra todos os tenants no findAll (sem filtro de
      // tenant). Usar mesmo helper que this.create() pra manter consistente.
      const child = await this.prisma.calendarEvent.create({
        data: {
          type: parentEvent.type,
          title: parentEvent.title,
          description: parentEvent.description,
          start_at: childStart,
          end_at: childEnd,
          all_day: parentEvent.all_day,
          // Bug fix 2026-05-10 (PR3 medio #12): forca AGENDADO em filhos
          // novos. Antes herdava parentEvent.status — se o pai foi marcado
          // CONCLUIDO/CANCELADO antes de virar recorrente (raro mas possivel
          // via update), filhos nasciam com status terminal e nem apareciam
          // na agenda. AGENDADO eh o estado correto pra evento futuro recem
          // criado, independente do pai.
          status: 'AGENDADO',
          priority: parentEvent.priority || 'NORMAL',
          color: parentEvent.color,
          location: parentEvent.location,
          lead_id: parentEvent.lead_id,
          legal_case_id: parentEvent.legal_case_id,
          assigned_user_id: parentEvent.assigned_user_id,
          created_by_id: parentEvent.created_by_id,
          appointment_type_id: parentEvent.appointment_type_id,
          tenant_id: tenantOrDefault(parentEvent.tenant_id),
          parent_event_id: parentEvent.id,
          // Replicar lembretes do pai nos filhos
          ...(parentReminders.length > 0
            ? {
                reminders: {
                  create: parentReminders.map((r: any) => ({
                    minutes_before: r.minutes_before,
                    channel: r.channel ?? 'PUSH',
                  })),
                },
              }
            : {}),
        },
        include: { reminders: true },
      });

      // Enfileirar lembretes WhatsApp/Email para o filho
      if (child.reminders?.length) {
        await this.enqueueReminders(child.id, child.start_at, child.reminders);
      }

      return child;
    };

    for (let i = 0; i < dates.length; i += BATCH_SIZE) {
      const batch = dates.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(batch.map(createChild));
      children.push(...batchResults);
    }

    this.logger.log(`Criadas ${children.length} instancias recorrentes (com lembretes) para evento ${parentEvent.id}`);
    return children;
  }

  /**
   * Bug fix 2026-05-10 (PR3 medio #7): documentado escopo da propagacao.
   *
   * Propagados pra todos os filhos da serie:
   *   - title, description, type, priority, location, assigned_user_id
   *
   * NAO propagados (intencionalmente — cada filho tem o proprio):
   *   - start_at / end_at (cada ocorrencia tem horario fixo na serie)
   *   - status (cada ocorrencia pode estar concluida/cancelada
   *     individualmente — propagar quebraria audit do que ja aconteceu)
   *   - recurrence_rule (so faz sentido no parent)
   *
   * Se assigned_user_id mudar, NAO re-enfileira reminders dos filhos
   * (essa propagacao geraria N round-trips ao Redis pra serie longa).
   * Se for critico atualizar reminders, usar /events/:id (cada filho
   * individual) — `update` ja trata reassign corretamente desde PR2 #8.
   */
  async updateRecurrenceAll(parentId: string, data: any) {
    // Atualizar pai
    const parent = await this.update(parentId, data);
    // Atualizar todos os filhos
    const updateData: any = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.location !== undefined) updateData.location = data.location;
    if (data.assigned_user_id !== undefined) updateData.assigned_user_id = data.assigned_user_id;

    if (Object.keys(updateData).length > 0) {
      const result = await this.prisma.calendarEvent.updateMany({
        where: { parent_event_id: parentId },
        data: updateData,
      });
      this.logger.log(`[Recurrence] Propagado pra ${result.count} filho(s) da serie ${parentId}`);
    }
    return parent;
  }

  async removeRecurrenceAll(parentId: string) {
    // Bug fix 2026-05-10 (PR2 #9): antes deleteMany direto deixava jobs
    // BullMQ orfaos pra cada filho — workers consumiam ciclos tentando
    // processar reminder de evento ja deletado, log spam de "Reminder X
    // nao encontrado", memory leak no Redis. Agora cancelamos jobs ANTES
    // de deletar (cancelReminderJobs eh idempotente).
    const children = await this.prisma.calendarEvent.findMany({
      where: { parent_event_id: parentId },
      select: { id: true },
    });
    for (const child of children) {
      await this.cancelReminderJobs(child.id);
    }
    await this.cancelReminderJobs(parentId);

    // Deletar filhos primeiro, depois o pai
    await this.prisma.calendarEvent.deleteMany({ where: { parent_event_id: parentId } });
    await this.prisma.calendarEvent.delete({ where: { id: parentId } });
    return { deleted: true, childCount: children.length };
  }

  // ─── Search ───────────────────────────────────────────

  async search(query: string, tenantId?: string) {
    return this.prisma.calendarEvent.findMany({
      where: {
        ...(tenantId ? { tenant_id: tenantId } : {}),
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
        ],
      },
      include: {
        assigned_user: { select: { id: true, name: true } },
        lead: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { start_at: 'desc' },
      take: 20,
    });
  }

  // ─── ICS Export ───────────────────────────────────────

  async exportICS(eventIds: string[]): Promise<string> {
    const events = await this.prisma.calendarEvent.findMany({
      where: { id: { in: eventIds } },
      include: {
        assigned_user: { select: { name: true } },
        lead: { select: { name: true } },
      },
    });

    // UTC naive: datas armazenadas como horário local em UTC — extrair componentes UTC
    // O TZID no ICS é America/Sao_Paulo, então os valores devem ser horário local (= UTC raw)
    const formatIcsLocalDate = (d: Date) => {
      const y = d.getUTCFullYear();
      const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
      const da = String(d.getUTCDate()).padStart(2, '0');
      const h = String(d.getUTCHours()).padStart(2, '0');
      const mi = String(d.getUTCMinutes()).padStart(2, '0');
      const s = String(d.getUTCSeconds()).padStart(2, '0');
      return `${y}${mo}${da}T${h}${mi}${s}`;
    };

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//LexCRM//Calendar//PT',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      // VTIMEZONE para America/Sao_Paulo
      'BEGIN:VTIMEZONE',
      'TZID:America/Sao_Paulo',
      'BEGIN:STANDARD',
      'DTSTART:19700101T000000',
      'TZOFFSETFROM:-0300',
      'TZOFFSETTO:-0300',
      'TZNAME:BRT',
      'END:STANDARD',
      'END:VTIMEZONE',
    ];

    for (const evt of events) {
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${evt.id}@lexcrm`);
      lines.push(`DTSTART;TZID=America/Sao_Paulo:${formatIcsLocalDate(evt.start_at)}`);
      if (evt.end_at) lines.push(`DTEND;TZID=America/Sao_Paulo:${formatIcsLocalDate(evt.end_at)}`);
      lines.push(`SUMMARY:${(evt.title || '').replace(/[,;\\]/g, ' ')}`);
      if (evt.description) lines.push(`DESCRIPTION:${evt.description.replace(/\n/g, '\\n').replace(/[,;\\]/g, ' ')}`);
      if (evt.location) lines.push(`LOCATION:${evt.location.replace(/[,;\\]/g, ' ')}`);
      lines.push(`STATUS:${evt.status === 'CONFIRMADO' ? 'CONFIRMED' : evt.status === 'CANCELADO' ? 'CANCELLED' : 'TENTATIVE'}`);
      lines.push(`CREATED:${formatIcsLocalDate(evt.created_at)}`);
      lines.push(`LAST-MODIFIED:${formatIcsLocalDate(evt.updated_at)}`);
      lines.push('END:VEVENT');
    }

    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  // ─── Ownership Check ──────────────────────────────────

  async checkOwnership(eventId: string, userId: string, userRoles: string | string[], tenantId?: string): Promise<boolean> {
    if (isAdmin(userRoles)) return true;
    const event = await this.prisma.calendarEvent.findUnique({
      where: { id: eventId },
      select: { created_by_id: true, assigned_user_id: true, tenant_id: true },
    });
    if (!event) throw new NotFoundException('Evento nao encontrado');
    // Tenant isolation check
    if (tenantId && event.tenant_id && event.tenant_id !== tenantId) return false;
    return event.created_by_id === userId ||
      (event.assigned_user_id !== null && event.assigned_user_id === userId);
  }

  // ─── Comments ─────────────────────────────────────────

  async addComment(eventId: string, userId: string, text: string) {
    const comment = await (this.prisma as any).calendarEventComment.create({
      data: { event_id: eventId, user_id: userId, text },
      include: { user: { select: { id: true, name: true } } },
    });

    // Notificar assigned e creator (exceto quem comentou)
    const event = await this.prisma.calendarEvent.findUnique({
      where: { id: eventId },
      select: { assigned_user_id: true, created_by_id: true, title: true },
    });
    if (event) {
      const notifyIds = new Set<string>();
      if (event.assigned_user_id && event.assigned_user_id !== userId) notifyIds.add(event.assigned_user_id);
      if (event.created_by_id !== userId) notifyIds.add(event.created_by_id);
      for (const uid of notifyIds) {
        try {
          this.chatGateway.emitCalendarUpdate(uid, {
            eventId,
            action: 'comment_added',
            title: event.title ?? '',
          });
        } catch {}
      }
    }

    return comment;
  }

  async findComments(eventId: string) {
    return (this.prisma as any).calendarEventComment.findMany({
      where: { event_id: eventId },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { created_at: 'asc' },
    });
  }

  // ─── Legal Case Tasks ─────────────────────────────────

  async findByLegalCase(legalCaseId: string, type?: string, tenantId?: string, userId?: string, roles?: string | string[]) {
    // Bug fix 2026-05-10 (PR2 #3): RBAC do processo. Antes nao-admin
    // listava eventos de processo de outro advogado (vazava description,
    // location, lead.phone via include nas listagens do TabAgenda).
    if (tenantId || userId) {
      const lc = await this.prisma.legalCase.findUnique({
        where: { id: legalCaseId },
        select: { tenant_id: true, lawyer_id: true },
      });
      if (!lc) throw new NotFoundException('Processo nao encontrado');
      if (tenantId && lc.tenant_id && lc.tenant_id !== tenantId) {
        throw new ForbiddenException('Processo de outro tenant');
      }
      if (userId && !isAdmin(roles || []) && lc.lawyer_id !== userId) {
        throw new ForbiddenException('Sem permissao para ver eventos deste processo');
      }
    }
    return this.prisma.calendarEvent.findMany({
      where: {
        legal_case_id: legalCaseId,
        ...(type ? { type } : {}),
        ...(tenantId ? { tenant_id: tenantId } : {}),
      },
      include: {
        assigned_user: { select: { id: true, name: true } },
        created_by: { select: { id: true, name: true } },
        completed_by: { select: { id: true, name: true } },
        _count: { select: { comments: true } },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  // ─── Migrate Tasks ────────────────────────────────────

  async migrateOrphanTasks(tenantId?: string) {
    // Bug fix 2026-05-10 (PR2 #4): admin de tenant A migrava tasks de
    // TODOS os tenants. `findFirst({ roles: { has: 'ADMIN' } })` pegava
    // qualquer admin (poderia ser de outro tenant). Calendar event criado
    // disparava 4 reminders WhatsApp por audiencia → spam massivo
    // cross-tenant. Agora exigimos tenantId e filtramos.
    if (!tenantId) {
      throw new BadRequestException('tenantId obrigatorio para migracao');
    }

    const orphanTasks = await this.prisma.task.findMany({
      where: { calendar_event_id: null, tenant_id: tenantId },
      include: { comments: true },
    });

    let migrated = 0;
    for (const task of orphanTasks) {
      // Admin do MESMO tenant (filter explicito) — sem isso, podia herdar
      // ADMIN de outro escritorio.
      const creatorId = task.assigned_user_id || (await this.prisma.user.findFirst({
        where: { roles: { has: 'ADMIN' }, tenant_id: tenantId },
        select: { id: true },
      }))?.id;
      if (!creatorId) continue;

      const event = await this.prisma.calendarEvent.create({
        data: {
          type: 'TAREFA',
          title: task.title,
          description: task.description,
          start_at: task.due_at || task.created_at,
          end_at: task.due_at ? new Date(task.due_at.getTime() + 30 * 60000) : null,
          status: task.status === 'CONCLUIDO' || task.status === 'CONCLUIDA' ? 'CONCLUIDO'
                : task.status === 'CANCELADA' ? 'CANCELADO'
                : 'AGENDADO',
          assigned_user_id: task.assigned_user_id,
          created_by_id: creatorId,
          lead_id: task.lead_id,
          conversation_id: task.conversation_id,
          legal_case_id: task.legal_case_id,
          tenant_id: tenantOrDefault(task.tenant_id || tenantId),
        },
      });

      await this.prisma.task.update({
        where: { id: task.id },
        data: { calendar_event_id: event.id },
      });

      // Migrar comentários
      for (const c of task.comments) {
        await (this.prisma as any).calendarEventComment.create({
          data: { event_id: event.id, user_id: c.user_id, text: c.text, created_at: c.created_at },
        });
      }
      migrated++;
    }

    // Migrar comentários de tasks já vinculadas (mesmo filtro)
    const linkedTasks = await this.prisma.task.findMany({
      where: { calendar_event_id: { not: null }, tenant_id: tenantId },
      include: { comments: true },
    });
    let commentsMigrated = 0;
    for (const task of linkedTasks) {
      for (const c of task.comments) {
        const exists = await (this.prisma as any).calendarEventComment.findFirst({
          where: { event_id: task.calendar_event_id!, user_id: c.user_id, text: c.text },
        });
        if (!exists) {
          await (this.prisma as any).calendarEventComment.create({
            data: { event_id: task.calendar_event_id!, user_id: c.user_id, text: c.text, created_at: c.created_at },
          });
          commentsMigrated++;
        }
      }
    }

    return { orphanTasksMigrated: migrated, commentsMigrated };
  }

  // ─── Re-envio manual de notificação ──────────────────────────────────────────

  // Bug fix 2026-05-10 (PR3 medio #5): adicionar actorUserId pra audit log.
  // Re-envio manual de WhatsApp pago precisa rastrear quem disparou pra
  // investigar abuso interno (estagiario disparando 100x pro mesmo cliente).
  async notifyEvent(eventId: string, actorUserId?: string): Promise<{ queued: boolean; message: string }> {
    const event = await this.prisma.calendarEvent.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        type: true,
        status: true,
        title: true,
        lead: { select: { phone: true } },
      },
    });

    if (!event) {
      throw new NotFoundException(`Evento ${eventId} não encontrado`);
    }

    if (!['AUDIENCIA', 'PERICIA'].includes(event.type)) {
      throw new BadRequestException(
        `Notificação manual disponível apenas para Audiência e Perícia (tipo atual: ${event.type})`,
      );
    }

    if (!event.lead?.phone) {
      throw new BadRequestException(
        'Cliente vinculado ao evento não possui telefone cadastrado',
      );
    }

    if (['CANCELADO', 'CONCLUIDO'].includes(event.status)) {
      throw new BadRequestException(
        `Evento está ${event.status} — notificação não enviada`,
      );
    }

    // Remove job pendente anterior para evitar duplicata
    try {
      const existing = await this.reminderQueue.getJob(`hearing-notify-${eventId}`);
      if (existing) await existing.remove();
    } catch {}

    // Enfileira sem delay (envio imediato)
    await this.reminderQueue.add(
      'notify-hearing-scheduled',
      { eventId },
      {
        jobId: `hearing-notify-manual-${eventId}-${Date.now()}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );

    this.logger.log(`[NOTIFY] Re-envio manual enfileirado para evento ${eventId} (${event.type}: "${event.title}") por user ${actorUserId || 'desconhecido'}`);
    this.auditFireAndForget(actorUserId, 'notify_manual', 'CalendarEvent', eventId, {
      type: event.type,
      title: event.title,
      lead_phone_redacted: event.lead?.phone ? `***${event.lead.phone.slice(-4)}` : null,
    });
    return { queued: true, message: `Notificação de ${event.type === 'PERICIA' ? 'perícia' : 'audiência'} enfileirada com sucesso` };
  }
}
