'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { API_BASE_URL } from '@/lib/api';
import {
  Send, Plus, FileText, ChevronDown, ChevronRight, User,
  Copy, Check, Loader2, Paperclip, X, Sparkles,
  Trash2, MessageSquare, Cpu, AlertCircle, Brain,
  Download, Settings2, Bot,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────

interface ConsoleSkill {
  id: string;
  name: string;
  displayTitle: string;
  description: string | null;
  source: 'anthropic' | 'custom';
}

interface ChatMessage { // ConsoleSkill kept for API typing
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  created_at: string;
  files_json?: { fileId: string; filename: string }[] | null;
}

interface ChatSummary {
  id: string;
  title: string;
  model: string;
  container_id: string | null;
  updated_at: string;
  created_at: string;
  messages: { content: string; role: string }[];
}

// ─── Constants ──────────────────────────────────────────────

const MODELS = [
  { id: 'claude-haiku-4-5',  label: 'Claude Haiku',  desc: 'Rapido — limite 60K tokens/min',   badge: 'Padrao',      badgeClass: 'bg-blue-500/10 text-blue-600' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet', desc: 'Qualidade — limite 30K tokens/min', badge: 'Avancado',   badgeClass: 'bg-green-500/10 text-green-600' },
  { id: 'claude-opus-4-6',   label: 'Claude Opus',   desc: 'Premium — limite 10K tokens/min',   badge: 'Premium',    badgeClass: 'bg-purple-500/10 text-purple-600' },
];

const DEFAULT_SYSTEM_PROMPT = `Voce e um assistente juridico especializado em direito brasileiro, auxiliando advogados na redacao de peticoes, analise de casos e pesquisa juridica.

## Suas capacidades:
- Redigir peticoes iniciais, recursos, contestacoes, replicas, embargos e demais documentos processuais
- Analisar casos e identificar teses juridicas aplicaveis
- Citar jurisprudencia, legislacao e doutrina relevante
- Calcular prazos processuais (CPC, CLT, etc.)
- Revisar documentos e sugerir melhorias

## Regras:
- Use linguagem juridica formal e tecnica
- Cite artigos de lei (CLT, CPC, CF/88, CC, CDC, etc.) quando aplicavel
- Estruture peticoes com: Enderecamento, Qualificacao das Partes, Dos Fatos, Do Direito, Dos Pedidos
- Use marcadores [ ] para informacoes que precisam ser completadas
- Responda sempre em portugues brasileiro`;

// ─── API helpers ────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function api<T = any>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...opts,
    headers: { ...authHeaders(), ...opts?.headers },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Erro' }));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Helpers ────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Ontem';
  if (diffDays < 7) return `${diffDays}d atras`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

// ─── Markdown Renderer ──────────────────────────────────────

// ─── Thinking Block (collapsible) ─────────────────────────
function ThinkingBlock({ thinking, isStreaming }: { thinking: string; isStreaming: boolean }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mb-2">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-lg hover:bg-muted/50"
      >
        {isStreaming && !isOpen ? (
          <Loader2 size={12} className="animate-spin text-amber-500" />
        ) : isOpen ? (
          <ChevronDown size={12} />
        ) : (
          <ChevronRight size={12} />
        )}
        <Brain size={12} className="text-amber-500/70" />
        <span>{isStreaming ? 'Pensando...' : 'Pensamento'}</span>
      </button>
      {(isOpen || isStreaming) && (
        <div className="mt-1 ml-2 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground bg-muted/30 border border-border/50 rounded-xl max-h-[300px] overflow-y-auto whitespace-pre-wrap font-mono">
          {thinking}
        </div>
      )}
    </div>
  );
}

function renderMarkdown(text: string): string {
  if (!text) return '';
  let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, _lang, code) =>
    `<pre class="bg-muted/60 rounded-lg p-3 my-2 overflow-x-auto text-sm font-mono"><code>${code.trim()}</code></pre>`);
  html = html.replace(/`([^`]+)`/g, '<code class="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/^### (.+)$/gm, '<h3 class="text-base font-bold mt-4 mb-1">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="text-lg font-bold mt-5 mb-2 border-b border-border pb-1">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold mt-5 mb-2">$1</h1>');
  html = html.replace(/^---$/gm, '<hr class="border-border my-4" />');
  html = html.replace(/^[*\-] (.+)$/gm, '<li class="ml-4 list-disc">$1</li>');
  html = html.replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>');
  html = html.replace(/(<li[^>]*>.*<\/li>\n?)+/g, (m) => `<ul class="my-2 space-y-1">${m}</ul>`);
  html = html.replace(/\n\n/g, '</p><p class="mb-2">');
  html = `<p class="mb-2">${html}</p>`;
  html = html.replace(/\n/g, '<br/>');
  return html;
}

// ─── Message Bubble ─────────────────────────────────────────

function MessageBubble({ msg, isStreaming }: { msg: ChatMessage; isStreaming: boolean }) {
  const [copied, setCopied] = useState(false);
  const isUser = msg.role === 'user';

  const handleCopy = async () => {
    await navigator.clipboard.writeText(msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadText = () => {
    const blob = new Blob([msg.content], { type: 'text/plain; charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `peticao-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleDownloadFile = async (fileId: string, filename: string) => {
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_BASE_URL}/petitions/chat/files/${fileId}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      alert('Erro ao baixar arquivo');
    }
  };

  if (isUser) {
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-[80%] flex items-end gap-2">
          <div className="bg-primary text-primary-foreground rounded-2xl rounded-br-sm px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap shadow-sm">
            {msg.content}
          </div>
          <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0">
            <User size={14} className="text-muted-foreground" />
          </div>
        </div>
      </div>
    );
  }

  const files = msg.files_json || [];

  return (
    <div className="flex justify-start mb-4 group">
      <div className="w-full flex items-start gap-2">
        <div className="w-7 h-7 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0 mt-1">
          <Sparkles size={13} className="text-amber-500" />
        </div>
        <div className="flex-1 min-w-0">
          {msg.thinking && <ThinkingBlock thinking={msg.thinking} isStreaming={isStreaming && msg.content === ''} />}
          <div
            className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed shadow-sm"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
          />
          {files.length > 0 && (
            <div className="mt-2 space-y-1">
              {files.map((f: any) => (
                <button
                  key={f.fileId}
                  onClick={() => handleDownloadFile(f.fileId, f.filename)}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary text-[12px] font-medium transition-colors border border-primary/20"
                >
                  <Download size={13} />
                  {f.filename}
                </button>
              ))}
            </div>
          )}
          {isStreaming && msg.content === '' && !msg.thinking && (
            <div className="flex gap-1 mt-2 ml-2">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          )}
          {!isStreaming && msg.content && (
            <div className="flex gap-1.5 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={handleCopy}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground text-[11px] transition-colors">
                {copied ? <Check size={11} /> : <Copy size={11} />}
                {copied ? 'Copiado!' : 'Copiar'}
              </button>
              <button onClick={handleDownloadText}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground text-[11px] transition-colors">
                <Download size={11} /> Salvar .txt
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────

export default function PeticoesPage() {
  // Skills from Claude Console (loaded silently; all sent automatically)
  const [consoleSkills, setConsoleSkills] = useState<ConsoleSkill[]>([]);
  // Console files cache — used to deduplicate uploads (same filename → reuse file_id)
  const [consoleFiles, setConsoleFiles] = useState<{ id: string; filename: string; size: number }[]>([]);

  // Model
  // Haiku por padrão: limite 60K tokens/min (vs 30K do Sonnet no Tier 1)
  // O worker de atendimentos usa Sonnet — usar modelo diferente evita conflito de rate limit
  const [selectedModel, setSelectedModel] = useState<string>('claude-haiku-4-5');
  const [showModelMenu, setShowModelMenu] = useState(false);
  // Thinking desativado por padrão para evitar rate limit (conta como tokens reservados)
  const [enableThinking, setEnableThinking] = useState(false);

  // System prompt
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [showPromptEditor, setShowPromptEditor] = useState(false);

  // Conversations (from DB)
  const [chatList, setChatList] = useState<ChatSummary[]>([]);
  const [loadingChats, setLoadingChats] = useState(true);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  // Chat
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [containerId, setContainerId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);

  // File upload
  const [uploadingFile, setUploadingFile] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<{ id: string; name: string }[]>([]);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);

  // ─── Init: load skills + chats from DB ──────────────────

  useEffect(() => {
    // Load skills silently — all are sent automatically; Claude Console selects the right one
    api<ConsoleSkill[]>('/petitions/chat/skills?source=all')
      .then((data) => { if (Array.isArray(data)) setConsoleSkills(data); })
      .catch(() => {});

    // Load Console files list for deduplication (avoid re-uploading same file)
    api<{ id: string; filename: string; size: number }[]>('/petitions/chat/files')
      .then((data) => { if (Array.isArray(data)) setConsoleFiles(data); })
      .catch(() => {});

    // Load chats from DB
    api<ChatSummary[]>('/petitions/chat/conversations')
      .then((data) => setChatList(data))
      .catch(() => {})
      .finally(() => setLoadingChats(false));
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) setShowModelMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  // ─── Conversation Management (DB-backed) ───────────────

  const refreshChatList = useCallback(async () => {
    try {
      const data = await api<ChatSummary[]>('/petitions/chat/conversations');
      setChatList(data);
    } catch {}
  }, []);

  const createNewConversation = useCallback(async () => {
    try {
      const chat = await api<ChatSummary>('/petitions/chat/conversations', {
        method: 'POST',
        body: JSON.stringify({ model: selectedModel }),
      });
      setChatList((prev) => [chat, ...prev]);
      setActiveChatId(chat.id);
      setMessages([]);
      setContainerId(chat.container_id);
      setStreamError(null);
      setAttachedFiles([]);
      setInput('');
    } catch (err: any) {
      setStreamError(err.message);
    }
  }, [selectedModel]);

  const selectConversation = useCallback(async (chatId: string) => {
    if (isStreaming) return;
    setActiveChatId(chatId);
    setStreamError(null);
    setAttachedFiles([]);

    try {
      const chat = await api<any>(`/petitions/chat/conversations/${chatId}`);
      setMessages(chat.messages || []);
      setSelectedModel(chat.model);
      setContainerId(chat.container_id);
    } catch {
      setMessages([]);
    }
  }, [isStreaming]);

  const deleteConversation = useCallback(async (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api(`/petitions/chat/conversations/${chatId}`, { method: 'DELETE' });
      setChatList((prev) => prev.filter((c) => c.id !== chatId));
      if (activeChatId === chatId) {
        setActiveChatId(null);
        setMessages([]);
        setContainerId(null);
      }
    } catch {}
  }, [activeChatId]);

  // ─── File Upload ───────────────────────────────────────

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    // Prevent attaching the same file twice in the current session
    if (attachedFiles.some((f) => f.name === file.name)) {
      setStreamError(`O arquivo "${file.name}" já está anexado.`);
      return;
    }

    // ── Aviso de custo para arquivos grandes ─────────────────────────────
    const fileMb = file.size / (1024 * 1024);
    if (fileMb > 5) {
      // Estimativa: ~1 token por 4 bytes de texto após extração de PDF
      // PDFs têm overhead, então usamos 1 token por 3 bytes como estimativa conservadora
      const estimatedInputTokens = Math.ceil(file.size / 3);
      const modelInfo = MODELS.find((m) => m.id === selectedModel) || MODELS[0];
      const pricePer1M = selectedModel.includes('haiku') ? 0.80 : selectedModel.includes('opus') ? 15.00 : 3.00;
      const estimatedCostUsd = (estimatedInputTokens / 1_000_000) * pricePer1M;
      const estimated = estimatedInputTokens > 1_000_000
        ? `~${(estimatedInputTokens / 1_000_000).toFixed(1)}M`
        : `~${Math.round(estimatedInputTokens / 1000)}K`;

      const msg = [
        `⚠️ Arquivo grande: ${fileMb.toFixed(1)} MB`,
        ``,
        `Estimativa de custo com ${modelInfo.label}:`,
        `  • Tokens de entrada: ${estimated}`,
        `  • Custo estimado: ~U$ ${estimatedCostUsd.toFixed(2)} por análise`,
        selectedModel !== 'claude-haiku-4-5'
          ? `\n💡 Dica: Use Claude Haiku para reduzir o custo em ~73%.`
          : ``,
        ``,
        `Deseja continuar?`,
      ].join('\n');

      if (!window.confirm(msg)) return;

      // Se o usuário confirmou e não está usando Haiku, sugerir troca
      if (selectedModel !== 'claude-haiku-4-5') {
        const switchToHaiku = window.confirm(
          `Deseja trocar para Claude Haiku para reduzir o custo de U$ ${estimatedCostUsd.toFixed(2)} para ~U$ ${((estimatedInputTokens / 1_000_000) * 0.80).toFixed(2)}?`
        );
        if (switchToHaiku) setSelectedModel('claude-haiku-4-5');
      }
    }

    setUploadingFile(true);
    setStreamError(null);
    const token = localStorage.getItem('token');

    try {
      // ── Deduplication: reuse existing file_id from Console if same filename+size ──
      const existing = consoleFiles.find(
        (cf) => cf.filename === file.name && cf.size === file.size,
      );
      if (existing) {
        setAttachedFiles((prev) => [...prev, { id: existing.id, name: existing.filename }]);
        return;
      }

      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${API_BASE_URL}/petitions/chat/files`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Erro no upload' }));
        throw new Error(err.message);
      }

      const data = await res.json();
      const uploaded = { id: data.id, name: data.filename || file.name };
      setAttachedFiles((prev) => [...prev, uploaded]);
      // Cache in consoleFiles so subsequent uploads of same file are deduplicated
      setConsoleFiles((prev) => [{ id: data.id, filename: data.filename || file.name, size: file.size }, ...prev]);
    } catch (err: any) {
      setStreamError(`Erro no upload: ${err.message}`);
    } finally {
      setUploadingFile(false);
    }
  };

  // ─── Send Message ──────────────────────────────────────

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if ((!text && attachedFiles.length === 0) || isStreaming) return;

    setStreamError(null);

    // Ensure conversation exists in DB
    let chatId = activeChatId;
    if (!chatId) {
      try {
        const chat = await api<any>('/petitions/chat/conversations', {
          method: 'POST',
          body: JSON.stringify({ model: selectedModel }),
        });
        chatId = chat.id;
        setActiveChatId(chatId);
        setChatList((prev) => [chat, ...prev]);
      } catch (err: any) {
        setStreamError(err.message);
        return;
      }
    }

    // Optimistic UI: add user + empty assistant message
    const tempUserId = `temp-${Date.now()}`;
    const tempAsstId = `temp-asst-${Date.now()}`;
    const displayContent = text || (attachedFiles.length > 0 ? `📎 ${attachedFiles.map(f => f.name).join(', ')}` : '');
    const userMsg: ChatMessage = { id: tempUserId, role: 'user', content: displayContent, created_at: new Date().toISOString() };
    const assistantMsg: ChatMessage = { id: tempAsstId, role: 'assistant', content: '', created_at: new Date().toISOString() };

    const prevMessages = [...messages];
    setMessages([...prevMessages, userMsg, assistantMsg]);
    setInput('');
    setIsStreaming(true);

    const token = localStorage.getItem('token');
    const controller = new AbortController();
    abortRef.current = controller;

    // Build API payload
    const apiMessages = [...prevMessages, userMsg].map((m) => ({ role: m.role, content: m.content }));

    const body: any = {
      messages: apiMessages,
      model: selectedModel,
      systemPrompt: systemPrompt,
    };

    // Send all skills — Claude Console selects automatically via progressive disclosure
    if (consoleSkills.length > 0) {
      body.skills = consoleSkills.map((s) => ({
        type: s.source,
        skill_id: s.id,
        version: 'latest',
      }));
    }

    if (containerId) body.containerId = containerId;
    if (enableThinking) body.enableThinking = true;

    if (attachedFiles.length > 0) {
      body.fileIds = attachedFiles.map((f) => f.id);
    }

    const currentAttachedFiles = [...attachedFiles];
    setAttachedFiles([]);

    try {
      const res = await fetch(`${API_BASE_URL}/petitions/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Erro desconhecido' }));
        throw new Error(err.message || `HTTP ${res.status}`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = '';
      let fullText = '';
      let fullThinking = '';
      let newContainerId: string | null = containerId;
      let generatedFiles: { fileId: string; filename: string }[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'info') {
              // Show info message as thinking (warning from backend)
              fullThinking += data.text + '\n';
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant') updated[updated.length - 1] = { ...last, thinking: fullThinking };
                return updated;
              });
            } else if (data.type === 'thinking') {
              fullThinking += data.text;
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant') updated[updated.length - 1] = { ...last, thinking: fullThinking };
                return updated;
              });
            } else if (data.type === 'text') {
              fullText += data.text;
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant') updated[updated.length - 1] = { ...last, content: fullText };
                return updated;
              });
            } else if (data.type === 'error') {
              throw new Error(data.message);
            } else if (data.type === 'done') {
              if (data.containerId) newContainerId = data.containerId;
              if (data.files) generatedFiles = data.files;
              // Automatic model fallback happened on the backend — update UI
              if (data.fallbackModel) setSelectedModel(data.fallbackModel);
            }
          } catch {}
        }
      }

      if (newContainerId) setContainerId(newContainerId);

      // Persist both messages to DB
      const finalChatId = chatId!;
      await Promise.all([
        api(`/petitions/chat/conversations/${finalChatId}/messages`, {
          method: 'POST',
          body: JSON.stringify({ role: 'user', content: displayContent }),
        }),
        api(`/petitions/chat/conversations/${finalChatId}/messages`, {
          method: 'POST',
          body: JSON.stringify({
            role: 'assistant',
            content: fullText,
            files: generatedFiles.length > 0 ? generatedFiles : undefined,
          }),
        }),
      ]);

      // Update container + model in DB
      if (newContainerId || selectedModel) {
        api(`/petitions/chat/conversations/${finalChatId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            container_id: newContainerId,
            model: selectedModel,
          }),
        }).catch(() => {});
      }

      // Refresh the final messages from DB
      try {
        const chat = await api<any>(`/petitions/chat/conversations/${finalChatId}`);
        setMessages(chat.messages || []);
      } catch {}

      // Refresh chat list (title may have auto-updated)
      refreshChatList();

    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setStreamError(err?.message || 'Erro ao conectar com a IA');
      setMessages(prevMessages);
      setAttachedFiles(currentAttachedFiles);
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [input, isStreaming, activeChatId, messages, consoleSkills, selectedModel, systemPrompt, containerId, attachedFiles, refreshChatList]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  // ─── Derived state ─────────────────────────────────────

  const selectedModelInfo = MODELS.find((m) => m.id === selectedModel) || MODELS[1];

  // ─── Render ────────────────────────────────────────────

  return (
    <div className="flex h-screen bg-background overflow-hidden">

      {/* ─── Left Sidebar ────────────────────────────── */}
      <aside className="w-72 hidden md:flex flex-col border-r border-border bg-card shrink-0">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-border">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
            <Sparkles size={16} className="text-amber-500" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-bold text-foreground">IA Juridica</h1>
            <p className="text-[11px] text-muted-foreground">Claude Console</p>
          </div>
        </div>

        {/* New Conversation */}
        <div className="px-3 pt-3">
          <button onClick={createNewConversation}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm">
            <Plus size={16} /> Nova Conversa
          </button>
        </div>

        {/* System Prompt */}
        <div className="px-3 pt-3">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5 px-1">System Prompt</p>
          {showPromptEditor ? (
            <div>
              <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)}
                rows={8} className="w-full text-xs bg-background border border-border rounded-xl px-3 py-2 resize-none text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
              <button onClick={() => setShowPromptEditor(false)} className="mt-1 text-[11px] text-primary hover:underline">Fechar editor</button>
            </div>
          ) : (
            <button onClick={() => setShowPromptEditor(true)}
              className="w-full text-left px-3 py-2 rounded-xl border border-border bg-background hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-2">
                <Settings2 size={13} className="text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-[12px] text-foreground font-medium truncate">Assistente Juridico</p>
                  <p className="text-[10px] text-muted-foreground truncate">{systemPrompt.slice(0, 50)}...</p>
                </div>
              </div>
            </button>
          )}
        </div>

        {/* Model Selector */}
        <div className="px-3 pt-3" ref={modelMenuRef}>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5 px-1">Modelo</p>
          <button onClick={() => setShowModelMenu(!showModelMenu)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-border bg-background hover:bg-muted/50 transition-colors text-sm">
            <div className="flex items-center gap-2">
              <Cpu size={14} className="text-blue-500 shrink-0" />
              <span className="font-medium text-foreground truncate">{selectedModelInfo.label}</span>
            </div>
            <ChevronDown size={14} className="text-muted-foreground shrink-0" />
          </button>
          {showModelMenu && (
            <div className="mt-1 rounded-xl border border-border bg-card shadow-xl overflow-hidden z-50 relative">
              {MODELS.map((m, i) => (
                <button key={m.id} onClick={() => { setSelectedModel(m.id); setShowModelMenu(false); }}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors ${selectedModel === m.id ? 'bg-primary/10' : ''} ${i > 0 ? 'border-t border-border/50' : ''}`}>
                  <div>
                    <p className="text-sm font-medium text-foreground">{m.label}</p>
                    <p className="text-[11px] text-muted-foreground">{m.desc}</p>
                  </div>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md shrink-0 ${m.badgeClass}`}>{m.badge}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Thinking toggle */}
        <div className="px-3 pt-1 pb-2">
          <button
            onClick={() => setEnableThinking((v) => !v)}
            className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border transition-colors text-sm ${enableThinking ? 'border-violet-500/50 bg-violet-500/10 text-violet-400' : 'border-border bg-background hover:bg-muted/50 text-muted-foreground'}`}
          >
            <div className="flex items-center gap-2">
              <span className="text-[13px]">🧠</span>
              <span className="text-xs font-medium">Pensamento estendido</span>
            </div>
            <div className={`w-8 h-4 rounded-full transition-colors flex items-center px-0.5 ${enableThinking ? 'bg-violet-500' : 'bg-muted'}`}>
              <div className={`w-3 h-3 rounded-full bg-white shadow transition-transform ${enableThinking ? 'translate-x-4' : 'translate-x-0'}`} />
            </div>
          </button>
          {enableThinking && (
            <p className="text-[10px] text-muted-foreground mt-1 px-1">Ativo: usa ~2K tokens extras por mensagem</p>
          )}
        </div>

        {/* Conversations List */}
        <div className="flex-1 overflow-y-auto px-3 pt-4 pb-2">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2 px-1">Conversas Recentes</p>
          {loadingChats ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 size={16} className="animate-spin text-muted-foreground" />
            </div>
          ) : chatList.length === 0 ? (
            <p className="text-[12px] text-muted-foreground text-center py-4">Nenhuma conversa ainda</p>
          ) : (
            <div className="space-y-0.5">
              {chatList.map((chat) => (
                <div key={chat.id} onClick={() => selectConversation(chat.id)}
                  className={`group flex items-center gap-2 px-2.5 py-2 rounded-xl cursor-pointer transition-colors ${activeChatId === chat.id ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50 text-foreground'}`}>
                  <MessageSquare size={13} className="text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium truncate leading-snug">{chat.title}</p>
                    <p className="text-[10px] text-muted-foreground">{formatDate(chat.updated_at)}</p>
                  </div>
                  <button onClick={(e) => deleteConversation(chat.id, e)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-destructive/10 hover:text-destructive transition-all">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* ─── Main Chat Area ───────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Top bar */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-card shrink-0">
          <div className="flex items-center gap-3">
            <div className="md:hidden w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <Sparkles size={16} className="text-amber-500" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {activeChatId ? (chatList.find((c) => c.id === activeChatId)?.title || 'Nova Conversa') : 'Assistente Juridico IA'}
              </h2>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-muted-foreground">{selectedModelInfo.label}</span>
                {consoleSkills.length > 0 && (
                  <>
                    <span className="text-muted-foreground/50">.</span>
                    <span className="text-[11px] text-amber-600 font-medium">{consoleSkills.length} skills</span>
                  </>
                )}
                {containerId && (
                  <>
                    <span className="text-muted-foreground/50">.</span>
                    <span className="text-[11px] text-green-600 font-medium">Container ativo</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isStreaming && (
              <button onClick={() => { abortRef.current?.abort(); setIsStreaming(false); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-destructive/10 hover:bg-destructive/20 text-destructive text-[12px] font-medium transition-colors">
                <X size={12} /> Parar
              </button>
            )}
            <button onClick={createNewConversation}
              className="md:hidden flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-primary-foreground text-[12px] font-medium hover:bg-primary/90 transition-colors">
              <Plus size={12} /> Nova
            </button>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-8 md:px-12 lg:px-16 py-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-4">
                <Sparkles size={28} className="text-amber-500" />
              </div>
              <h3 className="text-lg font-bold text-foreground mb-2">Assistente Juridico com Claude</h3>
              <p className="text-sm text-muted-foreground max-w-md mb-2">
                Conectado ao <strong>Claude Console</strong>. As skills sao selecionadas automaticamente conforme o contexto.
              </p>
              {consoleSkills.length > 0 && (
                <div className="flex flex-wrap gap-1.5 justify-center mb-4 max-w-lg">
                  {consoleSkills.slice(0, 12).map((s) => (
                    <span key={s.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-700 font-medium">
                      <Sparkles size={10} />
                      {s.displayTitle || s.name}
                    </span>
                  ))}
                  {consoleSkills.length > 12 && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-muted text-[10px] text-muted-foreground">
                      +{consoleSkills.length - 12} mais
                    </span>
                  )}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg">
                {[
                  { text: 'Redija uma peticao inicial trabalhista por rescisao indireta', icon: <FileText size={16} className="text-blue-500" /> },
                  { text: 'Gere um contrato de honorarios em DOCX', icon: <FileText size={16} className="text-blue-500" /> },
                  { text: 'Analise este processo criminal e prepare estrategia', icon: <Bot size={16} className="text-purple-500" /> },
                  { text: 'Crie uma planilha Excel com calculos trabalhistas', icon: <FileText size={16} className="text-green-500" /> },
                ].map((s) => (
                  <button key={s.text} onClick={() => { setInput(s.text); textareaRef.current?.focus(); }}
                    className="flex items-start gap-2 p-3 rounded-xl border border-border bg-card hover:bg-muted/50 text-left text-sm text-foreground transition-colors">
                    <span className="shrink-0 mt-0.5">{s.icon}</span>
                    <span className="text-[12px] text-muted-foreground leading-relaxed">{s.text}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="w-full px-8">
              {messages.map((msg, idx) => (
                <MessageBubble key={msg.id} msg={msg} isStreaming={isStreaming && idx === messages.length - 1} />
              ))}
            </div>
          )}

          {streamError && (
            <div className="max-w-3xl mx-auto mt-2">
              <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                <AlertCircle size={16} className="shrink-0" />
                <span className="flex-1">{streamError}</span>
                <button onClick={() => setStreamError(null)}><X size={14} /></button>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="shrink-0 border-t border-border bg-card px-4 py-3">
          <div className="max-w-3xl mx-auto">

            {/* Attached files */}
            {attachedFiles.length > 0 && (
              <div className="mb-2 space-y-1.5">
                <div className="flex flex-wrap gap-2">
                  {attachedFiles.map((f) => (
                    <div key={f.id} className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-muted/50 border border-border text-[12px]">
                      <FileText size={13} className="text-blue-500" />
                      <span className="truncate max-w-40">{f.name}</span>
                      <button onClick={() => setAttachedFiles((prev) => prev.filter((x) => x.id !== f.id))}
                        className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"><X size={11} /></button>
                    </div>
                  ))}
                </div>
                {/* Cost warning for large files */}
                {consoleSkills.length > 0 && (
                  <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-700">
                    <AlertCircle size={13} className="shrink-0 mt-0.5" />
                    <span>
                      <strong>PDFs grandes + skills</strong> consomem muitos tokens por turno de execução.
                      {selectedModel !== 'claude-haiku-4-5' && (
                        <> Modelo atual: <strong>{selectedModelInfo.label}</strong>.{' '}
                          <button className="underline font-semibold" onClick={() => setSelectedModel('claude-haiku-4-5')}>
                            Trocar para Haiku (73% mais barato)
                          </button>
                        </>
                      )}
                      {selectedModel === 'claude-haiku-4-5' && <> Haiku ativo — custo reduzido.</>}
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-end gap-2">
              <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload}
                accept=".txt,.md,.json,.csv,.html,.pdf,.docx,.xlsx,.pptx,.doc,.xls,.ppt" />
              <button onClick={() => fileInputRef.current?.click()} disabled={isStreaming || uploadingFile}
                className="p-2.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                title="Upload para o Claude Console">
                {uploadingFile ? <Loader2 size={18} className="animate-spin" /> : <Paperclip size={18} />}
              </button>

              <div className="flex-1 relative">
                <textarea ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown} disabled={isStreaming}
                  placeholder="Descreva a peticao ou faca uma pergunta juridica... (Enter para enviar)"
                  rows={1}
                  className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 min-h-[46px] max-h-[200px] leading-relaxed" />
              </div>

              {isStreaming ? (
                <button onClick={() => { abortRef.current?.abort(); setIsStreaming(false); }}
                  className="p-2.5 rounded-xl bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"><X size={18} /></button>
              ) : (
                <button onClick={sendMessage} disabled={!input.trim() && attachedFiles.length === 0}
                  className="p-2.5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 shadow-sm">
                  <Send size={18} />
                </button>
              )}
            </div>

            <p className="text-[10px] text-muted-foreground text-center mt-2">
              {selectedModelInfo.label} . Claude Console . Conversas salvas por 6 meses
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
