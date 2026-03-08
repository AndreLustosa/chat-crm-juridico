'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FileSignature, Loader2, Plus, ArrowLeft, Save, Clock,
  ChevronDown, Trash2,
} from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';
import TiptapEditor from '@/components/TiptapEditor';

// ─── Types ───────────────────────────────────────────────

interface PetitionSummary {
  id: string;
  title: string;
  type: string;
  status: string;
  template_id: string | null;
  created_at: string;
  updated_at: string;
  created_by: { id: string; name: string };
  _count: { versions: number };
}

interface PetitionDetail {
  id: string;
  title: string;
  type: string;
  status: string;
  content_json: any;
  content_html: string | null;
  template_id: string | null;
  created_at: string;
  updated_at: string;
  created_by: { id: string; name: string };
  template: { id: string; name: string } | null;
  _count: { versions: number };
}

interface PetitionVersionItem {
  id: string;
  version: number;
  created_at: string;
  saved_by: { id: string; name: string };
}

const TYPES = [
  'INICIAL', 'CONTESTACAO', 'REPLICA', 'EMBARGOS',
  'RECURSO', 'MANIFESTACAO', 'OUTRO',
];

const TYPE_LABELS: Record<string, string> = {
  INICIAL: 'Petição Inicial',
  CONTESTACAO: 'Contestação',
  REPLICA: 'Réplica',
  EMBARGOS: 'Embargos',
  RECURSO: 'Recurso',
  MANIFESTACAO: 'Manifestação',
  OUTRO: 'Outro',
};

const STATUS_LABELS: Record<string, string> = {
  RASCUNHO: 'Rascunho',
  EM_REVISAO: 'Em Revisão',
  APROVADA: 'Aprovada',
  PROTOCOLADA: 'Protocolada',
};

const STATUS_COLORS: Record<string, string> = {
  RASCUNHO: 'badge-ghost',
  EM_REVISAO: 'badge-warning',
  APROVADA: 'badge-success',
  PROTOCOLADA: 'badge-info',
};

