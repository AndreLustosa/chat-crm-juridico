import { Injectable, Logger, BadRequestException, ConflictException, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { CalendarService } from '../calendar/calendar.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { LockService } from '../common/locks/lock.service';
import { CronRunnerService } from '../common/cron/cron-runner.service';
import { tenantOrDefault } from '../common/constants/tenant';
import { isBusinessHours } from '../common/utils/business-hours.util';
import { toCanonicalBrPhone, phoneVariants } from '../common/utils/phone';
import { BusinessDaysCalc } from '@crm/shared';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

/** Hash deterministico pra CaseEvent MOVIMENTACAO vindo de publicacao DJEN.
 * Mesma chave que ESAJ usa (movement_hash eh UNIQUE no banco), entao precisamos
 * garantir nao-colisao. Usamos prefixo "djen:" + comunicacao_id (ja e unique na DJEN). */
function djenMovementHash(comunicacaoId: number): string {
  return crypto.createHash('sha256')
    .update(`djen:${comunicacaoId}`)
    .digest('hex');
}

function toDateStr(date: Date): string {
  return date.toISOString().slice(0, 10); // yyyy-MM-dd
}

/** Formata 20 dígitos no padrão CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO */
function formatCnj(digits: string): string {
  const d = (digits || '').replace(/\D/g, '');
  if (d.length !== 20) return digits;
  return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16, 20)}`;
}

/** Variantes do CNJ para busca tolerante a formato (mascarado vs digits-only) */
function cnjVariants(numero: string): string[] {
  const digits = (numero || '').replace(/\D/g, '');
  const out = new Set<string>();
  if (numero) out.add(numero);
  if (digits) out.add(digits);
  if (digits.length === 20) out.add(formatCnj(digits));
  return Array.from(out);
}

function subtractDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - days);
  return d;
}

// addBusinessDays standalone REMOVIDO em 2026-05-08 — usar
// BusinessDaysCalc do @crm/shared que considera feriados nacionais
// + recesso CPC art. 220 + holidays do tenant.

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
    private readonly lock: LockService,
    private readonly cronRunner: CronRunnerService,
  ) {}

  /**
   * Cron diário às 08h e 17h BRT — sincroniza publicações de ontem e hoje.
   *
   * 08h: pega tudo do dia anterior (ja completo) + publicacoes que entraram
   *      ate o final da noite anterior do dia atual.
   * 17h: pega publicacoes que entraram durante o dia (TJAL/TRT geralmente
   *      publicam entre 08h e 18h). Sem isso, publicacoes de hoje so chegariam
   *      no sync da manha seguinte — atrasando 12h+ a notificacao ao advogado.
   *
   * timeZone: 'America/Maceio' fixa o horario independente do TZ do container,
   * defesa caso alguem reconfigure o docker no futuro (validado em prod 2026-04-26
   * que TZ do container = America/Sao_Paulo, igual a Maceio em offset).
   *
   * Idempotencia: syncForDate usa upsert por id_comunicacao, entao re-rodar
   * pra mesma data nao duplica.
   */
  /**
   * Cron de repescagem: a cada hora dentro do horario comercial, pega
   * publicacoes vinculadas a processo que ainda nao foram notificadas ao
   * cliente (client_notified_at IS NULL) e tenta enviar de novo.
   *
   * Coberto:
   *  - Pubs criadas fora do horario (sync 17h ainda esta no horario, mas
   *    se rodar tarde / sync manual a noite, ficam pendentes)
   *  - Pubs vinculadas via reconciliacao depois do dia da publicacao
   *  - Falhas transitorias do WhatsApp (instancia offline temporario)
   *
   * Janela de 7 dias evita reenviar avisos de pubs muito antigas que
   * possivelmente ja perderam relevancia.
   *
   * Adicionado 2026-04-26 — politica de zero perda.
   */
  @Cron('15 8-19 * * *', { timeZone: 'America/Maceio' })
  async retryPendingClientNotifications() {
    await this.cronRunner.run(
      'djen-retry-notify',
      5 * 60,
      async () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const pendings = await this.prisma.djenPublication.findMany({
        where: {
          client_notified_at: null,
          legal_case_id: { not: null },
          data_disponibilizacao: { gte: sevenDaysAgo },
          archived: false,
        },
        include: {
          legal_case: {
            select: {
              id: true,
              tenant_id: true,
              lead: { select: { id: true, name: true, phone: true } },
            },
          },
        },
        orderBy: { data_disponibilizacao: 'desc' },
        take: 50, // limite pra nao sobrecarregar IA/WhatsApp em uma execucao
      });

      if (pendings.length === 0) return;

      this.logger.log(`[DJEN-RETRY] ${pendings.length} pub(s) pendentes de notificacao`);

      let notified = 0;
      for (const pub of pendings) {
        if (!pub.legal_case) continue;
        try {
          let aiAnalysis: any = null;
          try {
            aiAnalysis = await this.analyzePublication(pub.id);
          } catch (e: any) {
            this.logger.warn(`[DJEN-RETRY] IA falhou em ${pub.id}: ${e.message}`);
          }
          await this.notifyLeadAboutMovement(
            pub,
            pub.legal_case,
            pub.tipo_comunicacao,
            pub.numero_processo,
            pub.data_disponibilizacao,
            pub.assunto,
            aiAnalysis,
          );
          notified++;
        } catch (e: any) {
          this.logger.warn(`[DJEN-RETRY] Falha em ${pub.id}: ${e.message}`);
        }
      }
      this.logger.log(`[DJEN-RETRY] ${notified}/${pendings.length} notificacoes enviadas`);
      },
      { description: 'Repesca publicacoes DJEN ainda nao notificadas ao cliente (zero perda)', schedule: '15 8-19 * * *' },
    );
  }

  @Cron('0 8,17 * * *', { timeZone: 'America/Maceio' })
  async syncDaily() {
    await this.cronRunner.run(
      'djen-sync',
      20 * 60,
      async () => {
        const today = new Date();
        const yesterday = subtractDays(today, 1);
        this.logger.log('[DJEN] Iniciando sync diário...');
        await this.syncForDate(toDateStr(yesterday));
        await this.syncForDate(toDateStr(today));
        this.logger.log('[DJEN] Sync diário concluído.');
      },
      { description: 'Sync diario DJEN (8h e 17h) — pega publicacoes de ontem + hoje', schedule: '0 8,17 * * *' },
    );
  }

  /** Busca items da API DJEN para uma OAB específica em uma data, com retry */
  private async fetchDjenItems(oabNumber: string, oabUf: string, lawyerName: string, date: string): Promise<any[]> {
    const params = new URLSearchParams({
      numeroOab: oabNumber,
      ufOab: oabUf,
      nomeAdvogado: lawyerName,
      dataDisponibilizacaoInicio: date,
      dataDisponibilizacaoFim: date,
    });

    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const timeoutMs = attempt === 1 ? 30000 : 60000;
        const res = await fetch(`${this.API_BASE}?${params}`, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) {
          this.logger.warn(`[DJEN] API retornou ${res.status} para OAB ${oabNumber}/${oabUf} em ${date} (tentativa ${attempt}/${MAX_RETRIES})`);
          if (attempt < MAX_RETRIES) { await new Promise(r => setTimeout(r, 5000)); continue; }
          return [];
        }
        const data: any = await res.json();
        const items = data?.items || data?.content || data?.data || (Array.isArray(data) ? data : []);
        this.logger.log(`[DJEN] ${items.length} publicações para OAB ${oabNumber}/${oabUf} em ${date}`);
        return items;
      } catch (e) {
        this.logger.error(`[DJEN] Erro OAB ${oabNumber}/${oabUf} em ${date} (tentativa ${attempt}/${MAX_RETRIES}): ${e}`);
        if (attempt < MAX_RETRIES) { await new Promise(r => setTimeout(r, 5000)); continue; }
        return [];
      }
    }
    return [];
  }

  /** Carrega lista de advogados do settings. Formato DJEN_LAWYERS: JSON array [{oab,uf,nome},...] */
  private async getOabList(): Promise<Array<{ oab: string; uf: string; nome: string }>> {
    const lawyersJson = await this.settings.get('DJEN_LAWYERS');
    if (lawyersJson) {
      try {
        const parsed = JSON.parse(lawyersJson);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch { /* fallback para settings individuais */ }
    }
    // Fallback: settings legados de advogado único
    const oab  = (await this.settings.get('DJEN_OAB_NUMBER'))  || '14209';
    const uf   = (await this.settings.get('DJEN_OAB_UF'))      || 'AL';
    const nome = (await this.settings.get('DJEN_LAWYER_NAME')) || 'André Freire Lustosa';
    return [{ oab, uf, nome }];
  }

  async syncForDate(date: string): Promise<{ date: string; saved: number; errors: number; tasksCreated: number }> {
    const lawyers = await this.getOabList();
    this.logger.log(`[DJEN] Sincronizando ${date} para ${lawyers.length} advogado(s): ${lawyers.map(l => `${l.nome} (${l.oab}/${l.uf})`).join(', ')}`);

    // Buscar publicações de todas as OABs e deduplicar por comunicacao_id
    const itemsMap = new Map<number | string, any>();
    for (const lawyer of lawyers) {
      const items = await this.fetchDjenItems(lawyer.oab, lawyer.uf, lawyer.nome, date);
      for (const item of items) {
        const cid = item.id ?? item.idComunicacao ?? item.comunicacaoId;
        if (cid && !itemsMap.has(cid)) itemsMap.set(cid, item);
      }
    }
    const items = Array.from(itemsMap.values());
    this.logger.log(`[DJEN] ${items.length} publicações únicas para ${date} (após deduplicação)`);

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
          // Busca tolerante a formato: o banco mistura mascarado e digits-only.
          const variants = cnjVariants(numeroProcesso);
          legalCase = await this.prisma.legalCase.findFirst({
            where: { case_number: { in: variants }, in_tracking: true },
            select: {
              id: true, lawyer_id: true, tenant_id: true, renounced: true,
              lead: { select: { id: true, name: true, phone: true } },
            },
          });
          if (legalCase) legalCaseId = legalCase.id;
        }

        const dataDispRaw = item.dataDisponibilizacao || date;
        const dataDisp = new Date(dataDispRaw + (String(dataDispRaw).includes('T') ? '' : 'T12:00:00'));

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
            nome_advogado: item.nomeAdvogado || lawyers.map(l => l.nome).join(', '),
            raw_json: item,
            legal_case_id: legalCaseId,
          },
        });
        saved++;

        // ─── Criar CaseEvent tipo MOVIMENTACAO pra aparecer na timeline do ───
        // processo. Antes de 2026-04-23, publicacoes DJEN ficavam isoladas em
        // DjenPublication — so movimentacoes do ESAJ scraper apareciam como
        // eventos do processo. Bug reportado: intimacao publicada hoje no DJEN
        // nao aparece como movimento do processo.
        // Usa hash deterministico (djen:comunicacaoId) + movement_hash UNIQUE
        // no schema pra dedupe — seguro contra re-syncs.
        if (legalCaseId) {
          const movTitle = [tipoComunicacao, assunto].filter(Boolean).join(' — ') || 'Publicação DJEN';
          const movDescription = conteudo || movTitle;
          // Busca tenant_id do legalCase pra propagar pro CaseEvent
          const lcTenant = await this.prisma.legalCase.findUnique({
            where: { id: legalCaseId },
            select: { tenant_id: true },
          });
          try {
            await this.prisma.caseEvent.create({
              data: {
                case_id: legalCaseId,
                tenant_id: lcTenant?.tenant_id || null,
                type: 'MOVIMENTACAO',
                title: movTitle.slice(0, 200),
                description: movDescription,
                source: 'DJEN',
                event_date: dataDisp,
                movement_hash: djenMovementHash(Number(comunicacaoId)),
                source_raw: { djen_publication_id: pub.id, comunicacao_id: Number(comunicacaoId), tipo: tipoComunicacao, assunto } as any,
              },
            });
          } catch (err: any) {
            // P2002 = unique constraint violation (ja existe) — OK, pular
            if (err?.code !== 'P2002') {
              this.logger.warn(`[DJEN] Falha ao criar CaseEvent MOVIMENTACAO pra pub ${pub.id}: ${err?.message || err}`);
            }
          }
        }

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

              // Bug fix 2026-05-08: BusinessDaysCalc considera feriados
              // nacionais + recesso CPC + holidays do tenant. Antes pulava
              // so sabado/domingo — perdia Carnaval, Corpus Christi etc.
              const customHolidays = await this.prisma.holiday.findMany({
                where: { tenant_id: legalCase.tenant_id },
                select: { date: true, recurring_yearly: true },
              });
              const calc = new BusinessDaysCalc({ holidays: customHolidays });
              const dueAt = calc.addBusinessDays(dataDisp, classification.dueDays);
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

          // saveAnalysisToMemory REMOVIDO em 2026-04-20 (fase 2d-1). A analise
          // ja fica salva em DjenPublication.ai_analysis (acessivel pelo
          // ProfileConsolidationProcessor). Os insights sao propagados ao
          // LeadProfile.summary via consolidacao noturna.
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

  /**
   * Varre publicações não vinculadas e tenta associá-las a processos existentes pelo número.
   *
   * Quando o vínculo é feito aqui (e não no syncForDate), também dispara análise
   * IA + notificação WhatsApp ao cliente — caso contrário publicações que chegam
   * antes do processo ser cadastrado nunca seriam comunicadas ao lead.
   *
   * Cenario tipico: pub chega 09h com numero_processo X, processo so eh cadastrado
   * 10h. Sync das 17h (ou 08h do dia seguinte) entra aqui, vincula e notifica.
   *
   * Idempotencia: notifyLeadAboutMovement ja tem guard `if (pub.client_notified_at) return`,
   * entao re-rodar reconciliacao nao re-notifica publicacoes ja comunicadas.
   */
  async reconcileUnlinkedPublications(): Promise<number> {
    const unlinked = await this.prisma.djenPublication.findMany({
      where: { legal_case_id: null, numero_processo: { not: '' } },
      // Select expandido pra alimentar notifyLeadAboutMovement no fim do loop —
      // antes pegava so id+numero, perdia tipo_comunicacao/data/assunto e o
      // cliente nunca recebia WhatsApp por publicacoes reconciliadas.
      select: {
        id: true,
        numero_processo: true,
        tipo_comunicacao: true,
        data_disponibilizacao: true,
        assunto: true,
        client_notified_at: true,
      },
    });

    if (unlinked.length === 0) return 0;

    let reconciled = 0;
    let notified = 0;
    for (const pub of unlinked) {
      if (!pub.numero_processo) continue;
      // Tolerância a formato: o numero_processo da publicação pode ter sido
      // gravado em formato diferente do case_number do legalCase
      // (ex: DJEN mascarado "0707175-85.2026..." vs OAB-import digits-only).
      const variants = cnjVariants(pub.numero_processo);
      const legalCase = await this.prisma.legalCase.findFirst({
        where: { case_number: { in: variants }, in_tracking: true },
        // Select expandido — notify precisa de lead{id,name,phone}+tenant_id.
        // renounced/archived adicionado no fix 2026-05-08 pra reconcile
        // respeitar status do processo (antes ignorava).
        select: {
          id: true,
          tenant_id: true,
          renounced: true,
          archived: true,
          lead: { select: { id: true, name: true, phone: true } },
        },
      });
      if (!legalCase) continue;

      // Bug fix 2026-05-08: reconcile nao filtrava renounced/archived/ignored.
      // Resultado: cliente que renunciou continuava recebendo intimacoes
      // velhas reconciliadas dias depois.
      if (legalCase.renounced || legalCase.archived) {
        // Vincula a publicacao mesmo (pra historico) mas nao notifica
        await this.prisma.djenPublication.update({
          where: { id: pub.id },
          data: { legal_case_id: legalCase.id, archived: true },
        });
        this.logger.log(
          `[DJEN/recon] Pub ${pub.id} vinculada a processo renunciado/arquivado ${legalCase.id} — pulando notificacao`,
        );
        continue;
      }

      // Verifica DjenIgnoredProcess (composto [tenant_id, numero_processo]).
      // Filtra pelo tenant do legal_case pra nao bloquear publicacoes
      // de outros escritorios que nao ignoraram o mesmo numero.
      const isIgnored = legalCase.tenant_id ? await this.prisma.djenIgnoredProcess.findFirst({
        where: { numero_processo: pub.numero_processo, tenant_id: legalCase.tenant_id },
        select: { id: true },
      }) : null;
      if (isIgnored) {
        await this.prisma.djenPublication.update({
          where: { id: pub.id },
          data: { legal_case_id: legalCase.id, archived: true },
        });
        this.logger.log(
          `[DJEN/recon] Pub ${pub.id} de processo ignorado (renuncia) ${pub.numero_processo} — pulando notificacao`,
        );
        continue;
      }

      await this.prisma.djenPublication.update({
        where: { id: pub.id },
        data: { legal_case_id: legalCase.id },
      });
      reconciled++;

      // ─── Analisar + notificar lead (mesma sequencia do syncForDate L541-557) ─
      // Pulamos se cliente ja foi notificado por outra rota — guarda extra
      // alem do guard interno do notifyLeadAboutMovement, pra economizar
      // chamada a IA em re-execucao da reconciliacao.
      if (pub.client_notified_at) continue;

      let aiAnalysis: any = null;
      try {
        aiAnalysis = await this.analyzePublication(pub.id);
      } catch (e: any) {
        this.logger.warn(`[DJEN/recon] Análise IA falhou (notificação seguirá sem resumo): ${e.message}`);
      }

      try {
        await this.notifyLeadAboutMovement(
          pub,
          legalCase,
          pub.tipo_comunicacao,
          pub.numero_processo,
          pub.data_disponibilizacao,
          pub.assunto,
          aiAnalysis,
        );
        notified++;
      } catch (e: any) {
        this.logger.warn(`[DJEN/recon] Falha ao notificar lead: ${e.message}`);
      }
    }

    if (reconciled > 0) {
      this.logger.log(`[DJEN] Reconciliação: ${reconciled} publicação(ões) vinculadas a processos existentes, ${notified} notificações enviadas`);
    }
    return reconciled;
  }

  // ─── Helper de filtro multi-tenant ──────────────────────────────────
  // Bug fix 2026-05-08: DjenPublication ganhou tenant_id direto. Use
  // este helper em TODAS as queries pra evitar leak entre tenants.
  // Ate completar backfill, aceita pubs com tenant_id=NULL (legadas) +
  // pubs do tenant atual via OR.
  private tenantWhere(tenantId?: string): any {
    if (!tenantId) return {};
    return {
      OR: [
        { tenant_id: tenantId },
        { tenant_id: null }, // legadas pre-backfill — remover apos NOT NULL
      ],
    };
  }

  async findRecent(days = 7, tenantId?: string) {
    const since = subtractDays(new Date(), days);
    return this.prisma.djenPublication.findMany({
      where: {
        data_disponibilizacao: { gte: since },
        ...this.tenantWhere(tenantId),
      },
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
    tenantId?: string;
  }) {
    const days = opts.days ? parseInt(opts.days) : 30;
    const since = subtractDays(new Date(), days);
    const page = Math.max(1, opts.page ? parseInt(opts.page) : 1);
    const limit = Math.min(Math.max(1, opts.limit ? parseInt(opts.limit) : 50), 200);
    const skip = (page - 1) * limit;

    const where: any = {
      data_disponibilizacao: { gte: since },
      ...this.tenantWhere(opts.tenantId),
    };

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
      where: { viewed_at: null, archived: false, data_disponibilizacao: { gte: since }, ...this.tenantWhere(opts.tenantId) },
    });

    // Enriquecer com flag "ignored" — ja filtrado por tenant
    const ignoredRows = await this.prisma.djenIgnoredProcess.findMany({
      where: opts.tenantId ? { tenant_id: opts.tenantId } : {},
      select: { numero_processo: true },
    });
    const ignoredSet = new Set(ignoredRows.map((r: any) => r.numero_processo));

    const enrichedItems = items.map((item: any) => ({
      ...item,
      ignored: ignoredSet.has(item.numero_processo) || (item.legal_case as any)?.renounced === true,
    }));

    return { items: enrichedItems, total, page, limit, unreadCount };
  }

  async findByCase(legalCaseId: string, tenantId?: string) {
    return this.prisma.djenPublication.findMany({
      where: {
        legal_case_id: legalCaseId,
        // Cross-check: tambem filtra pelo tenant da publicacao
        ...this.tenantWhere(tenantId),
      },
      orderBy: { data_disponibilizacao: 'desc' },
    });
  }

  async markViewed(id: string, tenantId?: string) {
    // updateMany pra respeitar filtro tenant — se tenant errado, count=0
    const result = await this.prisma.djenPublication.updateMany({
      where: { id, ...this.tenantWhere(tenantId) },
      data: { viewed_at: new Date() },
    });
    if (result.count === 0) {
      throw new BadRequestException('Publicacao nao encontrada ou de outro tenant');
    }
    return this.prisma.djenPublication.findUnique({ where: { id } });
  }

  async archive(id: string, tenantId?: string) {
    const result = await this.prisma.djenPublication.updateMany({
      where: { id, ...this.tenantWhere(tenantId) },
      data: { archived: true, viewed_at: new Date() },
    });
    if (result.count === 0) {
      throw new BadRequestException('Publicacao nao encontrada ou de outro tenant');
    }
    return this.prisma.djenPublication.findUnique({ where: { id } });
  }

  async unarchive(id: string, tenantId?: string) {
    const result = await this.prisma.djenPublication.updateMany({
      where: { id, ...this.tenantWhere(tenantId) },
      data: { archived: false },
    });
    if (result.count === 0) {
      throw new BadRequestException('Publicacao nao encontrada ou de outro tenant');
    }
    return this.prisma.djenPublication.findUnique({ where: { id } });
  }

  async markAllViewed(tenantId: string) {
    if (!tenantId) throw new BadRequestException('tenant_id obrigatorio');
    // Bug fix 2026-05-08: antes era updateMany SEM tenant — admin marcava
    // tudo (de outros tenants) como visto. Agora obrigatorio.
    const result = await this.prisma.djenPublication.updateMany({
      where: { viewed_at: null, archived: false, ...this.tenantWhere(tenantId) },
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
      // Normaliza pro formato canonico (55+DDD+8dig). Antes tinha logica
      // inline com replace+if que divergia de outros pontos do sistema.
      const phone = toCanonicalBrPhone(leadPhone);
      if (!phone) {
        throw new BadRequestException(
          `Telefone invalido: "${leadPhone}". Informe um celular brasileiro com DDD valido.`,
        );
      }
      const name = leadName!.trim();
      // Busca robusta por variantes (cobre formatos legados no banco)
      const variants = phoneVariants(phone);
      const existingByPhone = await this.prisma.lead.findFirst({
        where: {
          phone: { in: variants },
          ...(tenantId ? { tenant_id: tenantId } : {}),
        },
        select: { id: true, name: true },
      });
      if (existingByPhone) {
        if (!existingByPhone.name?.trim()) {
          await this.prisma.lead.update({ where: { id: existingByPhone.id }, data: { name } });
        }
        lead = { id: existingByPhone.id };
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
        tenant_id: tenantOrDefault(tenantId),
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
          tenant_id: tenantOrDefault(tenantId),
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
    // initializeProcessMemory REMOVIDO em 2026-04-20 (fase 2d-1). O processo
    // criado fica no LegalCase (lead.legal_cases). O ProfileConsolidationProcessor
    // le legal_cases e inclui no LeadProfile.summary automaticamente.

    this.logger.log(
      `[DJEN] Processo ${legalCase.id} criado a partir da publicação ${id} | ` +
      `lead=${lead.id} convertido em cliente | stage=${finalTrackingStage}`,
    );
    return legalCase;
  }

  async analyzePublication(id: string, force = false, _tenantId?: string): Promise<{
    resumo: string;
    urgencia: 'URGENTE' | 'NORMAL' | 'BAIXA';
    tipo_acao: string;
    prazo_dias: number;
    estagio_sugerido: string | null;
    tarefa_titulo: string;
    tarefa_descricao: string;
    orientacoes: string;
    event_type: 'AUDIENCIA' | 'PRAZO' | 'PERICIA' | 'TAREFA';
    model_used: string;
    // Dados extraídos da publicação
    parte_autora: string | null;
    parte_rea: string | null;
    juizo: string | null;
    area_juridica: string | null;
    valor_causa: string | null;
    data_audiencia: string | null;
    data_prazo: string | null;
    // Lista de eventos sugeridos (multipli prazos/audiencias por publicacao).
    // Adicionado 2026-04-26 — antes a IA so retornava 1 evento via event_type.
    // Mantemos os campos legados (event_type, data_audiencia, data_prazo)
    // pra compat, mas eventos[] eh a fonte canonica.
    eventos: Array<{
      tipo: 'AUDIENCIA' | 'PRAZO' | 'PERICIA';
      titulo: string;          // curto e especifico (ex: "Citacao por edital - 20 dias")
      descricao: string;       // detalhada do que fazer (instrucoes praticas)
      data: string | null;     // ISO naive BRT — null se prazo relativo
      prazo_dias: number | null; // dias uteis se nao tem data fixa
      condicao: string | null; // ex: "apos publicacao do edital" — pra prazos encadeados
    }>;
    // Campos CLIENT (linguagem acessível) — só usados internamente p/ notificação WhatsApp
    client: {
      resumo_cliente: string | null;
      proximo_passo_cliente: string | null;
      fase_processo_cliente: string | null;
      orientacao_cliente: string | null;
      prazo_cliente: string | null;
      local_evento: string | null;
    };
  }> {
    const pub = await this.prisma.djenPublication.findUniqueOrThrow({
      where: { id },
      include: {
        legal_case: {
          select: { case_number: true, legal_area: true, tracking_stage: true, lead: { select: { id: true, name: true } } },
        },
      },
    });

    // Cache: retorna análise salva se existir e não for forçada reanálise
    const CACHE_HOURS = 24;
    const pubAny = pub as any;
    if (!force && pubAny.lawyer_analysis && pubAny.analyzed_at) {
      const age = Date.now() - new Date(pubAny.analyzed_at).getTime();
      if (age < CACHE_HOURS * 3600000) {
        this.logger.log(`[DJEN] Análise em cache (${Math.round(age / 60000)}min) para publicação ${id}`);
        const cached = pubAny.lawyer_analysis;
        // Compat: analises antigas (antes de 2026-04-26) nao tinham eventos[].
        // Deriva on-read pra frontend nao precisar lidar com 2 formatos.
        let cachedEventos = Array.isArray(cached.eventos) ? cached.eventos : [];
        if (cachedEventos.length === 0 && cached.event_type && cached.event_type !== 'TAREFA') {
          const t = cached.event_type;
          cachedEventos = [{
            tipo: t,
            titulo: cached.tarefa_titulo || 'Verificar publicação',
            descricao: cached.tarefa_descricao || cached.tarefa_titulo || '',
            data: (t === 'AUDIENCIA' || t === 'PERICIA') ? cached.data_audiencia : cached.data_prazo,
            prazo_dias: cached.prazo_dias || null,
            condicao: null,
          }];
        }
        return {
          ...cached,
          eventos: cachedEventos,
          client: pubAny.client_analysis || {
            resumo_cliente: null, proximo_passo_cliente: null, fase_processo_cliente: null,
            orientacao_cliente: null, prazo_cliente: null, local_evento: null,
          },
        };
      }
    }

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

- event_type: "AUDIENCIA" | "PRAZO" | "PERICIA" | "TAREFA"
  REGRA CRITICA: publicacoes do DJEN sempre envolvem processo. event_type DEVE ser AUDIENCIA, PRAZO ou PERICIA. Use TAREFA APENAS em ultimo recurso (publicacao puramente informativa, sem prazo nem evento). NUNCA TAREFA quando ha despacho exigindo manifestacao, contestacao, recurso, ou cumprimento — esses sao PRAZO.
  Este campo (event_type) representa o evento PRINCIPAL/mais urgente. Se ha multiplos prazos, detalhe TODOS no array "eventos" abaixo.

- eventos: array — Lista TODOS os prazos/audiencias/pericias da publicacao, em ordem cronologica. CRITICO: se ha multiplos prazos encadeados (ex: "edital com prazo de 20 dias, depois impugnacao em 15 dias apos citacao"), liste CADA UM como item separado. NAO concatene em 1 so. Cada item tem:
  • tipo: "AUDIENCIA" | "PRAZO" | "PERICIA"
  • titulo: string (curto e ESPECIFICO ao ato — ex: "Citacao por edital de interessados", "Impugnacao ao pedido de alvara", "Audiencia de instrucao")
  • descricao: string (DETALHADA — explica o que esse ato significa, o que precisa ser feito concretamente, e em que ordem. Inclua referencias praticas: "monitorar publicacao do edital", "verificar resposta do Sisbajud antes da audiencia", "preparar contraminuta", etc. Minimo 80 caracteres, sem limite maximo.)
  • data: ISO "YYYY-MM-DDTHH:MM:00" ou null se prazo relativo (sem data explicita)
  • prazo_dias: number ou null (dias uteis se prazo relativo)
  • condicao: string ou null (apenas se o prazo depende de outro evento — ex: "apos publicacao do edital", "apos juntada da resposta do Sisbajud", "apos parecer do MP")
  Exemplo pra publicacao "DECISAO defere alvara, cita por edital com prazo 20d, impugnacao em 15d apos citacao, intima MP":
  [
    {"tipo": "PRAZO", "titulo": "Publicacao do edital de citacao (20 dias)", "descricao": "Aguardar publicacao do edital de citacao. Prazo de 20 dias corridos para que interessados se manifestem. Monitorar Diario Oficial.", "data": null, "prazo_dias": 20, "condicao": null},
    {"tipo": "PRAZO", "titulo": "Impugnacao ao pedido de alvara (15 dias)", "descricao": "Apos decorrido o prazo do edital sem manifestacao, abrira prazo de 15 dias para impugnacao. Acompanhar e, se necessario, peticionar pela conclusao do procedimento.", "data": null, "prazo_dias": 15, "condicao": "apos publicacao do edital"},
    {"tipo": "PRAZO", "titulo": "Parecer do Ministerio Publico", "descricao": "MP intimado para ofertar parecer apos manifestacoes. Aguardar e analisar o parecer antes da sentenca.", "data": null, "prazo_dias": null, "condicao": "apos manifestacoes/impugnacoes"}
  ]
  Se a publicacao tem so 1 prazo/evento, retorne array com 1 item. Se nao tem nenhum (publicacao informativa), retorne array vazio [].

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
- data_audiencia: string | null (ISO "YYYY-MM-DDTHH:MM:00", horário de Brasília — sem timezone, sem "Z". Use TAMBEM para perícias: extraia a data/hora da audiência OU da perícia, conforme o caso)
- data_prazo: string | null (ISO "YYYY-MM-DDTHH:MM:00", horário de Brasília — sem timezone, sem "Z")

REGRAS RIGOROSAS DE EXTRAÇÃO DE DATA/HORA:
1. SEMPRE retornar no formato exato: "YYYY-MM-DDTHH:MM:00" (ex: "2026-05-21T08:30:00").
2. NUNCA inventar hora. Se a publicação não diz a hora explicitamente, retorne null para data_audiencia/data_prazo.
3. NUNCA aplicar offset de timezone. A hora vai exatamente como aparece na publicação, considerando que é horário de Brasília.
   - "às 8 horas e 30 minutos" → "T08:30:00"
   - "às 14h" → "T14:00:00"
   - "às 9 horas" → "T09:00:00"
4. NUNCA confundir data passada com data futura. Se a publicação diz "designada audiência em 21/05/2024" e a data atual é 2026, isso é INFORMATIVO — retorne null se não há nova data marcada.
5. data_audiencia SÓ deve ser preenchida se houver audiência FUTURA explicitamente marcada com data E hora.
6. data_prazo é o ÚLTIMO DIA LEGAL do prazo (data limite real). NÃO aplique margem de segurança — o sistema agenda automaticamente 1 dia útil antes.
   - Se publicação diz "manifestar-se em 15 dias úteis" sem data específica → deixe data_prazo null e preencha prazo_dias=15.
   - Se publicação diz "até 20/05/2026" → data_prazo = "2026-05-20T17:00:00" (ou hora limite se mencionada, senão use 17:00 como fim do expediente).
7. Se event_type = AUDIENCIA, data_audiencia DEVE estar preenchida.
8. Se event_type = PRAZO, data_prazo DEVE estar preenchida (ou prazo_dias se for prazo relativo).

Critérios de urgência: URGENTE = citação/intimação com prazo ≤15 dias, sentença, audiência marcada, perícia designada. NORMAL = contestação, manifestação, despacho. BAIXA = distribuição, informativo, arquivamento.
Critérios de estágio: citação→CITACAO, contestação→CONTESTACAO, réplica→REPLICA, perícia→PERICIA_AGENDADA, audiência→INSTRUCAO, sentença→JULGAMENTO, recurso→RECURSO, trânsito→TRANSITADO, execução→EXECUCAO, distribuição→DISTRIBUIDO, encerramento→ENCERRADO.
Critérios de event_type:
  - AUDIENCIA = audiência judicial com data/hora explícita futura
  - PERICIA = perícia (médica, contábil, técnica) com data/hora explícita futura. NUNCA confundir com audiência — perícia é exame técnico, audiência é ato processual com juiz.
  - PRAZO = qualquer prazo processual (data limite OU prazo relativo em dias úteis). Exemplos: contestação, manifestação, recurso, cumprimento de decisão, impugnação, juntada.
  - TAREFA = APENAS publicação puramente informativa, sem nenhum prazo nem evento (ex: comunicado interno, distribuição). Em duvida, use PRAZO.`;

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

    this.logger.log(`[DJEN/IA] Iniciando analise pubId=${id} model=${configuredModel} provider=${isAnthropic ? 'anthropic' : 'openai'}`);

    let raw = '{}';

    // Bug fix 2026-05-12 (DJEN — IA nao funcionava no painel do lead):
    // Antes: erros do LLM (timeout, 401, 429, 500) propagavam crus pro frontend
    // que tinha catch silencioso. Usuario via "nada acontecendo".
    // Agora: log detalhado + erro com mensagem clara.
    try {
      if (isAnthropic) {
        const anthropicKey = (await this.settings.get('ANTHROPIC_API_KEY')) || process.env.ANTHROPIC_API_KEY;
        if (!anthropicKey) throw new BadRequestException('ANTHROPIC_API_KEY não configurada. Configure em Ajustes > IA.');

        const client = new Anthropic({ apiKey: anthropicKey });
        const message = await client.messages.create({
          model: configuredModel,
          max_tokens: 2048,
          temperature: 0.2,
          system: systemPrompt + '\n\nResponda APENAS com JSON válido, sem markdown ou explicações extras.',
          messages: [{ role: 'user', content: userPrompt }],
        });
        raw = (message.content[0] as any)?.text || '{}';
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) raw = jsonMatch[0];
        this.logger.log(`[DJEN/IA] Anthropic OK pubId=${id} tokens_in=${message.usage?.input_tokens || '?'} tokens_out=${message.usage?.output_tokens || '?'}`);
      } else {
        const openaiKey = (await this.settings.get('OPENAI_API_KEY')) || process.env.OPENAI_API_KEY;
        if (!openaiKey) throw new BadRequestException('OPENAI_API_KEY não configurada. Configure em Ajustes > IA.');

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
        this.logger.log(`[DJEN/IA] OpenAI OK pubId=${id} model=${completion.model} tokens=${completion.usage?.total_tokens || '?'}`);
      }
    } catch (llmErr: any) {
      const status = llmErr?.status || llmErr?.response?.status;
      const code = llmErr?.code || llmErr?.error?.code;
      const msg = llmErr?.message || 'Erro desconhecido na chamada LLM';
      this.logger.error(
        `[DJEN/IA] FALHA pubId=${id} model=${configuredModel} status=${status || 'n/a'} code=${code || 'n/a'}: ${msg}`,
      );
      // Re-throw como erro identificavel pro frontend
      if (llmErr instanceof BadRequestException) throw llmErr;
      if (status === 401 || status === 403) {
        throw new BadRequestException(`Chave de API invalida ou sem permissao (${status}). Verifique ${isAnthropic ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'} em Ajustes > IA.`);
      }
      if (status === 429) {
        throw new BadRequestException('Rate limit do provider de IA atingido. Tente novamente em alguns segundos.');
      }
      if (status === 404) {
        throw new BadRequestException(`Modelo "${configuredModel}" nao existe ou foi descontinuado. Configure outro em Ajustes > IA.`);
      }
      if (status >= 500) {
        throw new BadRequestException(`Provider de IA com falha temporaria (${status}). Tente novamente em 1 min.`);
      }
      throw new BadRequestException(`Falha ao analisar com IA: ${msg}`);
    }

    let parsed: any = {};
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }

    // ─── Validacao de data ISO da IA ─────────────────────────────────────────
    //
    // A IA recebe instrucao pra retornar "YYYY-MM-DDTHH:MM:00" mas pode falhar
    // ou inventar formato. Sanitiza:
    //  - aceita "YYYY-MM-DDTHH:MM:00" (formato pedido)
    //  - aceita "YYYY-MM-DDTHH:MM:00Z" / com offset (toleravel)
    //  - aceita "YYYY-MM-DD" (so dia, vira meia-noite — bom pra prazos sem hora)
    //  - rejeita lixo, datas invalidas
    //  - rejeita data anterior a data_disponibilizacao (impossivel: prazo nao
    //    pode ser anterior a publicacao que o gerou — bug 2026-04-26 confirmado
    //    em producao: pub 14/04 com prazo 24/03 extraido de referencia historica)
    //  - se rejeitar, loga warning e zera o campo
    //
    // Convencao: data eh BRT naive. Se IA retorna sem TZ, eh BRT.
    const pubDate = pub.data_disponibilizacao
      ? new Date(pub.data_disponibilizacao)
      : null;
    const sanitizeIaDate = (raw: any, label: string): string | null => {
      if (!raw || typeof raw !== 'string') return null;
      const trimmed = raw.trim();
      if (!trimmed) return null;
      // Aceita formato dia-only ou ISO completo
      const isoPattern = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:?\d{2})?)?$/;
      if (!isoPattern.test(trimmed)) {
        this.logger.warn(`[DJEN/IA] ${label} formato invalido: "${trimmed}" (esperava YYYY-MM-DDTHH:MM:00)`);
        return null;
      }
      // Valida que eh uma data real (rejeita 31/02 etc) — interpreta como naive UTC
      // pra checar so a data, sem fuso. Se trimmed nao tem hora, soma midnight.
      const withTime = trimmed.includes('T') ? trimmed : `${trimmed}T00:00:00`;
      const withZ = /Z$|[+-]\d{2}:?\d{2}$/.test(withTime) ? withTime : `${withTime}Z`;
      const dt = new Date(withZ);
      if (isNaN(dt.getTime())) {
        this.logger.warn(`[DJEN/IA] ${label} data invalida: "${trimmed}"`);
        return null;
      }
      // Rejeita data anterior a data_disponibilizacao da publicacao.
      // Tolerancia de 1 dia (publicacoes podem ter sido disponibilizadas um pouco
      // depois do despacho real). Sem isso, IA extraia datas retroativas mencionadas
      // como referencia historica no texto e marcava como prazo.
      if (pubDate) {
        const tolMs = 24 * 60 * 60 * 1000;
        if (dt.getTime() < pubDate.getTime() - tolMs) {
          this.logger.warn(
            `[DJEN/IA] ${label} anterior a data de publicacao: "${trimmed}" < ` +
            `${pubDate.toISOString().slice(0, 10)} — provavel referencia historica no texto. pubId=${id}`,
          );
          return null;
        }
      }
      // Rejeita data > 2 anos no passado (fallback se nao tem pubDate)
      const twoYearsAgo = Date.now() - 2 * 365 * 24 * 60 * 60 * 1000;
      if (dt.getTime() < twoYearsAgo) {
        this.logger.warn(`[DJEN/IA] ${label} muito antiga: "${trimmed}" — provavel hallucinacao`);
        return null;
      }
      return trimmed;
    };

    // ─── Separar campos LAWYER (estratégicos/internos) e CLIENT (público) ─────
    const lawyerFields = {
      resumo: parsed.resumo || 'Não foi possível gerar o resumo.',
      urgencia: (['URGENTE', 'NORMAL', 'BAIXA'].includes(parsed.urgencia) ? parsed.urgencia : 'NORMAL') as any,
      tipo_acao: parsed.tipo_acao || 'Verificar publicação',
      prazo_dias: typeof parsed.prazo_dias === 'number' ? parsed.prazo_dias : 15,
      estagio_sugerido: STAGES.includes(parsed.estagio_sugerido) ? parsed.estagio_sugerido : null,
      tarefa_titulo: parsed.tarefa_titulo || 'Verificar publicação DJEN',
      tarefa_descricao: parsed.tarefa_descricao || '',
      orientacoes: parsed.orientacoes || '',
      // Regra de negocio (2026-04-26): publicacoes DJEN sempre envolvem processo.
      // Quando ha processo vinculado, event_type DEVE ser AUDIENCIA, PRAZO ou
      // PERICIA — nunca TAREFA. TAREFA fica reservada pra fase de captura do
      // lead, com o operador. Se IA insistir em TAREFA com processo vinculado,
      // rebaixa pra PRAZO (default seguro — operador pode reclassificar manual).
      event_type: (() => {
        const ALLOWED_LINKED = ['AUDIENCIA', 'PRAZO', 'PERICIA'] as const;
        const ALLOWED_ALL = ['AUDIENCIA', 'PRAZO', 'PERICIA', 'TAREFA'] as const;
        if (!hasLinkedCase) {
          return ALLOWED_ALL.includes(parsed.event_type) ? parsed.event_type : 'TAREFA';
        }
        if (ALLOWED_LINKED.includes(parsed.event_type)) return parsed.event_type;
        // IA retornou TAREFA (ou lixo) com processo vinculado — rebaixa pra PRAZO
        if (parsed.event_type && parsed.event_type !== 'PRAZO') {
          this.logger.warn(`[DJEN/IA] event_type=${parsed.event_type} com processo vinculado — forcando PRAZO. pubId=${id}`);
        }
        return 'PRAZO';
      })() as 'AUDIENCIA' | 'PRAZO' | 'PERICIA' | 'TAREFA',
      model_used: configuredModel,
      parte_autora: parsed.parte_autora || null,
      parte_rea: parsed.parte_rea || null,
      juizo: parsed.juizo || null,
      area_juridica: parsed.area_juridica || null,
      valor_causa: parsed.valor_causa || null,
      data_audiencia: sanitizeIaDate(parsed.data_audiencia, 'data_audiencia'),
      data_prazo: sanitizeIaDate(parsed.data_prazo, 'data_prazo'),
    };

    // Coerencia entre event_type e data extraida.
    // AUDIENCIA/PERICIA exigem data_audiencia (campo compartilhado). Sem data,
    // se ha processo vinculado, rebaixa pra PRAZO (regra: nunca TAREFA com
    // processo vinculado). Sem processo, rebaixa pra TAREFA.
    const fallbackNoData = hasLinkedCase ? 'PRAZO' : 'TAREFA';
    if ((lawyerFields.event_type === 'AUDIENCIA' || lawyerFields.event_type === 'PERICIA') && !lawyerFields.data_audiencia) {
      this.logger.warn(`[DJEN/IA] event_type=${lawyerFields.event_type} sem data_audiencia — rebaixando pra ${fallbackNoData}. pubId=${id}`);
      lawyerFields.event_type = fallbackNoData;
    }
    if (lawyerFields.event_type === 'PRAZO' && !lawyerFields.data_prazo && !hasLinkedCase) {
      // Sem data_prazo + sem processo: rebaixa pra TAREFA. Com processo, mantem
      // PRAZO mesmo sem data_prazo — frontend usa fallbackDue (prazo_dias uteis).
      this.logger.warn(`[DJEN/IA] event_type=PRAZO sem data_prazo + sem processo — rebaixando pra TAREFA. pubId=${id}`);
      lawyerFields.event_type = 'TAREFA';
    }

    // ─── Sanitiza eventos[] da IA + retrocompat com formato legado ───────────
    //
    // IA pode retornar varios prazos/audiencias da mesma publicacao (ex: edital
    // 20d + impugnacao 15d apos). Sanitiza cada item, descarta os com formato
    // ruim. Se IA nao retornou array (modelo antigo / falha), deriva 1 item dos
    // campos legados pra nao perder a sugestao.
    type Evento = {
      tipo: 'AUDIENCIA' | 'PRAZO' | 'PERICIA';
      titulo: string;
      descricao: string;
      data: string | null;
      prazo_dias: number | null;
      condicao: string | null;
    };
    const sanitizeEvento = (raw: any, idx: number): Evento | null => {
      if (!raw || typeof raw !== 'object') return null;
      let tipo = String(raw.tipo || '').toUpperCase();
      // TAREFA nao eh permitido em eventos[] — regra do app: processo vinculado
      // nunca gera tarefa. Rebaixa pra PRAZO. Sem processo, ignora o item.
      if (tipo === 'TAREFA') {
        if (hasLinkedCase) tipo = 'PRAZO';
        else return null;
      }
      if (!['AUDIENCIA', 'PRAZO', 'PERICIA'].includes(tipo)) {
        this.logger.warn(`[DJEN/IA] eventos[${idx}].tipo invalido: "${raw.tipo}". pubId=${id}`);
        return null;
      }
      const titulo = String(raw.titulo || '').trim();
      const descricao = String(raw.descricao || '').trim();
      if (!titulo) {
        this.logger.warn(`[DJEN/IA] eventos[${idx}] sem titulo. pubId=${id}`);
        return null;
      }
      const data = raw.data ? sanitizeIaDate(raw.data, `eventos[${idx}].data`) : null;
      const prazo_dias = typeof raw.prazo_dias === 'number' && raw.prazo_dias > 0 ? raw.prazo_dias : null;
      // Coerencia: AUDIENCIA/PERICIA precisa de data fixa.
      if ((tipo === 'AUDIENCIA' || tipo === 'PERICIA') && !data) {
        this.logger.warn(`[DJEN/IA] eventos[${idx}].tipo=${tipo} sem data — descartando. pubId=${id}`);
        return null;
      }
      // PRAZO precisa de data OU prazo_dias.
      if (tipo === 'PRAZO' && !data && !prazo_dias) {
        this.logger.warn(`[DJEN/IA] eventos[${idx}].tipo=PRAZO sem data nem prazo_dias — descartando. pubId=${id}`);
        return null;
      }
      const condicao = raw.condicao && String(raw.condicao).trim() ? String(raw.condicao).trim() : null;
      return {
        tipo: tipo as Evento['tipo'],
        titulo,
        descricao: descricao || titulo, // fallback minimo
        data,
        prazo_dias,
        condicao,
      };
    };

    let eventos: Evento[] = [];
    if (Array.isArray(parsed.eventos) && parsed.eventos.length) {
      eventos = parsed.eventos
        .map((e: any, i: number) => sanitizeEvento(e, i))
        .filter((e: Evento | null): e is Evento => e !== null);
    }
    // Retrocompat: se IA nao mandou eventos[] mas mandou event_type !== TAREFA,
    // deriva 1 item dos campos legados (event_type, data_audiencia, data_prazo,
    // tarefa_titulo, tarefa_descricao). Sem isso, modelos antigos/instaveis
    // perderiam a sugestao.
    if (eventos.length === 0 && lawyerFields.event_type !== 'TAREFA') {
      const t = lawyerFields.event_type;
      eventos = [{
        tipo: t,
        titulo: lawyerFields.tarefa_titulo,
        descricao: lawyerFields.tarefa_descricao || lawyerFields.tarefa_titulo,
        data: (t === 'AUDIENCIA' || t === 'PERICIA') ? lawyerFields.data_audiencia : lawyerFields.data_prazo,
        prazo_dias: lawyerFields.prazo_dias || null,
        condicao: null,
      }];
      this.logger.log(`[DJEN/IA] eventos[] derivado dos campos legados (IA nao retornou array). pubId=${id}`);
    }
    (lawyerFields as any).eventos = eventos;

    const clientFields = {
      resumo_cliente: parsed.resumo_cliente || null,
      proximo_passo_cliente: parsed.proximo_passo_cliente || null,
      fase_processo_cliente: parsed.fase_processo_cliente || null,
      orientacao_cliente: parsed.orientacao_cliente || null,
      prazo_cliente: parsed.prazo_cliente || null,
      local_evento: parsed.local_evento || null,
    };

    // Eventos foi adicionado via cast (lawyerFields as any).eventos pra contornar
    // tipo strict do retorno. Aqui exponho explicitamente pra satisfazer o
    // contrato do metodo (eventos: AiEvento[]).
    const result = {
      ...lawyerFields,
      eventos,
      client: clientFields,
    };

    // Persistir análise em DOIS campos separados (evita vazamento para área do cliente)
    await this.prisma.djenPublication.update({
      where: { id },
      data: {
        lawyer_analysis: lawyerFields as any,
        client_analysis: clientFields as any,
        analyzed_at: new Date(),
        parte_autora: lawyerFields.parte_autora || null,
        parte_rea: lawyerFields.parte_rea || null,
      } as any,
    }).catch(e => this.logger.warn(`[DJEN] Falha ao salvar análise na publicação ${id}: ${e.message}`));

    // saveAnalysisToMemory REMOVIDO em 2026-04-20 (fase 2d-1). Insights ficam
    // em DjenPublication.ai_analysis. ProfileConsolidationProcessor propaga.

    return result;
  }

  // saveAnalysisToMemory() e initializeProcessMemory() REMOVIDOS em 2026-04-20
  // (fase 2d-1 da remocao total do AiMemory). Insights DJEN ficam em
  // DjenPublication.ai_analysis + legal_cases. O ProfileConsolidationProcessor
  // tem acesso a essas fontes e propaga ao LeadProfile.summary naturalmente.

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

    // INTIMACAO DJEN SEMPRE NOTIFICA (decisao 2026-05-08): intimacao tem
    // prazo legal — cliente DEVE saber. A flag DJEN_NOTIFY_CLIENT antiga
    // (que desligava DJEN) foi descontinuada conceitualmente.
    //
    // Movimentacoes simples do ESAJ continuam controladas por flag separada
    // (MOVEMENT_NOTIFY_CLIENT, lida no esaj-sync.service quando ESAJ-cliente
    // for reativado).

    // Horario comercial: 8h-20h Maceio, TODOS os dias (politica unificada
    // 2026-04-26 — antes era seg-sex, agora inclui sab/dom).
    //
    // Se fora do horario, NAO descarta — `client_notified_at` continua null
    // e o cron de repescagem `retryPendingClientNotifications` (roda 8-19h)
    // pega esta pub e re-tenta. Garantia: zero perda.
    if (!isBusinessHours()) {
      this.logger.log(
        `[DJEN] Notificacao fora do horario comercial — pub ${pub.id} ficara pendente ` +
        `pra cron de repescagem (lead ${lead.id})`,
      );
      return;
    }

    // Buscar instância WhatsApp do tenant (da última conversa).
    // Filtra por instancia REGISTRADA pra evitar escolher orfas/residuais
    // que sairiam pelo numero errado (incidente 2026-04-29).
    // 2026-05-06: filtra tambem por tenant_id (defesa multi-tenant).
    const knownInstances = (await this.prisma.instance.findMany({
      where: { type: 'whatsapp', tenant_id: legalCase.tenant_id ?? undefined },
      select: { name: true },
    })).map(i => i.name);

    const lastConvo = await this.prisma.conversation.findFirst({
      where: {
        lead_id: lead.id,
        ...(knownInstances.length > 0 ? { instance_name: { in: knownInstances } } : {}),
      },
      orderBy: { last_message_at: 'desc' },
      select: { instance_name: true },
    });
    const instance = lastConvo?.instance_name || process.env.EVOLUTION_INSTANCE_NAME || 'whatsapp';

    // Extrair campos da análise IA
    const nome = lead.name?.split(' ')[0] || 'cliente';
    const dataFmt = dataDisp.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const tipo = tipoComunicacao || 'Publicação';
    const processoFmt = numeroProcesso.length > 20 ? numeroProcesso.slice(0, 20) + '…' : numeroProcesso;

    // Bug fix 2026-05-08: publicacoes analisadas ANTES de 2026-04-26
    // (quando o split client_analysis foi adicionado) tem client_analysis
    // null mas lawyer_analysis cacheado. O cache de 24h servia a analise
    // antiga e cliente recebia mensagem com labels vazias ("Assunto: ").
    //
    // Solucao: detectar ausencia dos campos client e FORCAR re-analise
    // antes de tentar notificar.
    const hasClientFields = !!(aiAnalysis?.client && (
      aiAnalysis.client.resumo_cliente ||
      aiAnalysis.client.proximo_passo_cliente ||
      aiAnalysis.client.fase_processo_cliente
    ));

    if (!hasClientFields) {
      this.logger.log(
        `[DJEN] aiAnalysis sem campos client preenchidos pra pub ${pub.id} — forcando re-analise pra notificacao decente`,
      );
      try {
        aiAnalysis = await this.analyzePublication(pub.id, /*force*/ true);
      } catch (e: any) {
        this.logger.warn(`[DJEN] Re-analise falhou pra pub ${pub.id}: ${e.message}`);
      }
    }

    // Campos orientados ao CLIENTE (gerados pela IA)
    // Campos do cliente vêm agora em aiAnalysis.client.* (separados dos internos)
    const clientData = aiAnalysis?.client || {};
    const resumoCliente = clientData.resumo_cliente || aiAnalysis?.resumo || '';
    const proximoPassoCliente = clientData.proximo_passo_cliente || '';
    const faseProcessoCliente = clientData.fase_processo_cliente || '';
    const orientacaoCliente = clientData.orientacao_cliente || '';
    const prazoCliente = clientData.prazo_cliente || '';
    const localEvento = clientData.local_evento || '';

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

      // Bug fix 2026-05-08: antes substituiamos as vars e o filter so
      // removia linhas EM BRANCO. Resultado: template "📝 *Assunto:* {{assunto}}"
      // com {{assunto}}='' virava "📝 *Assunto:* " — cliente recebia label
      // sem valor. Agora: PRIMEIRO removemos linhas onde TODAS as vars sao
      // vazias (ex: linha "📝 *Assunto:* {{assunto}}" sem assunto = sai
      // inteira). DEPOIS substituimos.
      const lines = customTemplate.split('\n');
      const keptLines: string[] = [];
      for (const line of lines) {
        const placeholdersInLine = line.match(/\{\{[a-z_]+\}\}/g) || [];
        if (placeholdersInLine.length > 0) {
          // Linha tem variavel(eis): so mantem se PELO MENOS uma tiver valor
          const anyHasValue = placeholdersInLine.some((ph) => {
            const val = vars[ph];
            return val !== undefined && val.trim().length > 0;
          });
          if (!anyHasValue) continue; // Sai a linha inteira
        }
        keptLines.push(line);
      }
      message = keptLines.join('\n');
      for (const [key, val] of Object.entries(vars)) {
        message = message.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), val);
      }
      // Colapsa quebras consecutivas (3+) em duplas
      message = message.replace(/\n{3,}/g, '\n\n').trim();

      // Sanity check: se mensagem ficou muito curta apos limpeza,
      // significa que a IA nao gerou conteudo util — NAO envia
      // (cliente nao deve receber notif vazia/inutil).
      if (message.length < 100) {
        this.logger.warn(
          `[DJEN] Notificacao pulada — template renderizado < 100 chars (${message.length}). ` +
          `Provavel falha na analise IA da publicacao ${pub.id}. Sera tentado novamente no proximo retry cron.`,
        );
        return; // NAO seta client_notified_at — cron retry pega depois (com sorte aiAnalysis ja teve sucesso)
      }
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
      // Disclaimer obrigatorio (politica unificada 2026-04-26): cliente deve
      // saber que mensagens automaticas foram geradas pelo sistema.
      lines.push(`🤖 _Esta é uma mensagem automática do sistema, gerada a partir de informações do tribunal._`);
      lines.push(``);
      lines.push(`_André Lustosa Advogados_`);

      message = lines.join('\n');

      // Mesmo guard do template customizado: se nao tem nenhum conteudo
      // util da IA (sem resumo, sem proximo_passo, sem fase, sem prazo,
      // sem orientacao), NAO envia — cliente nao deve receber so o
      // header generico "houve uma movimentacao" sem contexto.
      const hasUsefulContent = !!(resumoCliente || proximoPassoCliente || faseProcessoCliente || orientacaoCliente || prazoCliente || localEvento);
      if (!hasUsefulContent) {
        this.logger.warn(
          `[DJEN] Notificacao pulada — IA nao gerou conteudo util pra pub ${pub.id} ` +
          `(provavel falha na analise). Sera tentado novamente no proximo retry cron.`,
        );
        return;
      }
    }

    // Bug fix 2026-05-08: race entre sync principal e retry cron — ambos
    // podiam ler client_notified_at=null ao mesmo tempo e enviar 2× a
    // mesma intimacao pro cliente. Lock otimista via updateMany +
    // WHERE client_notified_at IS NULL: a primeira chamada ganha o lock
    // (count=1), as outras retornam count=0 e nao enviam.
    const lockResult = await this.prisma.djenPublication.updateMany({
      where: { id: pub.id, client_notified_at: null },
      data: { client_notified_at: new Date() },
    });

    if (lockResult.count === 0) {
      this.logger.log(
        `[DJEN] Pub ${pub.id} ja foi notificada por outro fluxo concorrente — pulando (race protection)`,
      );
      return;
    }

    try {
      await this.whatsappService.sendText(lead.phone, message, instance);
      this.logger.log(`[DJEN] ✅ Lead ${lead.id} notificado sobre movimentação no processo ${numeroProcesso}`);
    } catch (e: any) {
      // Falha no envio — desfaz o lock pra cron retry pegar de novo
      await this.prisma.djenPublication.update({
        where: { id: pub.id },
        data: { client_notified_at: null },
      }).catch(() => {});
      this.logger.warn(`[DJEN] Falha ao enviar WhatsApp para lead ${lead.id}: ${e.message} — lock revertido`);
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
    // Bug fix 2026-05-08: upsert agora usa unique composto [tenant_id, numero_processo].
    const effTenantId = tenantOrDefault(tenantId);
    const record = await this.prisma.djenIgnoredProcess.upsert({
      where: { tenant_numero_processo_unique: { tenant_id: effTenantId, numero_processo: numeroProcesso } },
      update: { reason: reason || null },
      create: {
        numero_processo: numeroProcesso,
        tenant_id: effTenantId,
        reason: reason || null,
      },
    });

    // Auto-arquivar publicações desse número, restritas ao tenant
    const archived = await this.prisma.djenPublication.updateMany({
      where: {
        numero_processo: numeroProcesso,
        archived: false,
        ...this.tenantWhere(tenantId),
      },
      data: { archived: true, viewed_at: new Date() },
    });

    this.logger.log(`[DJEN] Processo ${numeroProcesso} ignorado (tenant=${effTenantId}) — ${archived.count} publicação(ões) arquivada(s)`);
    return { ...record, archivedCount: archived.count };
  }

  async unignoreProcess(numeroProcesso: string, tenantId?: string) {
    // Bug fix 2026-05-08: agora composto [tenant_id, numero_processo].
    // Sem tenantId = legacy fallback (tenta delete por numero apenas).
    if (tenantId) {
      await this.prisma.djenIgnoredProcess.delete({
        where: { tenant_numero_processo_unique: { tenant_id: tenantId, numero_processo: numeroProcesso } },
      }).catch(() => null);
    } else {
      await this.prisma.djenIgnoredProcess.deleteMany({
        where: { numero_processo: numeroProcesso },
      }).catch(() => null);
    }
    this.logger.log(`[DJEN] Processo ${numeroProcesso} removido da lista de ignorados (tenant=${tenantId})`);
    return { ok: true };
  }

  async listIgnoredProcesses(tenantId?: string) {
    return this.prisma.djenIgnoredProcess.findMany({
      where: tenantId ? { tenant_id: tenantId } : {},
      orderBy: { created_at: 'desc' },
    });
  }
}
