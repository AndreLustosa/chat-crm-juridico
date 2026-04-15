'use client';

/**
 * ProcessoTimeline — Linha do tempo consolidada de um processo.
 *
 * Agrega em uma única narrativa cronológica TODA a vida do processo:
 *   • Criação do processo no sistema
 *   • Mudança de etapa (tracking_stage → stage_changed_at)
 *   • Eventos de calendário (audiências, perícias, prazos, reuniões)
 *   • Tarefas criadas/concluídas
 *   • Publicações DJEN
 *   • Eventos internos (CaseEvent) — movimentações, publicações manuais, etc.
 *
 * Ordena por data decrescente (mais recente primeiro). Eventos futuros
 * aparecem destacados no topo. Passado aparece em tom neutro.
 */

import { useMemo } from 'react';
import {
  FileText,
  Calendar,
  CheckSquare,
  Gavel,
  FolderPlus,
  ArrowRightCircle,
  Newspaper,
  Clock,
  AlertCircle,
  type LucideIcon,
} from 'lucide-react';

// ─── Tipos (subsets dos tipos em page.tsx) ───────────────────

export interface TimelineLegalCase {
  id: string;
  created_at: string;
  stage_changed_at: string;
  tracking_stage: string | null;
  case_number: string | null;
  calendar_events?: {
    id: string;
    type: string;
    start_at: string;
    title: string;
    location: string | null;
  }[];
}

export interface TimelineTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  start_at: string;
  assigned_user: { id: string; name: string } | null;
}

export interface TimelineCaseEvent {
  id: string;
  type: string;
  title: string;
  description: string | null;
  source: string | null;
  reference_url: string | null;
  event_date: string | null;
  created_at: string;
}

export interface TimelineDjenPub {
  id: string;
  data_disponibilizacao: string;
  tipo_comunicacao: string | null;
  assunto: string | null;
  conteudo: string;
}

interface Props {
  legalCase: TimelineLegalCase;
  tasks: TimelineTask[];
  events: TimelineCaseEvent[];
  djenPubs: TimelineDjenPub[];
}

// ─── Estrutura interna ───────────────────────────────────────

type TimelineKind =
  | 'created'
  | 'stage'
  | 'calendar'
  | 'task'
  | 'djen'
  | 'event';

interface TimelineItem {
  id: string;
  kind: TimelineKind;
  date: Date;
  isFuture: boolean;
  icon: LucideIcon;
  accent: string;
  accentBg: string;
  accentBorder: string;
  label: string;
  title: string;
  subtitle?: string | null;
  meta?: string | null;
  href?: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────

const STAGE_LABELS: Record<string, string> = {
  DISTRIBUIDO: 'Distribuído',
  CITACAO: 'Citação',
  CONTESTACAO: 'Contestação',
  REPLICA: 'Réplica',
  SANEAMENTO: 'Saneamento',
  INSTRUCAO: 'Instrução',
  AUDIENCIA: 'Audiência',
  SENTENCA: 'Sentença',
  RECURSO: 'Recurso',
  EXECUCAO: 'Execução',
  ARQUIVADO: 'Arquivado',
};

const fmtDate = (d: Date): string => {
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
};

const fmtTime = (d: Date): string =>
  d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

const fmtRelative = (d: Date): string => {
  const diff = d.getTime() - Date.now();
  const abs = Math.abs(diff);
  const day = 86_400_000;
  const hour = 3_600_000;
  const min = 60_000;
  const future = diff > 0;

  if (abs < min) return 'agora';
  if (abs < hour) {
    const m = Math.round(abs / min);
    return future ? `em ${m} min` : `há ${m} min`;
  }
  if (abs < day) {
    const h = Math.round(abs / hour);
    return future ? `em ${h}h` : `há ${h}h`;
  }
  if (abs < 30 * day) {
    const dd = Math.round(abs / day);
    return future ? `em ${dd} dia${dd !== 1 ? 's' : ''}` : `há ${dd} dia${dd !== 1 ? 's' : ''}`;
  }
  const months = Math.round(abs / (30 * day));
  if (months < 12) return future ? `em ${months} m` : `há ${months} m`;
  const years = Math.round(abs / (365 * day));
  return future ? `em ${years} a` : `há ${years} a`;
};

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const dayBucketLabel = (d: Date): string => {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(d, now)) return 'Hoje';
  if (sameDay(d, tomorrow)) return 'Amanhã';
  if (sameDay(d, yesterday)) return 'Ontem';
  return d.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
};

// ─── Componente ──────────────────────────────────────────────

