'use client';

/**
 * AgendaView — Cockpit de prazos do escritório.
 *
 * Filosofia: advogado pensa em "o que tenho amanhã/essa semana", não em
 * "quais processos estão no estágio X". Esta view consolida todos os
 * calendar_events dos processos filtrados numa linha do tempo agrupada
 * por janela temporal (Atrasados → Hoje → Amanhã → Esta semana → 30 dias).
 */

import { useMemo, useState } from 'react';
import { AlertTriangle, Calendar, Clock, MapPin, User, Gavel, FileText, ChevronRight } from 'lucide-react';

// ─── Tipos compartilhados com page.tsx ───────────────────────

interface AgendaLegalCase {
  id: string;
  case_number: string | null;
  legal_area: string | null;
  priority: string;
  lead: {
    id: string;
    name: string | null;
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
}

interface AgendaItem {
  eventId: string;
  caseRef: AgendaLegalCase;
  type: string;
  title: string;
  location: string | null;
  startAt: Date;
  bucket: BucketKey;
  daysDiff: number; // negativo = atrasado
  hoursDiff: number;
}

type BucketKey = 'overdue' | 'today' | 'tomorrow' | 'thisWeek' | 'next30' | 'later';

interface BucketMeta {
  key: BucketKey;
  label: string;
  icon: typeof AlertTriangle;
  accent: string;
  accentBg: string;
  accentBorder: string;
}

const BUCKETS: BucketMeta[] = [
  { key: 'overdue',  label: 'Atrasados',         icon: AlertTriangle, accent: 'text-red-400',     accentBg: 'bg-red-500/10',     accentBorder: 'border-red-500/30' },
  { key: 'today',    label: 'Hoje',              icon: Clock,         accent: 'text-amber-400',   accentBg: 'bg-amber-500/10',   accentBorder: 'border-amber-500/30' },
  { key: 'tomorrow', label: 'Amanhã',            icon: Calendar,      accent: 'text-sky-400',     accentBg: 'bg-sky-500/10',     accentBorder: 'border-sky-500/30' },
  { key: 'thisWeek', label: 'Esta semana',       icon: Calendar,      accent: 'text-violet-400',  accentBg: 'bg-violet-500/10',  accentBorder: 'border-violet-500/30' },
  { key: 'next30',   label: 'Próximos 30 dias',  icon: Calendar,      accent: 'text-emerald-400', accentBg: 'bg-emerald-500/10', accentBorder: 'border-emerald-500/30' },
  { key: 'later',    label: 'Mais distantes',    icon: Calendar,      accent: 'text-muted-foreground', accentBg: 'bg-accent/30', accentBorder: 'border-border' },
];

// ─── Helpers de agrupamento ──────────────────────────────────

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const pickBucket = (now: Date, start: Date): BucketKey => {
  const today0 = startOfDay(now);
  const eventDay0 = startOfDay(start);
  const diffMs = eventDay0.getTime() - today0.getTime();
  const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));

  if (start.getTime() < now.getTime() && diffDays < 0) return 'overdue';
  if (diffDays < 0) return 'overdue';
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'tomorrow';
  // "Esta semana" = do dia seguinte até o fim da semana (domingo)
  const dow = today0.getDay(); // 0..6 (0=dom)
  const daysToEndOfWeek = 6 - dow;
  if (diffDays <= daysToEndOfWeek) return 'thisWeek';
  if (diffDays <= 30) return 'next30';
  return 'later';
};

const fmtDayLabel = (d: Date): string =>
  d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });

const fmtTime = (d: Date): string =>
  d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

const eventTypeIcon = (type: string) => {
  const t = type.toUpperCase();
  if (t.includes('AUDIENCI')) return Gavel;
  if (t.includes('PERICIA') || t.includes('PERÍCIA')) return User;
  if (t.includes('PRAZO')) return AlertTriangle;
  return FileText;
};

const eventTypeLabel = (type: string): string => {
  const t = type.toUpperCase();
  if (t === 'AUDIENCIA' || t === 'AUDIÊNCIA') return 'Audiência';
  if (t === 'PERICIA' || t === 'PERÍCIA') return 'Perícia';
  if (t === 'PRAZO') return 'Prazo';
  if (t === 'REUNIAO' || t === 'REUNIÃO') return 'Reunião';
  if (t === 'TAREFA') return 'Tarefa';
  return type;
};

const daysDiffCalendar = (now: Date, start: Date): number => {
  const a = startOfDay(now).getTime();
  const b = startOfDay(start).getTime();
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
};

// ─── Componente ──────────────────────────────────────────────

interface Props {
  cases: AgendaLegalCase[];
  onSelectCase: (caseId: string) => void;
}

type TypeFilter = 'ALL' | 'AUDIENCIA' | 'PERICIA' | 'PRAZO' | 'OUTROS';

