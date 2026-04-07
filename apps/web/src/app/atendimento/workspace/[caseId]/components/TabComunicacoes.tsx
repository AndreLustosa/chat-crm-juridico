'use client';

import { useCallback, useEffect, useState } from 'react';
import { MessageSquare, Loader2, ChevronUp, Image, FileText, Mic } from 'lucide-react';
import api from '@/lib/api';
import { showError } from '@/lib/toast';

interface ChatMessage {
  id: string;
  direction: string; // 'inbound' | 'outbound'
  type: string;      // 'text' | 'image' | 'audio' | 'document' | etc.
  text: string | null;
  status: string;
  created_at: string;
  media: {
    id: string;
    mime_type: string;
    s3_key: string;
    original_name: string | null;
  } | null;
}

function formatTime(d: string) {
  return new Date(d).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function MediaIcon({ type }: { type: string }) {
  switch (type) {
    case 'image': return <Image className="h-3 w-3" />;
    case 'audio': return <Mic className="h-3 w-3" />;
    case 'document': return <FileText className="h-3 w-3" />;
    default: return null;
  }
}

export default function TabComunicacoes({ caseId }: { caseId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const limit = 50;

  const fetchMessages = useCallback(async (p: number, append = false) => {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    try {
      const res = await api.get(`/legal-cases/${caseId}/communications`, {
        params: { page: p, limit },
      });
      const { data, total: t } = res.data;
      if (append) {
        setMessages(prev => [...prev, ...data]);
      } else {
        setMessages(data || []);
      }
      setTotal(t);
      setPage(p);
    } catch {
      showError('Erro ao carregar comunicações');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [caseId]);

  useEffect(() => {
    fetchMessages(1);
  }, [fetchMessages]);

  const hasMore = page * limit < total;

  const loadMore = () => {
    fetchMessages(page + 1, true);
  };

  // Reverse for chronological order (API returns desc)
  const sorted = [...messages].reverse();

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">

      {/* Chat Card */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">

        {/* Card Header */}
        <div className="px-5 py-3.5 border-b border-border bg-accent/20">
          <h2 className="text-[13px] font-bold text-foreground flex items-center gap-2">
            <MessageSquare size={14} className="text-primary" />
            Comunicações
            {total > 0 && (
              <span className="text-[10px] font-medium text-muted-foreground ml-1">
                ({total})
              </span>
            )}
          </h2>
        </div>

        {/* Card Body */}
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-5">
            <MessageSquare size={48} className="text-muted-foreground opacity-20 mb-3" />
            <p className="text-[12px] text-muted-foreground">
              Nenhuma comunicação registrada neste caso
            </p>
          </div>
        ) : (
          <div className="p-5 space-y-3">

            {/* Load more (older messages) */}
            {hasMore && (
              <div className="flex justify-center pb-2">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-accent/40 text-[10px] font-bold text-muted-foreground hover:bg-accent/60 transition-colors disabled:opacity-50"
                >
                  {loadingMore ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <ChevronUp size={11} />
                  )}
                  Carregar mensagens anteriores
                </button>
              </div>
            )}

            {/* Messages */}
            <div className="space-y-2.5">
              {sorted.map(msg => {
                const isInbound = msg.direction === 'inbound';
                return (
                  <div
                    key={msg.id}
                    className={`flex ${isInbound ? 'justify-start' : 'justify-end'}`}
                  >
                    <div
                      className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                        isInbound
                          ? 'bg-accent/40 rounded-tl-sm'
                          : 'bg-primary/10 rounded-tr-sm'
                      }`}
                    >
                      {/* Media indicator */}
                      {msg.media && (
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1.5">
                          <MediaIcon type={msg.type} />
                          <span className="truncate">{msg.media.original_name || msg.type}</span>
                        </div>
                      )}

                      {/* Text */}
                      {msg.text && (
                        <p className="text-[12px] text-foreground whitespace-pre-wrap break-words leading-relaxed">
                          {msg.text}
                        </p>
                      )}

                      {/* Timestamp */}
                      <p className={`text-[10px] text-muted-foreground mt-1 ${
                        isInbound ? '' : 'text-right'
                      }`}>
                        {formatTime(msg.created_at)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
