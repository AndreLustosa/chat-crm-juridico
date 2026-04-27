'use client';

/**
 * CompleteTaskModal — modal pra estagiario concluir uma diligencia
 * (Task) e opcionalmente anexar documentos coletados (ex: comprovante
 * de residencia que o cliente mandou via WhatsApp).
 *
 * Fluxo:
 *   1. Estagiario clica "Concluir" no card da Task
 *   2. Modal abre com drop zone, lista de arquivos selecionados, nota
 *   3. Anexos sao subidos primeiro (POST /tasks/:id/attachments multipart)
 *   4. Depois marca a Task como concluida (POST /tasks/:id/complete com nota)
 *   5. Se a Task tem legal_case_id, anexos aparecem AUTOMATICAMENTE na
 *      aba Documentos do workspace (UNION na query do TabDocumentos)
 *   6. Notificacao enriquecida volta ao advogado: "X concluiu Y, 2 anexos"
 *
 * Drop zone aceita multiplos arquivos, drag-drop ou seletor. Validacao
 * client-side espelha a do backend (25MB, MIME whitelist) — fail-fast
 * antes de gastar upload.
 */

import { useEffect, useRef, useState } from 'react';
import {
  X, UploadCloud, Loader2, FileText, Trash2, AlertCircle,
  CheckCircle2, ScanLine,
} from 'lucide-react';
import api from '@/lib/api';
import { showSuccess, showError } from '@/lib/toast';

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

const FOLDERS = [
  { id: 'CLIENTE',     label: 'Documentos do cliente (RG/CPF/comprovante)' },
  { id: 'PROVAS',      label: 'Provas' },
  { id: 'CONTRATOS',   label: 'Contratos / Honorários' },
  { id: 'PROCURACOES', label: 'Procurações' },
  { id: 'DECISOES',    label: 'Decisões / Sentenças' },
  { id: 'PETICOES',    label: 'Petições' },
  { id: 'OUTROS',      label: 'Outros' },
];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i + 1).toLowerCase();
}

export interface CompleteTaskModalProps {
  open: boolean;
  taskId: string | null;
  /** Titulo da Task — usado pra contexto visual no header */
  taskTitle?: string;
  /** Se true, mostra ao estagiario que esta task tem processo vinculado
   *  e os anexos vao parar la. Se false, anexos ficam so na diligencia. */
  hasLegalCase?: boolean;
  onClose: () => void;
  /** Disparado apos conclusao com sucesso. Caller pode dar refresh. */
  onCompleted?: () => void;
}

