import { Injectable, Logger, BadRequestException, ConflictException, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { CalendarService } from '../calendar/calendar.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
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
  if (/perí?cia|laudo pericial|perito designado/.test(text)) {
    return {
      taskTitle: 'Preparar para perícia e notificar cliente',
      taskDescription: 'Perícia designada via DJEN. Notificar cliente sobre data, documentos necessários e orientações.',
      dueDays: 5,
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
    @Inject(forwardRef(() => WhatsappService)) private readonly whatsappService: WhatsappService,
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

    // Carregar processos ignorados (renúncia) — 1 query antes do loop
    const ignoredRows = await this.prisma.djenIgnoredProcess.findMany({
      select: { numero_processo: true },
    });
    const ignoredSet = new Set(ignoredRows.map((r: any) => r.numero_processo));

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
        let legalCase: { id: string; lawyer_id: string; tenant_id: string | null; renounced: boolean; lead?: { id: string; name: string | null; phone: string } | null } | null = null;

        if (numeroProcesso) {
          legalCase = await this.prisma.legalCase.findFirst({
            where: { case_number: numeroProcesso, in_tracking: true },
            select: {
              id: true, lawyer_id: true, tenant_id: true, renounced: true,
              lead: { select: { id: true, name: true, phone: true } },
            },
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

        // Auto-arquivar publicações de processos renunciados ou ignorados
        const shouldAutoArchive =
          (legalCase?.renounced) || ignoredSet.has(numeroProcesso);
        if (shouldAutoArchive && !pub.archived) {
          await this.prisma.djenPublication.update({
            where: { id: pub.id },
            data: { archived: true, viewed_at: pub.viewed_at || new Date() },
          });
          this.logger.log(`[DJEN] Publicação ${pub.id} auto-arquivada (processo renunciado/ignorado: ${numeroProcesso})`);
        }

        // ─── Notificações e memória ─────
        if (legalCase && pub && !shouldAutoArchive) {
          /*
           * Auto-criação de tarefas DESATIVADA — o advogado cria manualmente.
           * Para reativar, descomentar o bloco abaixo.
           *
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

              // ── Se for publicação de perícia, tentar criar evento no calendário ──
              const pubText = [tipoComunicacao, assunto, conteudo].join(' ').toLowerCase();
              if (/perí?cia|laudo pericial|perito designado/.test(pubText)) {
                try {
                  const periciaDate = extractHearingDateTime(conteudo);
                  if (periciaDate) {
                    const existingPericia = await this.prisma.calendarEvent.findFirst({
                      where: {
                        legal_case_id: legalCase.id,
                        type: 'PERICIA',
                        start_at: {
                          gte: new Date(periciaDate.getTime() - 86400000),
                          lte: new Date(periciaDate.getTime() + 86400000),
                        },
                      },
                      select: { id: true },
                    });
                    if (!existingPericia) {
                      const endDate = new Date(periciaDate.getTime() + 120 * 60000); // +2h
                      await this.calendarService.create({
                        type: 'PERICIA',
                        title: `[DJEN] Perícia — ${numeroProcesso}`,
                        description: `Perícia detectada automaticamente via DJEN.\n${assunto || ''}`,
                        start_at: periciaDate.toISOString(),
                        end_at: endDate.toISOString(),
                        assigned_user_id: legalCase.lawyer_id,
                        legal_case_id: legalCase.id,
                        created_by_id: legalCase.lawyer_id,
                        tenant_id: legalCase.tenant_id || undefined,
                        priority: 'URGENTE',
                        reminders: [
                          { minutes_before: 1440, channel: 'WHATSAPP' },
                          { minutes_before: 120, channel: 'WHATSAPP' },
                        ],
                      });
                      this.logger.log(
                        `[DJEN] Perícia automática criada: ${periciaDate.toISOString()} (caso ${legalCase.id})`,
                      );
                    }
                  }
                } catch (e: any) {
                  this.logger.warn(`[DJEN] Falha ao criar perícia automática: ${e.message}`);
                }
              }

              // ── Se for publicação de audiência, tentar criar evento no calendário ──
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

          */ // fim do bloco de auto-criação de tarefas desativado

          // ─── Garantir que a conversa do lead tenha advogado atribuído ─────
          if (legalCase.lead?.id && legalCase.lawyer_id) {
            await this.prisma.conversation.updateMany({
              where: { lead_id: legalCase.lead.id, assigned_lawyer_id: null },
              data: { assigned_lawyer_id: legalCase.lawyer_id },
            });
          }

          // ─── Analisar publicação com IA ANTES de notificar ─────────
          let aiResumo: string | null = null;
          let aiAnalysis: any = null;
          try {
            aiAnalysis = await this.analyzePublication(pub.id);
            aiResumo = aiAnalysis?.resumo || null;
          } catch (e: any) {
            this.logger.warn(`[DJEN] Análise IA falhou (notificação seguirá sem resumo): ${e.message}`);
          }

          // ─── Notificar lead via WhatsApp com detalhes da movimentação ─────
          this.notifyLeadAboutMovement(
            pub, legalCase, tipoComunicacao, numeroProcesso, dataDisp,
            assunto, aiAnalysis,
          ).catch(e =>
            this.logger.warn(`[DJEN] Falha ao notificar lead: ${e.message}`),
          );

          // ─── Atualizar memória da IA com a análise completa ─────────
          if (legalCase.lead?.id) {
            this.saveAnalysisToMemory(legalCase.lead.id, pub, aiAnalysis || {
              resumo: `${tipoComunicacao || 'Publicação'}${assunto ? ': ' + assunto : ''}`,
              estagio_sugerido: null, juizo: null,
              parte_autora: pub.parte_autora || null,
              parte_rea: pub.parte_rea || null,
              urgencia: 'NORMAL',
            }).catch(e => this.logger.warn(`[DJEN] Falha ao atualizar memória do lead: ${e.message}`));
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
              renounced: true,
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
      where: { viewed_at: null, archived: false, data_disponibilizacao: { gte: since } },
    });

    // Enriquecer com flag "ignored" para publicações de processos na lista de ignorados
    const ignoredRows = await this.prisma.djenIgnoredProcess.findMany({
      select: { numero_processo: true },
    });
    const ignoredSet = new Set(ignoredRows.map((r: any) => r.numero_processo));

    const enrichedItems = items.map((item: any) => ({
      ...item,
      ignored: ignoredSet.has(item.numero_processo) || (item.legal_case as any)?.renounced === true,
    }));

    return { items: enrichedItems, total, page, limit, unreadCount };
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
      let phone = leadPhone!.trim().replace(/\D/g, '');
      // Normalizar: adicionar 55 se necessário, remover 9 extra
      if (phone.length <= 11) phone = '55' + phone;
      if (phone.length === 13 && phone.startsWith('55') && phone[4] === '9') {
        phone = phone.slice(0, 4) + phone.slice(5);
      }
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
      'DISTRIBUIDO', 'CITACAO', 'CONTESTACAO', 'REPLICA', 'PERICIA_AGENDADA',
      'INSTRUCAO', 'JULGAMENTO', 'RECURSO', 'TRANSITADO', 'EXECUCAO', 'ENCERRADO',
    ];
    const finalTrackingStage = (trackingStage && VALID_TRACKING.includes(trackingStage))
      ? trackingStage
      : 'DISTRIBUIDO';

    // Extrair dados da análise IA que já estão salvos na publicação ou no raw_json
    // Se a publicação já foi analisada, parte_autora/parte_rea/etc estão preenchidos
    // Senão, tenta extrair do conteúdo via regex básico
    const parteRea = pub.parte_rea || null;
    const rawAnalysis = (pub as any).raw_json || {};

    // Tentar extrair juízo do conteúdo (ex: "1ª Vara do Trabalho", "2ª Vara Cível")
    let court: string | null = null;
    const conteudo = pub.conteudo || '';
    const courtMatch = conteudo.match(/(\d+ª?\s*Vara\s+[\w\s]+?)(?:\s*[-–]|\s*de\s+\w)/i);
    if (courtMatch) court = courtMatch[1].trim();

    // Tentar extrair valor da causa (ex: "R$ 50.000,00")
    let claimValue: number | null = null;
    const valorMatch = conteudo.match(/(?:valor\s+(?:da\s+)?causa|valor\s+(?:do\s+)?débito|valor\s+exequ?endo)[:\s]*R?\$?\s*([\d.,]+)/i);
    if (valorMatch) {
      const cleanVal = valorMatch[1].replace(/\./g, '').replace(',', '.');
      const parsed = parseFloat(cleanVal);
      if (!isNaN(parsed) && parsed > 0) claimValue = parsed;
    }

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
        // Campos pré-preenchidos pela análise IA
        opposing_party: parteRea,
        court: court,
        claim_value: claimValue,
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

    // Lead virou cliente (is_client=true, stage=FINALIZADO) → sai da aba Leads automaticamente.
    // Garantir que exista ao menos uma conversa (clientes cadastrados só via DJEN podem não ter)
    const djenConvo = await this.prisma.conversation.findFirst({
      where: { lead_id: lead.id },
      select: { id: true },
    });
    if (!djenConvo) {
      await this.prisma.conversation.create({
        data: {
          lead_id: lead.id,
          tenant_id: tenantId || null,
          instance_name: process.env.EVOLUTION_INSTANCE_NAME || 'whatsapp',
          status: 'ABERTO',
          last_message_at: new Date(),
        },
      });
      this.logger.log(`[DJEN] Conversa criada para lead ${lead.id} (cadastrado só via DJEN)`);
    }

    // Resolver atendente responsável:
    // 1ª: OPERADOR/COMERCIAL → 2ª: ADVOGADO/ADMIN → 3ª: o próprio advogado do caso
    let resolvedAttendantId: string | undefined;
    try {
      let candidates = await this.prisma.user.findMany({
        where: {
          roles: { hasSome: ['OPERADOR', 'COMERCIAL'] },
          ...(tenantId ? { tenant_id: tenantId } : {}),
        },
        select: { id: true },
      });
      if (candidates.length === 0) {
        candidates = await this.prisma.user.findMany({
          where: {
            roles: { hasSome: ['ADVOGADO', 'ADMIN'] },
            ...(tenantId ? { tenant_id: tenantId } : {}),
          },
          select: { id: true },
        });
      }
      resolvedAttendantId = candidates.length > 0
        ? candidates[Math.floor(Math.random() * candidates.length)].id
        : lawyerId; // fallback final: o próprio advogado
      this.logger.log(`[DJEN] Atendente resolvido: ${resolvedAttendantId}`);
    } catch {
      resolvedAttendantId = lawyerId;
    }

    // Atualizar conversas: desligar IA, atribuir advogado, atendente e área jurídica
    await this.prisma.conversation.updateMany({
      where: { lead_id: lead.id },
      data: {
        ai_mode: false,
        assigned_lawyer_id: lawyerId,
        assigned_user_id: resolvedAttendantId,
        legal_area: resolvedLegalArea,
      },
    });

    // ─── Atualizar memória da IA com dados do processo e publicação ─────────
    this.initializeProcessMemory(lead.id, {
      caseNumber: pub.numero_processo,
      legalArea: resolvedLegalArea,
      trackingStage: finalTrackingStage,
      tipoComunicacao: pub.tipo_comunicacao,
      assunto: pub.assunto,
      parteAutora: pub.parte_autora,
      parteRea: pub.parte_rea,
      dataDisponibilizacao: pub.data_disponibilizacao,
    }).catch(e => this.logger.warn(`[DJEN] Falha ao inicializar memória do lead ${lead.id}: ${e.message}`));

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

    // Sem processo vinculado: análise ocorre normalmente, mas event_type será forçado a TAREFA no retorno
    const hasLinkedCase = !!pub.legal_case_id;

    const STAGES = [
      'DISTRIBUIDO', 'CITACAO', 'CONTESTACAO', 'REPLICA', 'PERICIA_AGENDADA',
      'INSTRUCAO', 'JULGAMENTO', 'RECURSO', 'TRANSITADO', 'EXECUCAO', 'ENCERRADO',
    ];

    const DEFAULT_DJEN_PROMPT = `Você é um advogado sênior analisando publicações do DJEN. Seu trabalho é ler o conteúdo COMPLETO da publicação e retornar um JSON que permita ao advogado entender tudo sem precisar ler o texto original.

CAMPOS PARA O ADVOGADO:

- resumo: string — Resumo COMPLETO e detalhado da publicação. Inclua: o que foi decidido/determinado, fundamentação legal citada, valores mencionados, prazos, consequências práticas. O advogado NÃO vai ler o texto original — seu resumo é a única fonte. Mínimo 5 frases, sem limite máximo. Linguagem técnica.

- urgencia: "URGENTE" | "NORMAL" | "BAIXA"

- tipo_acao: string — Ação CONCRETA e ESPECÍFICA que o advogado deve tomar. NÃO escreva "verificar publicação" ou "analisar sentença". Escreva exatamente o que fazer:
  Exemplos BONS: "Interpor recurso inominado no prazo de 10 dias úteis", "Apresentar contrarrazões em 15 dias", "Nenhuma ação necessária — sentença favorável, aguardar trânsito em julgado", "Peticionar habilitação do crédito na execução", "Agendar perícia e preparar quesitos"
  Exemplos RUINS: "Analisar sentença", "Verificar publicação", "Tomar providências"

- prazo_dias: number (dias ÚTEIS para a ação)
- estagio_sugerido: string | null (um de: ${STAGES.join(', ')})
- tarefa_titulo: string (título curto e específico da tarefa)
- tarefa_descricao: string (o que fazer concretamente, máx 200 chars)

- orientacoes: string — Observações ESTRATÉGICAS para o advogado tomar decisão. Inclua:
  • Análise do mérito (decisão foi favorável ou desfavorável? parcialmente?)
  • Recomendação clara: recorrer, aceitar, negociar acordo, aguardar
  • Fundamentos para a recomendação (ex: "sentença seguiu jurisprudência consolidada do TST, recurso tem baixa chance de êxito")
  • Riscos de não agir (ex: "perda do prazo recursal implica trânsito em julgado")
  • Se houver valores, comentar se são razoáveis
  Mínimo 3 frases. Seja direto e opinativo — o advogado quer sua análise, não uma repetição da publicação.

- event_type: "AUDIENCIA" | "PRAZO" | "TAREFA"

CAMPOS PARA O CLIENTE (linguagem acessível — enviados via WhatsApp):
- resumo_cliente: string (explicação completa para leigo, sem termos jurídicos. Máx 5 frases.)
- proximo_passo_cliente: string | null (o que o cliente precisa saber/fazer)
- fase_processo_cliente: string | null (em que fase o processo está, para leigo)
- orientacao_cliente: string | null (orientações práticas)
- prazo_cliente: string | null (prazo em linguagem acessível)
- local_evento: string | null (endereço/link se aplicável)

CAMPOS DE EXTRAÇÃO (null se não encontrado):
- parte_autora: string | null
- parte_rea: string | null
- juizo: string | null
- area_juridica: string | null
- valor_causa: string | null (formato "R$ X.XXX,XX")
- data_audiencia: string | null (ISO "YYYY-MM-DDTHH:MM:00". Se perícia INSS sem data, retorne null.)
- data_prazo: string | null (ISO "YYYY-MM-DDTHH:MM:00")

Critérios de urgência: URGENTE = citação/intimação com prazo ≤15 dias, sentença, audiência marcada, perícia designada. NORMAL = contestação, manifestação, despacho. BAIXA = distribuição, informativo, arquivamento.
Critérios de estágio: citação→CITACAO, contestação→CONTESTACAO, réplica→REPLICA, perícia→PERICIA_AGENDADA, audiência→INSTRUCAO, sentença→JULGAMENTO, recurso→RECURSO, trânsito→TRANSITADO, execução→EXECUCAO, distribuição→DISTRIBUIDO, encerramento→ENCERRADO.
Critérios de event_type: AUDIENCIA = data/hora explícita para audiência. PRAZO = data explícita de prazo. TAREFA = demais casos.`;

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
${pub.conteudo.slice(0, 6000)}`;

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
        max_tokens: 2048,
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
        max_tokens: 2048,
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
      // Sem processo vinculado: não sugerir criação de eventos de audiência/prazo
      event_type: (!hasLinkedCase ? 'TAREFA' : (['AUDIENCIA', 'PRAZO', 'TAREFA'].includes(parsed.event_type) ? parsed.event_type : 'TAREFA')) as 'AUDIENCIA' | 'PRAZO' | 'TAREFA',
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

    // Persistir parte_autora e parte_rea na publicação para matching futuro com leads
    if (result.parte_autora || result.parte_rea) {
      await this.prisma.djenPublication.update({
        where: { id },
        data: {
          parte_autora: result.parte_autora || null,
          parte_rea: result.parte_rea || null,
        },
      }).catch(e => this.logger.warn(`[DJEN] Falha ao salvar partes na publicação ${id}: ${e.message}`));
    }

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

  // ─── Inicializar/atualizar memória da IA com dados do processo ────────────

  /**
   * Atualiza a AiMemory do lead com informações do processo DJEN.
   * Preenche campos estruturados (case, parties, facts.timeline, djen_publications)
   * para que a Sophia tenha contexto sobre o processo do cliente.
   */
  private async initializeProcessMemory(leadId: string, data: {
    caseNumber: string;
    legalArea: string;
    trackingStage: string;
    tipoComunicacao?: string | null;
    assunto?: string | null;
    parteAutora?: string | null;
    parteRea?: string | null;
    dataDisponibilizacao?: Date | null;
  }): Promise<void> {
    const existing = await this.prisma.aiMemory.findUnique({ where: { lead_id: leadId } });
    let facts: any = {};
    try {
      facts = existing?.facts_json
        ? (typeof existing.facts_json === 'string' ? JSON.parse(existing.facts_json as string) : existing.facts_json)
        : {};
    } catch { facts = {}; }

    // ─── Migrar facts.case (singular) para facts.cases (array) se necessário ──
    if (facts.case && !facts.cases) {
      facts.cases = [facts.case];
      delete facts.case;
    }
    facts.cases = facts.cases || [];

    // Verificar se este processo já existe na memória (evitar duplicata)
    const existingCase = facts.cases.find((c: any) => c.case_number === data.caseNumber);
    if (existingCase) {
      // Atualizar processo existente
      existingCase.tracking_stage = data.trackingStage;
      existingCase.status = 'processo_ativo';
      if (data.parteRea && !existingCase.opposing_party) existingCase.opposing_party = data.parteRea;
    } else {
      // Adicionar novo processo
      facts.cases.push({
        case_number: data.caseNumber,
        area: this.normalizeAreaForMemory(data.legalArea),
        status: 'processo_ativo',
        tracking_stage: data.trackingStage,
        summary: `Processo nº ${data.caseNumber} — ${this.normalizeAreaForMemory(data.legalArea)}`,
        opposing_party: data.parteRea || null,
        client_role: data.parteAutora ? 'Parte autora' : null,
      });
    }

    // Manter compatibilidade: facts.case aponta para o mais recente (IA legada)
    facts.case = facts.cases[facts.cases.length - 1];

    // Atualizar partes do caso mais recente
    if (data.parteAutora || data.parteRea) {
      facts.parties = facts.parties || {};
      if (data.parteAutora && !facts.parties.client_role) facts.parties.client_role = 'Parte autora';
      if (data.parteRea && !facts.parties.counterparty_name) facts.parties.counterparty_name = data.parteRea;
    }

    // Adicionar timeline
    facts.facts = facts.facts || {};
    facts.facts.timeline = facts.facts.timeline || [];
    const dateStr = data.dataDisponibilizacao
      ? new Date(data.dataDisponibilizacao).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    facts.facts.timeline.push({
      date: dateStr,
      event: `Processo ${data.caseNumber} cadastrado via DJEN — ${data.tipoComunicacao || 'publicação'}${data.assunto ? ': ' + data.assunto : ''}`,
      origin: 'DJEN',
    });
    if (facts.facts.timeline.length > 20) facts.facts.timeline = facts.facts.timeline.slice(-20);

    // Adicionar à lista de publicações DJEN
    const djenHistory: any[] = facts.djen_publications || [];
    const pubEntry = {
      date: dateStr,
      tipo: data.tipoComunicacao || 'Publicação',
      assunto: data.assunto || null,
      resumo: `Processo ${data.caseNumber} cadastrado — ${this.normalizeAreaForMemory(data.legalArea)}`,
      estagio: data.trackingStage,
      parte_autora: data.parteAutora || null,
      parte_rea: data.parteRea || null,
      urgencia: 'NORMAL',
    };
    djenHistory.unshift(pubEntry);
    if (djenHistory.length > 15) djenHistory.splice(15);
    facts.djen_publications = djenHistory;

    // Montar summary
    const casesCount = facts.cases.length;
    const summaryLine = casesCount > 1
      ? `[${dateStr}] ${casesCount} processos ativos. Último: ${data.caseNumber} (${this.normalizeAreaForMemory(data.legalArea)}) — ${data.trackingStage}.`
      : `[${dateStr}] Processo ${data.caseNumber} (${this.normalizeAreaForMemory(data.legalArea)}) cadastrado via DJEN. Estágio: ${data.trackingStage}.`;
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
    this.logger.log(`[DJEN] Memória da IA atualizada para lead ${leadId} — ${facts.cases.length} processo(s), último: ${data.caseNumber}`);
  }

  /** Normaliza área jurídica para formato legível */
  private normalizeAreaForMemory(area: string): string {
    const map: Record<string, string> = {
      'CIVIL': 'Cível', 'TRABALHISTA': 'Trabalhista', 'PREVIDENCIARIO': 'Previdenciário',
      'TRIBUTARIO': 'Tributário', 'FAMILIA': 'Família', 'CRIMINAL': 'Criminal',
      'CONSUMIDOR': 'Consumidor', 'EMPRESARIAL': 'Empresarial', 'ADMINISTRATIVO': 'Administrativo',
    };
    return map[area.toUpperCase()] || area;
  }

  // ─── Notificação WhatsApp ao lead sobre movimentação ──────────────────────

  /**
   * Envia notificação WhatsApp ao lead quando publicação é vinculada a seu processo.
   * Usa campos orientados ao cliente gerados pela IA (resumo_cliente, proximo_passo_cliente, etc.)
   * Controles: horário comercial, deduplica por publicação, setting habilitável.
   */
  private async notifyLeadAboutMovement(
    pub: { id: string; client_notified_at?: Date | null },
    legalCase: { id: string; lead?: { id: string; name: string | null; phone: string } | null; tenant_id: string | null },
    tipoComunicacao: string | null,
    numeroProcesso: string,
    dataDisp: Date,
    assunto?: string | null,
    aiAnalysis?: any | null,
  ): Promise<void> {
    // Já notificou para esta publicação
    if (pub.client_notified_at) return;

    // Lead deve existir e ter telefone
    const lead = legalCase.lead;
    if (!lead?.phone) return;

    // Verificar setting (default: habilitado)
    const notifyEnabled = await this.settings.get('DJEN_NOTIFY_CLIENT');
    if (notifyEnabled === 'false') return;

    // Horário comercial (Maceió/AL — UTC-3): 8h–20h, seg–sex
    const now = new Date();
    const maceioOffset = -3;
    const maceioHour = (now.getUTCHours() + maceioOffset + 24) % 24;
    const maceioDay = new Date(now.getTime() + maceioOffset * 3600000).getDay();
    const isBusinessHours = maceioDay >= 1 && maceioDay <= 5 && maceioHour >= 8 && maceioHour < 20;

    if (!isBusinessHours) {
      this.logger.log(`[DJEN] Notificação adiada (fora do horário comercial) para lead ${lead.id}`);
      return;
    }

    // Buscar instância WhatsApp do lead (da última conversa)
    const lastConvo = await this.prisma.conversation.findFirst({
      where: { lead_id: lead.id },
      orderBy: { last_message_at: 'desc' },
      select: { instance_name: true },
    });
    const instance = lastConvo?.instance_name || process.env.EVOLUTION_INSTANCE_NAME || 'whatsapp';

    // Extrair campos da análise IA
    const nome = lead.name?.split(' ')[0] || 'cliente';
    const dataFmt = dataDisp.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const tipo = tipoComunicacao || 'Publicação';
    const processoFmt = numeroProcesso.length > 20 ? numeroProcesso.slice(0, 20) + '…' : numeroProcesso;

    // Campos orientados ao CLIENTE (gerados pela IA)
    const resumoCliente = aiAnalysis?.resumo_cliente || aiAnalysis?.resumo || '';
    const proximoPassoCliente = aiAnalysis?.proximo_passo_cliente || '';
    const faseProcessoCliente = aiAnalysis?.fase_processo_cliente || '';
    const orientacaoCliente = aiAnalysis?.orientacao_cliente || '';
    const prazoCliente = aiAnalysis?.prazo_cliente || '';
    const localEvento = aiAnalysis?.local_evento || '';

    const customTemplate = await this.settings.getDjenNotifyTemplate();

    let message: string;

    if (customTemplate) {
      // Template customizado: substituir variáveis
      const vars: Record<string, string> = {
        '{{nome}}': nome,
        '{{processo}}': processoFmt,
        '{{tipo}}': tipo,
        '{{data}}': dataFmt,
        '{{assunto}}': assunto || '',
        '{{resumo}}': resumoCliente,
        '{{proximo_passo}}': proximoPassoCliente,
        '{{fase_processo}}': faseProcessoCliente,
        '{{orientacao}}': orientacaoCliente,
        '{{prazo}}': prazoCliente,
        '{{local_evento}}': localEvento,
      };

      message = customTemplate;
      for (const [key, val] of Object.entries(vars)) {
        message = message.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), val);
      }
      // Remove linhas com variáveis vazias e colapsa quebras consecutivas
      message = message
        .split('\n')
        .filter(line => line.trim() !== '' || line === '')
        .join('\n')
        .replace(/\n{3,}/g, '\n\n');
    } else {
      // Template padrão (fallback) — orientado ao cliente
      const lines = [
        `⚖️ *Movimentação no seu processo*`,
        ``,
        `Olá ${nome}! Houve uma nova movimentação no seu processo nº ${processoFmt}.`,
        ``,
        `📋 *Tipo:* ${tipo}`,
      ];

      if (assunto) lines.push(`📝 *Assunto:* ${assunto}`);
      lines.push(`📅 *Data:* ${dataFmt}`);

      if (resumoCliente) {
        lines.push(``);
        lines.push(`📖 *O que aconteceu:*`);
        lines.push(resumoCliente);
      }

      if (faseProcessoCliente) {
        lines.push(``);
        lines.push(`📊 *Fase atual do processo:*`);
        lines.push(faseProcessoCliente);
      }

      if (prazoCliente) {
        lines.push(``);
        lines.push(`⏰ *Prazo:* ${prazoCliente}`);
      }

      if (localEvento) {
        lines.push(`📍 *Local:* ${localEvento}`);
      }

      if (proximoPassoCliente) {
        lines.push(``);
        lines.push(`✅ *Próximo passo:* ${proximoPassoCliente}`);
      }

      if (orientacaoCliente) {
        lines.push(``);
        lines.push(`💡 *Orientação:* ${orientacaoCliente}`);
      }

      lines.push(``);
      lines.push(`Nosso advogado já foi notificado e está acompanhando. Se tiver dúvidas, pode nos chamar aqui!`);
      lines.push(``);
      lines.push(`André Lustosa Advogados`);

      message = lines.join('\n');
    }

    try {
      await this.whatsappService.sendText(lead.phone, message, instance);

      await this.prisma.djenPublication.update({
        where: { id: pub.id },
        data: { client_notified_at: new Date() },
      });

      this.logger.log(`[DJEN] ✅ Lead ${lead.id} notificado sobre movimentação no processo ${numeroProcesso}`);
    } catch (e: any) {
      this.logger.warn(`[DJEN] Falha ao enviar WhatsApp para lead ${lead.id}: ${e.message}`);
    }
  }

  // ─── Suggest Leads — Match automático por nome das partes ─────────────────

  /**
   * Busca leads cujos nomes correspondam às partes (autora/ré) da publicação.
   * Usa tokenização + unaccent do PostgreSQL para matching robusto de nomes brasileiros.
   */
  async suggestLeads(publicationId: string, tenantId?: string): Promise<{
    autora: { id: string; name: string; phone: string; is_client: boolean; score: number }[];
    rea: { id: string; name: string; phone: string; is_client: boolean; score: number }[];
    parte_autora: string | null;
    parte_rea: string | null;
  }> {
    const pub = await this.prisma.djenPublication.findUnique({
      where: { id: publicationId },
      select: { parte_autora: true, parte_rea: true },
    });
    if (!pub) throw new NotFoundException('Publicação não encontrada.');

    const parteAutora = pub.parte_autora || null;
    const parteRea = pub.parte_rea || null;

    // Se não há partes extraídas, retorna vazio
    if (!parteAutora && !parteRea) {
      return { autora: [], rea: [], parte_autora: null, parte_rea: null };
    }

    const PARTICLES = new Set(['de', 'da', 'do', 'dos', 'das', 'e', 'em', 'a', 'o', 'as', 'os']);

    const tokenize = (name: string): string[] => {
      return name
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
        .split(/\s+/)
        .filter(t => t.length > 1 && !PARTICLES.has(t));
    };

    const searchByTokens = async (tokens: string[]): Promise<{ id: string; name: string; phone: string; is_client: boolean; score: number }[]> => {
      if (tokens.length === 0) return [];

      // Montar cláusulas CASE para scoring e WHERE para filtro
      const caseClauses = tokens.map((_, i) => `CASE WHEN unaccent(lower("name")) ILIKE $${i + 2} THEN 1 ELSE 0 END`).join(' + ');
      const whereClauses = tokens.map((_, i) => `unaccent(lower("name")) ILIKE $${i + 2}`).join(' OR ');
      const params: any[] = [tenantId || null, ...tokens.map(t => `%${t}%`)];

      const sql = `
        SELECT id, name, phone, is_client, (${caseClauses}) as score
        FROM "Lead"
        WHERE (CASE WHEN $1::text IS NOT NULL THEN tenant_id = $1 ELSE TRUE END)
          AND name IS NOT NULL
          AND length(name) > 2
          AND (${whereClauses})
        ORDER BY score DESC, is_client DESC
        LIMIT 5
      `;

      try {
        const rows: any[] = await (this.prisma as any).$queryRawUnsafe(sql, ...params);
        return rows.map(r => ({
          id: r.id,
          name: r.name,
          phone: r.phone,
          is_client: r.is_client,
          score: Number(r.score),
        }));
      } catch (e) {
        // Se unaccent não está disponível, fallback sem acentos
        this.logger.warn(`[DJEN] suggestLeads SQL falhou (extensão unaccent pode não existir): ${e.message}`);
        return this.fallbackSearchByTokens(tokens, tenantId);
      }
    };

    const [autora, rea] = await Promise.all([
      parteAutora ? searchByTokens(tokenize(parteAutora)) : Promise.resolve([]),
      parteRea ? searchByTokens(tokenize(parteRea)) : Promise.resolve([]),
    ]);

    return { autora, rea, parte_autora: parteAutora, parte_rea: parteRea };
  }

  /** Fallback caso a extensão unaccent do PostgreSQL não esteja instalada */
  private async fallbackSearchByTokens(tokens: string[], tenantId?: string): Promise<{ id: string; name: string; phone: string; is_client: boolean; score: number }[]> {
    if (tokens.length === 0) return [];

    const caseClauses = tokens.map((_, i) => `CASE WHEN lower("name") ILIKE $${i + 2} THEN 1 ELSE 0 END`).join(' + ');
    const whereClauses = tokens.map((_, i) => `lower("name") ILIKE $${i + 2}`).join(' OR ');
    const params: any[] = [tenantId || null, ...tokens.map(t => `%${t}%`)];

    const sql = `
      SELECT id, name, phone, is_client, (${caseClauses}) as score
      FROM "Lead"
      WHERE (CASE WHEN $1::text IS NOT NULL THEN tenant_id = $1 ELSE TRUE END)
        AND name IS NOT NULL
        AND length(name) > 2
        AND (${whereClauses})
      ORDER BY score DESC, is_client DESC
      LIMIT 5
    `;

    const rows: any[] = await (this.prisma as any).$queryRawUnsafe(sql, ...params);
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      is_client: r.is_client,
      score: Number(r.score),
    }));
  }

  // ─── Ignorar processo (auto-arquivar publicações futuras) ─────

  async ignoreProcess(numeroProcesso: string, tenantId?: string, reason?: string) {
    const record = await this.prisma.djenIgnoredProcess.upsert({
      where: { numero_processo: numeroProcesso },
      update: { reason: reason || null },
      create: {
        numero_processo: numeroProcesso,
        tenant_id: tenantId || null,
        reason: reason || null,
      },
    });

    // Auto-arquivar publicações existentes desse número
    const archived = await this.prisma.djenPublication.updateMany({
      where: { numero_processo: numeroProcesso, archived: false },
      data: { archived: true, viewed_at: new Date() },
    });

    this.logger.log(`[DJEN] Processo ${numeroProcesso} ignorado — ${archived.count} publicação(ões) arquivada(s)`);
    return { ...record, archivedCount: archived.count };
  }

  async unignoreProcess(numeroProcesso: string) {
    await this.prisma.djenIgnoredProcess.delete({
      where: { numero_processo: numeroProcesso },
    }).catch(() => null); // Ignora se não existir
    this.logger.log(`[DJEN] Processo ${numeroProcesso} removido da lista de ignorados`);
    return { ok: true };
  }

  async listIgnoredProcesses(tenantId?: string) {
    return this.prisma.djenIgnoredProcess.findMany({
      where: tenantId ? { tenant_id: tenantId } : {},
      orderBy: { created_at: 'desc' },
    });
  }
}
