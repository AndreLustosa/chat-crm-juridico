'use client';

import React, { memo } from 'react';
import { Download, Mic, FileText, Trash2, Reply, Pencil, CheckCheck, Check, Bot, Loader2 } from 'lucide-react';
import { AudioPlayer } from '@/components/AudioPlayer';
import { LinkPreview } from '@/components/LinkPreview';
import type { MessageItem } from '../types';

const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/gi;

function extractFirstUrl(text: string | null): string | null {
  if (!text) return null;
  const match = text.match(URL_REGEX);
  return match ? match[0] : null;
}

// ─── Helpers ────────────────────────────────────────────────────

function StatusIcon({ status, isOut }: { status: string; isOut: boolean }) {
  if (!isOut) return null;
  if (status === 'enviando') return <div className="w-3 h-3 border border-primary-foreground/60 border-t-transparent rounded-full animate-spin" />;
  if (status === 'lido' || status === 'read') return <CheckCheck size={12} className="text-blue-400" />;
  if (status === 'entregue' || status === 'delivered') return <CheckCheck size={12} className="text-primary-foreground/60" />;
  return <Check size={12} className="text-primary-foreground/60" />;
}

function formatTime(dateStr?: string) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function isEmojiOnly(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /^(\p{Emoji_Presentation}|\p{Extended_Pictographic}|\s)+$/u.test(t);
}

function getDocLabel(mime: string, name?: string) {
  if (name) { const p = name.split('.'); if (p.length > 1) return p.pop()!.toUpperCase(); }
  const map: Record<string, string> = {
    'application/pdf': 'PDF',
    'application/msword': 'DOC',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
    'application/vnd.ms-excel': 'XLS',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  };
  return map[mime] || 'FILE';
}

// ─── Props ──────────────────────────────────────────────────────

// Fase atual da conversa (next_step do Conversation)
const NEXT_STEP_LABELS: Record<string, string> = {
  duvidas:           '❓ Dúvidas',
  triagem_concluida: '✅ Triagem',
  entrevista:        '📝 Entrevista',
  formulario:        '📋 Formulário',
  reuniao:           '📞 Reunião',
  documentos:        '📎 Documentos',
  procuracao:        '✍️ Procuração',
  encerrado:         '🔒 Encerrado',
  perdido:           '❌ Perdido',
};

export interface MessageBubbleProps {
  msg: MessageItem;
  isOut: boolean;
  editingMsg: { id: string; text: string } | null;
  transcribing: Record<string, boolean>;
  onReply: (msg: MessageItem) => void;
  onEdit: (id: string, text: string) => void;
  onSetEditing: (edit: { id: string; text: string } | null) => void;
  onDelete: (id: string) => void;
  onTranscribe: (id: string) => void;
  onLightbox: (url: string) => void;
  onDocPreview: (preview: { url: string; name: string; mime: string }) => void;
  onImageDownload: (url: string) => void;
  onDocDownload: (url: string, name: string) => void;
  onReact?: (id: string, emoji: string) => void;
  onForward?: (msg: MessageItem) => void;
  /** Fase atual da conversa (exibida no badge da IA) */
  nextStep?: string | null;
}

// ─── Component ──────────────────────────────────────────────────

