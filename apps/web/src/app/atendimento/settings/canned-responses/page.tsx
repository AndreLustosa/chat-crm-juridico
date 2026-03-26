'use client';

import { useState, useEffect } from 'react';
import { Zap, Plus, Trash2, Save, Loader2, GripVertical, Edit2, X, Check } from 'lucide-react';
import api from '@/lib/api';

interface CannedResponse {
  id: string;
  label: string;
  text: string;
}

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

export default function CannedResponsesPage() {
  const [responses, setResponses] = useState<CannedResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editText, setEditText] = useState('');

  useEffect(() => {
    api.get('/settings/canned-responses')
      .then(r => setResponses(Array.isArray(r.data) ? r.data : []))
      .catch(() => setError('Não foi possível carregar as respostas rápidas.'))
      .finally(() => setLoading(false));
  }, []);

  const save = async (updated: CannedResponse[]) => {
    setSaving(true);
    setError(null);
    try {
      await api.patch('/settings/canned-responses', { responses: updated });
      setResponses(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError('Erro ao salvar. Verifique suas permissões.');
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = () => {
    const id = genId();
    setEditingId(id);
    setEditLabel('');
    setEditText('');
    setResponses(prev => [...prev, { id, label: '', text: '' }]);
  };

  const handleDelete = (id: string) => {
    const updated = responses.filter(r => r.id !== id);
    save(updated);
  };

  const handleStartEdit = (r: CannedResponse) => {
    setEditingId(r.id);
    setEditLabel(r.label);
    setEditText(r.text);
  };

  const handleConfirmEdit = () => {
    if (!editingId) return;
    if (!editLabel.trim() || !editText.trim()) {
      // Se vazio, remover
      const updated = responses.filter(r => r.id !== editingId);
      setEditingId(null);
      save(updated);
      return;
    }
    const updated = responses.map(r =>
      r.id === editingId ? { ...r, label: editLabel.trim(), text: editText.trim() } : r
    );
    setEditingId(null);
    save(updated);
  };

  const handleCancelEdit = () => {
    // Se o item estava em branco (recém-adicionado), remover
    const current = responses.find(r => r.id === editingId);
    if (current && !current.label && !current.text) {
      setResponses(prev => prev.filter(r => r.id !== editingId));
    }
    setEditingId(null);
  };

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Zap className="text-primary" size={22} />
          <h1 className="text-2xl font-bold">Respostas Rápidas</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Crie atalhos de texto para respostas frequentes. Use <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border text-[11px] font-mono">/</kbd> no chat para inserir rapidamente.
        </p>
      </div>

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
              {responses.length} resposta{responses.length !== 1 ? 's' : ''} cadastrada{responses.length !== 1 ? 's' : ''}
            </h2>
            {saving && <Loader2 size={13} className="animate-spin text-muted-foreground" />}
            {saved && !saving && <span className="text-xs text-emerald-400 font-semibold">Salvo</span>}
            {error && <span className="text-xs text-red-400">{error}</span>}
          </div>
          <button
            onClick={handleAdd}
            disabled={!!editingId || saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-[12px] font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <Plus size={13} />
            Nova resposta
          </button>
        </div>

        {/* Lista */}
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground px-5 py-8">
            <Loader2 size={15} className="animate-spin" /> Carregando…
          </div>
        ) : responses.length === 0 && !editingId ? (
          <div className="px-5 py-12 text-center">
            <Zap size={28} className="mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-[13px] text-muted-foreground">Nenhuma resposta rápida cadastrada.</p>
            <p className="text-[12px] text-muted-foreground/60 mt-1">Clique em "Nova resposta" para começar.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {responses.map((r) => (
              <div key={r.id} className="px-5 py-4">
                {editingId === r.id ? (
                  /* ── Modo edição ── */
                  <div className="space-y-3">
                    <div>
                      <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1 block">
                        Atalho (aparece no menu /)
                      </label>
                      <input
                        autoFocus
                        type="text"
                        value={editLabel}
                        onChange={e => setEditLabel(e.target.value)}
                        placeholder="ex: saudacao, prazo_inicial, honorarios…"
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-[13px] focus:outline-none focus:border-primary transition-colors font-mono"
                        onKeyDown={e => { if (e.key === 'Escape') handleCancelEdit(); }}
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1 block">
                        Texto da resposta
                      </label>
                      <textarea
                        value={editText}
                        onChange={e => setEditText(e.target.value)}
                        placeholder="Escreva a resposta completa aqui…"
                        rows={4}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-[13px] focus:outline-none focus:border-primary transition-colors resize-none leading-relaxed"
                        onKeyDown={e => { if (e.key === 'Escape') handleCancelEdit(); }}
                      />
                    </div>
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={handleCancelEdit}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                      >
                        <X size={12} /> Cancelar
                      </button>
                      <button
                        onClick={handleConfirmEdit}
                        disabled={saving}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-[12px] font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
                      >
                        <Check size={12} /> {saving ? 'Salvando…' : 'Salvar'}
                      </button>
                    </div>
                  </div>
                ) : (
                  /* ── Modo exibição ── */
                  <div className="flex items-start gap-3 group">
                    <GripVertical size={15} className="text-muted-foreground/30 mt-1 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[12px] font-bold text-primary font-mono">/{r.label || '…'}</span>
                      </div>
                      <p className="text-[13px] text-muted-foreground leading-relaxed line-clamp-3 whitespace-pre-wrap">
                        {r.text || <span className="italic opacity-50">Sem texto</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button
                        onClick={() => handleStartEdit(r)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                        title="Editar"
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        onClick={() => handleDelete(r.id)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Excluir"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Footer tip */}
        <div className="px-5 py-3 border-t border-border bg-muted/20">
          <p className="text-[11px] text-muted-foreground">
            💡 No chat, digite <kbd className="px-1 py-0.5 rounded bg-muted border border-border text-[10px] font-mono">/</kbd> seguido de uma palavra-chave para filtrar as respostas disponíveis. As respostas são compartilhadas entre todos os agentes.
          </p>
        </div>
      </div>
    </div>
  );
}
