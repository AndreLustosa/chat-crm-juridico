'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, MessageSquare, Bot, ArrowRightLeft, XCircle, Clock, Kanban, Calendar, Settings, User, Loader2, ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import type { ConversationSummary } from '../types';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  conversations: ConversationSummary[];
  selectedId: string | null;
  onSelectConversation: (id: string) => void;
  onToggleAI: () => void;
  onOpenTransferModal: () => void;
  onCloseConversation: () => void;
}

interface LeadResult {
  id: string;
  name: string | null;
  phone: string;
  conversationId?: string | null;
}

interface PaletteItem {
  id: string;
  type: 'conversation' | 'action' | 'lead' | 'nav';
  label: string;
  sublabel?: string;
  icon: React.ReactNode;
  onSelect: () => void;
}

// ─── Ações de navegação global ───────────────────────────────────────────────
const NAV_ACTIONS = [
  { id: 'nav-crm',      label: 'Ir para CRM',       sublabel: 'Pipeline de leads',     href: '/atendimento/crm',      icon: <Kanban size={14} className="text-violet-400" /> },
  { id: 'nav-agenda',   label: 'Ir para Agenda',    sublabel: 'Compromissos e prazos',  href: '/atendimento/agenda',   icon: <Calendar size={14} className="text-blue-400" /> },
  { id: 'nav-contacts', label: 'Ir para Contatos',  sublabel: 'Lista de leads',         href: '/atendimento/contacts', icon: <User size={14} className="text-emerald-400" /> },
  { id: 'nav-settings', label: 'Configurações',     sublabel: 'WhatsApp, IA, CRM...',   href: '/atendimento/settings', icon: <Settings size={14} className="text-muted-foreground" /> },
];

