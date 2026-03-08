'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  MessageSquare, ListTodo, Scale, BookOpen, DollarSign, TrendingUp,
  Clock, AlertTriangle, Calendar, Briefcase, Settings, Bell,
  Loader2, ChevronRight, Gavel, FileText, Activity,
  LayoutDashboard,
} from 'lucide-react';
import api from '@/lib/api';
import { showError } from '@/lib/toast';
import { CRM_STAGES } from '@/lib/crmStages';
import { LEGAL_STAGES, TRACKING_STAGES } from '@/lib/legalStages';

/* ──────────────────────────────────────────────────────────────
   Types
────────────────────────────────────────────────────────────── */
interface TeamMember {
  userId: string;
  name: string;
  role: string;
  openConversations: number;
  activeCases: number;
  pendingTasks: number;
  overdueTasks: number;
  totalCollected: number;
  totalReceivable: number;
}

interface DashboardData {
  user: { id: string; name: string; role: string };
  conversations: { open: number; pendingTransfers: number };
  leadPipeline: { stage: string; count: number }[];
  legalCases: { total: number; byStage: { stage: string; count: number }[] };
  trackingCases: { total: number; byStage: { stage: string; count: number }[] };
  upcomingEvents: {
    id: string; type: string; title: string; start_at: string;
    end_at: string | null; status: string; priority: string;
    lead_name: string | null; legal_case_id: string | null;
  }[];
  tasks: { pending: number; inProgress: number; overdue: number };
  financials: {
    totalContracted: number; totalCollected: number;
    totalReceivable: number; totalOverdue: number; overdueCount: number;
  };
  recentDjen: {
    id: string; numero_processo: string; tipo_comunicacao: string | null;
    data_disponibilizacao: string; lead_name: string | null; legal_case_id: string | null;
  }[];
  teamMetrics: TeamMember[];
}

/* ──────────────────────────────────────────────────────────────
   Helpers
────────────────────────────────────────────────────────────── */
function getGreeting(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Bom dia';
  if (h >= 12 && h < 18) return 'Boa tarde';
  return 'Boa noite';
}

function formatDateFull(): string {
  return new Date().toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

function formatEventDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();

  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `Hoje, ${time}`;
  if (isTomorrow) return `Amanhã, ${time}`;
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }) + `, ${time}`;
}

function getEventColor(type: string): string {
  switch (type?.toUpperCase()) {
    case 'CONSULTA': return 'bg-blue-500';
    case 'AUDIENCIA': return 'bg-rose-500';
    case 'PRAZO': return 'bg-amber-500';
    case 'TAREFA': return 'bg-green-500';
    default: return 'bg-gray-400';
  }
}

function getEventIcon(type: string) {
  switch (type?.toUpperCase()) {
    case 'AUDIENCIA': return <Gavel size={13} />;
    case 'PRAZO': return <Clock size={13} />;
    case 'TAREFA': return <FileText size={13} />;
    default: return <Calendar size={13} />;
  }
}

function getStageCount(stages: { stage: string; count: number }[], id: string): number {
  return stages.find((s) => s.stage === id)?.count || 0;
}

function firstName(name: string): string {
  return name.split(' ')[0];
}