function MessageBubbleInner({
  msg,
  isOut,
  editingMsg,
  transcribing,
  onReply,
  onEdit,
  onSetEditing,
  onDelete,
  onTranscribe,
  onLightbox,
  nextStep,
  onDocPreview,
  onImageDownload,
  onDocDownload,
  onReact,
  onForward,
}: MessageBubbleProps) {
  // Evento de transferência: separador centralizado
  if (msg.type === 'transfer_event') {
    return (
      <div id={`msg-${msg.id}`} className="w-full flex justify-center my-2">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-400 text-[11px] font-semibold">
          <span>{msg.text}</span>
          <span className="text-sky-400/50 text-[9px]">{formatTime(msg.created_at)}</span>
        </div>
      </div>
    );
  }

  // Nota interna: renderização especial em amber sem envio ao WhatsApp
  if (msg.type === 'internal_note') {
    return (
      <div id={`msg-${msg.id}`} className="w-full flex justify-end">
        <div className="max-w-[80%] flex flex-col gap-1">
          <div className="flex items-center gap-1.5 justify-end">
            <span className="text-[9px] font-bold text-amber-400/70 uppercase tracking-wider">🔒 nota interna</span>
          </div>
          <div className="bg-amber-500/15 border border-amber-500/30 rounded-2xl rounded-tr-sm px-4 py-2.5 shadow-sm">
            <p className="text-sm text-amber-100/90 leading-relaxed whitespace-pre-wrap">{msg.text}</p>
            <div className="flex justify-end mt-1">
              <span className="text-[10px] text-amber-400/50">{formatTime(msg.created_at)}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div id={`msg-${msg.id}`} className={`w-full flex items-end gap-1 ${isOut ? 'justify-end' : 'justify-start'} group rounded-xl transition-all duration-300`}>
      {/* Hover actions - incoming */}
      {!isOut && (
        <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mb-1">
          <button
            onClick={() => onReply(msg)}
            className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary"
            title="Responder"
            aria-label="Responder mensagem"
          >
            <Reply size={13} />
          </button>
          {onForward && msg.text && msg.type !== 'deleted' && (
            <button
              onClick={() => onForward(msg)}
              className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary"
              title="Encaminhar mensagem"
              aria-label="Encaminhar mensagem"
            >
              <span className="text-[11px] font-bold leading-none">↪</span>
            </button>
          )}
          <button
            onClick={() => onDelete(msg.id)}
            className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
            title="Apagar mensagem"
            aria-label="Apagar mensagem"
          >
            <Trash2 size={13} />
          </button>
          {onReact && msg.type !== 'deleted' && (
            <div className="relative group/react">
              <button className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary text-[11px]" title="Reagir">😊</button>
              <div className="absolute bottom-full left-0 mb-1 hidden group-hover/react:flex bg-card border border-border rounded-full shadow-lg px-1 py-0.5 gap-0.5 z-10">
                {['👍','❤️','😂','😮','😢','🙏'].map(e => (
                  <button key={e} onClick={() => onReact(msg.id, e)} className="p-1 hover:bg-muted rounded-full text-sm transition-transform hover:scale-125">{e}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bubble wrapper (badge + bolha empilhados) */}
      <div className="flex flex-col items-end gap-0.5 max-w-[74%] md:max-w-[65%]">

        {/* Badge de especialista IA + fase da conversa */}
        {isOut && msg.skill && (
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted/70 border border-border text-[10px] text-muted-foreground font-medium">
              <Bot size={9} className="shrink-0" />
              <span>{msg.skill.name}</span>
            </div>
            {nextStep && (
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted/70 border border-border text-[10px] text-muted-foreground font-medium">
                <span>{NEXT_STEP_LABELS[nextStep] ?? nextStep}</span>
              </div>
            )}
          </div>
        )}

        {/* Bubble content */}
        <div className={`w-full min-w-[60px] p-3 md:p-4 shadow-sm break-words overflow-hidden ${
          isOut
            ? 'bg-gradient-to-tr from-primary/90 to-ring/90 text-primary-foreground rounded-2xl rounded-tr-sm'
            : 'bg-card border border-border rounded-2xl rounded-tl-sm'
        }`}>
        {/* Reply context */}
        {msg.reply_to_text && msg.type !== 'deleted' && (
          <div
            className={`mb-2 pl-3 border-l-2 rounded-sm cursor-pointer ${isOut ? 'border-white/40 bg-white/10' : 'border-primary/50 bg-primary/5'}`}
            onClick={() => {
              const el = document.getElementById(`msg-${msg.reply_to_id}`);
              el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              el?.classList.add('ring-2', 'ring-primary/50');
              setTimeout(() => el?.classList.remove('ring-2', 'ring-primary/50'), 1500);
            }}
          >
            <p className={`text-[11px] py-1 pr-2 line-clamp-2 ${isOut ? 'text-white/60' : 'text-muted-foreground'}`}>{msg.reply_to_text}</p>
          </div>
        )}

        {/* Deleted by contact banner — content preserved for evidence */}
        {msg.status === 'apagado_pelo_contato' && (
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium text-red-400/80 italic">
            <span>🚫</span> Apagada pelo contato
          </div>
        )}

        {/* Message content by type */}
        {msg.type === 'deleted' ? (
          <p className="text-sm italic opacity-50">&#128683; Mensagem apagada</p>
        ) : msg.type === 'text' || !msg.type ? (
          editingMsg?.id === msg.id ? (
            <div className="flex flex-col gap-2 min-w-[200px]">
              <textarea
                autoFocus
                rows={3}
                value={editingMsg.text}
                onChange={e => onSetEditing({ ...editingMsg, text: e.target.value })}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onEdit(editingMsg.id, editingMsg.text); }
                  if (e.key === 'Escape') onSetEditing(null);
                }}
                className="w-full bg-white/10 text-primary-foreground rounded-lg p-2 text-[14px] resize-none outline-none border border-white/30 focus:border-white/60"
              />
              <div className="flex justify-end gap-2">
                <button onClick={() => onSetEditing(null)} className="text-[11px] px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-primary-foreground/70">Cancelar</button>
                <button onClick={() => onEdit(editingMsg.id, editingMsg.text)} className="text-[11px] px-2 py-1 rounded bg-white/25 hover:bg-white/35 text-primary-foreground font-medium">Salvar</button>
              </div>
            </div>
          ) : isEmojiOnly(msg.text || '') ? (
            <p className="text-4xl leading-tight">{msg.text}</p>
          ) : (
            <>
              <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{msg.text}</p>
              {(() => {
                const url = extractFirstUrl(msg.text);
                return url ? <LinkPreview url={url} isOut={isOut} /> : null;
              })()}
            </>
          )
        ) : msg.type === 'audio' ? (
          <div>
            {msg.media ? (
              <AudioPlayer
                src={`/api/media/${msg.id}`}
                duration={msg.media.duration}
                isOutgoing={isOut}
                messageId={msg.id}
              />
            ) : (
              <div className={`flex items-center gap-2 min-w-[160px] text-[11px] ${isOut ? 'text-white/60' : 'text-muted-foreground'}`}>
                <Loader2 size={13} className="animate-spin shrink-0" />
                <span>Aguardando áudio...</span>
              </div>
            )}
            {msg.text ? (
              <p className={`text-[12px] mt-2 leading-snug italic ${isOut ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                {msg.text}
              </p>
            ) : (
              <button
                onClick={() => onTranscribe(msg.id)}
                disabled={transcribing[msg.id]}
                className={`mt-2 flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg transition-colors disabled:opacity-50 ${isOut ? 'bg-white/15 hover:bg-white/25 text-white/80' : 'bg-primary/10 hover:bg-primary/20 text-primary'}`}
              >
                <Mic size={11} />
                {transcribing[msg.id] ? 'Transcrevendo...' : 'Transcrever'}
              </button>
            )}
          </div>
        ) : msg.type === 'image' ? (
          msg.media ? (
            <div className="relative group inline-block">
              <img
                src={`/api/media/${msg.id}`}
                alt="Imagem"
                className="max-w-[220px] max-h-[220px] object-cover rounded-lg cursor-pointer"
                loading="lazy"
                onClick={() => onLightbox(`/api/media/${msg.id}`)}
              />
              <button
                onClick={() => onImageDownload(`/api/media/${msg.id}`)}
                className="absolute bottom-1.5 right-1.5 bg-black/50 hover:bg-black/70 text-white rounded-md p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Baixar imagem"
                aria-label="Baixar imagem"
              >
                <Download size={13} />
              </button>
            </div>
          ) : (
            <p className="text-sm italic opacity-70">&#128444;&#65039; Imagem processando...</p>
          )
        ) : msg.type === 'video' ? (
          msg.media ? (
            <video src={`/api/media/${msg.id}`} controls className="max-w-full rounded-lg" />
          ) : (
            <p className="text-sm italic opacity-70">&#127916; Video processando...</p>
          )
        ) : msg.type === 'document' ? (
          msg.media ? (
            <div
              className={`flex items-center gap-3 cursor-pointer rounded-xl p-3 min-w-[200px] transition-colors ${isOut ? 'bg-white/10 hover:bg-white/20' : 'bg-muted/60 hover:bg-muted'}`}
              onClick={() => onDocPreview({ url: `/api/media/${msg.id}`, name: msg.media!.original_name || 'documento', mime: msg.media!.mime_type || '' })}
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${isOut ? 'bg-white/20' : 'bg-primary/10'}`}>
                <FileText size={20} className={isOut ? 'text-white' : 'text-primary'} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{msg.media!.original_name || 'Documento'}</p>
                <p className={`text-[11px] uppercase font-semibold mt-0.5 ${isOut ? 'text-white/50' : 'text-muted-foreground'}`}>{getDocLabel(msg.media!.mime_type || '', msg.media!.original_name || '')}</p>
              </div>
              <button
                onClick={e => { e.stopPropagation(); onDocDownload(`/api/media/${msg.id}`, msg.media!.original_name || 'documento'); }}
                className={`p-1.5 rounded-lg transition-colors shrink-0 ${isOut ? 'hover:bg-white/20 text-white/70' : 'hover:bg-primary/10 text-muted-foreground'}`}
                title="Baixar"
                aria-label="Baixar documento"
              >
                <Download size={14} />
              </button>
            </div>
          ) : (
            <p className="text-sm italic opacity-70">&#128196; Documento processando...</p>
          )
        ) : msg.type === 'sticker' ? (
          msg.media ? (
            <img
              src={`/api/media/${msg.id}`}
              alt="Figurinha"
              className="max-w-[140px] max-h-[140px] object-contain"
              loading="lazy"
            />
          ) : (
            <p className="text-sm italic opacity-70">&#127917; Figurinha processando...</p>
          )
        ) : (
          <p className="text-sm italic opacity-70">&#128206; Anexo: {msg.type}</p>
        )}

        {/* Timestamp + status */}
        {msg.type !== 'deleted' && (
          <div className={`text-[10px] mt-2 flex justify-end items-center gap-1.5 ${isOut ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
            <span>{formatTime(msg.created_at)}</span>
            <StatusIcon status={msg.status} isOut={isOut} />
          </div>
        )}
        {/* Reactions display */}
        {msg.reactions && msg.reactions.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5 -mb-1">
            {Object.entries(
              msg.reactions.reduce((acc: Record<string, number>, r) => {
                acc[r.emoji] = (acc[r.emoji] || 0) + 1;
                return acc;
              }, {} as Record<string, number>)
            ).map(([emoji, count]) => (
              <button
                key={emoji}
                onClick={() => onReact?.(msg.id, emoji)}
                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border transition-colors ${
                  isOut
                    ? 'bg-white/10 border-white/20 hover:bg-white/25'
                    : 'bg-muted/60 border-border hover:bg-muted'
                }`}
              >
                <span>{emoji}</span>
                {(count as number) > 1 && <span className="text-[10px] font-medium">{count as number}</span>}
              </button>
            ))}
          </div>
        )}
        </div>{/* /bubble content */}
      </div>{/* /bubble wrapper */}

      {/* Hover actions - outgoing */}
      {isOut && (
        <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mb-1">
          <button
            onClick={() => onReply(msg)}
            className="p-1.5 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary"
            title="Responder"
            aria-label="Responder mensagem"
          >
            <Reply size={16} />
          </button>
          {(msg.type === 'text' || !msg.type) && msg.type !== 'deleted' && (
            <button
              onClick={() => onSetEditing({ id: msg.id, text: msg.text || '' })}
              className="p-1.5 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary"
              title="Editar mensagem"
              aria-label="Editar mensagem"
            >
              <Pencil size={16} />
            </button>
          )}
          <button
            onClick={() => onDelete(msg.id)}
            className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
            title="Apagar mensagem"
            aria-label="Apagar mensagem"
          >
            <Trash2 size={16} />
          </button>
          {onReact && msg.type !== 'deleted' && (
            <div className="relative group/react">
              <button className="p-1.5 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary text-[11px]" title="Reagir">😊</button>
              <div className="absolute bottom-full right-0 mb-1 hidden group-hover/react:flex bg-card border border-border rounded-full shadow-lg px-1 py-0.5 gap-0.5 z-10">
                {['👍','❤️','😂','😮','😢','🙏'].map(e => (
                  <button key={e} onClick={() => onReact(msg.id, e)} className="p-1 hover:bg-muted rounded-full text-sm transition-transform hover:scale-125">{e}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const MessageBubble = memo(MessageBubbleInner, (prev, next) => {
  return (
    prev.msg.id === next.msg.id &&
    prev.msg.text === next.msg.text &&
    prev.msg.status === next.msg.status &&
    prev.msg.type === next.msg.type &&
    prev.msg.media === next.msg.media &&
    prev.msg.reactions === next.msg.reactions &&
    prev.msg.skill === next.msg.skill &&
    prev.isOut === next.isOut &&
    prev.editingMsg?.id === next.editingMsg?.id &&
    (prev.editingMsg?.id !== prev.msg.id || prev.editingMsg?.text === next.editingMsg?.text) &&
    prev.transcribing[prev.msg.id] === next.transcribing[next.msg.id] &&
    prev.nextStep === next.nextStep
  );
});
