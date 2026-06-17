import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediaS3Service } from '../media/s3.service';
import { FileStorageService } from '../media/filesystem.service';
import { SettingsService } from '../settings/settings.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { assertAiCostCap } from '../common/utils/ai-cost-cap.util';
import { buildTokenParam } from '../common/utils/openai-token-param.util';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib';
import { Readable } from 'stream';

// Área do texto sobre o timbrado (em pt; origem do PDF é embaixo-à-esquerda).
export interface ProcMargins { top: number; bottom: number; left: number; right: number }
// Padrão calibrado pelo modelo do escritório: corpo justificado, margens ~85,
// texto começando ~96pt abaixo do topo (logo abaixo do cabeçalho do timbrado).
const DEFAULT_MARGINS: ProcMargins = { top: 96, bottom: 56, left: 85, right: 85 };
// Default ANTIGO (antes da calibração) — tratado como "não personalizado" e
// migrado para o novo padrão, pra quem já salvou config não ficar com o layout ruim.
const LEGACY_MARGINS: ProcMargins = { top: 200, bottom: 110, left: 70, right: 70 };
function resolveMargins(stored: ProcMargins | null | undefined): ProcMargins {
  if (!stored) return DEFAULT_MARGINS;
  if (stored.top === LEGACY_MARGINS.top && stored.bottom === LEGACY_MARGINS.bottom
    && stored.left === LEGACY_MARGINS.left && stored.right === LEGACY_MARGINS.right) return DEFAULT_MARGINS;
  return stored;
}
// ── Tipografia configurável por escritório ───────────────────────────────────
export interface ProcStyle {
  font: 'times' | 'helvetica';
  size: number;        // pt
  lineSpacing: number; // entrelinha (1.15 compacto … 2 duplo); padrão ~1.34
  justify: boolean;    // corpo justificado (true) ou à esquerda (false)
  autoFit: boolean;    // reduzir a fonte p/ caber em 1 página
  upperName: boolean;  // nome do cliente ({{nome_completo}}) em MAIÚSCULAS
}
const DEFAULT_STYLE: ProcStyle = { font: 'times', size: 12, lineSpacing: 1.34, justify: true, autoFit: true, upperName: false };
function resolveStyle(stored: any): ProcStyle {
  const s = (stored ?? {}) as Partial<ProcStyle>;
  return {
    font: s.font === 'helvetica' ? 'helvetica' : 'times',
    size: typeof s.size === 'number' && s.size >= 6 && s.size <= 24 ? s.size : DEFAULT_STYLE.size,
    lineSpacing: typeof s.lineSpacing === 'number' && s.lineSpacing >= 1 && s.lineSpacing <= 3 ? s.lineSpacing : DEFAULT_STYLE.lineSpacing,
    justify: s.justify === undefined ? true : !!s.justify,
    autoFit: s.autoFit === undefined ? true : !!s.autoFit,
    upperName: !!s.upperName,
  };
}
const FONT_REGULAR: Record<ProcStyle['font'], StandardFonts> = {
  times: StandardFonts.TimesRoman,
  helvetica: StandardFonts.Helvetica,
};
const FONT_BOLD: Record<ProcStyle['font'], StandardFonts> = {
  times: StandardFonts.TimesRomanBold,
  helvetica: StandardFonts.HelveticaBold,
};
const A4: [number, number] = [595.28, 841.89];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c) => chunks.push(Buffer.from(c)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}
function fmtCpfCnpj(v?: string | null): string {
  if (!v) return '';
  const d = v.replace(/\D/g, '');
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return v;
}
function fmtCep(v?: string | null): string {
  if (!v) return '';
  const d = v.replace(/\D/g, '');
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : v;
}
// Data de nascimento → {curto: "25/09/1963", extenso: "25 de setembro de 1963"}.
// Aceita ISO (AAAA-MM-DD) ou BR (DD/MM/AAAA); formato desconhecido volta cru.
function fmtNascimento(raw?: string | null): { curto: string; extenso: string } {
  if (!raw) return { curto: '', extenso: '' };
  const s = String(raw).trim();
  let y = 0, mo = 0, d = 0;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (iso) { y = +iso[1]; mo = +iso[2]; d = +iso[3]; }
  else if (br) { d = +br[1]; mo = +br[2]; y = +br[3]; }
  else return { curto: s, extenso: s };
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return { curto: s, extenso: s };
  return { curto: `${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${y}`, extenso: `${d} de ${MESES[mo - 1]} de ${y}` };
}
// Capitalização de endereço/nome: "PRAÇA PEDRO DE LIMA SILVA" → "Praça Pedro de
// Lima Silva". Conectores (de/da/do…) ficam minúsculos; o resto com inicial maiúscula.
// Corrige documentos/comprovantes que vêm em CAIXA ALTA.
function titulo(s?: string | null): string {
  if (!s) return '';
  const conector = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'di', 'du', 'del', 'la']);
  return String(s).trim().toLowerCase().split(/\s+/)
    .map((w, i) => (i > 0 && conector.has(w)) ? w : (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}
// ── Mini-motor de layout (pdf-lib só desenha à esquerda) ──────────────────────
// Replica a formatação do modelo do escritório: corpo JUSTIFICADO, título/data/
// assinatura (linha curta isolada) CENTRALIZADOS, espaço entre parágrafos e
// linhas em branco do texto viram espaço vertical.
const PARA_GAP_RATIO = 0.55;   // folga extra após cada parágrafo
const CENTER_MAX_RATIO = 0.72; // linha única mais curta que isto → centraliza

// Uma PALAVRA é uma sequência de SEGMENTOS colados (cada um regular ou negrito),
// desenhados sem espaço entre si — só há espaço ENTRE palavras. Assim "**X**," vira
// "X," (X negrito, vírgula normal) sem espaço sobrando antes da vírgula.
type Seg = { t: string; b: boolean };
type Word = Seg[];
type LayoutItem = { words: Word[]; align: 'justify' | 'left' | 'center'; dy: number };
interface Layout { items: LayoutItem[]; height: number; space: number }

// Quebra uma linha em palavras, alternando negrito a cada "**"; segmentos sem
// espaço entre eles ficam na MESMA palavra (colados).
function parseWords(line: string): Word[] {
  const words: Word[] = [];
  let cur: Seg[] = [];
  let buf = '';
  let bold = false;
  const flush = () => { if (buf) { cur.push({ t: buf, b: bold }); buf = ''; } };
  const endWord = () => { flush(); if (cur.length) { words.push(cur); cur = []; } };
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '*' && line[i + 1] === '*') { flush(); bold = !bold; i++; continue; }
    const ch = line[i];
    if (ch === ' ' || ch === '\t') { endWord(); continue; }
    buf += ch;
  }
  endWord();
  return words;
}

