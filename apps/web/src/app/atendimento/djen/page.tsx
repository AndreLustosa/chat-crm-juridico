'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { RouteGuard } from '@/components/RouteGuard';
import {
  Bell, RefreshCw, Archive, ArchiveRestore, CheckCheck, ExternalLink,
  ChevronRight, Loader2, Plus, Link2, CheckCircle2, Eye,
  Gavel, AlertTriangle, Calendar, Sparkles, X, Clock,
  ArrowRight, CheckSquare, AlertCircle, ChevronDown, Microscope,
  Search, User, UserCheck, Scale, Ban, Users, Trash2, Save,
} from 'lucide-react';
import api from '@/lib/api';
import { useRole } from '@/lib/useRole';
import { PhoneInput } from '@/components/PhoneInput';

// ─── Types ────────────────────────────────────────────────────

interface DjenPublication {
  id: string;
  comunicacao_id: number;
  data_disponibilizacao: string;
  numero_processo: string;
  classe_processual: string | null;
  assunto: string | null;
  tipo_comunicacao: string | null;
  conteudo: string;
  nome_advogado: string | null;
  legal_case_id: string | null;
  viewed_at: string | null;
  archived: boolean;
  ignored: boolean;
  auto_task_id: string | null;
  legal_case?: {
    id: string;
    case_number: string | null;
    legal_area: string | null;
    tracking_stage: string | null;
    renounced: boolean;
    lead: { name: string | null };
  } | null;
  created_at: string;
}

interface AiEvento {
  tipo: 'AUDIENCIA' | 'PRAZO' | 'PERICIA';
  titulo: string;        // curto e especifico (ex: "Citacao por edital - 20 dias")
  descricao: string;     // detalhada com instrucoes praticas
  data: string | null;   // ISO naive BRT — null se prazo relativo
  prazo_dias: number | null;
  condicao: string | null; // ex: "apos publicacao do edital" — pra prazos encadeados
}

interface AiAnalysis {
  resumo: string;
  urgencia: 'URGENTE' | 'NORMAL' | 'BAIXA';
  tipo_acao: string;
  prazo_dias: number;
  estagio_sugerido: string | null;
  tarefa_titulo: string;
  tarefa_descricao: string;
  orientacoes: string;
  model_used?: string;
  // event_type — usado pra decidir se o "evento sugerido" eh AUDIENCIA,
  // PRAZO, PERICIA ou TAREFA. Adicionado 2026-04-24 (fix de classificacao no UI).
  // PERICIA adicionada 2026-04-26 — regra: processo vinculado nunca eh TAREFA.
  // Mantido pra retrocompat — eventos[] eh a fonte canonica desde 2026-04-26.
  event_type?: 'AUDIENCIA' | 'PRAZO' | 'PERICIA' | 'TAREFA';
  // eventos[] — lista TODOS os prazos/audiencias da publicacao (multiplos
  // prazos encadeados como edital + impugnacao viram itens separados).
  // Adicionado 2026-04-26. Backend faz retrocompat: deriva 1 item dos campos
  // legados se IA nao retornar array.
  eventos?: AiEvento[];
  // Dados extraídos da publicação
  parte_autora?: string | null;
  parte_rea?: string | null;
  juizo?: string | null;
  area_juridica?: string | null;
  valor_causa?: string | null;
  data_audiencia?: string | null;
  data_prazo?: string | null;
}

interface Lead {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  profile_picture_url?: string | null;
  conversations?: {
    legal_area: string | null;
    assigned_lawyer?: { id: string; name: string | null } | null;
  }[];
}

// ─── Helpers ──────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

