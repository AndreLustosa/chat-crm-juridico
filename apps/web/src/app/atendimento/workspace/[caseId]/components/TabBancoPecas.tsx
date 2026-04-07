'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  BookOpen, Loader2, Plus, Search, FileSignature,
  ArrowLeft, Save, Trash2, Eye, Copy,
} from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';
import TiptapEditor from '@/components/TiptapEditor';

// ─── Types ───────────────────────────────────────────────

interface TemplateSummary {
  id: string;
  name: string;
  type: string;
  legal_area: string | null;
  description: string | null;
  variables: string[];
  is_global: boolean;
  usage_count: number;
  created_at: string;
  updated_at: string;
  created_by: { id: string; name: string } | null;
}

interface TemplateDetail {
  id: string;
  name: string;
  type: string;
  legal_area: string | null;
  content_json: any;
  variables: string[];
  description: string | null;
  is_global: boolean;
  usage_count: number;
  created_by: { id: string; name: string } | null;
}

const TYPES = ['INICIAL', 'CONTESTACAO', 'RECURSO', 'MANIFESTACAO', 'OUTRO'];
const LEGAL_AREAS = ['TRABALHISTA', 'CIVIL', 'PREVIDENCIARIO', 'PENAL', 'TRIBUTARIO', 'ADMINISTRATIVO'];

const TYPE_LABELS: Record<string, string> = {
  INICIAL: 'Peticao Inicial',
  CONTESTACAO: 'Contestacao',
  RECURSO: 'Recurso',
  MANIFESTACAO: 'Manifestacao',
  OUTRO: 'Outro',
};

const TYPE_COLORS: Record<string, string> = {
  INICIAL: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  CONTESTACAO: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  RECURSO: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
  MANIFESTACAO: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  OUTRO: 'bg-muted text-muted-foreground border-border',
};

const AREA_COLORS: Record<string, string> = {
  TRABALHISTA: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  CIVIL: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  PREVIDENCIARIO: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  PENAL: 'bg-red-500/10 text-red-400 border-red-500/20',
  TRIBUTARIO: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  ADMINISTRATIVO: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
};

// ─── Component ───────────────────────────────────────────

