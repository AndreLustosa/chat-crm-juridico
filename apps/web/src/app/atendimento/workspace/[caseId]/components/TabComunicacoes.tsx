'use client';

import { useCallback, useEffect, useState } from 'react';
import { MessageSquare, Loader2, ChevronDown, Image, FileText, Mic } from 'lucide-react';
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
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <h2 className="text-base font-semibold flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-primary" />
        Comunicações
        {total > 0 && <span className="text-xs text-base-content/50">({total} mensagens)</span>}
      </h2>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-12 text-base-content/50">
          <MessageSquare className="h-12 w-12 mx-auto mb-2 opacity-30" />
          <p>Nenhuma comunicação registrada</p>
        </div>
      ) : (
        <>
          {/* Load more (older messages) */}
          {hasMore && (
            <div className="text-center">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="btn btn-ghost btn-xs gap-1"
              >
                {loadingMore ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <ChevronDown className="h-3 w-3 rotate-180" />
                )}
                Carregar mensagens anteriores
              </button>
            </div>
          )}

          <div className="space-y-2">
            {sorted.map(msg => {
              const isInbound = msg.direction === 'inbound';
              return (
                <div
                  key={msg.id}
                  className={`flex ${isInbound ? 'justify-start' : 'justify-end'}`}
                >
                  <div
                    className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                      isInbound
                        ? 'bg-base-200 text-base-content'
                        : 'bg-primary/10 text-base-content'
                    }`}
                  >
                    {/* Media indicator */}
                    {msg.media && (
                      <div className="flex items-center gap-1 text-xs text-base-content/50 mb-1">
                        <MediaIcon type={msg.type} />
                        <span>{msg.media.original_name || msg.type}</span>
                      </div>
                    )}

                    {/* Text */}
                    {msg.text && (
                      <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                    )}

                    {/* Timestamp */}
                    <p className={`text-[10px] mt-1 ${
                      isInbound ? 'text-base-content/40' : 'text-base-content/40 text-right'
                    }`}>
                      {formatTime(msg.created_at)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
