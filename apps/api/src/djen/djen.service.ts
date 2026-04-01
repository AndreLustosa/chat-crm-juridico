import { Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { CalendarService } from '../calendar/calendar.service';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

function toDateStr(date: Date): string {
  return date.toISOString().slice(0, 10); // yyyy-MM-dd
}

function subtractDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - days);
  return d;
}

function addBusinessDays(date: Date, days: number): Date {
  const d = new Date(date);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

// ─── Classificação de publicações DJEN ─────────────────────────

interface ClassifiedPublication {
  taskTitle: string;
  taskDescription: string;
  dueDays: number; // dias úteis para o prazo
  priority: 'URGENTE' | 'NORMAL' | 'BAIXA';
}

function classifyPublication(
  tipoComunicacao: string | null,
  assunto: string | null,
  conteudo: string,
): ClassifiedPublication | null {
  const text = [tipoComunicacao, assunto, conteudo].join(' ').toLowerCase();

  // Ordem: mais específico primeiro
  if (/sentença|sentenca/.test(text)) {
    return {
      taskTitle: 'Analisar sentença e orientar cliente',
      taskDescription: 'Publicação de sentença recebida via DJEN. Analisar mérito, prazo recursal e orientar cliente.',
      dueDays: 15,
      priority: 'URGENTE',
    };
  }
  if (/acórdão|acordao/.test(text)) {
    return {
      taskTitle: 'Analisar acórdão e recurso cabível',
      taskDescription: 'Publicação de acórdão recebida via DJEN. Analisar decisão e avaliar cabimento de recurso.',
      dueDays: 15,
      priority: 'URGENTE',
    };
  }
  if (/citação|citacao/.test(text)) {
    return {
      taskTitle: 'Elaborar contestação — prazo iniciado',
      taskDescription: 'Citação publicada no DJEN. Verificar prazo para contestação e elaborar defesa.',
      dueDays: 15,
      priority: 'URGENTE',
    };
  }
  if (/audiência|audiencia|designada|designando/.test(text)) {
    return {
      taskTitle: 'Preparar audiência e notificar cliente',
      taskDescription: 'Audiência designada via DJEN. Preparar documentos, testemunhas e notificar cliente.',
      dueDays: 3,
      priority: 'URGENTE',
    };
  }
  if (/pagamento|art.*523|cumpri/.test(text)) {
    return {
      taskTitle: 'Notificar cliente — prazo de pagamento',
      taskDescription: 'Intimação de pagamento recebida via DJEN. Notificar cliente sobre prazo legal.',
      dueDays: 5,
      priority: 'URGENTE',
    };
  }
  if (/manifestação|manifestacao|impugnação|impugnacao/.test(text)) {
    return {
      taskTitle: 'Elaborar manifestação / impugnação',
      taskDescription: 'Intimação para manifestação recebida via DJEN.',
      dueDays: 10,
      priority: 'NORMAL',
    };
  }
  if (/trânsito|transito em julgado/.test(text)) {
    return {
      taskTitle: 'Iniciar cumprimento de sentença',
      taskDescription: 'Trânsito em julgado certificado via DJEN. Avaliar início da execução.',
      dueDays: 30,
      priority: 'NORMAL',
    };
  }
  if (/despacho|determinação|determinacao/.test(text)) {
    return {
      taskTitle: 'Cumprir determinação judicial',
      taskDescription: 'Despacho/determinação publicado no DJEN. Verificar providências necessárias.',
      dueDays: 10,
      priority: 'NORMAL',
    };
  }
  if (/julgamento|pauta/.test(text)) {
    return {
      taskTitle: 'Preparar sustentação oral',
      taskDescription: 'Processo incluído em pauta de julgamento via DJEN.',
      dueDays: 5,
      priority: 'URGENTE',
    };
  }

  return null; // publicação genérica, sem tarefa automática
}

// ─────────────────────────────────────────────────────────────────

// ─── Extração de data/hora de audiência do texto ───────────────────────────

function extractHearingDateTime(text: string): Date | null {
  // Busca a data próxima à palavra "audiência" para evitar false-positives
  const audiIdx = text.toLowerCase().search(/audiênc|audienc/);
  const slice = audiIdx >= 0
    ? text.slice(Math.max(0, audiIdx - 100), audiIdx + 300)
    : text.slice(0, 600);

  // Tenta formato DD/MM/YYYY
  const dateMatch = slice.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (!dateMatch) return null;

  const day = parseInt(dateMatch[1]);
  const month = parseInt(dateMatch[2]) - 1; // 0-indexed
  const year = parseInt(dateMatch[3]);

  // Sanidade: ano entre 2020 e 2040
  if (year < 2020 || year > 2040 || month < 0 || month > 11 || day < 1 || day > 31) return null;

  // Tenta extrair hora — "às 14h00", "às 14:00", "14h00"
  const timeMatch = slice.match(/(?:às\s+)?(\d{1,2})[h:](\d{2})?\s*(?:horas?)?/i);
  const hour = timeMatch ? Math.min(23, parseInt(timeMatch[1])) : 9;
  const minute = timeMatch ? Math.min(59, parseInt(timeMatch[2] || '0')) : 0;

  const d = new Date(year, month, day, hour, minute);
  return isNaN(d.getTime()) ? null : d;
}

@Injectable()
export class DjenService {
  private readonly logger = new Logger(DjenService.name);
  private readonly API_BASE = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao';

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly calendarService: CalendarService,
  ) {}

  /** Cron diário às 8h — sincroniza publicações de ontem e hoje */
  @Cron('0 8 * * *')
  async syncDaily() {
    const today = new Date();
    const yesterday = subtractDays(today, 1);
    this.logger.log('[DJEN] Iniciando sync diário...');
    await this.syncForDate(toDateStr(yesterday));
    await this.syncForDate(toDateStr(today));
    this.logger.log('[DJEN] Sync diário concluído.');
  }

  async syncForDate(date: string): Promise<{ date: string; saved: number; errors: number; tasksCreated: number }> {
    const oabNumber  = (await this.settings.get('DJEN_OAB_NUMBER'))  || '14209';
    const oabUf      = (await this.settings.get('DJEN_OAB_UF'))      || 'AL';
    const lawyerName = (await this.settings.get('DJEN_LAWYER_NAME')) || 'André Freire Lustosa';

    const params = new URLSearchParams({
      numeroOab: oabNumber,
      ufOab: oabUf,
      nomeAdvogado: lawyerName,
      dataDisponibilizacaoInicio: date,
      dataDisponibilizacaoFim: date,
    });

    let items: any[] = [];
    try {
      const res = await fetch(`${this.API_BASE}?${params}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        this.logger.warn(`[DJEN] API retornou ${res.status} para ${date}`);
        return { date, saved: 0, errors: 1, tasksCreated: 0 };
      }
      const data: any = await res.json();
      items = data?.items || data?.content || data?.data || (Array.isArray(data) ? data : []);
      this.logger.log(`[DJEN] ${items.length} publicações encontradas para ${date}`);
    } catch (e) {
      this.logger.error(`[DJEN] Erro ao consultar API para ${date}: ${e}`);
      return { date, saved: 0, errors: 1, tasksCreated: 0 };
    }

    let saved = 0;
    let errors = 0;
    let tasksCreated = 0;

    for (const item of items) {
      try {
        const comunicacaoId = item.id ?? item.idComunicacao ?? item.comunicacaoId;
        if (!comunicacaoId) continue;

        const numeroProcesso: string =
          item.numeroProcessoFormatado ||
          item.numeroProcesso ||
          item.numero_processo ||
          '';

        // Tenta vincular ao LegalCase pelo número do processo
        let legalCaseId: string | null = null;
        let legalCase: { id: string; lawyer_id: string; tenant_id: string | null } | null = null;

        if (numeroProcesso) {
          legalCase = await this.prisma.legalCase.findFirst({
            where: { case_number: numeroProcesso, in_tracking: true },
            select: { id: true, lawyer_id: true, tenant_id: true },
          });
          if (legalCase) legalCaseId = legalCase.id;
        }

        const dataDisp = item.dataDisponibilizacao
          ? new Date(item.dataDisponibilizacao)
          : new Date(date);

        const tipoComunicacao = item.tipoComunicacao || item.tipo || null;
        const assunto = item.assunto || null;
        const conteudo = item.conteudo || item.texto || item.descricao || '';

        const pub = await this.prisma.djenPublication.upsert({
          where: { comunicacao_id: Number(comunicacaoId) },
          update: { legal_case_id: legalCaseId },
          create: {
            comunicacao_id: Number(comunicacaoId),
            data_disponibilizacao: dataDisp,
            numero_processo: numeroProcesso,
            classe_processual: item.classeProcessual || item.classe || null,
            assunto,
            tipo_comunicacao: tipoComunicacao,
            conteudo,
            nome_advogado: item.nomeAdvogado || lawyerName,
            raw_json: item,
            legal_case_id: legalCaseId,
          },
        });
        saved++;

        // ─── Auto-criar tarefa/audiência ao vincular publicação a um processo ─────
        if (legalCase && pub) {
          const classification = classifyPublication(tipoComunicacao, assunto, conteudo);
          if (classification) {
            try {
              const taskTitle = `[DJEN] ${classification.taskTitle}`;

              // Evitar duplicatas: verificar se já existe tarefa idêntica nas últimas 48h
              const recent = await this.prisma.calendarEvent.findFirst({
                where: {
                  legal_case_id: legalCase.id,
                  title: taskTitle,
                  created_at: { gte: new Date(Date.now() - 48 * 60 * 60 * 1000) },
                },
                select: { id: true },
              });
              if (recent) {
                this.logger.log(`[DJEN] Tarefa duplicada ignorada: "${taskTitle}" (caso ${legalCase.id})`);
                continue;
              }

              const dueAt = addBusinessDays(dataDisp, classification.dueDays);
              const task = await this.calendarService.create({
                type: 'TAREFA',
                title: taskTitle,
                description: classification.taskDescription,
                start_at: dueAt.toISOString(),
                end_at: new Date(dueAt.getTime() + 30 * 60000).toISOString(),
                assigned_user_id: legalCase.lawyer_id,
                legal_case_id: legalCase.id,
                created_by_id: legalCase.lawyer_id,
                tenant_id: legalCase.tenant_id || undefined,
                priority: classification.priority,
                reminders: [
                  { minutes_before: 1440, channel: 'WHATSAPP' },
                ],
              });
              // Vincular tarefa à publicação
              if (task?.id) {
                await this.prisma.djenPublication.update({
                  where: { id: pub.id },
                  data: { auto_task_id: task.id },
                });
              }
              tasksCreated++;
              this.logger.log(
                `[DJEN] Tarefa automática criada para processo ${numeroProcesso}: "${classification.taskTitle}"`,
              );

              // ── Se for publicação de audiência, tentar criar evento no calendário ──
              const pubText = [tipoComunicacao, assunto, conteudo].join(' ').toLowerCase();
              if (/audiência|audiencia|designada|designando/.test(pubText)) {
                try {
                  const hearingDate = extractHearingDateTime(conteudo);
                  if (hearingDate) {
                    // Verificar se já existe AUDIENCIA nessa data para o mesmo processo
                    const existingAudiencia = await this.prisma.calendarEvent.findFirst({
                      where: {
                        legal_case_id: legalCase.id,
                        type: 'AUDIENCIA',
                        start_at: {
                          gte: new Date(hearingDate.getTime() - 86400000), // ±1 dia
                          lte: new Date(hearingDate.getTime() + 86400000),
                        },
                      },
                      select: { id: true },
                    });

                    if (!existingAudiencia) {
                      const endDate = new Date(hearingDate.getTime() + 60 * 60000); // +1h
                      await this.calendarService.create({
                        type: 'AUDIENCIA',
                        title: `[DJEN] Audiência — ${numeroProcesso}`,
                        description: `Audiência detectada automaticamente via DJEN.\n${assunto || ''}`,
                        start_at: hearingDate.toISOString(),
                        end_at: endDate.toISOString(),
                        assigned_user_id: legalCase.lawyer_id,
                        legal_case_id: legalCase.id,
                        created_by_id: legalCase.lawyer_id,
                        tenant_id: legalCase.tenant_id || undefined,
                        priority: 'URGENTE',
                        reminders: [
                          { minutes_before: 1440, channel: 'WHATSAPP' },
                          { minutes_before: 60, channel: 'WHATSAPP' },
                        ],
                      });
                      this.logger.log(
                        `[DJEN] Audiência automática criada: ${hearingDate.toISOString()} (caso ${legalCase.id})`,
                      );
                    }
                  }
                } catch (e: any) {
                  this.logger.warn(`[DJEN] Falha ao criar audiência automática: ${e.message}`);
                }
              }
            } catch (e: any) {
              this.logger.warn(`[DJEN] Falha ao criar tarefa automática: ${e.message}`);
            }
          }
        }
      } catch (e) {
        this.logger.error(`[DJEN] Erro ao salvar publicação: ${e}`);
        errors++;
      }
    }

    this.logger.log(`[DJEN] ${date}: ${saved} salvas, ${errors} erros, ${tasksCreated} tarefas criadas`);

    // ─── Reconciliação: vincula publicações sem processo a casos já existentes ─
    await this.reconcileUnlinkedPublications();

    return { date, saved, errors, tasksCreated };
  }

  /** Varre publicações não vinculadas e tenta associá-las a processos existentes pelo número */
  async reconcileUnlinkedPublications(): Promise<number> {
    const unlinked = await this.prisma.djenPublication.findMany({
      where: { legal_case_id: null, numero_processo: { not: '' } },
      select: { id: true, numero_processo: true },
    });

    if (unlinked.length === 0) return 0;

    let reconciled = 0;
    for (const pub of unlinked) {
      if (!pub.numero_processo) continue;
      const legalCase = await this.prisma.legalCase.findFirst({
        where: { case_number: pub.numero_processo, in_tracking: true },
        select: { id: true },
      });
      if (!legalCase) continue;

      await this.prisma.djenPublication.update({
        where: { id: pub.id },
        data: { legal_case_id: legalCase.id },
      });
      reconciled++;
    }

    if (reconciled > 0) {
      this.logger.log(`[DJEN] Reconciliação: ${reconciled} publicação(ões) vinculadas a processos existentes`);
    }
    return reconciled;
  }

  async findRecent(days = 7) {
    const since = subtractDays(new Date(), days);
    return this.prisma.djenPublication.findMany({
      where: { data_disponibilizacao: { gte: since } },
      include: {
        legal_case: {
          select: {
            id: true,
            case_number: true,
            legal_area: true,
            tracking_stage: true,
            lead: { select: { name: true } },
          },
        },
      },
      orderBy: { data_disponibilizacao: 'desc' },
      take: 100,
    });
  }

  async findAll(opts: {
    days?: string;
    viewed?: string;
    archived?: string;
    page?: string;
    limit?: string;
  }) {
    const days = opts.days ? parseInt(opts.days) : 30;
    const since = subtractDays(new Date(), days);
    const page = opts.page ? parseInt(opts.page) : 1;
    const limit = Math.min(opts.limit ? parseInt(opts.limit) : 50, 200);
    const skip = (page - 1) * limit;

    const where: any = { data_disponibilizacao: { gte: since } };

    if (opts.archived === 'true') {
      where.archived = true;
    } else {
      where.archived = false;
      if (opts.viewed === 'false') {
        where.viewed_at = null;
      } else if (opts.viewed === 'true') {
        where.viewed_at = { not: null };
      }
    }

    const [items, total] = await Promise.all([
      this.prisma.djenPublication.findMany({
        where,
        include: {
          legal_case: {
            select: {
              id: true,
              case_number: true,
              legal_area: true,
              tracking_stage: true,
              lead: { select: { name: true } },
            },
          },
        },
        orderBy: { data_disponibilizacao: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.djenPublication.count({ where }),
    ]);

    const unreadCount = await this.prisma.djenPublication.count({
      where: { viewed_at: null, archived: false },
    });

    return { items, total, page, limit, unreadCount };
  }

  async findByCase(legalCaseId: string) {
    return this.prisma.djenPublication.findMany({
      where: { legal_case_id: legalCaseId },
      orderBy: { data_disponibilizacao: 'desc' },
    });
  }

  async markViewed(id: string) {
    return this.prisma.djenPublication.update({
      where: { id },
      data: { viewed_at: new Date() },
    });
  }

  async archive(id: string) {
    return this.prisma.djenPublication.update({
      where: { id },
      data: { archived: true, viewed_at: new Date() },
    });
  }

  async unarchive(id: string) {
    return this.prisma.djenPublication.update({
      where: { id },
      data: { archived: false },
    });
  }

  async markAllViewed() {
    const result = await this.prisma.djenPublication.updateMany({
      where: { viewed_at: null, archived: false },
      data: { viewed_at: new Date() },
    });
    return { updated: result.count };
  }

  async createProcessFromPublication(
    id: string,
    lawyerId: string,
    tenantId?: string,
    leadId?: string,
    trackingStage?: string,
    leadName?: string,
    leadPhone?: string,
    legalArea?: string,
  ) {
    const pub = await this.prisma.djenPublication.findUniqueOrThrow({ where: { id } });

    // Impede criação duplicada para a mesma publicação
    if (pub.legal_case_id) {
      const existing = await this.prisma.legalCase.findUnique({ where: { id: pub.legal_case_id } });
      if (existing) throw new ConflictException('Processo já criado para esta publicação.');
    }

    // Obrigatoriedade de cliente: leadId, leadName+leadPhone, ou nenhum (placeholder)
    if (!leadId && (!leadName?.trim() || !leadPhone?.trim())) {
      throw new BadRequestException('Informe o cliente (leadId ou nome + telefone) para criar o processo.');
    }

    // ─── Resolve o Lead ──────────────────────────────────────────────────────
    let lead: { id: string };

    if (leadId) {
      // Opção A: lead existente informado por ID
      const realLead = await this.prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } });
      if (!realLead) throw new BadRequestException('Contato informado não encontrado.');
      lead = realLead;
    } else {
      // Opção B: cadastrar novo cliente com nome + telefone
      const phone = leadPhone!.trim();
      const name = leadName!.trim();
      // Verifica se já existe lead com esse telefone no mesmo tenant para evitar duplicatas
      const existingByPhone = await this.prisma.lead.findFirst({
        where: {
          phone: { contains: phone.replace(/\D/g, '') },
          ...(tenantId ? { tenant_id: tenantId } : { tenant_id: null }),
        },
        select: { id: true },
      });
      if (existingByPhone) {
        // Se lead já existe mas não tem nome, atualiza com o nome fornecido
        const existing = await this.prisma.lead.findUnique({ where: { id: existingByPhone.id }, select: { id: true, name: true } });
        if (existing && !existing.name?.trim()) {
          await this.prisma.lead.update({ where: { id: existing.id }, data: { name } });
        }
        lead = existingByPhone;
      } else {
        lead = await this.prisma.lead.create({ data: { name, phone, tenant_id: tenantId } });
      }
    }

    // ─── Resolve área jurídica: usa valor do frontend (IA) se disponível ─────
    const VALID_AREAS = ['CIVIL','TRABALHISTA','PREVIDENCIARIO','TRIBUTARIO','FAMILIA','CRIMINAL','CONSUMIDOR','EMPRESARIAL','ADMINISTRATIVO'];
    let resolvedLegalArea: string;
    if (legalArea && VALID_AREAS.includes(legalArea.toUpperCase())) {
      resolvedLegalArea = legalArea.toUpperCase();
    } else {
      // Fallback: detecta pelo conteúdo da publicação
      const text = [pub.tipo_comunicacao, pub.assunto, pub.conteudo].join(' ').toLowerCase();
      resolvedLegalArea = 'CIVIL';
      if (/trabalh/.test(text)) resolvedLegalArea = 'TRABALHISTA';
      else if (/previd|inss/.test(text)) resolvedLegalArea = 'PREVIDENCIARIO';
      else if (/tribut|fiscal/.test(text)) resolvedLegalArea = 'TRIBUTARIO';
      else if (/famil|divórcio|divorcio/.test(text)) resolvedLegalArea = 'FAMILIA';
      else if (/crimin/.test(text)) resolvedLegalArea = 'CRIMINAL';
    }

    // ─── Valida e resolve o estágio de entrada no kanban ─────────────────────
    const VALID_TRACKING = [
      'DISTRIBUIDO', 'CITACAO', 'CONTESTACAO', 'REPLICA', 'INSTRUCAO',
      'JULGAMENTO', 'RECURSO', 'TRANSITADO', 'EXECUCAO', 'ENCERRADO',
    ];
    const finalTrackingStage = (trackingStage && VALID_TRACKING.includes(trackingStage))
      ? trackingStage
      : 'DISTRIBUIDO';

    const legalCase = await this.prisma.legalCase.create({
      data: {
        lead_id: lead.id,
        lawyer_id: lawyerId,
        tenant_id: tenantId,
        case_number: pub.numero_processo,
        stage: 'PROTOCOLO',
        tracking_stage: finalTrackingStage,
        in_tracking: true,
        filed_at: pub.data_disponibilizacao,
        legal_area: resolvedLegalArea,
        stage_changed_at: new Date(),
      },
    });

    // Vincular publicação ao processo recém criado
    await this.prisma.djenPublication.update({
      where: { id },
      data: { legal_case_id: legalCase.id, viewed_at: new Date() },
    });

    // Vincular todas as demais publicações com o mesmo número de processo
    if (pub.numero_processo) {
      const linked = await this.prisma.djenPublication.updateMany({
        where: {
          numero_processo: pub.numero_processo,
          id: { not: id }, // exclui a publicação principal já vinculada
          legal_case_id: null,
        },
        data: { legal_case_id: legalCase.id },
      });
      if (linked.count > 0) {
        this.logger.log(
          `[DJEN] ${linked.count} publicação(ões) extra(s) vinculadas automaticamente ao processo ${legalCase.id} pelo número ${pub.numero_processo}`,
        );
      }
    }

    // Converter lead em cliente: sai da lista de leads e passa a constar como cliente
    await this.prisma.lead.update({
      where: { id: lead.id },
      data: {
        is_client: true,
        became_client_at: new Date(),
        stage: 'FINALIZADO',
        stage_entered_at: new Date(),
      },
    });

    this.logger.log(
      `[DJEN] Processo ${legalCase.id} criado a partir da publicação ${id} | ` +
      `lead=${lead.id} convertido em cliente | stage=${finalTrackingStage}`,
    );
    return legalCase;
  }

  async analyzePublication(id: string): Promise<{
    resumo: string;
    urgencia: 'URGENTE' | 'NORMAL' | 'BAIXA';
    tipo_acao: string;
    prazo_dias: number;
    estagio_sugerido: string | null;
    tarefa_titulo: string;
    tarefa_descricao: string;
    orientacoes: string;
    event_type: 'AUDIENCIA' | 'PRAZO' | 'TAREFA';
    model_used: string;
    // Dados extraídos da publicação
    parte_autora: string | null;
    parte_rea: string | null;
    juizo: string | null;
    area_juridica: string | null;
    valor_causa: string | null;
    data_audiencia: string | null;
    data_prazo: string | null;
  }> {
    const pub = await this.prisma.djenPublication.findUniqueOrThrow({
      where: { id },
      include: {
        legal_case: {
          select: { case_number: true, legal_area: true, tracking_stage: true, lead: { select: { id: true, name: true } } },
        },
      },
    });

    // Bloquear análise se publicação não está vinculada a nenhum processo
    if (!pub.legal_case_id) {
      throw new BadRequestException(
        'Esta publicação não está vinculada a nenhum processo. Vincule-a a um processo antes de criar eventos.'
      );
    }

    const STAGES = [
      'DISTRIBUIDO', 'CITACAO', 'CONTESTACAO', 'REPLICA', 'INSTRUCAO',
      'JULGAMENTO', 'RECURSO', 'TRANSITADO', 'EXECUCAO', 'ENCERRADO',
    ];

    const DEFAULT_DJEN_PROMPT = `Você é um assistente jurídico especializado em análise de publicações do DJEN (Diário da Justiça Eletrônico) brasileiro. Analise a publicação e retorne um JSON com os campos abaixo. Extraia as informações DIRETAMENTE do texto da publicação quando disponíveis — não invente dados.

Campos obrigatórios:
- resumo: string (máx 3 frases, PT-BR, linguagem direta para o advogado)
- urgencia: "URGENTE" | "NORMAL" | "BAIXA"
- tipo_acao: string (ação concreta que o advogado deve tomar)
- prazo_dias: number (prazo em dias ÚTEIS)
- estagio_sugerido: string | null (um de: ${STAGES.join(', ')})
- tarefa_titulo: string (título curto da tarefa)
- tarefa_descricao: string (descrição da tarefa, máx 200 chars)
- orientacoes: string (observações estratégicas, máx 300 chars)
- event_type: "AUDIENCIA" | "PRAZO" | "TAREFA" (AUDIENCIA se há audiência/sessão/julgamento com data marcada no texto; PRAZO se há prazo processual para o advogado cumprir; TAREFA para outros casos)

Campos de extração (null se não encontrado no texto):
- parte_autora: string | null (nome do autor/requerente/exequente)
- parte_rea: string | null (nome do réu/requerido/executado)
- juizo: string | null (vara, juízo ou tribunal onde tramita)
- area_juridica: string | null (ex: "Trabalhista", "Cível", "Previdenciário", "Criminal", "Consumidor", "Família", "Tributário")
- valor_causa: string | null (valor da causa se mencionado, formato "R$ X.XXX,XX")
- data_audiencia: string | null (data e hora da audiência/sessão se mencionada NO TEXTO, formato ISO "YYYY-MM-DDTHH:MM:00", null se não for publicação de audiência — EXTRAIA DO TEXTO, não invente)
- data_prazo: string | null (data limite do prazo processual se mencionada NO TEXTO, formato ISO "YYYY-MM-DDTHH:MM:00", null se não houver prazo com data explícita)

Critérios de urgência: URGENTE = citação/intimação com prazo curto (≤15 dias), sentença, audiência marcada. NORMAL = contestação, manifestação, despacho de rotina. BAIXA = distribuição, informativo, arquivamento.
Critérios de estágio: citação→CITACAO, contestação→CONTESTACAO, réplica→REPLICA, audiência/instrução→INSTRUCAO, sentença/julgamento→JULGAMENTO, recurso→RECURSO, trânsito em julgado→TRANSITADO, execução→EXECUCAO, distribuição→DISTRIBUIDO, encerramento/extinção→ENCERRADO.`;

    // Usa prompt customizado do banco (se existir) ou o prompt padrão
    const customPrompt = await this.settings.getDjenPrompt();
    const systemPrompt = customPrompt || DEFAULT_DJEN_PROMPT;

    const userPrompt = `PUBLICAÇÃO DO DJEN
Data: ${new Date(pub.data_disponibilizacao).toLocaleDateString('pt-BR')}
Tipo: ${pub.tipo_comunicacao || 'Não informado'}
Número do processo: ${pub.numero_processo}
Assunto: ${pub.assunto || 'Não informado'}
Classe processual: ${pub.classe_processual || 'Não informado'}
${pub.legal_case ? `Processo vinculado: ${pub.legal_case.lead?.name || ''} — ${pub.legal_case.legal_area || ''} — Estágio atual: ${pub.legal_case.tracking_stage || ''}` : 'Processo: Não vinculado'}

CONTEÚDO COMPLETO:
${pub.conteudo.slice(0, 2000)}`;

    // Resolve modelo configurado
    const configuredModel = await this.settings.getDjenModel();
    const isAnthropic = configuredModel.startsWith('claude');

    let raw = '{}';

    if (isAnthropic) {
      const anthropicKey = (await this.settings.get('ANTHROPIC_API_KEY')) || process.env.ANTHROPIC_API_KEY;
      if (!anthropicKey) throw new BadRequestException('ANTHROPIC_API_KEY não configurada.');

      const client = new Anthropic({ apiKey: anthropicKey });
      const message = await client.messages.create({
        model: configuredModel,
        max_tokens: 1024,
        temperature: 0.2,
        system: systemPrompt + '\n\nResponda APENAS com JSON válido, sem markdown ou explicações extras.',
        messages: [{ role: 'user', content: userPrompt }],
      });
      raw = (message.content[0] as any)?.text || '{}';
      // Extrai JSON de possível markdown
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) raw = jsonMatch[0];
    } else {
      const openaiKey = (await this.settings.get('OPENAI_API_KEY')) || process.env.OPENAI_API_KEY;
      if (!openaiKey) throw new BadRequestException('OPENAI_API_KEY não configurada.');

      const openai = new OpenAI({ apiKey: openaiKey });
      const completion = await openai.chat.completions.create({
        model: configuredModel,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });
      raw = completion.choices[0]?.message?.content || '{}';
    }

    let parsed: any = {};
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }

    const result = {
      resumo: parsed.resumo || 'Não foi possível gerar o resumo.',
      urgencia: (['URGENTE', 'NORMAL', 'BAIXA'].includes(parsed.urgencia) ? parsed.urgencia : 'NORMAL') as any,
      tipo_acao: parsed.tipo_acao || 'Verificar publicação',
      prazo_dias: typeof parsed.prazo_dias === 'number' ? parsed.prazo_dias : 15,
      estagio_sugerido: STAGES.includes(parsed.estagio_sugerido) ? parsed.estagio_sugerido : null,
      tarefa_titulo: parsed.tarefa_titulo || 'Verificar publicação DJEN',
      tarefa_descricao: parsed.tarefa_descricao || '',
      orientacoes: parsed.orientacoes || '',
      event_type: (['AUDIENCIA', 'PRAZO', 'TAREFA'].includes(parsed.event_type) ? parsed.event_type : 'TAREFA') as 'AUDIENCIA' | 'PRAZO' | 'TAREFA',
      model_used: configuredModel,
      // Dados extraídos
      parte_autora: parsed.parte_autora || null,
      parte_rea: parsed.parte_rea || null,
      juizo: parsed.juizo || null,
      area_juridica: parsed.area_juridica || null,
      valor_causa: parsed.valor_causa || null,
      data_audiencia: parsed.data_audiencia || null,
      data_prazo: parsed.data_prazo || null,
    };

    // Salva insights da análise na memória do lead para enriquecer contexto futuro da IA
    const leadId = (pub.legal_case as any)?.lead?.id;
    if (leadId) {
      this.saveAnalysisToMemory(leadId, pub, result).catch(e =>
        this.logger.warn(`[DJEN] Falha ao salvar análise na memória do lead ${leadId}: ${e.message}`),
      );
    }

    return result;
  }

  /** Salva os insights da análise DJEN na AiMemory do lead */
  private async saveAnalysisToMemory(leadId: string, pub: any, analysis: any): Promise<void> {
    const pubDate = new Date(pub.data_disponibilizacao).toISOString().slice(0, 10);
    const pubEntry = {
      date: pubDate,
      tipo: pub.tipo_comunicacao || 'Publicação',
      assunto: pub.assunto || null,
      resumo: analysis.resumo,
      estagio: analysis.estagio_sugerido || null,
      juizo: analysis.juizo || null,
      parte_autora: analysis.parte_autora || null,
      parte_rea: analysis.parte_rea || null,
      urgencia: analysis.urgencia,
    };

    const existing = await this.prisma.aiMemory.findUnique({ where: { lead_id: leadId } });
    let facts: any = {};
    try {
      facts = existing?.facts_json
        ? (typeof existing.facts_json === 'string' ? JSON.parse(existing.facts_json as string) : existing.facts_json)
        : {};
    } catch { facts = {}; }

    const djenHistory: any[] = facts.djen_publications || [];
    // Evitar duplicata (mesmo dia + mesmo tipo + mesmo assunto)
    const isDuplicate = djenHistory.some(
      d => d.date === pubEntry.date && d.tipo === pubEntry.tipo && d.assunto === pubEntry.assunto,
    );
    if (!isDuplicate) {
      djenHistory.unshift(pubEntry); // mais recente primeiro
      if (djenHistory.length > 15) djenHistory.splice(15);
    }
    facts.djen_publications = djenHistory;

    const summaryLine = `[${pubDate}] ${pubEntry.tipo}${pubEntry.assunto ? ` — ${pubEntry.assunto}` : ''}: ${analysis.resumo}`;
    const prevSummary = existing?.summary || '';
    const newSummary = (summaryLine + (prevSummary ? '\n\n' + prevSummary : '')).slice(0, 2000);

    if (existing) {
      await this.prisma.aiMemory.update({
        where: { lead_id: leadId },
        data: { summary: newSummary, facts_json: facts, last_updated_at: new Date() },
      });
    } else {
      await this.prisma.aiMemory.create({
        data: { lead_id: leadId, summary: newSummary, facts_json: facts },
      });
    }
    this.logger.log(`[DJEN] Análise salva na memória do lead ${leadId}`);
  }
}