function formatDate(d: string) {
  return new Date(d).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

// ─── Component ───────────────────────────────────────────

export default function TabPeticoes({ caseId }: { caseId: string }) {
  const [petitions, setPetitions] = useState<PetitionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingPetition, setEditingPetition] = useState<PetitionDetail | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // ─── List ────────────────────────────────────────────────

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/petitions/case/${caseId}`);
      setPetitions(res.data || []);
    } catch {
      showError('Erro ao carregar petições');
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  // ─── Open petition ──────────────────────────────────────

  const openPetition = async (id: string) => {
    try {
      const res = await api.get(`/petitions/${id}`);
      setEditingPetition(res.data);
    } catch {
      showError('Erro ao abrir petição');
    }
  };

  const closePetition = () => {
    setEditingPetition(null);
    fetchList();
  };

  // ─── Create modal state ──────────────────────────────────

  if (editingPetition) {
    return (
      <PetitionEditor
        petition={editingPetition}
        onBack={closePetition}
      />
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <FileSignature className="h-4 w-4 text-primary" />
          Petições
          {petitions.length > 0 && (
            <span className="text-xs text-base-content/50">({petitions.length})</span>
          )}
        </h2>
        <button
          onClick={() => setShowCreate(true)}
          className="btn btn-primary btn-sm gap-1"
        >
          <Plus className="h-3.5 w-3.5" /> Nova Petição
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <CreatePetitionForm
          caseId={caseId}
          onCreated={(id) => {
            setShowCreate(false);
            openPetition(id);
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : petitions.length === 0 ? (
        <div className="text-center py-12 text-base-content/50">
          <FileSignature className="h-12 w-12 mx-auto mb-2 opacity-30" />
          <p>Nenhuma petição criada</p>
          <p className="text-xs mt-1">Clique em &quot;Nova Petição&quot; para começar</p>
        </div>
      ) : (
        <div className="space-y-2">
          {petitions.map((p) => (
            <button
              key={p.id}
              onClick={() => openPetition(p.id)}
              className="w-full text-left rounded-lg border border-base-300 p-3 hover:bg-base-200/50 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <FileSignature className="h-4 w-4 text-primary shrink-0" />
                  <span className="font-medium text-sm truncate">{p.title}</span>
                  <span className="badge badge-xs badge-outline shrink-0">
                    {TYPE_LABELS[p.type] || p.type}
                  </span>
                </div>
                <span className={`badge badge-xs ${STATUS_COLORS[p.status] || ''} shrink-0`}>
                  {STATUS_LABELS[p.status] || p.status}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-base-content/50">
                <span>Por: {p.created_by.name}</span>
                <span>Atualizado: {formatDate(p.updated_at)}</span>
                {p._count.versions > 0 && (
                  <span className="flex items-center gap-0.5">
                    <Clock className="h-3 w-3" /> {p._count.versions} versões
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Create Form ─────────────────────────────────────────

function CreatePetitionForm({
  caseId,
  onCreated,
  onCancel,
}: {
  caseId: string;
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState('INICIAL');
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!title.trim()) {
      showError('Informe o título da petição');
      return;
    }
    setSaving(true);
    try {
      const res = await api.post(`/petitions/case/${caseId}`, { title, type });
      showSuccess('Petição criada');
      onCreated(res.data.id);
    } catch {
      showError('Erro ao criar petição');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-primary/30 bg-base-200/50 p-4 space-y-3">
      <h3 className="text-sm font-semibold">Nova Petição</h3>
      <div className="flex gap-3">
        <input
          type="text"
          placeholder="Título da petição..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="input input-bordered input-sm flex-1"
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="select select-bordered select-sm w-40"
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>{TYPE_LABELS[t]}</option>
          ))}
        </select>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn btn-ghost btn-sm">
          Cancelar
        </button>
        <button
          onClick={handleCreate}
          disabled={saving}
          className="btn btn-primary btn-sm gap-1"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Criar
        </button>
      </div>
    </div>
  );
}

// ─── Petition Editor ─────────────────────────────────────

function PetitionEditor({
  petition,
  onBack,
}: {
  petition: PetitionDetail;
  onBack: () => void;
}) {
  const [status, setStatus] = useState(petition.status);
  const [title, setTitle] = useState(petition.title);
  const [saving, setSaving] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'saved' | 'saving' | 'idle'>('idle');
  const [versions, setVersions] = useState<PetitionVersionItem[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [savingVersion, setSavingVersion] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestContentRef = useRef<{ json: any; html: string } | null>(null);

  const isEditable = status === 'RASCUNHO' || status === 'EM_REVISAO';

  // ─── Auto-save ──────────────────────────────────────────

  const doAutoSave = useCallback(async (json: any, html: string) => {
    setAutoSaveStatus('saving');
    try {
      await api.patch(`/petitions/${petition.id}`, {
        content_json: json,
        content_html: html,
      });
      setAutoSaveStatus('saved');
    } catch {
      setAutoSaveStatus('idle');
    }
  }, [petition.id]);

  const handleEditorChange = useCallback((json: any, html: string) => {
    latestContentRef.current = { json, html };
    setAutoSaveStatus('idle');

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      doAutoSave(json, html);
    }, 2000);
  }, [doAutoSave]);

  // Cleanup debounce
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // ─── Status change ────────────────────────────────────────

  const handleStatusChange = async (newStatus: string) => {
    setSaving(true);
    try {
      await api.patch(`/petitions/${petition.id}/status`, { status: newStatus });
      setStatus(newStatus);
      showSuccess(`Status alterado para ${STATUS_LABELS[newStatus]}`);
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao alterar status');
    } finally {
      setSaving(false);
    }
  };

  // ─── Title save ────────────────────────────────────────────

  const handleTitleSave = async () => {
    if (!title.trim() || title === petition.title) return;
    try {
      await api.patch(`/petitions/${petition.id}`, { title });
      showSuccess('Título salvo');
    } catch {
      showError('Erro ao salvar título');
    }
  };

  // ─── Version ──────────────────────────────────────────────

  const handleSaveVersion = async () => {
    setSavingVersion(true);
    try {
      await api.post(`/petitions/${petition.id}/version`);
      showSuccess('Versão salva');
      loadVersions();
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao salvar versão');
    } finally {
      setSavingVersion(false);
    }
  };

  const loadVersions = async () => {
    try {
      const res = await api.get(`/petitions/${petition.id}/versions`);
      setVersions(res.data || []);
    } catch {
      // silent
    }
  };

  useEffect(() => {
    if (showVersions) loadVersions();
  }, [showVersions]);

  // ─── Delete ────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!confirm('Tem certeza que deseja excluir esta petição?')) return;
    setDeleting(true);
    try {
      await api.delete(`/petitions/${petition.id}`);
      showSuccess('Petição excluída');
      onBack();
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao excluir');
    } finally {
      setDeleting(false);
    }
  };

  // ─── Status transitions ────────────────────────────────────

  const transitions: Record<string, string[]> = {
    RASCUNHO: ['EM_REVISAO'],
    EM_REVISAO: ['RASCUNHO', 'APROVADA'],
    APROVADA: ['EM_REVISAO', 'PROTOCOLADA'],
    PROTOCOLADA: [],
  };

  const allowedTransitions = transitions[status] || [];

  return (
    <div className="flex flex-col h-full">
      {/* Editor header */}
      <div className="flex items-center gap-3 border-b border-base-300 bg-base-200/30 px-4 py-2">
        <button
          onClick={onBack}
          className="btn btn-ghost btn-sm btn-circle"
          title="Voltar à lista"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>

        {/* Title */}
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleTitleSave}
          className="input input-ghost input-sm font-semibold flex-1 min-w-0"
          disabled={!isEditable}
        />

        {/* Type badge */}
        <span className="badge badge-xs badge-outline shrink-0">
          {TYPE_LABELS[petition.type] || petition.type}
        </span>

        {/* Status badge */}
        <span className={`badge badge-sm ${STATUS_COLORS[status] || ''} shrink-0`}>
          {STATUS_LABELS[status] || status}
        </span>

        {/* Auto-save indicator */}
        {autoSaveStatus === 'saving' && (
          <span className="text-xs text-base-content/40 flex items-center gap-1 shrink-0">
            <Loader2 className="h-3 w-3 animate-spin" /> Salvando...
          </span>
        )}
        {autoSaveStatus === 'saved' && (
          <span className="text-xs text-success/60 shrink-0">Salvo</span>
        )}
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-2 border-b border-base-300 bg-base-100 px-4 py-1.5">
        {/* Save version */}
        <button
          onClick={handleSaveVersion}
          disabled={savingVersion}
          className="btn btn-ghost btn-xs gap-1"
          title="Salvar versão (snapshot)"
        >
          {savingVersion ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Salvar versão
        </button>

        {/* View versions */}
        <button
          onClick={() => setShowVersions(!showVersions)}
          className="btn btn-ghost btn-xs gap-1"
        >
          <Clock className="h-3 w-3" />
          Versões ({petition._count.versions})
          <ChevronDown className={`h-3 w-3 transition-transform ${showVersions ? 'rotate-180' : ''}`} />
        </button>

        <div className="flex-1" />

        {/* Status transitions */}
        {allowedTransitions.map((newStatus) => (
          <button
            key={newStatus}
            onClick={() => handleStatusChange(newStatus)}
            disabled={saving}
            className="btn btn-outline btn-xs"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {STATUS_LABELS[newStatus]}
          </button>
        ))}

        {/* Delete (only drafts) */}
        {status === 'RASCUNHO' && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="btn btn-ghost btn-xs text-error"
            title="Excluir petição"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Versions panel */}
      {showVersions && (
        <div className="border-b border-base-300 bg-base-200/30 px-4 py-2 max-h-40 overflow-y-auto">
          {versions.length === 0 ? (
            <p className="text-xs text-base-content/50">Nenhuma versão salva</p>
          ) : (
            <div className="space-y-1">
              {versions.map((v) => (
                <div key={v.id} className="flex items-center justify-between text-xs">
                  <span className="font-medium">v{v.version}</span>
                  <span className="text-base-content/50">{v.saved_by.name}</span>
                  <span className="text-base-content/40">{formatDate(v.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Editor */}
      <div className="flex-1 overflow-y-auto p-4">
        <TiptapEditor
          initialContent={petition.content_json}
          onChange={handleEditorChange}
          editable={isEditable}
          placeholder="Comece a redigir sua petição..."
        />
      </div>
    </div>
  );
}
