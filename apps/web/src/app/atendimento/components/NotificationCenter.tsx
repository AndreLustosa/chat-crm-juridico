'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Bell, X, MessageSquare, ArrowRightLeft, Clock, Calendar, Scale, FileText, Check, CheckCheck, Loader2, UserPlus } from 'lucide-react';
import api from '@/lib/api';
import { useRouter } from 'next/navigation';
import { useSocketEvent } from '@/lib/SocketProvider';
import { activeConversationRef } from '@/lib/activeConversation';

interface NotifItem {
  id: string;
  notification_type: string;
  title: string;
  body?: string | null;
  data?: any;
  read_at?: string | null;
  created_at: string;
}

const TYPE_ICONS: Record<string, any> = {
  incoming_message:  MessageSquare,
  transfer_request:  ArrowRightLeft,
  task_overdue:      Clock,
  calendar_reminder: Calendar,
  legal_case_update: Scale,
  petition_status:   FileText,
  contract_signed:   FileText,
  new_lead:          UserPlus,
};

const TYPE_LABELS: Record<string, string> = {
  incoming_message:  'Mensagem',
  transfer_request:  'Transferência',
  task_overdue:      'Tarefa',
  calendar_reminder: 'Agenda',
  legal_case_update: 'Processo',
  petition_status:   'Petição',
  contract_signed:   'Contrato',
  new_lead:          'Novo lead',
};

