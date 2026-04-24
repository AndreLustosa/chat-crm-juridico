'use client';

import { useEffect, useState } from 'react';
import {
  AudioLines, Cpu, Cloud, CheckCircle2, AlertCircle, Loader2, Save,
  Search, Zap, Snail,
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

type HealthMap = Record<string, { ok: boolean; details?: any }>;

const PROVIDER_OPTIONS = [
  { value: '', label: 'Padrão do sistema' },
  { value: 'whisper-local', label: 'Whisper (servidor)' },
  { value: 'groq', label: 'Groq (nuvem)' },
];

export default function TranscricaoSettingsPage() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [providersInfo, setProvidersInfo] = useState<ProvidersResponse | null>(null);
  const [health, setHealth] = useState<HealthMap>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get('/users'),
      api.get('/transcriptions/meta/providers'),
      api.get('/transcriptions/meta/health'),
    ])
      .then(([u, p, h]) => {
        setUsers(u.data);
        setProvidersInfo(p.data);
        setHealth(h.data);
      })
      .catch((e) => showError(e?.response?.data?.message || 'Erro ao carregar'))
      .finally(() => setLoading(false));
  }, []);

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
