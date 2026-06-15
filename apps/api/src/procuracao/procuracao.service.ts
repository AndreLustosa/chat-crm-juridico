import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediaS3Service } from '../media/s3.service';
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib';
import { Readable } from 'stream';

// Área do texto sobre o timbrado (em pt; origem do PDF é embaixo-à-esquerda).
export interface ProcMargins { top: number; bottom: number; left: number; right: number }
const DEFAULT_MARGINS: ProcMargins = { top: 200, bottom: 110, left: 70, right: 70 };
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
// Conta as linhas após a quebra por palavra (mesma lógica do pdf-lib drawText
// com maxWidth) — usado p/ reduzir a fonte e o texto caber em 1 página, sem
// perder a linha de assinatura num texto longo (pdf-lib não pagina sozinho).
function countWrappedLines(text: string, font: PDFFont, size: number, maxWidth: number): number {
  let lines = 0;
  for (const para of (text || '').split('\n')) {
    if (para.length === 0) { lines += 1; continue; }
    let cur = '';
    for (const word of para.split(' ')) {
      const trial = cur ? `${cur} ${word}` : word;
      if (!cur || font.widthOfTextAtSize(trial, size) <= maxWidth) cur = trial;
      else { lines += 1; cur = word; }
    }
    lines += 1;
  }
  return lines;
}

@Injectable()
export class ProcuracaoService {
  private readonly logger = new Logger(ProcuracaoService.name);
  constructor(private prisma: PrismaService, private s3: MediaS3Service) {}

  // ── Config por escritório (timbrado + texto modelo) ──────────────────────
  async getConfig(tenantId: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { procuracao_template: true, procuracao_letterhead_key: true, procuracao_margins: true },
    });
    return {
      template: t?.procuracao_template ?? '',
      hasLetterhead: !!t?.procuracao_letterhead_key,
      margins: ((t?.procuracao_margins as any) ?? DEFAULT_MARGINS) as ProcMargins,
    };
  }

  async saveConfig(tenantId: string, input: { template?: string; margins?: ProcMargins }) {
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(input.template !== undefined ? { procuracao_template: input.template } : {}),
        ...(input.margins ? { procuracao_margins: input.margins as any } : {}),
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

  // ── Geração do PDF: timbrado de fundo + texto preenchido por cima ─────────
  async generatePdf(leadId: string, tenantId: string): Promise<{ buffer: Buffer; nome: string }> {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { procuracao_template: true, procuracao_letterhead_key: true, procuracao_margins: true },
    });
    if (!t?.procuracao_template) {
      throw new BadRequestException('Configure o texto da procuração em Configurações → Procuração.');
    }
    const { vars } = await this.buildVars(leadId, tenantId);
    const { text } = this.fill(t.procuracao_template, vars);
    const margins = ((t.procuracao_margins as any) ?? DEFAULT_MARGINS) as ProcMargins;

    let pdf: PDFDocument;
    let page: PDFPage;
    const key = t.procuracao_letterhead_key;
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

    const font = await pdf.embedFont(StandardFonts.TimesRoman);
    const { width, height } = page.getSize();
    const maxWidth = width - margins.left - margins.right;
    const usableHeight = Math.max(0, height - margins.top - margins.bottom);
    // Reduz a fonte de 12→8pt até o texto caber na altura útil (a procuração é
    // de 1 página); evita que um texto longo perca a parte de baixo sem aviso.
    let size = 12;
    for (let s = 12; s >= 8; s -= 0.5) {
      size = s;
      if (countWrappedLines(text, font, s, maxWidth) * s * 1.5 <= usableHeight) break;
    }
    page.drawText(text, {
      x: margins.left,
      y: height - margins.top,
      size,
      font,
      color: rgb(0.1, 0.1, 0.12),
      lineHeight: size * 1.5,
      maxWidth,
    });

    const buffer = Buffer.from(await pdf.save());
    const primeiro = (vars.nome_completo || 'cliente').split(' ')[0].replace(/[^\p{L}\p{N}]/gu, '') || 'cliente';
    return { buffer, nome: `Procuracao_${primeiro}.pdf` };
  }
}
