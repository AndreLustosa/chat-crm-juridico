import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Servico de processos pra portal do cliente. Sempre filtra por
 * `lead_id = currentClient.id` — cliente NUNCA ve processo de outro.
 *
 * Reusa dados da IA do DJEN (`client_analysis.resumo_cliente`, etc) pra
 * exibir movimentacoes em linguagem leiga sem chamar IA novamente. Se nao
 * tem analise (publicacao antiga ou movimento ESAJ), usa fallback.
 */
@Injectable()
export class PortalProcessesService {
  private readonly logger = new Logger(PortalProcessesService.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {}

  /**
   * Lista processos do cliente — visao "kanban" simplificada com proximo
   * evento e ultima movimentacao em destaque.
   */
  async listProcesses(leadId: string) {
    const cases = await this.prisma.legalCase.findMany({
      where: {
        lead_id: leadId,
        archived: false,
        renounced: false,
      },
      select: {
        id: true,
        case_number: true,
        action_type: true,
        legal_area: true,
        tracking_stage: true,
        stage_changed_at: true,
        opposing_party: true,
        client_is_author: true,
        in_tracking: true,
        priority: true,
        court: true,
      },
      orderBy: { stage_changed_at: 'desc' },
    });

    if (cases.length === 0) return [];

    // Bulk fetch: proximos eventos + ultimas movimentacoes (uma query por
    // lista, em vez de N+1 por processo).
    const caseIds = cases.map(c => c.id);
    const nowUtc = new Date();

    const [nextEvents, lastMovements, lastDjen] = await Promise.all([
      this.prisma.calendarEvent.findMany({
        where: {
          legal_case_id: { in: caseIds },
          status: { notIn: ['CANCELADO', 'CONCLUIDO'] },
          start_at: { gte: nowUtc },
          type: { in: ['AUDIENCIA', 'PERICIA', 'PRAZO'] },
        },
        select: { id: true, type: true, title: true, start_at: true, legal_case_id: true },
        orderBy: { start_at: 'asc' },
      }),
      this.prisma.caseEvent.findMany({
        where: {
          case_id: { in: caseIds },
          type: 'MOVIMENTACAO',
        },
        select: {
          id: true, case_id: true, title: true, description: true,
          event_date: true, created_at: true,
        },
        orderBy: { event_date: 'desc' },
      }),
      this.prisma.djenPublication.findMany({
        where: {
          legal_case_id: { in: caseIds },
          archived: false,
        },
        select: {
          id: true, legal_case_id: true, tipo_comunicacao: true, assunto: true,
          data_disponibilizacao: true, client_analysis: true,
        },
        orderBy: { data_disponibilizacao: 'desc' },
      }),
    ]);

    // Indexa pra lookup O(1) — pega APENAS o primeiro de cada (mais recente).
    const nextEventBy = new Map<string, typeof nextEvents[0]>();
    for (const e of nextEvents) {
      if (e.legal_case_id && !nextEventBy.has(e.legal_case_id)) nextEventBy.set(e.legal_case_id, e);
    }
    const lastMovBy = new Map<string, typeof lastMovements[0]>();
    for (const m of lastMovements) {
      if (!lastMovBy.has(m.case_id)) lastMovBy.set(m.case_id, m);
    }
    const lastDjenBy = new Map<string, typeof lastDjen[0]>();
    for (const d of lastDjen) {
      if (d.legal_case_id && !lastDjenBy.has(d.legal_case_id)) lastDjenBy.set(d.legal_case_id, d);
    }

    return cases.map(c => {
      const nextEv = nextEventBy.get(c.id);
      const lastMov = lastMovBy.get(c.id);
      const lastDj = lastDjenBy.get(c.id);

      // Pega a movimentacao MAIS RECENTE entre ESAJ (lastMov) e DJEN (lastDj)
      const lastMovDate = lastMov?.event_date || lastMov?.created_at || null;
      const lastDjDate = lastDj?.data_disponibilizacao || null;
      let lastUpdate: { date: Date; summary: string } | null = null;
      if (lastDjDate && (!lastMovDate || lastDjDate > lastMovDate)) {
        const ca = (lastDj!.client_analysis as any) || {};
        lastUpdate = {
          date: lastDjDate,
          summary: ca.resumo_cliente || lastDj!.assunto || lastDj!.tipo_comunicacao || 'Nova publicação',
        };
      } else if (lastMov) {
        lastUpdate = {
          date: lastMov.event_date || lastMov.created_at,
          summary: (lastMov.title || lastMov.description || '').slice(0, 200),
        };
      }

      return {
        id: c.id,
        case_number: c.case_number,
        action_type: c.action_type,
        legal_area: c.legal_area,
        tracking_stage: c.tracking_stage,
        opposing_party: c.opposing_party,
        client_is_author: c.client_is_author,
        priority: c.priority,
        court: c.court,
        next_event: nextEv ? {
          id: nextEv.id,
          type: nextEv.type,
          title: nextEv.title,
          start_at: nextEv.start_at.toISOString(),
        } : null,
        last_update: lastUpdate ? {
          date: lastUpdate.date.toISOString(),
          summary: lastUpdate.summary,
        } : null,
      };
    });
  }

  /**
   * Detalhe de UM processo — verifica que pertence ao cliente.
   */
  async getProcessDetail(leadId: string, caseId: string) {
    const lc = await this.prisma.legalCase.findFirst({
      where: { id: caseId, lead_id: leadId },
      select: {
        id: true, case_number: true, action_type: true, legal_area: true,
        tracking_stage: true, stage_changed_at: true, opposing_party: true,
        client_is_author: true, court: true, judge: true, claim_value: true,
        priority: true, in_tracking: true, archived: true, renounced: true,
        filed_at: true, created_at: true, notes: true,
        sentence_date: true, sentence_type: true, sentence_value: true,
      },
    });
    if (!lc || lc.archived || lc.renounced) {
      throw new NotFoundException('Processo nao encontrado');
    }

    // Counts pra UI mostrar badges
    const [movCount, docCount, eventCount] = await Promise.all([
      this.prisma.caseEvent.count({
        where: { case_id: caseId, type: 'MOVIMENTACAO' },
      }),
      this.prisma.caseDocument.count({ where: { legal_case_id: caseId } }),
      this.prisma.calendarEvent.count({
        where: {
          legal_case_id: caseId,
          status: { notIn: ['CANCELADO', 'CONCLUIDO'] },
          start_at: { gte: new Date() },
        },
      }),
    ]);

    return {
      ...lc,
      claim_value: lc.claim_value?.toString() || null,
      sentence_value: lc.sentence_value?.toString() || null,
      counts: {
        movements: movCount,
        documents: docCount,
        upcoming_events: eventCount,
      },
    };
  }

  /**
   * Timeline de movimentacoes unificada (DJEN + ESAJ + eventos do calendar).
   * Paginada por cursor (created_at desc).
   */
  async listMovements(leadId: string, caseId: string, limit = 30, beforeIso?: string) {
    // Verifica ownership primeiro
    const lc = await this.prisma.legalCase.findFirst({
      where: { id: caseId, lead_id: leadId },
      select: { id: true },
    });
    if (!lc) throw new NotFoundException('Processo nao encontrado');

    const before = beforeIso ? new Date(beforeIso) : null;
    const oversampled = limit + 5; // pega um pouco mais pra pagination resilience

    const [esajMovements, djenPubs] = await Promise.all([
      this.prisma.caseEvent.findMany({
        where: {
          case_id: caseId,
          type: 'MOVIMENTACAO',
          ...(before ? { event_date: { lt: before } } : {}),
        },
        select: {
          id: true, title: true, description: true,
          event_date: true, created_at: true, source: true,
          client_explanation: true,
          // source_raw guarda cd_movimentacao quando o ESAJ tem documento
          // protocolado vinculado. Despachos inline ("cite-se", "intime-se",
          // determinacoes simples) NAO geram cd_movimentacao porque o
          // tribunal nao protocola PDF — juiz digita direto no sistema.
          // Usamos isso pra decidir se mostra botao "Baixar PDF" no portal.
          source_raw: true,
        },
        orderBy: [{ event_date: 'desc' }, { created_at: 'desc' }],
        take: oversampled,
      }),
      this.prisma.djenPublication.findMany({
        where: {
          legal_case_id: caseId,
          archived: false,
          ...(before ? { data_disponibilizacao: { lt: before } } : {}),
        },
        select: {
          id: true, tipo_comunicacao: true, assunto: true, conteudo: true,
          data_disponibilizacao: true, client_analysis: true,
        },
        orderBy: { data_disponibilizacao: 'desc' },
        take: oversampled,
      }),
    ]);

    // Unifica em um array unico tipado.
    //
    // Politica nova (2026-04-26): mostra TEXTO TECNICO cru por padrao em
    // todas as movimentacoes (igual ao que aparece no ESAJ). Cliente clica
    // em "Pedir explicacao a Sophia" pra IA traduzir on-demand. Antes mostrava
    // resumo_cliente da IA por padrao em DJEN — mas o cliente pediu pra ver
    // o ato em si primeiro, e so pedir explicacao se quiser entender.
    //
    // explanation_cached: ja existe explicacao salva (DJEN tem do sync, ESAJ
    // pode ter do botao Sophia). UI mostra como "explicacao ja disponivel".
    type TimelineItem = {
      kind: 'esaj' | 'djen';
      id: string;
      date: string;
      title: string;
      content: string;              // texto cru juridico — exibido por padrao
      explanation_cached: string | null; // explicacao leiga ja salva (se houver)
      // true = movimentacao tem PDF protocolado no tribunal e o backend
      // sabe baixar (cd_movimentacao guardado). false = despacho inline,
      // publicacao DJEN, ou movimentacao antiga sem cd_movimentacao
      // capturado pelo parser ainda. Frontend usa pra esconder o botao
      // "Baixar PDF" — evita 404 e frustacao do cliente.
      has_pdf: boolean;
      // Campos auxiliares do DJEN (so se ja tem analise IA persistida)
      next_step_lay?: string | null;
      deadline_lay?: string | null;
      orientation_lay?: string | null;
    };

    const items: TimelineItem[] = [];

    for (const m of esajMovements) {
      const sourceRaw = (m as any).source_raw || {};
      const hasPdf = !!sourceRaw.cd_movimentacao;
      items.push({
        kind: 'esaj',
        id: m.id,
        date: (m.event_date || m.created_at).toISOString(),
        title: (m.title || 'Movimentação processual').slice(0, 200),
        content: m.description || m.title || '',
        explanation_cached: (m as any).client_explanation || null,
        has_pdf: hasPdf,
      });
    }

    for (const p of djenPubs) {
      const ca: any = p.client_analysis || {};
      items.push({
        kind: 'djen',
        id: p.id,
        date: p.data_disponibilizacao.toISOString(),
        title: p.assunto || p.tipo_comunicacao || 'Publicação',
        content: p.conteudo || '',
        // DJEN nao tem PDF original do ato — eh a propria publicacao
        has_pdf: false,
        // DJEN ja tem resumo_cliente do sync — usa como cache da explicacao
        explanation_cached: ca.resumo_cliente || null,
        next_step_lay: ca.proximo_passo_cliente || null,
        deadline_lay: ca.prazo_cliente || null,
        orientation_lay: ca.orientacao_cliente || null,
      });
    }

    // Ordem cronologica desc
    items.sort((a, b) => b.date.localeCompare(a.date));

    const paginated = items.slice(0, limit);
    const next_cursor = paginated.length === limit ? paginated[paginated.length - 1].date : null;

    return {
      items: paginated,
      next_cursor,
      total: items.length, // nao eh total absoluto, mas total no buffer atual — UI usa pra "carregar mais"
    };
  }

  /**
   * Pede pra Sophia explicar uma movimentacao em linguagem leiga.
   *
   * Comportamento:
   *   - Verifica ownership (lead_id = currentClient.id)
   *   - Se kind=djen: retorna o resumo_cliente ja gerado pelo sync (sem chamar
   *     IA novamente). Esses ja tem analise persistida no client_analysis.
   *   - Se kind=esaj: checa cache em CaseEvent.client_explanation. Se vazio,
   *     gera via IA + salva no cache.
   *
   * Modelo: usa o defaultModel do settings (gpt-4.1-mini ou claude-haiku
   * dependendo da config). Custo baixo — ~$0.0001 por chamada.
   */
  async explainMovement(
    leadId: string,
    caseId: string,
    kind: 'esaj' | 'djen',
    movementId: string,
  ): Promise<{ explanation: string; cached: boolean }> {
    // Ownership: verifica que o caso pertence ao cliente
    const lc = await this.prisma.legalCase.findFirst({
      where: { id: caseId, lead_id: leadId },
      select: {
        id: true, case_number: true, action_type: true, legal_area: true,
        tracking_stage: true, opposing_party: true, client_is_author: true,
      },
    });
    if (!lc) throw new NotFoundException('Processo nao encontrado');

    if (kind === 'djen') {
      const pub = await this.prisma.djenPublication.findFirst({
        where: { id: movementId, legal_case_id: caseId },
        select: { client_analysis: true, conteudo: true, assunto: true, tipo_comunicacao: true },
      });
      if (!pub) throw new NotFoundException('Movimentacao nao encontrada');
      const ca: any = pub.client_analysis || {};
      if (ca.resumo_cliente) {
        return { explanation: ca.resumo_cliente, cached: true };
      }
      // Sem analise — gera on-demand a partir do conteudo bruto
      const explanation = await this.aiExplainText(
        pub.conteudo || pub.assunto || pub.tipo_comunicacao || '',
        lc,
      );
      return { explanation, cached: false };
    }

    // ESAJ
    const ce = await this.prisma.caseEvent.findFirst({
      where: { id: movementId, case_id: caseId, type: 'MOVIMENTACAO' },
      select: { id: true, title: true, description: true, client_explanation: true },
    });
    if (!ce) throw new NotFoundException('Movimentacao nao encontrada');

    if (ce.client_explanation) {
      return { explanation: ce.client_explanation, cached: true };
    }

    const text = ce.description || ce.title || '';
    if (!text.trim()) {
      return { explanation: 'Sem conteúdo para explicar.', cached: false };
    }

    const explanation = await this.aiExplainText(text, lc);

    // Persiste pra futuras chamadas nao re-pagar IA
    await this.prisma.caseEvent.update({
      where: { id: ce.id },
      data: { client_explanation: explanation },
    }).catch((e: any) => this.logger.warn(`[PORTAL/explain] Cache failed: ${e.message}`));

    return { explanation, cached: false };
  }

  /**
   * Chama IA pra explicar texto juridico em linguagem leiga.
   * Prompt curto, modelo barato. Tom acolhedor, max 4 frases.
   */
  private async aiExplainText(
    text: string,
    legalCase: {
      case_number: string | null;
      action_type: string | null;
      legal_area: string | null;
      tracking_stage: string | null;
      opposing_party: string | null;
      client_is_author: boolean;
    },
  ): Promise<string> {
    const aiConfig = await this.settings.getAiConfig();
    const model = aiConfig.defaultModel || 'gpt-4.1-mini';
    const isAnthropic = model.startsWith('claude');

    const polo = legalCase.client_is_author ? 'autor' : 'reu';
    const systemPrompt =
      `Voce eh "Sophia", assistente do escritorio André Lustosa Advogados. Sua ` +
      `tarefa eh explicar um andamento processual em linguagem ACESSIVEL pra o ` +
      `cliente leigo, que NAO sabe direito. Regras:\n` +
      `- Maximo 4 frases curtas\n` +
      `- ZERO juridiquês: nao use termos como "polo passivo", "exordial", "decisum"\n` +
      `- Diga o que aconteceu E (se aplicavel) o que vem a seguir / o que o cliente deve fazer/esperar\n` +
      `- Nao invente fatos que nao estao no texto\n` +
      `- Tom: amigavel, acolhedor, profissional. Pode usar "voce".\n` +
      `- Pode comecar com algo como "Olha so:" ou "Esse andamento significa que..."\n` +
      `- NUNCA diga "como Sophia" ou repita seu nome\n` +
      `Retorne APENAS o texto da explicacao, sem cabecalhos.`;

    const userPrompt =
      `CONTEXTO DO PROCESSO:\n` +
      `- Tipo: ${legalCase.action_type || legalCase.legal_area || 'Processo Judicial'}\n` +
      `- Numero: ${legalCase.case_number || 'N/A'}\n` +
      `- Cliente eh: ${polo}\n` +
      `${legalCase.opposing_party ? `- Parte contraria: ${legalCase.opposing_party}\n` : ''}` +
      `${legalCase.tracking_stage ? `- Fase atual: ${legalCase.tracking_stage}\n` : ''}` +
      `\nMOVIMENTACAO:\n${text.slice(0, 4000)}\n\n` +
      `Explique pro cliente leigo o que essa movimentacao significa.`;

    if (isAnthropic) {
      const apiKey = (await this.settings.get('ANTHROPIC_API_KEY')) || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY nao configurada');
      const client = new Anthropic({ apiKey });
      const msg = await client.messages.create({
        model,
        max_tokens: 400,
        temperature: 0.4,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });
      return ((msg.content[0] as any)?.text || '').trim();
    } else {
      const apiKey = (await this.settings.get('OPENAI_API_KEY')) || process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error('OPENAI_API_KEY nao configurada');
      const openai = new OpenAI({ apiKey });
      const completion = await openai.chat.completions.create({
        model,
        temperature: 0.4,
        max_tokens: 400,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });
      return (completion.choices[0]?.message?.content || '').trim();
    }
  }

  /**
   * Eventos futuros (audiencia, pericia, prazo) do processo.
   */
  async listEvents(leadId: string, caseId: string) {
    const lc = await this.prisma.legalCase.findFirst({
      where: { id: caseId, lead_id: leadId },
      select: { id: true },
    });
    if (!lc) throw new NotFoundException('Processo nao encontrado');

    const events = await this.prisma.calendarEvent.findMany({
      where: {
        legal_case_id: caseId,
        status: { notIn: ['CANCELADO', 'CONCLUIDO'] },
        start_at: { gte: new Date() },
        type: { in: ['AUDIENCIA', 'PERICIA', 'PRAZO', 'TAREFA'] },
      },
      select: {
        id: true, type: true, title: true, description: true,
        start_at: true, end_at: true, location: true, priority: true,
      },
      orderBy: { start_at: 'asc' },
      take: 50,
    });

    return events.map(e => ({
      ...e,
      start_at: e.start_at.toISOString(),
      end_at: e.end_at?.toISOString() || null,
    }));
  }
}
