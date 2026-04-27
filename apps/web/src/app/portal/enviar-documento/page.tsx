'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2, AlertCircle, CheckCircle2, UploadCloud, FileText,
  X, Folder, Camera, FolderOpen, ScanLine, Plus, Trash2,
  Sparkles, RefreshCcw,
} from 'lucide-react';
import { PortalHeader } from '../components/PortalHeader';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005';

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIMES = new Set([
  'application/pdf',
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
]);
const ALLOWED_EXT = new Set([
  'pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'heif',
  'doc', 'docx', 'xls', 'xlsx', 'txt',
]);

type CaseOption = {
  id: string;
  case_number: string | null;
  action_type: string;
  label: string;
};

// Pagina escaneada — guardada como dataUrl JPEG pra rapidez. Tamanho final
// no PDF eh comprimido pra ~85% qualidade pra arquivos legiveis sem inflar.
type ScannedPage = {
  id: string;
  dataUrl: string;        // imagem original (sem filtro)
  enhancedUrl: string;    // imagem com filtro doc aplicado
  bw: boolean;            // se o usuario habilitou o filtro
};

type Mode = 'choose' | 'scanner' | 'form';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getExt(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx === -1 ? '' : name.slice(idx + 1).toLowerCase();
}

/**
 * Aplica filtro tipo "documento" — grayscale + contraste alto + brilho suave.
 * Resultado parecido com CamScanner em modo B&W: texto legivel, fundo branco.
 *
 * Nao eh threshold puro pra preservar detalhes (carimbos, assinaturas a
 * caneta clara nao somem).
 */
function enhanceImageForDoc(srcUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // Limita lado maior a 1800px — fotos de iphone modernas chegam a 4032
      // e o jpeg final fica enorme sem ganho real de legibilidade.
      const MAX_SIDE = 1800;
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
      w = Math.round(w * scale);
      h = Math.round(h * scale);

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas indisponivel'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);

      const data = ctx.getImageData(0, 0, w, h);
      const px = data.data;
      // Loop pixel a pixel: grayscale + contraste 1.6x + brilho +15.
      // Numeros calibrados em fotos reais de RG/CPF tiradas de celular.
      for (let i = 0; i < px.length; i += 4) {
        const r = px[i], g = px[i + 1], b = px[i + 2];
        let gray = 0.299 * r + 0.587 * g + 0.114 * b;
        gray = (gray - 128) * 1.6 + 128;
        gray = gray + 15;
        if (gray < 0) gray = 0;
        if (gray > 255) gray = 255;
        px[i] = px[i + 1] = px[i + 2] = gray;
      }
      ctx.putImageData(data, 0, 0);

      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(new Error('Falha ao carregar imagem'));
    img.src = srcUrl;
  });
}

/**
 * Le um File como dataUrl pra exibir/processar no canvas.
 */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Le imagem e devolve dataUrl re-encodado em JPEG comprimido (sem filtro).
 * Necessario porque iphone manda HEIC que nao eh universalmente suportado e
 * fotos cruas sao gigantes — re-encodar normaliza tudo.
 */
function fileToJpegDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    fileToDataUrl(file).then(url => {
      const img = new Image();
      img.onload = () => {
        const MAX_SIDE = 1800;
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
        w = Math.round(w * scale);
        h = Math.round(h * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas indisponivel')); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error('Falha ao carregar imagem'));
      img.src = url;
    }).catch(reject);
  });
}

/**
 * Monta PDF A4 a partir das paginas escaneadas. Usa imagem com filtro se
 * `bw=true` na pagina, senao a original. Cada imagem fica centralizada e
 * com aspect ratio preservado.
 */
async function buildPdfFromPages(pages: ScannedPage[]): Promise<File> {
  // Lazy import pra nao puxar jspdf em paginas que nao usam scanner
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 16;
  const maxW = pageW - margin * 2;
  const maxH = pageH - margin * 2;

  for (let i = 0; i < pages.length; i++) {
    if (i > 0) pdf.addPage();
    const p = pages[i];
    const imgUrl = p.bw ? p.enhancedUrl : p.dataUrl;
    // Pega dimensoes reais da imagem pra calcular fit
    const dims = await new Promise<{ w: number; h: number }>(resolve => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 1, h: 1 });
      img.src = imgUrl;
    });
    const ratio = Math.min(maxW / dims.w, maxH / dims.h);
    const w = dims.w * ratio;
    const h = dims.h * ratio;
    const x = (pageW - w) / 2;
    const y = (pageH - h) / 2;
    pdf.addImage(imgUrl, 'JPEG', x, y, w, h, undefined, 'FAST');
  }

  const blob = pdf.output('blob');
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return new File([blob], `documento-scaneado-${ts}.pdf`, { type: 'application/pdf' });
}

