'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Bot, KeyRound, CheckCircle2, RefreshCw, Eye, EyeOff, Plus, Pencil, Trash2, ChevronDown, ChevronUp, Volume2 } from 'lucide-react';
import api from '@/lib/api';

interface SkillTool {
  id: string;
  name: string;
  description: string;
  parameters_json: any;
  handler_type: string;
  handler_config: any;
  active: boolean;
}

interface SkillAsset {
  id: string;
  name: string;
  s3_key: string;
  mime_type: string;
  size: number;
  asset_type: 'asset' | 'reference';
  inject_mode: 'none' | 'full_text' | 'summary';
  content_text: string | null;
}

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
  // Skills V2
  description: string | null;
  triggerKeywords: string[];
  skillType: string;
  maxContextTokens: number;
  provider: string;
  tools: SkillTool[];
  assets: SkillAsset[];
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
  // Skills V2
  description: string;
  triggerKeywords: string;
  provider: string;
}

const OPENAI_MODELS = [
  { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini — rápido, inteligente' },
  { value: 'gpt-5.1', label: 'GPT-5.1 — conversacional avançado' },
  { value: 'gpt-4.1', label: 'GPT-4.1 — analítico' },
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini — balanceado' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini — rápido, econômico' },
  { value: 'gpt-4o', label: 'GPT-4o — capaz' },
  { value: 'o1-mini', label: 'o1 Mini — raciocínio' },
];

const ANTHROPIC_MODELS = [
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 — balanceado' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — rápido, econômico' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6 — máxima capacidade' },
];

const AVAILABLE_MODELS = [...OPENAI_MODELS, ...ANTHROPIC_MODELS];

const TEMPLATE_VARS = [
  { key: '{{lead_name}}', desc: 'Nome do cliente' },
  { key: '{{lead_phone}}', desc: 'Telefone' },
  { key: '{{legal_area}}', desc: 'Área jurídica detectada' },
  { key: '{{firm_name}}', desc: 'Nome do escritório' },
  { key: '{{lead_memory}}', desc: 'Memória do lead (resumo + fatos)' },
  { key: '{{lead_summary}}', desc: 'Resumo do caso' },
  { key: '{{conversation_id}}', desc: 'ID da conversa (para URLs)' },
  { key: '{{history_summary}}', desc: 'Resumo do histórico' },
  { key: '{{site_url}}', desc: 'URL base do site (ex: para links de LP)' },
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
  description: '',
  triggerKeywords: '',
  provider: 'openai',
};

const DEFAULT_DJEN_PROMPT = `Você é um assistente jurídico especializado em análise de publicações do DJEN (Diário da Justiça Eletrônico) brasileiro. Analise a publicação e retorne um JSON com os campos abaixo. Extraia as informações DIRETAMENTE do texto da publicação quando disponíveis — não invente dados.

Campos obrigatórios:
- resumo: string (máx 3 frases, PT-BR, linguagem direta para o advogado)
- urgencia: "URGENTE" | "NORMAL" | "BAIXA"
- tipo_acao: string (ação concreta que o advogado deve tomar)
- prazo_dias: number (prazo em dias ÚTEIS)
- estagio_sugerido: string | null (um de: DISTRIBUIDO, CITACAO, CONTESTACAO, REPLICA, PERICIA_AGENDADA, INSTRUCAO, JULGAMENTO, RECURSO, TRANSITADO, EXECUCAO, ENCERRADO)
- tarefa_titulo: string (título curto da tarefa)
- tarefa_descricao: string (descrição da tarefa, máx 200 chars)
- orientacoes: string (observações estratégicas, máx 300 chars)
- event_type: "AUDIENCIA" | "PRAZO" | "TAREFA" (AUDIENCIA se há audiência/sessão/julgamento com data marcada no texto; PRAZO se há prazo processual para o advogado cumprir; TAREFA para outros casos)

Campos de extração (null se não encontrado no texto):
- parte_autora: string | null (nome do autor/requerente/exequente)
- parte_rea: string | null (nome do réu/requerido/executado)
- juizo: string | null (vara, juízo ou tribunal onde tramita)
- area_juridica: string | null (ex: "Trabalhista", "Cível", "Previdenciário", "Criminal", "Consumidor", "Família", "Tributário")
- valor_causa: string | null (valor da causa se mencionado, formato "R$ X.XXX,XX")
- data_audiencia: string | null (data e hora da audiência/sessão/perícia se mencionada EXPLICITAMENTE NO TEXTO, formato ISO "YYYY-MM-DDTHH:MM:00". IMPORTANTE: se a publicação for de perícia previdenciária (INSS) e não constar data no texto, retorne null — NÃO calcule nem invente data. Retorne null também se não for publicação de audiência ou perícia.)
- data_prazo: string | null (data limite do prazo processual se mencionada NO TEXTO, formato ISO "YYYY-MM-DDTHH:MM:00", null se não houver prazo com data explícita)

Critérios de urgência: URGENTE = citação/intimação com prazo curto (≤15 dias), sentença, audiência marcada, perícia designada. NORMAL = contestação, manifestação, despacho de rotina. BAIXA = distribuição, informativo, arquivamento.
Critérios de estágio: citação→CITACAO, contestação→CONTESTACAO, réplica→REPLICA, perícia/laudo/perito designado→PERICIA_AGENDADA, audiência/instrução→INSTRUCAO, sentença/julgamento→JULGAMENTO, recurso→RECURSO, trânsito em julgado→TRANSITADO, execução→EXECUCAO, distribuição→DISTRIBUIDO, encerramento/extinção→ENCERRADO.
Critérios de event_type: use AUDIENCIA apenas se houver data/hora explícita no texto para audiência ou sessão. Para perícia sem data explícita no texto use TAREFA. Para prazos com data explícita use PRAZO. Nos demais casos use TAREFA.`;