function layoutText(text: string, regular: PDFFont, bold: PDFFont, size: number, maxWidth: number, lineRatio: number, justify: boolean): Layout {
  const segW = (s: Seg) => (s.b ? bold : regular).widthOfTextAtSize(s.t, size);
  const wW = (w: Word) => w.reduce((a, s) => a + segW(s), 0);
  const space = regular.widthOfTextAtSize(' ', size);
  const lineHeight = size * lineRatio;
  const paraGap = lineHeight * PARA_GAP_RATIO;
  const natW = (ws: Word[]) => ws.reduce((a, w) => a + wW(w), 0) + Math.max(0, ws.length - 1) * space;
  const items: LayoutItem[] = [];
  let off = 0;
  for (const raw of (text || '').replace(/\r/g, '').split('\n')) {
    const words = raw.trim() === '' ? [] : parseWords(raw);
    if (!words.length) { off += lineHeight; continue; } // linha em branco = espaço
    // quebra gulosa por largura
    const wlines: Word[][] = [];
    let cur: Word[] = [], curW = 0;
    for (const w of words) {
      const ww = wW(w);
      if (!cur.length) { cur = [w]; curW = ww; }
      else if (curW + space + ww <= maxWidth) { cur.push(w); curW += space + ww; }
      else { wlines.push(cur); cur = [w]; curW = ww; }
    }
    if (cur.length) wlines.push(cur);
    const centered = wlines.length === 1 && natW(wlines[0]) <= maxWidth * CENTER_MAX_RATIO;
    for (let li = 0; li < wlines.length; li++) {
      const last = li === wlines.length - 1;
      const align = centered ? 'center' : justify && !last ? 'justify' : 'left';
      items.push({ words: wlines[li], align, dy: off });
      off += lineHeight;
    }
    off += paraGap; // espaço entre parágrafos
  }
  return { items, height: off, space };
}

// Desenha palavra a palavra; dentro da palavra, cada segmento na sua fonte e
// colado ao anterior. Espaço/gap só ENTRE palavras.
function drawLayout(page: PDFPage, L: Layout, regular: PDFFont, bold: PDFFont, size: number, color: ReturnType<typeof rgb>, leftX: number, topY: number, maxWidth: number) {
  const segFont = (s: Seg) => (s.b ? bold : regular);
  const segW = (s: Seg) => segFont(s).widthOfTextAtSize(s.t, size);
  const wW = (w: Word) => w.reduce((a, s) => a + segW(s), 0);
  for (const it of L.items) {
    const y = topY - it.dy;
    const sumW = it.words.reduce((a, w) => a + wW(w), 0);
    let x = leftX;
    let gap = L.space;
    if (it.align === 'justify' && it.words.length > 1) {
      const g = (maxWidth - sumW) / (it.words.length - 1);
      if (g > 0) gap = g;
    } else if (it.align === 'center') {
      x = leftX + (maxWidth - (sumW + Math.max(0, it.words.length - 1) * L.space)) / 2;
    }
    for (const w of it.words) {
      for (const s of w) { page.drawText(s.t, { x, y, size, font: segFont(s), color }); x += segW(s); }
      x += gap;
    }
  }
}

