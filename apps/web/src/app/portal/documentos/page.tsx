'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, AlertCircle, FileText, Download, Folder, UploadCloud, User } from 'lucide-react';
import { PortalHeader } from '../components/PortalHeader';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005';

type Document = {
  id: string;
  name: string;
  original_name: string;
  folder: string;
  mime_type: string;
  size: number;
  description: string | null;
  version: number;
  created_at: string;
  uploaded_by: string | null;
  uploaded_via_portal: boolean;
  case: { id: string; case_number: string | null; action_type: string };
};

const FOLDER_LABELS: Record<string, { label: string; emoji: string }> = {
  CLIENTE: { label: 'Documentos pessoais', emoji: '🆔' },
  CONTRATOS: { label: 'Contratos', emoji: '📄' },
  DECISOES: { label: 'Decisões / Sentenças', emoji: '⚖️' },
  PROCURACOES: { label: 'Procurações', emoji: '📜' },
};

function formatBrDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentosPage() {
  const router = useRouter();
  const [docs, setDocs] = useState<Document[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/portal/documents`, { credentials: 'include' })
      .then(async r => {
        if (r.status === 401) { router.push('/portal'); return null; }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => { if (data) setDocs(data); })
      .catch(e => setError(e.message || 'Falha ao carregar'));
  }, [router]);

  async function downloadDoc(doc: Document) {
    setDownloading(doc.id);
    try {
      const res = await fetch(`${API_BASE}/portal/documents/${doc.id}/download`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.original_name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(`Erro ao baixar: ${e.message}`);
    } finally {
      setDownloading(null);
    }
  }

  // Agrupa documentos por processo
  const byCase = new Map<string, { case: Document['case']; docs: Document[] }>();
  if (docs) {
    for (const d of docs) {
      const key = d.case.id;
      if (!byCase.has(key)) byCase.set(key, { case: d.case, docs: [] });
      byCase.get(key)!.docs.push(d);
    }
  }

  return (
    <>
      <PortalHeader showBack />
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-8">
        <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold mb-1">Seus documentos</h1>
            <p className="text-white/50 text-sm">Procurações, contratos, decisões e demais documentos disponíveis.</p>
          </div>
          <button
            onClick={() => router.push('/portal/enviar-documento')}
            className="flex items-center gap-2 bg-[#A89048] hover:bg-[#B89A50] text-[#0a0a0f] text-sm font-bold px-4 py-2.5 rounded-full transition-colors shrink-0"
          >
            <UploadCloud size={16} />
            Enviar documento
          </button>
        </div>

        {docs === null && !error && (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="animate-spin text-[#A89048]" size={28} />
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 flex items-start gap-3">
            <AlertCircle className="text-red-400 mt-0.5" size={18} />
            <div>
              <p className="text-red-400 font-bold text-sm">Não foi possível carregar</p>
              <p className="text-red-400/70 text-xs mt-1">{error}</p>
            </div>
          </div>
        )}

        {docs && docs.length === 0 && (
          <div className="rounded-xl border border-white/10 bg-[#0d0d14] p-12 text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#A89048]/15 border border-[#A89048]/30 mb-4">
              <FileText className="text-[#A89048]" size={24} />
            </div>
            <h2 className="text-lg font-bold mb-2">Nenhum documento ainda</h2>
            <p className="text-white/50 text-sm mb-5 max-w-md mx-auto">
              Quando seu advogado adicionar procurações, contratos ou decisões, eles aparecem aqui.
              Você também pode enviar documentos pra ele.
            </p>
            <button
              onClick={() => router.push('/portal/enviar-documento')}
              className="inline-flex items-center gap-2 bg-[#A89048] hover:bg-[#B89A50] text-[#0a0a0f] text-sm font-bold px-5 py-2.5 rounded-full transition-colors"
            >
              <UploadCloud size={16} />
              Enviar documento
            </button>
          </div>
        )}

        {docs && docs.length > 0 && (
          <div className="space-y-6">
            {Array.from(byCase.values()).map(({ case: c, docs }) => (
              <div key={c.id}>
                <div className="flex items-center gap-2 mb-3 px-1">
                  <Folder className="text-white/50" size={14} />
                  <h2 className="text-xs font-bold text-white/70 uppercase tracking-wider">
                    {c.action_type}
                    {c.case_number && (
                      <span className="ml-2 font-mono text-white/40 normal-case font-normal">
                        {c.case_number}
                      </span>
                    )}
                  </h2>
                </div>
                <div className="space-y-2">
                  {docs.map(d => (
                    <DocumentRow
                      key={d.id}
                      doc={d}
                      downloading={downloading === d.id}
                      onDownload={() => downloadDoc(d)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

function DocumentRow({
  doc,
  downloading,
  onDownload,
}: {
  doc: Document;
  downloading: boolean;
  onDownload: () => void;
}) {
  const folderCfg = FOLDER_LABELS[doc.folder] || { label: doc.folder, emoji: '📁' };
  return (
    <div className="rounded-xl border border-white/10 bg-[#0d0d14] hover:border-[#A89048]/30 p-4 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-[#A89048]/15 border border-[#A89048]/30 flex items-center justify-center shrink-0">
            <FileText className="text-[#A89048]" size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-[10px] font-bold text-[#A89048] uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#A89048]/10 border border-[#A89048]/30">
                {folderCfg.emoji} {folderCfg.label}
              </span>
              {doc.uploaded_via_portal && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30">
                  <User size={10} />
                  Enviado por mim
                </span>
              )}
              {doc.version > 1 && (
                <span className="text-[10px] font-bold text-violet-400 uppercase tracking-wider px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/30">
                  v{doc.version}
                </span>
              )}
            </div>
            <h3 className="font-bold text-sm text-white mb-0.5 truncate">{doc.name}</h3>
            {doc.description && (
              <p className="text-xs text-white/60 line-clamp-2">{doc.description}</p>
            )}
            <p className="text-[10px] text-white/40 mt-1">
              {formatSize(doc.size)} · {formatBrDate(doc.created_at)}
              {doc.uploaded_by && !doc.uploaded_via_portal && ` · adicionado por ${doc.uploaded_by}`}
            </p>
          </div>
        </div>
        <button
          onClick={onDownload}
          disabled={downloading}
          className="shrink-0 flex items-center gap-1.5 bg-[#A89048] hover:bg-[#B89A50] disabled:opacity-40 text-[#0a0a0f] text-xs font-bold px-3 py-2 rounded-full transition-colors"
        >
          {downloading ? <Loader2 className="animate-spin" size={12} /> : <Download size={12} />}
          {downloading ? 'Baixando…' : 'Baixar'}
        </button>
      </div>
    </div>
  );
}
