'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2, Calendar, AlertCircle, Scale, Sparkles, Clock,
  ChevronDown, ChevronUp, Microscope, Gavel,
  FileText, AlertTriangle, MapPin, MessageCircle,
} from 'lucide-react';
import { PortalHeader } from '../../components/PortalHeader';
import { ProcessRoadmap } from '../../components/ProcessRoadmap';

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
  content: string;                    // texto cru juridico
  explanation_cached: string | null;  // explicacao leiga ja gerada (cache)
  next_step_lay?: string | null;
  deadline_lay?: string | null;
  orientation_lay?: string | null;
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

  function updateMovementExplanation(movKey: string, explanation: string) {
    setMovements(prev => prev.map(m =>
      `${m.kind}-${m.id}` === movKey ? { ...m, explanation_cached: explanation } : m,
    ));
  }

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
            <p className="text-sm font-mono text-white/50">{detail.case_number}</p>
          )}
        </div>

        {/* Roadmap "corrida" — visualizacao ludica do progresso */}
        <ProcessRoadmap currentStage={detail.tracking_stage} />

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
                {movements.map(m => (
                  <MovementCard
                    key={`${m.kind}-${m.id}`}
                    m={m}
                    caseId={caseId}
                    onExplained={(text) => updateMovementExplanation(`${m.kind}-${m.id}`, text)}
                  />
                ))}
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

function MovementCard({
  m,
  caseId,
  onExplained,
}: {
  m: Movement;
  caseId: string;
  onExplained: (explanation: string) => void;
}) {
  const isDjen = m.kind === 'djen';
  const [showExplanation, setShowExplanation] = useState(!!m.explanation_cached); // se ja tem cache, abre
  const [loadingExplanation, setLoadingExplanation] = useState(false);
  const [explanationError, setExplanationError] = useState<string | null>(null);

  async function pedirExplicacao() {
    if (m.explanation_cached) {
      setShowExplanation(true);
      return;
    }
    setLoadingExplanation(true);
    setExplanationError(null);
    try {
      const res = await fetch(
        `${API_BASE}/portal/processes/${caseId}/movements/${m.id}/explain`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: m.kind }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      onExplained(data.explanation);
      setShowExplanation(true);
    } catch (e: any) {
      setExplanationError(e.message || 'Falha ao gerar explicação');
    } finally {
      setLoadingExplanation(false);
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-[#0d0d14] p-4">
      <div className="flex items-start gap-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
          isDjen ? 'bg-violet-500/15 border border-violet-500/30' : 'bg-blue-500/15 border border-blue-500/30'
        }`}>
          {isDjen ? <Sparkles className="text-violet-400" size={16} /> : <Scale className="text-blue-400" size={16} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className={`text-[9px] font-bold uppercase tracking-wider ${isDjen ? 'text-violet-400' : 'text-blue-400'}`}>
              {isDjen ? 'Diário Oficial' : 'Tribunal'}
            </span>
            <span className="text-[10px] text-white/40">·</span>
            <span className="text-[10px] text-white/50">{formatBrDate(m.date)}</span>
          </div>
          <h3 className="font-bold text-sm text-white mb-2 leading-snug">{m.title}</h3>

          {/* Texto cru — exibido por padrao */}
          <div className="text-[13px] text-white/80 leading-relaxed whitespace-pre-line font-mono bg-black/20 rounded-lg px-3 py-2 max-h-64 overflow-y-auto custom-scrollbar">
            {m.content || m.title}
          </div>

          {/* Botao "Pedir explicacao" */}
          {!showExplanation && (
            <button
              onClick={pedirExplicacao}
              disabled={loadingExplanation}
              className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-violet-500/15 border border-violet-500/30 hover:bg-violet-500/25 text-violet-300 text-xs font-bold transition-colors disabled:opacity-50"
            >
              {loadingExplanation ? (
                <><Loader2 className="animate-spin" size={12} /> Sophia está pensando…</>
              ) : (
                <><MessageCircle size={12} /> Pedir explicação à Sophia</>
              )}
            </button>
          )}

          {explanationError && (
            <p className="mt-2 text-xs text-red-400">{explanationError}</p>
          )}

          {/* Explicacao da Sophia */}
          {showExplanation && m.explanation_cached && (
            <div className="mt-3 rounded-xl border border-violet-500/30 bg-violet-500/5 p-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 rounded-full bg-violet-500/20 border border-violet-500/40 flex items-center justify-center">
                  <Sparkles size={11} className="text-violet-400" />
                </div>
                <span className="text-xs font-bold text-violet-300">Sophia explica</span>
              </div>
              <p className="text-sm text-white/90 leading-relaxed whitespace-pre-line">{m.explanation_cached}</p>

              {/* Auxiliares do DJEN (so se forem campos novos da analise) */}
              {(m.next_step_lay || m.deadline_lay || m.orientation_lay) && (
                <div className="mt-3 pt-3 border-t border-violet-500/20 space-y-1.5">
                  {m.deadline_lay && (
                    <p className="text-xs flex items-start gap-2">
                      <Clock size={11} className="text-amber-400 shrink-0 mt-0.5" />
                      <span><strong className="text-amber-300">Prazo:</strong> <span className="text-white/80">{m.deadline_lay}</span></span>
                    </p>
                  )}
                  {m.next_step_lay && (
                    <p className="text-xs flex items-start gap-2">
                      <span className="text-emerald-400 shrink-0 mt-0.5">→</span>
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

              <button
                onClick={() => setShowExplanation(false)}
                className="mt-3 text-[11px] text-white/40 hover:text-white/70 flex items-center gap-1 transition-colors"
              >
                <ChevronUp size={12} /> Ocultar explicação
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
