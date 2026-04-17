/**
 * Gera e faz download de um PDF do dashboard.
 * Usa lazy-load de jspdf + html2canvas para não impactar o bundle inicial.
 */

export interface ExportPdfOptions {
  /** IDs dos elementos a capturar, na ordem. */
  sectionIds: string[];
  /** Label do período (ex: "Últimos 30 dias"). */
  periodLabel?: string;
  /** Nome do escritório/usuário para cabeçalho. */
  userName?: string;
  /** Nome do arquivo (sem extensão). Default: dashboard-YYYY-MM-DD */
  filename?: string;
}

function todayIso() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function exportDashboardPdf(opts: ExportPdfOptions): Promise<void> {
  // Lazy-load: só baixa quando o usuário clica
  const [{ default: jsPDF }, html2canvasMod] = await Promise.all([
    import('jspdf'),
    import('html2canvas'),
  ]);
  const html2canvas = html2canvasMod.default;

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 10;
  const contentWidth = pageWidth - margin * 2;

  // ── Cabeçalho ──
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.text('Relatório Dashboard', margin, margin + 6);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  const headerLines: string[] = [];
  if (opts.periodLabel) headerLines.push(`Período: ${opts.periodLabel}`);
  if (opts.userName) headerLines.push(`Gerado por: ${opts.userName}`);
  headerLines.push(`Data: ${new Date().toLocaleString('pt-BR')}`);

  let cursorY = margin + 12;
  for (const line of headerLines) {
    pdf.text(line, margin, cursorY);
    cursorY += 4;
  }
  cursorY += 4;

  // ── Cada seção vira uma imagem ──
  const scale = 2; // Maior fidelidade
  const backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--background').trim() || '#ffffff';

  for (const id of opts.sectionIds) {
    const el = document.getElementById(id);
    if (!el) continue;

    // Renderiza o elemento para canvas. Ignora iframes/canvas não-capturáveis.
    const canvas = await html2canvas(el, {
      scale,
      backgroundColor: backgroundColor.startsWith('#') ? backgroundColor : '#ffffff',
      useCORS: true,
      logging: false,
    });

    const imgData = canvas.toDataURL('image/png');
    const imgWidth = contentWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    // Se não cabe no resto da página, adiciona nova página
    if (cursorY + imgHeight > pageHeight - margin) {
      pdf.addPage();
      cursorY = margin;
    }

    pdf.addImage(imgData, 'PNG', margin, cursorY, imgWidth, imgHeight, undefined, 'FAST');
    cursorY += imgHeight + 6;
  }

  const filename = `${opts.filename || `dashboard-${todayIso()}`}.pdf`;
  pdf.save(filename);
}
