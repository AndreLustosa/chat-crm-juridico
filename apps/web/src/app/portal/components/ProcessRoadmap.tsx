'use client';

import { Flag, MailCheck, Shield, Repeat, Microscope, Gavel, FileText, Scale, AlertCircle, CheckCircle2, Wallet, Trophy } from 'lucide-react';

/**
 * Visualizacao "corrida" do processo — mostra em qual checkpoint o caso
 * esta hoje, quais ja foram cumpridos e quais faltam ate a chegada.
 *
 * Inspiracao: gamificacao tipo Duolingo / Strava — torna o juridico mais
 * acessivel pro cliente leigo. Pedido do André em 2026-04-26: "estude uma
 * forma de deixar a analise do processo mais divertida, didatica como se
 * fosse uma corrida, com inicio largada, o trajeto e o fim".
 *
 * Fases canonicas — alinhadas com tracking_stage do banco:
 *   DISTRIBUIDO    -> Largada
 *   CITACAO        -> Citação
 *   CONTESTACAO    -> Defesa
 *   REPLICA        -> Réplica
 *   PERICIA_AGENDADA -> Perícia
 *   INSTRUCAO      -> Audiência
 *   ALEGACOES_FINAIS -> Memoriais
 *   JULGAMENTO     -> Sentença
 *   RECURSO        -> Recurso
 *   TRANSITADO     -> Trânsito
 *   EXECUCAO       -> Execução
 *   ENCERRADO      -> Chegada (Trofeu)
 */

type Stage = {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  description: string;
};

const RACE_STAGES: Stage[] = [
  { key: 'DISTRIBUIDO',      label: 'Largada',     icon: Flag,         description: 'Processo distribuído ao juiz' },
  { key: 'CITACAO',          label: 'Citação',     icon: MailCheck,    description: 'Parte contrária notificada' },
  { key: 'CONTESTACAO',      label: 'Defesa',      icon: Shield,       description: 'Parte contrária se defende' },
  { key: 'REPLICA',          label: 'Réplica',     icon: Repeat,       description: 'Resposta à defesa' },
  { key: 'PERICIA_AGENDADA', label: 'Perícia',     icon: Microscope,   description: 'Exame técnico' },
  { key: 'INSTRUCAO',        label: 'Audiência',   icon: Gavel,        description: 'Depoimentos e provas' },
  { key: 'ALEGACOES_FINAIS', label: 'Memoriais',   icon: FileText,     description: 'Argumentação final' },
  { key: 'JULGAMENTO',       label: 'Sentença',    icon: Scale,        description: 'Decisão do juiz' },
  { key: 'RECURSO',          label: 'Recurso',     icon: AlertCircle,  description: 'Reanálise pelo tribunal' },
  { key: 'TRANSITADO',       label: 'Trânsito',    icon: CheckCircle2, description: 'Decisão definitiva' },
  { key: 'EXECUCAO',         label: 'Execução',    icon: Wallet,       description: 'Recebimento do valor' },
  { key: 'ENCERRADO',        label: 'Chegada',     icon: Trophy,       description: 'Processo concluído' },
];

export function ProcessRoadmap({ currentStage }: { currentStage: string | null }) {
  // Encontra indice da fase atual. Se desconhecida, assume 0 (Largada).
  const currentIdx = currentStage
    ? RACE_STAGES.findIndex(s => s.key === currentStage)
    : 0;
  const idx = currentIdx >= 0 ? currentIdx : 0;
  const totalStages = RACE_STAGES.length;
  const progressPercent = Math.round(((idx + 0.5) / totalStages) * 100);

  return (
    <div className="rounded-2xl border border-[#A89048]/20 bg-gradient-to-br from-[#0d0d14] to-[#13131c] p-5 mb-8">
      {/* Cabecalho */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-[10px] font-bold text-[#A89048] uppercase tracking-wider mb-1">🏁 Trajeto do processo</p>
          <h2 className="text-base font-bold text-white">
            {RACE_STAGES[idx]?.label || 'Em andamento'}
            <span className="text-white/40 font-normal text-sm ml-2">
              · etapa {idx + 1} de {totalStages}
            </span>
          </h2>
          <p className="text-xs text-white/60 mt-0.5">{RACE_STAGES[idx]?.description}</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-[#A89048]">{progressPercent}%</div>
          <div className="text-[10px] text-white/40 uppercase tracking-wider">caminho</div>
        </div>
      </div>

      {/* Barra de progresso com checkpoints */}
      <div className="relative">
        {/* Linha base */}
        <div className="absolute left-0 right-0 top-5 h-1 bg-white/5 rounded-full" />
        {/* Linha de progresso (gradiente ouro) */}
        <div
          className="absolute left-0 top-5 h-1 bg-gradient-to-r from-emerald-400 via-[#A89048] to-[#A89048] rounded-full transition-all duration-700"
          style={{ width: `${progressPercent}%` }}
        />

        {/* Checkpoints — scrollable horizontal em mobile */}
        <div className="relative flex justify-between overflow-x-auto custom-scrollbar pb-2 -mx-2 px-2">
          {RACE_STAGES.map((stage, i) => {
            const status: 'done' | 'current' | 'upcoming' =
              i < idx ? 'done' : i === idx ? 'current' : 'upcoming';
            return <Checkpoint key={stage.key} stage={stage} status={status} />;
          })}
        </div>
      </div>

      {/* Legenda */}
      <div className="flex items-center justify-center gap-4 mt-4 pt-3 border-t border-white/5 text-[10px] text-white/50">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400" /> Concluído
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#A89048] animate-pulse" /> Onde estamos
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-white/20" /> A caminho
        </span>
      </div>
    </div>
  );
}

function Checkpoint({
  stage,
  status,
}: {
  stage: Stage;
  status: 'done' | 'current' | 'upcoming';
}) {
  const Icon = stage.icon;
  const styles = {
    done: {
      bg: 'bg-emerald-500/15 border-emerald-500/40',
      text: 'text-emerald-400',
      label: 'text-emerald-300',
    },
    current: {
      bg: 'bg-[#A89048]/20 border-[#A89048] ring-2 ring-[#A89048]/30 animate-pulse',
      text: 'text-[#A89048]',
      label: 'text-white font-bold',
    },
    upcoming: {
      bg: 'bg-[#13131c] border-white/10',
      text: 'text-white/30',
      label: 'text-white/40',
    },
  }[status];

  return (
    <div className="flex flex-col items-center gap-1.5 min-w-[60px] shrink-0 z-10">
      <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center ${styles.bg} transition-all`}>
        <Icon size={16} className={styles.text} />
      </div>
      <span className={`text-[9px] uppercase tracking-wider text-center leading-tight ${styles.label}`}>
        {stage.label}
      </span>
    </div>
  );
}
