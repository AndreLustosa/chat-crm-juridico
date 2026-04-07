'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Upload, Trash2, Download, FolderOpen, File, Loader2,
  ChevronDown, Pencil, Plus, History, X, FileText, FileImage,
  FileSpreadsheet, FileArchive, FileVideo, FileAudio, Check,
} from 'lucide-react';
import api, { API_BASE_URL } from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

interface CaseDoc {
  id: string;
  folder: string;
  name: string;
  original_name: string;
  mime_type: string;
  size: number;
  version: number;
  description: string | null;
  created_at: string;
  uploaded_by: { id: string; name: string };
  _count: { versions: number };
}

const FOLDERS = [
  { id: 'TODOS', label: 'Todos' },
  { id: 'CLIENTE', label: 'Cliente' },
  { id: 'PROVAS', label: 'Provas' },
  { id: 'CONTRATOS', label: 'Contratos' },
  { id: 'PETICOES', label: 'Peticoes' },
  { id: 'DECISOES', label: 'Decisoes' },
  { id: 'PROCURACOES', label: 'Procuracoes' },
  { id: 'OUTROS', label: 'Outros' },
];

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function getFileIcon(mime: string) {
  if (mime.startsWith('image/')) return { Icon: FileImage, color: 'text-pink-400', bg: 'bg-pink-500/10 border-pink-500/20' };
  if (mime.includes('pdf')) return { Icon: FileText, color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20' };
  if (mime.includes('spreadsheet') || mime.includes('excel') || mime.includes('csv')) return { Icon: FileSpreadsheet, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' };
  if (mime.includes('word') || mime.includes('document')) return { Icon: FileText, color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20' };
  if (mime.startsWith('video/')) return { Icon: FileVideo, color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20' };
  if (mime.startsWith('audio/')) return { Icon: FileAudio, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' };
  if (mime.includes('zip') || mime.includes('rar') || mime.includes('tar') || mime.includes('compressed')) return { Icon: FileArchive, color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20' };
  return { Icon: File, color: 'text-muted-foreground', bg: 'bg-accent/30 border-border' };
}

export default function TabDocumentos({ caseId }: { caseId: string }) {
  const [docs, setDocs] = useState<CaseDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [folder, setFolder] = useState('TODOS');
  const [uploading, setUploading] = useState(false);
  const [uploadFolder, setUploadFolder] = useState('OUTROS');
  const fileRef = useRef<HTMLInputElement>(null);

  // Editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editFolder, setEditFolder] = useState('');
  const [editDesc, setEditDesc] = useState('');

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (folder !== 'TODOS') params.folder = folder;
      const res = await api.get(`/case-documents/${caseId}`, { params });
      setDocs(res.data || []);
    } catch {
      showError('Erro ao carregar documentos');
    } finally {
      setLoading(false);
    }
  }, [caseId, folder]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', uploadFolder);
      await api.post(`/case-documents/${caseId}/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      showSuccess('Documento enviado');
      fetchDocs();
    } catch {
      showError('Erro ao enviar documento');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleDownload = async (docId: string, fileName: string) => {
    try {
      const token = localStorage.getItem('token');
      const link = document.createElement('a');
      link.href = `${API_BASE_URL}/case-documents/${docId}/download`;
      link.setAttribute('download', fileName);
      // Fetch with auth
      const res = await api.get(`/case-documents/${docId}/download`, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      link.href = url;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      showError('Erro ao baixar documento');
    }
  };

  const handleDelete = async (docId: string) => {
    if (!confirm('Deseja deletar este documento?')) return;
    try {
      await api.delete(`/case-documents/${docId}`);
      showSuccess('Documento removido');
      fetchDocs();
    } catch {
      showError('Erro ao remover documento');
    }
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    try {
      await api.patch(`/case-documents/${editingId}`, {
        name: editName,
        folder: editFolder,
        description: editDesc || null,
      });
      showSuccess('Documento atualizado');
      setEditingId(null);
      fetchDocs();
    } catch {
      showError('Erro ao atualizar');
    }
  };

  const startEdit = (doc: CaseDoc) => {
    setEditingId(doc.id);
    setEditName(doc.name);
    setEditFolder(doc.folder);
    setEditDesc(doc.description || '');
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">

      {/* Header Card with Upload */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between bg-accent/20">
          <h2 className="text-[13px] font-bold text-foreground flex items-center gap-2">
            <FolderOpen size={14} className="text-primary" />
            Documentos do Caso
          </h2>
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <select
                className="appearance-none px-3 py-2 pr-7 rounded-xl bg-accent/30 border border-border text-[11px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all cursor-pointer"
                value={uploadFolder}
                onChange={(e) => setUploadFolder(e.target.value)}
              >
                {FOLDERS.filter(f => f.id !== 'TODOS').map(f => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
              <ChevronDown size={10} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            </div>
            <label className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-[11px] font-bold hover:opacity-90 transition-opacity cursor-pointer shadow-lg shadow-primary/20">
              {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
              Enviar
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={handleUpload}
                disabled={uploading}
              />
            </label>
          </div>
        </div>

        {/* Folder filter pills */}
        <div className="px-5 py-3 border-b border-border/50 flex gap-1.5 flex-wrap">
          {FOLDERS.map(f => (
            <button
              key={f.id}
              onClick={() => setFolder(f.id)}
              className={`px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all ${
                folder === f.id
                  ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
                  : 'bg-accent/30 text-muted-foreground hover:bg-accent/50 hover:text-foreground border border-border'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Document list */}
        <div className="p-5">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 size={20} className="animate-spin text-primary" />
            </div>
          ) : docs.length === 0 ? (
            <div className="text-center py-16">
              <File size={64} className="mx-auto mb-3 opacity-20 text-muted-foreground" />
              <p className="text-[12px] text-muted-foreground">Nenhum documento nesta pasta</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {docs.map(doc => {
                const { Icon: FileIcon, color: iconColor, bg: iconBg } = getFileIcon(doc.mime_type);

                return (
                  <div
                    key={doc.id}
                    className="flex items-center gap-3.5 p-3.5 rounded-xl bg-accent/20 border border-border/50 hover:border-border hover:bg-accent/40 transition-all group"
                  >
                    {/* File type icon */}
                    <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${iconBg}`}>
                      <FileIcon size={18} className={iconColor} />
                    </div>

                    {editingId === doc.id ? (
                      /* Edit mode */
                      <div className="flex-1 space-y-2.5">
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Nome</label>
                          <input
                            className="w-full px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                          />
                        </div>
                        <div className="flex gap-2.5 items-end">
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Pasta</label>
                            <div className="relative">
                              <select
                                className="appearance-none px-3 py-2.5 pr-7 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all cursor-pointer"
                                value={editFolder}
                                onChange={(e) => setEditFolder(e.target.value)}
                              >
                                {FOLDERS.filter(f => f.id !== 'TODOS').map(f => (
                                  <option key={f.id} value={f.id}>{f.label}</option>
                                ))}
                              </select>
                              <ChevronDown size={10} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                            </div>
                          </div>
                          <div className="flex-1 space-y-1.5">
                            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Descricao</label>
                            <input
                              className="w-full px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
                              placeholder="Descricao (opcional)"
                              value={editDesc}
                              onChange={(e) => setEditDesc(e.target.value)}
                            />
                          </div>
                          <button
                            onClick={handleSaveEdit}
                            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-500 text-white text-[11px] font-bold hover:opacity-90 transition-opacity shadow-lg shadow-emerald-500/20 shrink-0"
                          >
                            <Check size={12} />
                            Salvar
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="p-2.5 rounded-xl bg-accent/30 border border-border text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-all shrink-0"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* View mode */
                      <>
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-bold text-foreground truncate">{doc.name}</p>
                          <div className="flex items-center gap-2.5 mt-1">
                            <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-lg bg-primary/10 text-primary border border-primary/20">
                              {doc.folder}
                            </span>
                            <span className="text-[10px] text-muted-foreground">{formatSize(doc.size)}</span>
                            <span className="text-[10px] text-muted-foreground">{formatDate(doc.created_at)}</span>
                            <span className="text-[10px] text-muted-foreground">por {doc.uploaded_by.name}</span>
                            {doc._count.versions > 0 && (
                              <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                                <History size={10} /> v{doc.version + doc._count.versions}
                              </span>
                            )}
                          </div>
                          {doc.description && (
                            <p className="text-[10px] text-muted-foreground/60 mt-1 truncate">{doc.description}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => handleDownload(doc.id, doc.original_name)}
                            className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-all"
                            title="Baixar"
                          >
                            <Download size={14} />
                          </button>
                          <button
                            onClick={() => startEdit(doc)}
                            className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-all"
                            title="Editar"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => handleDelete(doc.id)}
                            className="p-2 rounded-xl text-red-400/70 hover:text-red-400 hover:bg-red-500/10 transition-all"
                            title="Excluir"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
