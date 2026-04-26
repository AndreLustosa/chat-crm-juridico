'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2, Calendar, AlertCircle, Scale, Sparkles, Clock,
  ChevronDown, ChevronUp, Microscope, Gavel, ArrowRight,
  FileText, AlertTriangle, MapPin,
} from 'lucide-react';
import { PortalHeader } from '../../components/PortalHeader';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005';

type ProcessDetail = {
  id: string;
  case_number: string | null;
  action_type: string | null;
  legal_area: string | null;
  tracking_stage: string | null;
  opposing_party: string | null;
  client_is_author: boolean;
  court: string | null;
  judge: string | null;
  claim_value: string | null;
  filed_at: string | null;
  notes: string | null;
  sentence_date: string | null;
  sentence_type: string | null;
  sentence_value: string | null;
  counts: { movements: number; documents: number; upcoming_events: number };
};

type EventItem = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string | null;
  location: string | null;
  priority: string;
};

type Movement = {
  kind: 'esaj' | 'djen';
  id: string;
  date: string;
  title: string;
  summary_lay: string;
  detail_technical: string;
  next_step_lay?: string | null;
  stage_lay?: string | null;
  deadline_lay?: string | null;
  orientation_lay?: string | null;
};

const STAGE_LABELS: Record<string, string> = {
  DISTRIBUIDO: 'Distribuído',
  CITACAO: 'Citação',
  CONTESTACAO: 'Contestação',
  REPLICA: 'Réplica',
  PERICIA_AGENDADA: 'Perícia Agendada',
  INSTRUCAO: 'Instrução / Audiência',
  ALEGACOES_FINAIS: 'Alegações Finais',
  JULGAMENTO: 'Julgamento',
  RECURSO: 'Recurso',
  TRANSITADO: 'Transitado em Julgado',
  EXECUCAO: 'Execução',
  ENCERRADO: 'Encerrado',
};

const TYPE_CONFIG: Record<string, { label: string; icon: React.ComponentType<{ size?: number; className?: string }>; color: string }> = {
  AUDIENCIA: { label: 'Audiência', icon: Gavel, color: 'amber' },
  PERICIA: { label: 'Perícia', icon: Microscope, color: 'violet' },
  PRAZO: { label: 'Prazo', icon: Clock, color: 'red' },
  TAREFA: { label: 'Tarefa', icon: FileText, color: 'blue' },
};

function formatBrDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'UTC',
  });
}

function formatBrDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
  });
}

