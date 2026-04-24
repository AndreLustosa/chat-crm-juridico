'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AudioLines, Cpu, Cloud, CheckCircle2, AlertCircle, Loader2, Save,
  Search, Zap, Snail, Eye, EyeOff, Key,
} from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

interface UserItem {
  id: string;
  name: string;
  email: string;
  roles: string[];
  transcription_provider: string | null;
}

interface ProviderInfo {
  id: string;
  label: string;
  available: boolean;
  diarize: boolean;
  speed: 'slow' | 'medium' | 'fast';
}

interface ProvidersResponse {
  providers: ProviderInfo[];
  default: string;
}

interface TranscriptionConfig {
  groqApiKey: string; // mascarado quando vem do backend (****1234)
  groqModel: string;
  whisperServiceUrl: string;
  defaultProvider: string;
  hfToken: string; // mascarado
  isGroqConfigured: boolean;
  isHfTokenConfigured: boolean;
}

type HealthMap = Record<string, { ok: boolean; details?: any }>;

const PROVIDER_OPTIONS = [
  { value: '', label: 'Padrão do sistema' },
  { value: 'whisper-local', label: 'Whisper (servidor)' },
  { value: 'groq', label: 'Groq (nuvem)' },
];

const GROQ_MODEL_OPTIONS = [
  { value: 'whisper-large-v3', label: 'whisper-large-v3 (preciso)' },
  { value: 'whisper-large-v3-turbo', label: 'whisper-large-v3-turbo (rápido)' },
];

const DEFAULT_PROVIDER_OPTIONS = [
  { value: 'whisper-local', label: 'Whisper (servidor)' },
  { value: 'groq', label: 'Groq (nuvem)' },
];

