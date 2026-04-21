'use client';

/**
 * ClienteView — Agrupa processos por cliente.
 *
 * Filosofia: na hora de atender o telefone, o advogado quer ver TODOS os
 * processos do cliente X de uma vez — não buscar cada um individualmente.
 * Também ajuda a identificar clientes-âncora (alto valor, alto volume) e
 * clientes com exposição concentrada.
 */

import { useMemo, useState } from 'react';
import {
  User,
  Phone,
  ChevronRight,
  FileText,
  AlertTriangle,
  Gavel,
  Calendar,
  DollarSign,
  ArrowUpDown,
} from 'lucide-react';
import { findTrackingStage } from '@/lib/legalStages';

// ─── Tipos (subset de LegalCase suficiente para a view) ─────

export interface ClienteViewLegalCase {
  id: string;
  case_number: string | null;
  legal_area: string | null;
  priority: string;
  claim_value: string | null;
  tracking_stage: string | null;
  stage?: string | null; // VIABILIDADE | ACOMPANHAMENTO | FINALIZADO
  created_at?: string;
  updated_at: string;
  opposing_party: string | null;
  court: string | null;
  lead: {
    id: string;
    name: string | null;
    phone: string;
    email: string | null;
    profile_picture_url: string | null;
  };
  lawyer?: {
    id: string;
    name: string | null;
  } | null;
  calendar_events?: {
    id: string;
    type: string;
    start_at: string;
    title: string;
    location: string | null;
  }[];
  _count?: { tasks: number; events: number; djen_publications: number };
}

interface ClienteGroup {
  leadId: string;
  name: string;
  phone: string;
  email: string | null;
  profile_picture_url: string | null;
  cases: ClienteViewLegalCase[];
  totalValue: number;
  urgentCount: number;
  viabilidadeCount: number; // casos em triagem (stage=VIABILIDADE)
  newViabilidadeCount: number; // dos em triagem, quantos abertos < 24h (IA recente)
  nextEvent: { start: Date; title: string; type: string } | null;
  lastUpdated: number;
}

type SortBy = 'value' | 'count' | 'name' | 'urgent' | 'nextEvent';

interface Props {
  cases: ClienteViewLegalCase[];
  onSelectCase: (caseId: string) => void;
  onSelectLead?: (leadId: string) => void;
}

// ─── Helpers ─────────────────────────────────────────────────

const fmtMoney = (v: number): string => {
  if (!v) return 'R$ 0';
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1).replace('.', ',')}M`;
  if (v >= 10_000) return `R$ ${Math.round(v / 1000)}k`;
  return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
};

const fmtFullMoney = (v: number): string =>
  `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtPhone = (p: string): string => {
  const d = (p || '').replace(/\D/g, '');
  if (d.length === 13) return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12) return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 8)}-${d.slice(8)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return p || '';
};