// ── Leitura automática do documento (foto de RG/CNH) por IA de visão ─────────
// Preço por 1M tokens (mesma tabela das petições) — só p/ registrar custo.
const DOC_OPENAI_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini':  { input: 0.15,  output: 0.60  },
  'gpt-4o':       { input: 5.00,  output: 15.00 },
  'gpt-4.1':      { input: 2.00,  output: 8.00  },
  'gpt-4.1-mini': { input: 0.40,  output: 1.60  },
  'gpt-5':        { input: 15.00, output: 60.00 },
};
const DOC_MAX_IMAGES = 6;                        // imagens mais recentes da conversa
const DOC_MAX_IMAGE_BYTES = 6 * 1024 * 1024;     // pula imagem > 6MB (custo/token)
const DOC_MAX_PDFS = 3;                           // PDFs mais recentes da conversa
const DOC_MAX_PDF_BYTES = 8 * 1024 * 1024;        // pula PDF > 8MB (páginas/custo)
const DOC_MAX_HIST_MSGS = 40;                     // mensagens de texto recentes pro contexto
const DOC_MAX_HIST_CHARS = 4000;                  // teto do histórico (tokens/custo)
const DOC_AI_TIMEOUT_MS = 120_000;
const DOC_MAX_TOKENS = 1200;
// Prompt COMPLETO configurável pelo admin master via AI_DOC_PROMPT (instruções +
// lista de campos). O código mapeia as CHAVES exatas do JSON (full_name, cpf, rg,
// rg_issuer, nationality, marital_status, profession, address_*) — se o master
// renomear/remover uma chave, aquele campo deixa de ser preenchido (é o trade-off
// de ter acesso total). Vazio → volta a este padrão.
const DEFAULT_DOC_PROMPT =
  'Você lê documentos de identificação brasileiros (RG, CNH) e comprovantes e extrai os dados cadastrais. ' +
  'Responda SOMENTE com um objeto JSON válido, sem texto antes/depois e sem markdown.\n\n' +
  'Analise o(s) documento(s)/imagem(ns) em anexo. Se houver um documento de identidade (RG/CNH) ou comprovante de endereço legível, ' +
  'extraia os campos abaixo. Se um campo não estiver visível/legível, use null — NÃO invente.\n\n' +
  'Retorne JSON com EXATAMENTE estas chaves:\n' +
  '{\n' +
  '  "is_documento": boolean,        // true se há documento de identidade legível\n' +
  '  "confere_cliente": boolean|null,// true se o nome do documento corresponde ao contato informado; false se for claramente OUTRA pessoa; null se não houver referência ou não der pra ter certeza\n' +
  '  "nome_no_documento": string|null, // nome que aparece no documento\n' +
  '  "full_name": string|null,       // nome civil completo\n' +
  '  "cpf": string|null,             // só números\n' +
  '  "rg": string|null,              // número do RG (sem o órgão)\n' +
  '  "rg_issuer": string|null,       // órgão emissor, ex: "SSP/AL"\n' +
  '  "nationality": string|null,     // "brasileiro" ou "brasileira" conforme o sexo no documento; senão a nacionalidade indicada\n' +
  '  "marital_status": string|null,  // estado civil, se constar\n' +
  '  "profession": string|null,      // profissão, se constar\n' +
  '  "birth_date": string|null,      // data de nascimento no formato AAAA-MM-DD (ex.: 1963-09-25)\n' +
  '  "mother_name": string|null,     // nome da mãe (filiação no RG/CNH)\n' +
  '  "address_cep": string|null,\n' +
  '  "address_street": string|null,\n' +
  '  "address_number": string|null,\n' +
  '  "address_complement": string|null,\n' +
  '  "address_neighborhood": string|null,\n' +
  '  "address_city": string|null,\n' +
  '  "address_state": string|null    // UF, 2 letras\n' +
  '}';
// Preço Anthropic por 1M tokens (mesma tabela das petições) — só p/ registrar custo.
// Casado por prefixo do model id; ao adotar uma família nova (ex.: claude-vega),
// adicione o prefixo aqui senão o custo cai no fallback (pode subestimar).
const DOC_ANTHROPIC_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus':   { input: 15.0, output: 75.0 },
  'claude-sonnet': { input: 3.0,  output: 15.0 },
  'claude-haiku':  { input: 0.8,  output: 4.0  },
};

@Injectable()
export class ProcuracaoService {
  private readonly logger = new Logger(ProcuracaoService.name);
  constructor(
    private prisma: PrismaService,
    private s3: MediaS3Service,
    private fileStorage: FileStorageService,
    private settings: SettingsService,
    private whatsapp: WhatsappService,
    private chatGateway: ChatGateway,
  ) {}

