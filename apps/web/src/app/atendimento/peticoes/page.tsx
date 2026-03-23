'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { API_BASE_URL } from '@/lib/api';
import {
  Send, Plus, FileText, ChevronDown, Bot, User,
  Copy, Check, Loader2, Paperclip, X, Sparkles,
  Trash2, MessageSquare, Cpu, AlertCircle,
  Download, Zap, Code2, FileSpreadsheet, FileType,
  Presentation, File,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────

interface ConsoleSkill {
  id: string;
  name: string;
  displayTitle: string;
  description: string | null;
  source: 'anthropic' | 'custom';
  createdAt: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  files?: { fileId: string; filename: string }[];
}

interface SkillRef {
  type: 'anthropic' | 'custom';
  skill_id: string;
  version?: string;
}

interface Conversation {
  id: string;
  title: string;
  skills: SkillRef[];
  model: string;
  containerId: string | null;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

// ─── Constants ──────────────────────────────────────────────

const MODELS = [
  { id: 'claude-haiku-4-5',  label: 'Claude Haiku',  desc: 'Rápido e econômico',         badge: 'Rápido',      badgeClass: 'bg-blue-500/10 text-blue-600' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet', desc: 'Equilíbrio custo/qualidade', badge: 'Recomendado', badgeClass: 'bg-green-500/10 text-green-600' },
  { id: 'claude-opus-4-6',   label: 'Claude Opus',   desc: 'Máxima qualidade',           badge: 'Premium',     badgeClass: 'bg-purple-500/10 text-purple-600' },
];

const STORAGE_KEY = 'peticoes_conversations_v2';
const MAX_CONVERSATIONS = 50;

const ANTHROPIC_SKILL_ICONS: Record<string, React.ReactNode> = {
  xlsx: <FileSpreadsheet size={14} className="text-green-500" />,
  pptx: <Presentation size={14} className="text-orange-500" />,
  docx: <FileType size={14} className="text-blue-500" />,
  pdf:  <FileText size={14} className="text-red-500" />,
};

const DEFAULT_SYSTEM_PROMPT = `Você é um assistente jurídico especializado em direito brasileiro, auxiliando advogados na redação de petições, análise de casos e pesquisa jurídica.

## Suas capacidades:
- Redigir petições iniciais, recursos, contestações, réplicas, embargos e demais documentos processuais
- Analisar casos e identificar teses jurídicas aplicáveis
- Citar jurisprudência, legislação e doutrina relevante
- Calcular prazos processuais (CPC, CLT, etc.)
- Revisar documentos e sugerir melhorias

## Regras:
- Use linguagem jurídica formal e técnica
- Cite artigos de lei (CLT, CPC, CF/88, CC, CDC, etc.) quando aplicável
- Estruture petições com: Endereçamento, Qualificação das Partes, Dos Fatos, Do Direito, Dos Pedidos
- Use marcadores [ ] para informações que precisam ser completadas
- Responda sempre em português brasileiro`;

// ─── Helpers ────────────────────────────────────────────────

function genId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function loadConversations(): Conversation[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch { return []; }
}

function saveConversations(convs: Conversation[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(convs.slice(-MAX_CONVERSATIONS))); } catch {}
}

function getConvTitle(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === 'user');
  if (!first) return 'Nova Conversa';
  const text = typeof first.content === 'string' ? first.content : '';
  return text.slice(0, 60) + (text.length > 60 ? '…' : '');
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Ontem';
  if (diffDays < 7) return `${diffDays}d atrás`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

// ─── Markdown Renderer ──────────────────────────────────────

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

  return (
    <div className="flex justify-start mb-4 group">
      <div className="max-w-[85%] flex items-start gap-2">
        <div className="w-7 h-7 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0 mt-1">
          <Sparkles size={13} className="text-amber-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div
            className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed shadow-sm"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
          />
          {/* Generated files */}
          {msg.files && msg.files.length > 0 && (
            <div className="mt-2 space-y-1">
              {msg.files.map((f) => (
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
          {isStreaming && msg.content === '' && (
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
  // Skills from Claude Console
  const [consoleSkills, setConsoleSkills] = useState<ConsoleSkill[]>([]);
  const [loadingSkills, setLoadingSkills] = useState(true);
  const [selectedSkills, setSelectedSkills] = useState<SkillRef[]>([]);
  const [showSkillMenu, setShowSkillMenu] = useState(false);

  // Model
  const [selectedModel, setSelectedModel] = useState<string>('claude-sonnet-4-6');
  const [showModelMenu, setShowModelMenu] = useState(false);

  // Mode: 'skills' (Console skills) or 'free' (custom system prompt)
  const [mode, setMode] = useState<'skills' | 'free'>('skills');
  const [customPrompt, setCustomPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [showPromptEditor, setShowPromptEditor] = useState(false);

  // Conversations
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);

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
  const skillMenuRef = useRef<HTMLDivElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);

  // ─── Init ──────────────────────────────────────────────

  useEffect(() => {
    setConversations(loadConversations());

    const token = localStorage.getItem('token');
    fetch(`${API_BASE_URL}/petitions/chat/skills?source=all`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setConsoleSkills(data); })
      .catch(() => {})
      .finally(() => setLoadingSkills(false));
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (skillMenuRef.current && !skillMenuRef.current.contains(e.target as Node)) setShowSkillMenu(false);
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

  // ─── Conversation Management ───────────────────────────

  const createNewConversation = useCallback(() => {
    const id = genId();
    const conv: Conversation = {
      id, title: 'Nova Conversa', skills: selectedSkills, model: selectedModel,
      containerId: null, messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    setConversations((prev) => { const next = [...prev, conv]; saveConversations(next); return next; });
    setActiveConvId(id);
    setMessages([]);
    setContainerId(null);
    setStreamError(null);
    setAttachedFiles([]);
    setInput('');
  }, [selectedSkills, selectedModel]);

  const selectConversation = useCallback((conv: Conversation) => {
    if (isStreaming) return;
    setActiveConvId(conv.id);
    setMessages(conv.messages);
    setSelectedSkills(conv.skills);
    setSelectedModel(conv.model);
    setContainerId(conv.containerId);
    setStreamError(null);
    setAttachedFiles([]);
  }, [isStreaming]);

  const deleteConversation = useCallback((convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConversations((prev) => { const next = prev.filter((c) => c.id !== convId); saveConversations(next); return next; });
    if (activeConvId === convId) { setActiveConvId(null); setMessages([]); setContainerId(null); }
  }, [activeConvId]);

  const persistMessages = useCallback(
    (convId: string, msgs: ChatMessage[], cId: string | null) => {
      setConversations((prev) => {
        const next = prev.map((c) =>
          c.id !== convId ? c : { ...c, messages: msgs, title: getConvTitle(msgs), containerId: cId, skills: selectedSkills, model: selectedModel, updatedAt: new Date().toISOString() },
        );
        saveConversations(next);
        return next;
      });
    },
    [selectedSkills, selectedModel],
  );

  // ─── Skill Toggle ──────────────────────────────────────

  const toggleSkill = (skill: ConsoleSkill) => {
    setSelectedSkills((prev) => {
      const exists = prev.find((s) => s.skill_id === skill.id);
      if (exists) return prev.filter((s) => s.skill_id !== skill.id);
      if (prev.length >= 8) return prev; // Max 8 skills
      return [...prev, { type: skill.source, skill_id: skill.id, version: 'latest' }];
    });
  };

  // ─── File Upload ───────────────────────────────────────

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setUploadingFile(true);
    setStreamError(null);
    const token = localStorage.getItem('token');

    try {
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
      setAttachedFiles((prev) => [...prev, { id: data.id, name: data.filename || file.name }]);
    } catch (err: any) {
      setStreamError(`Erro no upload: ${err.message}`);
    } finally {
      setUploadingFile(false);
    }
  };

  // ─── Send Message ──────────────────────────────────────

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    setStreamError(null);

    // Ensure conversation exists
    let convId = activeConvId;
    if (!convId) {
      const id = genId();
      const conv: Conversation = {
        id, title: 'Nova Conversa', skills: selectedSkills, model: selectedModel,
        containerId: null, messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      setConversations((prev) => { const next = [...prev, conv]; saveConversations(next); return next; });
      convId = id;
      setActiveConvId(id);
    }

    const userMsg: ChatMessage = { id: genId(), role: 'user', content: text, createdAt: new Date().toISOString() };
    const assistantMsg: ChatMessage = { id: genId(), role: 'assistant', content: '', createdAt: new Date().toISOString() };

    const newMessages = [...messages, userMsg, assistantMsg];
    setMessages(newMessages);
    setInput('');
    setIsStreaming(true);

    const token = localStorage.getItem('token');
    const controller = new AbortController();
    abortRef.current = controller;

    // Build API payload
    const apiMessages = [...messages, userMsg].map((m) => ({ role: m.role, content: m.content }));

    const body: any = {
      messages: apiMessages,
      model: selectedModel,
    };

    // Skills mode → send skills + container
    if (mode === 'skills' && selectedSkills.length > 0) {
      body.skills = selectedSkills;
      if (containerId) body.containerId = containerId;
    }

    // Free mode → send system prompt
    if (mode === 'free') {
      body.systemPrompt = customPrompt;
    }

    // Attached files (uploaded to Console)
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
      let buffer = '';
      let fullText = '';
      let newContainerId: string | null = containerId;
      let generatedFiles: { fileId: string; filename: string }[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'text') {
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
            }
          } catch {}
        }
      }

      // Update container ID for next turn
      if (newContainerId) setContainerId(newContainerId);

      const finalAssistant: ChatMessage = {
        ...assistantMsg,
        content: fullText,
        files: generatedFiles.length > 0 ? generatedFiles : undefined,
      };
      const finalMsgs = [...messages, userMsg, finalAssistant];
      setMessages(finalMsgs);
      persistMessages(convId, finalMsgs, newContainerId);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setStreamError(err?.message || 'Erro ao conectar com a IA');
      setMessages((prev) => prev.filter((m) => m.id !== assistantMsg.id));
      setAttachedFiles(currentAttachedFiles);
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [input, isStreaming, activeConvId, messages, selectedSkills, selectedModel, mode, customPrompt, containerId, attachedFiles, persistMessages]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  // ─── Derived state ─────────────────────────────────────

  const selectedModelInfo = MODELS.find((m) => m.id === selectedModel) || MODELS[1];
  const sortedConversations = [...conversations].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const customSkills = consoleSkills.filter((s) => s.source === 'custom');
  const anthropicSkills = consoleSkills.filter((s) => s.source === 'anthropic');

  const selectedSkillNames = selectedSkills.map((sr) => {
    const s = consoleSkills.find((cs) => cs.id === sr.skill_id);
    return s?.displayTitle || s?.name || sr.skill_id;
  });

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
            <h1 className="text-sm font-bold text-foreground">IA Jurídica</h1>
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

        {/* Mode Toggle */}
        <div className="px-3 pt-3">
          <div className="flex rounded-xl border border-border overflow-hidden">
            <button onClick={() => setMode('skills')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-[12px] font-medium transition-colors ${mode === 'skills' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:text-foreground'}`}>
              <Code2 size={13} /> Skills
            </button>
            <button onClick={() => setMode('free')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-[12px] font-medium transition-colors ${mode === 'free' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:text-foreground'}`}>
              <Zap size={13} /> Livre
            </button>
          </div>
        </div>

        {/* Skills Selector (Skills mode) */}
        {mode === 'skills' && (
          <div className="px-3 pt-3" ref={skillMenuRef}>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5 px-1">
              Skills do Console ({selectedSkills.length}/8)
            </p>
            <button onClick={() => setShowSkillMenu(!showSkillMenu)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-border bg-background hover:bg-muted/50 transition-colors text-sm">
              <span className="truncate text-foreground font-medium text-[12px]">
                {selectedSkills.length === 0 ? 'Selecionar skills...' : selectedSkillNames.join(', ')}
              </span>
              <ChevronDown size={14} className="text-muted-foreground shrink-0" />
            </button>

            {showSkillMenu && (
              <div className="mt-1 rounded-xl border border-border bg-card shadow-xl overflow-hidden max-h-80 overflow-y-auto z-50 relative">
                {loadingSkills && (
                  <div className="flex items-center gap-2 px-3 py-3 text-muted-foreground text-sm">
                    <Loader2 size={14} className="animate-spin" /> Carregando do Console...
                  </div>
                )}

                {/* Custom skills */}
                {customSkills.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-3 pt-2 pb-1">Suas Skills</p>
                    {customSkills.map((skill) => {
                      const isSelected = selectedSkills.some((s) => s.skill_id === skill.id);
                      return (
                        <button key={skill.id} onClick={() => toggleSkill(skill)}
                          className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors ${isSelected ? 'bg-amber-500/10' : ''}`}>
                          <div className={`w-4 h-4 rounded border mt-0.5 shrink-0 flex items-center justify-center ${isSelected ? 'bg-primary border-primary' : 'border-border'}`}>
                            {isSelected && <Check size={10} className="text-primary-foreground" />}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{skill.displayTitle || skill.name}</p>
                            {skill.description && <p className="text-[11px] text-muted-foreground line-clamp-2">{skill.description}</p>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Anthropic built-in skills */}
                {anthropicSkills.length > 0 && (
                  <div className={customSkills.length > 0 ? 'border-t border-border' : ''}>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-3 pt-2 pb-1">Skills Anthropic</p>
                    {anthropicSkills.map((skill) => {
                      const isSelected = selectedSkills.some((s) => s.skill_id === skill.id);
                      return (
                        <button key={skill.id} onClick={() => toggleSkill(skill)}
                          className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors ${isSelected ? 'bg-amber-500/10' : ''}`}>
                          <div className={`w-4 h-4 rounded border mt-0.5 shrink-0 flex items-center justify-center ${isSelected ? 'bg-primary border-primary' : 'border-border'}`}>
                            {isSelected && <Check size={10} className="text-primary-foreground" />}
                          </div>
                          <div className="flex items-center gap-2 min-w-0">
                            {ANTHROPIC_SKILL_ICONS[skill.name] || <Bot size={14} className="text-muted-foreground" />}
                            <span className="text-sm font-medium text-foreground">{skill.displayTitle || skill.name}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {!loadingSkills && consoleSkills.length === 0 && (
                  <p className="px-3 py-3 text-[12px] text-muted-foreground text-center">
                    Nenhuma skill encontrada. Verifique sua API Key.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Custom System Prompt (Free mode) */}
        {mode === 'free' && (
          <div className="px-3 pt-3">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5 px-1">System Prompt</p>
            {showPromptEditor ? (
              <div>
                <textarea value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)}
                  rows={8} className="w-full text-xs bg-background border border-border rounded-xl px-3 py-2 resize-none text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
                <button onClick={() => setShowPromptEditor(false)} className="mt-1 text-[11px] text-primary hover:underline">Fechar editor</button>
              </div>
            ) : (
              <button onClick={() => setShowPromptEditor(true)}
                className="w-full text-left px-3 py-2 rounded-xl border border-border bg-background hover:bg-muted/50 transition-colors">
                <p className="text-[12px] text-foreground font-medium truncate">Assistente Jurídico</p>
                <p className="text-[11px] text-muted-foreground truncate">{customPrompt.slice(0, 60)}…</p>
              </button>
            )}
          </div>
        )}

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

        {/* Conversations List */}
        <div className="flex-1 overflow-y-auto px-3 pt-4 pb-2">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2 px-1">Conversas Recentes</p>
          {sortedConversations.length === 0 ? (
            <p className="text-[12px] text-muted-foreground text-center py-4">Nenhuma conversa ainda</p>
          ) : (
            <div className="space-y-0.5">
              {sortedConversations.map((conv) => (
                <div key={conv.id} onClick={() => selectConversation(conv)}
                  className={`group flex items-center gap-2 px-2.5 py-2 rounded-xl cursor-pointer transition-colors ${activeConvId === conv.id ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50 text-foreground'}`}>
                  <MessageSquare size={13} className="text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium truncate leading-snug">{conv.title}</p>
                    <p className="text-[10px] text-muted-foreground">{formatDate(conv.updatedAt)}</p>
                  </div>
                  <button onClick={(e) => deleteConversation(conv.id, e)}
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
                {activeConvId ? (conversations.find((c) => c.id === activeConvId)?.title || 'Nova Conversa') : 'Assistente Jurídico IA'}
              </h2>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-muted-foreground">{selectedModelInfo.label}</span>
                {mode === 'skills' && selectedSkills.length > 0 && (
                  <>
                    <span className="text-muted-foreground/50">·</span>
                    <span className="text-[11px] text-amber-600 font-medium">{selectedSkills.length} skill{selectedSkills.length > 1 ? 's' : ''}</span>
                  </>
                )}
                {mode === 'free' && (
                  <>
                    <span className="text-muted-foreground/50">·</span>
                    <span className="text-[11px] text-purple-600 font-medium">Modo Livre</span>
                  </>
                )}
                {containerId && (
                  <>
                    <span className="text-muted-foreground/50">·</span>
                    <span className="text-[11px] text-green-600 font-medium flex items-center gap-1"><Code2 size={10} /> Container ativo</span>
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
        <div className="flex-1 overflow-y-auto px-4 py-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-4">
                <Sparkles size={28} className="text-amber-500" />
              </div>
              <h3 className="text-lg font-bold text-foreground mb-2">Assistente Jurídico com Claude</h3>
              <p className="text-sm text-muted-foreground max-w-md mb-2">
                Conectado ao <strong>Claude Console</strong>. Use suas skills, faça upload de arquivos e gere documentos.
              </p>
              <p className="text-[12px] text-muted-foreground max-w-md mb-6">
                {mode === 'skills'
                  ? 'Selecione skills no painel lateral (xlsx, pdf, docx, ou suas skills customizadas).'
                  : 'Modo Livre — usando prompt personalizado sem skills.'}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg">
                {[
                  { text: 'Redija uma petição inicial trabalhista por rescisão indireta', icon: '⚖️' },
                  { text: 'Gere um contrato de honorários em DOCX', icon: '📄' },
                  { text: 'Analise este processo criminal e prepare estratégia para audiência', icon: '🔍' },
                  { text: 'Crie uma planilha Excel com cálculos trabalhistas', icon: '📊' },
                ].map((s) => (
                  <button key={s.text} onClick={() => { setInput(s.text); textareaRef.current?.focus(); }}
                    className="flex items-start gap-2 p-3 rounded-xl border border-border bg-card hover:bg-muted/50 text-left text-sm text-foreground transition-colors">
                    <span className="text-base shrink-0">{s.icon}</span>
                    <span className="text-[12px] text-muted-foreground leading-relaxed">{s.text}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto">
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
              <div className="flex flex-wrap gap-2 mb-2">
                {attachedFiles.map((f) => (
                  <div key={f.id} className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-muted/50 border border-border text-[12px]">
                    <File size={13} className="text-blue-500" />
                    <span className="truncate max-w-40">{f.name}</span>
                    <button onClick={() => setAttachedFiles((prev) => prev.filter((x) => x.id !== f.id))}
                      className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"><X size={11} /></button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-end gap-2">
              {/* File upload */}
              <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload}
                accept=".txt,.md,.json,.csv,.html,.pdf,.docx,.xlsx,.pptx,.doc,.xls,.ppt" />
              <button onClick={() => fileInputRef.current?.click()} disabled={isStreaming || uploadingFile}
                className="p-2.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                title="Upload para o Claude Console (PDF, DOCX, XLSX, etc.)">
                {uploadingFile ? <Loader2 size={18} className="animate-spin" /> : <Paperclip size={18} />}
              </button>

              <div className="flex-1 relative">
                <textarea ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown} disabled={isStreaming}
                  placeholder="Descreva a petição ou faça uma pergunta jurídica... (Enter para enviar)"
                  rows={1}
                  className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 min-h-[46px] max-h-[200px] leading-relaxed" />
              </div>

              {isStreaming ? (
                <button onClick={() => { abortRef.current?.abort(); setIsStreaming(false); }}
                  className="p-2.5 rounded-xl bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"><X size={18} /></button>
              ) : (
                <button onClick={sendMessage} disabled={!input.trim()}
                  className="p-2.5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 shadow-sm">
                  <Send size={18} />
                </button>
              )}
            </div>

            <p className="text-[10px] text-muted-foreground text-center mt-2">
              {selectedModelInfo.label} · Claude Console · IA pode cometer erros — revise antes de usar
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
