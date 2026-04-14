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
const inferTrackingStage = (movements: Array<{ description: string }>): string => {
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

  private async initSession(): Promise<string> {
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

    // ESAJ aceita formato "14209AL" (número + UF) no campo de valor
    const oabValue = `${oabNumber}${oabUf}`;
    const allCases: CourtCaseListItem[] = [];
    let currentPage = 1;
    let totalPages = 1;

    // Buscar TODAS as páginas automaticamente
    do {
      const searchUrl = `${this.BASE_URL}/search.do?` + new URLSearchParams({
        'conversationId': '',
        'cbPesquisa': 'NUMOAB',
        'dadosConsulta.localPesquisa.cdLocal': '-1',
        'tipoNuProcesso': 'UNIFICADO',
        'dadosConsulta.valorConsulta': oabValue,
        'paginaConsulta': String(currentPage),
      }).toString();

      this.logger.log(`[OAB] Buscando processos para OAB ${oabValue}, pagina ${currentPage}...`);

      const html = await this.fetchPage(searchUrl, cookie);
      const $ = cheerio.load(html);

      // Detectar total de páginas na primeira requisição
      if (currentPage === 1) {
        // Extrair "164 Processos encontrados" do texto
        const totalText = $('body').text();
        const totalMatch = totalText.match(/(\d+)\s+Processos?\s+encontrados?/i);
        if (totalMatch) {
          const totalResults = parseInt(totalMatch[1]);
          totalPages = Math.ceil(totalResults / 25); // ESAJ pagina em 25
          this.logger.log(`[OAB] Total: ${totalResults} processos em ${totalPages} paginas`);
        }

        // Fallback: contar páginas pelos links de paginação
        if (totalPages <= 1) {
          $('a[href*="paginaConsulta"]').each((_, el) => {
            const href = $(el).attr('href') || '';
            const pageMatch = href.match(/paginaConsulta=(\d+)/);
            if (pageMatch) totalPages = Math.max(totalPages, parseInt(pageMatch[1]));
          });
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
      if (links.length === 0) break;

      links.each((_, el) => {
        const href = $(el).attr('href') || '';
        const codigoMatch = href.match(/processo\.codigo=([^&]+)/);
        const foroMatch = href.match(/processo\.foro=([^&]+)/);

        const linkText = $(el).text().trim();
        const digits = linkText.replace(/\D/g, '');
        const caseNumber = digits.length === 20 ? formatCNJ(digits) : linkText;

        // O container pai no ESAJ TJAL tem a estrutura:
        // <a>número</a> ... classe/assunto ... "Recebido em: data - vara"
        const container = $(el).closest('tr, .containerResultado, div.linha, li').first();
        let containerText = '';
        if (container.length) {
          containerText = container.text().replace(/\s+/g, ' ').trim();
        } else {
          // Fallback: pegar próximos siblings até encontrar outro link
          let sibling = $(el).parent();
          containerText = sibling.text().replace(/\s+/g, ' ').trim();
        }

        // Extrair classe processual e assunto (textos em negrito após o número)
        let actionType = '';
        let court = '';
        let partiesSummary = '';

        // Padrão ESAJ: "Execução de Título Extrajudicial Obrigação de Fazer"
        // seguido de "Recebido em: 08/04/2026 - 1º Juizado Especial Cível..."
        const recebidoMatch = containerText.match(/Recebido em:\s*[\d\/]+\s*-\s*(.+?)(?:\s*$|\s*Advogado)/i);
        if (recebidoMatch) court = recebidoMatch[1].trim();

        // Extrair advogado
        const advMatch = containerText.match(/Advogado\(a\):\s*(.+?)(?:\s+(?:Execu|Procedimento|Tutela|A[çc][aã]o|Reclama|Recebido)|$)/i);

        // Tudo entre o número do processo e "Recebido em:" é a classe + assunto
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
          parties_summary: partiesSummary,
          processo_codigo: codigoMatch?.[1] || '',
          foro: foroMatch?.[1] || '',
        });
      });

      this.logger.log(`[OAB] Pagina ${currentPage}/${totalPages}: ${links.length} processos (total acumulado: ${allCases.length})`);

      currentPage++;
      if (currentPage <= totalPages) {
        await sleep(this.REQUEST_DELAY); // Rate limit entre páginas
      }
    } while (currentPage <= totalPages);

    this.logger.log(`[OAB] Concluido: ${allCases.length} processos encontrados em ${totalPages} paginas`);
    return { cases: allCases, totalPages, currentPage: totalPages };
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
    // Helper: buscar valor por label na tabela .secaoFormBody
    const getFieldValue = (label: string): string => {
      let value = '';
      $('td.label, th.label, span.label').each((_, el) => {
        const labelText = $(el).text().trim().replace(/:$/, '');
        if (labelText.toLowerCase() === label.toLowerCase()) {
          const valueTd = $(el).next('td, span');
          value = valueTd.text().trim();
        }
      });

      // Fallback: buscar no formato div com labels
      if (!value) {
        $('div, tr').each((_, el) => {
          const text = $(el).text().trim();
          const regex = new RegExp(`${label}\\s*:?\\s*(.+)`, 'i');
          const match = text.match(regex);
          if (match && !value) {
            value = match[1].trim().split('\n')[0].trim();
          }
        });
      }

      return value;
    };

    // Extrair número do processo
    let caseNumberRaw = getFieldValue('Processo') || getFieldValue('Número');
    if (!caseNumberRaw) {
      // Tentar pelo título da página
      const titleText = $('h2, .titulo, #numeroProcesso').first().text().trim();
      const digitsMatch = titleText.match(/(\d[\d.\-\/]+\d)/);
      if (digitsMatch) caseNumberRaw = digitsMatch[1];
    }

    const digits = (caseNumberRaw || fallbackDigits).replace(/\D/g, '');
    const caseNumber = digits.length === 20 ? formatCNJ(digits) : caseNumberRaw || fallbackDigits;

    if (!caseNumber) {
      this.logger.warn('[PARSE] Nao encontrou numero do processo');
      return null;
    }

    // Dados básicos
    const actionType = getFieldValue('Classe');
    const areaText = getFieldValue('Área') || getFieldValue('Area');
    const subject = getFieldValue('Assunto');
    const court = getFieldValue('Vara') || getFieldValue('Foro');
    const judge = getFieldValue('Juiz') || getFieldValue('Juíz');
    const statusText = getFieldValue('Situação') || getFieldValue('Situacao');
    const distributionDate = getFieldValue('Distribuição') || getFieldValue('Distribuicao');

    // Valor da causa
    let claimValue: number | null = null;
    const valorText = getFieldValue('Valor da ação') || getFieldValue('Valor da Ação');
    if (valorText) {
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

    // Movimentações
    const movements: Array<{ date: string; description: string }> = [];
    const movTable = $('#tabelaTodasMovimentacoes, #tabelaUltimasMovimentacoes').first();
    if (movTable.length) {
      movTable.find('tr').each((_, row) => {
        const tds = $(row).find('td');
        if (tds.length >= 2) {
          const dateText = $(tds[0]).text().trim();
          const description = $(tds[1]).text().replace(/\s+/g, ' ').trim();
          if (dateText && description) {
            movements.push({ date: dateText, description });
          }
        }
      });
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
      movements: movements.slice(0, 20), // limitar a 20 movimentações
      tracking_stage: trackingStage,
      tribunal: 'TJAL',
    };

    this.logger.log(`[PARSE] Processo ${caseNumber}: ${actionType} | ${court} | ${parties.length} partes | ${movements.length} movs`);
    return result;
  }
}
