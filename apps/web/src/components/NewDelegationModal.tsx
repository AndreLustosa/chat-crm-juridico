'use client';

/**
 * NewDelegationModal — modal pra criar Task (diligência) e delegar
 * pra um estagiário ou advogado SEM precisar criar evento processual antes.
 *
 * Resolve o problema "preciso pedir pro estagiário ligar pro cliente e
 * pegar comprovante" — antes precisava criar PRAZO/TAREFA no calendar
 * e depois delegar; agora cria direto via POST /tasks.
 *
 * Props:
 *   - open: controla visibilidade
 *   - onClose: fecha sem criar
 *   - onCreated: callback com a Task criada (caller pode dar refresh)
 *   - defaultLegalCaseId / defaultLeadId / defaultConversationId: pre-vincula
 *     se aberto a partir do contexto de processo/conversa (ex: workspace)
 *   - defaultAssignedUserId: pre-seleciona responsavel (ex: estagiario que
 *     ja estava num menu de "delegar diligencia")
 */

import { useEffect, useRef, useState } from 'react';
import { Loader2, X, UserCheck, Calendar, FileText, Scale, AlertCircle, Send } from 'lucide-react';
import api from '@/lib/api';
import { showSuccess, showError } from '@/lib/toast';

interface User {
  id: string;
  name: string;
  roles?: string[] | null;
}

interface LegalCaseOption {
  id: string;
  case_number: string | null;
  legal_area: string | null;
  lead?: { name: string | null } | null;
}

interface LeadOption {
  id: string;
  name: string | null;
  phone: string;
}

export interface NewDelegationModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (task: any) => void;
  defaultLegalCaseId?: string | null;
  defaultLeadId?: string | null;
  defaultConversationId?: string | null;
  defaultAssignedUserId?: string | null;
  /** Texto exibido se ja vier com vinculo pre-preenchido. UI mostra
   *  "Vinculado a: <texto>" sem campo de busca. */
  defaultBindLabel?: string | null;
}

/**
 * Calcula amanha 18h00 em hora local — formato `YYYY-MM-DDTHH:mm` que o
 * input datetime-local aceita. Default sensato: estagiario tem o dia
 * inteiro pra cumprir, advogado nao precisa pensar em prazo.
 */
function tomorrowSixPMLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(18, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function NewDelegationModal({
  open,
  onClose,
  onCreated,
  defaultLegalCaseId,
  defaultLeadId,
  defaultConversationId,
  defaultAssignedUserId,
  defaultBindLabel,
}: NewDelegationModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignedUserId, setAssignedUserId] = useState<string>(defaultAssignedUserId || '');
  const [dueAt, setDueAt] = useState<string>(tomorrowSixPMLocal());
  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Vinculo a processo/lead — visivel so se nao veio defaultBindLabel.
  // bindMode='none' (sem vinculo), 'case' (busca processo), 'lead' (busca cliente)
  const [bindMode, setBindMode] = useState<'none' | 'case' | 'lead'>('none');
  const [caseQuery, setCaseQuery] = useState('');
  const [caseResults, setCaseResults] = useState<LegalCaseOption[]>([]);
  const [selectedCase, setSelectedCase] = useState<LegalCaseOption | null>(null);
  const [leadQuery, setLeadQuery] = useState('');
  const [leadResults, setLeadResults] = useState<LeadOption[]>([]);
  const [selectedLead, setSelectedLead] = useState<LeadOption | null>(null);

  const titleRef = useRef<HTMLInputElement>(null);

  // Carrega lista de usuarios (estagiarios + advogados) ao abrir
  useEffect(() => {
    if (!open) return;
    setLoadingUsers(true);
    api.get('/users')
      .then(r => {
        const list: User[] = Array.isArray(r.data) ? r.data : (r.data?.items || []);
        // Ordena: ESTAGIARIO primeiro (mais comum delegar pra eles),
        // depois ADVOGADO/Advogados, ADMIN no fim.
        const sorted = [...list].sort((a, b) => {
          const aIsIntern = a.roles?.includes('ESTAGIARIO') ? 0 : 1;
          const bIsIntern = b.roles?.includes('ESTAGIARIO') ? 0 : 1;
          if (aIsIntern !== bIsIntern) return aIsIntern - bIsIntern;
          return (a.name || '').localeCompare(b.name || '');
        });
        setUsers(sorted);
      })
      .catch(() => setUsers([]))
      .finally(() => setLoadingUsers(false));
  }, [open]);

  // Reseta state ao abrir/fechar
  useEffect(() => {
    if (open) {
      setTitle('');
      setDescription('');
      setAssignedUserId(defaultAssignedUserId || '');
      setDueAt(tomorrowSixPMLocal());
      setError(null);
      setBindMode('none');
      setSelectedCase(null);
      setSelectedLead(null);
      setCaseQuery('');
      setLeadQuery('');
      setCaseResults([]);
      setLeadResults([]);
      // Foca no campo de titulo logo que abre — UX rapida (advogado abriu
      // pra escrever uma diligencia, ja sai digitando)
      setTimeout(() => titleRef.current?.focus(), 50);
    }
  }, [open, defaultAssignedUserId]);

  // Busca de processos com debounce
  useEffect(() => {
    if (bindMode !== 'case' || caseQuery.length < 2) { setCaseResults([]); return; }
    const t = setTimeout(async () => {
      try {
        // Endpoint nao tem ?search dedicado mas inTracking traz tudo ativo;
        // filtramos client-side por number ou nome do cliente
        const res = await api.get('/legal-cases?inTracking=true');
        const all: LegalCaseOption[] = Array.isArray(res.data) ? res.data : (res.data?.items || []);
        const q = caseQuery.toLowerCase();
        setCaseResults(
          all.filter(c =>
            (c.case_number || '').toLowerCase().includes(q) ||
            (c.lead?.name || '').toLowerCase().includes(q),
          ).slice(0, 8),
        );
      } catch {
        setCaseResults([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [caseQuery, bindMode]);

  // Busca de leads com debounce
  useEffect(() => {
    if (bindMode !== 'lead' || leadQuery.length < 2) { setLeadResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const res = await api.get(`/leads?search=${encodeURIComponent(leadQuery)}`);
        const list: LeadOption[] = Array.isArray(res.data) ? res.data : (res.data?.items || []);
        setLeadResults(list.slice(0, 8));
      } catch {
        setLeadResults([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [leadQuery, bindMode]);

  // Submit com Cmd/Ctrl+Enter pra produtividade
  function handleKey(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
    if (e.key === 'Escape') onClose();
  }

  async function submit() {
    setError(null);
    if (!title.trim()) {
      setError('Descreva a diligência (título obrigatório)');
      return;
    }
    if (!assignedUserId) {
      setError('Selecione quem vai executar a diligência');
      return;
    }
    setSubmitting(true);
    try {
      const payload: any = {
        title: title.trim(),
        description: description.trim() || undefined,
        assigned_user_id: assignedUserId,
        due_at: dueAt ? new Date(dueAt).toISOString() : undefined,
      };
      // Vinculos: prioridade pra defaults > selecao manual
      if (defaultLegalCaseId) payload.legal_case_id = defaultLegalCaseId;
      else if (selectedCase) payload.legal_case_id = selectedCase.id;
      if (defaultLeadId) payload.lead_id = defaultLeadId;
      else if (selectedLead) payload.lead_id = selectedLead.id;
      if (defaultConversationId) payload.conversation_id = defaultConversationId;

      const res = await api.post('/tasks', payload);
      showSuccess('Diligência delegada — o responsável foi notificado');
      onCreated?.(res.data);
      onClose();
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || 'Erro ao criar diligência';
      setError(msg);
      showError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  const hasPreBind = !!(defaultLegalCaseId || defaultLeadId || defaultConversationId);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKey}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center">
              <UserCheck size={18} className="text-blue-500" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">Nova diligência</h2>
              <p className="text-[11px] text-muted-foreground">
                Delegue uma tarefa rápida sem precisar criar evento
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Vinculo pre-preenchido (read-only badge) */}
          {hasPreBind && defaultBindLabel && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-500/10 border border-violet-500/20 text-[11px]">
              <Scale size={12} className="text-violet-400 shrink-0" />
              <span className="text-violet-300">
                Vinculado a: <strong>{defaultBindLabel}</strong>
              </span>
            </div>
          )}

          {/* Título */}
          <div>
            <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
              Diligência <span className="text-red-400">*</span>
            </label>
            <input
              ref={titleRef}
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Ex: Ligar para o cliente e solicitar comprovante de residência"
              maxLength={200}
              className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          {/* Descrição */}
          <div>
            <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
              Detalhes <span className="text-muted-foreground/60 font-normal normal-case">(opcional)</span>
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Recado pro responsável: o que precisa, como entregar, prazo crítico, etc."
              maxLength={1000}
              rows={3}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
            />
          </div>

          {/* Responsável + Prazo (lado a lado) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
                Responsável <span className="text-red-400">*</span>
              </label>
              <select
                value={assignedUserId}
                onChange={e => setAssignedUserId(e.target.value)}
                disabled={loadingUsers}
                className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
              >
                <option value="">{loadingUsers ? 'Carregando…' : 'Selecione…'}</option>
                {users.length > 0 && (() => {
                  const interns = users.filter(u => u.roles?.includes('ESTAGIARIO'));
                  const others = users.filter(u => !u.roles?.includes('ESTAGIARIO'));
                  return (
                    <>
                      {interns.length > 0 && (
                        <optgroup label="Estagiários">
                          {interns.map(u => (
                            <option key={u.id} value={u.id}>{u.name}</option>
                          ))}
                        </optgroup>
                      )}
                      {others.length > 0 && (
                        <optgroup label="Advogados / Outros">
                          {others.map(u => (
                            <option key={u.id} value={u.id}>{u.name}</option>
                          ))}
                        </optgroup>
                      )}
                    </>
                  );
                })()}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
                Prazo <span className="text-muted-foreground/60 font-normal normal-case">(opcional)</span>
              </label>
              <input
                type="datetime-local"
                value={dueAt}
                onChange={e => setDueAt(e.target.value)}
                className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
          </div>

          {/* Vincular a processo/cliente — escondido se ja veio default */}
          {!hasPreBind && (
            <div>
              <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
                Vincular a <span className="text-muted-foreground/60 font-normal normal-case">(opcional)</span>
              </label>

              {bindMode === 'none' && !selectedCase && !selectedLead && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setBindMode('case')}
                    className="flex-1 px-3 py-2 text-[12px] font-semibold rounded-lg border border-border hover:border-primary/40 hover:bg-primary/5 transition-colors flex items-center gap-2 justify-center"
                  >
                    <Scale size={12} /> A um processo
                  </button>
                  <button
                    type="button"
                    onClick={() => setBindMode('lead')}
                    className="flex-1 px-3 py-2 text-[12px] font-semibold rounded-lg border border-border hover:border-primary/40 hover:bg-primary/5 transition-colors flex items-center gap-2 justify-center"
                  >
                    <FileText size={12} /> A um cliente
                  </button>
                </div>
              )}

              {bindMode === 'case' && !selectedCase && (
                <div className="space-y-1">
                  <input
                    autoFocus
                    type="text"
                    value={caseQuery}
                    onChange={e => setCaseQuery(e.target.value)}
                    placeholder="Buscar por número CNJ ou nome do cliente…"
                    className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  {caseResults.length > 0 && (
                    <div className="border border-border rounded-lg bg-card overflow-hidden max-h-40 overflow-y-auto">
                      {caseResults.map(c => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => { setSelectedCase(c); setBindMode('none'); }}
                          className="w-full px-3 py-2 text-left hover:bg-accent transition-colors text-[12px] border-b border-border last:border-0"
                        >
                          <div className="font-mono text-primary">{c.case_number || '(sem número)'}</div>
                          <div className="text-muted-foreground text-[10px]">
                            {c.lead?.name || '—'} {c.legal_area && `· ${c.legal_area}`}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => { setBindMode('none'); setCaseQuery(''); setCaseResults([]); }}
                    className="text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    Cancelar busca
                  </button>
                </div>
              )}

              {bindMode === 'lead' && !selectedLead && (
                <div className="space-y-1">
                  <input
                    autoFocus
                    type="text"
                    value={leadQuery}
                    onChange={e => setLeadQuery(e.target.value)}
                    placeholder="Buscar por nome ou telefone…"
                    className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  {leadResults.length > 0 && (
                    <div className="border border-border rounded-lg bg-card overflow-hidden max-h-40 overflow-y-auto">
                      {leadResults.map(l => (
                        <button
                          key={l.id}
                          type="button"
                          onClick={() => { setSelectedLead(l); setBindMode('none'); }}
                          className="w-full px-3 py-2 text-left hover:bg-accent transition-colors text-[12px] border-b border-border last:border-0"
                        >
                          <div className="font-semibold">{l.name || '(sem nome)'}</div>
                          <div className="text-muted-foreground font-mono text-[10px]">{l.phone}</div>
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => { setBindMode('none'); setLeadQuery(''); setLeadResults([]); }}
                    className="text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    Cancelar busca
                  </button>
                </div>
              )}

              {(selectedCase || selectedLead) && (
                <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-violet-500/10 border border-violet-500/20">
                  <div className="flex items-center gap-2 min-w-0">
                    {selectedCase ? (
                      <>
                        <Scale size={12} className="text-violet-400 shrink-0" />
                        <div className="min-w-0">
                          <div className="font-mono text-[11px] text-violet-300 truncate">
                            {selectedCase.case_number || '(sem número)'}
                          </div>
                          <div className="text-[10px] text-muted-foreground truncate">
                            {selectedCase.lead?.name || '—'}
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <FileText size={12} className="text-violet-400 shrink-0" />
                        <div className="min-w-0">
                          <div className="font-semibold text-[11px] text-violet-300 truncate">
                            {selectedLead?.name || '(sem nome)'}
                          </div>
                          <div className="text-[10px] text-muted-foreground truncate font-mono">
                            {selectedLead?.phone}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => { setSelectedCase(null); setSelectedLead(null); }}
                    className="p-1 text-muted-foreground hover:text-foreground rounded"
                    aria-label="Remover vínculo"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
              <AlertCircle size={14} className="text-red-400 shrink-0 mt-0.5" />
              <p className="text-[12px] text-red-400">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-accent/20">
          <span className="text-[10px] text-muted-foreground/60 mr-auto hidden sm:block">
            Atalho: Cmd/Ctrl + Enter pra delegar
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-[12px] font-semibold rounded-lg border border-border hover:bg-accent transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !title.trim() || !assignedUserId}
            className="flex items-center gap-1.5 px-4 py-1.5 text-[12px] font-semibold bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            {submitting ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            Delegar
          </button>
        </div>
      </div>
    </div>
  );
}