export default function TranscricaoSettingsPage() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [providersInfo, setProvidersInfo] = useState<ProvidersResponse | null>(null);
  const [health, setHealth] = useState<HealthMap>({});
  const [config, setConfig] = useState<TranscriptionConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  // Form state pra config (não preenchido com mascara — vazio = não muda)
  const [groqKeyInput, setGroqKeyInput] = useState('');
  const [showGroqKey, setShowGroqKey] = useState(false);
  const [groqModelInput, setGroqModelInput] = useState('whisper-large-v3');
  const [defaultProviderInput, setDefaultProviderInput] = useState('whisper-local');
  const [savingConfig, setSavingConfig] = useState(false);

  const reload = useCallback(() => {
    return Promise.all([
      api.get('/users'),
      api.get('/transcriptions/meta/providers'),
      api.get('/transcriptions/meta/health'),
      api.get('/settings/transcription-config'),
    ])
      .then(([u, p, h, c]) => {
        setUsers(u.data);
        setProvidersInfo(p.data);
        setHealth(h.data);
        setConfig(c.data);
        setGroqModelInput(c.data.groqModel || 'whisper-large-v3');
        setDefaultProviderInput(c.data.defaultProvider || 'whisper-local');
      });
  }, []);

  useEffect(() => {
    reload()
      .catch((e) => showError(e?.response?.data?.message || 'Erro ao carregar'))
      .finally(() => setLoading(false));
  }, [reload]);

  const saveConfig = async () => {
    setSavingConfig(true);
    try {
      const payload: any = {
        groqModel: groqModelInput,
        defaultProvider: defaultProviderInput,
      };
      // Só envia chave se o admin DIGITOU algo (vazio mantém atual)
      if (groqKeyInput.trim()) payload.groqApiKey = groqKeyInput.trim();
      await api.post('/settings/transcription-config', payload);
      setGroqKeyInput('');
      setShowGroqKey(false);
      await reload();
      showSuccess('Configurações salvas');
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao salvar');
    } finally {
      setSavingConfig(false);
    }
  };

  const updateUserProvider = async (userId: string, provider: string) => {
    setSavingId(userId);
    try {
      const value = provider === '' ? null : provider;
      await api.patch(`/users/${userId}/transcription-provider`, { provider: value });
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, transcription_provider: value } : u)),
      );
      showSuccess('Provider atualizado');
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao atualizar');
    } finally {
      setSavingId(null);
    }
  };

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    return !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <AudioLines className="h-6 w-6 text-primary" /> Transcrição de Audiência
        </h1>
        <p className="text-sm text-base-content/60 mt-1">
          Defina qual motor de transcrição cada usuário usa quando faz upload pela aba
          Transcrições do processo ou pelo menu Ferramentas.
        </p>
      </header>

      {/* Status dos providers */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-base-content/60 mb-3">
          Motores disponíveis
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(providersInfo?.providers || []).map((p) => {
            const isGroq = p.id === 'groq';
            const Icon = isGroq ? Cloud : Cpu;
            const h = health[p.id];
            return (
              <div
                key={p.id}
                className={`p-4 rounded-lg border ${p.available ? 'border-border' : 'border-red-500/30 bg-red-500/5'}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Icon className={`h-5 w-5 ${isGroq ? 'text-cyan-400' : 'text-violet-400'}`} />
                  <h3 className="font-medium">{p.label}</h3>
                  {p.available ? (
                    <span className="ml-auto inline-flex items-center gap-1 text-xs text-emerald-400">
                      <CheckCircle2 className="h-3 w-3" /> configurado
                    </span>
                  ) : (
                    <span className="ml-auto inline-flex items-center gap-1 text-xs text-red-400">
                      <AlertCircle className="h-3 w-3" /> não configurado
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-base-content/60">
                  <span className="flex items-center gap-1">
                    {p.speed === 'fast' ? <Zap className="h-3 w-3" /> : <Snail className="h-3 w-3" />}
                    {p.speed === 'fast' ? 'Rápido (~30s/h)' : 'Lento (~horas/h)'}
                  </span>
                  <span>{p.diarize ? 'Separa falantes' : 'Sem diarização'}</span>
                </div>
                {h && (
                  <p className="text-[11px] text-base-content/40 mt-2 font-mono truncate">
                    {h.ok ? 'health: ok' : `health: fail — ${h.details?.error || ''}`}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-xs text-base-content/50 mt-3">
          Provider padrão do sistema: <strong>{providersInfo?.default}</strong>
          {' '}— usado pra usuários que não têm escolha específica.
        </p>
      </section>

      {/* Configuração das chaves */}
      <section className="border border-border rounded-lg p-5 bg-accent/5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-base-content/60 mb-1 flex items-center gap-2">
          <Key className="h-4 w-4" /> Credenciais e parâmetros
        </h2>
        <p className="text-xs text-base-content/50 mb-4">
          Salvas criptografadas no banco. Sobrescrevem as variáveis de ambiente do container —
          mudanças aplicam imediatamente, sem redeploy.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Provider padrão */}
          <div>
            <label className="label text-sm">Provider padrão do sistema</label>
            <select
              value={defaultProviderInput}
              onChange={(e) => setDefaultProviderInput(e.target.value)}
              className="select select-bordered w-full"
            >
              {DEFAULT_PROVIDER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <p className="text-xs text-base-content/50 mt-1">
              Usuários sem escolha específica usam este.
            </p>
          </div>

          {/* Modelo Groq */}
          <div>
            <label className="label text-sm">Modelo Groq</label>
            <select
              value={groqModelInput}
              onChange={(e) => setGroqModelInput(e.target.value)}
              className="select select-bordered w-full"
            >
              {GROQ_MODEL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* GROQ_API_KEY */}
          <div className="md:col-span-2">
            <label className="label text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Cloud className="h-4 w-4 text-cyan-400" />
                GROQ_API_KEY
              </span>
              {config?.isGroqConfigured ? (
                <span className="text-xs text-emerald-400 inline-flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> configurada — atual: {config.groqApiKey}
                </span>
              ) : (
                <span className="text-xs text-base-content/50">não configurada</span>
              )}
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showGroqKey ? 'text' : 'password'}
                  value={groqKeyInput}
                  onChange={(e) => setGroqKeyInput(e.target.value)}
                  placeholder={
                    config?.isGroqConfigured
                      ? 'Deixe em branco para manter a atual, ou cole uma nova'
                      : 'gsk_...'
                  }
                  className="input input-bordered w-full pr-10"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowGroqKey(!showGroqKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-base-content/40 hover:text-base-content"
                >
                  {showGroqKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <p className="text-xs text-base-content/50 mt-1">
              Pegue em <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="link link-primary">console.groq.com/keys</a>.
              Free tier disponível, ~$0.02 por hora de áudio.
            </p>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={saveConfig}
            disabled={savingConfig}
            className="btn btn-primary btn-sm gap-2"
          >
            {savingConfig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar configurações
          </button>
        </div>
      </section>

      {/* Tabela de usuários */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-base-content/60">
            Atribuição por usuário
          </h2>
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-base-content/40" />
            <input
              type="text"
              placeholder="Buscar usuário..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input input-bordered input-sm w-full pl-9"
            />
          </div>
        </div>

        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-accent/20 text-xs uppercase tracking-wider text-base-content/60">
              <tr>
                <th className="text-left px-4 py-3">Usuário</th>
                <th className="text-left px-4 py-3">Email</th>
                <th className="text-left px-4 py-3">Perfil</th>
                <th className="text-left px-4 py-3 w-64">Motor de transcrição</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((u) => (
                <tr key={u.id} className="hover:bg-accent/10">
                  <td className="px-4 py-3 font-medium">{u.name}</td>
                  <td className="px-4 py-3 text-base-content/70">{u.email}</td>
                  <td className="px-4 py-3 text-xs">
                    {(u.roles || []).join(', ')}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <select
                        value={u.transcription_provider || ''}
                        onChange={(e) => updateUserProvider(u.id, e.target.value)}
                        disabled={savingId === u.id}
                        className="select select-bordered select-sm flex-1"
                      >
                        {PROVIDER_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      {savingId === u.id && (
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-base-content/50">
                    Nenhum usuário encontrado
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