const DEFAULT_DJEN_NOTIFY_TEMPLATE = `⚖️ *Movimentação no seu processo*

Olá {{nome}}! Houve uma nova movimentação no seu processo nº {{processo}}.

📋 *Tipo:* {{tipo}}
📝 *Assunto:* {{assunto}}
📅 *Data:* {{data}}

📖 *O que aconteceu:*
{{resumo}}

📊 *Fase atual do processo:*
{{fase_processo}}

⏰ *Prazo:* {{prazo}}
📍 *Local:* {{local_evento}}

✅ *Próximo passo:* {{proximo_passo}}

💡 *Orientação:* {{orientacao}}

Nosso advogado já foi notificado e está acompanhando. Se tiver dúvidas, pode nos chamar aqui!

André Lustosa Advogados`;

export default function AiSettingsPage() {
  // Config global
  const [apiKey, setApiKey] = useState('');
  const [adminKey, setAdminKey] = useState('');
  const [defaultModel, setDefaultModel] = useState('gpt-4o-mini');
  const [djenModel, setDjenModel] = useState('gpt-4o-mini');
  const [djenPrompt, setDjenPrompt] = useState(DEFAULT_DJEN_PROMPT);
  const [djenPromptIsCustom, setDjenPromptIsCustom] = useState(false);
  const [showDjenPrompt, setShowDjenPrompt] = useState(false);
  const [djenNotifyTemplate, setDjenNotifyTemplate] = useState(DEFAULT_DJEN_NOTIFY_TEMPLATE);
  const [djenNotifyTemplateIsCustom, setDjenNotifyTemplateIsCustom] = useState(false);
  const [showDjenNotifyTemplate, setShowDjenNotifyTemplate] = useState(false);
  const [adminBotEnabled, setAdminBotEnabled] = useState(true);
  const [cooldownSeconds, setCooldownSeconds] = useState(8);
  const [isConfigured, setIsConfigured] = useState(false);
  const [isAdminKeyConfigured, setIsAdminKeyConfigured] = useState(false);
  const [isEditingKey, setIsEditingKey] = useState(false);
  const [isEditingAdminKey, setIsEditingAdminKey] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [showAdminKey, setShowAdminKey] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [savedConfig, setSavedConfig] = useState(false);
  const [loading, setLoading] = useState(true);

  // Anthropic Key
  const [anthropicKey, setAnthropicKey] = useState('');
  const [isAnthropicKeyConfigured, setIsAnthropicKeyConfigured] = useState(false);
  const [isEditingAnthropicKey, setIsEditingAnthropicKey] = useState(false);
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);

  // TTS
  const [ttsEnabled, setTtsEnabled]         = useState(false);
  const [ttsConfigured, setTtsConfigured]   = useState(false);
  const [ttsGoogleApiKey, setTtsGoogleApiKey] = useState('');
  const [ttsVoice, setTtsVoice]             = useState('pt-BR-Neural2-B');
  const [isEditingTtsKey, setIsEditingTtsKey] = useState(false);
  const [showTtsKey, setShowTtsKey]         = useState(false);
  const [savingTts, setSavingTts]           = useState(false);
  const [savedTts, setSavedTts]             = useState(false);

  // Skills
  const [skills, setSkills] = useState<Skill[]>([]);
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<SkillForm>(BLANK_FORM);
  const [savingSkill, setSavingSkill] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const fetchData = useCallback(async () => {
    try {
      const [configRes, skillsRes, ttsRes] = await Promise.all([
        api.get('/settings/ai-config'),
        api.get('/settings/skills'),
        api.get('/settings/tts'),
      ]);
      setIsConfigured(configRes.data.isConfigured);
      setIsAdminKeyConfigured(configRes.data.isAdminKeyConfigured ?? false);
      setIsAnthropicKeyConfigured(configRes.data.isAnthropicKeyConfigured ?? false);
      setDefaultModel(configRes.data.defaultModel || 'gpt-4o-mini');
      setDjenModel(configRes.data.djenModel || 'gpt-4o-mini');
      setDjenPrompt(configRes.data.djenPrompt || DEFAULT_DJEN_PROMPT);
      setDjenPromptIsCustom(configRes.data.djenPromptIsCustom ?? false);
      setDjenNotifyTemplate(configRes.data.djenNotifyTemplate || DEFAULT_DJEN_NOTIFY_TEMPLATE);
      setDjenNotifyTemplateIsCustom(configRes.data.djenNotifyTemplateIsCustom ?? false);
      setAdminBotEnabled(configRes.data.adminBotEnabled ?? true);
      setCooldownSeconds(configRes.data.cooldownSeconds ?? 8);
      setSkills(skillsRes.data);
      setTtsEnabled(ttsRes.data.enabled ?? false);
      setTtsConfigured(ttsRes.data.isConfigured ?? false);
      setTtsVoice(ttsRes.data.voice || 'pt-BR-Neural2-B');
    } catch (e) {
      console.error('Erro ao carregar dados:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ---------- Config Global ----------
  const handleSaveConfig = async () => {
    setSavingConfig(true);
    try {
      // Se prompt/template é igual ao default do código, envia vazio para limpar o banco
      // Isso garante que atualizações futuras do default no código sejam aplicadas automaticamente
      const effectiveDjenPrompt = djenPrompt === DEFAULT_DJEN_PROMPT ? '' : djenPrompt;
      const effectiveDjenNotifyTemplate = djenNotifyTemplate === DEFAULT_DJEN_NOTIFY_TEMPLATE ? '' : djenNotifyTemplate;
      const payload: any = { defaultModel, djenModel, djenPrompt: effectiveDjenPrompt, djenNotifyTemplate: effectiveDjenNotifyTemplate, adminBotEnabled, cooldownSeconds };
      if (apiKey.trim())       payload.apiKey         = apiKey.trim();
      if (adminKey.trim())     payload.adminKey       = adminKey.trim();
      if (anthropicKey.trim()) payload.anthropicApiKey = anthropicKey.trim();
      await api.post('/settings/ai-config', payload);
      if (apiKey.trim())       setIsConfigured(true);
      if (adminKey.trim())     setIsAdminKeyConfigured(true);
      if (anthropicKey.trim()) setIsAnthropicKeyConfigured(true);
      setIsEditingKey(false);
      setIsEditingAdminKey(false);
      setIsEditingAnthropicKey(false);
      setApiKey('');
      setAdminKey('');
      setAnthropicKey('');
      setSavedConfig(true);
      setTimeout(() => setSavedConfig(false), 3000);
    } catch (e) {
      console.error('Erro ao salvar config IA:', e);
      alert('Erro ao salvar. Verifique se você é administrador.');
    } finally {
      setSavingConfig(false);
    }
  };

  // ---------- TTS ----------
  const handleSaveTts = async () => {
    setSavingTts(true);
    try {
      const payload: any = { enabled: ttsEnabled, voice: ttsVoice };
      if (ttsGoogleApiKey.trim()) payload.googleApiKey = ttsGoogleApiKey.trim();
      await api.patch('/settings/tts', payload);
      if (ttsGoogleApiKey.trim()) setTtsConfigured(true);
      setIsEditingTtsKey(false);
      setTtsGoogleApiKey('');
      setSavedTts(true);
      setTimeout(() => setSavedTts(false), 3000);
    } catch (e) {
      console.error('Erro ao salvar TTS:', e);
      alert('Erro ao salvar configuração TTS.');
    } finally {
      setSavingTts(false);
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
      description: skill.description || '',
      triggerKeywords: (skill.triggerKeywords || []).join(', '),
      provider: skill.provider || 'openai',
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
        description: form.description.trim() || null,
        trigger_keywords: form.triggerKeywords.split(',').map((k: string) => k.trim()).filter(Boolean),
        provider: form.provider,
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
      'gpt-5.4-mini': 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      'gpt-4.1': 'bg-purple-500/10 text-purple-400 border-purple-500/20',
      'gpt-4.1-mini': 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
      'o1-mini': 'bg-pink-500/10 text-pink-400 border-pink-500/20',
      'claude-sonnet-4-6': 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      'claude-haiku-4-5': 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      'claude-opus-4-6': 'bg-orange-500/10 text-orange-400 border-orange-500/20',
    };
    return colors[model] || 'bg-muted text-muted-foreground border-border';
  };

  const providerModels = form.provider === 'anthropic' ? ANTHROPIC_MODELS : OPENAI_MODELS;

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
          </div>

          {loading ? (
            <div className="p-6 flex items-center justify-center">
              <RefreshCw className="animate-spin text-muted-foreground" size={20} />
            </div>
          ) : (
            <div className="p-5 space-y-4">
              {/* Modelo padrão (sempre visível) */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Modelo padrão (Chat / Skills)</label>
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

              {/* Modelo DJEN */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <span>⚖️</span> Modelo para análise DJEN
                </label>
                <select
                  value={djenModel}
                  onChange={(e) => setDjenModel(e.target.value)}
                  className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-primary/50 transition-all"
                >
                  <optgroup label="OpenAI">
                    {[
                      { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini — rápido, inteligente' },
                      { value: 'gpt-4o-mini',  label: 'GPT-4o Mini — rápido, econômico' },
                      { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini — balanceado' },
                      { value: 'gpt-4.1',      label: 'GPT-4.1 — analítico avançado' },
                      { value: 'gpt-4o',       label: 'GPT-4o — alta precisão' },
                    ].map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Anthropic (requer API Key Anthropic)">
                    {[
                      { value: 'claude-haiku-4-5',  label: 'Claude Haiku 4.5 — rápido, econômico' },
                      { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 — balanceado, preciso' },
                      { value: 'claude-opus-4-6',   label: 'Claude Opus 4.6 — máxima capacidade' },
                    ].map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </optgroup>
                </select>
                <p className="text-[11px] text-muted-foreground">
                  Modelo usado pelo botão <strong>Analisar IA</strong> na página de publicações DJEN.
                  Modelos Anthropic exigem a API Key Anthropic configurada abaixo.
                </p>
              </div>

              {/* Prompt DJEN */}
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => setShowDjenPrompt((v) => !v)}
                  className="flex items-center gap-2 text-xs font-bold text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors w-full text-left"
                >
                  <span>⚖️</span> Prompt de análise DJEN
                  <span className="ml-auto text-[10px] font-normal text-primary">
                    {showDjenPrompt ? '▲ fechar' : '▼ editar'}
                  </span>
                </button>
                {showDjenPrompt && (
                  <div className="space-y-1.5">
                    <textarea
                      value={djenPrompt}
                      onChange={(e) => setDjenPrompt(e.target.value)}
                      rows={20}
                      className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2.5 text-xs font-mono outline-none focus:border-primary/50 transition-all resize-y"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Prompt do sistema enviado à IA ao analisar publicações DJEN. Deixe vazio para usar o prompt padrão.<br />
                      <strong>Atenção:</strong> o retorno deve ser sempre um JSON com os campos obrigatórios (resumo, urgencia, event_type, data_audiencia, data_prazo, etc.).
                    </p>
                    {djenPromptIsCustom && (
                      <button
                        type="button"
                        onClick={() => { setDjenPrompt(DEFAULT_DJEN_PROMPT); setDjenPromptIsCustom(false); }}
                        className="text-[11px] text-destructive hover:underline"
                      >
                        Restaurar prompt padrão do sistema
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Template de notificação ao cliente (DJEN) */}
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => setShowDjenNotifyTemplate((v) => !v)}
                  className="flex items-center gap-2 text-xs font-bold text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors w-full text-left"
                >
                  <span>📱</span> Template de notificação ao cliente (DJEN)
                  <span className="ml-auto text-[10px] font-normal text-primary">
                    {showDjenNotifyTemplate ? '▲ fechar' : '▼ editar'}
                  </span>
                </button>
                {showDjenNotifyTemplate && (
                  <div className="space-y-1.5">
                    <textarea
                      value={djenNotifyTemplate}
                      onChange={(e) => setDjenNotifyTemplate(e.target.value)}
                      rows={18}
                      className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2.5 text-xs font-mono outline-none focus:border-primary/50 transition-all resize-y"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Mensagem enviada via WhatsApp ao cliente quando uma publicação DJEN é vinculada ao processo dele.<br />
                      Linhas com variáveis vazias são removidas automaticamente.<br />
                      <strong>Variáveis:</strong>{' '}
                      <code className="text-[10px] bg-muted px-1 rounded">{'{{nome}}'}</code>{' '}
                      <code className="text-[10px] bg-muted px-1 rounded">{'{{processo}}'}</code>{' '}
                      <code className="text-[10px] bg-muted px-1 rounded">{'{{tipo}}'}</code>{' '}
                      <code className="text-[10px] bg-muted px-1 rounded">{'{{data}}'}</code>{' '}
                      <code className="text-[10px] bg-muted px-1 rounded">{'{{assunto}}'}</code>{' '}
                      <code className="text-[10px] bg-muted px-1 rounded">{'{{resumo}}'}</code>{' '}
                      <code className="text-[10px] bg-muted px-1 rounded">{'{{fase_processo}}'}</code>{' '}
                      <code className="text-[10px] bg-muted px-1 rounded">{'{{prazo}}'}</code>{' '}
                      <code className="text-[10px] bg-muted px-1 rounded">{'{{local_evento}}'}</code>{' '}
                      <code className="text-[10px] bg-muted px-1 rounded">{'{{proximo_passo}}'}</code>{' '}
                      <code className="text-[10px] bg-muted px-1 rounded">{'{{orientacao}}'}</code>
                    </p>
                    {djenNotifyTemplateIsCustom && (
                      <button
                        type="button"
                        onClick={() => { setDjenNotifyTemplate(DEFAULT_DJEN_NOTIFY_TEMPLATE); setDjenNotifyTemplateIsCustom(false); }}
                        className="text-[11px] text-destructive hover:underline"
                      >
                        Restaurar template padrão
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Admin Command Bot */}
              <div className="flex items-center justify-between py-1">
                <div className="space-y-0.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                    <span>🤖</span> Bot de Comando Admin (WhatsApp)
                  </label>
                  <p className="text-[11px] text-muted-foreground">
                    Permite controlar o CRM enviando mensagens para o número do escritório.
                    {!adminBotEnabled && <span className="text-amber-500 font-semibold ml-1">Desativado — admins serão atendidos como clientes normais.</span>}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setAdminBotEnabled((v) => !v)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${adminBotEnabled ? 'bg-primary' : 'bg-muted'}`}
                >
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${adminBotEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
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

              {/* ── API Key (regular) ── */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">API Key OpenAI</label>
                  <button
                    onClick={() => { setIsEditingKey(!isEditingKey); setApiKey(''); setShowKey(false); }}
                    className="text-xs font-bold text-primary hover:underline"
                  >
                    {isEditingKey ? 'Cancelar' : isConfigured ? 'Trocar' : 'Configurar'}
                  </button>
                </div>
                {isEditingKey ? (
                  <div className="space-y-1.5">
                    <div className="relative">
                      <input
                        type={showKey ? 'text' : 'password'}
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="sk-proj-..."
                        className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 pr-10 text-sm outline-none focus:border-primary/50 transition-all font-mono"
                        autoFocus
                      />
                      <button type="button" onClick={() => setShowKey(!showKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                        {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">Obtenha em <span className="font-mono text-primary">platform.openai.com/api-keys</span></p>
                  </div>
                ) : (
                  <div className="flex items-center justify-between text-xs bg-muted/30 rounded-xl px-4 py-2.5">
                    <span className="text-muted-foreground">Usada pelo worker para chamadas à IA</span>
                    {isConfigured ? (
                      <span className="flex items-center gap-1.5 text-emerald-500 font-bold"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> CONFIGURADO</span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-amber-500 font-bold"><div className="w-1.5 h-1.5 rounded-full bg-amber-500" /> NÃO CONFIGURADO</span>
                    )}
                  </div>
                )}
              </div>

              {/* ── Admin Key (para Custos de IA) ── */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Admin Key OpenAI</label>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Necessária para acompanhar custos reais em <strong>Custos IA</strong>.</p>
                  </div>
                  <button
                    onClick={() => { setIsEditingAdminKey(!isEditingAdminKey); setAdminKey(''); setShowAdminKey(false); }}
                    className="text-xs font-bold text-primary hover:underline shrink-0 ml-4"
                  >
                    {isEditingAdminKey ? 'Cancelar' : isAdminKeyConfigured ? 'Trocar' : 'Configurar'}
                  </button>
                </div>
                {isEditingAdminKey ? (
                  <div className="space-y-1.5">
                    <div className="relative">
                      <input
                        type={showAdminKey ? 'text' : 'password'}
                        value={adminKey}
                        onChange={(e) => setAdminKey(e.target.value)}
                        placeholder="sk-admin-..."
                        className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 pr-10 text-sm outline-none focus:border-primary/50 transition-all font-mono"
                        autoFocus
                      />
                      <button type="button" onClick={() => setShowAdminKey(!showAdminKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                        {showAdminKey ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Crie em <span className="font-mono text-primary">platform.openai.com/settings/organization/admin-keys</span>
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center justify-between text-xs bg-muted/30 rounded-xl px-4 py-2.5">
                    <span className="text-muted-foreground">Acessa a API de custos da organização</span>
                    {isAdminKeyConfigured ? (
                      <span className="flex items-center gap-1.5 text-emerald-500 font-bold"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> CONFIGURADO</span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-amber-500 font-bold"><div className="w-1.5 h-1.5 rounded-full bg-amber-500" /> NÃO CONFIGURADO</span>
                    )}
                  </div>
                )}
              </div>

              {/* ── API Key Anthropic Claude ── */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">API Key Anthropic Claude</label>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Necessária para skills que usam provider &quot;Anthropic Claude&quot;.</p>
                  </div>
                  <button
                    onClick={() => { setIsEditingAnthropicKey(!isEditingAnthropicKey); setAnthropicKey(''); setShowAnthropicKey(false); }}
                    className="text-xs font-bold text-primary hover:underline shrink-0 ml-4"
                  >
                    {isEditingAnthropicKey ? 'Cancelar' : isAnthropicKeyConfigured ? 'Trocar' : 'Configurar'}
                  </button>
                </div>
                {isEditingAnthropicKey ? (
                  <div className="space-y-1.5">
                    <div className="relative">
                      <input
                        type={showAnthropicKey ? 'text' : 'password'}
                        value={anthropicKey}
                        onChange={(e) => setAnthropicKey(e.target.value)}
                        placeholder="sk-ant-..."
                        className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 pr-10 text-sm outline-none focus:border-primary/50 transition-all font-mono"
                        autoFocus
                      />
                      <button type="button" onClick={() => setShowAnthropicKey(!showAnthropicKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                        {showAnthropicKey ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Obtenha em <span className="font-mono text-primary">console.anthropic.com/settings/keys</span>
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center justify-between text-xs bg-muted/30 rounded-xl px-4 py-2.5">
                    <span className="text-muted-foreground">Usada por skills com provider Anthropic</span>
                    {isAnthropicKeyConfigured ? (
                      <span className="flex items-center gap-1.5 text-emerald-500 font-bold"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> CONFIGURADO</span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-muted-foreground font-bold"><div className="w-1.5 h-1.5 rounded-full bg-muted-foreground" /> NÃO CONFIGURADO</span>
                    )}
                  </div>
                )}
              </div>

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
                        {skill.provider === 'anthropic' && (
                          <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">
                            Anthropic
                          </span>
                        )}
                        {(skill.tools?.length || 0) > 0 && (
                          <span className="text-[10px] font-bold text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-1.5 py-0.5 rounded">
                            {skill.tools.length} tool{skill.tools.length > 1 ? 's' : ''}
                          </span>
                        )}
                        {(skill.assets?.length || 0) > 0 && (
                          <span className="text-[10px] font-bold text-green-400 bg-green-500/10 border border-green-500/20 px-1.5 py-0.5 rounded">
                            {skill.assets.length} arquivo{skill.assets.length > 1 ? 's' : ''}
                          </span>
                        )}
                        {skill.handoffSignal && (
                          <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">
                            escalada: {skill.handoffSignal}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate max-w-xl">
                        {skill.description || (skill.systemPrompt || '').slice(0, 80)}{!skill.description && skill.systemPrompt?.length > 80 ? '…' : ''}
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
                      skillId={form.id}
                      tools={skills.find(s => s.id === form.id)?.tools || []}
                      assets={skills.find(s => s.id === form.id)?.assets || []}
                      onRefresh={fetchData}
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
                    skillId={null}
                    tools={[]}
                    assets={[]}
                    onRefresh={fetchData}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Text-to-Speech ── */}
        <div className="bg-card/50 rounded-2xl border border-border overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                <Volume2 size={15} className="text-emerald-400" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-foreground">Text-to-Speech</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">Converte respostas da IA em mensagens de voz no WhatsApp</p>
              </div>
            </div>
            {/* Toggle ativar/desativar */}
            <label className="flex items-center gap-2.5 cursor-pointer">
              <div
                onClick={() => setTtsEnabled(!ttsEnabled)}
                className={`relative w-10 h-5.5 rounded-full transition-all cursor-pointer ${ttsEnabled ? 'bg-emerald-500' : 'bg-muted'}`}
                style={{ width: 40, height: 22 }}
              >
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all shadow ${ttsEnabled ? 'left-5' : 'left-0.5'}`} />
              </div>
              <span className={`text-xs font-bold ${ttsEnabled ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                {ttsEnabled ? 'Ativo' : 'Inativo'}
              </span>
            </label>
          </div>

          <div className="p-5 space-y-5">
            {/* Google API Key */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">API Key Google Cloud TTS</label>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Obtenha em <span className="font-mono text-primary">console.cloud.google.com → Text-to-Speech API</span>
                  </p>
                </div>
                <button
                  onClick={() => { setIsEditingTtsKey(!isEditingTtsKey); setTtsGoogleApiKey(''); setShowTtsKey(false); }}
                  className="text-xs font-bold text-primary hover:underline shrink-0 ml-4"
                >
                  {isEditingTtsKey ? 'Cancelar' : ttsConfigured ? 'Trocar' : 'Configurar'}
                </button>
              </div>
              {isEditingTtsKey ? (
                <div className="space-y-1.5">
                  <div className="relative">
                    <input
                      type={showTtsKey ? 'text' : 'password'}
                      value={ttsGoogleApiKey}
                      onChange={(e) => setTtsGoogleApiKey(e.target.value)}
                      placeholder="AIza..."
                      className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 pr-10 text-sm outline-none focus:border-primary/50 transition-all font-mono"
                      autoFocus
                    />
                    <button type="button" onClick={() => setShowTtsKey(!showTtsKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                      {showTtsKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between text-xs bg-muted/30 rounded-xl px-4 py-2.5">
                  <span className="text-muted-foreground">Chave de API para síntese de voz</span>
                  {ttsConfigured ? (
                    <span className="flex items-center gap-1.5 text-emerald-500 font-bold"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> CONFIGURADO</span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-amber-500 font-bold"><div className="w-1.5 h-1.5 rounded-full bg-amber-500" /> NÃO CONFIGURADO</span>
                  )}
                </div>
              )}
            </div>

            {/* Seleção de voz */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Voz</label>
              <select
                value={ttsVoice}
                onChange={(e) => setTtsVoice(e.target.value)}
                className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-primary/50 transition-all"
              >
                <optgroup label="Gemini — Suaves e Acolhedoras">
                  <option value="Sulafat">Sulafat — Quente</option>
                  <option value="Vindemiatrix">Vindemiatrix — Gentil</option>
                  <option value="Achernar">Achernar — Suave</option>
                  <option value="Achird">Achird — Amigável</option>
                  <option value="Aoede">Aoede — Leve</option>
                  <option value="Leda">Leda — Jovial</option>
                </optgroup>
                <optgroup label="Gemini — Profissionais e Claras">
                  <option value="Kore">Kore — Firme</option>
                  <option value="Charon">Charon — Informativo</option>
                  <option value="Iapetus">Iapetus — Claro</option>
                  <option value="Erinome">Erinome — Claro</option>
                  <option value="Schedar">Schedar — Equilibrado</option>
                  <option value="Sadaltager">Sadaltager — Sábio</option>
                  <option value="Rasalgethi">Rasalgethi — Informativo</option>
                </optgroup>
                <optgroup label="Gemini — Animadas e Energéticas">
                  <option value="Puck">Puck — Animado</option>
                  <option value="Zephyr">Zephyr — Brilhante</option>
                  <option value="Fenrir">Fenrir — Empolgado</option>
                  <option value="Laomedeia">Laomedeia — Animado</option>
                  <option value="Sadachbia">Sadachbia — Vivaz</option>
                  <option value="Autonoe">Autonoe — Brilhante</option>
                </optgroup>
                <optgroup label="Gemini — Relaxadas e Casuais">
                  <option value="Algieba">Algieba — Suave</option>
                  <option value="Despina">Despina — Suave</option>
                  <option value="Callirrhoe">Callirrhoe — Tranquilo</option>
                  <option value="Umbriel">Umbriel — Tranquilo</option>
                  <option value="Zubenelgenubi">Zubenelgenubi — Casual</option>
                  <option value="Enceladus">Enceladus — Sussurrante</option>
                </optgroup>
                <optgroup label="Gemini — Maduras e Fortes">
                  <option value="Orus">Orus — Firme</option>
                  <option value="Alnilam">Alnilam — Firme</option>
                  <option value="Gacrux">Gacrux — Maduro</option>
                  <option value="Algenib">Algenib — Grave</option>
                  <option value="Pulcherrima">Pulcherrima — Projetado</option>
                </optgroup>
              </select>
              <p className="text-[11px] text-muted-foreground">
                Vozes Gemini são naturais e aceitam instruções de estilo. Teste em <span className="font-mono text-primary">aistudio.google.com</span>
              </p>
            </div>

            {/* Botão salvar */}
            <div className="flex justify-end pt-1">
              <button
                onClick={handleSaveTts}
                disabled={savingTts}
                className="bg-primary text-primary-foreground px-6 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-primary/90 transition-all disabled:opacity-50 shadow-lg shadow-primary/20"
              >
                {savingTts ? (
                  <RefreshCw className="animate-spin" size={15} />
                ) : savedTts ? (
                  <CheckCircle2 size={15} className="text-emerald-300" />
                ) : (
                  <CheckCircle2 size={15} />
                )}
                {savedTts ? 'Salvo!' : 'Salvar TTS'}
              </button>
            </div>
          </div>
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
  skillId,
  tools,
  assets,
  onRefresh,
}: {
  form: SkillForm;
  setForm: React.Dispatch<React.SetStateAction<SkillForm>>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  insertVar: (v: string) => void;
  skillId: string | null;
  tools: SkillTool[];
  assets: SkillAsset[];
  onRefresh: () => void;
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

      {/* V2: Descrição + Trigger Keywords */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Descrição <span className="normal-case font-normal">(para o router)</span></label>
          <input
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="Ex: Especialista em direito do trabalho. Coleta ficha trabalhista."
            className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-primary/50 transition-all"
          />
          <p className="text-[10px] text-muted-foreground">Descrição curta usada pelo router inteligente para decidir quando ativar esta skill</p>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Trigger Keywords</label>
          <input
            value={form.triggerKeywords}
            onChange={(e) => setForm((f) => ({ ...f, triggerKeywords: e.target.value }))}
            placeholder="trabalhista, CLT, demissão, salário"
            className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-primary/50 transition-all"
          />
          <p className="text-[10px] text-muted-foreground">Palavras-chave separadas por vírgula (hints para o router)</p>
        </div>
      </div>

      {/* Provider + Modelo + Tokens + Temperatura */}
      <div className="grid grid-cols-4 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Provider</label>
          <select
            value={form.provider}
            onChange={(e) => {
              const p = e.target.value;
              const defaultModel = p === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o-mini';
              setForm((f) => ({ ...f, provider: p, model: defaultModel }));
            }}
            className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-primary/50 transition-all"
          >
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic Claude</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Modelo</label>
          <select
            value={form.model}
            onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
            className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-primary/50 transition-all"
          >
            {(form.provider === 'anthropic' ? ANTHROPIC_MODELS : OPENAI_MODELS).map((m) => (
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

      {/* ── Tools (apenas para skills já salvas) ── */}
      {skillId && (
        <div className="space-y-2 border border-border/50 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Ferramentas ({tools.length})</label>
            <button
              onClick={async () => {
                const name = prompt('Nome da ferramenta (ex: book_appointment):');
                if (!name) return;
                const desc = prompt('Descrição (ex: Agendar reunião com o advogado):') || '';
                try {
                  await api.post(`/settings/skills/${skillId}/tools`, {
                    name: name.trim(),
                    description: desc.trim(),
                    parameters_json: { type: 'object', properties: {} },
                    handler_type: 'builtin',
                    handler_config: { builtin: name.trim() },
                  });
                  onRefresh();
                } catch { alert('Erro ao criar ferramenta'); }
              }}
              className="text-[11px] font-bold text-primary hover:underline"
            >
              + Adicionar
            </button>
          </div>
          {tools.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">Nenhuma ferramenta configurada. Skills sem tools usam o modo JSON legado.</p>
          ) : (
            <div className="space-y-1.5">
              {tools.map((tool) => (
                <div key={tool.id} className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] font-bold text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-1.5 py-0.5 rounded">
                      {tool.handler_type}
                    </span>
                    <span className="text-sm font-mono font-bold text-foreground">{tool.name}</span>
                    <span className="text-[11px] text-muted-foreground truncate">{tool.description}</span>
                  </div>
                  <button
                    onClick={async () => {
                      if (!confirm(`Excluir ferramenta "${tool.name}"?`)) return;
                      try {
                        await api.delete(`/settings/skills/tools/${tool.id}`);
                        onRefresh();
                      } catch { alert('Erro ao excluir'); }
                    }}
                    className="p-1 text-muted-foreground hover:text-red-400 transition-colors shrink-0"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Assets & References (apenas para skills já salvas) ── */}
      {skillId && (
        <div className="space-y-2 border border-border/50 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Arquivos e Referências ({assets.length})</label>
            <label className="text-[11px] font-bold text-primary hover:underline cursor-pointer">
              + Upload
              <input
                type="file"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const isRef = file.name.endsWith('.md') || file.name.endsWith('.txt');
                  const formData = new FormData();
                  formData.append('file', file);
                  formData.append('asset_type', isRef ? 'reference' : 'asset');
                  formData.append('inject_mode', isRef ? 'full_text' : 'none');
                  try {
                    await api.post(`/settings/skills/${skillId}/assets`, formData, {
                      headers: { 'Content-Type': 'multipart/form-data' },
                    });
                    onRefresh();
                  } catch { alert('Erro no upload'); }
                  e.target.value = '';
                }}
              />
            </label>
          </div>
          {assets.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">Nenhum arquivo. References (.md/.txt) são injetadas no prompt. Assets ficam disponíveis para download.</p>
          ) : (
            <div className="space-y-1.5">
              {assets.map((asset) => (
                <div key={asset.id} className="bg-muted/30 rounded-lg px-3 py-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                        asset.asset_type === 'reference'
                          ? 'text-green-400 bg-green-500/10 border-green-500/20'
                          : 'text-blue-400 bg-blue-500/10 border-blue-500/20'
                      }`}>
                        {asset.asset_type === 'reference' ? 'REF' : 'ASSET'}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const el = document.getElementById(`asset-content-${asset.id}`);
                          if (el) el.classList.toggle('hidden');
                        }}
                        className="text-sm font-medium text-foreground truncate hover:text-primary transition-colors cursor-pointer"
                      >
                        {asset.name}
                      </button>
                      <span className="text-[10px] text-muted-foreground">
                        {(asset.size / 1024).toFixed(1)} KB
                      </span>
                      {asset.asset_type === 'reference' && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          asset.inject_mode === 'full_text'
                            ? 'text-emerald-400 bg-emerald-500/10'
                            : 'text-muted-foreground bg-muted'
                        }`}>
                          {asset.inject_mode === 'full_text' ? 'injetado' : 'não injetado'}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          const el = document.getElementById(`asset-content-${asset.id}`);
                          if (el) el.classList.toggle('hidden');
                        }}
                        className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                        title="Ver/editar conteúdo"
                      >
                        <Eye size={14} />
                      </button>
                  <button
                    onClick={async () => {
                      if (!confirm(`Excluir "${asset.name}"?`)) return;
                      try {
                        await api.delete(`/settings/skills/assets/${asset.id}`);
                        onRefresh();
                      } catch { alert('Erro ao excluir'); }
                    }}
                    className="p-1 text-muted-foreground hover:text-red-400 transition-colors shrink-0"
                  >
                    <Trash2 size={13} />
                  </button>
                    </div>
                  </div>
                  {/* Conteúdo expandível da referência */}
                  {asset.content_text && (
                    <div id={`asset-content-${asset.id}`} className="hidden mt-2">
                      <textarea
                        defaultValue={asset.content_text}
                        className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-[11px] font-mono text-foreground/80 outline-none focus:border-primary/50 resize-y"
                        rows={8}
                        style={{ minHeight: '120px' }}
                        onBlur={async (e) => {
                          const newText = e.target.value;
                          if (newText === asset.content_text) return;
                          try {
                            await api.patch(`/settings/skills/assets/${asset.id}`, { content_text: newText, size: newText.length });
                            onRefresh();
                          } catch { alert('Erro ao salvar'); }
                        }}
                      />
                      <p className="text-[10px] text-muted-foreground mt-1">Edite e clique fora para salvar automaticamente.</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
