'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Brain,
  MapPin,
  Users,
  DollarSign,
  ClipboardList,
  Scale,
  BookOpen,
  Phone,
  ShieldAlert,
  Layers,
  Plus,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronRight,
  Search,
  Play,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  RefreshCw,
  Save,
  X,
  Lock,
  RotateCcw,
  Settings,
  Cpu,
  FileCode2,
} from 'lucide-react';
import api from '@/lib/api';

const SUBCATEGORIES: Array<{
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  hint: string;
}> = [
  { key: 'office_info', label: 'Escritório', icon: MapPin, hint: 'Endereço, telefone, horário' },
  { key: 'team', label: 'Equipe', icon: Users, hint: 'Advogados e especialidades' },
  { key: 'fees', label: 'Honorários', icon: DollarSign, hint: 'Tabelas, formas de pagamento' },
  { key: 'procedures', label: 'Procedimentos', icon: ClipboardList, hint: 'Documentos, fluxo de atendimento' },
  { key: 'court_info', label: 'Fóruns e Varas', icon: Scale, hint: 'Endereços, tendências de juízes' },
  { key: 'legal_knowledge', label: 'Conhecimento Local', icon: BookOpen, hint: 'Prazos típicos, jurisprudência local' },
  { key: 'contacts', label: 'Contatos Úteis', icon: Phone, hint: 'Peritos, parceiros, terceiros' },
  { key: 'rules', label: 'Regras', icon: ShieldAlert, hint: 'O que aceitamos/não aceitamos' },
  // Bug 8 fix: categoria fallback pra memorias com subcategory=null/geral.
  // Antes ficavam orfas — extraidas pelo LLM mas invisiveis na UI.
  { key: 'geral', label: 'Outros / Geral', icon: BookOpen, hint: 'Memórias sem categoria específica' },
];

interface MemoryItem {
  id: string;
  content: string;
  subcategory: string | null;
  confidence: number;
  source_type: string;
  created_at: string;
  updated_at: string;
}

interface OrgMemoriesResponse {
  groups: Record<string, MemoryItem[]>;
  total: number;
}

interface OrgStats {
  total: number;
  by_subcategory: Record<string, number>;
  last_extraction: string | null;
}

interface OrgProfile {
  id: string;
  summary: string;
  facts: any;
  source_memory_count: number;
  generated_at: string;
  version: number;
  manually_edited_at: string | null;
}

interface ModelOption {
  value: string;
  label: string;
}

interface OrgProfileSettings {
  model: string;
  model_default: string;
  available_models: ModelOption[];
  incremental_prompt: string;
  incremental_prompt_default: string;
  incremental_is_custom: boolean;
  rebuild_prompt: string;
  rebuild_prompt_default: string;
  rebuild_is_custom: boolean;
}

function formatSourceLabel(src: string): string {
  switch (src) {
    case 'batch':
      return 'Extração automática';
    case 'manual':
      return 'Adicionada manualmente';
    case 'retroactive':
      return 'Extração retroativa';
    default:
      return src;
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Maceio',
    });
  } catch {
    return iso;
  }
}

