import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { CalendarService } from '../calendar/calendar.service';

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

        // ─── Auto-criar tarefa ao vincular publicação a um processo ───────
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
                  { minutes_before: 1440, channel: 'PUSH' },
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
    return { date, saved, errors, tasksCreated };
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
  ) {
    const pub = await this.prisma.djenPublication.findUniqueOrThrow({ where: { id } });

    const digits = pub.numero_processo.replace(/\D/g, '');
    const placeholderPhone = `PROC_${digits}`;

    // Cria ou reutiliza lead placeholder
    let lead = await this.prisma.lead.findFirst({ where: { phone: placeholderPhone } });
    if (!lead) {
      lead = await this.prisma.lead.create({
        data: {
          name: `[Processo] ${pub.numero_processo}`,
          phone: placeholderPhone,
          tenant_id: tenantId,
        },
      });
    }

    // Detecta área pelo tipo_comunicacao / assunto
    const text = [pub.tipo_comunicacao, pub.assunto, pub.conteudo].join(' ').toLowerCase();
    let legalArea = 'CIVIL';
    if (/trabalh/.test(text)) legalArea = 'TRABALHISTA';
    else if (/previd|inss/.test(text)) legalArea = 'PREVIDENCIARIO';
    else if (/tribut|fiscal/.test(text)) legalArea = 'TRIBUTARIO';
    else if (/famil|divórcio|divorcio/.test(text)) legalArea = 'FAMILIA';
    else if (/crimin/.test(text)) legalArea = 'CRIMINAL';

    const legalCase = await this.prisma.legalCase.create({
      data: {
        lead_id: lead.id,
        lawyer_id: lawyerId,
        tenant_id: tenantId,
        case_number: pub.numero_processo,
        stage: 'PROTOCOLO',
        tracking_stage: 'DISTRIBUIDO',
        in_tracking: true,
        filed_at: pub.data_disponibilizacao,
        legal_area: legalArea,
        stage_changed_at: new Date(),
      },
    });

    // Vincular publicação ao processo recém criado
    await this.prisma.djenPublication.update({
      where: { id },
      data: { legal_case_id: legalCase.id, viewed_at: new Date() },
    });

    this.logger.log(`[DJEN] Processo ${legalCase.id} criado a partir da publicação ${id}`);
    return legalCase;
  }
}
