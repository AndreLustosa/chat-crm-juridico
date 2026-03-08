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
  INICIAL: 'Petição Inicial',
  CONTESTACAO: 'Contestação',
  RECURSO: 'Recurso',
  MANIFESTACAO: 'Manifestação',
  OUTRO: 'Outro',
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
      showSuccess('Petição criada a partir do template');
      if (onUsePetition) {
        onUsePetition(res.data.id);
      }
    } catch {
      showError('Erro ao criar petição');
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
      <div className="p-6 max-w-4xl mx-auto space-y-4">
        <div className="flex items-center gap-3">
          <button
            onClick={closeDetail}
            className="btn btn-ghost btn-sm btn-circle"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h2 className="text-base font-semibold flex-1">{viewingTemplate.name}</h2>
          <span className="badge badge-xs badge-outline">
            {TYPE_LABELS[viewingTemplate.type] || viewingTemplate.type}
          </span>
          {viewingTemplate.legal_area && (
            <span className="badge badge-xs badge-primary">
              {viewingTemplate.legal_area}
            </span>
          )}
        </div>

        {viewingTemplate.description && (
          <p className="text-sm text-base-content/60">{viewingTemplate.description}</p>
        )}

        {viewingTemplate.variables.length > 0 && (
          <div className="flex flex-wrap gap-1">
            <span className="text-xs text-base-content/50">Variáveis:</span>
            {viewingTemplate.variables.map((v) => (
              <span key={v} className="badge badge-xs badge-ghost">{`{{${v}}}`}</span>
            ))}
          </div>
        )}

        <TiptapEditor
          initialContent={viewingTemplate.content_json}
          editable={false}
          placeholder=""
        />

        <div className="flex gap-2 pt-2">
          <button
            onClick={() => handleUseTemplate(viewingTemplate.id, viewingTemplate.name)}
            disabled={usingTemplate === viewingTemplate.id}
            className="btn btn-primary btn-sm gap-1"
          >
            {usingTemplate === viewingTemplate.id ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            Usar este template
          </button>
          {!viewingTemplate.is_global && (
            <button
              onClick={() => openTemplate(viewingTemplate.id, 'edit')}
              className="btn btn-ghost btn-sm gap-1"
            >
              <FileSignature className="h-3.5 w-3.5" /> Editar
            </button>
          )}
        </div>
      </div>
    );
  }

  // ─── List mode ──────────────────────────────────────────

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-primary" />
          Banco de Peças
          {templates.length > 0 && (
            <span className="text-xs text-base-content/50">({templates.length})</span>
          )}
        </h2>
        <button
          onClick={() => setShowCreate(true)}
          className="btn btn-primary btn-sm gap-1"
        >
          <Plus className="h-3.5 w-3.5" /> Criar Template
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-base-content/40" />
          <input
            type="text"
            placeholder="Buscar template..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input input-bordered input-sm w-full pl-9"
          />
        </div>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="select select-bordered select-sm"
        >
          <option value="">Todos os tipos</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>{TYPE_LABELS[t]}</option>
          ))}
        </select>
        <select
          value={filterArea}
          onChange={(e) => setFilterArea(e.target.value)}
          className="select select-bordered select-sm"
        >
          <option value="">Todas as áreas</option>
          {LEGAL_AREAS.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>

      {/* Templates grid */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : templates.length === 0 ? (
        <div className="text-center py-12 text-base-content/50">
          <BookOpen className="h-12 w-12 mx-auto mb-2 opacity-30" />
          <p>Nenhum template encontrado</p>
          <p className="text-xs mt-1">Crie templates para agilizar a redação de petições</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {templates.map((t) => (
            <div
              key={t.id}
              className="rounded-lg border border-base-300 p-4 hover:border-primary/40 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="font-medium text-sm truncate">{t.name}</h3>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <span className="badge badge-xs badge-outline">
                      {TYPE_LABELS[t.type] || t.type}
                    </span>
                    {t.legal_area && (
                      <span className="badge badge-xs badge-primary">{t.legal_area}</span>
                    )}
                    {t.is_global && (
                      <span className="badge badge-xs badge-info">Global</span>
                    )}
                  </div>
                </div>
                <span className="text-xs text-base-content/40 whitespace-nowrap">
                  {t.usage_count}x usado
                </span>
              </div>

              {t.description && (
                <p className="text-xs text-base-content/50 mt-2 line-clamp-2">
                  {t.description}
                </p>
              )}

              {t.variables.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {t.variables.slice(0, 4).map((v) => (
                    <span key={v} className="badge badge-xs badge-ghost">{`{{${v}}}`}</span>
                  ))}
                  {t.variables.length > 4 && (
                    <span className="text-xs text-base-content/40">
                      +{t.variables.length - 4}
                    </span>
                  )}
                </div>
              )}

              <div className="flex gap-1.5 mt-3">
                <button
                  onClick={() => handleUseTemplate(t.id, t.name)}
                  disabled={usingTemplate === t.id}
                  className="btn btn-primary btn-xs gap-1 flex-1"
                >
                  {usingTemplate === t.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  Usar
                </button>
                <button
                  onClick={() => openTemplate(t.id, 'view')}
                  className="btn btn-ghost btn-xs gap-1"
                >
                  <Eye className="h-3 w-3" /> Ver
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
      showError('O template precisa ter conteúdo');
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
      showSuccess('Template excluído');
      onBack();
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao excluir');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="btn btn-ghost btn-sm btn-circle">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h2 className="text-base font-semibold">
          {isNew ? 'Criar Template' : 'Editar Template'}
        </h2>
      </div>

      {/* Form fields */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="label label-text text-xs">Nome</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input input-bordered input-sm w-full"
            placeholder="Ex: Petição Inicial Trabalhista"
          />
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="label label-text text-xs">Tipo</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="select select-bordered select-sm w-full"
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>{TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="label label-text text-xs">Área Jurídica</label>
            <select
              value={legalArea}
              onChange={(e) => setLegalArea(e.target.value)}
              className="select select-bordered select-sm w-full"
            >
              <option value="">Selecione...</option>
              {LEGAL_AREAS.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="label label-text text-xs">Descrição</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input input-bordered input-sm w-full"
            placeholder="Breve descrição do template"
          />
        </div>
        <div>
          <label className="label label-text text-xs">
            Variáveis <span className="text-base-content/40">(separadas por vírgula)</span>
          </label>
          <input
            type="text"
            value={variables}
            onChange={(e) => setVariables(e.target.value)}
            className="input input-bordered input-sm w-full"
            placeholder="nome_cliente, cpf, empregador"
          />
        </div>
      </div>

      {/* Editor */}
      <div>
        <label className="label label-text text-xs">Conteúdo do Template</label>
        <TiptapEditor
          initialContent={contentJson}
          onChange={(json) => setContentJson(json)}
          placeholder="Escreva o conteúdo do template. Use {{variavel}} para criar placeholders..."
        />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-2">
        <div>
          {!isNew && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="btn btn-ghost btn-sm text-error gap-1"
            >
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Excluir
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={onBack} className="btn btn-ghost btn-sm">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn btn-primary btn-sm gap-1"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {isNew ? 'Criar Template' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}
