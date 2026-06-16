import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediaS3Service } from '../media/s3.service';
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

@Injectable()
export class ProcuracaoService {
  private readonly logger = new Logger(ProcuracaoService.name);
  constructor(private prisma: PrismaService, private s3: MediaS3Service) {}

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
    const enderecoCompleto = [
      [lead.address_street, lead.address_number].filter(Boolean).join(', '),
      lead.address_complement,
      lead.address_neighborhood,
      [lead.address_city, lead.address_state].filter(Boolean).join('/'),
      lead.address_cep ? `CEP ${fmtCep(lead.address_cep)}` : '',
    ].filter(Boolean).join(', ');
    const now = new Date();
    const vars: Record<string, string> = {
      nome_completo: lead.full_name || lead.name || '',
      cpf: fmtCpfCnpj(lead.cpf_cnpj),
      rg: lead.rg || '',
      orgao_emissor: lead.rg_issuer || '',
      rg_completo: [lead.rg, lead.rg_issuer].filter(Boolean).join(' '),
      nacionalidade: lead.nationality || '',
      estado_civil: lead.marital_status || '',
      profissao: lead.profession || '',
      endereco_completo: enderecoCompleto,
      logradouro: lead.address_street || '',
      numero: lead.address_number || '',
      complemento: lead.address_complement || '',
      bairro: lead.address_neighborhood || '',
      cidade: lead.address_city || '',
      uf: lead.address_state || '',
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
}