export default function ProcessDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: caseId } = use(params);
  const router = useRouter();
  const [detail, setDetail] = useState<ProcessDetail | null>(null);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/portal/processes/${caseId}`, { credentials: 'include' }),
      fetch(`${API_BASE}/portal/processes/${caseId}/events`, { credentials: 'include' }),
      fetch(`${API_BASE}/portal/processes/${caseId}/movements?limit=30`, { credentials: 'include' }),
    ])
      .then(async ([dRes, eRes, mRes]) => {
        if (dRes.status === 401) {
          router.push('/portal');
          return;
        }
        if (dRes.status === 404) {
          setError('Processo não encontrado ou você não tem acesso a ele.');
          return;
        }
        if (!dRes.ok) throw new Error(`HTTP ${dRes.status}`);
        const d = await dRes.json();
        const e = eRes.ok ? await eRes.json() : [];
        const m = mRes.ok ? await mRes.json() : { items: [] };
        setDetail(d);
        setEvents(e);
        setMovements(m.items || []);
      })
      .catch(err => setError(err.message || 'Falha ao carregar'))
      .finally(() => setLoading(false));
  }, [caseId, router]);

  if (loading) {
    return (
      <>
        <PortalHeader showBack />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="animate-spin text-[#A89048]" size={28} />
        </div>
      </>
    );
  }

  if (error || !detail) {
    return (
      <>
        <PortalHeader showBack />
        <main className="flex-1 max-w-3xl w-full mx-auto px-6 py-12">
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6 flex items-start gap-3">
            <AlertCircle className="text-red-400 mt-0.5 shrink-0" size={20} />
            <div>
              <p className="text-red-400 font-bold">Não foi possível carregar este processo</p>
              <p className="text-red-400/70 text-sm mt-1">{error}</p>
            </div>
          </div>
        </main>
      </>
    );
  }

  const stageLabel = detail.tracking_stage ? (STAGE_LABELS[detail.tracking_stage] || detail.tracking_stage) : null;

  return (
    <>
      <PortalHeader showBack />
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-8">
        {/* Header do processo */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <Scale className="text-[#A89048]" size={20} />
            <h1 className="text-2xl font-bold">{detail.action_type || detail.legal_area || 'Processo Judicial'}</h1>
          </div>
          {detail.case_number && (
            <p className="text-sm font-mono text-white/50 mb-3">{detail.case_number}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {stageLabel && (
              <span className="text-[11px] font-bold text-[#A89048] uppercase tracking-wider px-3 py-1 rounded-full bg-[#A89048]/10 border border-[#A89048]/30">
                {stageLabel}
              </span>
            )}
            {detail.legal_area && detail.legal_area !== detail.action_type && (
              <span className="text-[11px] font-bold text-white/60 uppercase tracking-wider px-3 py-1 rounded-full bg-white/5 border border-white/10">
                {detail.legal_area}
              </span>
            )}
          </div>
        </div>

        {/* Próximos eventos em destaque */}
        {events.length > 0 && (
          <section className="mb-8">
            <h2 className="text-xs font-bold text-white/50 uppercase tracking-wider mb-3">📅 Próximos eventos</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {events.slice(0, 4).map(e => <EventCard key={e.id} e={e} />)}
            </div>
          </section>
        )}

        {/* Sidebar info + main timeline */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <aside className="space-y-4 md:order-2">
            <InfoBlock title="Informações do processo">
              {detail.opposing_party && (
                <InfoRow label={detail.client_is_author ? 'Parte contrária (réu)' : 'Parte contrária (autor)'} value={detail.opposing_party} />
              )}
              {detail.court && <InfoRow label="Vara/Tribunal" value={detail.court} />}
              {detail.judge && <InfoRow label="Juiz" value={detail.judge} />}
              {detail.claim_value && <InfoRow label="Valor da causa" value={`R$ ${detail.claim_value}`} />}
              {detail.filed_at && <InfoRow label="Data de ajuizamento" value={formatBrDate(detail.filed_at)} />}
              {detail.sentence_date && (
                <>
                  <InfoRow label="Data da sentença" value={formatBrDate(detail.sentence_date)} />
                  {detail.sentence_type && <InfoRow label="Resultado" value={detail.sentence_type} />}
                  {detail.sentence_value && <InfoRow label="Valor da condenação" value={`R$ ${detail.sentence_value}`} />}
                </>
              )}
            </InfoBlock>

            <div className="rounded-xl border border-white/10 bg-[#0d0d14] p-4">
              <p className="text-xs text-white/50 mb-2">Resumo</p>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-white/70">Movimentações</span>
                  <span className="font-bold">{detail.counts.movements}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-white/70">Documentos</span>
                  <span className="font-bold">{detail.counts.documents}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-white/70">Eventos futuros</span>
                  <span className="font-bold">{detail.counts.upcoming_events}</span>
                </div>
              </div>
            </div>
          </aside>

          <div className="md:col-span-2 md:order-1">
            <h2 className="text-xs font-bold text-white/50 uppercase tracking-wider mb-3">📜 Movimentações</h2>
            {movements.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-[#0d0d14] p-8 text-center">
                <p className="text-white/50 text-sm">Nenhuma movimentação registrada ainda.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {movements.map(m => <MovementCard key={`${m.kind}-${m.id}`} m={m} />)}
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}

function InfoBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#0d0d14] p-4">
      <p className="text-xs font-bold text-white/50 uppercase tracking-wider mb-3">{title}</p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-white/40 uppercase tracking-wide">{label}</p>
      <p className="text-sm text-white">{value}</p>
    </div>
  );
}

function EventCard({ e }: { e: EventItem }) {
  const cfg = TYPE_CONFIG[e.type] || { label: e.type, icon: Calendar, color: 'gray' };
  const Icon = cfg.icon;
  const colorClasses: Record<string, string> = {
    amber: 'border-amber-500/30 bg-amber-500/5 text-amber-300',
    violet: 'border-violet-500/30 bg-violet-500/5 text-violet-300',
    red: 'border-red-500/30 bg-red-500/5 text-red-300',
    blue: 'border-blue-500/30 bg-blue-500/5 text-blue-300',
    gray: 'border-white/10 bg-white/5 text-white/70',
  };
  return (
    <div className={`rounded-xl border p-4 ${colorClasses[cfg.color]}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon size={16} />
        <span className="text-[10px] font-bold uppercase tracking-wider">{cfg.label}</span>
      </div>
      <p className="text-sm font-bold text-white mb-1 line-clamp-2">{e.title}</p>
      <p className="text-xs text-white/70">📅 {formatBrDateTime(e.start_at)}</p>
      {e.location && (
        <p className="text-xs text-white/60 mt-1 flex items-center gap-1">
          <MapPin size={10} /> {e.location}
        </p>
      )}
    </div>
  );
}

