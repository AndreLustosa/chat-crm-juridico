'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { X, Send, Sparkles, StickyNote, Pencil, Check, Mic, MicOff } from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';
import type { ConversationNoteItem } from '../types';
import type { Socket } from 'socket.io-client';

interface NotesPanelProps {
  conversationId: string;
  currentUserId: string | null;
  onClose: () => void;
  socketRef: React.RefObject<Socket | null>;
}

export function NotesPanel({ conversationId, currentUserId, onClose, socketRef }: NotesPanelProps) {
  const [notes, setNotes] = useState<ConversationNoteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [listening, setListening] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const editInputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);

  // Fetch notes
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get(`/conversations/${conversationId}/notes`);
        setNotes(res.data || []);
      } catch {
        showError('Erro ao carregar notas.');
      } finally {
        setLoading(false);
      }
    })();
  }, [conversationId]);

  // Socket: new note
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    const onNew = (note: ConversationNoteItem) => {
      if (note.conversation_id === conversationId) {
        setNotes(prev => prev.some(n => n.id === note.id) ? prev : [...prev, note]);
      }
    };
    const onUpdated = (note: ConversationNoteItem) => {
      if (note.conversation_id === conversationId) {
        setNotes(prev => prev.map(n => n.id === note.id ? note : n));
      }
    };
    socket.on('newNote', onNew);
    socket.on('noteUpdated', onUpdated);
    return () => { socket.off('newNote', onNew); socket.off('noteUpdated', onUpdated); };
  }, [conversationId, socketRef]);

  // Auto-resize textarea quando texto muda (inclui speech-to-text que nao dispara onChange)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [notes]);

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (editingId) setEditingId(null); else onClose(); } };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, editingId]);

  // Focus edit input
  useEffect(() => {
    if (editingId) requestAnimationFrame(() => editInputRef.current?.focus());
  }, [editingId]);

  // ── Speech-to-text (Web Speech API) ──────────────────────────
  const toggleListening = useCallback(() => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { showError('Seu navegador não suporta reconhecimento de voz.'); return; }
    const recognition = new SpeechRecognition();
    recognition.lang = 'pt-BR';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event: any) => {
      let interim = '';
      let newFinal = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          newFinal += event.results[i][0].transcript + ' ';
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      setText(prev => {
        // Remove interim anterior (tudo após \u200B) e adiciona apenas o novo final + interim
        const base = prev.replace(/\u200B.*$/, '').trimEnd();
        const withFinal = newFinal ? (base ? base + ' ' : '') + newFinal.trimEnd() : base;
        return interim ? withFinal + '\u200B' + interim : withFinal;
      });
    };
    recognition.onerror = () => { setListening(false); };
    recognition.onend = () => { setListening(false); };
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }, [listening]);

  // Cleanup recognition on unmount
  useEffect(() => {
    return () => { recognitionRef.current?.stop(); };
  }, []);

  const handleSend = async () => {
    if (!text.trim() || sending) return;
    // Stop listening if active
    if (listening) { recognitionRef.current?.stop(); setListening(false); }
    const noteText = text.replace(/\u200B/g, '').trim();
    setSending(true);
    setText('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    try {
      await api.post(`/conversations/${conversationId}/notes`, { text: noteText });
    } catch {
      showError('Erro ao salvar nota.');
      setText(noteText);
    } finally {
      setSending(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const handleCorrectWithAI = async () => {
    if (!text.trim() || correcting) return;
    setCorrecting(true);
    try {
      const res = await api.post('/messages/ai-correct', { text: text.replace(/\u200B/g, '').trim(), action: 'corrigir' });
      if (res.data?.result) { setText(res.data.result); showSuccess('Ortografia corrigida.'); }
    } catch { showError('Erro ao corrigir com IA.'); }
    finally { setCorrecting(false); requestAnimationFrame(() => inputRef.current?.focus()); }
  };

  const startEdit = (note: ConversationNoteItem) => {
    setEditingId(note.id);
    setEditText(note.text);
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editText.trim() || savingEdit) return;
    setSavingEdit(true);
    try {
      await api.patch(`/conversations/${conversationId}/notes/${editingId}`, { text: editText.trim() });
      setEditingId(null);
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao editar nota.');
    } finally {
      setSavingEdit(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const today = new Date();
    const isToday = d.toDateString() === today.toDateString();
    const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (isToday) return `Hoje ${time}`;
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ` ${time}`;
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-[380px] z-50 bg-card border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <StickyNote size={18} className="text-amber-400" />
            <h2 className="text-sm font-bold text-foreground">Notas da Conversa</h2>
            {notes.length > 0 && (
              <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded-full">{notes.length}</span>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground hover:text-foreground">
            <X size={16} />
          </button>
        </div>

        {/* Notes list */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : notes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center gap-3 opacity-50">
              <StickyNote size={40} className="text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Nenhuma nota para esta conversa.</p>
              <p className="text-xs text-muted-foreground">Adicione notas para outros operadores verem.</p>
            </div>
          ) : (
            notes.map(note => (
              <div key={note.id} className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">
                    {note.user?.name || 'Operador'}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-amber-400/50">{formatDate(note.created_at)}</span>
                    {note.user_id === currentUserId && editingId !== note.id && (
                      <button
                        onClick={() => startEdit(note)}
                        className="p-0.5 text-amber-400/40 hover:text-amber-400 transition-colors"
                        title="Editar nota"
                      >
                        <Pencil size={11} />
                      </button>
                    )}
                  </div>
                </div>
                {editingId === note.id ? (
                  <div className="space-y-2">
                    <textarea
                      ref={editInputRef}
                      value={editText}
                      onChange={(e) => {
                        setEditText(e.target.value);
                        e.target.style.height = 'auto';
                        e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSaveEdit(); } if (e.key === 'Escape') setEditingId(null); }}
                      rows={2}
                      className="w-full resize-none rounded-lg bg-amber-500/15 border border-amber-500/40 px-2.5 py-1.5 text-sm text-amber-100 focus:outline-none focus:ring-1 focus:ring-amber-500/40 overflow-hidden"
                    />
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setEditingId(null)} className="px-2 py-1 text-[10px] font-semibold text-muted-foreground hover:text-foreground transition-colors">
                        Cancelar
                      </button>
                      <button
                        onClick={handleSaveEdit}
                        disabled={!editText.trim() || savingEdit}
                        className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold text-amber-900 bg-amber-400 rounded-md hover:bg-amber-300 transition-colors disabled:opacity-40"
                      >
                        {savingEdit ? <div className="w-2.5 h-2.5 border border-amber-900 border-t-transparent rounded-full animate-spin" /> : <Check size={10} />}
                        Salvar
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-amber-100/90 leading-relaxed whitespace-pre-wrap">{note.text}</p>
                )}
              </div>
            ))
          )}
        </div>

        {/* Input area */}
        <div className="shrink-0 border-t border-border p-4">
          <div className="relative">
            <textarea
              ref={inputRef}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
              }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="Escreva uma nota para a equipe..."
              rows={2}
              className={`w-full resize-none rounded-xl border px-3 py-2 pr-10 text-sm placeholder:text-amber-400/40 focus:outline-none focus:ring-1 overflow-hidden ${
                listening
                  ? 'bg-red-500/10 border-red-500/40 focus:ring-red-500/30 text-red-100'
                  : 'bg-amber-500/10 border-amber-500/30 focus:ring-amber-500/30 text-amber-100'
              }`}
            />
            {/* Mic button inside textarea */}
            <button
              onClick={toggleListening}
              title={listening ? 'Parar gravação' : 'Ditar nota por voz'}
              className={`absolute right-2 top-2 p-1.5 rounded-lg transition-colors ${
                listening
                  ? 'text-red-400 bg-red-500/20 animate-pulse'
                  : 'text-muted-foreground hover:text-amber-400 hover:bg-amber-500/10'
              }`}
            >
              {listening ? <MicOff size={14} /> : <Mic size={14} />}
            </button>
          </div>
          <div className="flex items-center justify-between mt-2">
            <button
              onClick={handleCorrectWithAI}
              disabled={!text.trim() || correcting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-violet-400 bg-violet-500/10 border border-violet-500/20 rounded-lg hover:bg-violet-500/20 transition-colors disabled:opacity-40"
            >
              {correcting ? <div className="w-3 h-3 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" /> : <Sparkles size={12} />}
              Corrigir com IA
            </button>
            <button
              onClick={handleSend}
              disabled={!text.trim() || sending}
              className="flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-bold text-amber-900 bg-amber-400 rounded-lg hover:bg-amber-300 transition-colors disabled:opacity-40"
            >
              {sending ? <div className="w-3 h-3 border-2 border-amber-900 border-t-transparent rounded-full animate-spin" /> : <Send size={12} />}
              Salvar Nota
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
