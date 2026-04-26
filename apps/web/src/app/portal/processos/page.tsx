'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Calendar, AlertCircle, Scale, ChevronRight, Sparkles } from 'lucide-react';
import { PortalHeader } from '../components/PortalHeader';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005';

type Process = {
  id: string;
  case_number: string | null;
  action_type: string | null;
  legal_area: string | null;
  tracking_stage: string | null;
  opposing_party: string | null;
  client_is_author: boolean;
  priority: string;
  court: string | null;
  next_event: { id: string; type: string; title: string; start_at: string } | null;
  last_update: { date: string; summary: string } | null;
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

const TYPE_LABELS: Record<string, { label: string; emoji: string }> = {
  AUDIENCIA: { label: 'Audiência', emoji: '⚖️' },
  PERICIA: { label: 'Perícia', emoji: '🔬' },
  PRAZO: { label: 'Prazo', emoji: '⏰' },
  TAREFA: { label: 'Tarefa', emoji: '✅' },
};

function formatBrDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
  });
}

function formatBrDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'UTC',
  });
}

function relativeDate(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'hoje';
  if (diffDays === 1) return 'ontem';
  if (diffDays < 7) return `há ${diffDays} dias`;
  if (diffDays < 30) return `há ${Math.floor(diffDays / 7)} semana${Math.floor(diffDays / 7) > 1 ? 's' : ''}`;
  return `há ${Math.floor(diffDays / 30)} mes${Math.floor(diffDays / 30) > 1 ? 'es' : ''}`;
}

export default function ProcessosListPage() {
  const router = useRouter();
  const [processes, setProcesses] = useState<Process[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/portal/processes`, { credentials: 'include' })
      .then(async r => {
        if (r.status === 401) {
          router.push('/portal');
          return null;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        if (data) setProcesses(data);
      })
      .catch(e => setError(e.message || 'Falha ao carregar'));
  }, [router]);

  return (
    <>
      <PortalHeader showBack />
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-1">Seus processos</h1>
          <p className="text-white/50 text-sm">Acompanhe o andamento dos seus casos em tempo real.</p>
        </div>

        {processes === null && !error && (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="animate-spin text-[#A89048]" size={28} />
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 flex items-start gap-3">
            <AlertCircle className="text-red-400 mt-0.5" size={18} />
            <div>
              <p className="text-red-400 font-bold text-sm">Não foi possível carregar seus processos</p>
              <p className="text-red-400/70 text-xs mt-1">{error}</p>
            </div>
          </div>
        )}

        {processes && processes.length === 0 && (
          <div className="rounded-xl border border-white/10 bg-[#0d0d14] p-12 text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#A89048]/15 border border-[#A89048]/30 mb-4">
              <Scale className="text-[#A89048]" size={24} />
            </div>
            <h2 className="text-lg font-bold mb-2">Nenhum processo ativo</h2>
            <p className="text-white/50 text-sm">
              Quando seu advogado vincular um processo ao seu cadastro, ele vai aparecer aqui.
            </p>
          </div>
        )}

        {processes && processes.length > 0 && (
          <div className="space-y-3">
            {processes.map(p => (
              <ProcessCard key={p.id} p={p} onClick={() => router.push(`/portal/processos/${p.id}`)} />
            ))}
          </div>
        )}
      </main>
    </>
  );
}

function ProcessCard({ p, onClick }: { p: Process; onClick: () => void }) {
  const stageLabel = p.tracking_stage ? (STAGE_LABELS[p.tracking_stage] || p.tracking_stage) : null;
  const isUrgent = p.priority === 'URGENTE';

  // Próximo evento em destaque (se existir e for nas próximas 2 semanas)
  let urgentEvent: { label: string; date: string; type: string } | null = null;
  if (p.next_event) {
    const evDate = new Date(p.next_event.start_at);
    const daysUntil = (evDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    if (daysUntil <= 14 && daysUntil > -1) {
      const tl = TYPE_LABELS[p.next_event.type] || { label: p.next_event.type, emoji: '📅' };
      urgentEvent = {
        label: tl.label,
        date: formatBrDateTime(p.next_event.start_at),
        type: p.next_event.type,
      };
    }
  }

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl border border-white/10 bg-[#0d0d14] hover:border-[#A89048]/40 hover:bg-[#13131c] p-5 transition-all group"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-bold text-base text-white group-hover:text-[#A89048] transition-colors truncate">
              {p.action_type || p.legal_area || 'Processo Judicial'}
            </h3>
            {isUrgent && (
              <span className="text-[9px] font-bold text-red-400 uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/30 shrink-0">
                Urgente
              </span>
            )}
          </div>
          {p.case_number && (
            <p className="text-xs font-mono text-white/50">{p.case_number}</p>
          )}
        </div>
        <ChevronRight className="text-white/30 group-hover:text-[#A89048] transition-colors shrink-0 mt-0.5" size={18} />
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        {stageLabel && (
          <span className="text-[10px] font-bold text-[#A89048] uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#A89048]/10 border border-[#A89048]/30">
            {stageLabel}
          </span>
        )}
        {p.opposing_party && (
          <span className="text-[10px] text-white/40">
            {p.client_is_author ? '× ' : 'vs '}{p.opposing_party}
          </span>
        )}
      </div>

      {urgentEvent && (
        <div className="flex items-center gap-2 px-3 py-2 mb-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
          <Calendar className="text-amber-400 shrink-0" size={14} />
          <span className="text-xs font-bold text-amber-300">
            {urgentEvent.label}: {urgentEvent.date}
          </span>
        </div>
      )}

      {p.last_update && (
        <div className="flex items-start gap-2 pt-2 border-t border-white/5">
          <Sparkles className="text-violet-400 shrink-0 mt-0.5" size={12} />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-white/70 line-clamp-2">{p.last_update.summary}</p>
            <p className="text-[10px] text-white/40 mt-0.5">{relativeDate(p.last_update.date)}</p>
          </div>
        </div>
      )}
    </button>
  );
}
