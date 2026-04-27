'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2, AlertCircle, CheckCircle2, UploadCloud, FileText,
  X, Folder,
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
// Extensoes pra validacao client-side quando o browser nao seta MIME (raro
// em mobile com HEIC). Usado so como fallback complementar ao MIME check.
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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getExt(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx === -1 ? '' : name.slice(idx + 1).toLowerCase();
}

export default function EnviarDocumentoPage() {
  const router = useRouter();

  const [cases, setCases] = useState<CaseOption[] | null>(null);
  const [casesError, setCasesError] = useState<string | null>(null);

  const [selectedCaseId, setSelectedCaseId] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);

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
        // Se so tem 1 processo, ja seleciona — UX pra cliente que tem
        // apenas um caso ativo (maioria dos casos)
        if (data.length === 1) setSelectedCaseId(data[0].id);
      })
      .catch(e => setCasesError(e.message || 'Falha ao carregar processos'));
  }, [router]);

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

  function handleFile(f: File) {
    const err = validateFile(f);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setFile(f);
    // Default no nome: usa o nome original sem extensao pra ficar amigavel
    if (!name) {
      const noExt = f.name.replace(/\.[^.]+$/, '');
      setName(noExt);
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }

  function clearFile() {
    setFile(null);
    setName('');
    if (inputRef.current) inputRef.current.value = '';
  }

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

  // Tela de sucesso
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
            <div className="flex gap-3 justify-center">
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

        {cases && cases.length === 0 && (
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

        {cases && cases.length > 0 && (
          <div className="space-y-5">
            {/* Drop zone / arquivo selecionado */}
            {!file ? (
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => inputRef.current?.click()}
                className={`rounded-2xl border-2 border-dashed p-10 text-center cursor-pointer transition-colors ${
                  dragOver
                    ? 'border-[#A89048] bg-[#A89048]/5'
                    : 'border-white/15 hover:border-[#A89048]/40 bg-[#0d0d14]'
                }`}
              >
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#A89048]/15 border border-[#A89048]/30 mb-3">
                  <UploadCloud className="text-[#A89048]" size={26} />
                </div>
                <p className="text-sm font-bold text-white mb-1">
                  Arraste o arquivo ou clique pra selecionar
                </p>
                <p className="text-xs text-white/50">
                  PDF, fotos (JPG/PNG/HEIC), Word, Excel ou TXT — até 25MB
                </p>
                <input
                  ref={inputRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.doc,.docx,.xls,.xlsx,.txt,application/pdf,image/*,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                  }}
                />
              </div>
            ) : (
              <div className="rounded-2xl border border-[#A89048]/40 bg-[#A89048]/5 p-4">
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-lg bg-[#A89048]/15 border border-[#A89048]/30 flex items-center justify-center shrink-0">
                    <FileText className="text-[#A89048]" size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-white truncate">{file.name}</p>
                    <p className="text-xs text-white/50 mt-0.5">{formatSize(file.size)}</p>
                  </div>
                  <button
                    onClick={clearFile}
                    className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/5 transition-colors"
                    aria-label="Remover arquivo"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            )}

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

            {/* Nome do documento */}
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
