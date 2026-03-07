'use client';

import React, { memo } from 'react';
import { Download, Mic, FileText, Trash2, Reply, Pencil, CheckCheck, Check } from 'lucide-react';
import { AudioPlayer } from '@/components/AudioPlayer';
import type { MessageItem } from '../types';

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
  onDocPreview,
  onImageDownload,
  onDocDownload,
}: MessageBubbleProps) {
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
          <button
            onClick={() => onDelete(msg.id)}
            className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
            title="Apagar mensagem"
            aria-label="Apagar mensagem"
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}

      {/* Bubble content */}
      <div className={`max-w-[74%] md:max-w-[65%] min-w-[60px] p-3 md:p-4 shadow-sm break-words overflow-hidden ${
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
            <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{msg.text}</p>
          )
        ) : msg.type === 'audio' ? (
          msg.media ? (
            <div>
              <AudioPlayer
                src={`/api/media/${msg.id}`}
                duration={msg.media.duration}
                isOutgoing={isOut}
              />
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
          ) : (
            <div className="flex items-center gap-3 w-48 animate-pulse">
              <div className="w-8 h-8 rounded-full bg-current opacity-20 shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-1 rounded bg-current opacity-20" />
                <div className="h-1 rounded bg-current opacity-10 w-3/4" />
              </div>
            </div>
          )
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
      </div>

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
    prev.isOut === next.isOut &&
    prev.editingMsg?.id === next.editingMsg?.id &&
    (prev.editingMsg?.id !== prev.msg.id || prev.editingMsg?.text === next.editingMsg?.text) &&
    prev.transcribing[prev.msg.id] === next.transcribing[next.msg.id]
  );
});
