import { Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';

// ─── Interfaces ──────────────────────────────────────────────

export interface CourtCaseData {
  case_number: string;
  action_type: string;
  legal_area: string;
  subject: string;
  court: string;
  judge: string;
  claim_value: number | null;
  filed_at: string | null;
  status: string;
  parties: Array<{ role: string; name: string; lawyers?: string[] }>;
  movements: Array<{ date: string; description: string }>;
  tracking_stage: string;
  tribunal: string;
}

export interface CourtCaseListItem {
  case_number: string;
  action_type: string;
  court: string;
  parties_summary: string;
  processo_codigo: string;
  foro: string;
}

export interface CourtCaseListResult {
  cases: CourtCaseListItem[];
  totalPages: number;
  currentPage: number;
}

// ─── Helpers ─────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Formata 20 dígitos no padrão CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO */
const formatCNJ = (digits: string): string => {
  const d = digits.replace(/\D/g, '');
  if (d.length !== 20) return digits;
  return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16, 20)}`;
};

/** Infere tracking_stage a partir dos movimentos (último → primeiro) */
export const inferTrackingStage = (movements: Array<{ description: string }>): string => {
  for (const m of movements) {
    const desc = m.description.toLowerCase();
    if (/tr[aâ]nsito\s+em\s+julgado/.test(desc)) return 'TRANSITADO';
    if (/execu[çc][aã]o|cumprimento\s+de\s+senten/.test(desc)) return 'EXECUCAO';
    if (/senten[çc]a|julgamento|julgou|decis[aã]o\s+de\s+m[eé]rito/.test(desc)) return 'JULGAMENTO';
    if (/recurso|apela[çc][aã]o|agravo|embargos/.test(desc)) return 'RECURSO';
    if (/alega[çc][oõ]es\s+finais|memoriais|raz[oõ]es\s+finais/.test(desc)) return 'ALEGACOES_FINAIS';
    if (/audi[eê]ncia|instru[çc][aã]o/.test(desc)) return 'INSTRUCAO';
    if (/per[ií]cia|laudo\s+pericial/.test(desc)) return 'PERICIA_AGENDADA';
    if (/r[ée]plica/.test(desc)) return 'REPLICA';
    if (/contesta[çc][aã]o/.test(desc)) return 'CONTESTACAO';
    if (/cita[çc][aã]o|intima[çc][aã]o/.test(desc)) return 'CITACAO';
  }
  return 'DISTRIBUIDO';
};

/** Infere área jurídica */
const inferLegalArea = (areaText: string, assunto: string): string => {
  const combined = `${areaText} ${assunto}`.toLowerCase();
  if (/criminal|penal|crime/.test(combined)) return 'Criminal';
  if (/fam[ií]lia|divor|aliment|guard|invent[aá]rio/.test(combined)) return 'Família';
  if (/trabalh|tst|clt|reclam/.test(combined)) return 'Trabalhista';
  if (/fazenda|tribut|fiscal|execu[çc][aã]o\s+fiscal/.test(combined)) return 'Tributário';
  if (/consumidor|cdc/.test(combined)) return 'Consumidor';
  return areaText || 'Cível';
};

// ─── Scraper ESAJ TJAL ──────────────────────────────────────

export class EsajTjalScraper {
  private readonly logger = new Logger('EsajTjalScraper');
  private readonly BASE_URL = 'https://www2.tjal.jus.br/cpopg';
  private readonly USER_AGENT = 'LexCRM/1.0 (Consulta Processual; contato@andrelustaadv.com.br)';
  private readonly REQUEST_DELAY = 2000; // 2s entre requests

  // ─── Sessão ──────────────────────────────────────────────

  async initSession(): Promise<string> {
    const res = await fetch(`${this.BASE_URL}/open.do?cdForo=-1`, {
      headers: { 'User-Agent': this.USER_AGENT },
      signal: AbortSignal.timeout(15000),
      redirect: 'manual',
    });

    const cookies = res.headers.getSetCookie?.() || [];
    const jsessionId = cookies
      .find(c => c.startsWith('JSESSIONID='))
      ?.split(';')[0] || '';

    if (!jsessionId) {
      // Tentar extrair do header Set-Cookie alternativo
      const rawCookie = res.headers.get('set-cookie') || '';
      const match = rawCookie.match(/JSESSIONID=([^;]+)/);
      if (match) return `JSESSIONID=${match[1]}`;
      this.logger.warn('[SESSION] Nao obteve JSESSIONID, prosseguindo sem cookie');
      return '';
    }

    this.logger.debug(`[SESSION] Sessao iniciada: ${jsessionId.slice(0, 20)}...`);
    return jsessionId;
  }

  private async fetchPage(url: string, cookie: string): Promise<string> {
    const res = await fetch(url, {
      headers: {
        'User-Agent': this.USER_AGENT,
        'Cookie': cookie,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) {
      throw new Error(`ESAJ retornou HTTP ${res.status} para ${url}`);
    }

    return res.text();
  }

  // ─── Busca por Número ──────────────────────────────────────

  async searchByNumber(caseNumber: string): Promise<CourtCaseData | null> {
    const digits = caseNumber.replace(/\D/g, '');
    if (digits.length !== 20) {
      throw new Error(`Numero de processo invalido: esperados 20 digitos, recebidos ${digits.length}`);
    }

    const cookie = await this.initSession();
    await sleep(this.REQUEST_DELAY);

    // Montar URL de busca por número unificado
    const numeroDigitoAno = `${digits.slice(0, 7)}-${digits.slice(7, 9)}.${digits.slice(9, 13)}`;
    const foroNum = digits.slice(16, 20);

    const searchUrl = `${this.BASE_URL}/search.do?` + new URLSearchParams({
      'conversationId': '',
      'cbPesquisa': 'NUMPROC',
      'dadosConsulta.localPesquisa.cdLocal': '-1',
      'tipoNuProcesso': 'UNIFICADO',
      'numeroDigitoAnoUnificado': numeroDigitoAno,
      'foroNumeroUnificado': foroNum,
      'dadosConsulta.valorConsultaNuUnificado': digits,
      'dadosConsulta.valorConsulta': '',
    }).toString();

    this.logger.log(`[SEARCH] Buscando processo ${formatCNJ(digits)} no ESAJ/TJAL`);

    const html = await this.fetchPage(searchUrl, cookie);
    const $ = cheerio.load(html);

    // Verificar se caiu direto na página de detalhes (processo único)
    const hasDetail = $('#tabelaUltimasMovimentacoes').length > 0 || $('.secaoFormBody').length > 0;
    if (hasDetail) {
      return this.parseCaseDetail($, digits);
    }

    // Verificar se tem resultados na lista
    const resultLinks = $('a[href*="show.do"]');
    if (resultLinks.length === 0) {
      // Verificar se há mensagem de "não encontrado"
      const msgErro = $('#mensagemRetorno, .mensagemRetorno, .alert').text().trim();
      this.logger.log(`[SEARCH] Processo nao encontrado: ${msgErro || 'sem resultados'}`);
      return null;
    }

    // Pegar o primeiro resultado e buscar detalhes
    const firstLink = resultLinks.first().attr('href') || '';
    const codigoMatch = firstLink.match(/processo\.codigo=([^&]+)/);
    const foroMatch = firstLink.match(/processo\.foro=([^&]+)/);

    if (!codigoMatch) {
      this.logger.warn('[SEARCH] Nao encontrou codigo do processo no link');
      return null;
    }

    await sleep(this.REQUEST_DELAY);
    return this.fetchCaseDetail(codigoMatch[1], foroMatch?.[1] || '1', cookie);
  }

  // ─── Busca por OAB (todas as páginas) ────────────────────────

  async searchByOAB(oabNumber: string, oabUf = 'AL'): Promise<CourtCaseListResult> {
    const cookie = await this.initSession();
    await sleep(this.REQUEST_DELAY);

    // ESAJ TJAL aceita só o número (sem UF) — a UF é implícita no domínio
    const oabValue = oabNumber;
    const allCases: CourtCaseListItem[] = [];
    let currentPage = 1;
    let totalExpected = 0;
    const MAX_PAGES = 30; // segurança: máximo 750 processos

    // Buscar TODAS as páginas — continua enquanto houver resultados
    while (currentPage <= MAX_PAGES) {
      const searchUrl = `${this.BASE_URL}/search.do?` + new URLSearchParams({
        'conversationId': '',
        'cbPesquisa': 'NUMOAB',
        'dadosConsulta.localPesquisa.cdLocal': '-1',
        'tipoNuProcesso': 'UNIFICADO',
        'dadosConsulta.valorConsulta': oabValue,
        'paginaConsulta': String(currentPage),
      }).toString();

      this.logger.log(`[OAB] Buscando OAB ${oabValue}, pagina ${currentPage}...`);

      let html: string;
      try {
        html = await this.fetchPage(searchUrl, cookie);
      } catch (err: any) {
        this.logger.warn(`[OAB] Erro na pagina ${currentPage}: ${err.message}`);
        break;
      }
      const $ = cheerio.load(html);

      // Na primeira página, detectar total esperado para log
      if (currentPage === 1) {
        const bodyText = $('body').text();
        const totalMatch = bodyText.match(/(\d+)\s+Processos?\s+encontrados?/i);
        if (totalMatch) {
          totalExpected = parseInt(totalMatch[1]);
          this.logger.log(`[OAB] ESAJ reporta ${totalExpected} processos`);
        }
      }

      // Verificar se caiu direto na página de detalhes (1 resultado)
      const hasDetail = $('#tabelaUltimasMovimentacoes').length > 0;
      if (hasDetail && currentPage === 1) {
        const parsed = this.parseCaseDetail($, '');
        if (parsed) {
          allCases.push({
            case_number: parsed.case_number,
            action_type: parsed.action_type,
            court: parsed.court,
            parties_summary: parsed.parties.map(p => `${p.role}: ${p.name}`).slice(0, 3).join('; '),
            processo_codigo: '',
            foro: '',
          });
        }
        break;
      }

      // Parsear resultados desta página
      const links = $('a[href*="show.do"]');
      if (links.length === 0) {
        this.logger.log(`[OAB] Pagina ${currentPage}: 0 resultados — fim da paginação`);
        break;
      }

      links.each((_, el) => {
        const href = $(el).attr('href') || '';
        const codigoMatch = href.match(/processo\.codigo=([^&]+)/);
        const foroMatch = href.match(/processo\.foro=([^&]+)/);

        const linkText = $(el).text().trim();
        const digits = linkText.replace(/\D/g, '');
        const caseNumber = digits.length === 20 ? formatCNJ(digits) : linkText;

        const container = $(el).closest('tr, .containerResultado, div.linha, li').first();
        let containerText = container.length
          ? container.text().replace(/\s+/g, ' ').trim()
          : $(el).parent().text().replace(/\s+/g, ' ').trim();

        // Extrair vara/juizado do texto "Recebido em: DD/MM/YYYY - Vara..."
        let court = '';
        const recebidoMatch = containerText.match(/Recebido em:\s*[\d\/]+\s*-\s*(.+?)(?:\s*$|\s*Advogado)/i);
        if (recebidoMatch) court = recebidoMatch[1].trim();

        // Extrair classe processual (texto entre o advogado e "Recebido em:")
        let actionType = '';
        const afterNumber = containerText.split(linkText).pop() || '';
        const beforeRecebido = afterNumber.split(/Recebido em:/i)[0] || '';
        const cleanedAction = beforeRecebido
          .replace(/Advogado\(a\):\s*[^\s]+(?: [^\s]+)*/i, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (cleanedAction.length > 3 && cleanedAction.length < 200) {
          actionType = cleanedAction;
        }

        allCases.push({
          case_number: caseNumber,
          action_type: actionType,
          court,
          parties_summary: '',
          processo_codigo: codigoMatch?.[1] || '',
          foro: foroMatch?.[1] || '',
        });
      });

      this.logger.log(`[OAB] Pagina ${currentPage}: ${links.length} processos (acumulado: ${allCases.length}${totalExpected ? `/${totalExpected}` : ''})`);

      // Se encontrou menos de 25 resultados, é a última página
      if (links.length < 25) {
        this.logger.log(`[OAB] Pagina ${currentPage} com ${links.length} resultados (<25) — última página`);
        break;
      }

      currentPage++;
      await sleep(this.REQUEST_DELAY);
    }

    this.logger.log(`[OAB] Concluido: ${allCases.length} processos em ${currentPage} paginas${totalExpected ? ` (ESAJ reportou ${totalExpected})` : ''}`);
    return { cases: allCases, totalPages: currentPage, currentPage };
  }

  // ─── Detalhe do Processo ───────────────────────────────────

  async fetchCaseDetail(processoCodigo: string, foro: string, cookie: string): Promise<CourtCaseData | null> {
    const detailUrl = `${this.BASE_URL}/show.do?` + new URLSearchParams({
      'processo.codigo': processoCodigo,
      'processo.foro': foro,
    }).toString();

    this.logger.log(`[DETAIL] Buscando detalhes: codigo=${processoCodigo}, foro=${foro}`);

    const html = await this.fetchPage(detailUrl, cookie);
    const $ = cheerio.load(html);

    return this.parseCaseDetail($, '');
  }

  // ─── Parser de Detalhes ────────────────────────────────────

  private parseCaseDetail($: cheerio.CheerioAPI, fallbackDigits: string): CourtCaseData | null {
    // Helper: lê o texto de um elemento pelo ID (padrão SAJ/CPOPG).
    // O SAJ (plataforma usada por TJAL, TJSP, TJAC, TJBA, TJMS, TJMT, TJMG,
    // TJPB, TJPE, TJPR, TJRS, TJSC etc.) expõe cada campo com um ID próprio
    // e rotula com <span class="unj-label">. Buscar por rótulo (como o
    // parser antigo fazia via "td.label") não funciona.
    const getById = (id: string): string =>
      $(`#${id}`).first().text().replace(/\s+/g, ' ').trim();

    // Extrair número do processo — ID padrão do SAJ
    let caseNumberRaw = getById('numeroProcesso');
    if (!caseNumberRaw) {
      // Fallback 1: span.unj-larger-1 no cabeçalho da entidade
      caseNumberRaw = $('.unj-entity-header .unj-larger-1').first().text().trim();
    }
    if (!caseNumberRaw) {
      // Fallback 2: qualquer elemento com atributo contendo numeroProcesso
      caseNumberRaw = $('[id*="numeroProcesso"]').first().text().trim();
    }

    const digits = (caseNumberRaw || fallbackDigits).replace(/\D/g, '');
    const caseNumber = digits.length === 20 ? formatCNJ(digits) : caseNumberRaw || fallbackDigits;

    if (!caseNumber) {
      this.logger.warn('[PARSE] Nao encontrou numero do processo');
      return null;
    }

    // Dados básicos — IDs padrão do SAJ
    const actionType = getById('classeProcesso');
    const areaText   = getById('areaProcesso'); // pode não existir — ok
    const subject    = getById('assuntoProcesso');
    const foro       = getById('foroProcesso');
    const vara       = getById('varaProcesso');
    const court      = [foro, vara].filter(Boolean).join(' - ') || vara || foro;
    const judge      = getById('juizProcesso');
    const statusText = getById('situacaoProcesso');
    const distributionDate = getById('dataHoraDistribuicaoProcesso');

    // Valor da causa
    let claimValue: number | null = null;
    const valorText = getById('valorAcaoProcesso');
    if (valorText) {
      // Remove "R$", espaços e separadores de milhar, troca vírgula decimal por ponto
      const cleaned = valorText.replace(/[R$\s.]/g, '').replace(',', '.');
      const parsed = parseFloat(cleaned);
      if (!isNaN(parsed)) claimValue = parsed;
    }

    // Data de ajuizamento
    let filedAt: string | null = null;
    if (distributionDate) {
      const dateMatch = distributionDate.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if (dateMatch) {
        filedAt = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
      }
    }

    // Partes
    const parties: Array<{ role: string; name: string; lawyers?: string[] }> = [];
    const partesTable = $('#tableTodasPartes, #tablePartesPrincipais').first();
    if (partesTable.length) {
      partesTable.find('tr').each((_, row) => {
        const tds = $(row).find('td');
        if (tds.length >= 2) {
          const role = $(tds[0]).text().trim().replace(/:$/, '');
          const nameEl = $(tds[1]);
          const name = nameEl.clone().children('span').remove().end().text().trim().split('\n')[0].trim();

          const lawyers: string[] = [];
          nameEl.find('span').each((_, span) => {
            const lawyerText = $(span).text().trim();
            if (lawyerText) lawyers.push(lawyerText);
          });

          if (role && name) {
            parties.push({ role, name, lawyers: lawyers.length ? lawyers : undefined });
          }
        }
      });
    }

    // Movimentacoes — multiplos parsers testados em paralelo, escolhe o melhor.
    //
    // Historia do algoritmo:
    // - 2026-04-20 v1: 4 estrategias em cascata (fallback linear).
    // - 2026-04-21 v2: priorizar #tabelaTodasMovimentacoes sobre Ultimas.
    // - 2026-04-21 v3 (esta): aplicar multiplos PARSERS na tabela escolhida
    //   e pegar o de maior retorno. Motivo: processo 0700223-79.2022.8.02.0204
    //   tinha Todas=103 linhas mas o parser `tds[0]+tds[1]` extraia 0
    //   (TDs com estrutura mais complexa — rowspan, divs aninhadas, etc.),
    //   caindo no fallback date-heuristic que pegou so 22 de 103.
    //
    // Logs detalhados mostram qual tabela + qual parser funcionou.
    const movements: Array<{ date: string; description: string }> = [];
    let extractionStrategy = 'none';

    // Log de diagnostico: quantas linhas tem cada tabela conhecida
    const tableTodasCount = $('#tabelaTodasMovimentacoes, #tableTodasMovimentacoes').find('tr').length;
    const tableUltimasCount = $('#tabelaUltimasMovimentacoes, #tableUltimasMovimentacoes').find('tr').length;
    this.logger.log(
      `[PARSE] Diagnostico tabelas: Todas=${tableTodasCount} Ultimas=${tableUltimasCount}`,
    );

    // Seleciona a tabela de maior cobertura (Todas > Ultimas > regex "ovimenta").
    let movTable = $('#tabelaTodasMovimentacoes, #tableTodasMovimentacoes').first();
    let tableLabel = 'tabelaTodas';
    if (!movTable.length) {
      movTable = $('#tabelaUltimasMovimentacoes, #tableUltimasMovimentacoes').first();
      if (movTable.length) tableLabel = 'tabelaUltimas';
    }
    if (!movTable.length) {
      movTable = $('table, tbody').filter((_, el) => {
        const id = $(el).attr('id') || '';
        return /ovimenta/i.test(id);
      }).first();
      if (movTable.length) tableLabel = 'id-contains';
    }

    // Aplica varios parsers na tabela escolhida e pega o de maior retorno.
    // Mais robusto contra variacoes de layout (rowspan, divs aninhadas,
    // classes diferentes) porque qualquer um que funcione sera escolhido.
    if (movTable.length) {
      const parsers: Array<{ name: string; fn: () => typeof movements }> = [
        // Parser A: td.dataMovimentacao + td.descricaoMovimentacao
        {
          name: 'td-classes',
          fn: () => {
            const out: typeof movements = [];
            movTable.find('tr').each((_, row) => {
              const dateText = $(row).find('td.dataMovimentacao').text().trim();
              const description = $(row).find('td.descricaoMovimentacao').text().replace(/\s+/g, ' ').trim();
              if (dateText && description) out.push({ date: dateText, description });
            });
            return out;
          },
        },
        // Parser B: tds[0] + tds[1] (posicional)
        {
          name: 'td-position',
          fn: () => {
            const out: typeof movements = [];
            movTable.find('tr').each((_, row) => {
              const tds = $(row).find('td');
              if (tds.length >= 2) {
                const dateText = $(tds[0]).text().trim();
                const description = $(tds[1]).text().replace(/\s+/g, ' ').trim();
                if (dateText && description) out.push({ date: dateText, description });
              }
            });
            return out;
          },
        },
        // Parser C: regex dd/mm/yyyy em QUALQUER td da linha, descricao = texto
        // restante. Robusto contra rowspan/colspan e estruturas aninhadas.
        {
          name: 'td-regex',
          fn: () => {
            const datePattern = /\d{2}\/\d{2}\/\d{4}/;
            const out: typeof movements = [];
            movTable.find('tr').each((_, row) => {
              let foundDate = '';
              const parts: string[] = [];
              $(row).find('td').each((_, td) => {
                const text = $(td).text().replace(/\s+/g, ' ').trim();
                if (!text) return;
                const match = text.match(datePattern);
                if (!foundDate && match) {
                  foundDate = match[0];
                  // Se a celula tinha texto alem da data, adiciona o restante como descricao
                  const rest = text.replace(datePattern, '').trim();
                  if (rest) parts.push(rest);
                } else {
                  parts.push(text);
                }
              });
              const description = parts.join(' ').trim();
              if (foundDate && description) out.push({ date: foundDate, description });
            });
            return out;
          },
        },
      ];

      // Executa todos os parsers e pega o de maior retorno.
      let bestParser = 'none';
      for (const p of parsers) {
        const result = p.fn();
        this.logger.log(`[PARSE] Parser "${p.name}" extraiu ${result.length} movimentacoes`);
        if (result.length > movements.length) {
          movements.length = 0;
          movements.push(...result);
          bestParser = p.name;
        }
      }
      if (movements.length > 0) {
        extractionStrategy = `${tableLabel}:${bestParser}`;
      }
    }

    // Fallback final (ultima rede de seguranca): date-heuristic global na pagina
    // inteira. Usado apenas se a tabela escolhida nao rendeu nada OU se a tabela
    // nem foi encontrada. Dedupa por (date|description).
    if (movements.length === 0) {
      const datePattern = /^\d{2}\/\d{2}\/\d{4}$/;
      const seen = new Set<string>();
      $('tr').each((_, row) => {
        const tds = $(row).find('td');
        if (tds.length >= 2) {
          const dateText = $(tds[0]).text().trim();
          if (datePattern.test(dateText)) {
            const description = $(tds[1]).text().replace(/\s+/g, ' ').trim();
            if (description) {
              const key = `${dateText}|${description}`;
              if (!seen.has(key)) {
                seen.add(key);
                movements.push({ date: dateText, description });
              }
            }
          }
        }
      });
      if (movements.length > 0) extractionStrategy = 'date-heuristic-global';
    }

    if (movements.length > 0) {
      this.logger.log(`[PARSE] Movimentacoes extraidas via estrategia="${extractionStrategy}" total=${movements.length}`);
    }

    // Inferir área e tracking stage
    const legalArea = inferLegalArea(areaText, subject);
    const trackingStage = inferTrackingStage(movements);

    const result: CourtCaseData = {
      case_number: caseNumber,
      action_type: actionType,
      legal_area: legalArea,
      subject,
      court,
      judge,
      claim_value: claimValue,
      filed_at: filedAt,
      status: statusText || 'Ativo',
      parties,
      // Atualizado em 2026-04-20: retorna TODAS as movimentacoes extraidas
      // do HTML (antes limitava a 20). O HTML do show.do do e-SAJ ja contem
      // todas as movimentacoes no elemento #tabelaTodasMovimentacoes — so
      // ficam ocultas via CSS ate o usuario clicar em "Ver todas". O scraper
      // le o tbody inteiro sem precisar de AJAX adicional.
      movements,
      tracking_stage: trackingStage,
      tribunal: 'TJAL',
    };

    // Diagnóstico: se algum campo crítico vier vazio, logar os IDs faltantes.
    // Facilita detectar divergências pontuais do TJAL sem precisar dump de HTML.
    const missing: string[] = [];
    if (!actionType)  missing.push('classeProcesso');
    if (!subject)     missing.push('assuntoProcesso');
    if (!court)       missing.push('foroProcesso/varaProcesso');
    if (!judge)       missing.push('juizProcesso');
    if (claimValue == null) missing.push('valorAcaoProcesso');
    if (!filedAt)     missing.push('dataHoraDistribuicaoProcesso');
    if (parties.length === 0)   missing.push('tableTodasPartes');
    if (movements.length === 0) missing.push('tabelaTodasMovimentacoes');

    if (missing.length > 0) {
      this.logger.warn(
        `[PARSE] Processo ${caseNumber}: campos vazios = [${missing.join(', ')}]`,
      );
    }

    // Diagnostico extra: se nao achou movimentacoes, lista TODAS as tables
    // da pagina com id+row count para descobrir qual o TJAL esta usando.
    // Facilita fazer o fix definitivo sem precisar dump completo do HTML.
    if (movements.length === 0) {
      const tables = $('table').map((_, el) => {
        const id = $(el).attr('id') || '-';
        const cls = ($(el).attr('class') || '-').slice(0, 25);
        const rows = $(el).find('tr').length;
        return `${id}.${cls}[${rows}r]`;
      }).get().slice(0, 15);
      this.logger.warn(
        `[PARSE-DEBUG] Processo ${caseNumber}: tables na pagina: ${tables.join(' | ') || '(nenhuma)'}`,
      );
    }

    this.logger.log(
      `[PARSE] Processo ${caseNumber}: ${actionType || '(sem classe)'} | ${court || '(sem vara)'} | ${parties.length} partes | ${movements.length} movs`,
    );
    return result;
  }
}