export function CommandPalette({
  open,
  onClose,
  conversations,
  selectedId,
  onSelectConversation,
  onToggleAI,
  onOpenTransferModal,
  onCloseConversation,
}: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [leadResults, setLeadResults] = useState<LeadResult[]>([]);
  const [searchingLeads, setSearchingLeads] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const q = query.toLowerCase().trim();

  // ─── Busca global de leads via API ──────────────────────────────────────────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (q.length < 3) {
      setLeadResults([]);
      setSearchingLeads(false);
      return;
    }

    setSearchingLeads(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await api.get('/leads', { params: { search: q, limit: 6 } });
        const data = res.data?.data ?? res.data ?? [];
        setLeadResults(
          data.map((l: any) => ({
            id: l.id,
            name: l.name,
            phone: l.phone,
            conversationId: l.conversations?.[0]?.id ?? null,
          }))
        );
      } catch {
        setLeadResults([]);
      } finally {
        setSearchingLeads(false);
      }
    }, 280);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q]);

  // ─── Montar lista de itens ────────────────────────────────────────────────
  const items: PaletteItem[] = [];

  // Recent conversations (when no query)
  const recentIds: string[] = (() => {
    try { return JSON.parse(sessionStorage.getItem('recent_convs') || '[]'); } catch { return []; }
  })();

  if (!q) {
    const recentConvs = recentIds
      .map(id => conversations.find(c => c.id === id))
      .filter((c): c is ConversationSummary => !!c)
      .slice(0, 5);

    recentConvs.forEach(conv => {
      items.push({
        id: `recent-${conv.id}`,
        type: 'conversation',
        label: conv.contactName,
        sublabel: conv.contactPhone,
        icon: <Clock size={14} className="text-muted-foreground/60" />,
        onSelect: () => onSelectConversation(conv.id),
      });
    });
  } else {
    // Local conversation search
    const filtered = conversations.filter(c =>
      c.contactName.toLowerCase().includes(q) ||
      c.contactPhone.toLowerCase().includes(q)
    ).slice(0, 8);

    filtered.forEach(conv => {
      items.push({
        id: `conv-${conv.id}`,
        type: 'conversation',
        label: conv.contactName,
        sublabel: conv.contactPhone,
        icon: <MessageSquare size={14} className="text-muted-foreground/60" />,
        onSelect: () => onSelectConversation(conv.id),
      });
    });

    // Lead results from API (exclude those already in local conversations)
    const localIds = new Set(conversations.map(c => c.leadId));
    const uniqueLeads = leadResults.filter(l => !localIds.has(l.id));
    uniqueLeads.forEach(lead => {
      items.push({
        id: `lead-${lead.id}`,
        type: 'lead',
        label: lead.name || lead.phone,
        sublabel: lead.name ? lead.phone : 'Lead sem conversa ativa',
        icon: <ExternalLink size={14} className="text-amber-400/70" />,
        onSelect: () => {
          if (lead.conversationId) {
            onSelectConversation(lead.conversationId);
          } else {
            router.push(`/atendimento/crm`);
          }
          onClose();
        },
      });
    });
  }

  // Quick actions (only when a conversation is selected)
  if (selectedId && !selectedId.startsWith('demo-')) {
    const actions: PaletteItem[] = [
      {
        id: 'action-ai',
        type: 'action',
        label: 'Alternar modo IA',
        sublabel: 'Ctrl+Shift+A',
        icon: <Bot size={14} className="text-blue-400" />,
        onSelect: () => { onToggleAI(); onClose(); },
      },
      {
        id: 'action-transfer',
        type: 'action',
        label: 'Transferir conversa',
        icon: <ArrowRightLeft size={14} className="text-amber-400" />,
        onSelect: () => { onOpenTransferModal(); onClose(); },
      },
      {
        id: 'action-close',
        type: 'action',
        label: 'Fechar conversa',
        icon: <XCircle size={14} className="text-red-400" />,
        onSelect: () => { onCloseConversation(); onClose(); },
      },
    ];

    const filteredActions = q ? actions.filter(a => a.label.toLowerCase().includes(q)) : actions;
    items.push(...filteredActions);
  }

  // Navigation actions
  const filteredNav = q
    ? NAV_ACTIONS.filter(n => n.label.toLowerCase().includes(q) || n.sublabel.toLowerCase().includes(q))
    : NAV_ACTIONS;

  filteredNav.forEach(n => {
    items.push({
      id: n.id,
      type: 'nav',
      label: n.label,
      sublabel: n.sublabel,
      icon: n.icon,
      onSelect: () => { router.push(n.href); onClose(); },
    });
  });

  // ─── Keyboard & scroll ───────────────────────────────────────────────────
  useEffect(() => { setSelectedIndex(0); }, [query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setLeadResults([]);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[selectedIndex]) items[selectedIndex].onSelect();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [items, selectedIndex, onClose]);

  if (!open) return null;

  const convItems = items.filter(i => i.type === 'conversation');
  const leadItems = items.filter(i => i.type === 'lead');
  const actionItems = items.filter(i => i.type === 'action');
  const navItems = items.filter(i => i.type === 'nav');

  const renderItem = (item: PaletteItem) => {
    const globalIdx = items.indexOf(item);
    return (
      <button
        key={item.id}
        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
          globalIdx === selectedIndex ? 'bg-accent' : 'hover:bg-accent/50'
        }`}
        onMouseEnter={() => setSelectedIndex(globalIdx)}
        onClick={item.onSelect}
      >
        {item.icon}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium truncate">{item.label}</p>
          {item.sublabel && (
            <p className="text-[11px] text-muted-foreground truncate">{item.sublabel}</p>
          )}
        </div>
        {item.type === 'action' && item.sublabel && (
          <span className="text-[10px] text-muted-foreground font-mono shrink-0">{item.sublabel}</span>
        )}
      </button>
    );
  };

  const SectionHeader = ({ label }: { label: string }) => (
    <div className="px-4 pt-3 pb-1">
      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{label}</span>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh]"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search size={16} className="text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar conversa, lead ou ação…"
            className="flex-1 bg-transparent outline-none text-sm text-foreground placeholder:text-muted-foreground/60"
          />
          {searchingLeads && <Loader2 size={14} className="animate-spin text-muted-foreground/60 shrink-0" />}
          <kbd className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border font-mono">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[55vh] overflow-y-auto py-1">
          {items.length === 0 && !searchingLeads && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              Nenhum resultado encontrado
            </div>
          )}
          {searchingLeads && leadItems.length === 0 && convItems.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Buscando leads…
            </div>
          )}

          {/* Conversas abertas */}
          {convItems.length > 0 && (
            <>
              <SectionHeader label={q ? 'Conversas abertas' : 'Recentes'} />
              {convItems.map(renderItem)}
            </>
          )}

          {/* Leads do banco */}
          {leadItems.length > 0 && (
            <>
              <SectionHeader label="Leads encontrados" />
              {leadItems.map(renderItem)}
            </>
          )}

          {/* Ações rápidas */}
          {actionItems.length > 0 && (
            <>
              <SectionHeader label="Ações rápidas" />
              {actionItems.map(renderItem)}
            </>
          )}

          {/* Navegação */}
          {navItems.length > 0 && (
            <>
              <SectionHeader label="Navegar para" />
              {navItems.map(renderItem)}
            </>
          )}
        </div>

        {/* Footer hints */}
        <div className="px-4 py-2 border-t border-border flex items-center gap-4 text-[10px] text-muted-foreground">
          <span>↑↓ navegar</span>
          <span>↵ selecionar</span>
          <span>esc fechar</span>
          <span className="ml-auto">? atalhos</span>
        </div>
      </div>
    </div>
  );
}