export function AgendaView({ cases, onSelectCase }: Props) {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [collapsedBuckets, setCollapsedBuckets] = useState<Set<BucketKey>>(new Set());

  const now = useMemo(() => new Date(), []);

  // Extrai todos os eventos de todos os casos, aplica filtro de tipo,
  // calcula bucket temporal e ordena cronologicamente.
  const items: AgendaItem[] = useMemo(() => {
    const list: AgendaItem[] = [];
    cases.forEach(c => {
      (c.calendar_events || []).forEach(ev => {
        const start = new Date(ev.start_at);
        if (isNaN(start.getTime())) return;

        // Filtro de tipo
        if (typeFilter !== 'ALL') {
          const t = (ev.type || '').toUpperCase();
          if (typeFilter === 'AUDIENCIA' && !t.includes('AUDIENCI')) return;
          if (typeFilter === 'PERICIA' && !(t.includes('PERICIA') || t.includes('PERÍCIA'))) return;
          if (typeFilter === 'PRAZO' && !t.includes('PRAZO')) return;
          if (typeFilter === 'OUTROS') {
            if (t.includes('AUDIENCI') || t.includes('PERICIA') || t.includes('PERÍCIA') || t.includes('PRAZO')) return;
          }
        }

        const bucket = pickBucket(now, start);
        const daysDiff = daysDiffCalendar(now, start);
        const hoursDiff = (start.getTime() - now.getTime()) / (60 * 60 * 1000);

        list.push({
          eventId: ev.id,
          caseRef: c,
          type: ev.type,
          title: ev.title,
          location: ev.location,
          startAt: start,
          bucket,
          daysDiff,
          hoursDiff,
        });
      });
    });
    // Ordem: atrasados primeiro (mais recente → mais antigo), depois cronológico
    list.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    return list;
  }, [cases, typeFilter, now]);

  // Agrupa por bucket
  const grouped = useMemo(() => {
    const map = new Map<BucketKey, AgendaItem[]>();
    BUCKETS.forEach(b => map.set(b.key, []));
    items.forEach(it => {
      map.get(it.bucket)!.push(it);
    });
    return map;
  }, [items]);

  const toggleBucket = (key: BucketKey) => {
    setCollapsedBuckets(prev => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  };

  // Contagens por bucket (para badges)
  const counts: Record<BucketKey, number> = {
    overdue: grouped.get('overdue')!.length,
    today: grouped.get('today')!.length,
    tomorrow: grouped.get('tomorrow')!.length,
    thisWeek: grouped.get('thisWeek')!.length,
    next30: grouped.get('next30')!.length,
    later: grouped.get('later')!.length,
  };

  const totalItems = items.length;

  // ─── Render ────────────────────────────────────────────────

  const TypeChip = ({ value, label }: { value: TypeFilter; label: string }) => (
    <button
      onClick={() => setTypeFilter(value)}
      className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all ${
        typeFilter === value
          ? 'bg-primary/15 border-primary/40 text-primary'
          : 'bg-card border-border text-muted-foreground hover:border-primary/30'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex-1 overflow-auto">
      {/* Toolbar */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur px-6 py-3 border-b border-border flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Calendar size={15} className="text-primary" />
          <h3 className="text-[13px] font-bold text-foreground">Agenda</h3>
          <span className="text-[11px] text-muted-foreground">
            {totalItems} evento{totalItems !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="flex items-center gap-1.5 ml-auto flex-wrap">
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mr-1">
            Tipo:
          </span>
          <TypeChip value="ALL" label="Todos" />
          <TypeChip value="AUDIENCIA" label="⚖️ Audiências" />
          <TypeChip value="PERICIA" label="🔬 Perícias" />
          <TypeChip value="PRAZO" label="⏰ Prazos" />
          <TypeChip value="OUTROS" label="📄 Outros" />
        </div>
      </div>

      {/* Resumo superior: "hoje você tem X audiências e Y prazos" */}
      {counts.overdue + counts.today > 0 && (
        <div className="mx-6 mt-4 p-3 rounded-xl border border-red-500/30 bg-red-500/5 flex items-center gap-3">
          <AlertTriangle size={16} className="text-red-400 shrink-0" />
          <p className="text-[12px] text-red-300 font-semibold">
            {counts.overdue > 0 && (
              <>
                <span className="text-red-400">{counts.overdue} atrasado{counts.overdue > 1 ? 's' : ''}</span>
                {counts.today > 0 && ' • '}
              </>
            )}
            {counts.today > 0 && (
              <span className="text-amber-400">{counts.today} para hoje</span>
            )}
            {' — '}
            <span className="text-red-200 font-normal">requer atenção imediata</span>
          </p>
        </div>
      )}

      {/* Buckets */}
      <div className="p-6 pt-4 space-y-5">
        {BUCKETS.map(bucket => {
          const bucketItems = grouped.get(bucket.key)!;
          if (bucketItems.length === 0) return null;

          const Icon = bucket.icon;
          const collapsed = collapsedBuckets.has(bucket.key);

          return (
            <section key={bucket.key}>
              <button
                onClick={() => toggleBucket(bucket.key)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border ${bucket.accentBorder} ${bucket.accentBg} hover:opacity-90 transition-all`}
              >
                <ChevronRight
                  size={13}
                  className={`${bucket.accent} transition-transform ${collapsed ? '' : 'rotate-90'}`}
                />
                <Icon size={14} className={bucket.accent} />
                <h4 className={`text-[12px] font-bold ${bucket.accent} uppercase tracking-wider`}>
                  {bucket.label}
                </h4>
                <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${bucket.accent} ${bucket.accentBg} border ${bucket.accentBorder}`}>
                  {bucketItems.length}
                </span>
              </button>

              {!collapsed && (
                <div className="mt-2 space-y-1.5">
                  {bucketItems.map(item => {
                    const EventIcon = eventTypeIcon(item.type);
                    const typeLabel = eventTypeLabel(item.type);

                    // Relógio relativo
                    let rel = '';
                    if (item.bucket === 'overdue') {
                      const absDays = Math.abs(item.daysDiff);
                      rel = absDays === 0 ? `há ${Math.abs(Math.round(item.hoursDiff))}h` : `há ${absDays}d`;
                    } else if (item.bucket === 'today') {
                      const h = Math.round(item.hoursDiff);
                      rel = h <= 0 ? 'agora' : `em ${h}h`;
                    } else {
                      rel = `em ${item.daysDiff}d`;
                    }

                    return (
                      <div
                        key={item.eventId}
                        onClick={() => onSelectCase(item.caseRef.id)}
                        className="flex items-start gap-3 p-3 rounded-lg border border-border bg-card hover:border-primary/40 hover:bg-accent/30 cursor-pointer transition-all group"
                      >
                        {/* Avatar do cliente */}
                        <div className="w-9 h-9 rounded-full bg-accent border border-border flex items-center justify-center overflow-hidden shrink-0">
                          {item.caseRef.lead?.profile_picture_url ? (
                            <img
                              src={item.caseRef.lead.profile_picture_url}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <User size={14} className="text-muted-foreground" />
                          )}
                        </div>

                        {/* Data + hora */}
                        <div className="flex flex-col items-center justify-center min-w-[62px] px-2 py-1 rounded-md bg-accent/40 border border-border shrink-0">
                          <span className={`text-[9px] font-bold uppercase tracking-wider ${bucket.accent}`}>
                            {fmtDayLabel(item.startAt).split(',')[0]}
                          </span>
                          <span className="text-[14px] font-bold text-foreground leading-none mt-0.5">
                            {fmtTime(item.startAt)}
                          </span>
                          <span className="text-[9px] text-muted-foreground mt-0.5">
                            {item.startAt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                          </span>
                        </div>

                        {/* Conteúdo principal */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <EventIcon size={11} className={bucket.accent} />
                            <span className={`text-[10px] font-bold uppercase tracking-wider ${bucket.accent}`}>
                              {typeLabel}
                            </span>
                            <span className="text-[10px] text-muted-foreground">•</span>
                            <span className="text-[10px] text-muted-foreground">{rel}</span>
                          </div>
                          <p className="text-[13px] font-semibold text-foreground truncate">
                            {item.title}
                          </p>
                          <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground flex-wrap">
                            <span className="font-semibold text-foreground/80 truncate max-w-[180px]">
                              {item.caseRef.lead?.name || 'Sem cliente'}
                            </span>
                            {item.caseRef.legal_area && (
                              <span className="text-violet-400">⚖️ {item.caseRef.legal_area}</span>
                            )}
                            {item.caseRef.lawyer?.name && (
                              <span className="text-emerald-400 truncate max-w-[160px]">
                                👤 {item.caseRef.lawyer.name}
                              </span>
                            )}
                            {item.location && (
                              <span className="flex items-center gap-0.5 truncate max-w-[200px]">
                                <MapPin size={10} /> {item.location}
                              </span>
                            )}
                          </div>
                        </div>

                        <ChevronRight
                          size={14}
                          className="text-muted-foreground group-hover:text-primary shrink-0 self-center transition-colors"
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}

        {totalItems === 0 && (
          <div className="text-center py-20">
            <Calendar size={32} className="mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground font-semibold">
              Nenhum evento agendado
            </p>
            <p className="text-[11px] text-muted-foreground/70 mt-1">
              Os processos filtrados não têm audiências, perícias ou prazos cadastrados.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
