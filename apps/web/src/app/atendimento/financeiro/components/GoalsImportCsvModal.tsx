'use client';

/**
 * Modal "Importar CSV" — permite cadastrar metas em massa via arquivo CSV.
 *
 * Fluxo de 3 etapas:
 *  1. Upload (paste ou file input)
 *  2. Preview (dryRun — mostra quantas serao criadas/sobrescritas)
 *  3. Confirma (submete com overwriteConfirmed=true se houver conflitos)
 *
 * Formato esperado do CSV:
 *   year,month,kind,scope,value
 *   2026,1,REALIZED,OFFICE,60000
 *   2026,2,REALIZED,a1b2c3d4-...,15000
 */

import { useEffect, useState } from 'react';
import { X, Check, Loader2, FileText, Upload, AlertTriangle, Info, Copy } from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

interface GoalsImportCsvModalProps {
  /** Lista de advogados pra mostrar exemplo com IDs reais no template */
  lawyers?: Array<{ id: string; name: string }>;
  onClose: () => void;
  onImported: () => void;
}

interface ImportPreview {
  success: boolean;
  dryRun: boolean;
  rowsProcessed: number;
  created: number;
  replaced: number;
  errors?: string[];
  groups?: Array<{ scope: string; kind: string; rows: number; conflicts: number }>;
  requiresConfirmation?: boolean;
  conflicts?: any[];
  message?: string;
}

const SAMPLE_CSV_TEMPLATE = `# Metas mensais — Importacao via CSV
# Header obrigatorio na primeira linha:
year,month,kind,scope,value
2026,1,REALIZED,OFFICE,60000
2026,2,REALIZED,OFFICE,60000
2026,3,REALIZED,OFFICE,60000
2026,1,CONTRACTED,OFFICE,80000
# Para meta de advogado especifico, use o UUID no scope:
# 2026,1,REALIZED,a1b2c3d4-e5f6-7890-abcd-ef0123456789,15000
`;

