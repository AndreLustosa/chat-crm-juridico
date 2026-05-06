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
  return toLocalInputValue(d);
}

/** Converte Date pra valor que <input type="datetime-local"> aceita. */
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Templates de diligencias mais comuns do escritorio. Click preenche o
 * titulo e ajusta o prazo sugerido. Reduz friccao pra criar diligencias
 * recorrentes (ex: "Pegar comprovante" eh quase diario).
 *
 * dueOffsetMinutes: minutos do agora pro prazo. Sera ajustado pra horario
 * util (09-18h) automaticamente.
 *
 * Categorias batem com a `inferFolder()` no backend (tasks.service.ts:44),
 * entao ao subir anexos a pasta certa eh sugerida sem usuario pensar.
 */
const DELEGATION_TEMPLATES: Array<{
  label: string;
  title: string;
  icon: string;
  hint: string;
  dueOffsetMinutes?: number; // undefined = mantem default (amanha 18h)
}> = [
  { label: 'Comprovante', icon: '📄', title: 'Pegar comprovante de residência do cliente', hint: 'Estagiária liga e solicita por WhatsApp', dueOffsetMinutes: 60 * 24 * 2 }, // 2 dias
  { label: 'RG/CPF', icon: '🪪', title: 'Pegar RG e CPF do cliente', hint: 'Estagiária liga e solicita por WhatsApp', dueOffsetMinutes: 60 * 24 * 2 },
  { label: 'Procuração', icon: '✍️', title: 'Imprimir procuração e contrato para assinatura', hint: 'Imprimir e deixar pra cliente assinar', dueOffsetMinutes: 60 * 4 }, // 4h
  { label: 'Decisão TJ', icon: '⚖️', title: 'Baixar decisão / sentença do TJ e anexar ao processo', hint: 'Baixar PDF do tribunal e subir', dueOffsetMinutes: 60 * 24 }, // 1 dia
  { label: 'Ligar cliente', icon: '📞', title: 'Ligar para o cliente', hint: 'Contato telefônico — anotar resultado', dueOffsetMinutes: 60 * 6 }, // 6h
  { label: 'Petição', icon: '📑', title: 'Elaborar petição / minuta', hint: 'Estagiário redige primeira versão', dueOffsetMinutes: 60 * 24 * 3 }, // 3 dias
  { label: 'Audiência', icon: '🎙️', title: 'Confirmar audiência com cliente e cartório', hint: 'Ligar pro fórum e cliente', dueOffsetMinutes: 60 * 24 },
];

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
  const [autoPicking, setAutoPicking] = useState(false);
  const [dueAt, setDueAt] = useState<string>(tomorrowSixPMLocal());
  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Vinculo a processo/cliente — busca UNIFICADA. Uma query so pesquisa
  // em paralelo /legal-cases (por CNJ ou nome do cliente) e /leads (por
  // nome ou telefone). Resultados aparecem juntos com icone diferenciando
  // (👤 cliente / ⚖️ processo). Selecionar um processo auto-vincula o
  // lead dele tambem.
  const [bindQuery, setBindQuery] = useState('');
  const [caseResults, setCaseResults] = useState<LegalCaseOption[]>([]);
  const [leadResults, setLeadResults] = useState<LeadOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedCase, setSelectedCase] = useState<LegalCaseOption | null>(null);
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
      setSelectedCase(null);
      setSelectedLead(null);
      setBindQuery('');
      setCaseResults([]);
      setLeadResults([]);
      // Foca no campo de titulo logo que abre — UX rapida (advogado abriu
      // pra escrever uma diligencia, ja sai digitando)
      setTimeout(() => titleRef.current?.focus(), 50);
    }
  }, [open, defaultAssignedUserId]);

  // Busca UNIFICADA com debounce — pesquisa processos + leads em paralelo.
  // Cliente digita nome / telefone / CNJ → resultados misturados aparecem
  // numa lista so com badge visual diferenciando.
  useEffect(() => {
    if (bindQuery.length < 2) {
      setCaseResults([]);
      setLeadResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      const q = bindQuery.toLowerCase();
      try {
        const [casesRes, leadsRes] = await Promise.all([
          // Endpoint nao tem ?search dedicado, mas inTracking traz ativos;
          // filtramos client-side por CNJ ou nome do cliente
          api.get('/legal-cases?inTracking=true').catch(() => ({ data: [] })),
          api.get(`/leads?search=${encodeURIComponent(bindQuery)}`).catch(() => ({ data: [] })),
        ]);
        const allCases: LegalCaseOption[] = Array.isArray(casesRes.data)
          ? casesRes.data
          : (casesRes.data?.items || []);
        setCaseResults(
          allCases.filter(c =>
            (c.case_number || '').toLowerCase().includes(q) ||
            (c.lead?.name || '').toLowerCase().includes(q),
          ).slice(0, 5),
        );
        const allLeads: LeadOption[] = Array.isArray(leadsRes.data)
          ? leadsRes.data
          : (leadsRes.data?.items || []);
        setLeadResults(allLeads.slice(0, 5));
      } catch {
        setCaseResults([]);
        setLeadResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [bindQuery]);

  /**
   * Auto-atribuir: chama /tasks/workload e seleciona a estagiária com
   * MENOR carga (total ativo, desempate: menos atrasadas/urgentes).
   * Se nenhuma estagiária tem nada, pega a primeira da lista.
   * Se a lista de workload vier vazia (ninguém com tasks), pega a
   * primeira estagiária no array `users` direto.
   */
  async function pickAutoAssign() {
    setAutoPicking(true);
    try {
      const res = await api.get('/tasks/workload');
      const workload: Array<{ id: string; name: string; total: number; overdue: number; urgent: number }> =
        Array.isArray(res.data) ? res.data : (res.data?.data || []);
      // Considera só estagiários (delegação típica)
      const internUsers = users.filter(u => u.roles?.includes('ESTAGIARIO'));
      if (internUsers.length === 0) {
        showError('Nenhum estagiário cadastrado pra delegar');
        return;
      }
      const internIds = new Set(internUsers.map(u => u.id));
      // Workload tem só quem tem ao menos 1 task; estagiários sem tasks
      // não aparecem — eles têm prioridade máxima (carga zero).
      const internsWithLoad = workload.filter(w => internIds.has(w.id));
      const loadedIds = new Set(internsWithLoad.map(w => w.id));
      const internsWithoutLoad = internUsers.filter(u => !loadedIds.has(u.id));

      let pick: { id: string; name: string };
      if (internsWithoutLoad.length > 0) {
        pick = internsWithoutLoad[0];
      } else {
        // Todos têm carga — pega o de menor total (desempate: menos
        // atrasadas, depois menos urgentes)
        const sorted = [...internsWithLoad].sort((a, b) => {
          if (a.total !== b.total) return a.total - b.total;
          if (a.overdue !== b.overdue) return a.overdue - b.overdue;
          return a.urgent - b.urgent;
        });
        pick = sorted[0];
      }
      setAssignedUserId(pick.id);
      showSuccess(`Auto-atribuído pra ${pick.name}`);
    } catch (e: any) {
      showError('Falha ao consultar carga de trabalho');
    } finally {
      setAutoPicking(false);
    }
  }

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
      // Vinculos: prioridade pra defaults > selecao manual.
      // Quando o usuario seleciona PROCESSO, lead_id vem implicitamente do
      // backend via legal_case.lead_id — nao mandamos lead_id explicito
      // (selectedLead virou placeholder com id='' nesse caminho).
      // Quando seleciona LEAD direto, manda lead_id; legal_case_id em branco.
      if (defaultLegalCaseId) payload.legal_case_id = defaultLegalCaseId;
      else if (selectedCase) payload.legal_case_id = selectedCase.id;
      if (defaultLeadId) payload.lead_id = defaultLeadId;
      else if (selectedLead && selectedLead.id) payload.lead_id = selectedLead.id;
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

            {/* Templates rapidos — chips com diligencias mais comuns
                do escritorio. Click preenche titulo + ajusta prazo
                sugerido. Acelera 10x a criacao das diligencias do
                dia-a-dia. */}
            {!title.trim() && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {DELEGATION_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.title}
                    type="button"
                    onClick={() => {
                      setTitle(tpl.title);
                      if (tpl.dueOffsetMinutes !== undefined) {
                        const d = new Date();
                        d.setMinutes(d.getMinutes() + tpl.dueOffsetMinutes);
                        // Mantem horario util: 09-18h. Se cair fora, joga
                        // pra 18h do dia
                        if (d.getHours() < 9) d.setHours(9, 0, 0, 0);
                        if (d.getHours() >= 18) d.setHours(18, 0, 0, 0);
                        setDueAt(toLocalInputValue(d));
                      }
                      setTimeout(() => titleRef.current?.focus(), 0);
                    }}
                    className="text-[10px] px-2 py-1 rounded-full bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:border-blue-500/50 transition-all"
                    title={tpl.hint}
                  >
                    {tpl.icon} {tpl.label}
                  </button>
                ))}
              </div>
            )}

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
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                  Responsável <span className="text-red-400">*</span>
                </label>
                <button
                  type="button"
                  onClick={pickAutoAssign}
                  disabled={loadingUsers || autoPicking}
                  className="text-[10px] font-bold text-blue-400 hover:text-blue-300 disabled:opacity-50 transition-colors flex items-center gap-1"
                  title="Atribui à pessoa com menor carga de trabalho"
                >
                  {autoPicking ? <Loader2 size={10} className="animate-spin" /> : '🎯'}
                  Auto
                </button>
              </div>
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

          {/* Vincular a processo/cliente — escondido se ja veio default
              do contexto (ex: aberto a partir do workspace de um processo) */}
          {!hasPreBind && (
            <div>
              <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
                Vincular a <span className="text-muted-foreground/60 font-normal normal-case">(opcional)</span>
              </label>

              {/* Pill mostrando o vinculo atual quando algo selecionado.
                  Antes do select aparece campo de busca unificada. */}
              {(selectedCase || selectedLead) ? (
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
                            {selectedCase.legal_area && ` · ${selectedCase.legal_area}`}
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
                    onClick={() => { setSelectedCase(null); setSelectedLead(null); setBindQuery(''); }}
                    className="p-1 text-muted-foreground hover:text-foreground rounded"
                    aria-label="Remover vínculo"
                  >
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="relative">
                    <input
                      type="text"
                      value={bindQuery}
                      onChange={e => setBindQuery(e.target.value)}
                      placeholder="Nome do cliente, telefone ou número CNJ…"
                      className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                    {searching && (
                      <Loader2
                        size={13}
                        className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground"
                      />
                    )}
                  </div>

                  {/* Lista mista de resultados — processos primeiro
                      (mais especifico) depois clientes. Cada grupo com
                      header visual sutil. */}
                  {(caseResults.length > 0 || leadResults.length > 0) && (
                    <div className="border border-border rounded-lg bg-card overflow-hidden max-h-56 overflow-y-auto">
                      {caseResults.length > 0 && (
                        <>
                          <div className="px-3 py-1 bg-violet-500/5 border-b border-violet-500/10">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-violet-400">
                              ⚖️ Processos
                            </span>
                          </div>
                          {caseResults.map(c => (
                            <button
                              key={`case-${c.id}`}
                              type="button"
                              onClick={() => {
                                // Selecionar processo auto-vincula tambem
                                // o lead dele — caller faz upload sabe que
                                // ambos legalCaseId e leadId estao setados.
                                setSelectedCase(c);
                                if (c.lead) setSelectedLead({
                                  id: '', // placeholder — quando selecionou via case, leadId vem do legal_case.lead_id no backend
                                  name: c.lead.name,
                                  phone: '',
                                });
                                setBindQuery('');
                              }}
                              className="w-full px-3 py-2 text-left hover:bg-violet-500/10 transition-colors text-[12px] border-b border-border last:border-0"
                            >
                              <div className="flex items-center gap-2">
                                <Scale size={11} className="text-violet-400 shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <div className="font-mono text-primary truncate">
                                    {c.case_number || '(sem número)'}
                                  </div>
                                  <div className="text-muted-foreground text-[10px] truncate">
                                    {c.lead?.name || '—'}
                                    {c.legal_area && ` · ${c.legal_area}`}
                                  </div>
                                </div>
                              </div>
                            </button>
                          ))}
                        </>
                      )}
                      {leadResults.length > 0 && (
                        <>
                          <div className="px-3 py-1 bg-amber-500/5 border-b border-amber-500/10">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-amber-500">
                              👤 Clientes
                            </span>
                          </div>
                          {leadResults.map(l => (
                            <button
                              key={`lead-${l.id}`}
                              type="button"
                              onClick={() => {
                                // Selecionar lead deixa processo em branco —
                                // permite delegar diligencia geral sobre o
                                // cliente sem fixar processo (ex: ligar pra
                                // confirmar agendamento)
                                setSelectedLead(l);
                                setSelectedCase(null);
                                setBindQuery('');
                              }}
                              className="w-full px-3 py-2 text-left hover:bg-amber-500/10 transition-colors text-[12px] border-b border-border last:border-0"
                            >
                              <div className="flex items-center gap-2">
                                <FileText size={11} className="text-amber-500 shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <div className="font-semibold truncate">{l.name || '(sem nome)'}</div>
                                  <div className="text-muted-foreground font-mono text-[10px] truncate">{l.phone}</div>
                                </div>
                              </div>
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  )}

                  {bindQuery.length >= 2 && !searching && caseResults.length === 0 && leadResults.length === 0 && (
                    <p className="text-[10px] text-muted-foreground italic">
                      Nada encontrado. A diligência pode ser criada sem vínculo.
                    </p>
                  )}
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