/* ──────────────────────────────────────────────────────────────
   Stat Card component
────────────────────────────────────────────────────────────── */
function StatCard({ icon: Icon, label, value, color, sub }: {
  icon: any; label: string; value: string | number; color: string; sub?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-3">
      <div className={`w-6 h-6 rounded-lg ${color} flex items-center justify-center mb-1.5`}>
        <Icon size={13} />
      </div>
      <p className="text-lg font-bold text-foreground leading-none">{value}</p>
      <p className="text-[9px] text-muted-foreground mt-0.5 uppercase font-semibold tracking-wide">{label}</p>
      {sub && <p className="text-[9px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Pipeline Bar
────────────────────────────────────────────────────────────── */
function PipelineBar({ label, count, max, color, emoji }: {
  label: string; count: number; max: number; color: string; emoji?: string;
}) {
  const pct = max > 0 ? Math.max(2, (count / max) * 100) : 0;
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-semibold text-foreground flex items-center gap-1.5">
          {emoji && <span>{emoji}</span>}
          {label}
        </span>
        <span className="text-muted-foreground tabular-nums font-bold">{count}</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Main component
────────────────────────────────────────────────────────────── */
export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  // Detect role from JWT
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    try {
      const token = localStorage.getItem('token');
      if (token) {
        const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        setIsAdmin(payload?.role === 'ADMIN');
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    api.get('/dashboard')
      .then((r) => setData(r.data))
      .catch(() => showError('Erro ao carregar dashboard'))
      .finally(() => setLoading(false));
  }, []);

  // ─── Loading skeleton ──
  if (loading) {
    return (
      <div className="h-full overflow-y-auto bg-background p-4 md:p-6">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="animate-pulse space-y-2">
            <div className="h-8 w-60 bg-muted rounded-lg" />
            <div className="h-4 w-44 bg-muted rounded" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="bg-card border border-border rounded-xl p-3 animate-pulse">
                <div className="w-6 h-6 rounded-lg bg-muted mb-1.5" />
                <div className="h-5 w-12 bg-muted rounded mb-1" />
                <div className="h-2 w-16 bg-muted rounded" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="bg-card border border-border rounded-xl p-4 animate-pulse h-48" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const crmMax = Math.max(...(data.leadPipeline.map((s) => s.count)), 1);
  const legalMax = Math.max(...(data.legalCases.byStage.map((s) => s.count)), 1);
  const trackingMax = Math.max(...(data.trackingCases.byStage.map((s) => s.count)), 1);

  // Team metrics: calculate workload for bar
  const teamMaxLoad = data.teamMetrics.length > 0
    ? Math.max(...data.teamMetrics.map((m) => m.openConversations + m.activeCases + m.pendingTasks), 1)
    : 1;

  const sortedTeam = [...data.teamMetrics].sort(
    (a, b) => (b.openConversations + b.activeCases + b.pendingTasks) - (a.openConversations + a.activeCases + a.pendingTasks),
  );

  const quickActions = [
    { label: 'Atendimento', icon: MessageSquare, href: '/atendimento', color: 'text-blue-500 bg-blue-500/10' },
    { label: 'Novo Caso', icon: Scale, href: '/atendimento/advogado', color: 'text-purple-500 bg-purple-500/10' },
    { label: 'Agenda', icon: Calendar, href: '/atendimento/agenda', color: 'text-rose-500 bg-rose-500/10' },
    { label: 'CRM', icon: Briefcase, href: '/atendimento/crm', color: 'text-amber-500 bg-amber-500/10' },
    { label: 'Processos', icon: BookOpen, href: '/atendimento/processos', color: 'text-teal-500 bg-teal-500/10' },
    { label: 'Ajustes', icon: Settings, href: '/atendimento/settings', color: 'text-gray-400 bg-gray-500/10' },
  ];

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6 pb-28 md:pb-6">

        {/* ─── A) Greeting ─── */}
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">
            {getGreeting()}, {firstName(data.user.name)} 👋
          </h1>
          <p className="text-sm text-muted-foreground capitalize">{formatDateFull()}</p>
        </div>

        {/* ─── B) Stats Grid Principal ─── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={MessageSquare} label="Conversas Abertas" value={data.conversations.open} color="text-blue-500 bg-blue-500/10" sub={data.conversations.pendingTransfers > 0 ? `${data.conversations.pendingTransfers} transferência(s)` : undefined} />
          <StatCard icon={ListTodo} label="Tarefas Pendentes" value={data.tasks.pending + data.tasks.inProgress} color="text-amber-500 bg-amber-500/10" sub={data.tasks.overdue > 0 ? `${data.tasks.overdue} atrasada(s)` : undefined} />
          <StatCard icon={Scale} label="Casos Ativos" value={data.legalCases.total} color="text-purple-500 bg-purple-500/10" />
          <StatCard icon={BookOpen} label="Processos" value={data.trackingCases.total} color="text-teal-500 bg-teal-500/10" />
        </div>

        {/* ─── C) Stats Financeiro ─── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={DollarSign} label="Contratado" value={fmtBRL(data.financials.totalContracted)} color="text-indigo-500 bg-indigo-500/10" />
          <StatCard icon={TrendingUp} label="Recebido" value={fmtBRL(data.financials.totalCollected)} color="text-emerald-500 bg-emerald-500/10" />
          <StatCard icon={Clock} label="A Receber" value={fmtBRL(data.financials.totalReceivable)} color="text-amber-500 bg-amber-500/10" />
          <StatCard icon={AlertTriangle} label="Em Atraso" value={fmtBRL(data.financials.totalOverdue)} color="text-red-500 bg-red-500/10" sub={data.financials.overdueCount > 0 ? `${data.financials.overdueCount} parcela(s)` : undefined} />
        </div>

        {/* ─── D) Pipeline CRM (Admin only) ─── */}
        {isAdmin && data.leadPipeline.length > 0 && (
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
                <Briefcase size={15} className="text-primary" />
                Pipeline de Leads
              </h2>
              <button onClick={() => router.push('/atendimento/crm')} className="text-[10px] text-primary hover:underline flex items-center gap-0.5">
                Ver CRM <ChevronRight size={11} />
              </button>
            </div>
            <div className="space-y-2">
              {CRM_STAGES.map((stage) => {
                const count = data.leadPipeline.find((s) => s.stage === stage.id)?.count || 0;
                return (
                  <PipelineBar
                    key={stage.id}
                    label={stage.label}
                    count={count}
                    max={crmMax}
                    color={stage.color}
                    emoji={stage.emoji}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* ─── E) Casos por Etapa (2 colunas) ─── */}
        {(data.legalCases.total > 0 || data.trackingCases.total > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Preparação */}
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
                  <Scale size={15} className="text-primary" />
                  Preparação
                </h2>
                <span className="text-[10px] text-muted-foreground font-bold">{data.legalCases.total} caso(s)</span>
              </div>
              <div className="space-y-2">
                {LEGAL_STAGES.map((stage) => (
                  <PipelineBar
                    key={stage.id}
                    label={stage.label}
                    count={getStageCount(data.legalCases.byStage, stage.id)}
                    max={legalMax}
                    color={stage.color}
                    emoji={stage.emoji}
                  />
                ))}
              </div>
            </div>

            {/* Acompanhamento */}
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
                  <BookOpen size={15} className="text-primary" />
                  Acompanhamento
                </h2>
                <span className="text-[10px] text-muted-foreground font-bold">{data.trackingCases.total} processo(s)</span>
              </div>
              <div className="space-y-2">
                {TRACKING_STAGES.map((stage) => (
                  <PipelineBar
                    key={stage.id}
                    label={stage.label}
                    count={getStageCount(data.trackingCases.byStage, stage.id)}
                    max={trackingMax}
                    color={stage.color}
                    emoji={stage.emoji}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ─── F) Team Metrics (Admin only) ─── */}
        {isAdmin && sortedTeam.length > 0 && (
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
                <Activity size={15} className="text-primary" />
                Equipe — Carga de Trabalho
              </h2>
              <span className="text-[10px] text-muted-foreground font-bold">{sortedTeam.length} membro(s)</span>
            </div>

            {/* Header row */}
            <div className="hidden md:grid grid-cols-[1fr_70px_70px_70px_70px_100px_100px] gap-2 mb-2 text-[9px] text-muted-foreground font-bold uppercase tracking-wider px-1">
              <span>Membro</span>
              <span className="text-center">Conversas</span>
              <span className="text-center">Casos</span>
              <span className="text-center">Tarefas</span>
              <span className="text-center">Atrasadas</span>
              <span className="text-right">Recebido</span>
              <span className="text-right">A Receber</span>
            </div>

            <div className="space-y-1.5">
              {sortedTeam.map((member) => {
                const load = member.openConversations + member.activeCases + member.pendingTasks;
                const loadPct = Math.max(3, (load / teamMaxLoad) * 100);
                const avgLoad = teamMaxLoad / Math.max(sortedTeam.length, 1);
                const loadColor = load > avgLoad * 1.5
                  ? 'bg-red-500'
                  : load > avgLoad
                    ? 'bg-amber-500'
                    : 'bg-emerald-500';

                return (
                  <div key={member.userId} className="bg-muted/30 rounded-lg p-2.5">
                    {/* Desktop row */}
                    <div className="hidden md:grid grid-cols-[1fr_70px_70px_70px_70px_100px_100px] gap-2 items-center">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-7 h-7 rounded-full bg-primary/20 text-primary text-[11px] font-bold flex items-center justify-center shrink-0">
                          {member.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-foreground truncate">{member.name}</p>
                          <p className="text-[9px] text-muted-foreground">{member.role === 'ADMIN' ? 'Admin' : member.role}</p>
                        </div>
                      </div>
                      <span className="text-xs text-center font-bold text-foreground">{member.openConversations}</span>
                      <span className="text-xs text-center font-bold text-foreground">{member.activeCases}</span>
                      <span className="text-xs text-center font-bold text-foreground">{member.pendingTasks}</span>
                      <span className={`text-xs text-center font-bold ${member.overdueTasks > 0 ? 'text-red-500' : 'text-foreground'}`}>{member.overdueTasks}</span>
                      <span className="text-xs text-right font-semibold text-emerald-500">{fmtBRL(member.totalCollected)}</span>
                      <span className="text-xs text-right font-semibold text-amber-500">{fmtBRL(member.totalReceivable)}</span>
                    </div>

                    {/* Mobile card */}
                    <div className="md:hidden space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-primary/20 text-primary text-[11px] font-bold flex items-center justify-center shrink-0">
                          {member.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-foreground">{member.name}</p>
                          <p className="text-[9px] text-muted-foreground">{member.role === 'ADMIN' ? 'Admin' : member.role}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-center">
                        <div>
                          <p className="text-xs font-bold text-foreground">{member.openConversations}</p>
                          <p className="text-[8px] text-muted-foreground">Conv.</p>
                        </div>
                        <div>
                          <p className="text-xs font-bold text-foreground">{member.activeCases}</p>
                          <p className="text-[8px] text-muted-foreground">Casos</p>
                        </div>
                        <div>
                          <p className="text-xs font-bold text-foreground">{member.pendingTasks}</p>
                          <p className="text-[8px] text-muted-foreground">Tarefas</p>
                        </div>
                        <div>
                          <p className={`text-xs font-bold ${member.overdueTasks > 0 ? 'text-red-500' : 'text-foreground'}`}>{member.overdueTasks}</p>
                          <p className="text-[8px] text-muted-foreground">Atras.</p>
                        </div>
                      </div>
                    </div>

                    {/* Load bar */}
                    <div className="mt-1.5 h-1 bg-muted rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-500 ${loadColor}`} style={{ width: `${loadPct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ─── G) Próximos Compromissos ─── */}
        {data.upcomingEvents.length > 0 && (
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
                <Calendar size={15} className="text-primary" />
                Próximos Compromissos
              </h2>
              <button onClick={() => router.push('/atendimento/agenda')} className="text-[10px] text-primary hover:underline flex items-center gap-0.5">
                Ver agenda <ChevronRight size={11} />
              </button>
            </div>
            <div className="space-y-2">
              {data.upcomingEvents.slice(0, 10).map((event) => (
                <div
                  key={event.id}
                  onClick={() => router.push('/atendimento/agenda')}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                >
                  <div className={`w-2 h-2 rounded-full shrink-0 ${getEventColor(event.type)}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-foreground truncate">{event.title}</p>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-0.5">
                        {getEventIcon(event.type)}
                        {formatEventDate(event.start_at)}
                      </span>
                      {event.lead_name && (
                        <span className="truncate">· {event.lead_name}</span>
                      )}
                    </div>
                  </div>
                  {(event.priority === 'ALTA' || event.priority === 'URGENTE') && (
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${event.priority === 'URGENTE' ? 'bg-red-500/10 text-red-500' : 'bg-amber-500/10 text-amber-500'}`}>
                      {event.priority}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ─── H) DJEN Recentes ─── */}
        {data.recentDjen.length > 0 && (
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
                <Bell size={15} className="text-violet-500" />
                Publicações DJEN
              </h2>
              <span className="text-[10px] text-muted-foreground font-bold">Últimos 7 dias</span>
            </div>
            <div className="space-y-2">
              {data.recentDjen.slice(0, 5).map((pub) => (
                <div
                  key={pub.id}
                  onClick={() => pub.legal_case_id && router.push(`/atendimento/workspace/${pub.legal_case_id}`)}
                  className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${pub.legal_case_id ? 'hover:bg-muted/50 cursor-pointer' : ''}`}
                >
                  <Gavel size={14} className="text-violet-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-foreground truncate">
                      {pub.tipo_comunicacao || 'Publicação'} — {pub.numero_processo}
                    </p>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>{new Date(pub.data_disponibilizacao).toLocaleDateString('pt-BR')}</span>
                      {pub.lead_name && <span>· {pub.lead_name}</span>}
                    </div>
                  </div>
                  {pub.legal_case_id && <ChevronRight size={13} className="text-muted-foreground shrink-0" />}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ─── I) Ações Rápidas ─── */}
        <div>
          <h2 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
            <LayoutDashboard size={15} className="text-primary" />
            Acesso Rápido
          </h2>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.label}
                  onClick={() => router.push(action.href)}
                  className="bg-card border border-border rounded-xl p-3 flex flex-col items-center gap-1.5 hover:border-primary/40 hover:shadow-md hover:shadow-primary/5 transition-all group"
                >
                  <div className={`w-8 h-8 rounded-lg ${action.color} flex items-center justify-center group-hover:scale-110 transition-transform`}>
                    <Icon size={16} />
                  </div>
                  <span className="text-[10px] font-semibold text-muted-foreground group-hover:text-foreground transition-colors">{action.label}</span>
                </button>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}
