'use client';

import {
  useEffect,
  useState,
  useCallback,
  useRef,
  KeyboardEvent,
} from 'react';
import {
  MessageSquare,
  Loader2,
  Send,
  Plus,
  Sparkles,
  Wrench,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Archive,
  User as UserIcon,
} from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';
import { AiKnowledgePanel } from './AiKnowledgePanel';

interface ChatSession {
  id: string;
  title: string;
  started_at: string;
  last_activity_at: string;
  total_cost_brl: string | number;
}

type ApiError = {
  response?: {
    data?: {
      message?: string;
    };
  };
};

type ToolCall = {
  id: string;
  name: string;
};

type ProposedAction = {
  action_kind?: string;
  reason?: string;
  campaign_id?: string;
  ad_group_id?: string;
  new_amount_brl?: number;
  negative_keyword?: string;
  match_type?: string;
};

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  tool_calls?: ToolCall[] | null;
  tool_result_for?: string | null;
  tool_result?: unknown;
  proposed_action?: ProposedAction | null;
  proposed_action_status?: string | null;
  proposed_action_resolved_at?: string | null;
  error_message?: string | null;
  created_at: string;
}

const ACTION_LABEL: Record<string, string> = {
  PAUSE_CAMPAIGN: 'Pausar campanha',
  RESUME_CAMPAIGN: 'Retomar campanha',
  PAUSE_AD_GROUP: 'Pausar ad group',
  RESUME_AD_GROUP: 'Retomar ad group',
  PAUSE_AD: 'Pausar anúncio',
  UPDATE_BUDGET: 'Atualizar orçamento',
  ADD_NEGATIVE_KEYWORD_CAMPAIGN: 'Adicionar palavra negativa (campanha)',
  ADD_NEGATIVE_KEYWORD_AD_GROUP: 'Adicionar palavra negativa (ad group)',
};

function getApiErrorMessage(err: unknown, fallback: string): string {
  const message = (err as ApiError)?.response?.data?.message;
  return typeof message === 'string' && message.length > 0 ? message : fallback;
}

