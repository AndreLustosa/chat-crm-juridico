'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Search, MessageSquare, Briefcase, Users, Calendar, BookOpen,
  Settings, LayoutDashboard, Bot, FileEdit, Megaphone,
  CheckSquare, ExternalLink, Loader2, User,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';

interface LeadResult {
  id: string;
  name: string | null;
  phone: string;
  conversationId?: string | null;
}

interface PaletteItem {
  id: string;
  type: 'nav' | 'lead';
  label: string;
  sublabel?: string;
  icon: React.ReactNode;
  onSelect: () => void;
}

const NAV_ITEMS = [
  { id: 'nav-dashboard',  label: 'Dashboard',               sublabel: 'Visão geral do escritório',     href: '/atendimento/dashboard',           icon: <LayoutDashboard size={14} className="text-indigo-400" /> },
  { id: 'nav-inbox',      label: 'Inbox (WhatsApp)',         sublabel: 'Conversas abertas',             href: '/atendimento',                     icon: <MessageSquare size={14} className="text-emerald-400" /> },
  { id: 'nav-crm',        label: 'Leads & CRM',             sublabel: 'Pipeline de leads',             href: '/atendimento/crm',                 icon: <Briefcase size={14} className="text-violet-400" /> },
  { id: 'nav-contacts',   label: 'Contatos',                sublabel: 'Lista de clientes e leads',     href: '/atendimento/contacts',            icon: <Users size={14} className="text-blue-400" /> },
  { id: 'nav-tasks',      label: 'Tarefas',                 sublabel: 'Pendências e prazos',           href: '/atendimento/tasks',               icon: <CheckSquare size={14} className="text-amber-400" /> },
  { id: 'nav-agenda',     label: 'Agenda',                  sublabel: 'Compromissos e audiências',     href: '/atendimento/agenda',              icon: <Calendar size={14} className="text-sky-400" /> },
  { id: 'nav-followup',   label: 'Follow-up IA',            sublabel: 'Sequências automáticas',        href: '/atendimento/followup',            icon: <Bot size={14} className="text-pink-400" /> },
  { id: 'nav-advogado',   label: 'Triagem e Peticionamento',sublabel: 'Gerador de petições com IA',    href: '/atendimento/advogado',            icon: <FileEdit size={14} className="text-orange-400" /> },
  { id: 'nav-processos',  label: 'Processos',               sublabel: 'Casos judiciais e prazos',      href: '/atendimento/processos',           icon: <BookOpen size={14} className="text-teal-400" /> },
  { id: 'nav-analytics',  label: 'Analytics',               sublabel: 'Métricas e campanhas',          href: '/atendimento/marketing/analytics', icon: <Megaphone size={14} className="text-rose-400" /> },
  { id: 'nav-settings',   label: 'Configurações',           sublabel: 'WhatsApp, IA, usuários...',     href: '/atendimento/settings',            icon: <Settings size={14} className="text-muted-foreground" /> },
];

// ─── Hook global para abrir com Ctrl+K ────────────────────────────────────────

export function useGlobalCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        // Não interceptar se um input nativo tiver foco (ex: campo de chat)
        const tag = (document.activeElement as HTMLElement)?.tagName;
        const isEditing = tag === 'TEXTAREA' || (document.activeElement as HTMLElement)?.isContentEditable;
        if (isEditing) return;

        e.preventDefault();
        setOpen(prev => !prev);
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  return { open, setOpen };
}

// ─── Componente ───────────────────────────────────────────────────────────────

interface GlobalCommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function GlobalCommandPalette({ open, onClose }: GlobalCommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [leadResults, setLeadResults] = useState<LeadResult[]>([]);
  const [searchingLeads, setSearchingLeads] = useState(false);
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const q = query.toLowerCase().trim();

  useEffect(() => { setMounted(true); }, []);

  // Reset ao abrir
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setLeadResults([]);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Busca de leads via API (debounced)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (q.length < 2) {
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

  // Montar lista de itens
  const items: PaletteItem[] = [];

  // Navegação — filtrada por query ou lista completa
  const filteredNav = q
    ? NAV_ITEMS.filter(n =>
        n.label.toLowerCase().includes(q) ||
        (n.sublabel?.toLowerCase().includes(q) ?? false)
      )
    : NAV_ITEMS;

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

  // Leads do banco (apenas quando há query)
  if (q.length >= 2) {
    leadResults.forEach(lead => {
      items.push({
        id: `lead-${lead.id}`,
        type: 'lead',
        label: lead.name || lead.phone,
        sublabel: lead.name ? lead.phone : 'Lead sem nome',
        icon: <User size={14} className="text-amber-400" />,
        onSelect: () => {
          if (lead.conversationId) {
            router.push(`/atendimento/chat/${lead.conversationId}`);
          } else {
            router.push('/atendimento/crm');
          }
          onClose();
        },
      });
    });
  }

  // Scroll para item selecionado
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  useEffect(() => { setSelectedIndex(0); }, [query]);

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

  if (!open || !mounted) return null;

  const navItems = items.filter(i => i.type === 'nav');
  const leadItems = items.filter(i => i.type === 'lead');

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
        <span className="shrink-0">{item.icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-foreground truncate">{item.label}</p>
          {item.sublabel && (
            <p className="text-[11px] text-muted-foreground truncate">{item.sublabel}</p>
          )}
        </div>
        {item.type === 'lead' && (
          <ExternalLink size={12} className="text-muted-foreground/40 shrink-0" />
        )}
      </button>
    );
  };

  const SectionHeader = ({ label }: { label: string }) => (
    <div className="px-4 pt-3 pb-1">
      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{label}</span>
    </div>
  );

  const palette = (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[12vh]"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
        style={{ animation: 'fadeInScale 120ms ease-out' }}
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search size={16} className="text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar página, lead, cliente…"
            className="flex-1 bg-transparent outline-none text-sm text-foreground placeholder:text-muted-foreground/60"
          />
          {searchingLeads && (
            <Loader2 size={14} className="animate-spin text-muted-foreground/60 shrink-0" />
          )}
          <kbd className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border font-mono shrink-0">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[60vh] overflow-y-auto py-1">
          {items.length === 0 && !searchingLeads && q.length >= 2 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              Nenhum resultado para "{query}"
            </div>
          )}

          {navItems.length > 0 && (
            <>
              <SectionHeader label={q ? 'Páginas' : 'Navegar para'} />
              {navItems.map(renderItem)}
            </>
          )}

          {leadItems.length > 0 && (
            <>
              <SectionHeader label="Leads encontrados" />
              {leadItems.map(renderItem)}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border flex items-center gap-4 text-[10px] text-muted-foreground">
          <span>↑↓ navegar</span>
          <span>↵ ir</span>
          <span>esc fechar</span>
          <span className="ml-auto opacity-50">Ctrl+K</span>
        </div>
      </div>
    </div>
  );

  return createPortal(palette, document.body);
}
