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
  History,
  Eye,
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
  // Histórico de versões (Fase 3)
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<Array<{
    id: string;
    version: number;
    source: string;
    created_at: string;
    created_by_user_name: string | null;
    source_memory_count: number;
    summary: string;
  }>>([]);
  const [loadingSnapshots, setLoadingSnapshots] = useState(false);
  const [restoringSnapshotId, setRestoringSnapshotId] = useState<string | null>(null);
  const [previewSnapshot, setPreviewSnapshot] = useState<typeof snapshots[number] | null>(null);
  // Workflow de aprovação (Fase 3 PR2)
  const [pending, setPending] = useState<{
    has_pending: boolean;
    current_summary?: string;
    current_version?: number;
    pending_summary?: string;
    pending_changes_applied?: string[];
    pending_at?: string;
    pending_triggered_by_name?: string | null;
  } | null>(null);
  const [pendingModalOpen, setPendingModalOpen] = useState(false);
  const [pendingEditMode, setPendingEditMode] = useState(false);
  const [pendingEditContent, setPendingEditContent] = useState('');
  const [approvingPending, setApprovingPending] = useState(false);
  const [rejectingPending, setRejectingPending] = useState(false);
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
      const [memsRes, statsRes, settingsRes, profileRes, pendingRes] = await Promise.all([
        api.get<OrgMemoriesResponse>('/memories/organization'),
        api.get<OrgStats>('/memories/organization/stats'),
        api.get('/settings'),
        api.get<OrgProfile | null>('/memories/organization/profile'),
        api.get('/memories/organization/pending').catch(() => ({ data: { has_pending: false } })),
      ]);
      setGroups(memsRes.data.groups || {});
      setStats(statsRes.data);
      setOrgProfile(profileRes.data);
      setPending(pendingRes.data);
      const rows = Array.isArray(settingsRes.data) ? settingsRes.data : [];
      const flag = rows.find((r: any) => r?.key === 'MEMORY_BATCH_ENABLED');
      setBatchEnabled((flag?.value ?? 'true').toLowerCase() !== 'false');
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleApprovePending = async () => {
    setApprovingPending(true);
    try {
      // Se tava editando, salva edição primeiro
      if (pendingEditMode && pendingEditContent.trim().length >= 50) {
        await api.put('/memories/organization/pending', { summary: pendingEditContent });
      }
      await api.post('/memories/organization/pending/approve');
      showFeedback('Proposta aprovada — IA passa a usar a versão nova');
      setPendingModalOpen(false);
      setPendingEditMode(false);
      setPendingEditContent('');
      await loadData();
    } catch (e: any) {
      showFeedback(e?.response?.data?.message || 'Erro ao aprovar', 'err');
    } finally {
      setApprovingPending(false);
    }
  };

  const handleRejectPending = async () => {
    if (!confirm('Descartar a proposta? IA continua usando o resumo atual.')) return;
    setRejectingPending(true);
    try {
      await api.post('/memories/organization/pending/reject');
      showFeedback('Proposta descartada');
      setPendingModalOpen(false);
      setPendingEditMode(false);
      await loadData();
    } catch (e: any) {
      showFeedback(e?.response?.data?.message || 'Erro ao rejeitar', 'err');
    } finally {
      setRejectingPending(false);
    }
  };

  const openPendingModal = () => {
    setPendingEditContent(pending?.pending_summary || '');
    setPendingEditMode(false);
    setPendingModalOpen(true);
  };

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

  const loadSnapshots = useCallback(async () => {
    setLoadingSnapshots(true);
    try {
      const res = await api.get('/memories/organization/snapshots');
      setSnapshots(res.data || []);
    } catch (e: any) {
      showFeedback(e?.response?.data?.message || 'Erro ao carregar histórico', 'err');
    } finally {
      setLoadingSnapshots(false);
    }
  }, []);

  const handleToggleSnapshots = () => {
    const next = !snapshotsOpen;
    setSnapshotsOpen(next);
    if (next && snapshots.length === 0) loadSnapshots();
  };

  const handleRestoreSnapshot = async (snapshotId: string, version: number) => {
    const ok = confirm(
      `Restaurar versão v${version}?\n\nA versão atual será salva no histórico antes da restauração. Você pode desfazer voltando ao snapshot mais recente.`,
    );
    if (!ok) return;
    setRestoringSnapshotId(snapshotId);
    try {
      await api.post(`/memories/organization/snapshots/${snapshotId}/restore`);
      showFeedback(`Versão v${version} restaurada com sucesso`);
      await loadData();
      await loadSnapshots();
    } catch (e: any) {
      showFeedback(e?.response?.data?.message || 'Erro ao restaurar versão', 'err');
    } finally {
      setRestoringSnapshotId(null);
    }
  };

  const sourceLabel = (s: string): string => {
    const map: Record<string, string> = {
      cron: 'Cron 02h',
      rebuild: 'Refeito do zero',
      manual_edit: 'Edição manual',
      regenerate: 'Regeneração',
      restore: 'Restauração',
    };
    return map[s] || s;
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

      {/* Banner de proposta pendente (Fase 3 PR2) */}
      {pending?.has_pending && (
        <div className="mb-4 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <span className="text-2xl shrink-0">⚠️</span>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                Proposta de atualização do Resumo aguardando revisão
              </h3>
              <p className="text-xs text-amber-800/80 dark:text-amber-200/80 mt-1">
                {pending.pending_changes_applied?.length || 0} mudança
                {(pending.pending_changes_applied?.length || 0) === 1 ? '' : 's'} acumulada
                {(pending.pending_changes_applied?.length || 0) === 1 ? '' : 's'}
                {pending.pending_at && ` • gerada em ${formatDate(pending.pending_at)}`}
                {pending.pending_triggered_by_name && ` por ${pending.pending_triggered_by_name}`}
              </p>
              <p className="text-xs text-amber-800/80 dark:text-amber-200/80 mt-1">
                A IA continua usando o resumo atual (v{pending.current_version}) até você aprovar.
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={handleRejectPending}
                disabled={rejectingPending}
                className="px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 rounded-lg transition-colors disabled:opacity-50"
              >
                {rejectingPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Descartar'}
              </button>
              <button
                onClick={openPendingModal}
                className="px-3 py-1.5 text-xs font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors"
              >
                Revisar agora →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de revisão da proposta */}
      {pendingModalOpen && pending?.has_pending && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => !approvingPending && !rejectingPending && setPendingModalOpen(false)}
        >
          <div
            className="bg-card border border-border rounded-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                  Revisar proposta — v{pending.current_version} → v{(pending.current_version || 1) + 1}
                </h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {pending.pending_at && `Gerada em ${formatDate(pending.pending_at)}`}
                  {pending.pending_triggered_by_name && ` por ${pending.pending_triggered_by_name}`}
                </p>
              </div>
              <button
                onClick={() => setPendingModalOpen(false)}
                disabled={approvingPending || rejectingPending}
                className="p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Mudanças aplicadas */}
            {pending.pending_changes_applied && pending.pending_changes_applied.length > 0 && (
              <div className="px-5 py-3 border-b border-border bg-amber-500/5">
                <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider mb-1.5">
                  Mudanças que o LLM aplicou
                </p>
                <ul className="space-y-1">
                  {pending.pending_changes_applied.map((c, i) => (
                    <li key={i} className="text-[12px] text-foreground flex items-start gap-2">
                      <span className="text-amber-500 mt-0.5 shrink-0">→</span>
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Diff lado-a-lado */}
            <div className="flex-1 overflow-y-auto grid grid-cols-2 divide-x divide-border">
              <div className="px-4 py-4">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">
                  Versão atual (v{pending.current_version})
                </p>
                <pre className="text-[11px] whitespace-pre-wrap leading-relaxed text-foreground/80 font-sans">
                  {pending.current_summary}
                </pre>
              </div>
              <div className="px-4 py-4 bg-amber-500/5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider">
                    Proposta (v{(pending.current_version || 1) + 1})
                  </p>
                  {!pendingEditMode && (
                    <button
                      onClick={() => {
                        setPendingEditContent(pending.pending_summary || '');
                        setPendingEditMode(true);
                      }}
                      className="text-[10px] text-primary hover:underline inline-flex items-center gap-1"
                    >
                      <Pencil className="w-3 h-3" />
                      Editar antes de aprovar
                    </button>
                  )}
                </div>
                {pendingEditMode ? (
                  <textarea
                    value={pendingEditContent}
                    onChange={(e) => setPendingEditContent(e.target.value)}
                    className="w-full min-h-[60vh] text-[11px] p-3 rounded-lg bg-card border border-border focus:outline-none focus:ring-1 focus:ring-primary leading-relaxed resize-y font-mono"
                    autoFocus
                  />
                ) : (
                  <pre className="text-[11px] whitespace-pre-wrap leading-relaxed text-foreground font-sans">
                    {pending.pending_summary}
                  </pre>
                )}
              </div>
            </div>

            {/* Footer: botões */}
            <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
              <button
                onClick={handleRejectPending}
                disabled={approvingPending || rejectingPending}
                className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
              >
                {rejectingPending ? <Loader2 className="w-3 h-3 animate-spin" /> : '❌ Rejeitar'}
              </button>
              {pendingEditMode && (
                <button
                  onClick={() => {
                    setPendingEditMode(false);
                    setPendingEditContent('');
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground"
                >
                  Cancelar edição
                </button>
              )}
              <button
                onClick={handleApprovePending}
                disabled={
                  approvingPending ||
                  rejectingPending ||
                  (pendingEditMode && pendingEditContent.trim().length < 50)
                }
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-medium hover:bg-amber-600 disabled:opacity-50"
              >
                {approvingPending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-3 h-3" />
                )}
                {pendingEditMode ? 'Aprovar com edição' : 'Aprovar'}
              </button>
            </div>
          </div>
        </div>
      )}

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
              onClick={handleToggleSnapshots}
              className={`px-3 py-2 transition-colors ${
                snapshotsOpen
                  ? 'text-primary bg-primary/10'
                  : 'text-muted-foreground hover:text-primary hover:bg-primary/10'
              }`}
              title="Histórico de versões"
            >
              <History className="w-4 h-4" />
            </button>
          )}
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

        {/* Histórico de versões (Fase 3) */}
        {snapshotsOpen && !editingProfile && (
          <div className="border-t border-primary/10 bg-background/60 px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-primary" />
                <span className="text-xs font-bold text-foreground uppercase tracking-wider">
                  Histórico de versões
                </span>
                <span className="text-[10px] text-muted-foreground">
                  ({snapshots.length})
                </span>
              </div>
              <button
                onClick={() => loadSnapshots()}
                className="text-[10px] text-muted-foreground hover:text-primary"
              >
                Atualizar
              </button>
            </div>

            {loadingSnapshots ? (
              <div className="flex items-center gap-2 text-muted-foreground text-xs py-3">
                <Loader2 className="w-3 h-3 animate-spin" />
                Carregando...
              </div>
            ) : snapshots.length === 0 ? (
              <p className="text-[11px] text-muted-foreground text-center py-3">
                Nenhuma versão anterior — snapshots começam a ser registrados a partir da próxima
                edição/regeneração/cron.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {snapshots.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg bg-card border border-border hover:border-primary/30 transition-colors"
                  >
                    <span className="text-[11px] font-mono text-muted-foreground w-10 shrink-0">
                      v{s.version}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground w-28 shrink-0">
                      {sourceLabel(s.source)}
                    </span>
                    <span className="text-[10px] text-muted-foreground flex-1 min-w-0 truncate">
                      {formatDate(s.created_at)}
                      {s.created_by_user_name && ` • ${s.created_by_user_name}`}
                    </span>
                    <button
                      onClick={() => setPreviewSnapshot(s)}
                      className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded transition-colors"
                      title="Ver conteúdo"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleRestoreSnapshot(s.id, s.version)}
                      disabled={restoringSnapshotId === s.id}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 rounded transition-colors disabled:opacity-50"
                      title="Restaurar esta versão"
                    >
                      {restoringSnapshotId === s.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <RotateCcw className="w-3 h-3" />
                      )}
                      Restaurar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Modal preview do snapshot */}
      {previewSnapshot && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setPreviewSnapshot(null)}
        >
          <div
            className="bg-card border border-border rounded-xl max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <div>
                <h3 className="text-sm font-semibold">
                  Versão v{previewSnapshot.version} — {sourceLabel(previewSnapshot.source)}
                </h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {formatDate(previewSnapshot.created_at)}
                  {previewSnapshot.created_by_user_name && ` • ${previewSnapshot.created_by_user_name}`}
                  {' • '}
                  {previewSnapshot.source_memory_count} memórias
                </p>
              </div>
              <button
                onClick={() => setPreviewSnapshot(null)}
                className="p-1.5 text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <pre className="text-[12px] whitespace-pre-wrap leading-relaxed text-foreground">
                {previewSnapshot.summary}
              </pre>
            </div>
            <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
              <button
                onClick={() => setPreviewSnapshot(null)}
                className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground"
              >
                Fechar
              </button>
              <button
                onClick={() => {
                  const id = previewSnapshot.id;
                  const v = previewSnapshot.version;
                  setPreviewSnapshot(null);
                  handleRestoreSnapshot(id, v);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-medium hover:bg-amber-600"
              >
                <RotateCcw className="w-3 h-3" />
                Restaurar esta versão
              </button>
            </div>
          </div>
        </div>
      )}

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