export default function GoalsImportCsvModal({ lawyers = [], onClose, onImported }: GoalsImportCsvModalProps) {
  const [step, setStep] = useState<'upload' | 'preview'>('upload');
  const [csvContent, setCsvContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [requiresConfirmation, setRequiresConfirmation] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  // ─── Handlers ───────────────────────────────────────

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result?.toString() || '';
      setCsvContent(content);
    };
    reader.onerror = () => showError('Erro ao ler arquivo');
    reader.readAsText(file);
  };

  const handlePreview = async () => {
    if (!csvContent.trim()) {
      showError('Cole ou suba um CSV antes');
      return;
    }
    setSubmitting(true);
    try {
      const r = await api.post('/financeiro/goals/import-csv', {
        csvContent,
        dryRun: true,
      });
      setPreview(r.data);
      setStep('preview');
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao validar CSV');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirm = async (overwriteConfirmed = false) => {
    setSubmitting(true);
    try {
      const r = await api.post('/financeiro/goals/import-csv', {
        csvContent,
        dryRun: false,
        overwriteConfirmed,
      });
      const data: ImportPreview = r.data;

      if (data.requiresConfirmation && !overwriteConfirmed) {
        setRequiresConfirmation(true);
        return;
      }

      if (data.success) {
        const partes = [];
        if (data.created > 0) partes.push(`${data.created} criada(s)`);
        if (data.replaced > 0) partes.push(`${data.replaced} sobrescrita(s)`);
        showSuccess(`Importação concluída — ${partes.join(', ') || data.rowsProcessed + ' linha(s)'}`);
        onImported();
      } else {
        showError(data.errors?.join(' · ') || 'Erro na importação');
      }
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao importar CSV');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyTemplate = () => {
    let template = SAMPLE_CSV_TEMPLATE;
    // Substitui o exemplo de UUID pelo primeiro advogado real, se houver
    if (lawyers.length > 0) {
      template = template.replace(
        'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
        `${lawyers[0].id}    # ${lawyers[0].name}`,
      );
    }
    navigator.clipboard.writeText(template);
    showSuccess('Template copiado pra área de transferência');
  };

  // ─── Render ─────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 z-10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Upload size={16} className="text-cyan-400" />
            <h2 className="text-base font-bold text-foreground">
              Importar metas via CSV {step === 'preview' && '— Preview'}
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="p-1 rounded hover:bg-accent/30 text-muted-foreground hover:text-foreground"
            title="Fechar (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {step === 'upload' && (
            <>
              {/* Instrucoes + template */}
              <div className="bg-muted/30 rounded-lg p-3">
                <div className="flex items-start gap-2 mb-2">
                  <Info size={12} className="mt-0.5 shrink-0 text-muted-foreground" />
                  <div className="text-xs text-muted-foreground">
                    <strong>Header obrigatório:</strong> <code className="bg-card px-1 rounded">year,month,kind,scope,value</code>
                    <ul className="mt-1.5 space-y-0.5 list-disc list-inside text-[11px]">
                      <li><strong>kind</strong>: REALIZED ou CONTRACTED</li>
                      <li><strong>scope</strong>: <code className="bg-card px-1 rounded">OFFICE</code> (escritório) ou UUID do advogado</li>
                      <li><strong>value</strong>: número decimal sem separador de milhar</li>
                      <li>Linhas em branco e iniciadas com <code className="bg-card px-1 rounded">#</code> são ignoradas</li>
                    </ul>
                  </div>
                </div>
                <button
                  onClick={handleCopyTemplate}
                  className="flex items-center gap-1.5 text-[11px] font-bold text-cyan-400 hover:underline"
                >
                  <Copy size={11} /> Copiar template de exemplo
                </button>
              </div>

              {/* Upload de arquivo */}
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                  Subir arquivo CSV
                </label>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileChange}
                  className="w-full text-xs file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-cyan-500/15 file:text-cyan-400 file:font-semibold file:cursor-pointer file:hover:bg-cyan-500/25"
                />
              </div>

              <div className="text-[11px] text-muted-foreground text-center">— ou —</div>

              {/* Paste */}
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                  Cole o conteúdo do CSV
                </label>
                <textarea
                  value={csvContent}
                  onChange={(e) => setCsvContent(e.target.value)}
                  placeholder="year,month,kind,scope,value&#10;2026,1,REALIZED,OFFICE,60000"
                  rows={10}
                  className="w-full px-3 py-2 text-[11px] bg-background border border-border rounded-lg font-mono focus:outline-none focus:border-primary"
                />
                {csvContent && (
                  <div className="text-[10px] text-muted-foreground mt-1 tabular-nums">
                    {csvContent.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).length - 1} linha(s) de dado(s)
                  </div>
                )}
              </div>
            </>
          )}

          {step === 'preview' && preview && (
            <>
              {/* Erros */}
              {preview.errors && preview.errors.length > 0 && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <AlertTriangle size={12} className="text-red-400" />
                    <span className="text-xs font-bold text-red-400">CSV com erros</span>
                  </div>
                  <ul className="text-[11px] text-muted-foreground space-y-0.5 list-disc list-inside">
                    {preview.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Resumo */}
              {preview.success && (
                <>
                  <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3">
                    <div className="flex items-center gap-2">
                      <Check size={14} className="text-emerald-400" />
                      <span className="text-sm font-bold text-emerald-400">CSV válido</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-3">
                      <div className="text-center">
                        <div className="text-[10px] text-muted-foreground">Linhas</div>
                        <div className="text-base font-bold text-foreground tabular-nums">{preview.rowsProcessed}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-[10px] text-emerald-400">A criar</div>
                        <div className="text-base font-bold text-emerald-400 tabular-nums">{preview.created}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-[10px] text-amber-400">A sobrescrever</div>
                        <div className="text-base font-bold text-amber-400 tabular-nums">{preview.replaced}</div>
                      </div>
                    </div>
                  </div>

                  {/* Detalhes por grupo */}
                  {preview.groups && preview.groups.length > 0 && (
                    <div className="bg-muted/30 rounded-lg p-3">
                      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                        Por escopo + tipo
                      </div>
                      <table className="w-full text-[11px]">
                        <thead className="text-muted-foreground">
                          <tr>
                            <th className="text-left">Escopo</th>
                            <th className="text-left">Tipo</th>
                            <th className="text-right">Linhas</th>
                            <th className="text-right">Conflitos</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.groups.map((g, i) => (
                            <tr key={i} className="border-t border-border/50">
                              <td className="py-1 text-foreground truncate max-w-[150px]">
                                {g.scope === 'OFFICE'
                                  ? 'Escritório'
                                  : lawyers.find((l) => l.id === g.scope)?.name || g.scope.slice(0, 8) + '...'}
                              </td>
                              <td className="py-1 text-foreground">{g.kind === 'REALIZED' ? 'Realizada' : 'Contratada'}</td>
                              <td className="py-1 text-right text-foreground tabular-nums">{g.rows}</td>
                              <td className={`py-1 text-right tabular-nums ${g.conflicts > 0 ? 'text-amber-400' : 'text-muted-foreground'}`}>
                                {g.conflicts}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Aviso de sobrescrita */}
                  {preview.replaced > 0 && (
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex items-start gap-2">
                      <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
                      <div className="text-[11px] text-foreground">
                        <strong>{preview.replaced}</strong> meta(s) já existem nas combinações do CSV. Confirmar
                        vai marcá-las como apagadas (soft delete) e criar as novas. O histórico fica preservado
                        — pode ver as versões antigas no botão Histórico de cada linha.
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Confirmacao final */}
              {requiresConfirmation && preview.success && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex items-center gap-2">
                  <AlertTriangle size={14} className="text-amber-400" />
                  <span className="text-[11px] text-foreground">
                    Confirme novamente para sobrescrever {preview.replaced} meta(s) existentes.
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-card border-t border-border px-6 py-3 flex items-center justify-end gap-2">
          {step === 'upload' && (
            <>
              <button
                onClick={onClose}
                disabled={submitting}
                className="px-4 py-2 rounded-lg border border-border text-foreground hover:bg-accent/30 text-xs font-semibold disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handlePreview}
                disabled={submitting || !csvContent.trim()}
                className="flex items-center gap-1 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold disabled:opacity-50"
              >
                {submitting ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
                Validar CSV
              </button>
            </>
          )}

          {step === 'preview' && (
            <>
              <button
                onClick={() => {
                  setStep('upload');
                  setPreview(null);
                  setRequiresConfirmation(false);
                }}
                disabled={submitting}
                className="px-4 py-2 rounded-lg border border-border text-foreground hover:bg-accent/30 text-xs font-semibold disabled:opacity-50"
              >
                Voltar
              </button>
              {preview?.success && (
                <button
                  onClick={() => handleConfirm(requiresConfirmation || (preview?.replaced || 0) > 0)}
                  disabled={submitting}
                  className={`flex items-center gap-1 px-4 py-2 rounded-lg text-xs font-semibold disabled:opacity-50 ${
                    (preview?.replaced || 0) > 0
                      ? 'bg-amber-500 text-white hover:bg-amber-600'
                      : 'bg-primary text-primary-foreground hover:bg-primary/90'
                  }`}
                >
                  {submitting ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                  {(preview?.replaced || 0) > 0 ? 'Confirmar e sobrescrever' : 'Importar metas'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
