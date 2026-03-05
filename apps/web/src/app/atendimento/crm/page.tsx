'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { User, Search, RefreshCw, MessageSquare, MoreVertical, ChevronDown } from 'lucide-react';
import api from '@/lib/api';
import { formatPhone } from '@/lib/utils';
import { CRM_STAGES, normalizeStage, findStage } from '@/lib/crmStages';

interface CrmLead {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  stage: string;
  profile_picture_url: string | null;
  tags: string[];
  created_at: string;
  conversations: Array<{
    id: string;
    legal_area: string | null;
    assigned_lawyer_id: string | null;
    last_message_at: string;
    messages: Array<{ text: string | null; direction: string; created_at: string }>;
  }>;
}

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'ontem';
  return `há ${d}d`;
}

function LeadCard({
  lead,
  isDragging,
  onDragStart,
  onDragEnd,
  onOpen,
  onStageChange,
}: {
  lead: CrmLead;
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: () => void;
  onStageChange: (stageId: string) => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const conv = lead.conversations?.[0];
  const lastMsg = conv?.messages?.[0];
  const legalArea = conv?.legal_area;
  const normalizedStage = normalizeStage(lead.stage);

  // Fechar menu ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
    };
    if (showMenu) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(); }}
      onDragEnd={onDragEnd}
      className={`group p-3.5 bg-card border border-border rounded-xl cursor-grab active:cursor-grabbing select-none transition-all ${
        isDragging
          ? 'opacity-40 scale-95 rotate-1 shadow-2xl ring-2 ring-primary/30'
          : 'hover:border-border/80 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/10'
      }`}
    >
      {/* Header do card */}
      <div className="flex items-start gap-2.5 mb-2.5">
        <div className="w-8 h-8 rounded-full bg-accent border border-border flex items-center justify-center overflow-hidden shrink-0 shadow-sm mt-0.5">
          {lead.profile_picture_url ? (
            <img src={lead.profile_picture_url} alt={lead.name || ''} className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <User size={13} className="text-muted-foreground opacity-60" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <h4 className="text-[13px] font-semibold text-foreground leading-tight truncate">
            {lead.name || 'Sem nome'}
          </h4>
          <p className="text-[11px] text-muted-foreground truncate">
            {formatPhone(lead.phone)}
          </p>
        </div>

        {/* Menu de ações */}
        <div className="relative shrink-0" ref={menuRef}>
          <button
            onClick={(e) => { e.stopPropagation(); setShowMenu(v => !v); }}
            className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
          >
            <MoreVertical size={13} />
          </button>
          {showMenu && (
            <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-xl shadow-xl w-48 py-1 text-[12px]">
              <p className="px-3 py-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Mover para etapa</p>
              {CRM_STAGES.map(s => (
                <button
                  key={s.id}
                  onClick={(e) => { e.stopPropagation(); onStageChange(s.id); setShowMenu(false); }}
                  className={`w-full text-left px-3 py-1.5 hover:bg-accent transition-colors flex items-center gap-2 ${s.id === normalizedStage ? 'font-semibold' : ''}`}
                  style={{ color: s.id === normalizedStage ? s.color : undefined }}
                >
                  <span>{s.emoji}</span>
                  <span>{s.label}</span>
                </button>
              ))}
              <div className="border-t border-border mt-1 pt-1">
                <button
                  onClick={(e) => { e.stopPropagation(); onOpen(); setShowMenu(false); }}
                  className="w-full text-left px-3 py-1.5 hover:bg-accent transition-colors flex items-center gap-2 text-muted-foreground"
                >
                  <MessageSquare size={12} />
                  <span>Abrir no chat</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-1 mb-2">
        {legalArea && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-violet-500/12 text-violet-400 text-[9px] font-bold border border-violet-500/20">
            ⚖️ {legalArea}
          </span>
        )}
        {lead.tags?.map(tag => (
          <span key={tag} className="inline-flex px-1.5 py-0.5 rounded-full bg-accent text-muted-foreground text-[9px] font-medium border border-border">
            {tag}
          </span>
        ))}
      </div>

      {/* Última mensagem */}
      {lastMsg?.text && (
        <p className="text-[11px] text-muted-foreground leading-snug mb-2 line-clamp-2 italic">
          {lastMsg.direction === 'out' ? '↩ ' : ''}{lastMsg.text.slice(0, 80)}{lastMsg.text.length > 80 ? '…' : ''}
        </p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between">
        <button
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
          className="text-[10px] text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
          title="Abrir no chat"
        >
          <MessageSquare size={10} />
          Abrir chat
        </button>
        {conv?.last_message_at && (
          <span className="text-[10px] text-muted-foreground/60">
            {timeAgo(conv.last_message_at)}
          </span>
        )}
      </div>
    </div>
  );
}

export default function CrmPage() {
  const router = useRouter();
  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [areaFilter, setAreaFilter] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [previousStageMap, setPreviousStageMap] = useState<Record<string, string>>({});

  // Pan horizontal do board com clique+arraste do mouse
  const boardRef = useRef<HTMLDivElement>(null);
  const isPanning = useRef(false);
  const panStartX = useRef(0);
  const panScrollLeft = useRef(0);

  const handleBoardMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Não iniciar pan se clicou em cima de um card (elemento draggable)
    if ((e.target as HTMLElement).closest('[draggable="true"]')) return;
    // Não iniciar pan se clicou em botão, select, input
    if ((e.target as HTMLElement).closest('button, select, input')) return;
    if (e.button !== 0) return;
    isPanning.current = true;
    panStartX.current = e.pageX - (boardRef.current?.offsetLeft ?? 0);
    panScrollLeft.current = boardRef.current?.scrollLeft ?? 0;
    if (boardRef.current) boardRef.current.style.cursor = 'grabbing';
  };

  const handleBoardMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isPanning.current || !boardRef.current) return;
    e.preventDefault();
    const x = e.pageX - boardRef.current.offsetLeft;
    const walk = (x - panStartX.current) * 1.5;
    boardRef.current.scrollLeft = panScrollLeft.current - walk;
  };

  const handleBoardMouseUp = () => {
    isPanning.current = false;
    if (boardRef.current) boardRef.current.style.cursor = 'grab';
  };

  const fetchLeads = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await api.get('/leads');
      setLeads(res.data || []);
    } catch (e: any) {
      console.warn('Erro ao buscar leads', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { router.push('/atendimento/login'); return; }
    fetchLeads();
    const interval = setInterval(() => fetchLeads(true), 30_000);
    return () => clearInterval(interval);
  }, [router, fetchLeads]);

  const moveLeadToStage = async (leadId: string, newStage: string) => {
    const prev = leads.find(l => l.id === leadId)?.stage;
    setPreviousStageMap(m => ({ ...m, [leadId]: prev ?? 'INICIAL' }));
    // Otimista
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, stage: newStage } : l));
    try {
      await api.patch(`/leads/${leadId}/stage`, { stage: newStage });
    } catch {
      // Rollback
      setLeads(prev => prev.map(l =>
        l.id === leadId ? { ...l, stage: previousStageMap[leadId] ?? 'INICIAL' } : l
      ));
    }
  };

  const openInChat = (lead: CrmLead) => {
    const conv = lead.conversations?.[0];
    if (conv?.id) sessionStorage.setItem('crm_open_conv', conv.id);
    router.push('/atendimento');
  };

  // Coletar todas as áreas únicas para o filtro
  const allAreas = [...new Set(
    leads.flatMap(l => l.conversations?.map(c => c.legal_area).filter(Boolean) ?? [])
  )].sort() as string[];

  // Filtrar leads
  const filteredLeads = leads.filter(lead => {
    const q = searchQuery.toLowerCase().trim();
    if (q) {
      const name = (lead.name || '').toLowerCase();
      const phone = (lead.phone || '').toLowerCase();
      if (!name.includes(q) && !phone.includes(q)) return false;
    }
    if (areaFilter) {
      const hasArea = lead.conversations?.some(c => c.legal_area === areaFilter);
      if (!hasArea) return false;
    }
    return true;
  });

  const getStageLeads = (stageId: string) =>
    filteredLeads
      .filter(l => normalizeStage(l.stage) === stageId)
      .sort((a, b) => {
        const ta = a.conversations?.[0]?.last_message_at ? new Date(a.conversations[0].last_message_at).getTime() : 0;
        const tb = b.conversations?.[0]?.last_message_at ? new Date(b.conversations[0].last_message_at).getTime() : 0;
        return tb - ta;
      });

  return (
    <div className="flex h-screen bg-background font-sans antialiased text-foreground overflow-hidden">
      <main className="flex-1 flex flex-col overflow-hidden">

        {/* Header */}
        <header className="px-6 py-5 border-b border-border shrink-0 flex items-center gap-4">
          <div className="flex-1">
            <h1 className="text-xl font-bold text-foreground tracking-tight">CRM Pipeline</h1>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              {filteredLeads.length} lead{filteredLeads.length !== 1 ? 's' : ''} {searchQuery || areaFilter ? 'filtrados' : 'no total'}
            </p>
          </div>

          {/* Filtros */}
          <div className="flex items-center gap-2">
            {/* Filtro por área */}
            {allAreas.length > 0 && (
              <div className="relative">
                <select
                  value={areaFilter}
                  onChange={e => setAreaFilter(e.target.value)}
                  className="appearance-none pl-3 pr-7 py-1.5 text-[12px] bg-accent/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40 cursor-pointer"
                >
                  <option value="">Todas as áreas</option>
                  {allAreas.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
                <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
            )}

            {/* Busca por nome/telefone */}
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Buscar lead…"
                className="pl-8 pr-3 py-1.5 text-[12px] bg-accent/50 border border-border rounded-lg placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40 w-44"
              />
            </div>

            {/* Atualizar */}
            <button
              onClick={() => fetchLeads(true)}
              disabled={refreshing}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
              title="Atualizar"
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </div>
        </header>

        {/* Kanban Board */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-muted-foreground text-sm animate-pulse">Carregando leads…</div>
          </div>
        ) : (
          <div
            ref={boardRef}
            className="flex-1 overflow-x-auto overflow-y-hidden px-6 py-5 cursor-grab select-none"
            onMouseDown={handleBoardMouseDown}
            onMouseMove={handleBoardMouseMove}
            onMouseUp={handleBoardMouseUp}
            onMouseLeave={handleBoardMouseUp}
          >
            <div className="flex h-full gap-4" style={{ minWidth: `${CRM_STAGES.length * 272}px` }}>
              {CRM_STAGES.map(stage => {
                const stageLeads = getStageLeads(stage.id);
                const isTerminal = stage.id === 'PERDIDO' || stage.id === 'FINALIZADO';
                const isDragTarget = dragOverStage === stage.id;

                return (
                  <div
                    key={stage.id}
                    className={`flex flex-col w-[260px] min-w-[260px] rounded-xl border transition-all duration-150 ${
                      isTerminal ? 'opacity-75' : ''
                    } ${
                      isDragTarget
                        ? 'border-2 bg-accent/30 scale-[1.01]'
                        : 'border-border bg-card/50'
                    }`}
                    style={isDragTarget ? { borderColor: stage.color } : undefined}
                    onDragOver={e => { e.preventDefault(); setDragOverStage(stage.id); }}
                    onDragLeave={e => {
                      // Só resetar se saiu da coluna de verdade (não entrou num filho)
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverStage(null);
                    }}
                    onDrop={() => {
                      if (draggingId) moveLeadToStage(draggingId, stage.id);
                      setDragOverStage(null);
                    }}
                  >
                    {/* Header da coluna */}
                    <div
                      className="flex items-center justify-between px-3.5 py-3 border-b border-border shrink-0 rounded-t-xl"
                      style={{ borderTopColor: stage.color, borderTopWidth: 3 }}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-base leading-none">{stage.emoji}</span>
                        <h3 className="text-[11px] font-bold uppercase tracking-wider" style={{ color: stage.color }}>
                          {stage.label}
                        </h3>
                      </div>
                      <span
                        className="w-[22px] h-[22px] rounded-full flex items-center justify-center text-[10px] font-bold"
                        style={{ backgroundColor: `${stage.color}20`, color: stage.color }}
                      >
                        {stageLeads.length}
                      </span>
                    </div>

                    {/* Cards */}
                    <div className="flex-1 overflow-y-auto p-2.5 space-y-2 custom-scrollbar">
                      {stageLeads.map(lead => (
                        <LeadCard
                          key={lead.id}
                          lead={lead}
                          isDragging={draggingId === lead.id}
                          onDragStart={() => setDraggingId(lead.id)}
                          onDragEnd={() => { setDraggingId(null); setDragOverStage(null); }}
                          onOpen={() => openInChat(lead)}
                          onStageChange={(newStage) => moveLeadToStage(lead.id, newStage)}
                        />
                      ))}

                      {stageLeads.length === 0 && (
                        <div
                          className={`text-center p-5 border-2 border-dashed rounded-xl text-[11px] text-muted-foreground/50 transition-all ${
                            isDragTarget ? 'border-current opacity-100' : 'border-border/40 opacity-70'
                          }`}
                          style={isDragTarget ? { borderColor: stage.color, color: stage.color } : undefined}
                        >
                          {isDragTarget ? `Soltar aqui` : 'Arraste leads aqui'}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