const TABS = [
  { key: 'all',      label: 'Todas' },
  { key: 'messages', label: 'Mensagens', types: ['incoming_message'] },
  { key: 'leads',    label: 'Leads',     types: ['new_lead'] },
  { key: 'tasks',    label: 'Tarefas',   types: ['task_overdue', 'calendar_reminder'] },
  { key: 'cases',    label: 'Processos', types: ['legal_case_update', 'petition_status', 'contract_signed'] },
] as const;

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotifItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('all');
  const panelRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Fetch unread count periodicamente
  const fetchUnreadCount = useCallback(async () => {
    try {
      const { data } = await api.get('/notifications/unread-count', { _silent401: true } as any);
      setUnreadCount(data?.count || 0);
    } catch {}
  }, []);

  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 60000); // a cada 1min
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

  // Incrementa badge em tempo real quando chega notificação.
  // Se a msg chega na conversa que o operador ja esta lendo com a aba em foco,
  // o backend ja marcou como lida via mark-read automatico do listener newMessage
  // (page.tsx); aqui apenas suprimimos o +1 visual para evitar badge flicker.
  useSocketEvent('incoming_message_notification', (data: { conversationId?: string }) => {
    if (
      data?.conversationId &&
      activeConversationRef.current === data.conversationId &&
      typeof document !== 'undefined' &&
      document.hasFocus()
    ) {
      return;
    }
    setUnreadCount(prev => prev + 1);
  });
  useSocketEvent('new_lead_notification', () => {
    setUnreadCount(prev => prev + 1);
  });
  // Quando conversa e marcada como lida no backend (operador abriu via sidebar),
  // o markAsRead tambem marca notifs de incoming_message dessa conversa como
  // lidas e emite conversation_read direto para o user (todas as abas).
  // Refetcha para sincronizar o badge do sino.
  useSocketEvent('conversation_read', () => {
    fetchUnreadCount();
  });

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/notifications', { params: { limit: 50 } });
      setItems(data?.data || []);
    } catch {} finally {
      setLoading(false);
    }
  };

  const markRead = async (id: string) => {
    try {
      await api.patch(`/notifications/${id}/read`);
      setItems(prev => prev.map(i => i.id === id ? { ...i, read_at: new Date().toISOString() } : i));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch {}
  };

  const markAllRead = async () => {
    try {
      await api.post('/notifications/mark-all-read');
      setItems(prev => prev.map(i => ({ ...i, read_at: i.read_at || new Date().toISOString() })));
      setUnreadCount(0);
    } catch {}
  };

  const handleClick = (item: NotifItem) => {
    if (!item.read_at) markRead(item.id);
    if (item.data?.conversationId) {
      // Navega para a conversa — dispara select no page.tsx
      window.dispatchEvent(new CustomEvent('select_conversation', { detail: { conversationId: item.data.conversationId } }));
      setOpen(false);
    } else if (
      item.notification_type === 'task_completed' ||
      item.notification_type === 'task_reopened' ||
      item.notification_type === 'task_overdue_delegate'
    ) {
      // Estagiaria concluiu/foi pedida correcao. Roteamos pro contexto:
      //   - tem processo: workspace com drawer da task aberto
      //   - sem processo: painel do advogado (que tem a secao
      //     "Diligencias Delegadas" + drawer overlay)
      const taskId = item.data?.taskId;
      const legalCaseId = item.data?.legalCaseId;
      if (legalCaseId && taskId) {
        router.push(`/atendimento/workspace/${legalCaseId}?openTask=${taskId}`);
      } else if (taskId) {
        router.push(`/atendimento/advogado?openTask=${taskId}`);
      } else {
        router.push('/atendimento/advogado');
      }
      setOpen(false);
    } else if (item.notification_type === 'task_overdue' || item.notification_type === 'calendar_reminder') {
      router.push('/atendimento/agenda');
      setOpen(false);
    } else if (item.notification_type === 'legal_case_update' || item.notification_type === 'petition_status') {
      router.push('/atendimento/processos');
      setOpen(false);
    } else if (item.notification_type === 'new_lead') {
      router.push('/atendimento/crm');
      setOpen(false);
    }
  };

  // Filtro por tab
  const tab = TABS.find(t => t.key === activeTab);
  const filtered = tab && 'types' in tab
    ? items.filter(i => (tab as any).types.includes(i.notification_type))
    : items;

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => { setOpen(o => !o); if (!open) load(); }}
        className="relative p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
        title="Centro de notificações"
        aria-label="Notificações"
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 rounded-full text-[9px] font-bold text-white flex items-center justify-center animate-in zoom-in duration-200">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="text-sm font-bold text-foreground">Notificações</h3>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-[10px] font-semibold text-primary hover:underline"
                >
                  Marcar todas como lidas
                </button>
              )}
              {loading && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground transition-colors">
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-border">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`flex-1 text-[11px] font-semibold py-2 transition-colors border-b-2 ${
                  activeTab === t.key
                    ? 'text-primary border-primary'
                    : 'text-muted-foreground border-transparent hover:text-foreground'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Lista */}
          <div className="max-h-[400px] overflow-y-auto">
            {filtered.length === 0 && !loading ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                <Bell size={24} className="mx-auto mb-2 opacity-30" />
                Nenhuma notificação
              </div>
            ) : (
              filtered.map(item => {
                const Icon = TYPE_ICONS[item.notification_type] || Bell;
                const isUnread = !item.read_at;
                return (
                  <div
                    key={item.id}
                    onClick={() => handleClick(item)}
                    className={`flex items-start gap-3 px-4 py-3 border-b border-border/30 cursor-pointer transition-colors hover:bg-accent/40 ${
                      isUnread ? 'bg-primary/5' : ''
                    }`}
                  >
                    {/* Dot de não-lido */}
                    <div className="mt-1.5 shrink-0">
                      {isUnread ? (
                        <div className="w-2 h-2 rounded-full bg-primary" />
                      ) : (
                        <div className="w-2 h-2" />
                      )}
                    </div>

                    {/* Ícone */}
                    <div className={`mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                      isUnread ? 'bg-primary/10' : 'bg-muted/50'
                    }`}>
                      <Icon size={13} className={isUnread ? 'text-primary' : 'text-muted-foreground'} />
                    </div>

                    {/* Conteúdo */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${
                          isUnread ? 'text-primary' : 'text-muted-foreground'
                        }`}>
                          {TYPE_LABELS[item.notification_type] || item.notification_type}
                        </span>
                        <span className="text-[10px] text-muted-foreground">{timeAgo(item.created_at)}</span>
                      </div>
                      <p className={`text-xs font-medium truncate ${isUnread ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {item.title}
                      </p>
                      {item.body && (
                        <p className="text-[11px] text-muted-foreground truncate">{item.body}</p>
                      )}
                    </div>

                    {/* Ação de leitura */}
                    {isUnread && (
                      <button
                        onClick={(e) => { e.stopPropagation(); markRead(item.id); }}
                        className="mt-1 p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors shrink-0"
                        title="Marcar como lida"
                      >
                        <Check size={12} />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