export function ProcessoTimeline({ legalCase, tasks, events, djenPubs }: Props) {
  const items = useMemo<TimelineItem[]>(() => {
    const now = Date.now();
    const out: TimelineItem[] = [];

    // 1. Criação do processo
    if (legalCase.created_at) {
      const d = new Date(legalCase.created_at);
      if (!Number.isNaN(d.getTime())) {
        out.push({
          id: `created-${legalCase.id}`,
          kind: 'created',
          date: d,
          isFuture: false,
          icon: FolderPlus,
          accent: 'text-blue-400',
          accentBg: 'bg-blue-500/10',
          accentBorder: 'border-blue-500/30',
          label: 'Processo criado',
          title: legalCase.case_number || 'Processo cadastrado no sistema',
          subtitle: 'Início do acompanhamento',
        });
      }
    }

    // 2. Mudança de etapa
    if (
      legalCase.stage_changed_at &&
      legalCase.tracking_stage &&
      legalCase.stage_changed_at !== legalCase.created_at
    ) {
      const d = new Date(legalCase.stage_changed_at);
      if (!Number.isNaN(d.getTime())) {
        const stageLabel = STAGE_LABELS[legalCase.tracking_stage] || legalCase.tracking_stage;
        out.push({
          id: `stage-${legalCase.id}`,
          kind: 'stage',
          date: d,
          isFuture: false,
          icon: ArrowRightCircle,
          accent: 'text-indigo-400',
          accentBg: 'bg-indigo-500/10',
          accentBorder: 'border-indigo-500/30',
          label: 'Mudança de etapa',
          title: `Avançou para ${stageLabel}`,
        });
      }
    }

    // 3. Calendar events (audiências, perícias, prazos)
    (legalCase.calendar_events || []).forEach(ev => {
      const d = new Date(ev.start_at);
      if (Number.isNaN(d.getTime())) return;
      const typeUpper = (ev.type || '').toUpperCase();
      let icon: LucideIcon = Calendar;
      let accent = 'text-sky-400';
      let accentBg = 'bg-sky-500/10';
      let accentBorder = 'border-sky-500/30';
      let label = 'Evento';

      if (typeUpper.includes('AUDIENCI')) {
        icon = Gavel;
        accent = 'text-purple-400';
        accentBg = 'bg-purple-500/10';
        accentBorder = 'border-purple-500/30';
        label = 'Audiência';
      } else if (typeUpper.includes('PERICIA')) {
        icon = AlertCircle;
        accent = 'text-orange-400';
        accentBg = 'bg-orange-500/10';
        accentBorder = 'border-orange-500/30';
        label = 'Perícia';
      } else if (typeUpper.includes('PRAZO')) {
        icon = Clock;
        accent = 'text-red-400';
        accentBg = 'bg-red-500/10';
        accentBorder = 'border-red-500/30';
        label = 'Prazo';
      }

      out.push({
        id: `cal-${ev.id}`,
        kind: 'calendar',
        date: d,
        isFuture: d.getTime() > now,
        icon,
        accent,
        accentBg,
        accentBorder,
        label,
        title: ev.title || label,
        subtitle: ev.location || null,
      });
    });

    // 4. Tarefas
    tasks.forEach(t => {
      const d = new Date(t.start_at);
      if (Number.isNaN(d.getTime())) return;
      const done = t.status === 'DONE' || t.status === 'COMPLETED' || t.status === 'CONCLUIDA';
      out.push({
        id: `task-${t.id}`,
        kind: 'task',
        date: d,
        isFuture: d.getTime() > now,
        icon: CheckSquare,
        accent: done ? 'text-emerald-400' : 'text-amber-400',
        accentBg: done ? 'bg-emerald-500/10' : 'bg-amber-500/10',
        accentBorder: done ? 'border-emerald-500/30' : 'border-amber-500/30',
        label: done ? 'Tarefa concluída' : 'Tarefa',
        title: t.title,
        subtitle: t.description || null,
        meta: t.assigned_user?.name || null,
      });
    });

    // 5. DJEN
    djenPubs.forEach(p => {
      const d = new Date(p.data_disponibilizacao);
      if (Number.isNaN(d.getTime())) return;
      out.push({
        id: `djen-${p.id}`,
        kind: 'djen',
        date: d,
        isFuture: false,
        icon: Newspaper,
        accent: 'text-cyan-400',
        accentBg: 'bg-cyan-500/10',
        accentBorder: 'border-cyan-500/30',
        label: p.tipo_comunicacao || 'Publicação DJEN',
        title: p.assunto || 'Publicação no Diário Oficial',
        subtitle:
          p.conteudo && p.conteudo.length > 160
            ? p.conteudo.slice(0, 160).trim() + '…'
            : p.conteudo || null,
      });
    });

    // 6. Eventos do processo (CaseEvent)
    events.forEach(e => {
      const rawDate = e.event_date || e.created_at;
      const d = new Date(rawDate);
      if (Number.isNaN(d.getTime())) return;
      out.push({
        id: `event-${e.id}`,
        kind: 'event',
        date: d,
        isFuture: false,
        icon: FileText,
        accent: 'text-slate-300',
        accentBg: 'bg-slate-500/10',
        accentBorder: 'border-slate-500/30',
        label: e.type || 'Movimentação',
        title: e.title,
        subtitle: e.description || null,
        meta: e.source || null,
        href: e.reference_url || null,
      });
    });

    // Ordenar por data DESC (mais recente primeiro)
    out.sort((a, b) => b.date.getTime() - a.date.getTime());
    return out;
  }, [legalCase, tasks, events, djenPubs]);

  // Separa futuros e passados
  const futureItems = items.filter(i => i.isFuture);
  const pastItems = items.filter(i => !i.isFuture);

  // Agrupa passados por dia
  const pastByDay = useMemo(() => {
    const map = new Map<string, TimelineItem[]>();
    pastItems.forEach(it => {
      const key = it.date.toISOString().slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    });
    return Array.from(map.entries()).map(([key, list]) => ({
      key,
      date: new Date(key),
      items: list,
    }));
  }, [pastItems]);

  if (items.length === 0) {
    return (
      <div className="p-8 text-center">
        <Clock size={32} className="mx-auto text-muted-foreground opacity-40 mb-3" />
        <p className="text-sm text-muted-foreground">Nenhum evento na linha do tempo ainda.</p>
        <p className="text-[11px] text-muted-foreground/70 mt-1">
          Eventos aparecem aqui conforme o processo evolui: etapas, tarefas, audiências e publicações.
        </p>
      </div>
    );
  }

  // Renderizador de card
  const renderItem = (it: TimelineItem, opts: { dimmed?: boolean } = {}) => {
    const { dimmed } = opts;
    const Icon = it.icon;
    return (
      <div key={it.id} className="relative pl-9 pb-3 last:pb-0">
        {/* Bolinha do ícone */}
        <div
          className={`absolute left-0 top-0 w-6 h-6 rounded-full flex items-center justify-center border ${it.accentBorder} ${it.accentBg}`}
        >
          <Icon size={12} className={it.accent} />
        </div>

        <div
          className={`rounded-xl border ${it.accentBorder} ${it.accentBg} p-3 ${
            dimmed ? 'opacity-80' : ''
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`text-[9px] font-bold uppercase tracking-wider ${it.accent}`}
            >
              {it.label}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {fmtTime(it.date)} • {fmtRelative(it.date)}
            </span>
          </div>
          <div className="text-[13px] font-semibold text-foreground leading-snug">
            {it.title}
          </div>
          {it.subtitle && (
            <div className="text-[11px] text-muted-foreground mt-1 leading-snug">
              {it.subtitle}
            </div>
          )}
          {(it.meta || it.href) && (
            <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground">
              {it.meta && <span>{it.meta}</span>}
              {it.href && (
                <a
                  href={it.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Abrir link
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[13px] font-bold text-foreground">Linha do tempo</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {items.length} evento{items.length !== 1 ? 's' : ''} na história deste processo
          </p>
        </div>
      </div>

      {/* Eventos futuros (agrupados no topo) */}
      {futureItems.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
              Próximos eventos
            </span>
            <span className="text-[10px] text-muted-foreground">
              {futureItems.length}
            </span>
          </div>
          <div className="relative">
            <div className="absolute left-3 top-2 bottom-2 w-px bg-border" />
            {futureItems.map(it => renderItem(it))}
          </div>
        </div>
      )}

      {/* Histórico agrupado por dia */}
      {pastByDay.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Histórico
            </span>
            <span className="text-[10px] text-muted-foreground">
              {pastItems.length}
            </span>
          </div>
          {pastByDay.map(group => (
            <div key={group.key} className="mb-4 last:mb-0">
              <div className="flex items-center gap-2 mb-2 sticky top-0 bg-background/80 backdrop-blur-sm py-1 z-[1]">
                <Calendar size={11} className="text-muted-foreground" />
                <span className="text-[11px] font-semibold text-muted-foreground capitalize">
                  {dayBucketLabel(group.date)}
                </span>
                <span className="text-[10px] text-muted-foreground/60">
                  {fmtDate(group.date)}
                </span>
              </div>
              <div className="relative">
                <div className="absolute left-3 top-2 bottom-2 w-px bg-border" />
                {group.items.map(it => renderItem(it, { dimmed: true }))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