export default function KnowledgeSettingsPage() {
  const [groups, setGroups] = useState<Record<string, MemoryItem[]>>({});
  const [stats, setStats] = useState<OrgStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    office_info: true,
    team: true,
  });
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState<{ subcategory: string } | null>(null);
  const [editing, setEditing] = useState<MemoryItem | null>(null);
  const [newContent, setNewContent] = useState('');
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [batchEnabled, setBatchEnabled] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'ok' | 'err' } | null>(null);
  const [orgProfile, setOrgProfile] = useState<OrgProfile | null>(null);
  const [profileOpen, setProfileOpen] = useState(true);
  const [regeneratingProfile, setRegeneratingProfile] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [editProfileContent, setEditProfileContent] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [rebuildingProfile, setRebuildingProfile] = useState(false);

  // Configuracoes avancadas (modelo + prompts)
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [settings, setSettings] = useState<OrgProfileSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [editModel, setEditModel] = useState('');
  const [editIncremental, setEditIncremental] = useState('');
  const [editRebuild, setEditRebuild] = useState('');
  const [activePromptTab, setActivePromptTab] = useState<'incremental' | 'rebuild'>('incremental');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [memsRes, statsRes, settingsRes, profileRes] = await Promise.all([
        api.get<OrgMemoriesResponse>('/memories/organization'),
        api.get<OrgStats>('/memories/organization/stats'),
        api.get('/settings'),
        api.get<OrgProfile | null>('/memories/organization/profile'),
      ]);
      setGroups(memsRes.data.groups || {});
      setStats(statsRes.data);
      setOrgProfile(profileRes.data);
      const rows = Array.isArray(settingsRes.data) ? settingsRes.data : [];
      const flag = rows.find((r: any) => r?.key === 'MEMORY_BATCH_ENABLED');
      setBatchEnabled((flag?.value ?? 'true').toLowerCase() !== 'false');
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleGroup = (key: string) =>
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));

  const filteredGroups = useMemo(() => {
    if (!search.trim()) return groups;
    const q = search.trim().toLowerCase();
    const out: Record<string, MemoryItem[]> = {};
    for (const [k, items] of Object.entries(groups)) {
      const filtered = items.filter((m) => m.content.toLowerCase().includes(q));
      if (filtered.length > 0) out[k] = filtered;
    }
    return out;
  }, [groups, search]);

  const showFeedback = (text: string, type: 'ok' | 'err' = 'ok') => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 4000);
  };

  const handleAdd = async () => {
    if (!adding) return;
    const content = newContent.trim();
    if (content.length < 5) {
      showFeedback('Conteúdo muito curto (mín. 5 caracteres)', 'err');
      return;
    }
    setSaving(true);
    try {
      await api.post('/memories/organization', {
        content,
        subcategory: adding.subcategory,
      });
      setNewContent('');
      setAdding(null);
      await loadData();
      showFeedback('Memória adicionada');
    } catch (e: any) {
      showFeedback(e?.response?.data?.message || 'Erro ao adicionar', 'err');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!editing) return;
    const content = editContent.trim();
    if (content.length < 5) {
      showFeedback('Conteúdo muito curto', 'err');
      return;
    }
    setSaving(true);
    try {
      await api.put(`/memories/${editing.id}`, { content });
      setEditing(null);
      setEditContent('');
      await loadData();
      showFeedback('Memória atualizada');
    } catch (e: any) {
      showFeedback(e?.response?.data?.message || 'Erro ao atualizar', 'err');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remover esta memória? A IA deixa de usá-la.')) return;
    try {
      await api.delete(`/memories/${id}`);
      await loadData();
      showFeedback('Memória removida');
    } catch (e: any) {
      showFeedback(e?.response?.data?.message || 'Erro ao remover', 'err');
    }
  };

  const handleToggleBatch = async (next: boolean) => {
    try {
      await api.put('/settings', {
        key: 'MEMORY_BATCH_ENABLED',
        value: next ? 'true' : 'false',
      });
      setBatchEnabled(next);
      showFeedback(next ? 'Extração diária ativada' : 'Extração diária desativada');
    } catch (e: any) {
      showFeedback(e?.response?.data?.message || 'Erro ao salvar', 'err');
    }
  };

  const handleExtractNow = async () => {
    setExtracting(true);
    try {
      await api.post('/memories/extract-now');
      showFeedback('Extração disparada — resultado em alguns minutos');
    } catch (e: any) {
      showFeedback(e?.response?.data?.message || 'Erro ao extrair', 'err');
    } finally {
      setExtracting(false);
    }
  };

  const handleRegenerateProfile = async () => {
    // Se tem edição manual, confirma antes de sobrescrever
    if (orgProfile?.manually_edited_at) {
      const ok = confirm(
        'Este perfil tem edição manual salva. A atualização incremental pode ajustar seu texto com memórias novas. Continuar?',
      );
      if (!ok) return;
    }
    setRegeneratingProfile(true);
    try {
      await api.post('/memories/organization/regenerate-profile');
      showFeedback('Atualização incremental disparada — atualiza em ~1 minuto');
      setTimeout(() => loadData(), 8000);
    } catch (e: any) {
      showFeedback(e?.response?.data?.message || 'Erro ao regenerar', 'err');
    } finally {
      setRegeneratingProfile(false);
    }
  };

  const handleRebuildProfile = async () => {
    const ok = confirm(
      'REFAZER DO ZERO vai DESCARTAR o texto atual (incluindo edições manuais) e gerar um resumo completamente novo a partir de todas as memórias. Use apenas quando o texto atual acumulou problemas ou ficou muito desatualizado.\n\nContinuar?',
    );
    if (!ok) return;
    setRebuildingProfile(true);
    try {
      await api.post('/memories/organization/rebuild-profile');
      showFeedback('Reconstrução disparada — atualiza em ~1 minuto');
      setTimeout(() => loadData(), 8000);
    } catch (e: any) {
      showFeedback(e?.response?.data?.message || 'Erro ao refazer', 'err');
    } finally {
      setRebuildingProfile(false);
    }
  };

  // ─── Configurações avançadas ──────────────────────────────────────

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const res = await api.get<OrgProfileSettings>('/memories/organization/settings');
      setSettings(res.data);
      setEditModel(res.data.model);
      setEditIncremental(res.data.incremental_is_custom ? res.data.incremental_prompt : '');
      setEditRebuild(res.data.rebuild_is_custom ? res.data.rebuild_prompt : '');
    } catch (e: any) {
      showFeedback(e?.response?.data?.message || 'Erro ao carregar configurações', 'err');
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (advancedOpen && !settings) loadSettings();
  }, [advancedOpen, settings, loadSettings]);

  const handleSaveSettings = async () => {
    if (!settings) return;
    setSettingsSaving(true);
    try {
      const payload: any = {};
      if (editModel !== settings.model) payload.model = editModel;
      // Compara contra o valor atual (pode ser string vazia se está usando default)
      const currentIncremental = settings.incremental_is_custom ? settings.incremental_prompt : '';
      if (editIncremental !== currentIncremental) payload.incremental_prompt = editIncremental;
      const currentRebuild = settings.rebuild_is_custom ? settings.rebuild_prompt : '';
      if (editRebuild !== currentRebuild) payload.rebuild_prompt = editRebuild;

      if (Object.keys(payload).length === 0) {
        showFeedback('Nenhuma alteração a salvar', 'err');
        return;
      }
      const res = await api.put<OrgProfileSettings>('/memories/organization/settings', payload);
      setSettings(res.data);
      setEditModel(res.data.model);
      setEditIncremental(res.data.incremental_is_custom ? res.data.incremental_prompt : '');
      setEditRebuild(res.data.rebuild_is_custom ? res.data.rebuild_prompt : '');
      showFeedback('Configurações salvas');
    } catch (e: any) {
      showFeedback(e?.response?.data?.message || 'Erro ao salvar', 'err');
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleResetPrompt = (which: 'incremental' | 'rebuild') => {
    const name = which === 'incremental' ? 'incremental' : 'Refazer do zero';
    const ok = confirm(`Restaurar o prompt "${name}" para o padrão do sistema? Sua customização será perdida.`);
    if (!ok) return;
    if (which === 'incremental') setEditIncremental('');
    else setEditRebuild('');
  };

  const handleLoadDefaultPrompt = (which: 'incremental' | 'rebuild') => {
    if (!settings) return;
    if (which === 'incremental') setEditIncremental(settings.incremental_prompt_default);
    else setEditRebuild(settings.rebuild_prompt_default);
  };

  const handleStartEditProfile = () => {
    if (!orgProfile) return;
    setEditProfileContent(orgProfile.summary);
    setEditingProfile(true);
  };

  const handleCancelEditProfile = () => {
    setEditingProfile(false);
    setEditProfileContent('');
  };

  const handleSaveProfile = async () => {
    const summary = editProfileContent.trim();
    if (summary.length < 50) {
      showFeedback('Resumo muito curto (mín. 50 caracteres)', 'err');
      return;
    }
    setSavingProfile(true);
    try {
      await api.put('/memories/organization/profile', { summary });
      setEditingProfile(false);
      setEditProfileContent('');
      await loadData();
      showFeedback('Resumo atualizado — cron automático não vai mais sobrescrever');
    } catch (e: any) {
      showFeedback(e?.response?.data?.message || 'Erro ao salvar', 'err');
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Brain className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">Base de Conhecimento do Escritório</h1>
            <p className="text-sm text-muted-foreground">
              Informações que a IA usa em <strong>todos</strong> os atendimentos.
            </p>
          </div>
        </div>
      </div>

      {/* Control bar: toggle + extract now */}
      <div className="bg-card border border-border rounded-xl p-4 mb-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Layers className="w-4 h-4 text-muted-foreground" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Extração diária de novos fatos</span>
              <button
                onClick={() => handleToggleBatch(!batchEnabled)}
                className={`relative w-10 h-5 rounded-full transition-colors ${
                  batchEnabled ? 'bg-primary' : 'bg-muted'
                }`}
                aria-label="Alternar extração diária"
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                    batchEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Toda noite à meia-noite, varre as conversas do dia e extrai novos fatos do escritório
              (memórias atômicas abaixo).
              <br />
              <span className="opacity-70">
                A consolidação do <em>Resumo</em> roda separadamente às 02h e respeita edições manuais.
              </span>
            </p>
          </div>
        </div>
        <button
          onClick={handleExtractNow}
          disabled={extracting}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
        >
          {extracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          Rodar extração agora
        </button>
      </div>

      {/* Profile consolidado card */}
      <div className="bg-gradient-to-br from-primary/5 via-card to-card border border-primary/20 rounded-xl mb-4 overflow-hidden">
        <div className="flex items-center">
          <button
            onClick={() => !editingProfile && setProfileOpen(!profileOpen)}
            disabled={editingProfile}
            className="flex-1 px-4 py-3 flex items-center gap-3 hover:bg-foreground/[0.03] transition-colors text-left disabled:cursor-default"
          >
            <Sparkles className="w-4 h-4 text-primary" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold">Resumo Consolidado do Escritório</span>
                {orgProfile && (
                  <span className="text-[10px] text-muted-foreground font-mono">
                    v{orgProfile.version}
                  </span>
                )}
                {orgProfile?.manually_edited_at && (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full"
                    title="Este perfil foi editado manualmente — cron automático NÃO vai sobrescrever"
                  >
                    <Lock className="w-2.5 h-2.5" />
                    editado manualmente
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {orgProfile
                  ? `Atualiza cirurgicamente toda noite com mudanças nas ${orgProfile.source_memory_count} memórias — injetado em {{office_memories}} no prompt da IA`
                  : 'Ainda não foi gerado. A IA está usando as memórias cruas agrupadas.'}
              </p>
            </div>
            {!editingProfile && (
              profileOpen ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              )
            )}
          </button>
          {!editingProfile && orgProfile && (
            <button
              onClick={handleStartEditProfile}
              className="px-3 py-2 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
              title="Editar manualmente"
            >
              <Pencil className="w-4 h-4" />
            </button>
          )}
          {!editingProfile && (
            <button
              onClick={handleRegenerateProfile}
              disabled={regeneratingProfile}
              className="px-3 py-2 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
              title={orgProfile?.manually_edited_at ? 'Regenerar (sobrescreve edição manual)' : 'Regenerar perfil agora'}
            >
              {regeneratingProfile ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
            </button>
          )}
        </div>

        {(profileOpen || editingProfile) && (
          <div className="border-t border-primary/10 bg-background/40 px-5 py-4">
            {editingProfile ? (
              <div>
                <p className="text-[11px] text-muted-foreground mb-2">
                  Edite o resumo que a IA usa nos atendimentos. Enquanto existir edição manual, o cron automático das 02h <strong>não sobrescreve</strong> este texto. Para voltar à geração automática, clique em "Regenerar".
                </p>
                <textarea
                  value={editProfileContent}
                  onChange={(e) => setEditProfileContent(e.target.value)}
                  className="w-full min-h-[400px] text-[13px] p-3 rounded-lg bg-card border border-border focus:outline-none focus:ring-1 focus:ring-primary leading-relaxed resize-y font-mono"
                  placeholder="## Sobre o Escritório..."
                  autoFocus
                />
                <div className="flex items-center justify-between mt-3">
                  <span className="text-[10px] text-muted-foreground">
                    {editProfileContent.length} caracteres
                    {editProfileContent.length < 50 && ' (mín. 50)'}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCancelEditProfile}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05]"
                    >
                      <X className="w-3.5 h-3.5" />
                      Cancelar
                    </button>
                    <button
                      onClick={handleSaveProfile}
                      disabled={savingProfile || editProfileContent.trim().length < 50}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50"
                    >
                      {savingProfile ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Save className="w-3.5 h-3.5" />
                      )}
                      Salvar edição
                    </button>
                  </div>
                </div>
              </div>
            ) : orgProfile ? (
              <>
                <div className="prose prose-sm dark:prose-invert max-w-none text-[13px] text-foreground whitespace-pre-wrap leading-relaxed">
                  {orgProfile.summary}
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
                  <p className="text-[10px] text-muted-foreground">
                    {orgProfile.manually_edited_at
                      ? `Editado manualmente em ${formatDate(orgProfile.manually_edited_at)}`
                      : `Última atualização: ${formatDate(orgProfile.generated_at)}`}
                  </p>
                  <button
                    onClick={handleRebuildProfile}
                    disabled={rebuildingProfile}
                    className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-50"
                    title="Descartar o texto atual e gerar do zero a partir de todas as memórias"
                  >
                    {rebuildingProfile ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <RotateCcw className="w-3 h-3" />
                    )}
                    Refazer do zero
                  </button>
                </div>
              </>
            ) : (
              <div className="text-center py-4 text-sm text-muted-foreground">
                <p>Nenhum perfil consolidado gerado ainda.</p>
                <button
                  onClick={handleRegenerateProfile}
                  disabled={regeneratingProfile}
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 disabled:opacity-50"
                >
                  {regeneratingProfile ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Sparkles className="w-3 h-3" />
                  )}
                  Gerar agora
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Buscar memória..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-card border border-border focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Message */}
      {message && (
        <div
          className={`mb-4 px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${
            message.type === 'ok'
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
              : 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20'
          }`}
        >
          {message.type === 'ok' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {message.text}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Carregando...
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 rounded-lg p-4 mb-4">
          {error}
        </div>
      )}

      {/* Groups */}
      {!loading && !error && (
        <div className="space-y-2">
          {SUBCATEGORIES.map((cat) => {
            const items = filteredGroups[cat.key] || [];
            const open = openGroups[cat.key] ?? false;
            const Icon = cat.icon;
            return (
              <div key={cat.key} className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="flex items-center">
                  <button
                    onClick={() => toggleGroup(cat.key)}
                    className="flex-1 flex items-center gap-3 px-4 py-3 hover:bg-foreground/[0.03] transition-colors text-left"
                  >
                    {open ? (
                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    )}
                    <Icon className="w-4 h-4 text-primary" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{cat.label}</span>
                        <span className="text-xs text-muted-foreground">({items.length})</span>
                      </div>
                      {!open && (
                        <p className="text-[11px] text-muted-foreground truncate">{cat.hint}</p>
                      )}
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      setAdding({ subcategory: cat.key });
                      setNewContent('');
                    }}
                    className="px-3 py-2 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                    title="Adicionar memória"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                {open && (
                  <div className="border-t border-border bg-foreground/[0.02]">
                    {items.length === 0 && adding?.subcategory !== cat.key && (
                      <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                        <p>Nenhuma memória nesta categoria.</p>
                        <button
                          onClick={() => {
                            setAdding({ subcategory: cat.key });
                            setNewContent('');
                          }}
                          className="mt-2 text-primary text-xs hover:underline"
                        >
                          + Adicionar primeira memória
                        </button>
                      </div>
                    )}

                    {adding?.subcategory === cat.key && (
                      <div className="p-3 border-b border-border bg-background/50">
                        <textarea
                          value={newContent}
                          onChange={(e) => setNewContent(e.target.value)}
                          placeholder={`Ex: ${cat.hint}`}
                          className="w-full text-sm p-2 rounded-lg bg-card border border-border focus:outline-none focus:ring-1 focus:ring-primary min-h-[80px] resize-none"
                          autoFocus
                        />
                        <div className="flex items-center justify-end gap-2 mt-2">
                          <button
                            onClick={() => {
                              setAdding(null);
                              setNewContent('');
                            }}
                            className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                          >
                            Cancelar
                          </button>
                          <button
                            onClick={handleAdd}
                            disabled={saving}
                            className="px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-1.5"
                          >
                            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                            Adicionar
                          </button>
                        </div>
                      </div>
                    )}

                    {items.map((item) => (
                      <div
                        key={item.id}
                        className="px-4 py-3 border-b border-border last:border-b-0 hover:bg-foreground/[0.03] transition-colors"
                      >
                        {editing?.id === item.id ? (
                          <div>
                            <textarea
                              value={editContent}
                              onChange={(e) => setEditContent(e.target.value)}
                              className="w-full text-sm p-2 rounded-lg bg-card border border-border focus:outline-none focus:ring-1 focus:ring-primary min-h-[80px] resize-none"
                              autoFocus
                            />
                            <div className="flex items-center justify-end gap-2 mt-2">
                              <button
                                onClick={() => {
                                  setEditing(null);
                                  setEditContent('');
                                }}
                                className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                              >
                                Cancelar
                              </button>
                              <button
                                onClick={handleUpdate}
                                disabled={saving}
                                className="px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-1.5"
                              >
                                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                                Salvar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start gap-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-foreground">{item.content}</p>
                              <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                                <span>{formatSourceLabel(item.source_type)}</span>
                                <span>•</span>
                                <span>Confiança {Math.round(item.confidence * 100)}%</span>
                                <span>•</span>
                                <span>{formatDate(item.created_at)}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={() => {
                                  setEditing(item);
                                  setEditContent(item.content);
                                }}
                                className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded transition-colors"
                                title="Editar"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDelete(item.id)}
                                className="p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded transition-colors"
                                title="Remover"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Configurações Avançadas */}
      {!loading && (
        <div className="mt-6 bg-card border border-border rounded-xl overflow-hidden">
          <button
            onClick={() => setAdvancedOpen(!advancedOpen)}
            className="w-full px-4 py-3 flex items-center gap-3 hover:bg-foreground/[0.03] transition-colors text-left"
          >
            <Settings className="w-4 h-4 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium">Configurações Avançadas</span>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Modelo de IA e prompts usados pela consolidação do resumo
              </p>
            </div>
            {advancedOpen ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            )}
          </button>

          {advancedOpen && (
            <div className="border-t border-border bg-foreground/[0.02] px-5 py-4">
              {settingsLoading ? (
                <div className="flex items-center justify-center py-6 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Carregando configurações...
                </div>
              ) : settings ? (
                <div className="space-y-6">
                  {/* Modelo da IA */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Cpu className="w-3.5 h-3.5 text-primary" />
                      <label className="text-[12px] font-semibold">Modelo da IA</label>
                      {editModel !== settings.model_default && (
                        <span className="text-[10px] text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full">
                          personalizado
                        </span>
                      )}
                    </div>
                    <select
                      value={editModel}
                      onChange={(e) => setEditModel(e.target.value)}
                      className="w-full text-sm p-2 rounded-lg bg-card border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      {settings.available_models.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Modelo usado em cada consolidação do resumo (incremental + "Refazer do zero"). Padrão: {settings.model_default}.
                    </p>
                  </div>

                  {/* Prompts */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <FileCode2 className="w-3.5 h-3.5 text-primary" />
                      <label className="text-[12px] font-semibold">Prompts</label>
                    </div>

                    {/* Tabs */}
                    <div className="flex border-b border-border mb-3">
                      <button
                        onClick={() => setActivePromptTab('incremental')}
                        className={`px-3 py-2 text-[12px] font-medium border-b-2 transition-colors -mb-px ${
                          activePromptTab === 'incremental'
                            ? 'border-primary text-primary'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        Incremental (padrão)
                        {editIncremental.trim() !== '' && (
                          <span className="ml-1.5 text-[9px] text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1 rounded">●</span>
                        )}
                      </button>
                      <button
                        onClick={() => setActivePromptTab('rebuild')}
                        className={`px-3 py-2 text-[12px] font-medium border-b-2 transition-colors -mb-px ${
                          activePromptTab === 'rebuild'
                            ? 'border-primary text-primary'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        Refazer do zero
                        {editRebuild.trim() !== '' && (
                          <span className="ml-1.5 text-[9px] text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1 rounded">●</span>
                        )}
                      </button>
                    </div>

                    {/* Incremental tab */}
                    {activePromptTab === 'incremental' && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[11px] text-muted-foreground">
                            Usado toda noite (02h) para atualizar o resumo com memórias novas/deletadas do dia.{' '}
                            {editIncremental.trim() === '' && (
                              <span className="text-foreground font-medium">Usando padrão do sistema.</span>
                            )}
                          </p>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleLoadDefaultPrompt('incremental')}
                              className="text-[10px] text-primary hover:underline"
                            >
                              Ver/copiar padrão
                            </button>
                            {editIncremental.trim() !== '' && (
                              <button
                                onClick={() => handleResetPrompt('incremental')}
                                className="text-[10px] text-muted-foreground hover:text-red-500"
                              >
                                Restaurar padrão
                              </button>
                            )}
                          </div>
                        </div>
                        <textarea
                          value={editIncremental}
                          onChange={(e) => setEditIncremental(e.target.value)}
                          placeholder={settings.incremental_prompt_default}
                          className="w-full min-h-[300px] text-[11px] p-3 rounded-lg bg-card border border-border focus:outline-none focus:ring-1 focus:ring-primary resize-y font-mono leading-relaxed"
                        />
                        <p className="text-[10px] text-muted-foreground mt-1">
                          Deixar vazio = usar o padrão do sistema. Mínimo 100 caracteres quando customizado.
                        </p>
                      </div>
                    )}

                    {/* Rebuild tab */}
                    {activePromptTab === 'rebuild' && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[11px] text-muted-foreground">
                            Usado quando admin clica "Refazer do zero" — gera resumo completamente novo a partir de todas as memórias.{' '}
                            {editRebuild.trim() === '' && (
                              <span className="text-foreground font-medium">Usando padrão do sistema.</span>
                            )}
                          </p>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleLoadDefaultPrompt('rebuild')}
                              className="text-[10px] text-primary hover:underline"
                            >
                              Ver/copiar padrão
                            </button>
                            {editRebuild.trim() !== '' && (
                              <button
                                onClick={() => handleResetPrompt('rebuild')}
                                className="text-[10px] text-muted-foreground hover:text-red-500"
                              >
                                Restaurar padrão
                              </button>
                            )}
                          </div>
                        </div>
                        <textarea
                          value={editRebuild}
                          onChange={(e) => setEditRebuild(e.target.value)}
                          placeholder={settings.rebuild_prompt_default}
                          className="w-full min-h-[300px] text-[11px] p-3 rounded-lg bg-card border border-border focus:outline-none focus:ring-1 focus:ring-primary resize-y font-mono leading-relaxed"
                        />
                        <p className="text-[10px] text-muted-foreground mt-1">
                          Deixar vazio = usar o padrão do sistema. Mínimo 100 caracteres quando customizado.
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Botão salvar */}
                  <div className="flex items-center justify-end pt-2 border-t border-border">
                    <button
                      onClick={handleSaveSettings}
                      disabled={settingsSaving}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                    >
                      {settingsSaving ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Save className="w-3.5 h-3.5" />
                      )}
                      Salvar alterações
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      {!loading && stats && (
        <div className="mt-6 text-center text-xs text-muted-foreground">
          Total: <strong className="text-foreground">{stats.total}</strong> memórias •
          Última extração automática:{' '}
          <strong className="text-foreground">{formatDate(stats.last_extraction)}</strong>
        </div>
      )}
    </div>
  );
}