export default function TabBancoPecas({
  caseId,
  onUsePetition,
}: {
  caseId: string;
  onUsePetition?: (petitionId: string) => void;
}) {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterArea, setFilterArea] = useState('');
  const [viewingTemplate, setViewingTemplate] = useState<TemplateDetail | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<TemplateDetail | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [usingTemplate, setUsingTemplate] = useState<string | null>(null);

  // ─── Fetch ──────────────────────────────────────────────

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (filterType) params.type = filterType;
      if (filterArea) params.legal_area = filterArea;
      if (search) params.search = search;
      const res = await api.get('/legal-templates', { params });
      setTemplates(res.data || []);
    } catch {
      showError('Erro ao carregar templates');
    } finally {
      setLoading(false);
    }
  }, [filterType, filterArea, search]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  // ─── Use template ──────────────────────────────────────

  const handleUseTemplate = async (templateId: string, templateName: string) => {
    setUsingTemplate(templateId);
    try {
      const res = await api.post(`/petitions/case/${caseId}`, {
        title: templateName,
        type: 'INICIAL',
        template_id: templateId,
      });
      showSuccess('Peticao criada a partir do template');
      if (onUsePetition) {
        onUsePetition(res.data.id);
      }
    } catch {
      showError('Erro ao criar peticao');
    } finally {
      setUsingTemplate(null);
    }
  };

  // ─── View template ─────────────────────────────────────

  const openTemplate = async (id: string, mode: 'view' | 'edit') => {
    try {
      const res = await api.get(`/legal-templates/${id}`);
      if (mode === 'edit') {
        setEditingTemplate(res.data);
        setViewingTemplate(null);
      } else {
        setViewingTemplate(res.data);
        setEditingTemplate(null);
      }
    } catch {
      showError('Erro ao carregar template');
    }
  };

  const closeDetail = () => {
    setViewingTemplate(null);
    setEditingTemplate(null);
    fetchTemplates();
  };

  // ─── Edit / Create mode ─────────────────────────────────

  if (editingTemplate) {
    return (
      <TemplateEditorForm
        template={editingTemplate}
        onBack={closeDetail}
      />
    );
  }

  if (showCreate) {
    return (
      <TemplateEditorForm
        onBack={() => { setShowCreate(false); fetchTemplates(); }}
      />
    );
  }

  // ─── View mode ──────────────────────────────────────────

  if (viewingTemplate) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-5">
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          {/* Header */}
          <div className="px-5 py-3.5 border-b border-border bg-accent/20 flex items-center gap-3">
            <button
              onClick={closeDetail}
              className="flex items-center justify-center w-8 h-8 rounded-xl bg-accent/40 border border-border text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-all"
            >
              <ArrowLeft size={14} />
            </button>
            <h2 className="text-[13px] font-bold text-foreground flex items-center gap-2 flex-1">
              <Eye size={14} className="text-primary" />
              {viewingTemplate.name}
            </h2>
            <span className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border ${TYPE_COLORS[viewingTemplate.type] || TYPE_COLORS.OUTRO}`}>
              {TYPE_LABELS[viewingTemplate.type] || viewingTemplate.type}
            </span>
            {viewingTemplate.legal_area && (
              <span className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border ${AREA_COLORS[viewingTemplate.legal_area] || 'bg-muted text-muted-foreground border-border'}`}>
                {viewingTemplate.legal_area}
              </span>
            )}
          </div>

          <div className="p-5 space-y-4">
            {viewingTemplate.description && (
              <p className="text-[12px] text-muted-foreground leading-relaxed">{viewingTemplate.description}</p>
            )}

            {viewingTemplate.variables.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Variaveis:</span>
                {viewingTemplate.variables.map((v) => (
                  <span key={v} className="text-[10px] font-medium px-2 py-0.5 rounded-lg bg-accent/40 border border-border text-muted-foreground">{`{{${v}}}`}</span>
                ))}
              </div>
            )}

            <div className="rounded-xl border border-border overflow-hidden">
              <TiptapEditor
                initialContent={viewingTemplate.content_json}
                editable={false}
                placeholder=""
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => handleUseTemplate(viewingTemplate.id, viewingTemplate.name)}
                disabled={usingTemplate === viewingTemplate.id}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-[11px] font-bold hover:opacity-90 transition-opacity disabled:opacity-50 shadow-lg shadow-primary/20"
              >
                {usingTemplate === viewingTemplate.id ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Copy size={12} />
                )}
                Usar este template
              </button>
              {!viewingTemplate.is_global && (
                <button
                  onClick={() => openTemplate(viewingTemplate.id, 'edit')}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent/40 border border-border text-[11px] font-bold text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-all"
                >
                  <FileSignature size={12} /> Editar
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── List mode ──────────────────────────────────────────

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">

      {/* Header card */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border bg-accent/20 flex items-center justify-between">
          <h2 className="text-[13px] font-bold text-foreground flex items-center gap-2">
            <BookOpen size={14} className="text-primary" />
            Banco de Pecas
            {templates.length > 0 && (
              <span className="text-[10px] font-medium text-muted-foreground ml-1">({templates.length})</span>
            )}
          </h2>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-[11px] font-bold hover:opacity-90 transition-opacity shadow-lg shadow-primary/20"
          >
            <Plus size={12} /> Criar Template
          </button>
        </div>

        {/* Filters */}
        <div className="p-5 flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
            <input
              type="text"
              placeholder="Buscar template..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
            />
          </div>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all appearance-none cursor-pointer pr-8 bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23888%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_0.75rem_center]"
          >
            <option value="">Todos os tipos</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>{TYPE_LABELS[t]}</option>
            ))}
          </select>
          <select
            value={filterArea}
            onChange={(e) => setFilterArea(e.target.value)}
            className="px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all appearance-none cursor-pointer pr-8 bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23888%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_0.75rem_center]"
          >
            <option value="">Todas as areas</option>
            {LEGAL_AREAS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Templates grid */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : templates.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="text-center py-16 px-6">
            <BookOpen className="h-14 w-14 mx-auto mb-3 text-muted-foreground opacity-20" />
            <p className="text-[13px] font-bold text-foreground">Nenhum template encontrado</p>
            <p className="text-[11px] text-muted-foreground mt-1">Crie templates para agilizar a redacao de peticoes</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {templates.map((t) => (
            <div
              key={t.id}
              className="bg-card border border-border rounded-2xl overflow-hidden hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 transition-all"
            >
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[13px] font-bold text-foreground truncate">{t.name}</h3>
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                      <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-lg border ${TYPE_COLORS[t.type] || TYPE_COLORS.OUTRO}`}>
                        {TYPE_LABELS[t.type] || t.type}
                      </span>
                      {t.legal_area && (
                        <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-lg border ${AREA_COLORS[t.legal_area] || 'bg-muted text-muted-foreground border-border'}`}>
                          {t.legal_area}
                        </span>
                      )}
                      {t.is_global && (
                        <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-lg border bg-cyan-500/10 text-cyan-400 border-cyan-500/20">
                          Global
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-[10px] font-medium text-muted-foreground whitespace-nowrap shrink-0">
                    {t.usage_count}x usado
                  </span>
                </div>

                {t.description && (
                  <p className="text-[11px] text-muted-foreground mt-3 line-clamp-2 leading-relaxed">
                    {t.description}
                  </p>
                )}

                {t.variables.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-3">
                    {t.variables.slice(0, 4).map((v) => (
                      <span key={v} className="text-[10px] font-medium px-2 py-0.5 rounded-lg bg-accent/40 border border-border text-muted-foreground">{`{{${v}}}`}</span>
                    ))}
                    {t.variables.length > 4 && (
                      <span className="text-[10px] text-muted-foreground/60 self-center">
                        +{t.variables.length - 4}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="px-5 pb-4 flex gap-2">
                <button
                  onClick={() => handleUseTemplate(t.id, t.name)}
                  disabled={usingTemplate === t.id}
                  className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-[11px] font-bold hover:opacity-90 transition-opacity disabled:opacity-50 shadow-lg shadow-primary/20"
                >
                  {usingTemplate === t.id ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Copy size={12} />
                  )}
                  Usar
                </button>
                <button
                  onClick={() => openTemplate(t.id, 'view')}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent/40 border border-border text-[11px] font-bold text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-all"
                >
                  <Eye size={12} /> Ver
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Template Editor Form ─────────────────────────────────

function TemplateEditorForm({
  template,
  onBack,
}: {
  template?: TemplateDetail;
  onBack: () => void;
}) {
  const isNew = !template;
  const [name, setName] = useState(template?.name || '');
  const [type, setType] = useState(template?.type || 'INICIAL');
  const [legalArea, setLegalArea] = useState(template?.legal_area || '');
  const [description, setDescription] = useState(template?.description || '');
  const [variables, setVariables] = useState(template?.variables?.join(', ') || '');
  const [contentJson, setContentJson] = useState<any>(template?.content_json || null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) {
      showError('Informe o nome do template');
      return;
    }
    if (!contentJson) {
      showError('O template precisa ter conteudo');
      return;
    }

    setSaving(true);
    try {
      const variablesArr = variables
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);

      const body = {
        name,
        type,
        legal_area: legalArea || undefined,
        content_json: contentJson,
        variables: variablesArr,
        description: description || undefined,
      };

      if (isNew) {
        await api.post('/legal-templates', body);
        showSuccess('Template criado');
      } else {
        await api.patch(`/legal-templates/${template!.id}`, body);
        showSuccess('Template atualizado');
      }
      onBack();
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao salvar template');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!template) return;
    if (!confirm('Excluir este template?')) return;
    setDeleting(true);
    try {
      await api.delete(`/legal-templates/${template.id}?force=true`);
      showSuccess('Template excluido');
      onBack();
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao excluir');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-border bg-accent/20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="flex items-center justify-center w-8 h-8 rounded-xl bg-accent/40 border border-border text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-all"
            >
              <ArrowLeft size={14} />
            </button>
            <h2 className="text-[13px] font-bold text-foreground flex items-center gap-2">
              <FileSignature size={14} className="text-primary" />
              {isNew ? 'Criar Template' : 'Editar Template'}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {!isNew && (
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-[11px] font-bold text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
              >
                {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                Excluir
              </button>
            )}
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent/40 border border-border text-[11px] font-bold text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-all"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-[11px] font-bold hover:opacity-90 transition-opacity disabled:opacity-50 shadow-lg shadow-primary/20"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {isNew ? 'Criar Template' : 'Salvar'}
            </button>
          </div>
        </div>

        {/* Form fields */}
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              Nome
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Peticao Inicial Trabalhista"
              className="w-full px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1 space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Tipo
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all appearance-none cursor-pointer pr-8 bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23888%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_0.75rem_center]"
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Area Juridica
              </label>
              <select
                value={legalArea}
                onChange={(e) => setLegalArea(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all appearance-none cursor-pointer pr-8 bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23888%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_0.75rem_center]"
              >
                <option value="">Selecione...</option>
                {LEGAL_AREAS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              Descricao
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Breve descricao do template"
              className="w-full px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              Variaveis <span className="font-normal normal-case tracking-normal text-muted-foreground/50">(separadas por virgula)</span>
            </label>
            <input
              type="text"
              value={variables}
              onChange={(e) => setVariables(e.target.value)}
              placeholder="nome_cliente, cpf, empregador"
              className="w-full px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
            />
          </div>
        </div>
      </div>

      {/* Editor card */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border bg-accent/20">
          <h2 className="text-[13px] font-bold text-foreground flex items-center gap-2">
            <BookOpen size={14} className="text-primary" />
            Conteudo do Template
          </h2>
        </div>
        <div className="p-5">
          <TiptapEditor
            initialContent={contentJson}
            onChange={(json) => setContentJson(json)}
            placeholder="Escreva o conteudo do template. Use {{variavel}} para criar placeholders..."
          />
        </div>
      </div>
    </div>
  );
}