  // ── Config por escritório (timbrado + texto modelo) ──────────────────────
  async getConfig(tenantId: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { procuracao_template: true, procuracao_letterhead_key: true, procuracao_margins: true, procuracao_style: true },
    });
    return {
      template: t?.procuracao_template ?? '',
      hasLetterhead: !!t?.procuracao_letterhead_key,
      margins: resolveMargins(t?.procuracao_margins as any),
      style: resolveStyle(t?.procuracao_style as any),
    };
  }

  async saveConfig(tenantId: string, input: { template?: string; margins?: ProcMargins; style?: { font?: string; size?: number; lineSpacing?: number; justify?: boolean; autoFit?: boolean; upperName?: boolean } }) {
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(input.template !== undefined ? { procuracao_template: input.template } : {}),
        ...(input.margins ? { procuracao_margins: input.margins as any } : {}),
        ...(input.style ? { procuracao_style: resolveStyle(input.style) as any } : {}),
      },
    });
    return { ok: true };
  }

  async uploadLetterhead(tenantId: string, buffer: Buffer, mime: string) {
    const isPdf = mime === 'application/pdf';
    // Só PNG/JPEG: o pdf-lib só embute esses dois (embedPng/embedJpg). Aceitar
    // webp/heic/etc. deixaria o upload "ok" mas quebraria TODA geração depois.
    const isImg = mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/jpg';
    if (!isPdf && !isImg) throw new BadRequestException('O timbrado deve ser PDF ou imagem PNG/JPG.');
    const ext = isPdf ? 'pdf' : mime.includes('png') ? 'png' : 'jpg';
    const key = `procuracao/letterhead/${tenantId}.${ext}`;
    await this.s3.uploadBuffer(key, buffer, mime);
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { procuracao_letterhead_key: key } });
    return { ok: true, key };
  }

  // ── Variáveis ({{campos}}) a partir do contato ───────────────────────────
  private async buildVars(leadId: string, tenantId: string) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, tenant_id: tenantId } });
    if (!lead) throw new NotFoundException('Contato não encontrado');
    // Endereço normalizado (comprovante costuma vir em CAIXA ALTA → capitaliza).
    const logradouro = titulo(lead.address_street);
    const bairro = titulo(lead.address_neighborhood);
    const cidade = titulo(lead.address_city);
    const complemento = titulo(lead.address_complement);
    const uf = (lead.address_state || '').toUpperCase();
    const enderecoCompleto = [
      [logradouro, lead.address_number].filter(Boolean).join(', '),
      complemento,
      bairro,
      [cidade, uf].filter(Boolean).join('/'),
      lead.address_cep ? `CEP ${fmtCep(lead.address_cep)}` : '',
    ].filter(Boolean).join(', ');
    const now = new Date();
    const nasc = fmtNascimento((lead as any).birth_date);
    const vars: Record<string, string> = {
      nome_completo: lead.full_name || '', // só o nome completo (civil), nunca o apelido/WhatsApp
      cpf: fmtCpfCnpj(lead.cpf_cnpj),
      rg: lead.rg || '',
      orgao_emissor: lead.rg_issuer || '',
      rg_completo: [lead.rg, lead.rg_issuer].filter(Boolean).join(' '),
      nacionalidade: lead.nationality || '',
      estado_civil: lead.marital_status || '',
      profissao: lead.profession || '',
      data_nascimento: nasc.curto,
      nascimento_extenso: nasc.extenso,
      nome_mae: titulo((lead as any).mother_name),
      endereco_completo: enderecoCompleto,
      logradouro,
      numero: lead.address_number || '',
      complemento,
      bairro,
      cidade,
      uf,
      cep: fmtCep(lead.address_cep),
      email: lead.email || '',
      telefone: lead.phone || '',
      data: now.toLocaleDateString('pt-BR'),
      data_extenso: `${now.getDate()} de ${MESES[now.getMonth()]} de ${now.getFullYear()}`,
    };
    return { lead, vars };
  }

  // Substitui {{campo}} pelos dados; campo conhecido e vazio vira "____" + entra
  // em camposFaltando; campo desconhecido fica intacto (pra o usuário ver o typo).
  private fill(template: string, vars: Record<string, string>): { text: string; faltando: string[] } {
    const faltando = new Set<string>();
    const text = (template || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key: string) => {
      const k = key.toLowerCase();
      if (!(k in vars)) return m;
      const val = vars[k];
      if (!val) { faltando.add(k); return '____________'; }
      return val;
    });
    return { text, faltando: [...faltando] };
  }

  async getPreview(leadId: string, tenantId: string) {
    const cfg = await this.getConfig(tenantId);
    const { vars } = await this.buildVars(leadId, tenantId);
    const { text, faltando } = this.fill(cfg.template, vars);
    // Nome completo é obrigatório p/ gerar (mesmo que o template não use a
    // variável) — então sempre reportar como faltando se estiver vazio.
    if (!vars.nome_completo.trim() && !faltando.includes('nome_completo')) faltando.push('nome_completo');
    return { text, camposFaltando: faltando, hasLetterhead: cfg.hasLetterhead, configurado: !!cfg.template };
  }

  // ── Render: timbrado de fundo + texto preenchido por cima ─────────────────
  private async renderToPdf(o: { text: string; margins: ProcMargins; style: ProcStyle; letterheadKey: string | null }): Promise<Buffer> {
    let pdf: PDFDocument;
    let page: PDFPage;
    const key = o.letterheadKey;
    if (key) {
      const { stream, contentType } = await this.s3.getObjectStream(key);
      const bytes = await streamToBuffer(stream);
      if (key.endsWith('.pdf') || contentType === 'application/pdf') {
        const src = await PDFDocument.load(bytes);
        pdf = await PDFDocument.create();
        const [p] = await pdf.copyPages(src, [0]);
        pdf.addPage(p);
        page = pdf.getPage(0);
      } else {
        pdf = await PDFDocument.create();
        page = pdf.addPage(A4);
        const img = key.endsWith('.png') || contentType.includes('png')
          ? await pdf.embedPng(bytes)
          : await pdf.embedJpg(bytes);
        page.drawImage(img, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
      }
    } else {
      pdf = await PDFDocument.create();
      page = pdf.addPage(A4);
    }

    const regular = await pdf.embedFont(FONT_REGULAR[o.style.font]);
    const bold = await pdf.embedFont(FONT_BOLD[o.style.font]);
    const { width, height } = page.getSize();
    const maxWidth = width - o.margins.left - o.margins.right;
    const usableHeight = Math.max(0, height - o.margins.top - o.margins.bottom);
    // Usa o tamanho configurado; se autoFit, reduz (até 8pt) p/ caber em 1
    // página — pdf-lib não pagina, então evita perder a parte de baixo sem aviso.
    let size = o.style.size;
    let L = layoutText(o.text, regular, bold, size, maxWidth, o.style.lineSpacing, o.style.justify);
    while (o.style.autoFit && L.height > usableHeight && size > 8) {
      size -= 0.5;
      L = layoutText(o.text, regular, bold, size, maxWidth, o.style.lineSpacing, o.style.justify);
    }
    drawLayout(page, L, regular, bold, size, rgb(0.1, 0.1, 0.12), o.margins.left, height - o.margins.top, maxWidth);
    return Buffer.from(await pdf.save());
  }

  // Procuração real preenchida com os dados do contato (botão do popup).
  async generatePdf(leadId: string, tenantId: string): Promise<{ buffer: Buffer; nome: string }> {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { procuracao_template: true, procuracao_letterhead_key: true, procuracao_margins: true, procuracao_style: true },
    });
    if (!t?.procuracao_template) {
      throw new BadRequestException('Configure o texto da procuração em Configurações → Procuração.');
    }
    const { vars } = await this.buildVars(leadId, tenantId);
    // Nome completo é obrigatório p/ gerar a procuração (não usar apelido/WhatsApp).
    if (!vars.nome_completo.trim()) {
      throw new BadRequestException('Preencha o NOME COMPLETO do cliente (na ficha do contato) antes de gerar a procuração.');
    }
    const style = resolveStyle(t.procuracao_style as any);
    // Nome do arquivo a partir do nome ORIGINAL (sem caixa-alta), sem acento.
    const primeiro = (vars.nome_completo || 'cliente').split(' ')[0]
      .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, '') || 'cliente';
    if (style.upperName && vars.nome_completo) vars.nome_completo = vars.nome_completo.toUpperCase();
    const { text } = this.fill(t.procuracao_template, vars);
    const buffer = await this.renderToPdf({
      text,
      margins: resolveMargins(t.procuracao_margins as any),
      style,
      letterheadKey: t.procuracao_letterhead_key ?? null,
    });
    return { buffer, nome: `Procuracao_${primeiro}.pdf` };
  }

  // Modelo de exemplo (botão "Baixar modelo" da config): usa o texto/estilo/
  // margens da edição atual (ou os salvos) + dados FICTÍCIOS, pra ver o layout.
  async generateSample(tenantId: string, input: { template?: string; margins?: ProcMargins; style?: any }): Promise<Buffer> {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { procuracao_template: true, procuracao_letterhead_key: true, procuracao_margins: true, procuracao_style: true },
    });
    const template = (input.template !== undefined ? input.template : t?.procuracao_template) || '';
    if (!template.trim()) throw new BadRequestException('Escreva o texto da procuração antes de baixar o modelo.');
    const now = new Date();
    const vars: Record<string, string> = {
      nome_completo: 'Fulano de Tal da Silva', cpf: '123.456.789-09',
      rg: '1.234.567', orgao_emissor: 'SSP/AL', rg_completo: '1.234.567 SSP/AL',
      nacionalidade: 'brasileiro(a)', estado_civil: 'casado(a)', profissao: 'comerciante',
      data_nascimento: '25/09/1963', nascimento_extenso: '25 de setembro de 1963',
      nome_mae: 'Maria de Tal da Silva',
      endereco_completo: 'Rua Exemplo, nº 123, Centro, Arapiraca/AL, CEP 57300-000',
      logradouro: 'Rua Exemplo', numero: '123', complemento: 'Sala 4', bairro: 'Centro',
      cidade: 'Arapiraca', uf: 'AL', cep: '57300-000',
      email: 'exemplo@email.com', telefone: '(82) 99999-9999',
      data: now.toLocaleDateString('pt-BR'),
      data_extenso: `${now.getDate()} de ${MESES[now.getMonth()]} de ${now.getFullYear()}`,
    };
    const style = input.style ? resolveStyle(input.style) : resolveStyle(t?.procuracao_style as any);
    if (style.upperName) vars.nome_completo = vars.nome_completo.toUpperCase();
    const { text } = this.fill(template, vars);
    return this.renderToPdf({
      text,
      margins: input.margins ? resolveMargins(input.margins) : resolveMargins(t?.procuracao_margins as any),
      style,
      letterheadKey: t?.procuracao_letterhead_key ?? null,
    });
  }

  // Gera a procuração e ENVIA o PDF pro cliente no WhatsApp da conversa
  // (mesmo padrão do contrato: Message + S3 + Evolution base64 + socket).
  async sendViaWhatsapp(conversationId: string, tenantId: string): Promise<{ messageId: string }> {
    const convo = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenant_id: tenantId },
      include: { lead: true },
    });
    if (!convo?.lead) throw new BadRequestException('Conversa inválida.');
    const { buffer, nome } = await this.generatePdf(convo.lead.id, tenantId); // valida nome completo
    const fileName = nome.endsWith('.pdf') ? nome : `${nome}.pdf`;
    const caption = '📄 Procuração';

    // 1. Mensagem (aparece no chat)
    const tempExtId = `out_procuracao_${conversationId}`;
    const msg = await this.prisma.message.create({
      data: {
        conversation_id: convo.id,
        direction: 'out',
        type: 'document',
        text: caption,
        external_message_id: tempExtId,
        status: 'enviando',
      },
    });

    // 2. S3 + 3. Media
    const s3Key = `procuracao/sent/${msg.id}.pdf`;
    await this.s3.uploadBuffer(s3Key, buffer, 'application/pdf');
    await this.prisma.media.create({
      data: { message_id: msg.id, s3_key: s3Key, mime_type: 'application/pdf', size: buffer.length, original_name: fileName },
    });

    // 4. Enviar via WhatsApp (base64 puro, como o contrato)
    let sendStatus = 'enviado';
    let externalId = tempExtId;
    try {
      const result: any = await this.whatsapp.sendMedia(
        convo.lead.phone, 'document', buffer.toString('base64'), caption, convo.instance_name || undefined, fileName,
      );
      if (result?.statusCode >= 400 || result?.error) { this.logger.error(`Evolution erro procuração: ${JSON.stringify(result)}`); sendStatus = 'erro'; }
      else externalId = result?.key?.id || tempExtId;
    } catch (e: any) {
      this.logger.error(`Exceção ao enviar procuração: ${e.message}`);
      sendStatus = 'erro';
    }

    // 5. Atualizar mensagem + conversa + socket
    await this.prisma.message.update({ where: { id: msg.id }, data: { external_message_id: externalId, status: sendStatus } });
    await this.prisma.conversation.update({ where: { id: convo.id }, data: { last_message_at: new Date() } });
    this.chatGateway.emitNewMessage(convo.id, { ...msg, status: sendStatus, external_message_id: externalId });
    this.chatGateway.emitConversationsUpdate((convo as any).tenant_id ?? null);

    if (sendStatus === 'erro') throw new BadRequestException('Falha ao enviar a procuração pelo WhatsApp.');
    return { messageId: msg.id };
  }

  // ── Preenchimento automático da qualificação a partir do documento ─────────
  // Lê os bytes de uma mídia: novas ficam no filesystem (file_path); antigas no
  // S3 (s3_key). Mesma prioridade do MediaController.
  private async readMediaBytes(media: { file_path: string | null; s3_key: string | null }): Promise<Buffer | null> {
    try {
      if (media.file_path && (await this.fileStorage.exists(media.file_path))) {
        return await this.fileStorage.read(media.file_path);
      }
    } catch { /* cai pro S3 */ }
    if (media.s3_key) {
      try {
        const { stream } = await this.s3.getObjectStream(media.s3_key);
        return await streamToBuffer(stream);
      } catch { return null; }
    }
    return null;
  }

  private async saveDocUsage(model: string, usage: any, conversationId: string | null, userId: string, tenantId: string): Promise<void> {
    if (!usage) return;
    // OpenAI usa prompt_tokens/completion_tokens; Anthropic usa input_tokens/output_tokens.
    const promptTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
    const completionTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
    const totalTokens = usage.total_tokens ?? (promptTokens + completionTokens);
    const isClaude = model.startsWith('claude');
    const table = isClaude ? DOC_ANTHROPIC_PRICING : DOC_OPENAI_PRICING;
    const priceEntry = Object.entries(table).find(([k]) => model.startsWith(k));
    if (!priceEntry) this.logger.warn(`[PROC-IA] Modelo ${model} sem preço na tabela — usando fallback (custo pode subestimar). Adicione o prefixo em DOC_*_PRICING.`);
    const price = priceEntry ? priceEntry[1] : (isClaude ? { input: 3.0, output: 15.0 } : { input: 5.0, output: 15.0 });
    const costUsd =
      (promptTokens * price.input) / 1_000_000 +
      (completionTokens * price.output) / 1_000_000;
    try {
      await this.prisma.aiUsage.create({
        data: {
          conversation_id: conversationId,
          skill_id: null,
          model,
          call_type: 'qualificacao',
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
          cost_usd: costUsd,
          user_id: userId,
          tenant_id: tenantId,
          meta_json: { feature: 'procuracao-doc-extraction' } as any,
        } as any,
      });
    } catch (e: any) {
      this.logger.warn(`[PROC-IA] Falha ao registrar uso: ${e.message}`);
    }
  }

  /**
   * Lê o documento que o cliente mandou na conversa (foto de RG/CNH via OpenAI,
   * ou PDF via Claude/Anthropic) e GRAVA os campos VAZIOS da qualificação do
   * contato — nunca sobrescreve o que já foi preenchido manualmente. Só reanalisa
   * mídia que chegou DEPOIS da última tentativa (marcador `qualificacao_ia_em`)
   * pra não gastar IA à toa. Sem documento/sem chave do provedor → não chama a IA
   * (sem custo) e tenta de novo quando chegar.
   */
  async autoPreencherDocumento(
    conversationId: string,
    userId: string,
    tenantId: string,
    force = false,
  ): Promise<{ preenchidos: string[]; jaTentou?: boolean; semDocumento?: boolean; outroDono?: string }> {
    if (!userId) throw new BadRequestException('userId obrigatório');
    const convo = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenant_id: tenantId },
      include: { lead: true },
    });
    if (!convo?.lead) throw new BadRequestException('Conversa inválida.');
    const lead = convo.lead;

    // Marcador da última tentativa. Se já tentou antes, só olha mídia que chegou
    // DEPOIS — assim pega documento enviado mais tarde, sem reanalisar tudo nem
    // regastar IA quando não chegou nada novo.
    const marker: Date | null = (lead as any).qualificacao_ia_em ?? null;
    // force (botão "Reler com IA") ignora o marcador e relê o documento mais recente.
    const sinceMarker = (marker && !force) ? { created_at: { gt: marker } } : {};
    // Imagens (lidas pela OpenAI) e PDFs (lidos pela Claude/Anthropic) — consultas
    // SEPARADAS, cada provedor com a mídia que sabe ler.
    const [imgs, pdfs] = await Promise.all([
      this.prisma.message.findMany({
        where: { conversation_id: convo.id, type: 'image', ...sinceMarker },
        include: { media: true }, orderBy: { created_at: 'desc' }, take: DOC_MAX_IMAGES,
      }),
      this.prisma.message.findMany({
        where: { conversation_id: convo.id, type: 'document', media: { mime_type: 'application/pdf' }, ...sinceMarker },
        include: { media: true }, orderBy: { created_at: 'desc' }, take: DOC_MAX_PDFS,
      }),
    ]);
    const comImg = imgs.filter((m) => m.media && (m.media.file_path || m.media.s3_key));
    const comPdf = pdfs.filter((m) => m.media && (m.media.file_path || m.media.s3_key));
    if (!comImg.length && !comPdf.length) return { preenchidos: [], jaTentou: !!marker, semDocumento: !marker }; // sem custo

    // Chaves dos provedores. OpenAI e Claude leem imagem; só Claude lê PDF.
    const aiConfig = await this.settings.getAiConfig();
    const openaiKey = aiConfig.apiKey || '';
    const anthropicKey = (await this.settings.get('ANTHROPIC_API_KEY')) || process.env.ANTHROPIC_API_KEY || '';

    // Modelo das FOTOS define o provedor: se for Claude, a imagem vai pra Anthropic.
    const docModel = (await this.settings.get('AI_DOC_MODEL')) || 'gpt-4o-mini';
    const imgUsaClaude = docModel.startsWith('claude');
    const imgKey = imgUsaClaude ? anthropicKey : openaiKey;

    // Bytes das imagens (o formato do bloco é montado por provedor na hora da chamada).
    const imgData: { mime: string; b64: string }[] = [];
    if (comImg.length && imgKey) {
      for (const m of comImg) {
        const media = m.media!;
        if (media.size && media.size > DOC_MAX_IMAGE_BYTES) continue;
        const buf = await this.readMediaBytes(media);
        if (!buf) { this.logger.warn(`[PROC-IA] Imagem ${media.id} inacessível (sem bytes) conv=${conversationId}`); continue; }
        if (buf.length > DOC_MAX_IMAGE_BYTES) continue;
        imgData.push({ mime: (media.mime_type || 'image/jpeg').split(';')[0].trim(), b64: buf.toString('base64') });
      }
    } else if (comImg.length && !imgKey) {
      this.logger.warn(`[PROC-IA] Imagem na conversa ${conversationId} mas a chave do provedor (${imgUsaClaude ? 'Anthropic' : 'OpenAI'}) está ausente — imagem ignorada.`);
    }
    // Blocos de PDF (sempre Anthropic — só Claude lê PDF nativamente).
    const pdfBlocks: any[] = [];
    if (comPdf.length && anthropicKey) {
      for (const m of comPdf) {
        const media = m.media!;
        if (media.size && media.size > DOC_MAX_PDF_BYTES) continue;
        const buf = await this.readMediaBytes(media);
        if (!buf || buf.length > DOC_MAX_PDF_BYTES) continue;
        pdfBlocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } });
      }
    } else if (comPdf.length && !anthropicKey) {
      this.logger.warn(`[PROC-IA] PDF na conversa ${conversationId} mas ANTHROPIC_API_KEY ausente — PDF ignorado.`);
    }
    if (!imgData.length && !pdfBlocks.length) return { preenchidos: [], semDocumento: true }; // nada legível/sem chave

    // Cost cap por user/tenant antes de qualquer chamada (anti-DoS financeiro).
    await assertAiCostCap(this.prisma, userId, tenantId);

    // Marca a tentativa ANTES das chamadas: mesmo que a IA falhe, não reprocessa
    // a mesma mídia (evita loop de custo se o documento for ilegível/IA der erro).
    await this.prisma.lead.update({ where: { id: lead.id }, data: { qualificacao_ia_em: new Date() } as any });

    // Prompt COMPLETO (instruções + lista de campos), configurável pelo admin master.
    const fullPrompt = (await this.settings.get('AI_DOC_PROMPT'))?.trim() || DEFAULT_DOC_PROMPT;
    // Cross-check: nome conhecido do contato p/ a IA confirmar que o documento é
    // dessa pessoa (campo confere_cliente no JSON).
    const nomeConhecido = (((lead as any).full_name || lead.name || '') as string).trim();
    // Acesso ao HISTÓRICO de texto da conversa — o cliente pode ter digitado
    // nome/CPF/endereço. A IA usa isso junto com os documentos.
    const txts = await this.prisma.message.findMany({
      where: { conversation_id: convo.id, type: 'text', text: { not: null } },
      orderBy: { created_at: 'desc' }, take: DOC_MAX_HIST_MSGS,
    });
    const historico = txts.reverse()
      .filter((m) => (m.text || '').trim())
      .map((m) => `${m.direction === 'in' ? 'Cliente' : 'Atendente'}: ${(m.text || '').replace(/\s+/g, ' ').trim()}`)
      .join('\n').slice(-DOC_MAX_HIST_CHARS);
    const userText = [
      nomeConhecido ? `O contato desta conversa é conhecido como: "${nomeConhecido}". Confirme se o documento pertence a essa pessoa (campo "confere_cliente").` : '',
      historico ? `Considere também o que o cliente informou por texto na conversa:\n${historico}` : '',
      'Documento(s) em anexo para leitura.',
    ].filter(Boolean).join('\n\n');
    const extrairJson = (raw: string): any => {
      try { return JSON.parse((raw.match(/\{[\s\S]*\}/) || [raw])[0]); } catch { return null; }
    };

    // Resultados em ordem de prioridade: PDF primeiro (RG/CNH em PDF costuma ser
    // mais legível), depois imagem. O merge adiante preenche só campo vazio.
    const parsedResults: any[] = [];

    // 1) PDFs via Anthropic (Claude lê PDF nativamente, inclusive escaneado).
    if (pdfBlocks.length) {
      const amodel = (await this.settings.get('AI_DOC_ANTHROPIC_MODEL')) || 'claude-sonnet-4-6';
      try {
        const anthropic = new Anthropic({ apiKey: anthropicKey, timeout: DOC_AI_TIMEOUT_MS, maxRetries: 1 });
        const resp = await anthropic.messages.create({
          model: amodel,
          max_tokens: DOC_MAX_TOKENS,
          system: fullPrompt,
          messages: [{ role: 'user', content: [{ type: 'text', text: userText }, ...pdfBlocks] as any }],
        });
        await this.saveDocUsage(amodel, resp.usage, convo.id, userId, tenantId);
        const p = extrairJson((resp.content?.[0] as any)?.text || '');
        if (p) parsedResults.push(p); // aceita comprovante tb (is_documento=false mas tem endereço)
      } catch (e: any) {
        this.logger.warn(`[PROC-IA] Falha ao ler PDF conv=${conversationId}: ${e.message}`);
      }
    }

    // 2) Imagens — OpenAI (image_url) ou Claude (image block), conforme o modelo escolhido.
    if (imgData.length) {
      try {
        if (imgUsaClaude) {
          const anthropic = new Anthropic({ apiKey: anthropicKey, timeout: DOC_AI_TIMEOUT_MS, maxRetries: 1 });
          const blocks = imgData.map((d) => ({ type: 'image', source: { type: 'base64', media_type: d.mime, data: d.b64 } }));
          const resp = await anthropic.messages.create({
            model: docModel,
            max_tokens: DOC_MAX_TOKENS,
            system: fullPrompt,
            messages: [{ role: 'user', content: [{ type: 'text', text: userText }, ...blocks] as any }],
          });
          await this.saveDocUsage(docModel, resp.usage, convo.id, userId, tenantId);
          const p = extrairJson((resp.content?.[0] as any)?.text || '');
          if (p) parsedResults.push(p); // aceita comprovante tb (is_documento=false mas tem endereço)
        } else {
          const ai = new OpenAI({ apiKey: openaiKey, timeout: DOC_AI_TIMEOUT_MS, maxRetries: 1 });
          const blocks = imgData.map((d) => ({ type: 'image_url', image_url: { url: `data:${d.mime};base64,${d.b64}` } }));
          const resp = await ai.chat.completions.create({
            model: docModel,
            messages: [
              { role: 'system', content: fullPrompt },
              { role: 'user', content: [{ type: 'text', text: userText }, ...blocks] as any },
            ],
            ...buildTokenParam(docModel, DOC_MAX_TOKENS),
            temperature: 0.1,
          });
          await this.saveDocUsage(docModel, resp.usage, convo.id, userId, tenantId);
          const p = extrairJson(resp.choices[0]?.message?.content || '');
          if (p) parsedResults.push(p); // aceita comprovante tb (is_documento=false mas tem endereço)
        }
      } catch (e: any) {
        this.logger.warn(`[PROC-IA] Falha ao ler imagem conv=${conversationId}: ${e.message}`);
      }
    }

    if (!parsedResults.length) return { preenchidos: [] };

    // Cross-check: se a IA marcou que o documento é de OUTRA pessoa, NÃO preenche —
    // só avisa (não polui a ficha com dados de terceiro).
    const mismatch = parsedResults.find((p) => p && p.confere_cliente === false);
    if (mismatch) {
      const nomeDoc = (typeof mismatch.nome_no_documento === 'string' && mismatch.nome_no_documento.trim()) ? mismatch.nome_no_documento.trim() : '';
      this.logger.warn(`[PROC-IA] Documento parece de outra pessoa conv=${conversationId} nome_doc="${nomeDoc}"`);
      return { preenchidos: [], outroDono: nomeDoc || 'outra pessoa' };
    }

    // Merge: preenche só campo vazio do contato; fontes em ordem (PDF antes da
    // imagem) — a primeira que trouxer valor vence. Nunca sobrescreve o manual.
    const val = (v: any) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const labels: Record<string, string> = {
      full_name: 'Nome completo', nationality: 'Nacionalidade', marital_status: 'Estado civil',
      profession: 'Profissão', birth_date: 'Data de nascimento', mother_name: 'Nome da mãe', rg: 'RG', rg_issuer: 'Órgão emissor', address_cep: 'CEP',
      address_street: 'Logradouro', address_number: 'Número', address_complement: 'Complemento',
      address_neighborhood: 'Bairro', address_city: 'Cidade', address_state: 'UF',
    };
    const data: any = {};
    const preenchidos: string[] = [];
    for (const parsed of parsedResults) {
      for (const [field, label] of Object.entries(labels)) {
        if (data[field]) continue; // já veio de fonte anterior (PDF tem prioridade)
        const v = val(parsed[field]);
        if (v && !(lead as any)[field]) { data[field] = v; preenchidos.push(label); }
      }
      // CPF é campo separado (cpf_cnpj) — guarda só os dígitos.
      const cpf = typeof parsed.cpf === 'string' ? parsed.cpf.replace(/\D/g, '') : '';
      if (cpf.length >= 11 && !lead.cpf_cnpj && !data.cpf_cnpj) { data.cpf_cnpj = cpf; preenchidos.push('CPF'); }
    }

    if (Object.keys(data).length) {
      await this.prisma.lead.update({ where: { id: lead.id }, data });
      this.chatGateway.emitConversationsUpdate(tenantId);
      this.logger.log(`[PROC-IA] Qualificação preenchida conv=${conversationId} campos=${preenchidos.join(',')}`);
    }
    return { preenchidos };
  }

  // ── Config da IA da procuração (admin master) ─────────────────────────────
  // Só modelo + prompt. As CHAVES de IA são infra global (geridas em outro lugar),
  // então não ficam aqui.
  async getAiConfig() {
    return {
      docModel: (await this.settings.get('AI_DOC_MODEL')) || 'gpt-4o-mini',
      docAnthropicModel: (await this.settings.get('AI_DOC_ANTHROPIC_MODEL')) || 'claude-sonnet-4-6',
      prompt: (await this.settings.get('AI_DOC_PROMPT'))?.trim() || DEFAULT_DOC_PROMPT,
    };
  }

  async saveAiConfig(input: { docModel?: string; docAnthropicModel?: string; prompt?: string }) {
    if (input.docModel !== undefined) await this.settings.set('AI_DOC_MODEL', input.docModel.trim() || 'gpt-4o-mini');
    if (input.docAnthropicModel !== undefined) await this.settings.set('AI_DOC_ANTHROPIC_MODEL', input.docAnthropicModel.trim() || 'claude-sonnet-4-6');
    // Vazio = volta pro padrão (getAiConfig faz o fallback).
    if (input.prompt !== undefined) await this.settings.set('AI_DOC_PROMPT', input.prompt.trim());
    return this.getAiConfig();
  }
}