function MovementCard({ m }: { m: Movement }) {
  const [expanded, setExpanded] = useState(false);
  const isDjen = m.kind === 'djen';
  const hasDetail = m.detail_technical && m.detail_technical !== m.summary_lay;

  return (
    <div className="rounded-xl border border-white/10 bg-[#0d0d14] p-4">
      <div className="flex items-start gap-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
          isDjen ? 'bg-violet-500/15 border border-violet-500/30' : 'bg-blue-500/15 border border-blue-500/30'
        }`}>
          {isDjen ? <Sparkles className="text-violet-400" size={16} /> : <Scale className="text-blue-400" size={16} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[9px] font-bold uppercase tracking-wider ${isDjen ? 'text-violet-400' : 'text-blue-400'}`}>
              {isDjen ? 'Diário Oficial' : 'Tribunal'}
            </span>
            <span className="text-[10px] text-white/40">·</span>
            <span className="text-[10px] text-white/50">{formatBrDate(m.date)}</span>
          </div>
          <h3 className="font-bold text-sm text-white mb-2 leading-snug">{m.title}</h3>
          <p className="text-sm text-white/80 leading-relaxed whitespace-pre-line">{m.summary_lay}</p>

          {/* Campos auxiliares do DJEN */}
          {isDjen && (m.next_step_lay || m.deadline_lay || m.orientation_lay) && (
            <div className="mt-3 space-y-1.5">
              {m.deadline_lay && (
                <p className="text-xs flex items-start gap-2">
                  <Clock size={11} className="text-amber-400 shrink-0 mt-0.5" />
                  <span><strong className="text-amber-300">Prazo:</strong> <span className="text-white/80">{m.deadline_lay}</span></span>
                </p>
              )}
              {m.next_step_lay && (
                <p className="text-xs flex items-start gap-2">
                  <ArrowRight size={11} className="text-emerald-400 shrink-0 mt-0.5" />
                  <span><strong className="text-emerald-300">Próximo passo:</strong> <span className="text-white/80">{m.next_step_lay}</span></span>
                </p>
              )}
              {m.orientation_lay && (
                <p className="text-xs flex items-start gap-2">
                  <AlertTriangle size={11} className="text-blue-400 shrink-0 mt-0.5" />
                  <span><strong className="text-blue-300">Orientação:</strong> <span className="text-white/80">{m.orientation_lay}</span></span>
                </p>
              )}
            </div>
          )}

          {hasDetail && (
            <div className="mt-3 pt-3 border-t border-white/5">
              <button
                onClick={() => setExpanded(!expanded)}
                className="text-[11px] text-white/50 hover:text-white/80 flex items-center gap-1 transition-colors"
              >
                {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                {expanded ? 'Ocultar texto técnico' : 'Ver texto técnico (jurídico)'}
              </button>
              {expanded && (
                <div className="mt-2 text-xs text-white/60 leading-relaxed whitespace-pre-line max-h-64 overflow-y-auto custom-scrollbar font-mono">
                  {m.detail_technical}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
