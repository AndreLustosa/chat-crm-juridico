'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Brain,
  RefreshCw,
  Trash2,
  Plus,
  Loader2,
  ChevronDown,
  ChevronUp,
  Sparkles,
  X,
} from 'lucide-react';
import api from '@/lib/api';

interface LeadMemory {
  id: string;
  content: string;
  type: string;
  confidence: number;
  source_type: string;
  created_at: string;
}

interface LeadProfile {
  id: string;
  summary: string;
  facts: any;
  generated_at: string;
  message_count: number;
  version: number;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Maceio',
    });
  } catch {
    return iso;
  }
}

interface Props {
  leadId: string;
  /** Se ADMIN/ADVOGADO — habilita adicionar/remover manual */
  canEdit?: boolean;
}

/**
 * Painel de memórias e perfil do lead — injetado no ClientPanel.
 * Mostra:
 *  - Perfil consolidado (LeadProfile.summary) com botão regenerar
 *  - Memórias semantic + episodic
 *  - Adicionar memória manual
 *  - Limpar todas (LGPD)
 */
export function LeadMemoryPanel({ leadId, canEdit = false }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<LeadProfile | null>(null);
  const [memories, setMemories] = useState<LeadMemory[]>([]);
  const [regenerating, setRegenerating] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addContent, setAddContent] = useState('');
  const [addType, setAddType] = useState<'semantic' | 'episodic'>('semantic');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!leadId) return;
    setLoading(true);
    setErr(null);
    try {
      const [profRes, memsRes] = await Promise.all([
        api.get(`/memories/lead/${leadId}/profile`),
        api.get(`/memories/lead/${leadId}`),
      ]);
      setProfile(profRes.data ?? null);
      setMemories(memsRes.data?.memories ?? []);
    } catch (e: any) {
      setErr(e?.response?.data?.message || 'Erro ao carregar memórias');
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      await api.post(`/memories/lead/${leadId}/regenerate`);
      // Dá tempo do worker processar
      setTimeout(() => load(), 8000);
    } catch (e: any) {
      setErr(e?.response?.data?.message || 'Erro ao regenerar');
      setRegenerating(false);
    }
  };

  const handleAdd = async () => {
    const content = addContent.trim();
    if (content.length < 5) {
      setErr('Conteúdo muito curto (mín. 5 caracteres)');
      return;
    }
    setSaving(true);
    try {
      await api.post(`/memories/lead/${leadId}`, { content, type: addType });
      setAddContent('');
      setAdding(false);
      setErr(null);
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.message || 'Erro ao adicionar');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remover esta memória?')) return;
    try {
      await api.delete(`/memories/${id}`);
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.message || 'Erro ao remover');
    }
  };

  const handleClearAll = async () => {
    if (!confirm('APAGAR TODAS as memórias deste contato (inclui o perfil)? Ação irreversível.'))
      return;
    try {
      await api.delete(`/memories/lead/${leadId}/all`);
      setProfile(null);
      setMemories([]);
    } catch (e: any) {
      setErr(e?.response?.data?.message || 'Erro ao limpar');
    }
  };

  const semanticMems = memories.filter((m) => m.type === 'semantic');
  const episodicMems = memories.filter((m) => m.type === 'episodic');

  return (
    <div className="border-b border-border">
      <div className="flex items-center">
        <button
          className="flex-1 px-6 py-4 flex items-center justify-between hover:bg-accent/30 transition-colors"
          onClick={() => setOpen(!open)}
        >
          <div className="flex items-center gap-2.5">
            <Sparkles size={15} className="text-fuchsia-400" />
            <span className="text-[13px] font-bold text-foreground">Memórias da IA</span>
            {memories.length > 0 && (
              <span className="text-[11px] text-muted-foreground bg-foreground/[0.06] px-2 py-0.5 rounded-full font-mono">
                {memories.length}
              </span>
            )}
            {profile && (
              <span className="text-[10px] text-muted-foreground font-mono">
                perfil v{profile.version}
              </span>
            )}
          </div>
          {open ? (
            <ChevronUp size={15} className="text-muted-foreground" />
          ) : (
            <ChevronDown size={15} className="text-muted-foreground" />
          )}
        </button>
      </div>

      {open && (
        <div className="px-6 pb-5 flex flex-col gap-4">
          {loading && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
              <Loader2 size={14} className="animate-spin" />
              Carregando...
            </div>
          )}

          {err && (
            <div className="text-[12px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {err}
            </div>
          )}

          {/* Perfil consolidado */}
          {profile && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                  Perfil Consolidado
                </p>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground">
                    {formatDate(profile.generated_at)}
                  </span>
                  {canEdit && (
                    <button
                      onClick={handleRegenerate}
                      disabled={regenerating}
                      title="Regenerar perfil"
                      className="p-1 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                    >
                      {regenerating ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <RefreshCw size={12} />
                      )}
                    </button>
                  )}
                </div>
              </div>
              <p className="text-[13px] text-foreground leading-relaxed bg-foreground/[0.03] rounded-xl p-3 border border-border whitespace-pre-wrap">
                {profile.summary}
              </p>
              {profile.facts?.pending?.length > 0 && (
                <div className="mt-2">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">
                    Pendências
                  </p>
                  <ul className="flex flex-col gap-1">
                    {profile.facts.pending.slice(0, 5).map((p: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-[12px] text-foreground">
                        <span className="text-orange-400 mt-0.5 shrink-0">•</span>
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {!profile && !loading && (
            <div className="text-center py-3 text-[12px] text-muted-foreground">
              Perfil ainda não foi gerado. Acontece na próxima extração noturna.
              {canEdit && (
                <button
                  onClick={handleRegenerate}
                  disabled={regenerating}
                  className="block mx-auto mt-2 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-[12px] font-medium hover:bg-primary/20 disabled:opacity-50"
                >
                  {regenerating ? 'Gerando...' : 'Gerar agora'}
                </button>
              )}
            </div>
          )}

          {/* Memórias semantic */}
          {semanticMems.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">
                Fatos ({semanticMems.length})
              </p>
              <ul className="flex flex-col gap-1.5">
                {semanticMems.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-start gap-2 text-[12px] text-foreground group"
                  >
                    <Brain size={12} className="text-fuchsia-400 mt-0.5 shrink-0" />
                    <span className="flex-1">{m.content}</span>
                    {canEdit && (
                      <button
                        onClick={() => handleDelete(m.id)}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-all"
                        title="Remover"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Memórias episodic */}
          {episodicMems.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">
                Episódios ({episodicMems.length})
              </p>
              <ul className="flex flex-col gap-1.5">
                {episodicMems.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-start gap-2 text-[12px] text-foreground group"
                  >
                    <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5 font-mono">
                      {formatDate(m.created_at)}
                    </span>
                    <span className="flex-1">{m.content}</span>
                    {canEdit && (
                      <button
                        onClick={() => handleDelete(m.id)}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-all"
                        title="Remover"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Adicionar manual */}
          {canEdit && (
            <div>
              {!adding ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setAdding(true);
                      setAddContent('');
                      setErr(null);
                    }}
                    className="flex items-center gap-1.5 text-[12px] text-primary hover:underline"
                  >
                    <Plus size={12} />
                    Adicionar memória manual
                  </button>
                  {(memories.length > 0 || profile) && (
                    <button
                      onClick={handleClearAll}
                      className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-red-400"
                      title="Limpar todas (LGPD)"
                    >
                      <Trash2 size={12} />
                      Limpar todas
                    </button>
                  )}
                </div>
              ) : (
                <div className="bg-foreground/[0.03] border border-border rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <label className="text-[11px] text-muted-foreground">Tipo:</label>
                    <select
                      value={addType}
                      onChange={(e) => setAddType(e.target.value as any)}
                      className="text-[11px] bg-card border border-border rounded px-2 py-1"
                    >
                      <option value="semantic">Fato (permanente)</option>
                      <option value="episodic">Episódio (interação)</option>
                    </select>
                  </div>
                  <textarea
                    value={addContent}
                    onChange={(e) => setAddContent(e.target.value)}
                    placeholder="Ex: Cliente prefere ser contactado no período da tarde"
                    className="w-full text-[12px] p-2 rounded-lg bg-card border border-border focus:outline-none focus:ring-1 focus:ring-primary min-h-[60px] resize-none"
                    autoFocus
                  />
                  <div className="flex items-center justify-end gap-2 mt-2">
                    <button
                      onClick={() => {
                        setAdding(false);
                        setAddContent('');
                        setErr(null);
                      }}
                      className="px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handleAdd}
                      disabled={saving}
                      className="px-2.5 py-1 text-[11px] font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-1"
                    >
                      {saving && <Loader2 size={10} className="animate-spin" />}
                      Salvar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {!loading && !profile && memories.length === 0 && !adding && (
            <p className="text-[12px] text-muted-foreground text-center py-1">
              Nenhuma memória ainda para este contato.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
