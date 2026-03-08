'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Upload, Trash2, Download, FolderOpen, File, Loader2,
  ChevronDown, Pencil, Plus, History, X,
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
  { id: 'PETICOES', label: 'Petições' },
  { id: 'DECISOES', label: 'Decisões' },
  { id: 'PROCURACOES', label: 'Procurações' },
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
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      {/* Header + Upload */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <FolderOpen className="h-4 w-4 text-primary" />
          Documentos do Caso
        </h2>
        <div className="flex items-center gap-2">
          <select
            className="select select-bordered select-xs"
            value={uploadFolder}
            onChange={(e) => setUploadFolder(e.target.value)}
          >
            {FOLDERS.filter(f => f.id !== 'TODOS').map(f => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>
          <label className="btn btn-primary btn-sm gap-1">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
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

      {/* Folder filter */}
      <div className="flex gap-1 flex-wrap">
        {FOLDERS.map(f => (
          <button
            key={f.id}
            onClick={() => setFolder(f.id)}
            className={`btn btn-xs ${folder === f.id ? 'btn-primary' : 'btn-ghost'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Document list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : docs.length === 0 ? (
        <div className="text-center py-12 text-base-content/50">
          <File className="h-12 w-12 mx-auto mb-2 opacity-30" />
          <p>Nenhum documento nesta pasta</p>
        </div>
      ) : (
        <div className="space-y-2">
          {docs.map(doc => (
            <div
              key={doc.id}
              className="flex items-center gap-3 p-3 rounded-lg bg-base-200/50 hover:bg-base-200 transition-colors group"
            >
              <File className="h-5 w-5 text-base-content/40 shrink-0" />

              {editingId === doc.id ? (
                /* Edit mode */
                <div className="flex-1 space-y-2">
                  <input
                    className="input input-bordered input-xs w-full"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <select
                      className="select select-bordered select-xs"
                      value={editFolder}
                      onChange={(e) => setEditFolder(e.target.value)}
                    >
                      {FOLDERS.filter(f => f.id !== 'TODOS').map(f => (
                        <option key={f.id} value={f.id}>{f.label}</option>
                      ))}
                    </select>
                    <input
                      className="input input-bordered input-xs flex-1"
                      placeholder="Descrição (opcional)"
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                    />
                    <button onClick={handleSaveEdit} className="btn btn-success btn-xs">Salvar</button>
                    <button onClick={() => setEditingId(null)} className="btn btn-ghost btn-xs">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ) : (
                /* View mode */
                <>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{doc.name}</p>
                    <div className="flex items-center gap-2 text-xs text-base-content/50">
                      <span className="badge badge-xs badge-outline">{doc.folder}</span>
                      <span>{formatSize(doc.size)}</span>
                      <span>{formatDate(doc.created_at)}</span>
                      <span>por {doc.uploaded_by.name}</span>
                      {doc._count.versions > 0 && (
                        <span className="flex items-center gap-0.5">
                          <History className="h-3 w-3" /> v{doc.version + doc._count.versions}
                        </span>
                      )}
                    </div>
                    {doc.description && (
                      <p className="text-xs text-base-content/40 mt-0.5">{doc.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleDownload(doc.id, doc.original_name)}
                      className="btn btn-ghost btn-xs btn-circle"
                      title="Baixar"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => startEdit(doc)}
                      className="btn btn-ghost btn-xs btn-circle"
                      title="Editar"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(doc.id)}
                      className="btn btn-ghost btn-xs btn-circle text-error"
                      title="Excluir"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
