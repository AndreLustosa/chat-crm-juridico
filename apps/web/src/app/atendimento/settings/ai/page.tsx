'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Bot, KeyRound, CheckCircle2, RefreshCw, Eye, EyeOff, Plus, Pencil, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import api from '@/lib/api';

interface Skill {
  id: string;
  name: string;
  area: string;
  systemPrompt: string;
  model: string;
  maxTokens: number;
  temperature: number;
  handoffSignal: string | null;
  isActive: boolean;
  order: number;
}

interface SkillForm {
  id: string | null;
  name: string;
  area: string;
  systemPrompt: string;
  model: string;
  maxTokens: number;
  temperature: number;
  handoffSignal: string;
  isActive: boolean;
}

const AVAILABLE_MODELS = [
  { value: 'gpt-5.1', label: 'GPT-5.1 — conversacional avançado' },
  { value: 'gpt-4.1', label: 'GPT-4.1 — analítico' },
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini — balanceado' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini — rápido, econômico' },
  { value: 'gpt-4o', label: 'GPT-4o — capaz' },
  { value: 'o1-mini', label: 'o1 Mini — raciocínio' },
];

const TEMPLATE_VARS = [
  { key: '{{lead_name}}', desc: 'Nome do cliente' },
  { key: '{{lead_phone}}', desc: 'Telefone' },
  { key: '{{legal_area}}', desc: 'Área jurídica detectada' },
  { key: '{{firm_name}}', desc: 'Nome do escritório' },
  { key: '{{lead_memory}}', desc: 'Memória do lead (resumo + fatos)' },
  { key: '{{lead_summary}}', desc: 'Resumo do caso' },
  { key: '{{conversation_id}}', desc: 'ID da conversa (para URLs)' },
  { key: '{{history_summary}}', desc: 'Resumo do histórico' },
];

const BLANK_FORM: SkillForm = {
  id: null,
  name: '',
  area: '',
  systemPrompt: '',
  model: 'gpt-4o-mini',
  maxTokens: 300,
  temperature: 0.7,
  handoffSignal: '',
  isActive: true,
};