const relativeDay = (start: Date): string => {
  const now = Date.now();
  const diff = start.getTime() - now;
  const days = Math.round(diff / (24 * 60 * 60 * 1000));
  if (days < 0) return `há ${Math.abs(days)}d`;
  if (days === 0) return 'hoje';
  if (days === 1) return 'amanhã';
  if (days <= 7) return `em ${days}d`;
  return start.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

// ─── Componente ──────────────────────────────────────────────

export function ClienteView({ cases, onSelectCase, onSelectLead }: Props) {
  const [sortBy, setSortBy] = useState<SortBy>('value');
  const [expandedLeadIds, setExpandedLeadIds] = useState<Set<string>>(new Set());

  // Agrupa casos por lead
  const groups: ClienteGroup[] = useMemo(() => {
    const map = new Map<string, ClienteGroup>();
    const now = Date.now();

    cases.forEach(c => {
      const leadId = c.lead?.id;
      if (!leadId) return;

      if (!map.has(leadId)) {
        map.set(leadId, {
          leadId,
          name: c.lead.name || '— sem nome —',
          phone: c.lead.phone,
          email: c.lead.email,
          profile_picture_url: c.lead.profile_picture_url,
          cases: [],
          totalValue: 0,
          urgentCount: 0,
          viabilidadeCount: 0,
          newViabilidadeCount: 0,
          nextEvent: null,
          lastUpdated: 0,
        });
      }
      const g = map.get(leadId)!;
      g.cases.push(c);
      g.totalValue += Number(c.claim_value) || 0;
      if (c.priority === 'URGENTE') g.urgentCount++;
      if (c.stage === 'VIABILIDADE') {
        g.viabilidadeCount++;
        if (c.created_at && (now - new Date(c.created_at).getTime()) < 24 * 3600 * 1000) {
          g.newViabilidadeCount++;
        }
      }

      const updated = new Date(c.updated_at).getTime();
      if (updated > g.lastUpdated) g.lastUpdated = updated;

      // Próximo evento futuro
      (c.calendar_events || []).forEach(ev => {
        const start = new Date(ev.start_at);
        if (isNaN(start.getTime())) return;
        if (start.getTime() < now) return;
        if (!g.nextEvent || start.getTime() < g.nextEvent.start.getTime()) {
          g.nextEvent = { start, title: ev.title, type: ev.type };
        }
      });
    });

    const list = Array.from(map.values());

    // Ordenação
    list.sort((a, b) => {
      if (sortBy === 'value') return b.totalValue - a.totalValue;
      if (sortBy === 'count') return b.cases.length - a.cases.length;
      if (sortBy === 'name') return a.name.localeCompare(b.name, 'pt-BR');
      if (sortBy === 'urgent') return b.urgentCount - a.urgentCount;
      if (sortBy === 'nextEvent') {
        const aT = a.nextEvent?.start.getTime() ?? Number.MAX_SAFE_INTEGER;
        const bT = b.nextEvent?.start.getTime() ?? Number.MAX_SAFE_INTEGER;
        return aT - bT;
      }
      return 0;
    });

    return list;
  }, [cases, sortBy]);

  const toggleExpanded = (leadId: string) => {
    setExpandedLeadIds(prev => {
      const n = new Set(prev);
      if (n.has(leadId)) n.delete(leadId);
      else n.add(leadId);
      return n;
    });
  };

  // Métricas agregadas (header)
  const totalClientes = groups.length;
  const totalProcessos = groups.reduce((sum, g) => sum + g.cases.length, 0);
  const totalValor = groups.reduce((sum, g) => sum + g.totalValue, 0);
  const totalUrgentes = groups.reduce((sum, g) => sum + g.urgentCount, 0);

  const SortBtn = ({ value, label, icon: Icon }: { value: SortBy; label: string; icon?: typeof ArrowUpDown }) => (
    <button
      onClick={() => setSortBy(value)}
      className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all flex items-center gap-1 ${
        sortBy === value
          ? 'bg-primary/15 border-primary/40 text-primary'
          : 'bg-card border-border text-muted-foreground hover:border-primary/30'
      }`}
    >
      {Icon && <Icon size={10} />}
      {label}
    </button>
  );

  return (
    <div className="flex-1 overflow-auto">
      {/* Toolbar + métricas */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur px-6 py-3 border-b border-border space-y-3">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <User size={15} className="text-primary" />
            <h3 className="text-[13px] font-bold text-foreground">Clientes</h3>
          </div>

          {/* Métricas inline */}
          <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
            <span>
              <strong className="text-foreground">{totalClientes}</strong> cliente{totalClientes !== 1 ? 's' : ''}
            </span>
            <span>•</span>
            <span>
              <strong className="text-foreground">{totalProcessos}</strong> processo{totalProcessos !== 1 ? 's' : ''}
            </span>
            {totalValor > 0 && (
              <>
                <span>•</span>
                <span>
                  <strong className="text-emerald-400" title={fmtFullMoney(totalValor)}>
                    {fmtMoney(totalValor)}
                  </strong>{' '}
                  em causas
                </span>
              </>
            )}
            {totalUrgentes > 0 && (
              <>
                <span>•</span>
                <span className="text-red-400">
                  <strong>{totalUrgentes}</strong> urgente{totalUrgentes !== 1 ? 's' : ''}
                </span>
              </>
            )}
          </div>

          {/* Sort chips */}
          <div className="flex items-center gap-1.5 ml-auto flex-wrap">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mr-1">
              Ordenar por:
            </span>
            <SortBtn value="value" label="Valor" icon={DollarSign} />
            <SortBtn value="count" label="Nº processos" icon={FileText} />
            <SortBtn value="urgent" label="Urgentes" icon={AlertTriangle} />
            <SortBtn value="nextEvent" label="Próximo prazo" icon={Calendar} />
            <SortBtn value="name" label="Nome" />
          </div>
        </div>
      </div>

      {/* Lista de clientes */}
      <div className="p-6 pt-4 space-y-2">
        {groups.length === 0 && (
          <div className="text-center py-20">
            <User size={32} className="mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground font-semibold">Nenhum cliente encontrado</p>
            <p className="text-[11px] text-muted-foreground/70 mt-1">
              Ajuste os filtros ou cadastre um processo para começar.
            </p>
          </div>
        )}

        {groups.map(g => {
          const isExpanded = expandedLeadIds.has(g.leadId);
          const hasUrgent = g.urgentCount > 0;

          return (
            <div
              key={g.leadId}
              className={`rounded-xl border bg-card overflow-hidden transition-all ${
                hasUrgent
                  ? 'border-red-500/30 shadow-[0_0_0_1px_rgba(239,68,68,0.1)]'
                  : 'border-border'
              }`}
            >
              {/* Header do cliente (clicável para expandir) */}
              <button
                onClick={() => toggleExpanded(g.leadId)}
                className="w-full flex items-center gap-3 p-3 hover:bg-accent/30 transition-colors text-left"
              >
                <ChevronRight
                  size={14}
                  className={`text-muted-foreground transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                />

                {/* Avatar */}
                <div className="w-10 h-10 rounded-full bg-accent border border-border flex items-center justify-center overflow-hidden shrink-0">
                  {g.profile_picture_url ? (
                    <img src={g.profile_picture_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <User size={16} className="text-muted-foreground" />
                  )}
                </div>

                {/* Nome + telefone */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-[14px] font-bold text-foreground truncate">{g.name}</h4>
                    {hasUrgent && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/12 text-red-400 border border-red-500/20">
                        {g.urgentCount} urgente{g.urgentCount > 1 ? 's' : ''}
                      </span>
                    )}
                    {g.viabilidadeCount > 0 && (
                      <span
                        className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/12 text-amber-400 border border-amber-500/25 inline-flex items-center gap-1"
                        title={`${g.viabilidadeCount} caso(s) em viabilidade — precisam de avaliacao do advogado`}
                      >
                        <Gavel size={9} />
                        {g.viabilidadeCount} em triagem
                        {g.newViabilidadeCount > 0 && (
                          <span className="px-1 rounded-full bg-amber-400/40 text-amber-200 leading-tight">
                            {g.newViabilidadeCount} nov{g.newViabilidadeCount !== 1 ? 'os' : 'o'}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground">
                    {g.phone && (
                      <span className="flex items-center gap-1">
                        <Phone size={10} /> {fmtPhone(g.phone)}
                      </span>
                    )}
                    {g.email && (
                      <span className="truncate max-w-[200px]">{g.email}</span>
                    )}
                  </div>
                </div>

                {/* Stats do cliente */}
                <div className="flex items-center gap-5 shrink-0 ml-2">
                  <div className="text-center">
                    <div className="text-[15px] font-bold text-foreground leading-none">
                      {g.cases.length}
                    </div>
                    <div className="text-[9px] text-muted-foreground uppercase tracking-wider mt-0.5">
                      processo{g.cases.length !== 1 ? 's' : ''}
                    </div>
                  </div>

                  {g.totalValue > 0 && (
                    <div className="text-center" title={fmtFullMoney(g.totalValue)}>
                      <div className="text-[15px] font-bold text-emerald-400 leading-none">
                        {fmtMoney(g.totalValue)}
                      </div>
                      <div className="text-[9px] text-muted-foreground uppercase tracking-wider mt-0.5">
                        causas
                      </div>
                    </div>
                  )}

                  {g.nextEvent && (
                    <div className="text-center min-w-[70px]">
                      <div className="text-[11px] font-bold text-sky-400 leading-none">
                        {relativeDay(g.nextEvent.start)}
                      </div>
                      <div className="text-[9px] text-muted-foreground uppercase tracking-wider mt-0.5 truncate max-w-[80px]">
                        {g.nextEvent.type || 'evento'}
                      </div>
                    </div>
                  )}
                </div>
              </button>

              {/* Lista expandida de processos */}
              {isExpanded && (
                <div className="border-t border-border bg-accent/15">
                  {onSelectLead && (
                    <div className="px-4 py-2 border-b border-border/50 flex items-center justify-between">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                        Processos deste cliente
                      </span>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          onSelectLead(g.leadId);
                        }}
                        className="text-[10px] font-semibold text-primary hover:underline"
                      >
                        Ver ficha completa →
                      </button>
                    </div>
                  )}
                  {g.cases.map(c => {
                    const stageInfo = findTrackingStage(c.tracking_stage);
                    const pCls =
                      c.priority === 'URGENTE'
                        ? 'text-red-400'
                        : c.priority === 'BAIXA'
                        ? 'text-muted-foreground'
                        : 'text-sky-400';
                    const value = Number(c.claim_value) || 0;
                    return (
                      <button
                        key={c.id}
                        onClick={() => onSelectCase(c.id)}
                        className="w-full flex items-start gap-3 px-4 py-2.5 border-b border-border/40 last:border-b-0 hover:bg-accent/40 transition-colors text-left group"
                      >
                        <Gavel size={12} className={`${pCls} shrink-0 mt-0.5`} />

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-[11px] text-foreground font-semibold">
                              {c.case_number || 'Sem número'}
                            </span>
                            {c.legal_area && (
                              <span className="text-[10px] text-violet-400">⚖️ {c.legal_area}</span>
                            )}
                            <span className="text-[10px] font-semibold" style={{ color: stageInfo.color }}>
                              {stageInfo.emoji} {stageInfo.label}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground">
                            {c.opposing_party && (
                              <span className="truncate max-w-[220px]">vs. {c.opposing_party}</span>
                            )}
                            {c.court && (
                              <span className="truncate max-w-[180px]">{c.court}</span>
                            )}
                            {c.lawyer?.name && (
                              <span className="text-emerald-400 truncate max-w-[140px]">
                                👤 {c.lawyer.name}
                              </span>
                            )}
                          </div>
                        </div>

                        {value > 0 && (
                          <span
                            className="text-[11px] font-semibold text-emerald-400 shrink-0"
                            title={fmtFullMoney(value)}
                          >
                            {fmtMoney(value)}
                          </span>
                        )}
                        <ChevronRight
                          size={12}
                          className="text-muted-foreground group-hover:text-primary shrink-0 self-center transition-colors"
                        />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
