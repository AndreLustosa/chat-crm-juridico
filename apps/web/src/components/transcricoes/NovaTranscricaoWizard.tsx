'use client';

import { useEffect, useRef, useState } from 'react';
import {
  X, Upload, Search, Users, Unlink, Loader2, ArrowRight, ArrowLeft,
  Briefcase, Check,
} from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

type Mode = 'choose' | 'cnj' | 'cliente' | 'avulsa';

interface LegalCaseLite {
  id: string;
  case_number: string | null;
  legal_area: string | null;
  stage: string;
  lead?: { id: string; name: string } | null;
}

interface LeadLite {
  id: string;
  name: string;
  phone?: string;
  legal_cases_count?: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Callback após upload OK — recebe o id da transcrição criada. */
  onCreated: (transcriptionId: string) => void;
  /** Pré-seleciona um caseId (usado quando aberto dentro de um processo). */
  prefilledCaseId?: string;
}

/**
 * Wizard de criação de transcrição:
 *   Passo 1 — escolhe o contexto (processo por CNJ, por cliente, ou avulsa)
 *   Passo 2 — upload do arquivo
 *
 * Se vier `prefilledCaseId`, pula o passo 1 e vai direto pro upload.
 */
export function NovaTranscricaoWizard({ open, onClose, onCreated, prefilledCaseId }: Props) {
  const [mode, setMode] = useState<Mode>('choose');
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [selectedCaseLabel, setSelectedCaseLabel] = useState<string>('');

  // CNJ search
  const [cnjQuery, setCnjQuery] = useState('');
  const [cnjResults, setCnjResults] = useState<LegalCaseLite[]>([]);
  const [cnjLoading, setCnjLoading] = useState(false);

  // Cliente search
  const [leadQuery, setLeadQuery] = useState('');
  const [leads, setLeads] = useState<LeadLite[]>([]);
  const [leadLoading, setLeadLoading] = useState(false);
  const [selectedLead, setSelectedLead] = useState<LeadLite | null>(null);
  const [leadCases, setLeadCases] = useState<LegalCaseLite[]>([]);

  // Upload
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset ao abrir
  useEffect(() => {
    if (!open) return;
    if (prefilledCaseId) {
      setSelectedCaseId(prefilledCaseId);
      setMode('avulsa'); // usamos 'avulsa' como sinônimo de "avançar direto pro upload"
    } else {
      setMode('choose');
      setSelectedCaseId(null);
      setSelectedCaseLabel('');
    }
    setFile(null);
    setUploadProgress(0);
    setCnjQuery('');
    setCnjResults([]);
    setLeadQuery('');
    setLeads([]);
    setSelectedLead(null);
    setLeadCases([]);
  }, [open, prefilledCaseId]);


  // Busca por CNJ (debounced)
  useEffect(() => {
    if (mode !== 'cnj') return;
    if (cnjQuery.length < 3) { setCnjResults([]); return; }
    const t = setTimeout(async () => {
      setCnjLoading(true);
      try {
        const r = await api.get(`/legal-cases`, { params: { caseNumber: cnjQuery } });
        setCnjResults(Array.isArray(r.data) ? r.data.slice(0, 10) : []);
      } catch {
        setCnjResults([]);
      } finally {
        setCnjLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [cnjQuery, mode]);

  // Busca leads (debounced)
  useEffect(() => {
    if (mode !== 'cliente' || selectedLead) return;
    if (leadQuery.length < 2) { setLeads([]); return; }
    const t = setTimeout(async () => {
      setLeadLoading(true);
      try {
        const r = await api.get(`/leads`, { params: { search: leadQuery, limit: 10 } });
        const arr = Array.isArray(r.data) ? r.data : (r.data?.data || r.data?.leads || []);
        setLeads(arr.slice(0, 10));
      } catch {
        setLeads([]);
      } finally {
        setLeadLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [leadQuery, mode, selectedLead]);

  // Busca processos do lead selecionado
  useEffect(() => {
    if (!selectedLead) { setLeadCases([]); return; }
    (async () => {
      try {
        const r = await api.get(`/legal-cases`, { params: { leadId: selectedLead.id } });
        setLeadCases(Array.isArray(r.data) ? r.data : []);
      } catch {
        setLeadCases([]);
      }
    })();
  }, [selectedLead]);

  const pickCase = (c: LegalCaseLite) => {
    setSelectedCaseId(c.id);
    const label = c.case_number
      ? `Processo ${c.case_number}`
      : `${c.legal_area || 'Processo'} sem número`;
    setSelectedCaseLabel(`${label} — ${c.lead?.name || ''}`.trim());
  };

  const handleUpload = async () => {
    if (!file) {
      showError('Selecione um arquivo');
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    const form = new FormData();
    form.append('file', file);
    try {
      const params: any = {};
      if (selectedCaseId) params.caseId = selectedCaseId;
      // Provider é decidido pelo backend a partir de user.transcription_provider
      // (admin define em Configurações → Transcrição), não escolhido aqui.
      const r = await api.post(`/transcriptions`, form, {
        params,
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (pe) => {
          if (pe.total) setUploadProgress(Math.round((pe.loaded / pe.total) * 100));
        },
      });
      showSuccess('Upload concluído. Transcrição enfileirada.');
      onCreated(r.data?.id);
      onClose();
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro no upload');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-base-100 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold">Nova transcrição</h2>
          <button onClick={onClose} className="btn btn-ghost btn-sm btn-circle">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Passo 1: escolher contexto */}
        {mode === 'choose' && (
          <div className="p-6 space-y-3">
            <p className="text-sm text-base-content/60 mb-4">
              Escolha como vincular a transcrição. Se for atrelada a um processo, a IA do briefing
              vai usar o texto dela como contexto.
            </p>

            <button
              onClick={() => setMode('cnj')}
              className="w-full flex items-center gap-3 p-4 rounded-lg border border-border hover:border-primary/40 hover:bg-accent/20 transition text-left"
            >
              <Search className="h-5 w-5 text-primary shrink-0" />
              <div className="flex-1">
                <div className="font-medium">Por número de processo (CNJ)</div>
                <div className="text-xs text-base-content/60">Busca rápida pelo número</div>
              </div>
              <ArrowRight className="h-4 w-4 text-base-content/40" />
            </button>

            <button
              onClick={() => setMode('cliente')}
              className="w-full flex items-center gap-3 p-4 rounded-lg border border-border hover:border-primary/40 hover:bg-accent/20 transition text-left"
            >
              <Users className="h-5 w-5 text-primary shrink-0" />
              <div className="flex-1">
                <div className="font-medium">Escolher cliente e processo</div>
                <div className="text-xs text-base-content/60">Lista clientes e seus processos</div>
              </div>
              <ArrowRight className="h-4 w-4 text-base-content/40" />
            </button>

            <button
              onClick={() => { setMode('avulsa'); setSelectedCaseId(null); setSelectedCaseLabel(''); }}
              className="w-full flex items-center gap-3 p-4 rounded-lg border border-border hover:border-primary/40 hover:bg-accent/20 transition text-left"
            >
              <Unlink className="h-5 w-5 text-primary shrink-0" />
              <div className="flex-1">
                <div className="font-medium">Avulsa (sem processo)</div>
                <div className="text-xs text-base-content/60">Não vai pro painel de cliente nem pra IA</div>
              </div>
              <ArrowRight className="h-4 w-4 text-base-content/40" />
            </button>
          </div>
        )}

        {/* Passo 2a: busca por CNJ */}
        {mode === 'cnj' && !selectedCaseId && (
          <div className="p-6 space-y-3">
            <button onClick={() => setMode('choose')} className="text-xs text-base-content/60 hover:text-primary flex items-center gap-1">
              <ArrowLeft className="h-3 w-3" /> voltar
            </button>
            <label className="label text-sm">Número do processo</label>
            <div className="relative">
              <input
                type="text"
                value={cnjQuery}
                onChange={(e) => setCnjQuery(e.target.value)}
                placeholder="Ex: 0700870-48.2025.8.02.0017 (ou só parte do número)"
                className="input input-bordered w-full pr-10"
                autoFocus
              />
              {cnjLoading && (
                <Loader2 className="h-4 w-4 animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-base-content/50" />
              )}
            </div>
            {cnjResults.length > 0 && (
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {cnjResults.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => pickCase(c)}
                    className="w-full text-left p-3 rounded-lg border border-border hover:border-primary/40 hover:bg-accent/20 transition"
                  >
                    <div className="flex items-center gap-2">
                      <Briefcase className="h-4 w-4 text-primary" />
                      <span className="font-mono text-sm">{c.case_number || '(sem número)'}</span>
                      {c.legal_area && (
                        <span className="text-xs bg-accent/30 rounded px-2 py-0.5">{c.legal_area}</span>
                      )}
                    </div>
                    {c.lead?.name && (
                      <div className="text-xs text-base-content/60 mt-0.5 ml-6">{c.lead.name}</div>
                    )}
                  </button>
                ))}
              </div>
            )}
            {cnjQuery.length >= 3 && !cnjLoading && cnjResults.length === 0 && (
              <p className="text-xs text-base-content/50 italic">Nenhum processo encontrado</p>
            )}
          </div>
        )}

        {/* Passo 2b: busca por cliente */}
        {mode === 'cliente' && !selectedCaseId && (
          <div className="p-6 space-y-3">
            <button onClick={() => setMode('choose')} className="text-xs text-base-content/60 hover:text-primary flex items-center gap-1">
              <ArrowLeft className="h-3 w-3" /> voltar
            </button>

            {!selectedLead ? (
              <>
                <label className="label text-sm">Buscar cliente</label>
                <div className="relative">
                  <input
                    type="text"
                    value={leadQuery}
                    onChange={(e) => setLeadQuery(e.target.value)}
                    placeholder="Nome ou telefone"
                    className="input input-bordered w-full pr-10"
                    autoFocus
                  />
                  {leadLoading && (
                    <Loader2 className="h-4 w-4 animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-base-content/50" />
                  )}
                </div>
                {leads.length > 0 && (
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {leads.map((l) => (
                      <button
                        key={l.id}
                        onClick={() => setSelectedLead(l)}
                        className="w-full text-left p-3 rounded-lg border border-border hover:border-primary/40 hover:bg-accent/20 transition"
                      >
                        <div className="font-medium text-sm">{l.name}</div>
                        <div className="text-xs text-base-content/60 mt-0.5">
                          {l.phone || 'sem telefone'}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <button onClick={() => { setSelectedLead(null); setLeads([]); }} className="text-xs text-base-content/60 hover:text-primary flex items-center gap-1">
                  <ArrowLeft className="h-3 w-3" /> trocar cliente
                </button>
                <div className="p-3 rounded-lg bg-primary/10 border border-primary/30">
                  <div className="text-sm font-medium">{selectedLead.name}</div>
                  <div className="text-xs text-base-content/60">{selectedLead.phone}</div>
                </div>
                <label className="label text-sm mt-3">Processos deste cliente</label>
                {leadCases.length === 0 ? (
                  <p className="text-xs text-base-content/50 italic">
                    Este cliente não tem processos. Volte e escolha outro ou use "Avulsa".
                  </p>
                ) : (
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {leadCases.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => pickCase(c)}
                        className="w-full text-left p-3 rounded-lg border border-border hover:border-primary/40 hover:bg-accent/20 transition"
                      >
                        <div className="flex items-center gap-2">
                          <Briefcase className="h-4 w-4 text-primary" />
                          <span className="font-mono text-sm">{c.case_number || '(sem número)'}</span>
                          {c.legal_area && (
                            <span className="text-xs bg-accent/30 rounded px-2 py-0.5">{c.legal_area}</span>
                          )}
                          <span className="text-xs text-base-content/40">{c.stage}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Passo 3: upload (comum a todos os modos) */}
        {(mode === 'avulsa' || selectedCaseId) && (
          <div className="p-6 space-y-4">
            {mode !== 'avulsa' && (
              <button onClick={() => { setSelectedCaseId(null); setSelectedCaseLabel(''); }} className="text-xs text-base-content/60 hover:text-primary flex items-center gap-1">
                <ArrowLeft className="h-3 w-3" /> trocar seleção
              </button>
            )}

            {selectedCaseId ? (
              <div className="p-3 rounded-lg bg-primary/10 border border-primary/30 flex items-center gap-2">
                <Check className="h-4 w-4 text-primary" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-base-content/60">Vinculada a:</div>
                  <div className="text-sm truncate">{selectedCaseLabel}</div>
                </div>
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-accent/20 border border-border flex items-center gap-2">
                <Unlink className="h-4 w-4 text-base-content/50" />
                <div className="text-sm text-base-content/60">Transcrição avulsa (sem processo)</div>
              </div>
            )}

            <div>
              <label className="label text-sm">Arquivo de vídeo ou áudio</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*,audio/*,.asf,.wmv,.mkv,.avi,.mov,.mp4,.webm,.mp3,.wav,.m4a,.ogg"
                className="file-input file-input-bordered w-full"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
              {file && (
                <p className="text-xs text-base-content/60 mt-2">
                  {file.name} — {(file.size / 1024 / 1024).toFixed(1)} MB
                </p>
              )}
              <p className="text-xs text-base-content/50 mt-2">
                Aceita: ASF, WMV, MP4, MKV, MOV, WEBM, MP3, WAV, M4A, OGG (até 3GB)
              </p>
            </div>

            {uploading && (
              <div className="w-full bg-accent/30 rounded-full h-2 overflow-hidden">
                <div className="bg-primary h-full transition-all" style={{ width: `${uploadProgress}%` }} />
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button onClick={onClose} className="btn btn-ghost btn-sm" disabled={uploading}>
                Cancelar
              </button>
              <button
                onClick={handleUpload}
                disabled={!file || uploading}
                className="btn btn-primary btn-sm gap-2"
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Enviando {uploadProgress}%
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" /> Enviar e transcrever
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