export default function EnviarDocumentoPage() {
  const router = useRouter();

  const [cases, setCases] = useState<CaseOption[] | null>(null);
  const [casesError, setCasesError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>('choose');

  // Form state
  const [selectedCaseId, setSelectedCaseId] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  // Scanner state
  const [pages, setPages] = useState<ScannedPage[]>([]);
  const [scannerBusy, setScannerBusy] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [bwAll, setBwAll] = useState(true); // por default aplica filtro doc

  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const filePickerRef = useRef<HTMLInputElement | null>(null);
  const scannerInputRef = useRef<HTMLInputElement | null>(null);

  // Carrega processos do cliente
  useEffect(() => {
    fetch(`${API_BASE}/portal/documents/uploadable-cases`, { credentials: 'include' })
      .then(async r => {
        if (r.status === 401) { router.push('/portal'); return null; }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: CaseOption[] | null) => {
        if (!data) return;
        setCases(data);
        if (data.length === 1) setSelectedCaseId(data[0].id);
      })
      .catch(e => setCasesError(e.message || 'Falha ao carregar processos'));
  }, [router]);

  // Cria URL de preview pro arquivo selecionado (revoga ao trocar/sair)
  useEffect(() => {
    if (!file) {
      setFilePreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setFilePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function validateFile(f: File): string | null {
    if (f.size > MAX_BYTES) {
      return `Arquivo muito grande (${formatSize(f.size)}). Limite: 25MB.`;
    }
    const mimeOk = ALLOWED_MIMES.has(f.type);
    const extOk = ALLOWED_EXT.has(getExt(f.name));
    if (!mimeOk && !extOk) {
      return 'Tipo de arquivo não permitido. Aceitos: PDF, fotos (JPG/PNG/HEIC), Word, Excel, TXT.';
    }
    return null;
  }

  function acceptFile(f: File) {
    const err = validateFile(f);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setFile(f);
    if (!name) {
      const noExt = f.name.replace(/\.[^.]+$/, '');
      setName(noExt);
    }
    setMode('form');
  }

  function clearFile() {
    setFile(null);
    setName('');
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    if (filePickerRef.current) filePickerRef.current.value = '';
  }

  // ─── Scanner ─────────────────────────────────────────────────

  async function handleScannerCapture(f: File) {
    setScannerBusy(true);
    setScannerError(null);
    try {
      const dataUrl = await fileToJpegDataUrl(f);
      const enhancedUrl = await enhanceImageForDoc(dataUrl);
      const newPage: ScannedPage = {
        id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        dataUrl,
        enhancedUrl,
        bw: bwAll,
      };
      setPages(prev => [...prev, newPage]);
    } catch (e: any) {
      setScannerError(e.message || 'Falha ao processar foto');
    } finally {
      setScannerBusy(false);
      if (scannerInputRef.current) scannerInputRef.current.value = '';
    }
  }

  function removePage(id: string) {
    setPages(prev => prev.filter(p => p.id !== id));
  }

  function togglePageBw(id: string) {
    setPages(prev => prev.map(p => p.id === id ? { ...p, bw: !p.bw } : p));
  }

  function toggleAllBw() {
    const next = !bwAll;
    setBwAll(next);
    setPages(prev => prev.map(p => ({ ...p, bw: next })));
  }

  async function finishScan() {
    if (pages.length === 0) {
      setScannerError('Tire pelo menos uma foto do documento');
      return;
    }
    setScannerBusy(true);
    setScannerError(null);
    try {
      const pdfFile = await buildPdfFromPages(pages);
      if (pdfFile.size > MAX_BYTES) {
        setScannerError(
          `PDF gerado ficou muito grande (${formatSize(pdfFile.size)}). Tente menos páginas ou desative o B&W.`,
        );
        setScannerBusy(false);
        return;
      }
      setFile(pdfFile);
      // Default name amigavel
      if (!name) setName(`Documento escaneado (${pages.length} pág.)`);
      // Limpa scanner pra proxima sessao
      setPages([]);
      setMode('form');
    } catch (e: any) {
      setScannerError(e.message || 'Falha ao montar PDF');
    } finally {
      setScannerBusy(false);
    }
  }

  function exitScanner() {
    setPages([]);
    setScannerError(null);
    setMode('choose');
  }

  // ─── Submit ─────────────────────────────────────────────────

  async function submit() {
    if (!file) {
      setError('Selecione um arquivo primeiro');
      return;
    }
    if (!selectedCaseId) {
      setError('Selecione o processo');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('case_id', selectedCaseId);
      if (name.trim()) fd.append('name', name.trim());
      if (description.trim()) fd.append('description', description.trim());

      const res = await fetch(`${API_BASE}/portal/documents/upload`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `HTTP ${res.status}`);
      }
      setSuccess(true);
    } catch (e: any) {
      setError(e.message || 'Falha ao enviar');
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Render: Sucesso ────────────────────────────────────────

  if (success) {
    return (
      <>
        <PortalHeader showBack />
        <main className="flex-1 max-w-2xl w-full mx-auto px-6 py-12">
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-8 text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 mb-4">
              <CheckCircle2 className="text-emerald-400" size={28} />
            </div>
            <h1 className="text-xl font-bold mb-2">Documento enviado!</h1>
            <p className="text-white/60 text-sm mb-6">
              Seu advogado já foi notificado e vai analisar o material.
              Você pode acompanhar tudo na sua área de documentos.
            </p>
            <div className="flex gap-3 justify-center flex-wrap">
              <button
                onClick={() => router.push('/portal/documentos')}
                className="bg-[#A89048] hover:bg-[#B89A50] text-[#0a0a0f] text-sm font-bold px-5 py-2.5 rounded-full transition-colors"
              >
                Ver documentos
              </button>
              <button
                onClick={() => {
                  setSuccess(false);
                  clearFile();
                  setDescription('');
                  setMode('choose');
                }}
                className="border border-white/15 hover:border-[#A89048]/50 text-white text-sm font-bold px-5 py-2.5 rounded-full transition-colors"
              >
                Enviar outro
              </button>
            </div>
          </div>
        </main>
      </>
    );
  }

  // ─── Render: Loading / Erro / Sem casos ─────────────────────

  const noCases = cases !== null && cases.length === 0;

  return (
    <>
      <PortalHeader showBack />
      <main className="flex-1 max-w-2xl w-full mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-1">Enviar documento</h1>
          <p className="text-white/50 text-sm">
            Suba RG, CPF, comprovante de endereço, ficha trabalhista ou qualquer
            documento que seu advogado tenha pedido.
          </p>
        </div>

        {casesError && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 flex items-start gap-3 mb-4">
            <AlertCircle className="text-red-400 mt-0.5" size={18} />
            <div>
              <p className="text-red-400 font-bold text-sm">Não foi possível carregar seus processos</p>
              <p className="text-red-400/70 text-xs mt-1">{casesError}</p>
            </div>
          </div>
        )}

        {cases === null && !casesError && (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="animate-spin text-[#A89048]" size={28} />
          </div>
        )}

        {noCases && (
          <div className="rounded-xl border border-white/10 bg-[#0d0d14] p-12 text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#A89048]/15 border border-[#A89048]/30 mb-4">
              <Folder className="text-[#A89048]" size={24} />
            </div>
            <h2 className="text-lg font-bold mb-2">Nenhum processo ativo</h2>
            <p className="text-white/50 text-sm">
              No momento você não tem processos em andamento que aceitem upload de documentos.
              Fale com seu advogado se precisar enviar algo.
            </p>
          </div>
        )}

        {/* ─── MODO: Escolher origem ─────────────────────────── */}
        {cases && cases.length > 0 && mode === 'choose' && (
          <div className="space-y-3">
            <p className="text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
              Como você quer enviar?
            </p>

            <SourceCard
              icon={ScanLine}
              title="Scanner de documento"
              description="Tire fotos das páginas e geramos um PDF nítido — recomendado pra RG, CPF, comprovantes."
              accent
              onClick={() => {
                setPages([]);
                setScannerError(null);
                setMode('scanner');
              }}
            />

            <SourceCard
              icon={Camera}
              title="Tirar uma foto"
              description="Câmera do celular — uma foto rápida do documento."
              onClick={() => cameraInputRef.current?.click()}
            />

            <SourceCard
              icon={FolderOpen}
              title="Escolher arquivo"
              description="PDF, imagem ou documento que já está salvo no celular ou computador."
              onClick={() => filePickerRef.current?.click()}
            />

            {/* Inputs invisiveis */}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) acceptFile(f);
              }}
            />
            <input
              ref={filePickerRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.doc,.docx,.xls,.xlsx,.txt,application/pdf,image/*,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) acceptFile(f);
              }}
            />

            {error && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 flex items-start gap-3">
                <AlertCircle className="text-red-400 mt-0.5 shrink-0" size={18} />
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}
          </div>
        )}

        {/* ─── MODO: Scanner ─────────────────────────────────── */}
        {cases && cases.length > 0 && mode === 'scanner' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <ScanLine className="text-[#A89048]" size={20} />
                  Scanner de documento
                </h2>
                <p className="text-xs text-white/50 mt-0.5">
                  {pages.length === 0
                    ? 'Tire uma foto da primeira página'
                    : `${pages.length} ${pages.length === 1 ? 'página' : 'páginas'} adicionadas`}
                </p>
              </div>
              <button
                onClick={exitScanner}
                className="text-white/60 hover:text-white text-xs font-bold px-3 py-1.5 rounded-full hover:bg-white/5 transition-colors"
              >
                Cancelar
              </button>
            </div>

            <button
              onClick={toggleAllBw}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${
                bwAll
                  ? 'border-[#A89048]/40 bg-[#A89048]/5'
                  : 'border-white/10 bg-[#0d0d14]'
              }`}
            >
              <Sparkles className={bwAll ? 'text-[#A89048]' : 'text-white/40'} size={16} />
              <div className="flex-1 text-left">
                <p className="text-sm font-bold">
                  Filtro &quot;documento legível&quot; {bwAll ? 'ativado' : 'desligado'}
                </p>
                <p className="text-[10px] text-white/50">
                  {bwAll
                    ? 'Aplica preto e branco com contraste alto — texto fica nítido'
                    : 'Mantém as cores originais da foto'}
                </p>
              </div>
            </button>

            {/* Lista de paginas */}
            {pages.length > 0 && (
              <div className="space-y-2">
                {pages.map((p, idx) => (
                  <div
                    key={p.id}
                    className="rounded-xl border border-white/10 bg-[#0d0d14] p-3 flex items-center gap-3"
                  >
                    <div className="text-xs font-bold text-white/40 w-6 shrink-0">
                      {idx + 1}
                    </div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.bw ? p.enhancedUrl : p.dataUrl}
                      alt={`Página ${idx + 1}`}
                      className="w-16 h-20 object-cover rounded border border-white/10"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-white">Página {idx + 1}</p>
                      <button
                        onClick={() => togglePageBw(p.id)}
                        className="text-[10px] text-[#A89048] hover:underline mt-0.5"
                      >
                        {p.bw ? 'Ver original' : 'Aplicar filtro'}
                      </button>
                    </div>
                    <button
                      onClick={() => removePage(p.id)}
                      className="p-2 rounded-lg text-red-400/70 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      aria-label="Remover página"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Adicionar pagina */}
            <button
              onClick={() => scannerInputRef.current?.click()}
              disabled={scannerBusy}
              className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-white/15 hover:border-[#A89048]/40 bg-[#0d0d14] hover:bg-[#A89048]/5 disabled:opacity-50 text-white text-sm font-bold py-5 rounded-2xl transition-colors"
            >
              {scannerBusy ? (
                <>
                  <Loader2 className="animate-spin" size={18} />
                  Processando…
                </>
              ) : (
                <>
                  <Plus size={18} />
                  {pages.length === 0 ? 'Tirar foto da primeira página' : 'Adicionar próxima página'}
                </>
              )}
            </button>

            <input
              ref={scannerInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) handleScannerCapture(f);
              }}
            />

            {scannerError && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 flex items-start gap-3">
                <AlertCircle className="text-red-400 mt-0.5 shrink-0" size={18} />
                <p className="text-red-400 text-sm">{scannerError}</p>
              </div>
            )}

            {pages.length > 0 && (
              <button
                onClick={finishScan}
                disabled={scannerBusy}
                className="w-full flex items-center justify-center gap-2 bg-[#A89048] hover:bg-[#B89A50] disabled:opacity-40 text-[#0a0a0f] text-sm font-bold py-3 rounded-full transition-colors"
              >
                {scannerBusy ? (
                  <>
                    <Loader2 className="animate-spin" size={16} />
                    Gerando PDF…
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={16} />
                    Concluir e revisar ({pages.length} {pages.length === 1 ? 'pág.' : 'págs.'})
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {/* ─── MODO: Form com arquivo selecionado ────────────── */}
        {cases && cases.length > 0 && mode === 'form' && (
          <div className="space-y-5">
            {/* Card arquivo */}
            <div className="rounded-2xl border border-[#A89048]/40 bg-[#A89048]/5 p-4">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-lg bg-[#A89048]/15 border border-[#A89048]/30 flex items-center justify-center shrink-0">
                  <FileText className="text-[#A89048]" size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white truncate">{file?.name}</p>
                  <p className="text-xs text-white/50 mt-0.5">
                    {file ? formatSize(file.size) : ''}
                    {file?.type === 'application/pdf' && ' · PDF'}
                  </p>
                </div>
                <button
                  onClick={() => {
                    clearFile();
                    setMode('choose');
                  }}
                  className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/5 transition-colors"
                  aria-label="Trocar arquivo"
                  title="Trocar arquivo"
                >
                  <RefreshCcw size={16} />
                </button>
              </div>

              {/* Preview pra imagens */}
              {file && file.type.startsWith('image/') && filePreviewUrl && (
                <div className="mt-3 rounded-lg overflow-hidden border border-white/10 bg-black/30 max-h-64 flex items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={filePreviewUrl}
                    alt="Preview"
                    className="max-h-64 max-w-full object-contain"
                  />
                </div>
              )}
            </div>

            {/* Select de processo */}
            <div>
              <label className="block text-xs font-bold text-white/70 uppercase tracking-wider mb-2">
                Processo
              </label>
              {cases.length === 1 ? (
                <div className="rounded-xl border border-white/10 bg-[#0d0d14] px-4 py-3 text-sm text-white">
                  {cases[0].label}
                </div>
              ) : (
                <select
                  value={selectedCaseId}
                  onChange={e => setSelectedCaseId(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-[#0d0d14] px-4 py-3 text-sm text-white focus:border-[#A89048]/50 focus:outline-none"
                >
                  <option value="">Selecione o processo…</option>
                  {cases.map(c => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Nome */}
            <div>
              <label className="block text-xs font-bold text-white/70 uppercase tracking-wider mb-2">
                Nome do documento <span className="text-white/40 font-normal">(opcional)</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                maxLength={200}
                placeholder="Ex: RG frente e verso"
                className="w-full rounded-xl border border-white/10 bg-[#0d0d14] px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-[#A89048]/50 focus:outline-none"
              />
            </div>

            {/* Descricao */}
            <div>
              <label className="block text-xs font-bold text-white/70 uppercase tracking-wider mb-2">
                Observação <span className="text-white/40 font-normal">(opcional)</span>
              </label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                maxLength={1000}
                rows={3}
                placeholder="Algum recado pro seu advogado sobre este documento?"
                className="w-full rounded-xl border border-white/10 bg-[#0d0d14] px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-[#A89048]/50 focus:outline-none resize-none"
              />
            </div>

            {error && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 flex items-start gap-3">
                <AlertCircle className="text-red-400 mt-0.5 shrink-0" size={18} />
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            <button
              onClick={submit}
              disabled={submitting || !file || !selectedCaseId}
              className="w-full bg-[#A89048] hover:bg-[#B89A50] disabled:opacity-40 disabled:cursor-not-allowed text-[#0a0a0f] text-sm font-bold py-3 rounded-full transition-colors flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="animate-spin" size={16} />
                  Enviando…
                </>
              ) : (
                <>
                  <UploadCloud size={16} />
                  Enviar documento
                </>
              )}
            </button>
          </div>
        )}
      </main>
    </>
  );
}

function SourceCard({
  icon: Icon,
  title,
  description,
  accent,
  onClick,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  description: string;
  accent?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-2xl border p-4 transition-all flex items-start gap-4 ${
        accent
          ? 'border-[#A89048]/40 bg-[#A89048]/5 hover:bg-[#A89048]/10'
          : 'border-white/10 bg-[#0d0d14] hover:border-[#A89048]/30'
      }`}
    >
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
        accent
          ? 'bg-[#A89048]/15 border border-[#A89048]/30'
          : 'bg-white/5 border border-white/10'
      }`}>
        <Icon size={22} className={accent ? 'text-[#A89048]' : 'text-white/70'} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-base font-bold text-white">{title}</p>
        <p className="text-xs text-white/50 mt-1">{description}</p>
      </div>
    </button>
  );
}