export default function AiSettingsPage() {
  // Config global
  const [apiKey, setApiKey] = useState('');
  const [defaultModel, setDefaultModel] = useState('gpt-4o-mini');
  const [cooldownSeconds, setCooldownSeconds] = useState(8);
  const [isConfigured, setIsConfigured] = useState(false);
  const [isEditingKey, setIsEditingKey] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [savedConfig, setSavedConfig] = useState(false);
  const [loading, setLoading] = useState(true);

  // Skills
  const [skills, setSkills] = useState<Skill[]>([]);
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<SkillForm>(BLANK_FORM);
  const [savingSkill, setSavingSkill] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const fetchData = useCallback(async () => {
    try {
      const [configRes, skillsRes] = await Promise.all([
        api.get('/settings/ai-config'),
        api.get('/settings/skills'),
      ]);
      setIsConfigured(configRes.data.isConfigured);
      setDefaultModel(configRes.data.defaultModel || 'gpt-4o-mini');
      setCooldownSeconds(configRes.data.cooldownSeconds ?? 8);
      setSkills(skillsRes.data);
    } catch (e) {
      console.error('Erro ao carregar dados:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ---------- Config Global ----------
  const handleSaveConfig = async () => {
    if (!apiKey.trim() && !defaultModel) return;
    setSavingConfig(true);
    try {
      const payload: any = { defaultModel, cooldownSeconds };
      if (apiKey.trim()) payload.apiKey = apiKey.trim();
      await api.post('/settings/ai-config', payload);
      if (apiKey.trim()) setIsConfigured(true);
      setIsEditingKey(false);
      setApiKey('');
      setSavedConfig(true);
      setTimeout(() => setSavedConfig(false), 3000);
    } catch (e) {
      console.error('Erro ao salvar config IA:', e);
      alert('Erro ao salvar. Verifique se você é administrador.');
    } finally {
      setSavingConfig(false);
    }
  };

  // ---------- Skills ----------
  const openEdit = (skill: Skill) => {
    setForm({
      id: skill.id,
      name: skill.name,
      area: skill.area,
      systemPrompt: skill.systemPrompt,
      model: skill.model,
      maxTokens: skill.maxTokens,
      temperature: skill.temperature,
      handoffSignal: skill.handoffSignal || '',
      isActive: skill.isActive,
    });
    setEditingId(skill.id);
  };

  const openNew = () => {
    setForm(BLANK_FORM);
    setEditingId('new');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(BLANK_FORM);
  };

  const saveSkill = async () => {
    if (!form.name.trim() || !form.area.trim()) {
      alert('Nome e área são obrigatórios.');
      return;
    }
    setSavingSkill(true);
    try {
      const payload = {
        name: form.name.trim(),
        area: form.area.trim(),
        system_prompt: form.systemPrompt,
        model: form.model,
        max_tokens: form.maxTokens,
        temperature: form.temperature,
        handoff_signal: form.handoffSignal.trim() || null,
        active: form.isActive,
      };
      if (form.id) {
        await api.patch(`/settings/skills/${form.id}`, payload);
      } else {
        await api.post('/settings/skills', payload);
      }
      await fetchData();
      setEditingId(null);
      setForm(BLANK_FORM);
    } catch (e) {
      console.error('Erro ao salvar skill:', e);
      alert('Erro ao salvar skill.');
    } finally {
      setSavingSkill(false);
    }
  };

  const deleteSkill = async (id: string) => {
    if (!confirm('Excluir esta skill permanentemente?')) return;
    setDeletingId(id);
    try {
      await api.delete(`/settings/skills/${id}`);
      await fetchData();
      if (editingId === id) cancelEdit();
    } catch (e) {
      alert('Erro ao excluir skill.');
    } finally {
      setDeletingId(null);
    }
  };

  const toggleSkill = async (id: string, current: boolean) => {
    try {
      await api.patch(`/settings/skills/${id}/toggle`, { isActive: !current });
      setSkills((prev) => prev.map((s) => s.id === id ? { ...s, isActive: !current } : s));
    } catch (e) {
      alert('Erro ao alterar status da skill.');
    }
  };

  const insertVar = (varKey: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const newPrompt = form.systemPrompt.slice(0, start) + varKey + form.systemPrompt.slice(end);
    setForm((f) => ({ ...f, systemPrompt: newPrompt }));
    setTimeout(() => {
      el.selectionStart = el.selectionEnd = start + varKey.length;
      el.focus();
    }, 0);
  };

  const modelBadge = (model: string) => {
    const colors: Record<string, string> = {
      'gpt-4o-mini': 'bg-sky-500/10 text-sky-400 border-sky-500/20',
      'gpt-4o': 'bg-violet-500/10 text-violet-400 border-violet-500/20',
      'gpt-4.1': 'bg-purple-500/10 text-purple-400 border-purple-500/20',
      'gpt-4.1-mini': 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
      'o1-mini': 'bg-pink-500/10 text-pink-400 border-pink-500/20',
    };
    return colors[model] || 'bg-muted text-muted-foreground border-border';
  };

  return (
    <div className="flex-1 flex flex-col pt-8 overflow-hidden bg-background">
      <header className="px-8 mb-6 shrink-0">
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Ajustes IA</h1>
        <p className="text-[13px] text-muted-foreground mt-1">Configure modelos, prompts e comportamento do assistente virtual.</p>
      </header>

      <div className="flex-1 overflow-y-auto px-8 pb-8 flex flex-col gap-6">

        {/* ── Config Global ── */}
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between bg-primary/5">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <KeyRound size={16} />
              </div>
              <div>
                <h4 className="text-sm font-bold text-foreground">Configuração Global</h4>
                <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">API Key + Modelo padrão</p>
              </div>
            </div>
            {!loading && (
              <button
                onClick={() => { setIsEditingKey(!isEditingKey); setApiKey(''); setShowKey(false); }}
                className="text-xs font-bold text-primary hover:underline"
              >
                {isEditingKey ? 'Cancelar' : 'Editar'}
              </button>
            )}
          </div>

          {loading ? (
            <div className="p-6 flex items-center justify-center">
              <RefreshCw className="animate-spin text-muted-foreground" size={20} />
            </div>
          ) : (
            <div className="p-5 space-y-4">
              {/* Modelo padrão (sempre visível) */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Modelo padrão</label>
                <select
                  value={defaultModel}
                  onChange={(e) => setDefaultModel(e.target.value)}
                  className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-primary/50 transition-all"
                >
                  {AVAILABLE_MODELS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground">Modelo usado quando a skill não define um modelo específico.</p>
              </div>

              {/* Cooldown entre respostas da IA */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
                  Cooldown entre respostas:{' '}
                  <span className="text-foreground">
                    {cooldownSeconds === 0 ? 'desativado' : `${cooldownSeconds}s`}
                  </span>
                </label>
                <input
                  type="range" min={0} max={60} step={1}
                  value={cooldownSeconds}
                  onChange={(e) => setCooldownSeconds(Number(e.target.value))}
                  className="w-full accent-primary"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>desativado</span><span>60s</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Tempo mínimo entre respostas da IA na mesma conversa. Evita resposta duplicada quando o cliente envia várias mensagens em sequência rápida.
                </p>
              </div>

              {/* API Key (só editável quando aberto) */}
              {isEditingKey && (
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Nova API Key OpenAI</label>
                  <div className="relative">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="sk-proj-..."
                      className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 pr-10 text-sm outline-none focus:border-primary/50 transition-all font-mono"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Obtenha em <span className="font-mono text-primary">platform.openai.com/api-keys</span>
                  </p>
                </div>
              )}

              {/* Status da chave */}
              {!isEditingKey && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">API Key OpenAI</span>
                  {savedConfig ? (
                    <span className="flex items-center gap-1.5 text-emerald-500 font-bold bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                      <CheckCircle2 size={11} /> SALVO
                    </span>
                  ) : isConfigured ? (
                    <span className="flex items-center gap-1.5 text-emerald-500 font-bold bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> CONFIGURADO
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-amber-500 font-bold bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/20">
                      <div className="w-1.5 h-1.5 rounded-full bg-amber-500" /> NÃO CONFIGURADO
                    </span>
                  )}
                </div>
              )}

              <div className="flex justify-end pt-1">
                <button
                  disabled={savingConfig}
                  onClick={handleSaveConfig}
                  className="bg-primary text-primary-foreground px-6 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-primary/90 transition-all disabled:opacity-50 shadow-lg shadow-primary/20"
                >
                  {savingConfig ? <RefreshCw className="animate-spin" size={15} /> : <CheckCircle2 size={15} />}
                  Salvar Configurações
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Skills da IA ── */}
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between bg-primary/5">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Bot size={16} />
              </div>
              <div>
                <h4 className="text-sm font-bold text-foreground">Skills da IA</h4>
                <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">
                  Prompts especializados por área jurídica
                </p>
              </div>
            </div>
            <button
              onClick={openNew}
              className="flex items-center gap-1.5 text-xs font-bold text-primary bg-primary/10 border border-primary/20 px-3 py-1.5 rounded-lg hover:bg-primary/20 transition-all"
            >
              <Plus size={13} /> Nova Skill
            </button>
          </div>

          {loading ? (
            <div className="p-6 flex items-center justify-center">
              <RefreshCw className="animate-spin text-muted-foreground" size={20} />
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {skills.length === 0 && editingId !== 'new' && (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  Nenhuma skill configurada. Clique em &quot;Nova Skill&quot; para começar.
                </div>
              )}

              {/* Lista de skills existentes */}
              {skills.map((skill) => (
                <div key={skill.id}>
                  {/* Card da skill */}
                  <div className="p-4 flex items-center gap-3 hover:bg-muted/30 transition-all">
                    {/* Toggle ativo */}
                    <button
                      onClick={() => toggleSkill(skill.id, skill.isActive)}
                      className={`w-8 h-4 rounded-full transition-colors shrink-0 relative ${skill.isActive ? 'bg-emerald-500' : 'bg-muted'}`}
                    >
                      <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${skill.isActive ? 'left-4' : 'left-0.5'}`} />
                    </button>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-foreground">{skill.name}</span>
                        <span className="text-[10px] font-bold text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                          área: {skill.area}
                        </span>
                        <span className={`text-[10px] font-bold border px-1.5 py-0.5 rounded ${modelBadge(skill.model)}`}>
                          {skill.model}
                        </span>
                        {skill.handoffSignal && (
                          <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">
                            escalada: {skill.handoffSignal}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate max-w-xl">
                        {(skill.systemPrompt || '').slice(0, 80)}{skill.systemPrompt?.length > 80 ? '…' : ''}
                      </p>
                    </div>

                    {/* Ações */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => editingId === skill.id ? cancelEdit() : openEdit(skill)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
                        title="Editar"
                      >
                        {editingId === skill.id ? <ChevronUp size={15} /> : <Pencil size={15} />}
                      </button>
                      <button
                        onClick={() => deleteSkill(skill.id)}
                        disabled={deletingId === skill.id}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-50"
                        title="Excluir"
                      >
                        {deletingId === skill.id ? <RefreshCw size={15} className="animate-spin" /> : <Trash2 size={15} />}
                      </button>
                    </div>
                  </div>

                  {/* Painel de edição inline */}
                  {editingId === skill.id && (
                    <SkillEditor
                      form={form}
                      setForm={setForm}
                      textareaRef={textareaRef}
                      saving={savingSkill}
                      onSave={saveSkill}
                      onCancel={cancelEdit}
                      insertVar={insertVar}
                    />
                  )}
                </div>
              ))}

              {/* Nova skill */}
              {editingId === 'new' && (
                <div className="p-4 bg-violet-500/5 border-t border-violet-500/20">
                  <p className="text-xs font-bold text-violet-400 mb-3 uppercase tracking-wide flex items-center gap-2">
                    <Plus size={12} /> Nova Skill
                  </p>
                  <SkillEditor
                    form={form}
                    setForm={setForm}
                    textareaRef={textareaRef}
                    saving={savingSkill}
                    onSave={saveSkill}
                    onCancel={cancelEdit}
                    insertVar={insertVar}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Referência de variáveis ── */}
        <div className="bg-card/50 rounded-2xl border border-border p-5 space-y-3">
          <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
            <ChevronDown size={13} /> Variáveis disponíveis nos prompts
          </h4>
          <div className="grid grid-cols-2 gap-2">
            {TEMPLATE_VARS.map((v) => (
              <div key={v.key} className="flex items-center gap-2 text-xs">
                <code className="font-mono text-violet-400 bg-violet-500/10 border border-violet-500/20 px-1.5 py-0.5 rounded text-[11px]">
                  {v.key}
                </code>
                <span className="text-muted-foreground">{v.desc}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Use <code className="font-mono">ESCALAR_HUMANO</code> (ou qualquer palavra configurada em &quot;Sinal de escalada&quot;) para que a IA transfira a conversa de volta ao atendente humano.
          </p>
        </div>

      </div>
    </div>
  );
}

// ─── Componente do editor de skill ───────────────────────────────────────────
function SkillEditor({
  form,
  setForm,
  textareaRef,
  saving,
  onSave,
  onCancel,
  insertVar,
}: {
  form: SkillForm;
  setForm: React.Dispatch<React.SetStateAction<SkillForm>>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  insertVar: (v: string) => void;
}) {
  return (
    <div className="p-5 bg-card border-t border-border/50 space-y-4">
      {/* Nome + Área */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Nome da skill</label>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Ex: Trabalhista"
            className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-primary/50 transition-all"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Área</label>
          <input
            value={form.area}
            onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))}
            placeholder="Ex: Trabalhista, Civil, Geral, *"
            className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-primary/50 transition-all"
          />
          <p className="text-[10px] text-muted-foreground">Use &quot;Geral&quot; ou &quot;*&quot; para skill de triagem padrão</p>
        </div>
      </div>

      {/* Modelo + Tokens + Temperatura */}
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Modelo</label>
          <select
            value={form.model}
            onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
            className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-primary/50 transition-all"
          >
            {AVAILABLE_MODELS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
            Tokens máx: <span className="text-foreground">{form.maxTokens}</span>
          </label>
          <input
            type="range" min={50} max={2000} step={50}
            value={form.maxTokens}
            onChange={(e) => setForm((f) => ({ ...f, maxTokens: Number(e.target.value) }))}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>50</span><span>2000</span>
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
            Temperatura: <span className="text-foreground">{form.temperature.toFixed(1)}</span>
          </label>
          <input
            type="range" min={0} max={1} step={0.1}
            value={form.temperature}
            onChange={(e) => setForm((f) => ({ ...f, temperature: Number(e.target.value) }))}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>preciso</span><span>criativo</span>
          </div>
        </div>
      </div>

      {/* Sinal de escalada */}
      <div className="space-y-1.5">
        <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
          Sinal de escalada <span className="normal-case font-normal">(opcional)</span>
        </label>
        <input
          value={form.handoffSignal}
          onChange={(e) => setForm((f) => ({ ...f, handoffSignal: e.target.value }))}
          placeholder="Ex: ESCALAR_HUMANO"
          className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-primary/50 transition-all font-mono"
        />
        <p className="text-[11px] text-muted-foreground">
          Quando a IA incluir esta palavra na resposta, o modo automático é desativado. A palavra não aparece para o cliente.
        </p>
      </div>

      {/* System Prompt */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">System Prompt</label>
          <div className="flex gap-1 flex-wrap justify-end">
            {TEMPLATE_VARS.map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => insertVar(v.key)}
                title={v.desc}
                className="font-mono text-violet-400 border border-violet-500/30 bg-violet-500/10 hover:bg-violet-500/20 rounded px-1.5 text-[10px] transition-all"
              >
                {v.key}
              </button>
            ))}
          </div>
        </div>
        <textarea
          ref={textareaRef}
          value={form.systemPrompt}
          onChange={(e) => setForm((f) => ({ ...f, systemPrompt: e.target.value }))}
          rows={10}
          placeholder="Você é um assistente de pré-atendimento do escritório {{firm_name}}..."
          className="w-full font-mono text-sm bg-muted/50 border border-border rounded-xl p-4 resize-y outline-none focus:border-primary/50 transition-all leading-relaxed"
        />
      </div>

      {/* Toggle ativo */}
      <label className="flex items-center gap-3 cursor-pointer select-none">
        <div
          onClick={() => setForm((f) => ({ ...f, isActive: !f.isActive }))}
          className={`w-10 h-5 rounded-full transition-colors relative ${form.isActive ? 'bg-emerald-500' : 'bg-muted'}`}
        >
          <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${form.isActive ? 'left-5' : 'left-0.5'}`} />
        </div>
        <span className="text-sm font-semibold text-foreground">Skill ativa</span>
      </label>

      {/* Botões */}
      <div className="flex justify-end gap-3 pt-2 border-t border-border/50">
        <button
          onClick={onCancel}
          className="px-5 py-2.5 rounded-xl text-sm font-bold text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
        >
          Cancelar
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          className="bg-primary text-primary-foreground px-6 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-primary/90 transition-all disabled:opacity-50 shadow-lg shadow-primary/20"
        >
          {saving ? <RefreshCw className="animate-spin" size={15} /> : <CheckCircle2 size={15} />}
          Salvar Skill
        </button>
      </div>
    </div>
  );
}