export function ConversarTab({ canManage }: { canManage: boolean }) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [sending, setSending] = useState(false);
  const [actionInflightId, setActionInflightId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Carrega sessions
  const loadSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const { data } = await api.get<ChatSession[]>('/trafego/chat/sessions');
      setSessions(data);
      if (data.length > 0 && !activeId) setActiveId(data[0].id);
    } catch {
      showError('Erro ao carregar conversas.');
    } finally {
      setLoadingSessions(false);
    }
  }, [activeId]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Carrega mensagens da session ativa + polling pra novas
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    let lastId: string | undefined;

    async function loadAll() {
      try {
        const { data } = await api.get<ChatMessage[]>(
          `/trafego/chat/sessions/${activeId}/messages`,
        );
        if (!cancelled) {
          setMessages(data);
          if (data.length > 0) lastId = data[data.length - 1].id;
        }
      } catch {
        // silencioso
      }
    }

    async function poll() {
      if (!lastId) return;
      try {
        const { data } = await api.get<ChatMessage[]>(
          `/trafego/chat/sessions/${activeId}/messages`,
          { params: { after: lastId } },
        );
        if (!cancelled && data.length > 0) {
          setMessages((prev) => [...prev, ...data]);
          lastId = data[data.length - 1].id;
          // Se a última for assistant final, para o spinner de envio
          const last = data[data.length - 1];
          if (last?.role === 'assistant' && !last.tool_calls) {
            setSending(false);
          }
        }
      } catch {}
    }

    loadAll();
    const t = setInterval(poll, 2_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [activeId]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages]);

  async function newSession() {
    if (!canManage) return;
    try {
      const { data } = await api.post<{ id: string; title: string }>(
        '/trafego/chat/sessions',
        {},
      );
      await loadSessions();
      setActiveId(data.id);
      setMessages([]);
    } catch (err: unknown) {
      showError(getApiErrorMessage(err, 'Erro ao criar conversa.'));
    }
  }

  async function send() {
    if (!canManage || !activeId || !input.trim() || sending) return;
    setSending(true);
    const text = input.trim();
    setInput('');
    try {
      await api.post(`/trafego/chat/sessions/${activeId}/messages`, { text });
      // O polling pega a resposta
    } catch (err: unknown) {
      setSending(false);
      showError(getApiErrorMessage(err, 'Erro ao enviar mensagem.'));
    }
  }

  function onInputKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  async function applyAction(msgId: string) {
    if (!canManage) return;
    setActionInflightId(msgId);
    try {
      await api.post(`/trafego/chat/messages/${msgId}/apply`);
      showSuccess('Aplicação enfileirada — atualizando em segundos...');
      // Polling de mensagens pega o status
    } catch (err: unknown) {
      showError(getApiErrorMessage(err, 'Erro ao aplicar.'));
    } finally {
      setActionInflightId(null);
    }
  }

  async function rejectAction(msgId: string) {
    if (!canManage) return;
    setActionInflightId(msgId);
    try {
      await api.post(`/trafego/chat/messages/${msgId}/reject`);
      showSuccess('Ação rejeitada.');
    } catch (err: unknown) {
      showError(getApiErrorMessage(err, 'Erro ao rejeitar.'));
    } finally {
      setActionInflightId(null);
    }
  }

  async function archive(sessionId: string) {
    if (!canManage) return;
    if (!confirm('Arquivar esta conversa?')) return;
    try {
      await api.delete(`/trafego/chat/sessions/${sessionId}`);
      if (activeId === sessionId) {
        setActiveId(null);
        setMessages([]);
      }
      await loadSessions();
    } catch (err: unknown) {
      showError(getApiErrorMessage(err, 'Erro ao arquivar.'));
    }
  }

  return (
    <div>
      <AiKnowledgePanel defaultOpen />
      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4 h-[calc(100vh-320px)] min-h-[500px]">
      {/* Sidebar de sessions */}
      <aside className="bg-card border border-border rounded-xl flex flex-col overflow-hidden">
        <div className="p-3 border-b border-border flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <MessageSquare size={14} /> Conversas
          </h3>
          {canManage && (
            <button
              onClick={newSession}
              className="p-1.5 rounded-md hover:bg-accent border border-border"
              title="Nova conversa"
            >
              <Plus size={14} />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {loadingSessions ? (
            <div className="p-4 flex items-center justify-center text-muted-foreground">
              <Loader2 size={16} className="animate-spin" />
            </div>
          ) : sessions.length === 0 ? (
            <div className="p-4 text-xs text-muted-foreground text-center">
              Nenhuma conversa ainda.
              <br />
              Clique no <strong>+</strong> pra começar.
            </div>
          ) : (
            sessions.map((s) => (
              <div
                key={s.id}
                onClick={() => setActiveId(s.id)}
                className={`group p-3 cursor-pointer border-b border-border ${
                  activeId === s.id
                    ? 'bg-violet-500/10 border-l-2 border-l-violet-500'
                    : 'hover:bg-accent/30'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{s.title}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(s.last_activity_at).toLocaleString('pt-BR')}
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      archive(s.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/10 hover:text-red-600"
                    title="Arquivar"
                  >
                    <Archive size={12} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Conversa principal */}
      <main className="bg-card border border-border rounded-xl flex flex-col overflow-hidden">
        {!activeId ? (
          <Welcome onNew={newSession} canManage={canManage} />
        ) : (
          <>
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 ? (
                <EmptyChat />
              ) : (
                messages.map((m) => (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    canManage={canManage}
                    actionInflight={actionInflightId === m.id}
                    onApply={() => applyAction(m.id)}
                    onReject={() => rejectAction(m.id)}
                  />
                ))
              )}
              {sending && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground italic">
                  <Loader2 size={12} className="animate-spin" />
                  IA está pensando...
                </div>
              )}
            </div>
            <div className="border-t border-border p-3">
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onInputKeyDown}
                  placeholder='Pergunte o que quiser sobre suas campanhas. Ex: "Como está o CPL de Trabalhista esse mês?", "Pausa a campanha X", "Compare maio com abril".'
                  rows={2}
                  className="flex-1 px-3 py-2 text-sm rounded-md bg-card border border-border resize-none"
                  disabled={sending || !canManage}
                />
                <button
                  onClick={send}
                  disabled={!input.trim() || sending || !canManage}
                  className="px-4 py-2 rounded-md bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50 flex items-center gap-2 text-sm font-bold"
                >
                  {sending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Send size={14} />
                  )}
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Enter pra enviar · Shift+Enter pra nova linha · Modelo:{' '}
                {sessions.find((s) => s.id === activeId)?.title?.length
                  ? '(definido na Política IA)'
                  : '—'}
              </p>
            </div>
          </>
        )}
      </main>
      </div>
    </div>
  );
}

function Welcome({
  onNew,
  canManage,
}: {
  onNew: () => void;
  canManage: boolean;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8">
      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow mb-3">
        <Sparkles size={20} className="text-white" />
      </div>
      <h3 className="text-base font-bold text-foreground mb-1">
        Converse com a IA do Tráfego
      </h3>
      <p className="text-xs text-center max-w-md mb-4">
        Pergunte sobre métricas, peça análises comparativas, ou peça pra pausar
        / ajustar campanhas. A IA propõe e você confirma cada ação.
      </p>
      {canManage && (
        <button
          onClick={onNew}
          className="flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-md bg-violet-600 hover:bg-violet-700 text-white"
        >
          <Plus size={14} /> Iniciar nova conversa
        </button>
      )}
    </div>
  );
}

function EmptyChat() {
  return (
    <div className="text-center text-xs text-muted-foreground p-6">
      Comece digitando sua pergunta abaixo.
      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-left">
        <Suggestion text="Como está o CPL este mês?" />
        <Suggestion text="Quais campanhas estão com problema?" />
        <Suggestion text="Compare abril com março" />
        <Suggestion text="Tem search terms ruins de Trabalhista?" />
      </div>
    </div>
  );
}

function Suggestion({ text }: { text: string }) {
  return (
    <div className="px-3 py-2 rounded-md border border-border bg-muted/20 italic">
      &quot;{text}&quot;
    </div>
  );
}

function MessageBubble({
  message,
  canManage,
  actionInflight,
  onApply,
  onReject,
}: {
  message: ChatMessage;
  canManage: boolean;
  actionInflight: boolean;
  onApply: () => void;
  onReject: () => void;
}) {
  if (message.role === 'tool') {
    return <ToolResultBubble message={message} canManage={canManage}
      actionInflight={actionInflight} onApply={onApply} onReject={onReject} />;
  }
  if (message.role === 'user') {
    return (
      <div className="flex gap-2 justify-end">
        <div className="max-w-[75%] bg-violet-500/10 border border-violet-500/30 rounded-xl px-3 py-2 text-sm">
          {message.content}
        </div>
        <div className="w-7 h-7 rounded-full bg-violet-500 text-white flex items-center justify-center shrink-0">
          <UserIcon size={14} />
        </div>
      </div>
    );
  }
  // assistant
  if (message.tool_calls) {
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    return (
      <div className="flex gap-2">
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white flex items-center justify-center shrink-0">
          <Sparkles size={14} />
        </div>
        <div className="max-w-[75%] space-y-1">
          {message.content && (
            <div className="bg-card border border-border rounded-xl px-3 py-2 text-sm whitespace-pre-wrap">
              {message.content}
            </div>
          )}
          {calls.map((c) => (
            <div
              key={c.id}
              className="text-[11px] text-muted-foreground italic flex items-center gap-1"
            >
              <Wrench size={11} /> consultando <strong>{c.name}</strong>...
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-2">
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white flex items-center justify-center shrink-0">
        <Sparkles size={14} />
      </div>
      <div className="max-w-[75%] bg-card border border-border rounded-xl px-3 py-2 text-sm whitespace-pre-wrap">
        {message.content}
        {message.error_message && (
          <div className="mt-1 text-[11px] text-red-600 italic">
            {message.error_message}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolResultBubble({
  message,
  canManage,
  actionInflight,
  onApply,
  onReject,
}: {
  message: ChatMessage;
  canManage: boolean;
  actionInflight: boolean;
  onApply: () => void;
  onReject: () => void;
}) {
  // Se é tool result de propose_action, mostra card especial
  if (message.proposed_action) {
    return (
      <ProposedActionCard
        message={message}
        canManage={canManage}
        actionInflight={actionInflight}
        onApply={onApply}
        onReject={onReject}
      />
    );
  }
  // Tool result normal — não exibe (UX limpa, IA já vai falar sobre o que viu)
  return null;
}

function ProposedActionCard({
  message,
  canManage,
  actionInflight,
  onApply,
  onReject,
}: {
  message: ChatMessage;
  canManage: boolean;
  actionInflight: boolean;
  onApply: () => void;
  onReject: () => void;
}) {
  const action = message.proposed_action ?? {};
  const actionKind = action.action_kind ?? 'ACTION';
  const status = message.proposed_action_status ?? 'PENDING_APPROVAL';
  const isPending = status === 'PENDING_APPROVAL';
  const isApplied = status === 'APPLIED';
  const isRejected = status === 'REJECTED';

  return (
    <div className="flex gap-2 ml-9">
      <div
        className={`flex-1 max-w-[75%] rounded-xl border-2 p-3 ${
          isApplied
            ? 'border-emerald-500/50 bg-emerald-500/5'
            : isRejected
              ? 'border-zinc-500/30 bg-zinc-500/5 opacity-60'
              : 'border-amber-500/50 bg-amber-500/5'
        }`}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <Wrench size={14} className="text-amber-600" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
            Proposta de ação
          </span>
          <span className="text-sm font-bold">
            {ACTION_LABEL[actionKind] ?? actionKind}
          </span>
        </div>
        {action.reason && (
          <p className="text-xs text-foreground mb-2 italic">
            &quot;{action.reason}&quot;
          </p>
        )}
        <div className="text-[11px] text-muted-foreground space-y-0.5 mb-2">
          {action.campaign_id && <p>Campanha: <code>{action.campaign_id.slice(0, 8)}…</code></p>}
          {action.ad_group_id && <p>Ad group: <code>{action.ad_group_id.slice(0, 8)}…</code></p>}
          {action.new_amount_brl !== undefined && (
            <p>Novo budget: <strong>R$ {Number(action.new_amount_brl).toFixed(2)}/dia</strong></p>
          )}
          {action.negative_keyword && (
            <p>
              Termo negativo:{' '}
              <strong>&quot;{action.negative_keyword}&quot;</strong> (
              {action.match_type ?? 'PHRASE'})
            </p>
          )}
        </div>

        {isPending && canManage && (
          <div className="flex gap-2">
            <button
              onClick={onApply}
              disabled={actionInflight}
              className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
            >
              {actionInflight ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <CheckCircle2 size={12} />
              )}
              Aplicar
            </button>
            <button
              onClick={onReject}
              disabled={actionInflight}
              className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded bg-card hover:bg-accent border border-border disabled:opacity-50"
            >
              <XCircle size={12} /> Rejeitar
            </button>
          </div>
        )}
        {isApplied && (
          <div className="flex items-center gap-1 text-xs text-emerald-700">
            <CheckCircle2 size={12} /> Aplicada
            {message.proposed_action_resolved_at &&
              ` em ${new Date(message.proposed_action_resolved_at).toLocaleString('pt-BR')}`}
          </div>
        )}
        {isRejected && (
          <div className="flex items-start gap-1 text-xs text-zinc-600">
            <XCircle size={12} className="mt-0.5 shrink-0" />
            <span>
              Rejeitada
              {message.error_message && `: ${message.error_message}`}
            </span>
          </div>
        )}
        {message.error_message && isPending && (
          <div className="text-[11px] text-red-600 mt-1 flex items-start gap-1">
            <AlertTriangle size={11} className="mt-0.5" />
            {message.error_message}
          </div>
        )}
      </div>
    </div>
  );
}