export function CompleteTaskModal({
  open, taskId, taskTitle, hasLegalCase, onClose, onCompleted,
}: CompleteTaskModalProps) {
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [folder, setFolder] = useState<string>('OUTROS');
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reseta + busca pasta sugerida ao abrir
  useEffect(() => {
    if (!open || !taskId) return;
    setNote('');
    setFiles([]);
    setError(null);
    setProgress(null);

    // Pede sugestao de pasta automatica baseada no titulo da Task —
    // backend infere "comprovante" -> CLIENTE, "contrato" -> CONTRATOS, etc.
    api.get(`/tasks/${taskId}/suggest-folder`)
      .then(r => setFolder(r.data?.folder || 'OUTROS'))
      .catch(() => setFolder('OUTROS'));
  }, [open, taskId]);

  function validate(f: File): string | null {
    if (f.size > MAX_BYTES) {
      return `${f.name}: muito grande (${formatSize(f.size)}, max 25MB)`;
    }
    const mimeOk = ALLOWED_MIMES.has(f.type);
    const extOk = ALLOWED_EXT.has(getExt(f.name));
    if (!mimeOk && !extOk) {
      return `${f.name}: tipo não permitido. Aceitos: PDF, fotos, Word, Excel, TXT.`;
    }
    return null;
  }

  function addFiles(newFiles: FileList | File[]) {
    const arr = Array.from(newFiles);
    const errors: string[] = [];
    const valid: File[] = [];
    for (const f of arr) {
      const err = validate(f);
      if (err) errors.push(err);
      else valid.push(f);
    }
    if (errors.length > 0) setError(errors.join('\n'));
    else setError(null);
    // Evita duplicatas pelo (name, size) — drag duplo do mesmo arquivo
    setFiles(prev => {
      const existing = new Set(prev.map(p => `${p.name}|${p.size}`));
      return [...prev, ...valid.filter(f => !existing.has(`${f.name}|${f.size}`))];
    });
  }

  function removeFile(idx: number) {
    setFiles(prev => prev.filter((_, i) => i !== idx));
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  }

  async function submit() {
    if (!taskId) return;
    setSubmitting(true);
    setError(null);
    try {
      // 1. Sobe arquivos primeiro (se houver). Backend valida tudo antes
      //    de persistir — falha rapido se algum estiver fora de spec.
      if (files.length > 0) {
        setProgress(`Subindo ${files.length} ${files.length === 1 ? 'arquivo' : 'arquivos'}…`);
        const fd = new FormData();
        files.forEach(f => fd.append('files', f));
        fd.append('folder', folder);
        await api.post(`/tasks/${taskId}/attachments`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
      // 2. Marca como concluida (com nota). Notificacao enriquecida ao
      //    criador (advogado) eh disparada no backend automaticamente.
      setProgress('Marcando como concluída…');
      await api.post(`/tasks/${taskId}/complete`, {
        note: note.trim() || undefined,
      });
      const filesMsg = files.length > 0
        ? ` — ${files.length} ${files.length === 1 ? 'anexo' : 'anexos'} enviado(s)`
        : '';
      showSuccess(`Diligência concluída${filesMsg}`);
      onCompleted?.();
      onClose();
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || 'Erro ao concluir';
      setError(msg);
      showError(msg);
    } finally {
      setSubmitting(false);
      setProgress(null);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
    if (e.key === 'Escape') onClose();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKey}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center shrink-0">
              <CheckCircle2 size={18} className="text-emerald-500" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-foreground">Concluir diligência</h2>
              {taskTitle && (
                <p className="text-[11px] text-muted-foreground truncate" title={taskTitle}>
                  {taskTitle}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Drop zone — visual destacado quando arrasta arquivo em cima */}
          <div>
            <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
              Anexos <span className="text-muted-foreground/60 font-normal normal-case">(opcional)</span>
            </label>

            {files.length === 0 ? (
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => inputRef.current?.click()}
                className={`rounded-xl border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
                  dragOver
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/40 bg-accent/20'
                }`}
              >
                <UploadCloud className="mx-auto text-muted-foreground mb-2" size={24} />
                <p className="text-sm text-foreground font-semibold">
                  Arraste arquivos ou clique pra selecionar
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  PDF, fotos, Word, Excel — até 25MB cada
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {files.map((f, idx) => (
                  <div
                    key={`${f.name}-${idx}`}
                    className="flex items-center gap-3 p-2.5 rounded-lg border border-border bg-accent/20"
                  >
                    <FileText size={16} className="text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium truncate">{f.name}</p>
                      <p className="text-[10px] text-muted-foreground">{formatSize(f.size)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFile(idx)}
                      disabled={submitting}
                      className="p-1.5 text-muted-foreground hover:text-red-400 rounded transition-colors disabled:opacity-50"
                      aria-label="Remover arquivo"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={submitting}
                  className="text-[11px] text-primary hover:underline disabled:opacity-50"
                >
                  + Adicionar mais
                </button>
              </div>
            )}

            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.doc,.docx,.xls,.xlsx,.txt,application/pdf,image/*,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain"
              className="hidden"
              onChange={e => {
                if (e.target.files?.length) addFiles(e.target.files);
                e.target.value = ''; // permite re-selecionar mesmo arquivo
              }}
            />
          </div>

          {/* Pasta — so faz sentido mostrar se tem anexos E tem processo
              vinculado (anexo em task sem processo nao precisa de pasta;
              mas mostramos mesmo assim porque o estagiario pode ter
              arrastado por engano um doc pra task generica) */}
          {files.length > 0 && (
            <div>
              <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
                Pasta {hasLegalCase ? '(no processo)' : '(categorização)'}
              </label>
              <select
                value={folder}
                onChange={e => setFolder(e.target.value)}
                disabled={submitting}
                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
              >
                {FOLDERS.map(f => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
              {hasLegalCase ? (
                <p className="text-[10px] text-muted-foreground mt-1">
                  Os arquivos aparecerão na aba Documentos do processo nessa pasta.
                </p>
              ) : (
                <p className="text-[10px] text-muted-foreground mt-1">
                  Sem processo vinculado — arquivos ficam só nesta diligência.
                </p>
              )}
            </div>
          )}

          {/* Nota */}
          <div>
            <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
              O que você fez? <span className="text-muted-foreground/60 font-normal normal-case">(opcional)</span>
            </label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Ex: cliente mandou pelo WhatsApp, anexei. Falou que precisa do contrato até sexta."
              maxLength={1000}
              rows={3}
              disabled={submitting}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none disabled:opacity-50"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
              <AlertCircle size={14} className="text-red-400 shrink-0 mt-0.5" />
              <p className="text-[12px] text-red-400 whitespace-pre-line">{error}</p>
            </div>
          )}

          {progress && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <Loader2 size={14} className="text-blue-400 animate-spin shrink-0" />
              <p className="text-[12px] text-blue-400">{progress}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-accent/20">
          <span className="text-[10px] text-muted-foreground/60 mr-auto hidden sm:block">
            Cmd/Ctrl + Enter pra concluir
          </span>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-1.5 text-[12px] font-semibold rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="flex items-center gap-1.5 px-4 py-1.5 text-[12px] font-semibold bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg disabled:opacity-50 transition-colors"
          >
            {submitting ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
            {files.length > 0 ? `Concluir + Enviar ${files.length}` : 'Concluir'}
          </button>
        </div>
      </div>
    </div>
  );
}