const TIPO_COLORS: Record<string, { bg: string; text: string }> = {
  'Intimação':        { bg: 'bg-blue-500/10',    text: 'text-blue-400' },
  'Citação':          { bg: 'bg-red-500/10',      text: 'text-red-400' },
  'Sentença':         { bg: 'bg-purple-500/10',   text: 'text-purple-400' },
  'Despacho':         { bg: 'bg-sky-500/10',      text: 'text-sky-400' },
  'Acórdão':          { bg: 'bg-violet-500/10',   text: 'text-violet-400' },
  'Lista de distribuição': { bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
};

function getTipoColor(tipo: string | null) {
  if (!tipo) return { bg: 'bg-muted/50', text: 'text-muted-foreground' };
  for (const key of Object.keys(TIPO_COLORS)) {
    if (tipo.toLowerCase().includes(key.toLowerCase())) return TIPO_COLORS[key];
  }
  return { bg: 'bg-slate-500/10', text: 'text-slate-400' };
}

const URGENCIA_CONFIG = {
  URGENTE: { label: 'URGENTE', bg: 'bg-red-500/10',   text: 'text-red-400',   border: 'border-red-500/30',   icon: AlertCircle },
  NORMAL:  { label: 'NORMAL',  bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/30', icon: Clock },
  BAIXA:   { label: 'BAIXA',   bg: 'bg-gray-500/10',  text: 'text-gray-400',  border: 'border-gray-500/30',  icon: CheckCircle2 },
};

const STAGE_LABELS: Record<string, string> = {
  DISTRIBUIDO: 'Distribuído', CITACAO: 'Citação/Intimação', CONTESTACAO: 'Contestação',
  REPLICA: 'Réplica', PERICIA_AGENDADA: 'Perícia Agendada', INSTRUCAO: 'Audiência/Instrução',
  ALEGACOES_FINAIS: 'Alegações Finais', AGUARDANDO_SENTENCA: 'Aguardando Sentença',
  JULGAMENTO: 'Julgamento', RECURSO: 'Recurso', TRANSITADO: 'Transitado em Julgado',
  EXECUCAO: 'Execução', ENCERRADO: 'Encerrado',
};

const TRACKING_STAGES_DJEN = [
  { id: 'DISTRIBUIDO',      label: 'Distribuído',           color: '#6366f1', emoji: '📬' },
  { id: 'CITACAO',          label: 'Citação/Intimação',     color: '#f59e0b', emoji: '📨' },
  { id: 'CONTESTACAO',      label: 'Contestação',           color: '#ef4444', emoji: '⚔️' },
  { id: 'REPLICA',          label: 'Réplica',               color: '#06b6d4', emoji: '↩️' },
  { id: 'PERICIA_AGENDADA', label: 'Perícia Agendada',      color: '#0ea5e9', emoji: '🔬' },
  { id: 'INSTRUCAO',           label: 'Audiência/Instrução',   color: '#8b5cf6', emoji: '🎙️' },
  { id: 'ALEGACOES_FINAIS',    label: 'Alegações Finais',      color: '#7c3aed', emoji: '✍️' },
  { id: 'AGUARDANDO_SENTENCA', label: 'Aguardando Sentença',   color: '#9333ea', emoji: '⏳' },
  { id: 'JULGAMENTO',          label: 'Julgamento/Sentença',   color: '#8b5cf6', emoji: '⚖️' },
  { id: 'RECURSO',          label: 'Recurso',               color: '#ec4899', emoji: '📤' },
  { id: 'TRANSITADO',       label: 'Trânsito em Julgado',   color: '#10b981', emoji: '✅' },
  { id: 'EXECUCAO',         label: 'Execução',              color: '#f97316', emoji: '⚡' },
  { id: 'ENCERRADO',        label: 'Encerrado',             color: '#6b7280', emoji: '🏁' },
] as const;

// ─── Helper: parse de ISO naive da IA como UTC-naive-BRT ─────────────────────
//
// Bug reportado 2026-04-26: IA retorna `data_audiencia` como "YYYY-MM-DDTHH:MM:00"
// (sem Z, sem offset). `new Date(s)` interpreta isso como hora LOCAL do navegador,
// converte pra UTC somando 3h em BRT, e ao formatar com `timeZone: 'UTC'` mostra
// 11:30 quando o real eh 08:30.
//
// Convencao do app: `start_at` no banco eh UTC-naive-BRT (08:30 BRT armazenado
// como "2026-05-21T08:30:00.000Z"). Adicionar `Z` na string da IA alinha as
// duas convencoes — JS interpreta como UTC, e formatacao com `timeZone: 'UTC'`
// preserva o wall-clock BRT em qualquer fuso de navegador.
function parseNaiveBrIso(s: string): Date {
  // Ja tem Z ou offset explicito? Respeita.
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s);
  return new Date(s + 'Z');
}

// ─── Helper: subtrai 1 dia util (regra de seguranca pra PRAZOS) ──────────────
//
// Regra de negocio (André, 2026-04-26): "quando o prazo for em dias uteis
// preciso que a IA sempre agende com um dia util de antecedencia do final do
// prazo para prevenir perda de prazo".
//
// Aplicado APENAS pra PRAZO (audiencia/pericia tem data fixa do juiz, nao da
// pra antecipar). Pula sabado/domingo. NAO considera feriados — sistema nao
// tem calendario de feriados; operador deve revisar prazos em vesperas.
//
// Se o resultado cair antes de "agora", retorna o original (sem margem) — nao
// faz sentido agendar no passado. Operador ainda ve a sugestao da IA pra
// decidir manual.
function subtractOneBusinessDay(d: Date): Date {
  const result = new Date(d.getTime());
  // Volta 1 dia, depois pula sabado/domingo se cair em FdS.
  result.setUTCDate(result.getUTCDate() - 1);
  while (result.getUTCDay() === 0 || result.getUTCDay() === 6) {
    result.setUTCDate(result.getUTCDate() - 1);
  }
  // Se cair no passado, retorna o original (sem margem).
  if (result.getTime() < Date.now()) return d;
  return result;
}

// ─── Helper: resolve config de UM evento individual da IA ────────────────────
//
// Adicionado 2026-04-26 — IA agora retorna lista de eventos (eventos[]). Cada
// item passa por aqui pra virar config renderizavel. Antes o resolveEventType
// trabalhava so com o evento "principal" da publicacao.
type EventoConfig = {
  type: 'TAREFA' | 'AUDIENCIA' | 'PRAZO' | 'PERICIA';
  label: string;
  buttonLabel: string;
  buttonIcon: 'task' | 'audience' | 'deadline' | 'pericia';
  dueDate: Date;        // Data efetivamente AGENDADA (com margem de -1 dia util pra PRAZO)
  deadlineEnd?: Date;   // Final REAL do prazo (usado so pra exibir "ultimo dia" no UI)
  titulo: string;       // titulo especifico do evento (de eventos[].titulo ou tarefa_titulo)
  descricao: string;    // descricao detalhada do evento
  condicao: string | null; // ex: "apos publicacao do edital" pra prazos encadeados
};

function fallbackDueFrom(prazoDias: number): Date {
  const now = new Date();
  const due = new Date(Date.UTC(
    now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0, 0,
  ));
  const minDays = Math.max(1, prazoDias || 1);
  let added = 0;
  while (added < minDays) {
    due.setUTCDate(due.getUTCDate() + 1);
    const dow = due.getUTCDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return due;
}

function resolveEventoConfig(ev: AiEvento): EventoConfig {
  if (ev.tipo === 'AUDIENCIA' && ev.data) {
    return {
      type: 'AUDIENCIA',
      label: 'Audiência sugerida',
      buttonLabel: 'Agendar audiência',
      buttonIcon: 'audience',
      dueDate: parseNaiveBrIso(ev.data),
      titulo: ev.titulo,
      descricao: ev.descricao,
      condicao: ev.condicao,
    };
  }
  if (ev.tipo === 'PERICIA' && ev.data) {
    return {
      type: 'PERICIA',
      label: 'Perícia sugerida',
      buttonLabel: 'Agendar perícia',
      buttonIcon: 'pericia',
      dueDate: parseNaiveBrIso(ev.data),
      titulo: ev.titulo,
      descricao: ev.descricao,
      condicao: ev.condicao,
    };
  }
  // PRAZO (com data ou prazo_dias). Aplica margem de -1 dia util.
  const deadlineEnd = ev.data ? parseNaiveBrIso(ev.data) : fallbackDueFrom(ev.prazo_dias || 15);
  return {
    type: 'PRAZO',
    label: 'Prazo sugerido',
    buttonLabel: 'Criar prazo',
    buttonIcon: 'deadline',
    dueDate: subtractOneBusinessDay(deadlineEnd),
    deadlineEnd,
    titulo: ev.titulo,
    descricao: ev.descricao,
    condicao: ev.condicao,
  };
}

// ─── Helper legado: resolve config a partir do event_type principal ──────────
//
// Mantido pra retrocompat com componentes que ainda usam o formato antigo
// (TaskSuggestion no modal, por ex). Internamente delega pro novo helper.
//
// Bug reportado 2026-04-24: o frontend criava sempre "TAREFA" hardcoded mesmo
// quando a IA detectava AUDIENCIA ou PRAZO no event_type. Agora respeita.
function resolveEventTypeConfig(analysis: AiAnalysis): EventoConfig {
  const eventType = analysis.event_type || 'TAREFA';

  // Calcula data_padrao = hoje + prazo_dias uteis (fallback).
  //
  // Bug confirmado em prod 2026-04-26 (TAREFA db0b23bb): se prazo_dias=0,
  // due = new Date() = exato instante do clique → start_at fica com timestamp
  // arbitrario tipo 02:39:04.258 UTC (created_at copiado).
  //
  // Fix: minimo de 1 dia util (nao faz sentido tarefa pra "agora") + hora
  // padrao 09:00 BRT. Construido em UTC pra alinhar com convencao UTC-naive-BRT
  // do banco — toISOString gera "T09:00:00.000Z" e display com timeZone:'UTC'
  // mostra 09:00. setHours local nao serve: em BRT geraria 12:00 UTC.
  const fallbackDue = (() => {
    const now = new Date();
    // Comeca em "hoje 09:00 BRT" (UTC naive) — base para somar dias uteis
    const due = new Date(Date.UTC(
      now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0, 0,
    ));
    const minDays = Math.max(1, analysis.prazo_dias || 1);
    let added = 0;
    while (added < minDays) {
      due.setUTCDate(due.getUTCDate() + 1);
      const dow = due.getUTCDay();
      if (dow !== 0 && dow !== 6) added++;
    }
    return due;
  })();

  // Reusa o helper novo se ja temos um item canonico — apenas TAREFA/legado
  // continuam usando os campos `tarefa_titulo`/`tarefa_descricao`.
  if (eventType !== 'TAREFA' && (analysis.data_audiencia || analysis.data_prazo)) {
    const fakeEv: AiEvento = {
      tipo: eventType as 'AUDIENCIA' | 'PRAZO' | 'PERICIA',
      titulo: analysis.tarefa_titulo,
      descricao: analysis.tarefa_descricao || analysis.tarefa_titulo,
      data: (eventType === 'AUDIENCIA' || eventType === 'PERICIA')
        ? (analysis.data_audiencia || null)
        : (analysis.data_prazo || null),
      prazo_dias: analysis.prazo_dias,
      condicao: null,
    };
    return resolveEventoConfig(fakeEv);
  }
  if (eventType === 'PRAZO') {
    // PRAZO sem data: usa fallbackDue + margem.
    const fakeEv: AiEvento = {
      tipo: 'PRAZO',
      titulo: analysis.tarefa_titulo,
      descricao: analysis.tarefa_descricao || analysis.tarefa_titulo,
      data: null,
      prazo_dias: analysis.prazo_dias,
      condicao: null,
    };
    return resolveEventoConfig(fakeEv);
  }
  // Fallback: TAREFA (sem processo — captura de lead).
  return {
    type: 'TAREFA',
    label: 'Tarefa sugerida',
    buttonLabel: 'Criar tarefa',
    buttonIcon: 'task',
    dueDate: fallbackDue,
    titulo: analysis.tarefa_titulo,
    descricao: analysis.tarefa_descricao || analysis.tarefa_titulo,
    condicao: null,
  };
}

// ─── Helper: deriva lista canonica de eventos da analise ────────────────────
//
// Frontend trabalha sempre com eventos[]. Se IA antiga (cache pre-2026-04-26)
// nao tem o array, deriva 1 item dos campos legados. TAREFA nao gera item —
// fica vazio (operador agenda manual).
function getAnalysisEventos(analysis: AiAnalysis): AiEvento[] {
  if (Array.isArray(analysis.eventos) && analysis.eventos.length) {
    return analysis.eventos;
  }
  if (analysis.event_type && analysis.event_type !== 'TAREFA') {
    const t = analysis.event_type;
    return [{
      tipo: t,
      titulo: analysis.tarefa_titulo,
      descricao: analysis.tarefa_descricao || analysis.tarefa_titulo,
      data: (t === 'AUDIENCIA' || t === 'PERICIA')
        ? (analysis.data_audiencia || null)
        : (analysis.data_prazo || null),
      prazo_dias: analysis.prazo_dias || null,
      condicao: null,
    }];
  }
  return [];
}

// ─── Labels do event_type pra exibicao no UI ─────────────────────────────────
//
// Cada tipo tem 4 variantes pra cobrir contextos diferentes do display.
// Antes os ternarios ficavam espalhados em 7 lugares. Aqui centraliza pra
// nao esquecer de cobrir PERICIA quando adicionar novo lugar.
const EVENT_TYPE_LABELS: Record<'AUDIENCIA' | 'PRAZO' | 'PERICIA' | 'TAREFA', {
  noun: string;       // "Audiência", "Prazo", "Perícia", "Tarefa"
  nounLow: string;    // "audiência", "prazo", "perícia", "tarefa"
  done: string;       // "Audiência agendada!", "Prazo criado!", "Perícia agendada!", "Tarefa criada!"
  emoji: string;      // "⚖️", "⏰", "🔬", "✅"
  hasExplicitDate: boolean;  // true para AUDIENCIA/PRAZO/PERICIA — mostra cfg.dueDate; false para TAREFA — mostra prazo_dias
}> = {
  AUDIENCIA: { noun: 'Audiência', nounLow: 'audiência', done: 'Audiência agendada!', emoji: '⚖️', hasExplicitDate: true },
  PRAZO:     { noun: 'Prazo',     nounLow: 'prazo',     done: 'Prazo criado!',       emoji: '⏰', hasExplicitDate: true },
  PERICIA:   { noun: 'Perícia',   nounLow: 'perícia',   done: 'Perícia agendada!',   emoji: '🔬', hasExplicitDate: true },
  TAREFA:    { noun: 'Tarefa',    nounLow: 'tarefa',    done: 'Tarefa criada!',      emoji: '✅', hasExplicitDate: false },
};

// ─── TaskSuggestion (sub-componente usado dentro do modal) ────

function TaskSuggestion({ analysis, pubId }: { analysis: AiAnalysis; pubId: string }) {
  const [creating, setCreating] = useState(false);
  const [done, setDone] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [err, setErr] = useState(false);

  if (skipped) return null;

  const createTask = async () => {
    setCreating(true);
    setErr(false);
    try {
      const cfg = resolveEventTypeConfig(analysis);
      // Audiencia tipicamente dura 1h; prazo eh marco no dia (30min); tarefa 30min.
      // Audiencia/pericia tipicamente duram 1h; prazo eh marco no dia (30min); tarefa 30min.
      const durationMs = (cfg.type === 'AUDIENCIA' || cfg.type === 'PERICIA') ? 60 * 60_000 : 30 * 60_000;
      await api.post('/calendar/events', {
        type: cfg.type,
        title: `[DJEN] ${analysis.tarefa_titulo}`,
        description: analysis.tarefa_descricao,
        start_at: cfg.dueDate.toISOString(),
        end_at: new Date(cfg.dueDate.getTime() + durationMs).toISOString(),
        priority: analysis.urgencia,
      });
      setDone(true);
    } catch { setErr(true); }
    finally { setCreating(false); }
  };

  const cfg = resolveEventTypeConfig(analysis);

  return (
    <div className={`rounded-xl border p-3 space-y-2 ${
      done ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-border bg-card/60'
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
            {cfg.buttonIcon === 'audience' ? <Calendar size={9} /> : cfg.buttonIcon === 'deadline' ? <Clock size={9} /> : cfg.buttonIcon === 'pericia' ? <Microscope size={9} /> : <CheckSquare size={9} />}
            {cfg.label} pela IA
          </p>
          <p className="text-[12px] font-semibold text-foreground truncate">{analysis.tarefa_titulo}</p>
          {analysis.tarefa_descricao && (
            <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{analysis.tarefa_descricao}</p>
          )}
          <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
            <Clock size={9} />
            {EVENT_TYPE_LABELS[cfg.type].hasExplicitDate
              ? cfg.dueDate.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
              : `Prazo: ${analysis.prazo_dias} dias úteis`}
          </p>
        </div>
      </div>

      {done ? (
        <p className="text-[11px] text-emerald-400 flex items-center gap-1">
          <CheckCircle2 size={11} />
          {EVENT_TYPE_LABELS[cfg.type].done}
        </p>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={createTask}
            disabled={creating}
            className="flex-1 flex items-center justify-center gap-1 text-[11px] font-semibold py-1.5 rounded-lg bg-primary/10 border border-primary/30 text-primary hover:bg-primary/15 transition-colors disabled:opacity-50"
          >
            {creating ? <Loader2 size={10} className="animate-spin" /> : (cfg.buttonIcon === 'audience' ? <Calendar size={10} /> : cfg.buttonIcon === 'deadline' ? <Clock size={10} /> : cfg.buttonIcon === 'pericia' ? <Microscope size={10} /> : <CheckSquare size={10} />)}
            {creating ? 'Criando…' : cfg.buttonLabel}
          </button>
          <button
            onClick={() => setSkipped(true)}
            className="px-3 text-[11px] font-semibold text-muted-foreground hover:text-foreground py-1.5 rounded-lg border border-border hover:bg-accent transition-colors"
            title="Pular sugestão"
          >
            <X size={11} />
          </button>
        </div>
      )}
      {err && <p className="text-[10px] text-red-400">Erro ao criar. Tente novamente.</p>}
    </div>
  );
}

// ─── Helper: normaliza área jurídica livre → enum ─────────────
function normalizeArea(raw: string): string {
  const s = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/trabalhist/.test(s)) return 'TRABALHISTA';
  if (/previd|inss/.test(s)) return 'PREVIDENCIARIO';
  if (/tribut|fiscal/.test(s)) return 'TRIBUTARIO';
  if (/famil|divorcio/.test(s)) return 'FAMILIA';
  if (/crimin/.test(s)) return 'CRIMINAL';
  if (/consumi/.test(s)) return 'CONSUMIDOR';
  if (/empresar/.test(s)) return 'EMPRESARIAL';
  if (/administrat/.test(s)) return 'ADMINISTRATIVO';
  if (/civil|civel/.test(s)) return 'CIVIL';
  // se já vier no formato enum, retorna como está (maiúsculo)
  const upper = raw.trim().toUpperCase();
  const known = ['CIVIL','TRABALHISTA','PREVIDENCIARIO','TRIBUTARIO','FAMILIA','CRIMINAL','CONSUMIDOR','EMPRESARIAL','ADMINISTRATIVO'];
  return known.includes(upper) ? upper : '';
}

// ─── Modal: Criar Processo ────────────────────────────────────

function CreateProcessModal({
  pub,
  preloadedAnalysis,
  onClose,
  onSuccess,
}: {
  pub: DjenPublication;
  preloadedAnalysis?: AiAnalysis | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const router = useRouter();
  const { isAdmin } = useRole();

  // Modo do cliente: buscar existente ou cadastrar novo
  const [clientMode, setClientMode] = useState<'search' | 'new'>('search');

  // Busca de cliente existente
  const [leadSearch, setLeadSearch] = useState('');
  const [leadResults, setLeadResults] = useState<Lead[]>([]);
  const [searchingLead, setSearchingLead] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [showLeadDropdown, setShowLeadDropdown] = useState(false);
  const leadDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leadInputRef = useRef<HTMLInputElement>(null);

  // Dados de novo cliente
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');

  // AI analysis
  const [analysis, setAnalysis] = useState<AiAnalysis | null>(preloadedAnalysis || null);
  const [analyzingAi, setAnalyzingAi] = useState(!preloadedAnalysis);
  const [aiError, setAiError] = useState(false);

  // Kanban stage
  const [selectedStage, setSelectedStage] = useState<string>(
    preloadedAnalysis?.estagio_sugerido || 'DISTRIBUIDO'
  );

  // Área jurídica extraída pela IA
  const [legalArea, setLegalArea] = useState<string>(
    preloadedAnalysis?.area_juridica ? normalizeArea(preloadedAnalysis.area_juridica) : ''
  );

  // Advogado (ADMIN only)
  const [lawyers, setLawyers] = useState<{ id: string; name: string | null }[]>([]);
  const [selectedLawyerId, setSelectedLawyerId] = useState('');

  // Sugestões automáticas de leads por correspondência de partes
  const [suggestedLeads, setSuggestedLeads] = useState<{
    autora: { id: string; name: string; phone: string; is_client: boolean; score: number }[];
    rea: { id: string; name: string; phone: string; is_client: boolean; score: number }[];
    parte_autora: string | null;
    parte_rea: string | null;
  } | null>(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [dismissedSuggestions, setDismissedSuggestions] = useState(false);

  // Submitting
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Validação: cliente é obrigatório
  const hasValidClient =
    clientMode === 'search'
      ? selectedLead !== null
      : newName.trim().length > 0 && newPhone.trim().length > 0;

  // Carrega lista de advogados (ADMIN only)
  useEffect(() => {
    if (!isAdmin) return;
    api.get('/users/lawyers').then(res => setLawyers(res.data || [])).catch(() => {});
  }, [isAdmin]);

  // Auto-analyze se não tiver preloadedAnalysis
  useEffect(() => {
    if (preloadedAnalysis) return;
    let cancelled = false;
    setAnalyzingAi(true);
    api.post(`/djen/${pub.id}/analyze`)
      .then(res => {
        if (cancelled) return;
        const data: AiAnalysis = res.data;
        setAnalysis(data);
        if (data.estagio_sugerido) setSelectedStage(data.estagio_sugerido);
        if (data.area_juridica) setLegalArea(normalizeArea(data.area_juridica));
      })
      .catch(() => { if (!cancelled) setAiError(true); })
      .finally(() => { if (!cancelled) setAnalyzingAi(false); });
    return () => { cancelled = true; };
  }, [pub.id, preloadedAnalysis]);

  // Buscar sugestões de leads quando análise terminar (ou pub já tiver partes)
  useEffect(() => {
    if (selectedLead || dismissedSuggestions) return;
    let cancelled = false;
    setLoadingSuggestions(true);
    api.get(`/djen/${pub.id}/suggest-leads`)
      .then(res => {
        if (cancelled) return;
        const data = res.data;
        if ((data.autora?.length > 0 || data.rea?.length > 0)) {
          setSuggestedLeads(data);
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingSuggestions(false); });
    return () => { cancelled = true; };
  }, [pub.id, analysis, selectedLead, dismissedSuggestions]);

  // Debounce lead search
  useEffect(() => {
    if (clientMode !== 'search') return;
    if (leadDebounce.current) clearTimeout(leadDebounce.current);
    if (!leadSearch.trim()) { setLeadResults([]); setShowLeadDropdown(false); return; }
    leadDebounce.current = setTimeout(async () => {
      setSearchingLead(true);
      try {
        const res = await api.get('/leads', { params: { search: leadSearch.trim(), limit: 6 } });
        const items: Lead[] = Array.isArray(res.data) ? res.data : (res.data?.items || res.data?.data || []);
        setLeadResults(items);
        setShowLeadDropdown(items.length > 0);
      } catch { setLeadResults([]); }
      finally { setSearchingLead(false); }
    }, 300);
  }, [leadSearch, clientMode]);

  const selectLead = (lead: Lead) => {
    setSelectedLead(lead);
    setLeadSearch(lead.name);
    setShowLeadDropdown(false);
    setLeadResults([]);

    // Aproveita dados da última conversa do lead ──────────────
    const conv = lead.conversations?.[0];
    // Área jurídica: só preenche se ainda não identificada pela IA da publicação
    if (conv?.legal_area && !legalArea) {
      setLegalArea(normalizeArea(conv.legal_area));
    }
    // Advogado: pré-seleciona o advogado atribuído na conversa (ADMIN pode mudar)
    if (isAdmin && conv?.assigned_lawyer?.id && !selectedLawyerId) {
      setSelectedLawyerId(conv.assigned_lawyer.id);
    }
  };

  const clearLead = () => {
    setSelectedLead(null);
    setLeadSearch('');
    setLeadResults([]);
    setShowLeadDropdown(false);
    // Reseta para valores da IA (ou vazio se IA também não identificou)
    setLegalArea(analysis?.area_juridica ? normalizeArea(analysis.area_juridica) : '');
    setSelectedLawyerId('');
    setTimeout(() => leadInputRef.current?.focus(), 50);
  };

  const switchMode = (mode: 'search' | 'new') => {
    setClientMode(mode);
    setSelectedLead(null);
    setLeadSearch('');
    setLeadResults([]);
    setShowLeadDropdown(false);
    setNewName('');
    setNewPhone('');
    setSubmitError(null);
  };

  const handleSubmit = async () => {
    if (!hasValidClient) {
      setSubmitError('Informe o cliente para continuar.');
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await api.post(`/djen/${pub.id}/create-process`, {
        leadId: clientMode === 'search' ? selectedLead?.id : undefined,
        leadName: clientMode === 'new' ? newName.trim() : undefined,
        leadPhone: clientMode === 'new' ? newPhone.trim() : undefined,
        trackingStage: selectedStage,
        legalArea: legalArea.trim() || undefined,
        lawyerId: isAdmin && selectedLawyerId ? selectedLawyerId : undefined,
      });
      onSuccess();
      const caseId = res?.data?.id;
      router.push(caseId ? `/atendimento/processos?openCase=${caseId}` : '/atendimento/processos');
    } catch (e: any) {
      setSubmitError(e?.response?.data?.message || 'Erro ao criar processo. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  };

  const urgConf = analysis ? URGENCIA_CONFIG[analysis.urgencia] : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center shrink-0">
            <Gavel size={15} className="text-emerald-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-bold text-foreground">Criar Processo</p>
            <p className="text-[11px] text-muted-foreground font-mono truncate">{pub.numero_processo}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <X size={14} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4 space-y-5">

          {/* Publicação info */}
          <div className="rounded-xl bg-accent/30 border border-border p-3 space-y-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Calendar size={9} /> {formatDate(pub.data_disponibilizacao)}
              </span>
              {pub.tipo_comunicacao && (
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${getTipoColor(pub.tipo_comunicacao).bg} ${getTipoColor(pub.tipo_comunicacao).text}`}>
                  {pub.tipo_comunicacao}
                </span>
              )}
            </div>
            {pub.assunto && (
              <p className="text-[11px] text-foreground/80 line-clamp-2">{pub.assunto}</p>
            )}
          </div>

          {/* ── Cliente (obrigatório) ─────────────────────────────── */}
          <div>
            {/* Label + toggle de modo */}
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <User size={11} />
                Cliente
                <span className="text-red-400">*</span>
              </label>
              <div className="flex rounded-lg border border-border overflow-hidden text-[10px] font-semibold">
                <button
                  onClick={() => switchMode('search')}
                  className={`px-2.5 py-1 transition-colors ${clientMode === 'search' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
                >
                  <Search size={10} className="inline mr-1" />
                  Buscar existente
                </button>
                <button
                  onClick={() => switchMode('new')}
                  className={`px-2.5 py-1 transition-colors border-l border-border ${clientMode === 'new' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
                >
                  <Plus size={10} className="inline mr-1" />
                  Novo cliente
                </button>
              </div>
            </div>

            {/* Sugestões automáticas de leads por partes da publicação */}
            {clientMode === 'search' && !selectedLead && !dismissedSuggestions && suggestedLeads && (suggestedLeads.autora.length > 0 || suggestedLeads.rea.length > 0) && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-2 mb-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Sparkles size={10} /> Sugestões da IA — confira antes de selecionar
                  </p>
                  <button
                    onClick={() => setDismissedSuggestions(true)}
                    className="text-[9px] text-muted-foreground hover:text-foreground transition-colors px-2 py-0.5 rounded border border-border hover:bg-accent"
                  >
                    Ignorar
                  </button>
                </div>
                <p className="text-[10px] text-amber-300/80">
                  A IA identificou nomes na publicação. Verifique se correspondem ao cliente correto antes de selecionar.
                </p>
                {suggestedLeads.autora.length > 0 && (
                  <div>
                    {suggestedLeads.parte_autora && (
                      <p className="text-[9px] text-muted-foreground mb-1">Nome na publicação (autora): <span className="text-foreground/70 font-medium">{suggestedLeads.parte_autora}</span></p>
                    )}
                    {suggestedLeads.autora.map(lead => (
                      <div key={lead.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border/50 bg-background/50">
                        <div className="w-7 h-7 rounded-full bg-violet-500/20 border border-violet-500/30 flex items-center justify-center shrink-0">
                          <User size={11} className="text-violet-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-semibold text-foreground">{lead.name}</p>
                          <p className="text-[10px] text-muted-foreground font-mono">{lead.phone}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {lead.is_client && (
                            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">CLIENTE</span>
                          )}
                          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400">AUTORA</span>
                        </div>
                        <button
                          onClick={() => { setLeadSearch(lead.name); setDismissedSuggestions(true); }}
                          className="px-2.5 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[10px] font-bold transition-colors shrink-0"
                        >
                          Buscar
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {suggestedLeads.rea.length > 0 && (
                  <div>
                    {suggestedLeads.parte_rea && (
                      <p className="text-[9px] text-muted-foreground mb-1">Nome na publicação (ré): <span className="text-foreground/70 font-medium">{suggestedLeads.parte_rea}</span></p>
                    )}
                    {suggestedLeads.rea.map(lead => (
                      <div key={lead.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border/50 bg-background/50">
                        <div className="w-7 h-7 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center shrink-0">
                          <User size={11} className="text-amber-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-semibold text-foreground">{lead.name}</p>
                          <p className="text-[10px] text-muted-foreground font-mono">{lead.phone}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {lead.is_client && (
                            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">CLIENTE</span>
                          )}
                          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">RÉ</span>
                        </div>
                        <button
                          onClick={() => { setLeadSearch(lead.name); setDismissedSuggestions(true); }}
                          className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-bold transition-colors shrink-0"
                        >
                          Buscar
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {clientMode === 'search' && !selectedLead && loadingSuggestions && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-500/5 border border-violet-500/20 mb-2">
                <div className="w-3.5 h-3.5 rounded-full border-2 border-violet-500/30 border-t-violet-500 animate-spin shrink-0" />
                <p className="text-[10px] text-violet-300">Buscando correspondências…</p>
              </div>
            )}

            {/* Modo: busca de existente */}
            {clientMode === 'search' && (
              <div className="relative">
                {selectedLead ? (
                  /* Cliente selecionado — card destacado */
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl border-2 border-emerald-500/50 bg-emerald-500/5">
                    <div className="w-10 h-10 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0 overflow-hidden">
                      {selectedLead.profile_picture_url
                        ? <img src={selectedLead.profile_picture_url} alt="" className="w-full h-full object-cover" />
                        : <UserCheck size={18} className="text-emerald-400" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-bold text-foreground">{selectedLead.name || 'Sem nome'}</p>
                      <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{selectedLead.phone}</p>
                    </div>
                    <button
                      onClick={clearLead}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
                      title="Trocar cliente"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  /* Campo de busca */
                  <>
                    <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border bg-background">
                      {searchingLead
                        ? <Loader2 size={13} className="text-muted-foreground shrink-0 animate-spin" />
                        : <Search size={13} className="text-muted-foreground shrink-0" />
                      }
                      <input
                        ref={leadInputRef}
                        type="text"
                        value={leadSearch}
                        onChange={e => setLeadSearch(e.target.value)}
                        onFocus={() => leadResults.length > 0 && setShowLeadDropdown(true)}
                        placeholder="Digite o nome ou telefone do cliente…"
                        className="flex-1 bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground outline-none"
                      />
                    </div>
                    {showLeadDropdown && leadResults.length > 0 && (
                      <div className="absolute top-full mt-1 left-0 right-0 z-20 bg-card border border-border rounded-xl shadow-xl overflow-hidden">
                        {leadResults.map(lead => (
                          <button
                            key={lead.id}
                            onClick={() => selectLead(lead)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-accent transition-colors text-left"
                          >
                            <div className="w-7 h-7 rounded-full bg-accent border border-border flex items-center justify-center shrink-0 overflow-hidden">
                              {lead.profile_picture_url
                                ? <img src={lead.profile_picture_url} alt="" className="w-full h-full object-cover" />
                                : <User size={12} className="text-muted-foreground" />
                              }
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-semibold text-foreground">{lead.name}</p>
                              <p className="text-[10px] text-muted-foreground font-mono">{lead.phone}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {!leadSearch && (
                      <p className="text-[10px] text-muted-foreground mt-1.5">
                        Busque pelo nome ou número de telefone do cliente cadastrado.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Modo: cadastrar novo */}
            {clientMode === 'new' && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border bg-background">
                  <User size={13} className="text-muted-foreground shrink-0" />
                  <input
                    type="text"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    placeholder="Nome completo do cliente *"
                    className="flex-1 bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground outline-none"
                    autoFocus
                  />
                </div>
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border bg-background">
                  <Search size={13} className="text-muted-foreground shrink-0" />
                  <PhoneInput
                    value={newPhone}
                    onChange={setNewPhone}
                    placeholder="Telefone com DDD (ex: 82 99999-9999) *"
                    className="flex-1 bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground outline-none"
                  />
                </div>
                <p className="text-[10px] text-muted-foreground">
                  O cliente será cadastrado e vinculado ao processo automaticamente.
                </p>
              </div>
            )}
          </div>

          {/* ── Advogado Responsável (ADMIN only) ─────────────────── */}
          {isAdmin && lawyers.length > 0 && (
            <div>
              <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                👨‍⚖️ Advogado Responsável
              </label>
              {selectedLead?.conversations?.[0]?.assigned_lawyer && (
                <p className="text-[10px] text-emerald-400 mb-2 flex items-center gap-1">
                  <UserCheck size={9} /> Do atendimento: <strong>{selectedLead.conversations[0].assigned_lawyer.name}</strong>
                </p>
              )}
              <select
                value={selectedLawyerId}
                onChange={e => setSelectedLawyerId(e.target.value)}
                className="w-full text-[12px] bg-accent/40 border border-border rounded-xl px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="">Atribuir automaticamente (padrão)</option>
                {lawyers.map(l => (
                  <option key={l.id} value={l.id}>{l.name || l.id}</option>
                ))}
              </select>
              <p className="text-[10px] text-muted-foreground mt-1.5">
                Se não selecionado, o processo será atribuído ao usuário logado.
              </p>
            </div>
          )}

          {/* AI Analysis + Tarefa sugerida */}
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Sparkles size={11} className="text-violet-400" /> Análise IA
            </label>
            {analyzingAi && (
              <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-violet-500/5 border border-violet-500/20">
                <div className="w-4 h-4 rounded-full border-2 border-violet-500/30 border-t-violet-500 animate-spin shrink-0" />
                <p className="text-[11px] text-violet-300">Analisando publicação com IA…</p>
              </div>
            )}
            {aiError && !analyzingAi && (
              <div className="px-3 py-2 rounded-xl bg-amber-500/5 border border-amber-500/20">
                <p className="text-[11px] text-amber-400">Análise IA indisponível — selecione a etapa manualmente.</p>
              </div>
            )}
            {analysis && !analyzingAi && (
              <div className="space-y-2">
                {/* Urgência + Resumo */}
                {urgConf && (
                  <div className={`px-3 py-3 rounded-xl border ${urgConf.bg} ${urgConf.border} space-y-2`}>
                    <div className="flex items-center gap-2">
                      <urgConf.icon size={13} className={`${urgConf.text} shrink-0`} />
                      <p className={`text-[11px] font-bold ${urgConf.text}`}>{urgConf.label} · {analysis.prazo_dias} dias úteis</p>
                    </div>
                    <p className="text-[11px] text-foreground/80 leading-relaxed">{analysis.resumo}</p>
                    {analysis.tipo_acao && (
                      <p className="text-[10px] text-muted-foreground font-medium border-t border-white/10 pt-2">
                        Ação: <span className="text-foreground/70">{analysis.tipo_acao}</span>
                      </p>
                    )}
                  </div>
                )}

                {/* Dados extraídos da publicação */}
                {(analysis.parte_autora || analysis.parte_rea || analysis.juizo || analysis.area_juridica || analysis.valor_causa || analysis.data_audiencia) && (
                  <div className="rounded-xl border border-border bg-accent/20 px-3 py-2.5 space-y-1.5">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">
                      Dados identificados
                    </p>
                    {analysis.parte_autora && (
                      <div className="flex items-start gap-2 text-[11px]">
                        <span className="text-muted-foreground shrink-0 w-20">Autor:</span>
                        <span className="text-foreground font-medium">{analysis.parte_autora}</span>
                      </div>
                    )}
                    {analysis.parte_rea && (
                      <div className="flex items-start gap-2 text-[11px]">
                        <span className="text-muted-foreground shrink-0 w-20">Réu:</span>
                        <span className="text-foreground font-medium">{analysis.parte_rea}</span>
                      </div>
                    )}
                    {analysis.juizo && (
                      <div className="flex items-start gap-2 text-[11px]">
                        <span className="text-muted-foreground shrink-0 w-20">Juízo:</span>
                        <span className="text-foreground font-medium">{analysis.juizo}</span>
                      </div>
                    )}
                    {analysis.area_juridica && (
                      <div className="flex items-start gap-2 text-[11px]">
                        <span className="text-muted-foreground shrink-0 w-20">Área:</span>
                        <span className="text-foreground font-medium">{analysis.area_juridica}</span>
                      </div>
                    )}
                    {analysis.valor_causa && (
                      <div className="flex items-start gap-2 text-[11px]">
                        <span className="text-muted-foreground shrink-0 w-20">Valor:</span>
                        <span className="text-foreground font-medium">{analysis.valor_causa}</span>
                      </div>
                    )}
                    {analysis.data_audiencia && (
                      <div className="flex items-start gap-2 text-[11px] mt-1 pt-1.5 border-t border-border/50">
                        <span className="text-amber-400 shrink-0 w-20 font-semibold">📅 Audiência:</span>
                        <span className="text-amber-300 font-semibold">
                          {parseNaiveBrIso(analysis.data_audiencia).toLocaleString('pt-BR', {
                            day: '2-digit', month: '2-digit', year: 'numeric',
                            hour: '2-digit', minute: '2-digit',
                            timeZone: 'UTC',
                          })}
                        </span>
                      </div>
                    )}
                  </div>
                )}
                {/* Tarefa sugerida */}
                <TaskSuggestion analysis={analysis} pubId={pub.id} />
              </div>
            )}
          </div>

          {/* Kanban stage selector */}
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <ArrowRight size={11} /> Etapa de Entrada no Kanban
            </label>
            {analysis?.estagio_sugerido && (
              <p className="text-[10px] text-violet-400 mb-2 flex items-center gap-1">
                <Sparkles size={9} /> IA sugere: <strong>{STAGE_LABELS[analysis.estagio_sugerido] || analysis.estagio_sugerido}</strong>
              </p>
            )}
            <div className="grid grid-cols-3 gap-1.5">
              {TRACKING_STAGES_DJEN.map(s => {
                const isSelected = selectedStage === s.id;
                const isSuggested = analysis?.estagio_sugerido === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => setSelectedStage(s.id)}
                    className={`relative flex flex-col items-center gap-1 px-2 py-2 rounded-xl border text-center transition-all ${
                      isSelected
                        ? 'border-2 bg-card shadow-sm'
                        : 'border-border bg-accent/20 hover:bg-accent/40'
                    }`}
                    style={isSelected ? { borderColor: s.color, boxShadow: `0 0 0 2px ${s.color}22` } : undefined}
                  >
                    <span className="text-base leading-none">{s.emoji}</span>
                    <span
                      className="text-[9px] font-semibold leading-tight"
                      style={{ color: isSelected ? s.color : undefined }}
                    >
                      {s.label}
                    </span>
                    {isSuggested && (
                      <span className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-violet-500 flex items-center justify-center">
                        <Sparkles size={7} className="text-white" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Área Jurídica */}
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Scale size={11} /> Área Jurídica
            </label>
            {analysis?.area_juridica ? (
              <p className="text-[10px] text-violet-400 mb-2 flex items-center gap-1">
                <Sparkles size={9} /> IA identificou na publicação: <strong>{analysis.area_juridica}</strong>
              </p>
            ) : selectedLead?.conversations?.[0]?.legal_area ? (
              <p className="text-[10px] text-emerald-400 mb-2 flex items-center gap-1">
                <UserCheck size={9} /> Do atendimento do cliente: <strong>{selectedLead.conversations[0].legal_area}</strong>
              </p>
            ) : null}
            <select
              value={legalArea}
              onChange={e => setLegalArea(e.target.value)}
              className="w-full text-[12px] bg-accent/40 border border-border rounded-xl px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value="">Selecione a área jurídica…</option>
              <option value="CIVIL">Cível</option>
              <option value="TRABALHISTA">Trabalhista</option>
              <option value="PREVIDENCIARIO">Previdenciário</option>
              <option value="TRIBUTARIO">Tributário</option>
              <option value="CRIMINAL">Criminal</option>
              <option value="FAMILIA">Família</option>
              <option value="CONSUMIDOR">Consumidor</option>
              <option value="EMPRESARIAL">Empresarial</option>
              <option value="ADMINISTRATIVO">Administrativo</option>
            </select>
          </div>

          {/* Error message */}
          {submitError && (
            <div className="px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20">
              <p className="text-[12px] text-red-400">{submitError}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-5 py-4 border-t border-border shrink-0">
          <button
            onClick={onClose}
            disabled={submitting}
            className="flex-1 text-[12px] font-semibold px-4 py-2 rounded-xl border border-border text-muted-foreground hover:bg-accent transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !hasValidClient}
            title={!hasValidClient ? 'Informe o cliente para continuar' : undefined}
            className="flex-1 flex items-center justify-center gap-1.5 text-[12px] font-bold px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-500/90 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting
              ? <><Loader2 size={13} className="animate-spin" /> Criando…</>
              : <><Plus size={13} /> Criar Processo</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── PublicationCard ──────────────────────────────────────────

function PublicationCard({
  pub,
  isSelected,
  onSelect,
  onMarkViewed,
  onArchive,
  onUnarchive,
  onCreateProcess,
  onIgnoreProcess,
}: {
  pub: DjenPublication;
  isSelected: boolean;
  onSelect: (pub: DjenPublication) => void;
  onMarkViewed: (id: string) => Promise<void>;
  onArchive: (id: string) => Promise<void>;
  onUnarchive: (id: string) => Promise<void>;
  onCreateProcess: (id: string, analysis?: AiAnalysis | null) => void;
  onIgnoreProcess: (numeroProcesso: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const tipoColor = getTipoColor(pub.tipo_comunicacao);
  const isUnread = !pub.viewed_at && !pub.archived;

  const handle = async (action: string, fn: () => Promise<void>) => {
    setLoading(action);
    try { await fn(); } finally { setLoading(null); }
  };

  return (
    <div
      className={`rounded-xl border overflow-hidden transition-all ${
        isSelected
          ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
          : isUnread
          ? 'border-amber-500/30 bg-amber-500/[0.03]'
          : pub.archived
          ? 'border-border/50 bg-card/30 opacity-60'
          : 'border-border bg-card hover:border-border/80'
      }`}
    >
      {/* Header row */}
      <div className="flex items-start gap-3 p-3.5">
        {/* Unread dot */}
        <div className="pt-1 shrink-0">
          {isUnread
            ? <div className="w-2 h-2 rounded-full bg-amber-500" />
            : <div className="w-2 h-2 rounded-full border border-muted-foreground/30" />
          }
        </div>

        {/* Content */}
        <div
          className="flex-1 min-w-0 cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Calendar size={9} /> {formatDate(pub.data_disponibilizacao)}
            </span>
            {pub.tipo_comunicacao && (
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${tipoColor.bg} ${tipoColor.text}`}>
                {pub.tipo_comunicacao}
              </span>
            )}
            {!pub.legal_case_id && !pub.archived && !pub.ignored && (
              <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-amber-500/10 text-amber-400 flex items-center gap-0.5">
                <AlertTriangle size={8} /> Não vinculado
              </span>
            )}
            {pub.legal_case_id && !pub.ignored && (
              <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-400 flex items-center gap-0.5">
                <Link2 size={8} /> Vinculado
              </span>
            )}
            {pub.ignored && (
              <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-red-500/10 text-red-400 flex items-center gap-0.5">
                <Ban size={8} /> Não sou mais advogado
              </span>
            )}
            {pub.auto_task_id && (
              <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-400 flex items-center gap-0.5">
                <CheckCircle2 size={8} /> Tarefa criada
              </span>
            )}
          </div>
          <p className="text-[12px] font-mono font-semibold text-foreground truncate">
            {pub.numero_processo || '(sem número)'}
          </p>
          {pub.assunto && (
            <p className="text-[10px] text-muted-foreground truncate mt-0.5">{pub.assunto}</p>
          )}
          {pub.legal_case && (
            <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-medium">
                <Link2 size={8} />
                {pub.legal_case.lead?.name || '—'}
              </span>
              {pub.legal_case.case_number && (
                <span className="text-[9px] font-mono text-muted-foreground bg-muted/50 px-1 py-0.5 rounded">
                  {pub.legal_case.case_number}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Analisar IA + expand */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onSelect(pub)}
            title="Analisar com IA"
            className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg border transition-colors ${
              isSelected
                ? 'bg-primary text-primary-foreground border-primary'
                : 'text-violet-400 border-violet-500/30 bg-violet-500/5 hover:bg-violet-500/10'
            }`}
          >
            <Sparkles size={10} />
            {isSelected ? 'IA' : 'IA'}
          </button>
          <button onClick={() => setExpanded(!expanded)} className="p-1 text-muted-foreground hover:text-foreground">
            <ChevronRight size={13} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
          </button>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border px-3.5 py-3 bg-accent/5">
          {pub.conteudo && (
            // Sem slice — mostra conteudo COMPLETO. max-h alto + overflow-y-auto
            // permite scroll efetivo dentro do card sem ocupar tela inteira.
            // Bug corrigido 2026-04-24: antes cortava em 600 chars com "…"
            // sem permitir ver o resto.
            <p className="text-[11px] text-foreground/80 whitespace-pre-wrap leading-relaxed max-h-[60vh] overflow-y-auto custom-scrollbar mb-3 pr-1">
              {pub.conteudo}
            </p>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            {pub.legal_case_id && (
              <button
                onClick={() => window.open(`/atendimento/processos?openCase=${pub.legal_case_id}`, '_self')}
                className="flex items-center gap-1 text-[10px] font-semibold text-primary px-2 py-1 rounded border border-primary/30 hover:bg-primary/5 transition-colors"
              >
                <ExternalLink size={10} /> Ver Processo
              </button>
            )}
            {!pub.legal_case_id && !pub.archived && (
              <button
                onClick={() => onCreateProcess(pub.id, null)}
                className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400 px-2 py-1 rounded border border-emerald-500/30 hover:bg-emerald-500/5 transition-colors"
              >
                <Plus size={10} />
                Criar Processo
              </button>
            )}
            {!pub.archived && !pub.ignored && pub.numero_processo && (
              <button
                disabled={loading === 'ignore'}
                onClick={() => handle('ignore', () => onIgnoreProcess(pub.numero_processo))}
                className="flex items-center gap-1 text-[10px] font-semibold text-red-400 px-2 py-1 rounded border border-red-500/30 hover:bg-red-500/5 transition-colors disabled:opacity-50"
              >
                {loading === 'ignore' ? <Loader2 size={10} className="animate-spin" /> : <Ban size={10} />}
                Não sou mais advogado
              </button>
            )}
            {isUnread && (
              <button
                disabled={loading === 'viewed'}
                onClick={() => handle('viewed', () => onMarkViewed(pub.id))}
                className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground px-2 py-1 rounded border border-border hover:bg-accent transition-colors disabled:opacity-50"
              >
                {loading === 'viewed' ? <Loader2 size={10} className="animate-spin" /> : <Eye size={10} />}
                Marcar como visto
              </button>
            )}
            {!pub.archived ? (
              <button
                disabled={loading === 'archive'}
                onClick={() => handle('archive', () => onArchive(pub.id))}
                className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground px-2 py-1 rounded border border-border hover:bg-accent transition-colors disabled:opacity-50"
              >
                {loading === 'archive' ? <Loader2 size={10} className="animate-spin" /> : <Archive size={10} />}
                Arquivar
              </button>
            ) : (
              <button
                disabled={loading === 'unarchive'}
                onClick={() => handle('unarchive', () => onUnarchive(pub.id))}
                className="flex items-center gap-1 text-[10px] font-semibold text-amber-400 px-2 py-1 rounded border border-amber-500/30 hover:bg-amber-500/5 transition-colors disabled:opacity-50"
              >
                {loading === 'unarchive' ? <Loader2 size={10} className="animate-spin" /> : <ArchiveRestore size={10} />}
                Restaurar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── AI Analysis Panel ────────────────────────────────────────

function AiPanel({
  pub,
  onClose,
  onCreateProcess,
  onMoveStage,
}: {
  pub: DjenPublication;
  onClose: () => void;
  onCreateProcess: (id: string, analysis?: AiAnalysis | null) => void;
  onMoveStage: (caseId: string, stage: string) => Promise<void>;
}) {
  const [analysis, setAnalysis] = useState<AiAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Status individual por evento sugerido (eventos[idx]). Permite criar varios
  // em paralelo. Sets em vez de booleans pra suportar N items.
  const [creatingByIdx, setCreatingByIdx] = useState<Set<number>>(new Set());
  const [createdByIdx, setCreatedByIdx] = useState<Set<number>>(new Set());
  const [movingStage, setMovingStage] = useState(false);
  const [stageMoved, setStageMoved] = useState(false);

  // Eventos ja agendados no processo vinculado (audiencias, pericias,
  // prazos, tarefas futuras). Permite o usuario decidir se aceita ou
  // ignora a sugestao da IA antes de criar evento duplicado.
  // Feature 2026-04-26.
  type CaseEvent = {
    id: string;
    type: string;
    status: string;
    title: string;
    start_at: string;
  };
  const [caseEvents, setCaseEvents] = useState<CaseEvent[] | null>(null);

  const runAnalysis = (force = false) => {
    setLoading(true);
    setError(null);
    setAnalysis(null);
    setCreatedByIdx(new Set());
    setCreatingByIdx(new Set());
    setStageMoved(false);

    api.post(`/djen/${pub.id}/analyze`, { force })
      .then(res => setAnalysis(res.data))
      .catch((err: any) => {
        // Bug fix 2026-05-12 (DJEN IA nao funcionava):
        // Antes: erro generico fixo "Verifique OPENAI_API_KEY..." que nao
        // ajudava a diagnosticar. Agora mostra a mensagem real do backend
        // (com PR2 Skills hotfix, backend retorna mensagens tipadas por status).
        const backendMsg = err?.response?.data?.message || err?.response?.data?.error;
        const status = err?.response?.status;
        const fallback = err?.message || 'Erro desconhecido ao analisar publicacao';
        const finalMsg = backendMsg
          ? `${backendMsg}${status ? ` (HTTP ${status})` : ''}`
          : `${fallback}${status ? ` (HTTP ${status})` : ''}`;
        setError(finalMsg);
        console.error('[DJEN/IA] Falha:', { status, data: err?.response?.data, err });
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { runAnalysis(); }, [pub.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Busca eventos do processo vinculado (paralelo à análise IA, em background).
  // Aparece no painel pra usuario ver o que ja existe antes de aceitar
  // sugestao da IA.
  useEffect(() => {
    if (!pub.legal_case_id) { setCaseEvents([]); return; }
    api.get(`/calendar/events/legal-case/${pub.legal_case_id}`)
      .then(res => {
        const events: CaseEvent[] = (res.data || []).filter((e: any) =>
          ['AGENDADO', 'CONFIRMADO'].includes(e.status)
        );
        // Ordena por data ascendente, futuros primeiro
        events.sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
        setCaseEvents(events);
      })
      .catch(() => setCaseEvents([]));
  }, [pub.legal_case_id, createdByIdx]);

  // Cria UM evento especifico da lista de sugestoes da IA. Cada item da lista
  // tem seu proprio botao + status, permitindo o operador agendar todos os
  // prazos encadeados (edital + impugnacao + parecer) em sequencia.
  const handleCreateEvent = async (idx: number, ev: AiEvento, cfg: EventoConfig) => {
    if (!analysis) return;
    setCreatingByIdx(prev => new Set(prev).add(idx));
    try {
      // Audiencia/pericia tipicamente duram 1h; prazo eh marco no dia (30min).
      const durationMs = (cfg.type === 'AUDIENCIA' || cfg.type === 'PERICIA') ? 60 * 60_000 : 30 * 60_000;

      // Descricao DETALHADA do evento — usa a descricao especifica do item
      // (eventos[idx].descricao) que a IA escreveu pra ESTE prazo, nao a geral
      // da publicacao. Operador entende de cara o que aquele evento significa.
      const descLines = [cfg.descricao];
      const ctxLines: string[] = [];
      if (cfg.condicao) ctxLines.push(`Condição: ${cfg.condicao}`);
      if (pub.numero_processo) ctxLines.push(`Processo: ${pub.numero_processo}`);
      if (analysis.juizo) ctxLines.push(`Juízo: ${analysis.juizo}`);
      if (analysis.parte_autora || analysis.parte_rea) {
        ctxLines.push(`Partes: ${analysis.parte_autora || '—'} × ${analysis.parte_rea || '—'}`);
      }
      // Se PRAZO com margem aplicada, registra final real do prazo na descricao.
      if (cfg.type === 'PRAZO' && cfg.deadlineEnd && cfg.deadlineEnd.getTime() !== cfg.dueDate.getTime()) {
        const deadlineStr = cfg.deadlineEnd.toLocaleDateString('pt-BR', {
          day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
        });
        ctxLines.push(`⚠️ Último dia do prazo legal: ${deadlineStr} (agendado 1 dia útil antes por segurança)`);
      }
      if (ctxLines.length) {
        descLines.push('', '— Contexto —', ...ctxLines);
      }

      await api.post('/calendar/events', {
        type: cfg.type,
        // Titulo especifico do evento (ex: "Impugnacao ao pedido de alvara"),
        // nao o geral da publicacao. Operador identifica qual prazo eh.
        title: `[DJEN] ${cfg.titulo}`,
        description: descLines.filter(Boolean).join('\n'),
        location: analysis.juizo || undefined,
        start_at: cfg.dueDate.toISOString(),
        end_at: new Date(cfg.dueDate.getTime() + durationMs).toISOString(),
        legal_case_id: pub.legal_case_id || undefined,
        priority: analysis.urgencia,
      });
      setCreatedByIdx(prev => new Set(prev).add(idx));
    } catch { /* silencioso */ } finally {
      setCreatingByIdx(prev => {
        const next = new Set(prev);
        next.delete(idx);
        return next;
      });
    }
  };

  const handleMoveStage = async () => {
    if (!analysis?.estagio_sugerido || !pub.legal_case_id) return;
    setMovingStage(true);
    try {
      await onMoveStage(pub.legal_case_id, analysis.estagio_sugerido);
      setStageMoved(true);
    } catch { /* silencioso */ } finally { setMovingStage(false); }
  };

  const urgConf = analysis ? URGENCIA_CONFIG[analysis.urgencia] : null;

  return (
    <div className="w-1/2 shrink-0 border-l border-border flex flex-col bg-card/60 overflow-hidden">
      {/* Panel header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-violet-500/15 flex items-center justify-center">
            <Sparkles size={13} className="text-violet-400" />
          </div>
          <div>
            <p className="text-[12px] font-bold text-foreground">Análise IA</p>
            <p className="text-[10px] text-muted-foreground font-mono truncate max-w-[200px]">
              {pub.numero_processo}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {analysis && !loading && (
            <button
              onClick={() => runAnalysis(true)}
              title="Reanalisar com IA (gasta tokens)"
              className="p-1.5 rounded-lg text-muted-foreground hover:text-violet-400 hover:bg-violet-500/10 transition-colors"
            >
              <RefreshCw size={13} />
            </button>
          )}
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Content: scrollable grid */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {loading && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <div className="w-8 h-8 rounded-full border-2 border-violet-500/30 border-t-violet-500 animate-spin" />
            <p className="text-[12px]">Analisando publicação…</p>
          </div>
        )}

        {error && (
          <div className="p-4">
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3">
              <p className="text-[12px] text-red-400">{error}</p>
            </div>
          </div>
        )}

        {analysis && !loading && (() => {
          // ── Lista de eventos sugeridos (multiplos prazos por publicacao) ─
          // Ate 2026-04-26 a IA so retornava 1 evento. Agora o array eventos[]
          // suporta prazos encadeados (ex: edital 20d + impugnacao 15d).
          const eventos = getAnalysisEventos(analysis);
          const eventoConfigs = eventos.map(resolveEventoConfig);

          const futureEvents = (caseEvents || []).filter(e => {
            const dt = new Date(e.start_at);
            return dt.getTime() > Date.now() - 3 * 60 * 60 * 1000;
          });

          // Pra cada evento sugerido, verifica se ja tem correspondente agendado.
          // Janela: 2h pra audiencia/pericia (data fixa do juiz), 24h pra prazo
          // (data estimada — pequenas variacoes sao OK).
          const matchByIdx = eventoConfigs.map(cfg => {
            const windowMs = (cfg.type === 'AUDIENCIA' || cfg.type === 'PERICIA')
              ? 2 * 60 * 60 * 1000
              : 24 * 60 * 60 * 1000;
            return futureEvents.some(e => {
              if (e.type !== cfg.type) return false;
              const diff = Math.abs(new Date(e.start_at).getTime() - cfg.dueDate.getTime());
              return diff < windowMs;
            });
          });

          // Comparacao etapa
          const stageMatches = !!(
            analysis.estagio_sugerido &&
            pub.legal_case?.tracking_stage === analysis.estagio_sugerido
          );
          const stageNeedsMove = !!(
            analysis.estagio_sugerido && pub.legal_case_id && !stageMatches
          );

          // Veredicto agregado — leva todos os eventos da IA em conta
          const allEventosMatch = eventoConfigs.length > 0 && matchByIdx.every(Boolean);
          const someEventosMatch = matchByIdx.some(Boolean);
          const noEventosMatch = !someEventosMatch;

          let verdict: 'all-done' | 'partial' | 'all-pending';
          if (!pub.legal_case_id) {
            verdict = 'all-pending';
          } else if (eventoConfigs.length === 0) {
            // Sem eventos sugeridos: depende so da etapa.
            verdict = stageMatches ? 'all-done' : 'partial';
          } else if (stageMatches && allEventosMatch) {
            verdict = 'all-done';
          } else if (stageNeedsMove && noEventosMatch) {
            verdict = 'all-pending';
          } else {
            verdict = 'partial';
          }

          const verdictConfig = {
            'all-done': {
              icon: CheckCircle2,
              label: 'Esta publicação não exige ações novas',
              bg: 'bg-emerald-500/10',
              border: 'border-emerald-500/40',
              text: 'text-emerald-400',
            },
            'partial': {
              icon: AlertTriangle,
              label: 'Esta publicação exige algumas ações',
              bg: 'bg-amber-500/10',
              border: 'border-amber-500/40',
              text: 'text-amber-400',
            },
            'all-pending': {
              icon: AlertCircle,
              label: pub.legal_case_id ? 'Esta publicação exige ações' : 'Publicação não vinculada — cadastre o processo',
              bg: 'bg-red-500/10',
              border: 'border-red-500/40',
              text: 'text-red-400',
            },
          }[verdict];

          const VerdictIcon = verdictConfig.icon;

          // Helpers de format
          const formatBrPretty = (d: Date) =>
            d.toLocaleString('pt-BR', {
              day: '2-digit', month: '2-digit', year: 'numeric',
              hour: '2-digit', minute: '2-digit',
              timeZone: 'UTC',
            });

          return (
            <div className="p-4 space-y-4 max-w-3xl mx-auto">

              {/* ═══ ZONA 1 — TOPO: URGENCIA + RESUMO + AÇÃO ═══ */}
              <section className="space-y-3">
                {analysis.model_used && (
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <Sparkles size={9} className="text-violet-400" />
                    <span>Analisado por <strong className="text-foreground">{analysis.model_used}</strong></span>
                  </div>
                )}
                {urgConf && (
                  <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${urgConf.bg} ${urgConf.border}`}>
                    <urgConf.icon size={14} className={urgConf.text} />
                    <span className={`text-[12px] font-bold ${urgConf.text}`}>{urgConf.label}</span>
                    <span className="text-[10px] text-muted-foreground ml-auto">{analysis.prazo_dias} dias úteis</span>
                  </div>
                )}
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">📋 Resumo</p>
                  <p className="text-[12px] text-foreground leading-relaxed">{analysis.resumo}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">→ Ação Necessária</p>
                  <div className="flex items-start gap-2 p-2.5 rounded-xl bg-accent/40 border border-border">
                    <ArrowRight size={13} className="text-primary mt-0.5 shrink-0" />
                    <p className="text-[12px] text-foreground font-medium">{analysis.tipo_acao}</p>
                  </div>
                </div>
              </section>

              {/* ═══ ZONA 2 — VEREDICTO + AÇÕES PRINCIPAIS ═══ */}
              <section>
                <div className={`rounded-2xl border-2 ${verdictConfig.border} ${verdictConfig.bg} p-4 space-y-3`}>
                  {/* Header do veredicto */}
                  <div className="flex items-start gap-2">
                    <VerdictIcon size={20} className={`${verdictConfig.text} shrink-0 mt-0.5`} />
                    <div className="flex-1">
                      <p className={`text-[13px] font-bold ${verdictConfig.text}`}>{verdictConfig.label}</p>
                    </div>
                  </div>

                  {/* Lista de status — etapa + cada evento sugerido individual */}
                  {pub.legal_case_id && (
                    <ul className="space-y-1.5 pl-7">
                      {/* Status da etapa */}
                      {analysis.estagio_sugerido && (
                        <li className="flex items-start gap-2 text-[11px]">
                          {stageMatches ? (
                            <>
                              <CheckCircle2 size={12} className="text-emerald-400 mt-0.5 shrink-0" />
                              <span className="text-foreground">
                                Etapa correta: <strong>{STAGE_LABELS[pub.legal_case?.tracking_stage || ''] || pub.legal_case?.tracking_stage}</strong>
                              </span>
                            </>
                          ) : (
                            <>
                              <AlertTriangle size={12} className="text-amber-400 mt-0.5 shrink-0" />
                              <span className="text-foreground">
                                Etapa atual: <strong>{STAGE_LABELS[pub.legal_case?.tracking_stage || ''] || pub.legal_case?.tracking_stage || '—'}</strong>
                                {' → '}
                                IA sugere mover para <strong>{STAGE_LABELS[analysis.estagio_sugerido] || analysis.estagio_sugerido}</strong>
                              </span>
                            </>
                          )}
                        </li>
                      )}
                      {/* Status de cada evento sugerido */}
                      {eventoConfigs.map((c, idx) => {
                        const matched = matchByIdx[idx];
                        const created = createdByIdx.has(idx);
                        return (
                          <li key={idx} className="flex items-start gap-2 text-[11px]">
                            {(matched || created) ? (
                              <>
                                <CheckCircle2 size={12} className="text-emerald-400 mt-0.5 shrink-0" />
                                <span className="text-foreground">
                                  <strong>{c.titulo}</strong> — {EVENT_TYPE_LABELS[c.type].nounLow} {created ? 'agendada agora' : 'já agendada'}{' '}
                                  para <strong>{formatBrPretty(c.dueDate)}</strong>
                                </span>
                              </>
                            ) : (
                              <>
                                <AlertTriangle size={12} className="text-amber-400 mt-0.5 shrink-0" />
                                <span className="text-foreground">
                                  IA sugere <strong>{c.titulo}</strong> ({EVENT_TYPE_LABELS[c.type].nounLow}) em{' '}
                                  <strong>{formatBrPretty(c.dueDate)}</strong>
                                  {c.condicao && <span className="text-muted-foreground"> · {c.condicao}</span>}
                                </span>
                              </>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {/* Botões — um por evento sugerido + mover etapa */}
                  <div className="pt-2 border-t border-border/40 space-y-2">
                    {verdict === 'all-done' && (
                      <p className="text-[10px] text-muted-foreground">
                        Caso queira mesmo assim — ações disponíveis:
                      </p>
                    )}

                    <div className="flex flex-wrap gap-2">
                      {/* Botão por evento sugerido */}
                      {pub.legal_case_id && eventoConfigs.map((c, idx) => {
                        const isCreating = creatingByIdx.has(idx);
                        const isCreated = createdByIdx.has(idx);
                        const matched = matchByIdx[idx];
                        // Se ja tem evento equivalente, botao opcional (cinza)
                        const isOptional = matched && !isCreated;
                        return (
                          <button
                            key={idx}
                            onClick={() => handleCreateEvent(idx, eventos[idx], c)}
                            disabled={isCreating || isCreated}
                            title={c.descricao}
                            className={`flex-1 min-w-[200px] flex items-center justify-center gap-1.5 text-[11px] font-bold py-2 px-3 rounded-lg transition-colors ${
                              isCreated
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                                : isOptional
                                ? 'bg-card border border-border text-muted-foreground hover:bg-accent disabled:opacity-50'
                                : 'bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50'
                            }`}
                          >
                            {isCreating ? (
                              <><Loader2 size={11} className="animate-spin" /> Criando…</>
                            ) : isCreated ? (
                              <><CheckCircle2 size={11} /> {EVENT_TYPE_LABELS[c.type].done}</>
                            ) : (
                              <>
                                {c.buttonIcon === 'audience' ? <Calendar size={12} /> : c.buttonIcon === 'deadline' ? <Clock size={12} /> : c.buttonIcon === 'pericia' ? <Microscope size={12} /> : <CheckSquare size={12} />}
                                <span className="truncate">{isOptional ? `${c.buttonLabel} mesmo assim` : c.buttonLabel}: {c.titulo}</span>
                              </>
                            )}
                          </button>
                        );
                      })}
                      {/* Botão de mover etapa */}
                      {stageNeedsMove && (
                        <button
                          onClick={handleMoveStage}
                          disabled={movingStage || stageMoved}
                          className={`flex-1 min-w-[200px] flex items-center justify-center gap-1.5 text-[11px] font-bold py-2 px-3 rounded-lg transition-colors ${
                            stageMoved
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                              : 'bg-card border-2 border-primary/40 text-primary hover:bg-primary/5 disabled:opacity-50'
                          }`}
                        >
                          {movingStage ? (
                            <><Loader2 size={11} className="animate-spin" /> Movendo…</>
                          ) : stageMoved ? (
                            <><CheckCircle2 size={11} /> Processo movido!</>
                          ) : (
                            <><ArrowRight size={12} /> Mover para {STAGE_LABELS[analysis.estagio_sugerido!]}</>
                          )}
                        </button>
                      )}
                      {/* Sem processo vinculado: botão de criar */}
                      {!pub.legal_case_id && analysis.estagio_sugerido && (
                        <button
                          onClick={() => onCreateProcess(pub.id, analysis)}
                          className="flex-1 min-w-[200px] flex items-center justify-center gap-1.5 text-[11px] font-bold py-2 px-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                        >
                          <Plus size={12} /> Cadastrar processo na etapa <strong>{STAGE_LABELS[analysis.estagio_sugerido] || analysis.estagio_sugerido}</strong>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </section>

              {/* ═══ ZONA 3 — DETALHES (2 cols: Estado x Sugestão IA) ═══ */}
              {pub.legal_case_id && (
                <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* Esquerda: Eventos no processo */}
                  <div>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">⚖️ Eventos no Processo</p>
                    <div className="rounded-xl border border-border bg-card p-3 space-y-2">
                      <p className="text-[10px] text-muted-foreground">
                        Etapa: <strong className="text-foreground">{STAGE_LABELS[pub.legal_case?.tracking_stage || ''] || pub.legal_case?.tracking_stage || '—'}</strong>
                        {stageMatches && <span className="ml-1.5 text-[9px] font-bold text-emerald-400">✓ correto</span>}
                      </p>
                      <div className="pt-2 border-t border-border/40">
                        <p className="text-[10px] text-muted-foreground mb-1.5">
                          {futureEvents.length} evento{futureEvents.length !== 1 ? 's' : ''} pendente{futureEvents.length !== 1 ? 's' : ''}
                        </p>
                        {caseEvents === null ? (
                          <p className="text-[10px] text-muted-foreground italic">Carregando…</p>
                        ) : futureEvents.length === 0 ? (
                          <p className="text-[10px] text-muted-foreground italic">Nenhum evento futuro.</p>
                        ) : (
                          <ul className="space-y-1.5 max-h-44 overflow-y-auto custom-scrollbar pr-1">
                            {futureEvents.slice(0, 8).map(e => {
                              const dt = new Date(e.start_at);
                              const dateStr = formatBrPretty(dt);
                              const isAud = e.type === 'AUDIENCIA';
                              const isPer = e.type === 'PERICIA';
                              const isPrazo = e.type === 'PRAZO';
                              const emoji = isAud ? '⚖️' : isPer ? '🔬' : isPrazo ? '⏰' : '✅';
                              const colorBg = isAud ? 'bg-amber-500/20 border-amber-500/50'
                                : isPer ? 'bg-violet-500/20 border-violet-500/50'
                                : isPrazo ? 'bg-red-500/20 border-red-500/50'
                                : 'bg-blue-500/20 border-blue-500/50';
                              // Match: evento ja agendado bate com QUALQUER sugestao da IA?
                              // Janela: 2h (audiencia/pericia) ou 24h (prazo).
                              const isMatch = eventoConfigs.some(c => {
                                if (e.type !== c.type) return false;
                                const window = (c.type === 'AUDIENCIA' || c.type === 'PERICIA')
                                  ? 2 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
                                return Math.abs(dt.getTime() - c.dueDate.getTime()) < window;
                              });
                              return (
                                <li key={e.id} title={e.title} className={`flex items-start gap-2 px-2.5 py-1.5 rounded border text-[11px] ${colorBg}`}>
                                  <span className="shrink-0 text-[13px] leading-none mt-0.5">{emoji}</span>
                                  <div className="flex-1 min-w-0">
                                    <p className="font-semibold text-foreground leading-snug line-clamp-2">{e.title}</p>
                                    <p className="text-[10px] text-foreground/80 mt-0.5">{dateStr}</p>
                                    {isMatch && (
                                      <p className="mt-0.5 text-[9px] font-bold text-emerald-300">
                                        ✓ corresponde à sugestão da IA
                                      </p>
                                    )}
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Direita: Sugestões detalhadas (uma por evento) */}
                  <div>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
                      💡 Sugestões da IA {eventoConfigs.length > 0 && <span className="text-muted-foreground/70">({eventoConfigs.length})</span>}
                    </p>
                    {eventoConfigs.length === 0 ? (
                      <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-3">
                        <p className="text-[11px] text-muted-foreground italic">
                          Nenhum evento a agendar — publicação informativa.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-[28rem] overflow-y-auto custom-scrollbar pr-1">
                        {eventoConfigs.map((c, idx) => {
                          const matched = matchByIdx[idx];
                          const created = createdByIdx.has(idx);
                          const ev = eventos[idx];
                          return (
                            <div key={idx} className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-3 space-y-1.5">
                              {/* Header: tipo + numeracao se ha multiplos */}
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-[12px] font-bold text-foreground flex items-center gap-1.5">
                                  {eventoConfigs.length > 1 && (
                                    <span className="text-[10px] text-muted-foreground">{idx + 1}/{eventoConfigs.length}</span>
                                  )}
                                  <span>{EVENT_TYPE_LABELS[c.type].emoji} {c.titulo}</span>
                                </p>
                                {(matched || created) && (
                                  <span className="text-[9px] font-bold text-emerald-400 flex items-center gap-1 shrink-0">
                                    <CheckCircle2 size={9} /> {created ? 'criado' : 'já agendado'}
                                  </span>
                                )}
                              </div>
                              {/* Tipo + Data */}
                              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
                                <span className="text-muted-foreground">
                                  Tipo: <strong className="text-foreground">{EVENT_TYPE_LABELS[c.type].noun}</strong>
                                </span>
                                <span className="text-muted-foreground">
                                  {c.type === 'PRAZO' ? 'Agendar:' : 'Data:'}{' '}
                                  <strong className="text-foreground">
                                    {EVENT_TYPE_LABELS[c.type].hasExplicitDate || c.type === 'PRAZO'
                                      ? formatBrPretty(c.dueDate)
                                      : `${ev.prazo_dias || analysis.prazo_dias} dias úteis`}
                                  </strong>
                                </span>
                              </div>
                              {/* Final do prazo legal (se PRAZO com margem) */}
                              {c.type === 'PRAZO' && c.deadlineEnd && c.deadlineEnd.getTime() !== c.dueDate.getTime() && (
                                <p className="text-[9px] text-muted-foreground flex items-start gap-1">
                                  <AlertTriangle size={9} className="text-amber-400 shrink-0 mt-0.5" />
                                  <span>
                                    Último dia: <strong className="text-amber-300">{formatBrPretty(c.deadlineEnd)}</strong>
                                    {' · '}agendado 1 dia útil antes por segurança
                                  </span>
                                </p>
                              )}
                              {/* Condicao (pra prazos encadeados) */}
                              {c.condicao && (
                                <p className="text-[10px] text-amber-200 italic flex items-start gap-1">
                                  <ArrowRight size={9} className="shrink-0 mt-0.5" />
                                  <span>{c.condicao}</span>
                                </p>
                              )}
                              {/* Descricao detalhada — instrucoes do que fazer */}
                              {c.descricao && c.descricao !== c.titulo && (
                                <p className="text-[10px] text-foreground/80 leading-relaxed pt-1 border-t border-border/30">
                                  {c.descricao}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* ═══ ZONA 4 — RODAPÉ: ORIENTAÇÕES ═══ */}
              {analysis.orientacoes && (
                <section>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">📝 Orientações para Preparação</p>
                  <div className="rounded-xl border border-border bg-accent/20 p-3">
                    <p className="text-[11px] text-foreground/90 leading-relaxed whitespace-pre-line">{analysis.orientacoes}</p>
                  </div>
                </section>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────

type Tab = 'unread' | 'viewed' | 'archived';

function DjenPageContent() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('unread');
  const [pubs, setPubs] = useState<DjenPublication[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncDateFrom, setSyncDateFrom] = useState(() => { const d = new Date(); return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`; });
  const [syncDateTo, setSyncDateTo] = useState(() => { const d = new Date(); return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`; });
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const syncRef = useRef<HTMLDivElement>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [days, setDays] = useState(30);
  const [selectedPub, setSelectedPub] = useState<DjenPublication | null>(null);

  // Modal de criação de processo
  const [createModalPub, setCreateModalPub] = useState<DjenPublication | null>(null);
  const [createModalAnalysis, setCreateModalAnalysis] = useState<AiAnalysis | null>(null);

  // Modal de advogados monitorados
  const [lawyersOpen, setLawyersOpen] = useState(false);
  const [lawyers, setLawyers] = useState<Array<{ oab: string; uf: string; nome: string }>>([]);
  const [savingLawyers, setSavingLawyers] = useState(false);
  const [lawyersMsg, setLawyersMsg] = useState<string | null>(null);
  const [newLawyer, setNewLawyer] = useState({ nome: '', oab: '', uf: 'AL' });

  const fetchPubs = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params: Record<string, string> = { days: String(days), limit: '100' };
      if (tab === 'unread')   { params.viewed = 'false'; params.archived = 'false'; }
      else if (tab === 'viewed')   { params.viewed = 'true';  params.archived = 'false'; }
      else if (tab === 'archived') { params.archived = 'true'; }

      const res = await api.get('/djen/all', { params });
      setPubs(res.data.items || []);
      setTotal(res.data.total || 0);
      setUnreadCount(res.data.unreadCount || 0);
    } catch (e) {
      console.warn('Erro ao buscar publicações DJEN', e);
    } finally {
      setLoading(false);
    }
  }, [tab, days]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { router.push('/atendimento/login'); return; }
    fetchPubs();
  }, [router, fetchPubs]);

  const parseDateBR = (str: string): Date | null => {
    const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;
    return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12, 0, 0);
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const from = parseDateBR(syncDateFrom);
      const to = parseDateBR(syncDateTo);
      if (!from || !to) { setSyncResult('Formato inválido. Use dd/mm/aaaa'); setSyncing(false); return; }
      if (from > to) { setSyncResult('Data inicial maior que final'); setSyncing(false); return; }
      const dates: string[] = [];
      const d = new Date(from);
      while (d <= to) {
        dates.push(d.toISOString().slice(0, 10));
        d.setDate(d.getDate() + 1);
      }
      if (dates.length > 30) { setSyncResult('Máximo 30 dias por vez'); setSyncing(false); return; }

      let totalSaved = 0;
      let totalErrors = 0;
      for (const date of dates) {
        try {
          const res = await api.post('/djen/sync', { date });
          totalSaved += res.data?.saved || 0;
          totalErrors += res.data?.errors || 0;
        } catch {
          totalErrors++;
        }
      }
      await fetchPubs(true);
      setSyncResult(`${totalSaved} publicações salvas${totalErrors > 0 ? `, ${totalErrors} erros` : ''} (${dates.length} dia${dates.length > 1 ? 's' : ''})`);
    } catch {
      setSyncResult('Erro na sincronização');
    } finally { setSyncing(false); }
  };

  // Fechar popover ao clicar fora
  useEffect(() => {
    if (!syncOpen) return;
    const handler = (e: MouseEvent) => {
      if (syncRef.current && !syncRef.current.contains(e.target as Node)) setSyncOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [syncOpen]);

  // ─── Advogados monitorados ─────────────────────────
  const loadLawyers = async () => {
    try {
      const res = await api.get('/settings/djen-lawyers');
      setLawyers(Array.isArray(res.data) ? res.data : []);
    } catch { setLawyers([]); }
  };

  const saveLawyers = async () => {
    setSavingLawyers(true);
    setLawyersMsg(null);
    try {
      await api.patch('/settings/djen-lawyers', { lawyers });
      setLawyersMsg('Salvo com sucesso');
    } catch {
      setLawyersMsg('Erro ao salvar');
    } finally { setSavingLawyers(false); }
  };

  const addLawyer = () => {
    if (!newLawyer.nome.trim() || !newLawyer.oab.trim()) return;
    if (lawyers.some(l => l.oab === newLawyer.oab.trim() && l.uf === newLawyer.uf)) return;
    setLawyers([...lawyers, { nome: newLawyer.nome.trim(), oab: newLawyer.oab.trim(), uf: newLawyer.uf }]);
    setNewLawyer({ nome: '', oab: '', uf: 'AL' });
    setLawyersMsg(null);
  };

  const removeLawyer = (idx: number) => {
    setLawyers(lawyers.filter((_, i) => i !== idx));
    setLawyersMsg(null);
  };

  const handleMarkAllViewed = async () => {
    setMarkingAll(true);
    try {
      await api.patch('/djen/mark-all-viewed');
      await fetchPubs(true);
    } catch {} finally { setMarkingAll(false); }
  };

  const handleMarkViewed = async (id: string) => {
    await api.patch(`/djen/${id}/viewed`);
    setPubs(prev => prev.map(p => p.id === id ? { ...p, viewed_at: new Date().toISOString() } : p));
    setUnreadCount(c => Math.max(0, c - 1));
  };

  const handleArchive = async (id: string) => {
    await api.patch(`/djen/${id}/archive`);
    setPubs(prev => prev.filter(p => p.id !== id));
    setTotal(c => Math.max(0, c - 1));
    if (selectedPub?.id === id) setSelectedPub(null);
  };

  const handleUnarchive = async (id: string) => {
    await api.patch(`/djen/${id}/unarchive`);
    setPubs(prev => prev.filter(p => p.id !== id));
  };

  const handleIgnoreProcess = async (numeroProcesso: string) => {
    await api.post('/djen/ignore-process', { numero_processo: numeroProcesso });
    // Remover todas as publicações desse número da lista atual
    setPubs(prev => prev.filter(p => p.numero_processo !== numeroProcesso));
    setTotal(c => {
      const removed = pubs.filter(p => p.numero_processo === numeroProcesso).length;
      return Math.max(0, c - removed);
    });
    if (selectedPub?.numero_processo === numeroProcesso) setSelectedPub(null);
  };

  // Abre o modal de criação, com análise IA opcional já carregada (do AiPanel)
  const handleOpenCreateModal = (id: string, analysis?: AiAnalysis | null) => {
    const pub = pubs.find(p => p.id === id);
    if (!pub) return;
    setCreateModalPub(pub);
    setCreateModalAnalysis(analysis ?? null);
  };

  const handleMoveStage = async (caseId: string, stage: string) => {
    await api.patch(`/legal-cases/${caseId}/tracking-stage`, { trackingStage: stage });
    await fetchPubs(true);
  };

  const handleSelectForAnalysis = (pub: DjenPublication) => {
    if (selectedPub?.id === pub.id) {
      setSelectedPub(null);
    } else {
      setSelectedPub(pub);
      // Auto-mark as viewed when analyzing
      if (!pub.viewed_at) {
        api.patch(`/djen/${pub.id}/viewed`).then(() => {
          setPubs(prev => prev.map(p => p.id === pub.id ? { ...p, viewed_at: new Date().toISOString() } : p));
          setUnreadCount(c => Math.max(0, c - 1));
        }).catch(() => {});
      }
    }
  };

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'unread',   label: 'Não visualizadas', badge: unreadCount },
    { id: 'viewed',   label: 'Visualizadas' },
    { id: 'archived', label: 'Arquivadas' },
  ];

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">

      {/* Header */}
      <header className="px-6 py-4 border-b border-border shrink-0 flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Gavel size={20} className="text-sky-400" />
            DJEN — Publicações
            {unreadCount > 0 && (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-500/12 text-amber-400 border border-amber-500/20">
                {unreadCount} não lida{unreadCount !== 1 ? 's' : ''}
              </span>
            )}
          </h1>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            Diário da Justiça Eletrônico — publicações do escritório
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            className="text-[11px] bg-card border border-border rounded-lg px-2 py-1.5 text-foreground"
          >
            <option value={7}>Últimos 7 dias</option>
            <option value={15}>Últimos 15 dias</option>
            <option value={30}>Últimos 30 dias</option>
            <option value={60}>Últimos 60 dias</option>
            <option value={90}>Últimos 90 dias</option>
          </select>

          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllViewed}
              disabled={markingAll}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground px-3 py-1.5 border border-border rounded-lg hover:bg-accent transition-colors disabled:opacity-50"
            >
              {markingAll ? <Loader2 size={12} className="animate-spin" /> : <CheckCheck size={12} />}
              Marcar tudo como visto
            </button>
          )}

          <button
            onClick={() => { setLawyersOpen(true); loadLawyers(); setLawyersMsg(null); }}
            className="flex items-center gap-1.5 text-[11px] font-semibold text-violet-400 hover:text-violet-300 px-3 py-1.5 border border-violet-500/30 rounded-lg hover:bg-violet-500/5 transition-colors"
          >
            <Users size={12} />
            Advogados
          </button>

          <div className="relative" ref={syncRef}>
            <button
              onClick={() => { setSyncOpen(!syncOpen); setSyncResult(null); }}
              disabled={syncing}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-sky-400 hover:text-sky-300 px-3 py-1.5 border border-sky-500/30 rounded-lg hover:bg-sky-500/5 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
              Sincronizar
            </button>
            {syncOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-xl shadow-xl p-4 w-[280px]">
                <p className="text-[11px] font-semibold text-foreground mb-3">Buscar publicações por período</p>
                <div className="flex flex-col gap-2 mb-3">
                  <label className="text-[10px] text-muted-foreground font-medium">
                    De
                    <input
                      type="text"
                      placeholder="dd/mm/aaaa"
                      maxLength={10}
                      value={syncDateFrom}
                      onChange={e => {
                        let v = e.target.value.replace(/[^\d/]/g, '');
                        const raw = v.replace(/\//g, '');
                        if (raw.length >= 3 && !v.includes('/')) v = raw.slice(0,2) + '/' + raw.slice(2);
                        if (raw.length >= 5 && v.split('/').length < 3) v = v.slice(0,5) + '/' + raw.slice(4);
                        setSyncDateFrom(v.slice(0, 10));
                      }}
                      className="mt-0.5 w-full bg-background border border-border rounded-lg px-2 py-1.5 text-[11px] text-foreground"
                    />
                  </label>
                  <label className="text-[10px] text-muted-foreground font-medium">
                    Até
                    <input
                      type="text"
                      placeholder="dd/mm/aaaa"
                      maxLength={10}
                      value={syncDateTo}
                      onChange={e => {
                        let v = e.target.value.replace(/[^\d/]/g, '');
                        const raw = v.replace(/\//g, '');
                        if (raw.length >= 3 && !v.includes('/')) v = raw.slice(0,2) + '/' + raw.slice(2);
                        if (raw.length >= 5 && v.split('/').length < 3) v = v.slice(0,5) + '/' + raw.slice(4);
                        setSyncDateTo(v.slice(0, 10));
                      }}
                      className="mt-0.5 w-full bg-background border border-border rounded-lg px-2 py-1.5 text-[11px] text-foreground"
                    />
                  </label>
                </div>
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="w-full flex items-center justify-center gap-1.5 text-[11px] font-semibold text-white bg-sky-600 hover:bg-sky-500 px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
                >
                  {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  {syncing ? 'Sincronizando...' : 'Buscar'}
                </button>
                {syncResult && (
                  <p className={`mt-2 text-[10px] font-medium ${syncResult.includes('Erro') || syncResult.includes('Máximo') || syncResult.includes('maior') ? 'text-red-400' : 'text-emerald-400'}`}>
                    {syncResult}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="px-6 border-b border-border shrink-0 flex gap-0">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-3 text-[12px] font-semibold border-b-2 transition-colors ${
              tab === t.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
            {t.badge != null && t.badge > 0 && (
              <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[9px] font-bold leading-[18px] text-center">
                {t.badge > 99 ? '99+' : t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Main — list + AI panel (horizontal 50/50 split) */}
      <div className="flex-1 flex overflow-hidden">

        {/* Publications list */}
        <main className={`overflow-y-auto custom-scrollbar transition-all ${selectedPub ? 'w-1/2' : 'flex-1'}`}>
          {loading ? (
            <div className="flex items-center justify-center h-40 gap-2 text-muted-foreground text-[13px]">
              <Loader2 size={16} className="animate-spin" />
              Carregando publicações…
            </div>
          ) : pubs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-52 text-muted-foreground">
              <Bell size={32} className="mb-3 opacity-25" />
              <p className="text-[14px] font-semibold">
                {tab === 'unread'   ? 'Nenhuma publicação não lida' :
                 tab === 'viewed'   ? 'Nenhuma publicação visualizada' :
                 tab === 'archived' ? 'Nenhuma publicação arquivada' :
                 'Nenhuma publicação encontrada'}
              </p>
              <p className="text-[12px] mt-1 opacity-70">
                {tab === 'unread' ? 'Tudo em dia!' : tab === 'viewed' ? 'Nenhuma publicação foi visualizada ainda' : 'Tente sincronizar ou ampliar o período'}
              </p>
            </div>
          ) : (
            <div className="px-4 py-4 space-y-2 max-w-2xl">
              <p className="text-[10px] text-muted-foreground mb-2">
                {total} publicação{total !== 1 ? 'ões' : ''}
              </p>
              {pubs.map(pub => (
                <PublicationCard
                  key={pub.id}
                  pub={pub}
                  isSelected={selectedPub?.id === pub.id}
                  onSelect={handleSelectForAnalysis}
                  onMarkViewed={handleMarkViewed}
                  onArchive={handleArchive}
                  onUnarchive={handleUnarchive}
                  onCreateProcess={handleOpenCreateModal}
                  onIgnoreProcess={handleIgnoreProcess}
                />
              ))}
            </div>
          )}
        </main>

        {/* AI Analysis Panel */}
        {selectedPub && (
          <AiPanel
            pub={selectedPub}
            onClose={() => setSelectedPub(null)}
            onCreateProcess={handleOpenCreateModal}
            onMoveStage={handleMoveStage}
          />
        )}
      </div>

      {/* Modal: Criar Processo */}
      {createModalPub && (
        <CreateProcessModal
          pub={createModalPub}
          preloadedAnalysis={createModalAnalysis}
          onClose={() => { setCreateModalPub(null); setCreateModalAnalysis(null); }}
          onSuccess={() => {
            setCreateModalPub(null);
            setCreateModalAnalysis(null);
            fetchPubs(true);
          }}
        />
      )}

      {/* Modal Advogados Monitorados */}
      {lawyersOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setLawyersOpen(false)}>
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
                <Scale size={16} className="text-violet-400" />
                Advogados Monitorados
              </h2>
              <button onClick={() => setLawyersOpen(false)} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
            </div>

            <div className="px-5 py-4 max-h-[60vh] overflow-y-auto space-y-3">
              {lawyers.length === 0 && (
                <p className="text-[11px] text-muted-foreground text-center py-4">Nenhum advogado cadastrado</p>
              )}
              {lawyers.map((l, i) => (
                <div key={i} className="flex items-center justify-between gap-2 bg-background/50 border border-border rounded-lg px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-semibold text-foreground truncate">{l.nome}</p>
                    <p className="text-[10px] text-muted-foreground">OAB {l.oab}/{l.uf}</p>
                  </div>
                  <button onClick={() => removeLawyer(i)} className="text-red-400 hover:text-red-300 shrink-0 p-1 rounded hover:bg-red-500/10 transition-colors">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}

              <div className="border-t border-border pt-3 mt-3">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Adicionar advogado</p>
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="Nome completo"
                    value={newLawyer.nome}
                    onChange={e => setNewLawyer({ ...newLawyer, nome: e.target.value })}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-[11px] text-foreground placeholder:text-muted-foreground/50"
                  />
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Nº OAB"
                      value={newLawyer.oab}
                      onChange={e => setNewLawyer({ ...newLawyer, oab: e.target.value.replace(/\D/g, '') })}
                      className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-[11px] text-foreground placeholder:text-muted-foreground/50"
                    />
                    <select
                      value={newLawyer.uf}
                      onChange={e => setNewLawyer({ ...newLawyer, uf: e.target.value })}
                      className="w-20 bg-background border border-border rounded-lg px-2 py-2 text-[11px] text-foreground"
                    >
                      {['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].map(uf => (
                        <option key={uf} value={uf}>{uf}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    onClick={addLawyer}
                    disabled={!newLawyer.nome.trim() || !newLawyer.oab.trim()}
                    className="w-full flex items-center justify-center gap-1.5 text-[11px] font-semibold text-violet-400 hover:text-violet-300 px-3 py-2 border border-violet-500/30 rounded-lg hover:bg-violet-500/5 transition-colors disabled:opacity-30"
                  >
                    <Plus size={12} />
                    Adicionar
                  </button>
                </div>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-border flex items-center justify-between">
              {lawyersMsg && (
                <p className={`text-[10px] font-medium ${lawyersMsg.includes('Erro') ? 'text-red-400' : 'text-emerald-400'}`}>{lawyersMsg}</p>
              )}
              {!lawyersMsg && <span />}
              <button
                onClick={saveLawyers}
                disabled={savingLawyers}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-white bg-violet-600 hover:bg-violet-500 px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                {savingLawyers ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DjenPage() {
  return (
    <RouteGuard allowedRoles={['ADMIN', 'ADVOGADO', 'ESTAGIARIO']}>
      <DjenPageContent />
    </RouteGuard>
  );
}
