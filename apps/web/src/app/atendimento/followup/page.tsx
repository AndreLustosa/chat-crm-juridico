'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Bot, Send, Clock, CheckCircle, XCircle, RefreshCw, Plus,
  ChevronRight, Users, Zap, TrendingUp, AlertTriangle, Edit2,
  Trash2, Play, Pause, X, Search, Filter, ChevronDown,
  MessageSquare, Settings, BarChart2, List, Shield, AlertOctagon,
  Phone, Mail, Smartphone, Eye, Download, Sprout, FileJson,
  Radio, Calendar, MapPin, Hash,
} from 'lucide-react';
import { showError, showSuccess } from '@/lib/toast';
import { API_BASE_URL } from '@/lib/api';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface FollowupStep {
  id: string;
  sequence_id: string;
  position: number;
  delay_hours: number;
  channel: string;
  tone: string;
  objective: string;
  custom_prompt?: string;
  auto_send: boolean;
}

interface FollowupSequence {
  id: string;
  name: string;
  description?: string;
  category: string;
  active: boolean;
  auto_enroll_stages: string[];
  max_attempts: number;
  created_at: string;
  steps: FollowupStep[];
  _count?: { enrollments: number };
}

interface FollowupEnrollment {
  id: string;
  lead_id: string;
  sequence_id: string;
  current_step: number;
  status: string;
  enrolled_at: string;
  last_sent_at?: string;
  next_send_at?: string;
  lead: { id: string; name?: string; phone: string; stage: string };
  sequence: { id: string; name: string; category: string };
  messages: unknown[];
}

interface FollowupMessage {
  id: string;
  enrollment_id: string;
  lead_id: string;
  channel: string;
  generated_text: string;
  sent_text?: string;
  status: string;
  risk_level: string;
  created_at: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context_json?: any;
  enrollment: {
    lead: { name?: string; phone: string; stage: string };
    sequence: { name: string };
    messages?: Array<{ id: string; generated_text?: string; sent_text?: string; status: string; created_at: string; channel: string }>;
  };
  step: { position: number; channel: string; tone: string; objective: string };
}

interface Stats {
  total_enrollments: number;
  ativos: number;
  pendentes_aprovacao: number;
  total_enviados: number;
  convertidos: number;
  taxa_conversao: number;
  por_canal?: {
    whatsapp?: { enviados: number; respondidos: number };
    email?: { enviados: number; respondidos: number };
    ligacao?: { enviados: number; respondidos: number };
  };
  legacy?: {
    enviados_24h: number;
    enviados_7d: number;
    enviados_30d: number;
    enviados_total: number;
    arquivados_ia_7d: number;
    arquivados_ia_30d: number;
    ultimo_envio_at: string | null;
    proximo_cron_at: string;
  };
}

interface LeadSearchResult {
  id: string;
  name?: string;
  phone: string;
  stage: string;
}

interface BroadcastTarget {
  event_id: string;
  event_title: string;
  event_date: string;
  event_location?: string;
  lead_id: string;
  lead_name?: string;
  lead_phone: string;
  lead_stage: string;
  case_number?: string;
  case_type?: string;
  court?: string;
}

interface BroadcastJob {
  id: string;
  name: string;
  type: string;
  status: string;
  total_targets: number;
  sent_count: number;
  failed_count: number;
  interval_ms: number;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  created_by?: { name: string };
  items?: BroadcastItem[];
  _count?: { items: number };
}

interface BroadcastItem {
  id: string;
  lead_id: string;
  phone: string;
  generated_text?: string;
  status: string;
  sent_at?: string;
  error?: string;
}

interface QueueItem {
  lead_id: string;
  lead_name?: string | null;
  lead_phone: string;
  lead_stage: string;
  source: 'enrollment' | 'legacy';
  enrollment_id: string | null;
  sequence_name: string | null;
  current_step: number | null;
  total_steps: number | null;
  last_followup: {
    text: string;
    sent_at: string;
    status: string;
  } | null;
  next_scheduled_at: string | null;
  days_inactive: number;
}

interface QueueResponse {
  total: number;
  enrollment_count: number;
  legacy_count: number;
  items: QueueItem[];
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const API = API_BASE_URL;

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: BarChart2 },
  { id: 'fila', label: 'Fila', icon: Clock },
  { id: 'sequencias', label: 'Sequências', icon: List },
  { id: 'enrollments', label: 'Enrollments', icon: Users },
  { id: 'aprovacoes', label: 'Aprovações', icon: MessageSquare },
  { id: 'disparos', label: 'Disparos', icon: Radio },
] as const;

type TabId = (typeof TABS)[number]['id'];

const CATEGORIES = [
  { id: 'LEADS', label: 'Leads', color: '#3b82f6' },
  { id: 'CLIENTS', label: 'Clientes', color: '#22c55e' },
  { id: 'COBRANCA', label: 'Cobrança', color: '#f59e0b' },
  { id: 'REENGAJAMENTO', label: 'Reengajamento', color: '#8b5cf6' },
];

const STAGES = [
  { id: 'QUALIFICANDO', label: 'Qualificando' },
  { id: 'AGUARDANDO_DOCS', label: 'Aguardando Docs' },
  { id: 'AGUARDANDO_PROC', label: 'Aguardando Proc.' },
];

const CHANNELS = [
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'email', label: 'E-mail' },
  { id: 'ligacao', label: 'Ligação' },
];

const TONES = [
  { id: 'amigavel', label: 'Amigável' },
  { id: 'profissional', label: 'Profissional' },
  { id: 'empatico', label: 'Empático' },
  { id: 'firme', label: 'Firme' },
];

const ENROLLMENT_STATUSES = [
  { id: '', label: 'Todos' },
  { id: 'ATIVO', label: 'Ativo', color: '#22c55e' },
  { id: 'PAUSADO', label: 'Pausado', color: '#f59e0b' },
  { id: 'CONCLUIDO', label: 'Concluído', color: '#6b7280' },
  { id: 'CANCELADO', label: 'Cancelado', color: '#ef4444' },
  { id: 'CONVERTIDO', label: 'Convertido', color: '#8b5cf6' },
];

const RISK_COLORS: Record<string, string> = {
  BAIXO: 'text-green-400 bg-green-400/10',
  MEDIO: 'text-yellow-400 bg-yellow-400/10',
  ALTO: 'text-red-400 bg-red-400/10',
};

const CATEGORY_COLORS: Record<string, string> = {
  LEADS: 'text-blue-400 bg-blue-400/10',
  CLIENTS: 'text-green-400 bg-green-400/10',
  COBRANCA: 'text-yellow-400 bg-yellow-400/10',
  REENGAJAMENTO: 'text-purple-400 bg-purple-400/10',
};

const STATUS_COLORS: Record<string, string> = {
  ATIVO: 'text-green-400 bg-green-400/10',
  PAUSADO: 'text-yellow-400 bg-yellow-400/10',
  CONCLUIDO: 'text-muted-foreground bg-gray-400/10',
  CANCELADO: 'text-red-400 bg-red-400/10',
  CONVERTIDO: 'text-purple-400 bg-purple-400/10',
};

// ─── Fetch helper ─────────────────────────────────────────────────────────────

async function apiFetch(path: string, options?: RequestInit) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options?.headers,
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso?: string | null) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

function Badge({ label, colorClass }: { label: string; colorClass: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colorClass}`}>
      {label}
    </span>
  );
}

// ─── Modais ──────────────────────────────────────────────────────────────────

interface ModalProps { onClose: () => void; children: React.ReactNode; title: string; large?: boolean }

function Modal({ onClose, children, title, large }: ModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className={`relative z-10 w-full ${large ? 'max-w-3xl' : 'max-w-lg'} bg-card border border-border rounded-2xl shadow-2xl flex flex-col max-h-[90vh] animate-in slide-in-from-bottom-4 duration-200`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-200"
          >
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto p-6 space-y-4">{children}</div>
      </div>
    </div>
  );
}

function inputCls(extra = '') {
  return `w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors ${extra}`;
}

function labelCls() {
  return 'block text-xs font-medium text-muted-foreground mb-1';
}

// ─── Modal: Criar/Editar Sequência ────────────────────────────────────────────

interface SeqForm {
  name: string;
  description: string;
  category: string;
  auto_enroll_stages: string[];
  max_attempts: number;
}

function SequenceModal({
  initial,
  onClose,
  onSave,
}: {
  initial?: Partial<FollowupSequence>;
  onClose: () => void;
  onSave: (form: SeqForm) => Promise<void>;
}) {
  const [form, setForm] = useState<SeqForm>({
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    category: initial?.category ?? 'LEADS',
    auto_enroll_stages: initial?.auto_enroll_stages ?? [],
    max_attempts: initial?.max_attempts ?? 3,
  });
  const [saving, setSaving] = useState(false);

  const toggleStage = (stage: string) => {
    setForm(f => ({
      ...f,
      auto_enroll_stages: f.auto_enroll_stages.includes(stage)
        ? f.auto_enroll_stages.filter(s => s !== stage)
        : [...f.auto_enroll_stages, stage],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { showError('Nome obrigatório'); return; }
    setSaving(true);
    try { await onSave(form); onClose(); }
    catch (err: unknown) { showError(err instanceof Error ? err.message : 'Erro ao salvar'); }
    finally { setSaving(false); }
  };

  return (
    <Modal title={initial?.id ? 'Editar Sequência' : 'Nova Sequência'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className={labelCls()}>Nome *</label>
          <input
            className={inputCls()}
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="Ex: Follow-up leads frios"
          />
        </div>

        <div>
          <label className={labelCls()}>Descrição</label>
          <input
            className={inputCls()}
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder="Descrição opcional"
          />
        </div>

        <div>
          <label className={labelCls()}>Categoria *</label>
          <select
            className={inputCls()}
            value={form.category}
            onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
          >
            {CATEGORIES.map(c => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelCls()}>Auto-enroll nos stages</label>
          <div className="flex flex-wrap gap-2 mt-1">
            {STAGES.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => toggleStage(s.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-200 ${
                  form.auto_enroll_stages.includes(s.id)
                    ? 'bg-blue-600 border-blue-500 text-foreground'
                    : 'bg-muted border-border text-muted-foreground hover:border-border'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className={labelCls()}>Máximo de tentativas</label>
          <input
            type="number"
            min={1}
            max={20}
            className={inputCls()}
            value={form.max_attempts}
            onChange={e => setForm(f => ({ ...f, max_attempts: Number(e.target.value) }))}
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-border text-sm transition-all duration-200"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-foreground text-sm font-medium transition-all duration-200"
          >
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Modal: Adicionar Step ────────────────────────────────────────────────────

interface StepForm {
  position: number;
  delay_hours: number;
  channel: string;
  tone: string;
  objective: string;
  custom_prompt: string;
  auto_send: boolean;
}

function StepModal({
  sequenceId,
  initial,
  onClose,
  onSave,
}: {
  sequenceId: string;
  initial?: Partial<FollowupStep>;
  onClose: () => void;
  onSave: (form: StepForm) => Promise<void>;
}) {
  const [form, setForm] = useState<StepForm>({
    position: initial?.position ?? 1,
    delay_hours: initial?.delay_hours ?? 24,
    channel: initial?.channel ?? 'whatsapp',
    tone: initial?.tone ?? 'amigavel',
    objective: initial?.objective ?? '',
    custom_prompt: initial?.custom_prompt ?? '',
    auto_send: initial?.auto_send ?? false,
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.objective.trim()) { showError('Objetivo obrigatório'); return; }
    setSaving(true);
    try { await onSave(form); onClose(); }
    catch (err: unknown) { showError(err instanceof Error ? err.message : 'Erro ao salvar'); }
    finally { setSaving(false); }
  };

  return (
    <Modal title={initial?.id ? 'Editar Step' : 'Novo Step'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls()}>Posição</label>
            <input
              type="number"
              min={1}
              className={inputCls()}
              value={form.position}
              onChange={e => setForm(f => ({ ...f, position: Number(e.target.value) }))}
            />
          </div>
          <div>
            <label className={labelCls()}>Delay (horas)</label>
            <input
              type="number"
              min={0}
              className={inputCls()}
              value={form.delay_hours}
              onChange={e => setForm(f => ({ ...f, delay_hours: Number(e.target.value) }))}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls()}>Canal</label>
            <select
              className={inputCls()}
              value={form.channel}
              onChange={e => setForm(f => ({ ...f, channel: e.target.value }))}
            >
              {CHANNELS.map(c => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls()}>Tom</label>
            <select
              className={inputCls()}
              value={form.tone}
              onChange={e => setForm(f => ({ ...f, tone: e.target.value }))}
            >
              {TONES.map(t => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className={labelCls()}>Objetivo *</label>
          <input
            className={inputCls()}
            value={form.objective}
            onChange={e => setForm(f => ({ ...f, objective: e.target.value }))}
            placeholder="Ex: Reativar lead com proposta de consulta gratuita"
          />
        </div>

        <div>
          <label className={labelCls()}>Prompt personalizado (opcional)</label>
          <textarea
            className={inputCls('resize-none')}
            rows={3}
            value={form.custom_prompt}
            onChange={e => setForm(f => ({ ...f, custom_prompt: e.target.value }))}
            placeholder="Instruções adicionais para a IA..."
          />
        </div>

        <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
          <div>
            <p className="text-sm font-medium text-foreground">Envio automático</p>
            <p className="text-xs text-muted-foreground mt-0.5">Envia sem aprovação humana</p>
          </div>
          <button
            type="button"
            onClick={() => setForm(f => ({ ...f, auto_send: !f.auto_send }))}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-all duration-200 ${
              form.auto_send ? 'bg-blue-600' : 'bg-muted'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white transition-transform duration-200 ${
                form.auto_send ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-border text-sm transition-all duration-200"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-foreground text-sm font-medium transition-all duration-200"
          >
            {saving ? 'Salvando...' : 'Salvar Step'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── MELHORIA 1: Modal Ver Contexto ──────────────────────────────────────────

interface ContextData {
  pessoa?: {
    id?: string;
    nome?: string;
    telefone?: string;
    email?: string;
    tipo?: string;
    estagio?: string;
    canal_preferido?: string;
    horario_responde_mais?: string;
    dias_sem_contato?: number;
    inadimplente?: boolean;
    valor_devido?: number;
    advogado_responsavel?: string;
    origem?: string;
  };
  historico?: {
    total_msgs?: number;
    sentimento_geral?: string;
    sentimento?: string;
    ultima_msg_resumo?: string;
    ultima_msg_direcao?: string;
    dias_sem_resposta?: number;
    ultimas_msgs?: Array<{ direcao: string; text: string; created_at: string }>;
  };
  processual?: {
    processos?: Array<{
      numero?: string;
      tipo?: string;
      area?: string;
      status?: string;
    }>;
  };
  financeiro?: {
    inadimplente?: boolean;
    valor_devido?: number;
    dias_atraso?: number;
  };
  tarefa?: {
    sequencia_nome?: string;
    categoria?: string;
    step_position?: number;
    total_steps?: number;
    tentativa_numero?: number;
    objetivo?: string;
    tom?: string;
    canal?: string;
    mensagens_anteriores?: string[];
  };
}

function ContextModal({ msg, onClose }: { msg: FollowupMessage; onClose: () => void }) {
  const ctx = (msg.context_json ?? {}) as ContextData;

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border/60 pb-1.5">
        {title}
      </h3>
      {children}
    </div>
  );

  const Row = ({ label, value }: { label: string; value?: string | number | boolean | null }) => {
    if (value === undefined || value === null || value === '') return null;
    return (
      <div className="flex items-start justify-between gap-3 text-sm">
        <span className="text-muted-foreground shrink-0">{label}</span>
        <span className="text-gray-200 text-right">{String(value)}</span>
      </div>
    );
  };

  return (
    <Modal title="Dossiê de Contexto da IA" onClose={onClose} large>
      <div className="space-y-6">
        {/* Lead */}
        <Section title="Dados do Lead">
          <div className="bg-muted/60 rounded-xl p-4 space-y-2">
            <Row label="Nome" value={ctx.pessoa?.nome || msg.enrollment.lead.name || msg.enrollment.lead.phone} />
            <Row label="Stage" value={ctx.pessoa?.estagio || msg.enrollment.lead.stage} />
            <Row label="Tipo" value={ctx.pessoa?.tipo} />
            <Row label="Dias sem contato" value={ctx.pessoa?.dias_sem_contato !== undefined ? `${ctx.pessoa.dias_sem_contato} dias` : undefined} />
            <Row label="Canal preferido" value={ctx.pessoa?.canal_preferido} />
            <Row label="Horário que mais responde" value={ctx.pessoa?.horario_responde_mais} />
            <Row label="Advogado responsável" value={ctx.pessoa?.advogado_responsavel} />
            <Row label="Origem" value={ctx.pessoa?.origem} />
            {!ctx.pessoa && <p className="text-xs text-muted-foreground/60 italic">Dados do lead não disponíveis no contexto.</p>}
          </div>
        </Section>

        {/* Histórico */}
        <Section title="Histórico de Conversa">
          <div className="bg-muted/60 rounded-xl p-4 space-y-2">
            <Row label="Total de mensagens" value={ctx.historico?.total_msgs} />
            <Row label="Sentimento geral" value={ctx.historico?.sentimento_geral || ctx.historico?.sentimento} />
            <Row label="Dias sem resposta" value={ctx.historico?.dias_sem_resposta !== undefined ? `${ctx.historico.dias_sem_resposta} dias` : undefined} />
            <Row label="Resumo da última msg" value={ctx.historico?.ultima_msg_resumo} />
            <Row label="Última msg enviada por" value={ctx.historico?.ultima_msg_direcao === 'in' ? 'Cliente' : ctx.historico?.ultima_msg_direcao === 'out' ? 'Escritório' : ctx.historico?.ultima_msg_direcao} />
            {!ctx.historico && <p className="text-xs text-muted-foreground/60 italic">Histórico não disponível no contexto.</p>}
          </div>
        </Section>

        {/* Processos */}
        {(ctx.processual?.processos?.length ?? 0) > 0 ? (
          <Section title="Dados Processuais">
            <div className="space-y-2">
              {ctx.processual!.processos!.map((p, i) => (
                <div key={i} className="bg-muted/60 rounded-xl p-3 flex flex-wrap gap-3 text-sm">
                  {p.numero ? <span className="text-blue-300 font-mono text-xs">{p.numero}</span> : null}
                  {p.tipo ? <Badge label={p.tipo} colorClass="text-foreground/80 bg-muted/50" /> : null}
                  {p.area ? <Badge label={p.area} colorClass="text-blue-400 bg-blue-400/10" /> : null}
                  {p.status ? <Badge label={p.status} colorClass="text-green-400 bg-green-400/10" /> : null}
                </div>
              ))}
            </div>
          </Section>
        ) : null}

        {/* Financeiro */}
        {ctx.financeiro ? (
          <Section title="Dados Financeiros">
            <div className="bg-muted/60 rounded-xl p-4 space-y-2">
              <Row
                label="Inadimplente"
                value={ctx.financeiro.inadimplente ? 'Sim' : 'Não'}
              />
              {ctx.financeiro.valor_devido !== undefined && ctx.financeiro.valor_devido > 0 ? (
                <Row
                  label="Valor devido"
                  value={new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(ctx.financeiro.valor_devido!)}
                />
              ) : null}
            </div>
          </Section>
        ) : null}

        {/* Sequência */}
        <Section title="Informações da Sequência">
          <div className="bg-muted/60 rounded-xl p-4 space-y-2">
            <Row label="Nome da sequência" value={ctx.tarefa?.sequencia_nome || msg.enrollment.sequence.name} />
            <Row label="Categoria" value={ctx.tarefa?.categoria} />
            <Row label="Objetivo do step" value={ctx.tarefa?.objetivo || msg.step.objective} />
            <Row label="Tom" value={ctx.tarefa?.tom || msg.step.tone} />
            <Row label="Canal" value={ctx.tarefa?.canal || msg.step.channel} />
            <Row label="Step" value={ctx.tarefa?.step_position !== undefined ? `${ctx.tarefa.step_position} de ${ctx.tarefa.total_steps}` : String(msg.step.position)} />
            {ctx.tarefa?.tentativa_numero !== undefined && (
              <Row label="Tentativa" value={`#${ctx.tarefa.tentativa_numero}`} />
            )}
          </div>
        </Section>

        {/* Mensagens anteriores da enrollment */}
        {msg.enrollment.messages && msg.enrollment.messages.length > 0 && (
          <Section title="Mensagens Anteriores nesta Sequência">
            <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
              {(msg.enrollment.messages as Array<{ id: string; generated_text?: string; sent_text?: string; status: string; created_at: string; channel: string }>).map((m, i) => (
                <div key={m.id ?? i} className="bg-muted/60 rounded-lg p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <Badge label={m.status} colorClass={STATUS_COLORS[m.status] ?? 'text-muted-foreground bg-muted/50'} />
                    <span className="text-muted-foreground">{formatDate(m.created_at)}</span>
                  </div>
                  <p className="text-foreground/80 line-clamp-3">{m.sent_text || m.generated_text || '—'}</p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Contexto bruto se não houver estrutura */}
        {!ctx.pessoa && !ctx.historico && !ctx.processual && !ctx.financeiro && !ctx.tarefa && msg.context_json && (
          <Section title="Contexto Bruto (JSON)">
            <pre className="bg-muted/60 rounded-xl p-4 text-xs text-foreground/80 overflow-auto max-h-64 whitespace-pre-wrap">
              {JSON.stringify(msg.context_json, null, 2)}
            </pre>
          </Section>
        )}

        {!msg.context_json && (
          <div className="text-center py-8 text-muted-foreground/60">
            <FileJson size={32} className="mx-auto mb-2 opacity-40" />
            <p className="text-sm">Nenhum contexto disponível para esta mensagem.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── MELHORIA 4: Modal Enrolar Lead ──────────────────────────────────────────

function EnrollLeadModal({
  sequences,
  onClose,
  onEnroll,
}: {
  sequences: FollowupSequence[];
  onClose: () => void;
  onEnroll: (leadId: string, sequenceId: string) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [leads, setLeads] = useState<LeadSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedLead, setSelectedLead] = useState<LeadSearchResult | null>(null);
  const [selectedSeq, setSelectedSeq] = useState(sequences[0]?.id ?? '');
  const [enrolling, setEnrolling] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchLeads = useCallback(async (term: string) => {
    if (!term.trim()) { setLeads([]); return; }
    setSearching(true);
    try {
      const data = await apiFetch(`/leads?search=${encodeURIComponent(term)}`);
      setLeads(Array.isArray(data) ? data : data.leads ?? []);
    } catch {
      setLeads([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchLeads(search), 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, searchLeads]);

  const handleConfirm = async () => {
    if (!selectedLead) { showError('Selecione um lead'); return; }
    if (!selectedSeq) { showError('Selecione uma sequência'); return; }
    setEnrolling(true);
    try {
      await onEnroll(selectedLead.id, selectedSeq);
      onClose();
    } catch (err: unknown) {
      showError(err instanceof Error ? err.message : 'Erro ao enrolar lead');
    } finally {
      setEnrolling(false);
    }
  };

  return (
    <Modal title="Enrolar Lead em Sequência" onClose={onClose}>
      <div className="space-y-4">
        {/* Busca de lead */}
        <div>
          <label className={labelCls()}>Buscar Lead</label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              className="w-full bg-muted border border-border rounded-lg pl-8 pr-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors"
              placeholder="Nome ou telefone..."
              value={search}
              onChange={e => { setSearch(e.target.value); setSelectedLead(null); }}
              autoFocus
            />
          </div>
        </div>

        {/* Lista de leads */}
        {search.trim() && (
          <div className="border border-border rounded-lg overflow-hidden max-h-48 overflow-y-auto">
            {searching ? (
              <div className="flex items-center justify-center py-6 text-muted-foreground text-sm gap-2">
                <RefreshCw size={14} className="animate-spin" /> Buscando...
              </div>
            ) : leads.length === 0 ? (
              <div className="py-6 text-center text-muted-foreground/60 text-sm">
                Nenhum lead encontrado
              </div>
            ) : (
              leads.map(lead => (
                <button
                  key={lead.id}
                  onClick={() => setSelectedLead(lead)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left text-sm transition-all duration-200 border-b border-border last:border-0 ${
                    selectedLead?.id === lead.id
                      ? 'bg-blue-600/20 text-blue-300'
                      : 'hover:bg-muted text-foreground/80'
                  }`}
                >
                  <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground shrink-0">
                    {(lead.name?.[0] ?? lead.phone[0]).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{lead.name || '—'}</p>
                    <p className="text-xs text-muted-foreground">{lead.phone} · {lead.stage}</p>
                  </div>
                  {selectedLead?.id === lead.id && <CheckCircle size={14} className="text-blue-400 shrink-0" />}
                </button>
              ))
            )}
          </div>
        )}

        {/* Lead selecionado */}
        {selectedLead && (
          <div className="flex items-center gap-2 px-3 py-2 bg-blue-600/10 border border-blue-500/30 rounded-lg text-sm">
            <CheckCircle size={14} className="text-blue-400" />
            <span className="text-blue-300 font-medium">{selectedLead.name || selectedLead.phone}</span>
          </div>
        )}

        {/* Sequência */}
        <div>
          <label className={labelCls()}>Sequência</label>
          <select
            className={inputCls()}
            value={selectedSeq}
            onChange={e => setSelectedSeq(e.target.value)}
          >
            {sequences.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-border text-sm transition-all duration-200"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={enrolling || !selectedLead}
            className="flex-1 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-foreground text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2"
          >
            {enrolling ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />}
            {enrolling ? 'Enrolando...' : 'Enrolar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── MELHORIA 3: Badge de Risco Aprimorado ───────────────────────────────────

function RiskBadge({ level }: { level: string }) {
  const normalized = level?.toUpperCase() ?? '';

  if (normalized === 'ALTO') {
    return (
      <div className="flex flex-col items-end gap-1">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium text-red-400 bg-red-400/10 border border-red-400/20 animate-pulse">
          <AlertOctagon size={11} />
          ALTO
        </span>
        <span className="text-xs text-red-400/80 font-medium">Requer revisão cuidadosa</span>
      </div>
    );
  }

  if (normalized === 'MEDIO') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 transition-all duration-200">
        <AlertTriangle size={11} />
        MÉDIO
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium text-green-400 bg-green-400/10 border border-green-400/20 transition-all duration-200">
      <Shield size={11} />
      BAIXO
    </span>
  );
}

// ─── Card de Aprovação ────────────────────────────────────────────────────────

function ApprovalCard({
  msg,
  onApprove,
  onReject,
  onRegenerate,
  onViewContext,
}: {
  msg: FollowupMessage;
  onApprove: (id: string, text: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onRegenerate: (id: string) => Promise<void>;
  onViewContext: (msg: FollowupMessage) => void;
}) {
  const [text, setText] = useState(msg.generated_text);
  const [loading, setLoading] = useState<string | null>(null);

  const handle = async (action: () => Promise<void>, key: string) => {
    setLoading(key);
    try { await action(); }
    catch (err: unknown) { showError(err instanceof Error ? err.message : 'Erro'); }
    finally { setLoading(null); }
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4 transition-all duration-200 hover:border-border">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">
            {msg.enrollment.lead.name || msg.enrollment.lead.phone}
          </p>
          <p className="text-xs text-muted-foreground">
            {msg.enrollment.sequence.name} · Step {msg.step.position} · {msg.step.channel.toUpperCase()}
          </p>
          <p className="text-xs text-muted-foreground">
            Stage: <span className="text-foreground/80">{msg.enrollment.lead.stage}</span>
            {' · '}Tom: <span className="text-foreground/80 capitalize">{msg.step.tone}</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <RiskBadge level={msg.risk_level} />
          <span className="text-xs text-muted-foreground">{formatDate(msg.created_at)}</span>
        </div>
      </div>

      {/* Objetivo */}
      <div className="bg-background/50 rounded-lg px-3 py-2">
        <p className="text-xs text-muted-foreground font-medium mb-0.5">Objetivo</p>
        <p className="text-xs text-foreground/80">{msg.step.objective}</p>
      </div>

      {/* Texto gerado (editável) */}
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">
          Mensagem gerada pela IA (editável)
        </label>
        <textarea
          className="w-full bg-background border border-gray-600 rounded-lg px-3 py-2 text-sm text-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors"
          rows={4}
          value={text}
          onChange={e => setText(e.target.value)}
        />
      </div>

      {/* Ações */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => {
            if (msg.risk_level?.toUpperCase() === 'ALTO') {
              if (!confirm('Esta mensagem tem risco ALTO. Tem certeza que deseja aprovar e enviar?')) return;
            }
            handle(() => onApprove(msg.id, text), 'approve');
          }}
          disabled={!!loading}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-green-600/20 border border-green-600/30 text-green-400 hover:bg-green-600/30 disabled:opacity-50 text-sm font-medium transition-all duration-200"
        >
          {loading === 'approve' ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle size={14} />}
          Aprovar
        </button>

        <button
          onClick={() => handle(() => onReject(msg.id), 'reject')}
          disabled={!!loading}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-red-600/20 border border-red-600/30 text-red-400 hover:bg-red-600/30 disabled:opacity-50 text-sm font-medium transition-all duration-200"
        >
          {loading === 'reject' ? <RefreshCw size={14} className="animate-spin" /> : <XCircle size={14} />}
          Rejeitar
        </button>

        <button
          onClick={() => handle(() => onRegenerate(msg.id), 'regen')}
          disabled={!!loading}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600/20 border border-blue-600/30 text-blue-400 hover:bg-blue-600/30 disabled:opacity-50 text-sm font-medium transition-all duration-200"
        >
          {loading === 'regen' ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Regenerar
        </button>

        <button
          onClick={() => onViewContext(msg)}
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-muted/50 border border-gray-600/30 text-foreground/80 hover:bg-muted/80 hover:text-foreground text-sm font-medium transition-all duration-200"
          title="Ver contexto usado pela IA"
        >
          <Eye size={14} />
          Contexto
        </button>
      </div>
    </div>
  );
}

// ─── MELHORIA 2: Efetividade por Canal ───────────────────────────────────────

function ChannelEffectivityCards({ stats, enrollments }: { stats: Stats; enrollments: FollowupEnrollment[] }) {
  // Calcular dados por canal a partir dos enrollments se API não retornar
  const calcChannel = (channel: string) => {
    if (stats.por_canal?.[channel as keyof typeof stats.por_canal]) {
      const c = stats.por_canal[channel as keyof typeof stats.por_canal]!;
      const taxa = c.enviados > 0 ? ((c.respondidos / c.enviados) * 100).toFixed(1) : '0.0';
      return { enviados: c.enviados, respondidos: c.respondidos, taxa };
    }
    // fallback: aproximação com enrollments disponíveis
    const enviados = stats.total_enviados > 0 ? Math.round(stats.total_enviados / 3) : 0;
    const convertidos = stats.convertidos > 0 ? Math.round(stats.convertidos / 3) : 0;
    const taxa = enviados > 0 ? ((convertidos / enviados) * 100).toFixed(1) : '0.0';
    return { enviados, respondidos: convertidos, taxa };
  };

  const channels = [
    {
      id: 'whatsapp',
      label: 'WhatsApp',
      icon: Smartphone,
      color: 'text-green-400',
      bg: 'from-green-600/20 to-green-800/10',
      border: 'border-green-500/20',
      data: calcChannel('whatsapp'),
    },
    {
      id: 'email',
      label: 'E-mail',
      icon: Mail,
      color: 'text-blue-400',
      bg: 'from-blue-600/20 to-blue-800/10',
      border: 'border-blue-500/20',
      data: calcChannel('email'),
    },
    {
      id: 'ligacao',
      label: 'Ligação',
      icon: Phone,
      color: 'text-purple-400',
      bg: 'from-purple-600/20 to-purple-800/10',
      border: 'border-purple-500/20',
      data: calcChannel('ligacao'),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <TrendingUp size={16} className="text-blue-400" />
        <h3 className="text-sm font-semibold text-foreground">Efetividade por Canal</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {channels.map(ch => {
          const Icon = ch.icon;
          return (
            <div
              key={ch.id}
              className={`bg-gradient-to-br ${ch.bg} border ${ch.border} rounded-2xl p-5 space-y-3 transition-all duration-200`}
            >
              <div className="flex items-center gap-2">
                <div className={`p-2 rounded-lg bg-background/40 ${ch.color}`}>
                  <Icon size={16} />
                </div>
                <span className={`text-sm font-semibold ${ch.color}`}>{ch.label}</span>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground text-xs">Enviados</span>
                  <span className="text-foreground font-semibold">{ch.data.enviados}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground text-xs">Convertidos</span>
                  <span className="text-foreground font-semibold">{ch.data.respondidos}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground text-xs">Taxa</span>
                  <span className={`font-bold ${ch.color}`}>{ch.data.taxa}%</span>
                </div>
                {/* Barra de progresso */}
                <div className="w-full bg-muted/50 rounded-full h-1.5 mt-1">
                  <div
                    className={`h-1.5 rounded-full transition-all duration-500 ${ch.color.replace('text-', 'bg-')}`}
                    style={{ width: `${Math.min(100, parseFloat(ch.data.taxa))}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── MELHORIA 6: Status de Resposta do Lead ──────────────────────────────────

function LeadResponseStatus({ enrollment }: { enrollment: FollowupEnrollment }) {
  if (!enrollment.last_sent_at) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }

  // Se tiver dados de mensagens com detalhes, podemos inferir
  const msgs = enrollment.messages as Array<{ direction?: string; created_at?: string }> | undefined;
  if (msgs && msgs.length > 0) {
    const lastInbound = msgs.find(m => m.direction === 'inbound' || m.direction === 'received');
    const lastSentAt = new Date(enrollment.last_sent_at);
    if (lastInbound?.created_at && new Date(lastInbound.created_at) > lastSentAt) {
      return (
        <span className="inline-flex items-center gap-1 text-green-400 text-xs font-medium">
          <CheckCircle size={12} />
          Respondeu
        </span>
      );
    }
  }

  // Heurística: se status é CONVERTIDO = respondeu
  if (enrollment.status === 'CONVERTIDO') {
    return (
      <span className="inline-flex items-center gap-1 text-green-400 text-xs font-medium">
        <CheckCircle size={12} />
        Convertido
      </span>
    );
  }

  // Sem resposta (última ação foi o escritório enviar)
  return (
    <span className="inline-flex items-center gap-1 text-red-400 text-xs font-medium">
      <XCircle size={12} />
      Sem resposta
    </span>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function FollowupPage() {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');

  // Dados
  const [stats, setStats] = useState<Stats | null>(null);
  const [sequences, setSequences] = useState<FollowupSequence[]>([]);
  const [enrollments, setEnrollments] = useState<FollowupEnrollment[]>([]);
  const [approvals, setApprovals] = useState<FollowupMessage[]>([]);

  // Loading
  const [loadingStats, setLoadingStats] = useState(false);
  const [loadingSeq, setLoadingSeq] = useState(false);
  const [loadingEnroll, setLoadingEnroll] = useState(false);
  const [loadingApprovals, setLoadingApprovals] = useState(false);
  const [loadingSeed, setLoadingSeed] = useState(false);

  // Modais existentes
  const [seqModal, setSeqModal] = useState<{ open: boolean; seq?: FollowupSequence }>({ open: false });
  const [stepModal, setStepModal] = useState<{ open: boolean; seqId: string; step?: FollowupStep }>({ open: false, seqId: '' });
  const [expandedSeq, setExpandedSeq] = useState<string | null>(null);

  // MELHORIA 1: Modal de contexto
  const [contextModal, setContextModal] = useState<{ open: boolean; message: FollowupMessage | null }>({ open: false, message: null });

  // MELHORIA 4: Modal enrolar lead
  const [enrollModal, setEnrollModal] = useState(false);

  // Filtros enrollments
  const [enrollFilter, setEnrollFilter] = useState('');
  const [enrollSearch, setEnrollSearch] = useState('');

  // Fila de followup (leads aptos a receber)
  const [queue, setQueue] = useState<QueueResponse | null>(null);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [triggeringLeadId, setTriggeringLeadId] = useState<string | null>(null);
  const [queueSearch, setQueueSearch] = useState('');
  const [queueSourceFilter, setQueueSourceFilter] = useState<'ALL' | 'enrollment' | 'legacy'>('ALL');
  // null = usa defaults por stage (3/3/2/5). 0 = todos sem cutoff. N = N dias pra todos.
  const [queueMinDays, setQueueMinDays] = useState<number | null>(null);

  // Disparos
  const [broadcastTargets, setBroadcastTargets] = useState<BroadcastTarget[]>([]);
  const [broadcasts, setBroadcasts] = useState<BroadcastJob[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingBroadcasts, setLoadingBroadcasts] = useState(false);
  const [dispatchingBroadcast, setDispatchingBroadcast] = useState(false);
  const [broadcastType, setBroadcastType] = useState<'AUDIENCIA' | 'COMUNICADO'>('AUDIENCIA');
  const [broadcastDaysAhead, setBroadcastDaysAhead] = useState(7);
  // Default elevado pra 20s (2026-05-13) — intervalos curtos foram a causa
  // raiz do ban WhatsApp em 2026-04-28. Backend clampa 15s minimo.
  const [broadcastInterval, setBroadcastInterval] = useState(20);
  const [broadcastCustomPrompt, setBroadcastCustomPrompt] = useState('');
  const [activeBroadcast, setActiveBroadcast] = useState<BroadcastJob | null>(null);
  const [expandedBroadcast, setExpandedBroadcast] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch functions ─────────────────────────────────────────────────────────

  const fetchStats = useCallback(async () => {
    setLoadingStats(true);
    try {
      const data = await apiFetch('/followup/stats');
      setStats(data);
    } catch (err: unknown) {
      showError(err instanceof Error ? err.message : 'Erro ao carregar stats');
    } finally {
      setLoadingStats(false);
    }
  }, []);

  const fetchSequences = useCallback(async () => {
    setLoadingSeq(true);
    try {
      const data = await apiFetch('/followup/sequences');
      setSequences(Array.isArray(data) ? data : data.sequences ?? []);
    } catch (err: unknown) {
      showError(err instanceof Error ? err.message : 'Erro ao carregar sequências');
    } finally {
      setLoadingSeq(false);
    }
  }, []);

  const fetchEnrollments = useCallback(async () => {
    setLoadingEnroll(true);
    try {
      const qs = enrollFilter ? `?status=${enrollFilter}` : '';
      const data = await apiFetch(`/followup/enrollments${qs}`);
      setEnrollments(Array.isArray(data) ? data : data.enrollments ?? []);
    } catch (err: unknown) {
      showError(err instanceof Error ? err.message : 'Erro ao carregar enrollments');
    } finally {
      setLoadingEnroll(false);
    }
  }, [enrollFilter]);

  const fetchApprovals = useCallback(async () => {
    setLoadingApprovals(true);
    try {
      const data = await apiFetch('/followup/approvals');
      setApprovals(Array.isArray(data) ? data : data.messages ?? []);
    } catch (err: unknown) {
      showError(err instanceof Error ? err.message : 'Erro ao carregar aprovações');
    } finally {
      setLoadingApprovals(false);
    }
  }, []);

  const fetchQueue = useCallback(async () => {
    setLoadingQueue(true);
    try {
      const qs = queueMinDays !== null ? `?min_days=${queueMinDays}` : '';
      const data = await apiFetch(`/followup/queue${qs}`);
      setQueue(data as QueueResponse);
    } catch (err: unknown) {
      showError(err instanceof Error ? err.message : 'Erro ao carregar fila');
    } finally {
      setLoadingQueue(false);
    }
  }, [queueMinDays]);

  const handleTriggerQueue = async (item: QueueItem) => {
    const label = item.lead_name || item.lead_phone;
    if (!confirm(`Disparar followup agora para ${label}? A IA vai gerar a mensagem com base na conversa.`)) return;
    setTriggeringLeadId(item.lead_id);
    try {
      await apiFetch(`/followup/queue/trigger/${item.lead_id}`, { method: 'POST' });
      showSuccess(`Disparo enfileirado para ${label}`);
      // Aguarda o worker processar e recarrega a fila
      setTimeout(() => fetchQueue(), 2500);
    } catch (err: unknown) {
      showError(err instanceof Error ? err.message : 'Erro ao disparar');
    } finally {
      setTriggeringLeadId(null);
    }
  };

  // ── Broadcast fetch functions ────────────────────────────────────────────────

  const fetchBroadcastPreview = useCallback(async () => {
    setLoadingPreview(true);
    try {
      const data = await apiFetch(`/followup/broadcasts/preview?type=${broadcastType}&days_ahead=${broadcastDaysAhead}`);
      setBroadcastTargets(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      showError(err instanceof Error ? err.message : 'Erro ao carregar preview');
    } finally {
      setLoadingPreview(false);
    }
  }, [broadcastType, broadcastDaysAhead]);

  const fetchBroadcasts = useCallback(async () => {
    setLoadingBroadcasts(true);
    try {
      const data = await apiFetch('/followup/broadcasts');
      setBroadcasts(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      showError(err instanceof Error ? err.message : 'Erro ao carregar disparos');
    } finally {
      setLoadingBroadcasts(false);
    }
  }, []);

  const handleDispatchBroadcast = async () => {
    if (broadcastTargets.length === 0) { showError('Nenhum alvo encontrado'); return; }
    const confirmMsg = broadcastType === 'COMUNICADO'
      ? `Disparar comunicado para ${broadcastTargets.length} clientes com intervalo de ${broadcastInterval}s entre cada?`
      : `Disparar ${broadcastTargets.length} mensagens com intervalo de ${broadcastInterval}s entre cada? As mensagens serão geradas por IA individualmente.`;
    if (!confirm(confirmMsg)) return;
    setDispatchingBroadcast(true);
    try {
      const result = await apiFetch('/followup/broadcasts', {
        method: 'POST',
        body: JSON.stringify({
          type: broadcastType,
          days_ahead: broadcastDaysAhead,
          interval_ms: broadcastInterval * 1000,
          custom_prompt: broadcastCustomPrompt || undefined,
        }),
      });
      showSuccess(`Disparo iniciado! ${result.items?.length || result.total_targets} mensagens sendo enviadas.`);
      setActiveBroadcast(result);
      setBroadcastTargets([]);
      fetchBroadcasts();
    } catch (err: unknown) {
      showError(err instanceof Error ? err.message : 'Erro ao criar disparo');
    } finally {
      setDispatchingBroadcast(false);
    }
  };

  const handleCancelBroadcast = async (id: string) => {
    if (!confirm('Cancelar este disparo? Mensagens já enviadas não serão revertidas.')) return;
    try {
      await apiFetch(`/followup/broadcasts/${id}/cancel`, { method: 'PATCH' });
      showSuccess('Disparo cancelado');
      setActiveBroadcast(null);
      fetchBroadcasts();
    } catch (err: unknown) {
      showError(err instanceof Error ? err.message : 'Erro ao cancelar');
    }
  };

  const handleViewBroadcast = async (id: string) => {
    try {
      const data = await apiFetch(`/followup/broadcasts/${id}`);
      setActiveBroadcast(data);
    } catch (err: unknown) {
      showError(err instanceof Error ? err.message : 'Erro ao carregar detalhes');
    }
  };

  // Poll active broadcast progress
  useEffect(() => {
    if (activeBroadcast && activeBroadcast.status === 'ENVIANDO') {
      pollRef.current = setInterval(async () => {
        try {
          const data = await apiFetch(`/followup/broadcasts/${activeBroadcast.id}`);
          setActiveBroadcast(data);
          if (data.status !== 'ENVIANDO') {
            if (pollRef.current) clearInterval(pollRef.current);
            fetchBroadcasts();
          }
        } catch { /* ignore */ }
      }, 3000);
      return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }
  }, [activeBroadcast?.id, activeBroadcast?.status, fetchBroadcasts]);

  // Fetch inicial por tab
  useEffect(() => {
    if (activeTab === 'dashboard') { fetchStats(); fetchEnrollments(); }
    if (activeTab === 'fila') fetchQueue();
    if (activeTab === 'sequencias') fetchSequences();
    if (activeTab === 'enrollments') fetchEnrollments();
    if (activeTab === 'aprovacoes') fetchApprovals();
    if (activeTab === 'disparos') fetchBroadcasts();
  }, [activeTab, fetchStats, fetchSequences, fetchEnrollments, fetchApprovals, fetchBroadcasts, fetchQueue]);

  useEffect(() => {
    if (activeTab === 'enrollments') fetchEnrollments();
  }, [enrollFilter, activeTab, fetchEnrollments]);

  // ── Sequências ──────────────────────────────────────────────────────────────

  const handleSaveSequence = async (form: SeqForm) => {
    if (seqModal.seq?.id) {
      await apiFetch(`/followup/sequences/${seqModal.seq.id}`, {
        method: 'PATCH',
        body: JSON.stringify(form),
      });
      showSuccess('Sequência atualizada');
    } else {
      await apiFetch('/followup/sequences', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      showSuccess('Sequência criada');
    }
    fetchSequences();
  };

  const handleToggleSequence = async (seq: FollowupSequence) => {
    try {
      await apiFetch(`/followup/sequences/${seq.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !seq.active }),
      });
      showSuccess(seq.active ? 'Sequência desativada' : 'Sequência ativada');
      fetchSequences();
    } catch (err: unknown) {
      showError(err instanceof Error ? err.message : 'Erro ao atualizar');
    }
  };

  const handleDeleteSequence = async (id: string) => {
    if (!confirm('Deletar esta sequência? Isso também cancelará todos os enrollments ativos.')) return;
    try {
      await apiFetch(`/followup/sequences/${id}`, { method: 'DELETE' });
      showSuccess('Sequência deletada');
      fetchSequences();
    } catch (err: unknown) {
      showError(err instanceof Error ? err.message : 'Erro ao deletar');
    }
  };

  // ── Steps ───────────────────────────────────────────────────────────────────

  const handleSaveStep = async (form: StepForm) => {
    if (stepModal.step?.id) {
      await apiFetch(`/followup/steps/${stepModal.step.id}`, {
        method: 'PATCH',
        body: JSON.stringify(form),
      });
      showSuccess('Step atualizado');
    } else {
      await apiFetch(`/followup/sequences/${stepModal.seqId}/steps`, {
        method: 'POST',
        body: JSON.stringify(form),
      });
      showSuccess('Step adicionado');
    }
    fetchSequences();
  };

  const handleDeleteStep = async (stepId: string) => {
    if (!confirm('Deletar este step?')) return;
    try {
      await apiFetch(`/followup/steps/${stepId}`, { method: 'DELETE' });
      showSuccess('Step deletado');
      fetchSequences();
    } catch (err: unknown) {
      showError(err instanceof Error ? err.message : 'Erro ao deletar step');
    }
  };

  // ── Enrollments ─────────────────────────────────────────────────────────────

  const handleEnrollmentAction = async (
    id: string,
    action: 'pause' | 'cancel' | 'converted' | 'resume',
  ) => {
    try {
      await apiFetch(`/followup/enrollments/${id}/${action}`, { method: 'PATCH' });
      const labels: Record<string, string> = {
        pause: 'Pausado', cancel: 'Cancelado', converted: 'Marcado como convertido', resume: 'Retomado',
      };
      showSuccess(labels[action]);
      fetchEnrollments();
    } catch (err: unknown) {
      showError(err instanceof Error ? err.message : 'Erro na ação');
    }
  };

  // MELHORIA 4: Enrolar lead
  const handleEnrollLead = async (leadId: string, sequenceId: string) => {
    await apiFetch('/followup/enrollments', {
      method: 'POST',
      body: JSON.stringify({ lead_id: leadId, sequence_id: sequenceId }),
    });
    showSuccess('Lead enrolado com sucesso!');
    fetchEnrollments();
    fetchStats();
  };

  // ── Aprovações ──────────────────────────────────────────────────────────────

  const handleApprove = async (id: string, editedText: string) => {
    await apiFetch(`/followup/messages/${id}/approve`, {
      method: 'PATCH',
      body: JSON.stringify({ edited_text: editedText }),
    });
    showSuccess('Mensagem aprovada e enviada!');
    fetchApprovals();
    fetchStats();
  };

  const handleReject = async (id: string) => {
    await apiFetch(`/followup/messages/${id}/reject`, { method: 'PATCH' });
    showSuccess('Mensagem rejeitada');
    fetchApprovals();
  };

  const handleRegenerate = async (id: string) => {
    await apiFetch(`/followup/messages/${id}/regenerate`, { method: 'POST' });
    showSuccess('Mensagem regenerada!');
    fetchApprovals();
  };

  // MELHORIA 7: Criar Sequências Padrão
  const handleSeedDefaults = async () => {
    setLoadingSeed(true);
    try {
      const result = await apiFetch('/followup/seed-defaults', { method: 'POST' });
      const count = result?.created ?? result?.count ?? result?.length ?? '4';
      showSuccess(`${count} sequências padrão criadas com sucesso!`);
      fetchSequences();
      fetchStats();
    } catch (err: unknown) {
      showError(err instanceof Error ? err.message : 'Erro ao criar sequências padrão');
    } finally {
      setLoadingSeed(false);
    }
  };

  // MELHORIA 7: Exportar Dados
  const handleExportData = () => {
    try {
      const data = {
        exported_at: new Date().toISOString(),
        stats,
        enrollments,
        total_sequences: sequences.length,
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `followup-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showSuccess('Dados exportados com sucesso!');
    } catch (err: unknown) {
      showError('Erro ao exportar dados');
    }
  };

  // ── Filtro de enrollments ────────────────────────────────────────────────────

  const filteredEnrollments = enrollments.filter(e => {
    if (!enrollSearch) return true;
    const q = enrollSearch.toLowerCase();
    return (
      e.lead.name?.toLowerCase().includes(q) ||
      e.lead.phone.includes(q) ||
      e.sequence.name.toLowerCase().includes(q)
    );
  });

  // Badge pendentes (MELHORIA 5)
  const pendingCount = stats?.pendentes_aprovacao ?? approvals.length;

  // ────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ────────────────────────────────────────────────────────────────────────────

  return (
    <div className="h-full overflow-y-auto bg-background text-foreground">
      {/* Header */}
      <div className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/20 border border-primary/30">
            <Bot size={22} className="text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Follow-up IA</h1>
            <p className="text-xs text-muted-foreground">Automação inteligente de mensagens</p>
          </div>
          {approvals.length > 0 && (
            <div className="ml-auto flex items-center gap-2 px-3 py-1.5 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <AlertTriangle size={14} className="text-yellow-400" />
              <span className="text-xs text-yellow-400 font-medium">
                {approvals.length} aguardando aprovação
              </span>
            </div>
          )}
        </div>

        {/* MELHORIA 5: Tabs com badge de aprovações */}
        <div className="max-w-7xl mx-auto px-4 md:px-6 flex gap-1 overflow-x-auto">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-all duration-200 whitespace-nowrap ${
                  active
                    ? 'text-primary border-primary'
                    : 'text-muted-foreground border-transparent hover:text-foreground'
                }`}
              >
                <Icon size={15} />
                {tab.label}
                {tab.id === 'aprovacoes' && pendingCount > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full bg-red-500 text-foreground text-xs font-bold leading-none animate-pulse">
                    {pendingCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 pb-28 md:pb-6">

        {/* ── TAB: DASHBOARD ─────────────────────────────────────────────────── */}
        {activeTab === 'dashboard' && (
          <div className="space-y-8">
            {loadingStats ? (
              <div className="flex items-center justify-center py-20 text-muted-foreground">
                <RefreshCw size={20} className="animate-spin mr-2" />
                Carregando...
              </div>
            ) : stats ? (
              <>
                {/* Stat Cards */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                  {[
                    {
                      label: 'Total Enrollments',
                      value: stats.total_enrollments,
                      icon: Users,
                      grad: 'from-blue-600/20 to-blue-800/10',
                      border: 'border-blue-500/20',
                      text: 'text-blue-400',
                    },
                    {
                      label: 'Ativos',
                      value: stats.ativos,
                      icon: Play,
                      grad: 'from-green-600/20 to-green-800/10',
                      border: 'border-green-500/20',
                      text: 'text-green-400',
                    },
                    {
                      label: 'Aguard. Aprovação',
                      value: stats.pendentes_aprovacao,
                      icon: Clock,
                      grad: 'from-yellow-600/20 to-yellow-800/10',
                      border: 'border-yellow-500/20',
                      text: 'text-yellow-400',
                    },
                    {
                      label: 'Total Enviados',
                      value: stats.total_enviados,
                      icon: Send,
                      grad: 'from-indigo-600/20 to-indigo-800/10',
                      border: 'border-indigo-500/20',
                      text: 'text-indigo-400',
                    },
                    {
                      label: 'Convertidos',
                      value: stats.convertidos,
                      icon: CheckCircle,
                      grad: 'from-purple-600/20 to-purple-800/10',
                      border: 'border-purple-500/20',
                      text: 'text-purple-400',
                    },
                    {
                      label: 'Taxa Conversão',
                      value: `${stats.taxa_conversao.toFixed(1)}%`,
                      icon: TrendingUp,
                      grad: 'from-pink-600/20 to-pink-800/10',
                      border: 'border-pink-500/20',
                      text: 'text-pink-400',
                    },
                  ].map(card => {
                    const Icon = card.icon;
                    return (
                      <div
                        key={card.label}
                        className={`bg-gradient-to-br ${card.grad} border ${card.border} rounded-2xl p-5 flex flex-col gap-3 transition-all duration-200`}
                      >
                        <div className={`p-2 rounded-lg bg-background/40 w-fit ${card.text}`}>
                          <Icon size={18} />
                        </div>
                        <div>
                          <p className={`text-2xl font-bold ${card.text}`}>{card.value}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{card.label}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* MELHORIA 2: Efetividade por Canal */}
                <div className="bg-card/50 border border-border rounded-2xl p-6">
                  <ChannelEffectivityCards stats={stats} enrollments={enrollments} />
                </div>

                {/* Cron Legacy — atividade automatica do followup IA */}
                {stats.legacy && (
                  <div className="bg-card/50 border border-border rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <Clock size={16} className="text-yellow-400" />
                        <h3 className="text-sm font-semibold text-foreground">Cron Legacy (Followup IA)</h3>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {stats.legacy.ultimo_envio_at ? (
                          <>
                            <span>Último disparo:</span>
                            <span className="text-foreground font-medium">{formatDate(stats.legacy.ultimo_envio_at)}</span>
                          </>
                        ) : (
                          <span className="italic">Nenhum disparo registrado ainda</span>
                        )}
                        <span className="text-muted-foreground/60">·</span>
                        <span>Próxima execução:</span>
                        <span className="text-foreground font-medium">{formatDate(stats.legacy.proximo_cron_at)}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                      {[
                        { label: 'Enviados 24h', value: stats.legacy.enviados_24h, text: 'text-blue-400', bg: 'bg-blue-500/5 border-blue-500/15' },
                        { label: 'Enviados 7d', value: stats.legacy.enviados_7d, text: 'text-blue-400', bg: 'bg-blue-500/5 border-blue-500/15' },
                        { label: 'Enviados 30d', value: stats.legacy.enviados_30d, text: 'text-blue-400', bg: 'bg-blue-500/5 border-blue-500/15' },
                        { label: 'Enviados total', value: stats.legacy.enviados_total, text: 'text-foreground', bg: 'bg-muted/40 border-border' },
                        { label: 'Arquivados IA 7d', value: stats.legacy.arquivados_ia_7d, text: 'text-red-400', bg: 'bg-red-500/5 border-red-500/15' },
                        { label: 'Arquivados IA 30d', value: stats.legacy.arquivados_ia_30d, text: 'text-red-400', bg: 'bg-red-500/5 border-red-500/15' },
                      ].map(card => (
                        <div key={card.label} className={`rounded-xl border ${card.bg} p-3`}>
                          <p className={`text-2xl font-bold ${card.text}`}>{card.value}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{card.label}</p>
                        </div>
                      ))}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-4 leading-relaxed">
                      Inclui: cron automático (seg-sex 9h), disparos manuais da Fila e envios feitos por
                      enrollments. Arquivados contam leads que a IA marcou como PERDIDO por detectar desengajamento.
                    </p>
                  </div>
                )}

                {/* Quick actions */}
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="bg-card/50 border border-border rounded-2xl p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <Zap size={16} className="text-yellow-400" />
                      <h3 className="text-sm font-semibold text-foreground">Ações Rápidas</h3>
                    </div>
                    <div className="space-y-2">
                      <button
                        onClick={() => { setActiveTab('sequencias'); setSeqModal({ open: true }); }}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-background/60 hover:bg-background border border-border hover:border-border text-sm text-foreground/80 hover:text-foreground transition-all duration-200"
                      >
                        <Plus size={15} className="text-blue-400" />
                        Nova sequência de follow-up
                        <ChevronRight size={14} className="ml-auto text-muted-foreground/60" />
                      </button>
                      <button
                        onClick={() => setActiveTab('aprovacoes')}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-background/60 hover:bg-background border border-border hover:border-border text-sm text-foreground/80 hover:text-foreground transition-all duration-200"
                      >
                        <MessageSquare size={15} className="text-yellow-400" />
                        Revisar aprovações pendentes
                        {stats.pendentes_aprovacao > 0 && (
                          <span className="ml-auto px-2 py-0.5 rounded-full bg-red-500 text-foreground text-xs font-bold">
                            {stats.pendentes_aprovacao}
                          </span>
                        )}
                        {stats.pendentes_aprovacao === 0 && (
                          <ChevronRight size={14} className="ml-auto text-muted-foreground/60" />
                        )}
                      </button>
                      <button
                        onClick={() => setActiveTab('enrollments')}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-background/60 hover:bg-background border border-border hover:border-border text-sm text-foreground/80 hover:text-foreground transition-all duration-200"
                      >
                        <Users size={15} className="text-green-400" />
                        Ver todos os enrollments
                        <ChevronRight size={14} className="ml-auto text-muted-foreground/60" />
                      </button>

                      {/* MELHORIA 7: Criar Sequências Padrão */}
                      <button
                        onClick={handleSeedDefaults}
                        disabled={loadingSeed}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-background/60 hover:bg-background border border-border hover:border-emerald-600/30 text-sm text-foreground/80 hover:text-emerald-400 transition-all duration-200 disabled:opacity-50"
                      >
                        {loadingSeed ? (
                          <RefreshCw size={15} className="text-emerald-400 animate-spin" />
                        ) : (
                          <Sprout size={15} className="text-emerald-400" />
                        )}
                        {loadingSeed ? 'Criando sequências...' : 'Criar Sequências Padrão'}
                        {!loadingSeed && <ChevronRight size={14} className="ml-auto text-muted-foreground/60" />}
                      </button>

                      {/* MELHORIA 7: Exportar Dados */}
                      <button
                        onClick={handleExportData}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-background/60 hover:bg-background border border-border hover:border-blue-600/30 text-sm text-foreground/80 hover:text-blue-400 transition-all duration-200"
                      >
                        <Download size={15} className="text-blue-400" />
                        Exportar Dados (JSON)
                        <ChevronRight size={14} className="ml-auto text-muted-foreground/60" />
                      </button>
                    </div>
                  </div>

                  <div className="bg-card/50 border border-border rounded-2xl p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <Bot size={16} className="text-blue-400" />
                      <h3 className="text-sm font-semibold text-foreground">Como funciona</h3>
                    </div>
                    <ol className="space-y-3 text-sm text-muted-foreground">
                      {[
                        'Crie uma sequência com os steps e delays desejados',
                        'Leads são enrollados automaticamente ao entrar em um stage configurado',
                        'A IA gera mensagens personalizadas para cada lead',
                        'Mensagens de alto risco ficam aguardando aprovação humana',
                        'Aprovadas, as mensagens são enviadas pelo canal configurado',
                      ].map((step, i) => (
                        <li key={i} className="flex gap-3">
                          <span className="shrink-0 w-5 h-5 rounded-full bg-blue-600/20 border border-blue-500/30 text-blue-400 text-xs flex items-center justify-center font-bold">
                            {i + 1}
                          </span>
                          {step}
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center py-20 text-muted-foreground">
                <Bot size={40} className="mx-auto mb-3 opacity-30" />
                <p>Não foi possível carregar os dados.</p>
                <button
                  onClick={fetchStats}
                  className="mt-3 px-4 py-2 rounded-lg bg-muted hover:bg-muted/80 text-sm text-foreground/80 transition-all duration-200"
                >
                  Tentar novamente
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── TAB: FILA ──────────────────────────────────────────────────────── */}
        {activeTab === 'fila' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Fila de Followup</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {queue
                    ? `${queue.total} lead${queue.total !== 1 ? 's' : ''} aguardando — ${queue.enrollment_count} em sequência, ${queue.legacy_count} no cron legacy${
                        queueMinDays !== null ? ` · cutoff: ${queueMinDays}d` : ''
                      }`
                    : 'Leads aptos a receber o próximo disparo'}
                </p>
              </div>
              <button
                onClick={fetchQueue}
                disabled={loadingQueue}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-muted hover:bg-muted/80 text-foreground text-sm font-medium transition-all duration-200 disabled:opacity-50"
              >
                <RefreshCw size={14} className={loadingQueue ? 'animate-spin' : ''} />
                Atualizar
              </button>
            </div>

            {/* Filtros */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[220px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={queueSearch}
                  onChange={e => setQueueSearch(e.target.value)}
                  placeholder="Buscar por nome, telefone ou sequência..."
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-muted border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                />
              </div>
              <div className="flex items-center gap-1 bg-muted rounded-xl p-1">
                {(['ALL', 'enrollment', 'legacy'] as const).map(src => (
                  <button
                    key={src}
                    onClick={() => setQueueSourceFilter(src)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      queueSourceFilter === src
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {src === 'ALL' ? 'Todos' : src === 'enrollment' ? 'Sequência' : 'Cron legacy'}
                  </button>
                ))}
              </div>
              {/* Cutoff customizavel — sobrescreve 3/3/2/5 default do cron legacy */}
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground whitespace-nowrap">Parado há:</label>
                <select
                  value={queueMinDays === null ? 'default' : String(queueMinDays)}
                  onChange={e => {
                    const v = e.target.value;
                    setQueueMinDays(v === 'default' ? null : parseInt(v, 10));
                  }}
                  className="px-3 py-2 rounded-xl bg-muted border border-border text-sm text-foreground focus:outline-none focus:border-primary"
                >
                  <option value="default">Padrão (3/3/2/5d)</option>
                  <option value="0">0 dias (todos)</option>
                  <option value="1">1 dia+</option>
                  <option value="2">2 dias+</option>
                  <option value="3">3 dias+</option>
                  <option value="5">5 dias+</option>
                  <option value="7">7 dias+</option>
                  <option value="14">14 dias+</option>
                  <option value="30">30 dias+</option>
                </select>
              </div>
            </div>

            {/* Lista */}
            {loadingQueue ? (
              <div className="flex items-center justify-center py-20 text-muted-foreground">
                <RefreshCw size={20} className="animate-spin mr-2" />
                Carregando fila...
              </div>
            ) : !queue || queue.total === 0 ? (
              <div className="text-center py-20 text-muted-foreground bg-card border border-border rounded-2xl">
                <CheckCircle size={40} className="mx-auto mb-3 opacity-30" />
                <p className="font-medium text-foreground mb-1">Fila vazia</p>
                <p className="text-sm">Nenhum lead precisa de followup no momento.</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-border bg-card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                      <tr>
                        <th className="text-left px-4 py-3 font-medium">Lead</th>
                        <th className="text-left px-4 py-3 font-medium">Fase</th>
                        <th className="text-left px-4 py-3 font-medium">Última mensagem</th>
                        <th className="text-left px-4 py-3 font-medium">Próximo disparo</th>
                        <th className="text-right px-4 py-3 font-medium">Ação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {queue.items
                        .filter(item => {
                          if (queueSourceFilter !== 'ALL' && item.source !== queueSourceFilter) return false;
                          if (!queueSearch) return true;
                          const q = queueSearch.toLowerCase();
                          return (
                            (item.lead_name || '').toLowerCase().includes(q) ||
                            item.lead_phone.includes(q) ||
                            (item.sequence_name || '').toLowerCase().includes(q) ||
                            item.lead_stage.toLowerCase().includes(q)
                          );
                        })
                        .map(item => {
                          const triggering = triggeringLeadId === item.lead_id;
                          return (
                            <tr key={`${item.source}-${item.lead_id}-${item.enrollment_id || ''}`} className="hover:bg-muted/30 transition-colors">
                              <td className="px-4 py-3">
                                <div className="font-medium text-foreground">
                                  {item.lead_name || <span className="text-muted-foreground italic">sem nome</span>}
                                </div>
                                <div className="text-xs text-muted-foreground font-mono flex items-center gap-1.5 mt-0.5">
                                  <Phone size={10} />
                                  {item.lead_phone}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                {item.source === 'enrollment' ? (
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-1.5">
                                      <Zap size={12} className="text-purple-400" />
                                      <span className="text-xs font-medium text-purple-300">
                                        {item.sequence_name || 'Sequência'}
                                      </span>
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      Step {(item.current_step ?? 0) + 1}
                                      {item.total_steps ? ` de ${item.total_steps}` : ''}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-1.5">
                                      <Clock size={12} className="text-yellow-400" />
                                      <span className="text-xs font-medium text-yellow-300">Cron legacy</span>
                                    </div>
                                    <div className="text-xs text-muted-foreground">{item.lead_stage}</div>
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3 max-w-xs">
                                {item.last_followup ? (
                                  <div>
                                    <div className="text-xs text-foreground truncate" title={item.last_followup.text}>
                                      {item.last_followup.text}
                                    </div>
                                    <div className="text-[11px] text-muted-foreground mt-0.5">
                                      {formatDate(item.last_followup.sent_at)}
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-xs text-muted-foreground italic">— nenhuma —</span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                {item.next_scheduled_at ? (
                                  <div className="text-xs text-foreground">
                                    {formatDate(item.next_scheduled_at)}
                                    {item.days_inactive > 0 && (
                                      <div className="text-[11px] text-muted-foreground mt-0.5">
                                        parado há {item.days_inactive}d
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-xs text-muted-foreground italic">—</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <button
                                  onClick={() => handleTriggerQueue(item)}
                                  disabled={triggering}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-foreground text-xs font-medium transition-colors disabled:opacity-50"
                                >
                                  {triggering ? (
                                    <>
                                      <RefreshCw size={12} className="animate-spin" />
                                      Disparando...
                                    </>
                                  ) : (
                                    <>
                                      <Send size={12} />
                                      Disparar agora
                                    </>
                                  )}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── TAB: SEQUÊNCIAS ────────────────────────────────────────────────── */}
        {activeTab === 'sequencias' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Sequências</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {sequences.length} sequência{sequences.length !== 1 ? 's' : ''} configurada{sequences.length !== 1 ? 's' : ''}
                </p>
              </div>
              <button
                onClick={() => setSeqModal({ open: true })}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-foreground text-sm font-medium transition-all duration-200"
              >
                <Plus size={15} />
                Nova Sequência
              </button>
            </div>

            {loadingSeq ? (
              <div className="flex items-center justify-center py-20 text-muted-foreground">
                <RefreshCw size={20} className="animate-spin mr-2" />
                Carregando...
              </div>
            ) : sequences.length === 0 ? (
              <div className="text-center py-20 border border-dashed border-border rounded-2xl">
                <Bot size={40} className="mx-auto mb-3 text-gray-700" />
                <p className="text-muted-foreground">Nenhuma sequência criada ainda.</p>
                <button
                  onClick={() => setSeqModal({ open: true })}
                  className="mt-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-foreground text-sm font-medium transition-all duration-200 mx-auto"
                >
                  <Plus size={15} />
                  Criar primeira sequência
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {sequences.map(seq => (
                  <div
                    key={seq.id}
                    className="bg-card border border-border rounded-xl overflow-hidden transition-all duration-200"
                  >
                    {/* Sequence header */}
                    <div className="flex items-center gap-4 px-5 py-4">
                      <button
                        onClick={() => setExpandedSeq(expandedSeq === seq.id ? null : seq.id)}
                        className="p-1 text-muted-foreground hover:text-foreground/80 transition-all duration-200"
                      >
                        <ChevronDown
                          size={16}
                          className={`transition-transform duration-200 ${expandedSeq === seq.id ? 'rotate-180' : ''}`}
                        />
                      </button>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-foreground text-sm">{seq.name}</span>
                          <Badge
                            label={CATEGORIES.find(c => c.id === seq.category)?.label ?? seq.category}
                            colorClass={CATEGORY_COLORS[seq.category] ?? 'text-muted-foreground bg-gray-400/10'}
                          />
                          {!seq.active && (
                            <Badge label="Inativo" colorClass="text-muted-foreground bg-gray-500/10" />
                          )}
                        </div>
                        {seq.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">{seq.description}</p>
                        )}
                        <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                          <span>{seq.steps.length} step{seq.steps.length !== 1 ? 's' : ''}</span>
                          <span>·</span>
                          <span>{seq._count?.enrollments ?? 0} enrollment{(seq._count?.enrollments ?? 0) !== 1 ? 's' : ''}</span>
                          <span>·</span>
                          <span>Max {seq.max_attempts} tentativas</span>
                          {seq.auto_enroll_stages.length > 0 && (
                            <>
                              <span>·</span>
                              <span>Auto: {seq.auto_enroll_stages.join(', ')}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleToggleSequence(seq)}
                          title={seq.active ? 'Desativar' : 'Ativar'}
                          className={`p-2 rounded-lg border transition-all duration-200 ${
                            seq.active
                              ? 'bg-green-600/10 border-green-600/20 text-green-400 hover:bg-green-600/20'
                              : 'bg-muted/50 border-border text-muted-foreground hover:text-foreground/80'
                          }`}
                        >
                          {seq.active ? <Pause size={14} /> : <Play size={14} />}
                        </button>
                        <button
                          onClick={() => setSeqModal({ open: true, seq })}
                          title="Editar"
                          className="p-2 rounded-lg border border-border bg-muted/50 text-muted-foreground hover:text-foreground hover:border-border transition-all duration-200"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => handleDeleteSequence(seq.id)}
                          title="Deletar"
                          className="p-2 rounded-lg border border-border bg-muted/50 text-muted-foreground hover:text-red-400 hover:border-red-500/30 transition-all duration-200"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Steps (expandido) */}
                    {expandedSeq === seq.id && (
                      <div className="border-t border-border bg-background/40 px-5 py-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            Steps
                          </p>
                          <button
                            onClick={() => setStepModal({ open: true, seqId: seq.id })}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 border border-blue-500/30 text-blue-400 hover:bg-blue-600/30 text-xs font-medium transition-all duration-200"
                          >
                            <Plus size={13} />
                            Adicionar Step
                          </button>
                        </div>

                        {seq.steps.length === 0 ? (
                          <p className="text-xs text-muted-foreground/60 py-2 text-center">
                            Nenhum step configurado.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {[...seq.steps]
                              .sort((a, b) => a.position - b.position)
                              .map((step) => (
                                <div
                                  key={step.id}
                                  className="flex items-center gap-3 p-3 bg-card border border-border rounded-lg transition-all duration-200"
                                >
                                  {/* Position indicator */}
                                  <div className="w-7 h-7 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center shrink-0">
                                    <span className="text-xs font-bold text-blue-400">{step.position}</span>
                                  </div>

                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-xs font-medium text-foreground capitalize">
                                        {step.channel === 'whatsapp' ? '📱 WhatsApp' : '📧 E-mail'}
                                      </span>
                                      <span className="text-xs text-muted-foreground">
                                        após {step.delay_hours}h
                                      </span>
                                      <Badge
                                        label={TONES.find(t => t.id === step.tone)?.label ?? step.tone}
                                        colorClass="text-muted-foreground bg-muted/50"
                                      />
                                      {step.auto_send && (
                                        <Badge label="Auto-envio" colorClass="text-green-400 bg-green-400/10" />
                                      )}
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{step.objective}</p>
                                  </div>

                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <button
                                      onClick={() => setStepModal({ open: true, seqId: seq.id, step })}
                                      className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-all duration-200"
                                    >
                                      <Edit2 size={12} />
                                    </button>
                                    <button
                                      onClick={() => handleDeleteStep(step.id)}
                                      className="p-1.5 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-all duration-200"
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  </div>
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── TAB: ENROLLMENTS ───────────────────────────────────────────────── */}
        {activeTab === 'enrollments' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Enrollments</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {filteredEnrollments.length} resultado{filteredEnrollments.length !== 1 ? 's' : ''}
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {/* Busca */}
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Buscar lead..."
                    value={enrollSearch}
                    onChange={e => setEnrollSearch(e.target.value)}
                    className="pl-8 pr-3 py-2 bg-muted border border-border rounded-lg text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary w-48 transition-all duration-200"
                  />
                </div>

                {/* Filtro status */}
                <div className="relative">
                  <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <select
                    value={enrollFilter}
                    onChange={e => setEnrollFilter(e.target.value)}
                    className="pl-8 pr-8 py-2 bg-muted border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all duration-200 appearance-none cursor-pointer"
                  >
                    {ENROLLMENT_STATUSES.map(s => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </select>
                </div>

                <button
                  onClick={fetchEnrollments}
                  className="p-2 rounded-lg bg-muted border border-border text-muted-foreground hover:text-foreground hover:border-border transition-all duration-200"
                  title="Atualizar"
                >
                  <RefreshCw size={15} className={loadingEnroll ? 'animate-spin' : ''} />
                </button>

                {/* MELHORIA 4: Botão Enrolar Lead */}
                <button
                  onClick={() => setEnrollModal(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-foreground text-sm font-medium transition-all duration-200"
                >
                  <Plus size={14} />
                  Enrolar Lead
                </button>
              </div>
            </div>

            {loadingEnroll ? (
              <div className="flex items-center justify-center py-20 text-muted-foreground">
                <RefreshCw size={20} className="animate-spin mr-2" />
                Carregando...
              </div>
            ) : filteredEnrollments.length === 0 ? (
              <div className="text-center py-20 border border-dashed border-border rounded-2xl">
                <Users size={40} className="mx-auto mb-3 text-gray-700" />
                <p className="text-muted-foreground">Nenhum enrollment encontrado.</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/80 border-b border-border">
                      {['Lead', 'Sequência', 'Step', 'Status', 'Última Resposta', 'Último envio', 'Próximo envio', 'Inscrito em', 'Ações'].map(h => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {filteredEnrollments.map(enroll => (
                      <tr
                        key={enroll.id}
                        className="bg-background/40 hover:bg-muted/60 transition-all duration-200"
                      >
                        <td className="px-4 py-3">
                          <div>
                            <p className="font-medium text-foreground text-sm">
                              {enroll.lead.name || '—'}
                            </p>
                            <p className="text-xs text-muted-foreground">{enroll.lead.phone}</p>
                            <p className="text-xs text-muted-foreground/60">{enroll.lead.stage}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div>
                            <p className="text-foreground text-sm">{enroll.sequence.name}</p>
                            <Badge
                              label={CATEGORIES.find(c => c.id === enroll.sequence.category)?.label ?? enroll.sequence.category}
                              colorClass={CATEGORY_COLORS[enroll.sequence.category] ?? 'text-muted-foreground bg-muted/50'}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-foreground font-medium">#{enroll.current_step}</span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            label={enroll.status}
                            colorClass={STATUS_COLORS[enroll.status] ?? 'text-muted-foreground bg-muted/50'}
                          />
                        </td>
                        {/* Coluna Última Resposta */}
                        <td className="px-4 py-3">
                          <LeadResponseStatus enrollment={enroll} />
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {formatDate(enroll.last_sent_at)}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {formatDate(enroll.next_send_at)}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {formatDate(enroll.enrolled_at)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            {enroll.status === 'ATIVO' && (
                              <button
                                onClick={() => handleEnrollmentAction(enroll.id, 'pause')}
                                title="Pausar"
                                className="p-1.5 rounded text-yellow-400 hover:bg-yellow-400/10 transition-all duration-200"
                              >
                                <Pause size={13} />
                              </button>
                            )}
                            {enroll.status === 'PAUSADO' && (
                              <button
                                onClick={() => handleEnrollmentAction(enroll.id, 'resume')}
                                title="Retomar"
                                className="p-1.5 rounded text-green-400 hover:bg-green-400/10 transition-all duration-200"
                              >
                                <Play size={13} />
                              </button>
                            )}
                            {(enroll.status === 'ATIVO' || enroll.status === 'PAUSADO') && (
                              <>
                                <button
                                  onClick={() => handleEnrollmentAction(enroll.id, 'converted')}
                                  title="Marcar convertido"
                                  className="p-1.5 rounded text-purple-400 hover:bg-purple-400/10 transition-all duration-200"
                                >
                                  <CheckCircle size={13} />
                                </button>
                                <button
                                  onClick={() => handleEnrollmentAction(enroll.id, 'cancel')}
                                  title="Cancelar"
                                  className="p-1.5 rounded text-red-400 hover:bg-red-400/10 transition-all duration-200"
                                >
                                  <XCircle size={13} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── TAB: APROVAÇÕES ────────────────────────────────────────────────── */}
        {activeTab === 'aprovacoes' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Fila de Aprovação</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {approvals.length} {approvals.length === 1 ? 'mensagem' : 'mensagens'} aguardando revisão
                </p>
              </div>
              <button
                onClick={fetchApprovals}
                className="p-2 rounded-lg bg-muted border border-border text-muted-foreground hover:text-foreground hover:border-border transition-all duration-200"
                title="Atualizar"
              >
                <RefreshCw size={15} className={loadingApprovals ? 'animate-spin' : ''} />
              </button>
            </div>

            {loadingApprovals ? (
              <div className="flex items-center justify-center py-20 text-muted-foreground">
                <RefreshCw size={20} className="animate-spin mr-2" />
                Carregando...
              </div>
            ) : approvals.length === 0 ? (
              <div className="text-center py-20 border border-dashed border-border rounded-2xl">
                <CheckCircle size={40} className="mx-auto mb-3 text-gray-700" />
                <p className="text-muted-foreground">Nenhuma mensagem aguardando aprovação.</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Tudo certo! As mensagens de baixo risco são enviadas automaticamente.
                </p>
              </div>
            ) : (
              <div className="grid md:grid-cols-2 gap-4">
                {approvals.map(msg => (
                  <ApprovalCard
                    key={msg.id}
                    msg={msg}
                    onApprove={handleApprove}
                    onReject={handleReject}
                    onRegenerate={handleRegenerate}
                    onViewContext={(m) => setContextModal({ open: true, message: m })}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── TAB: DISPAROS ──────────────────────────────────────────────────── */}
        {activeTab === 'disparos' && (
          <div className="space-y-6">
            {/* Card: Novo Disparo */}
            <div className="bg-card/50 border border-border rounded-2xl p-6 space-y-5">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-primary/20">
                  <Radio size={16} className="text-primary" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    {broadcastType === 'COMUNICADO' ? 'Novo Disparo — Comunicado Geral' : 'Novo Disparo — Lembrete de Audiência'}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {broadcastType === 'COMUNICADO'
                      ? 'Envie uma mensagem fixa para todos os clientes com processo ativo'
                      : 'Envie mensagens personalizadas por IA para clientes com audiências próximas'}
                  </p>
                </div>
              </div>

              {/* Seletor de tipo de disparo */}
              <div className="flex rounded-xl border border-border overflow-hidden">
                <button
                  onClick={() => { setBroadcastType('AUDIENCIA'); setBroadcastTargets([]); setBroadcastCustomPrompt(''); }}
                  className={`flex-1 py-2 text-xs font-semibold transition-colors ${broadcastType === 'AUDIENCIA' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent/60'}`}
                >
                  📅 Lembrete de Audiência
                </button>
                <button
                  onClick={() => {
                    setBroadcastType('COMUNICADO');
                    setBroadcastTargets([]);
                    setBroadcastCustomPrompt(`⚖️ *André Lustosa Advogados — Comunicado Importante*\n\nOlá {{nome}}! Aqui é da equipe do escritório André Lustosa Advogados. 😊\n\nGostaríamos de compartilhar um alerta importante com você.\n\nInfelizmente, tem crescido em todo o Brasil uma prática criminosa conhecida como o *golpe do falso advogado*. Pessoas mal-intencionadas se passam por advogados ou funcionários de escritórios para pedir depósitos, dados bancários ou pagamentos por fora.\n\n🔒 *Para sua segurança, lembre-se:*\n\n✅ Nossos únicos números oficiais são:\n• (82) 99913-0127\n• (82) 99631-6935\n• (82) 99639-0799\n\n✅ Nosso endereço: Rua Francisco Rodrigues Viana, 242 — Baixa Grande, Arapiraca/AL\n\n⚠️ *Nós NUNCA pedimos:*\n• Depósitos ou PIX em contas de pessoa física\n• Senhas, dados bancários ou códigos por mensagem\n• Pagamentos por links desconhecidos\n\nSe alguém entrar em contato se passando pelo nosso escritório por um número diferente dos listados acima, *não faça nenhum pagamento* e nos avise imediatamente por um dos nossos canais oficiais.\n\nSua segurança é nossa prioridade. Estamos sempre à disposição para qualquer dúvida! 💛\n\nAndré Lustosa Advogados`);
                  }}
                  className={`flex-1 py-2 text-xs font-semibold transition-colors ${broadcastType === 'COMUNICADO' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent/60'}`}
                >
                  📢 Comunicado Geral
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {broadcastType !== 'COMUNICADO' && (
                  <div>
                    <label className={labelCls()}>Próximos dias</label>
                    <input
                      type="number"
                      min={1}
                      max={90}
                      className={inputCls()}
                      value={broadcastDaysAhead}
                      onChange={e => setBroadcastDaysAhead(Math.max(1, Number(e.target.value)))}
                    />
                    <p className="text-xs text-muted-foreground mt-1">Audiências nos próximos X dias</p>
                  </div>
                )}
                <div>
                  <label className={labelCls()}>Intervalo entre mensagens (seg)</label>
                  <input
                    type="number"
                    min={15}
                    max={3600}
                    className={inputCls()}
                    value={broadcastInterval}
                    onChange={e => setBroadcastInterval(Math.max(15, Math.min(3600, Number(e.target.value))))}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Mín 15s (limite anti-ban WhatsApp), máx 3600s (1h). Recomendado ≥60s pra disparos com mais de 30 alvos. Worker aplica jitter aleatório ±30%.
                  </p>
                  {broadcastInterval < 30 && (
                    <p className="text-xs text-amber-600 dark:text-amber-300 mt-1 flex items-center gap-1">
                      <AlertTriangle size={11} />
                      Intervalo curto. Em 2026-04-28 disparo a cada 10s derrubou a conta. Considere ≥60s.
                    </p>
                  )}
                </div>
                <div className="flex items-end">
                  <button
                    onClick={fetchBroadcastPreview}
                    disabled={loadingPreview}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-sm font-medium transition-all duration-200"
                  >
                    {loadingPreview ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
                    {broadcastType === 'COMUNICADO' ? 'Carregar Clientes' : 'Pré-visualizar'}
                  </button>
                </div>
              </div>

              <div>
                <label className={labelCls()}>
                  {broadcastType === 'COMUNICADO' ? 'Mensagem do comunicado' : 'Instrução adicional para IA (opcional)'}
                </label>
                <textarea
                  className={inputCls('resize-none font-mono')}
                  rows={broadcastType === 'COMUNICADO' ? 12 : 2}
                  value={broadcastCustomPrompt}
                  onChange={e => setBroadcastCustomPrompt(e.target.value)}
                  placeholder={broadcastType === 'COMUNICADO'
                    ? 'Digite a mensagem do comunicado. Use {{nome}} para personalizar com o nome do cliente.'
                    : 'Ex: Mencionar que devem levar documentos originais, perguntar se precisam de transporte...'}
                />
                {broadcastType === 'COMUNICADO' && (
                  <p className="text-xs text-muted-foreground mt-1">Use <code className="text-[10px] bg-muted px-1 rounded">{'{{nome}}'}</code> para inserir o primeiro nome do cliente automaticamente.</p>
                )}
              </div>

              {/* Preview de alvos */}
              {broadcastTargets.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Users size={14} className="text-green-400" />
                      <span className="text-sm font-medium text-foreground">
                        {broadcastTargets.length} {broadcastTargets.length === 1 ? 'cliente encontrado' : 'clientes encontrados'}
                      </span>
                    </div>
                    <button
                      onClick={handleDispatchBroadcast}
                      disabled={dispatchingBroadcast}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-50 text-foreground text-sm font-medium transition-all duration-200"
                    >
                      {dispatchingBroadcast ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                      {dispatchingBroadcast ? 'Disparando...' : 'Disparar Mensagens'}
                    </button>
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/80 border-b border-border">
                          {['Cliente', 'Telefone', 'Audiência', 'Data/Hora', 'Local', 'Processo'].map(h => (
                            <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {broadcastTargets.map(t => (
                          <tr key={`${t.lead_id}-${t.event_id}`} className="hover:bg-muted/40 transition-all duration-200">
                            <td className="px-4 py-3 text-foreground font-medium">{t.lead_name || '—'}</td>
                            <td className="px-4 py-3 text-muted-foreground text-xs font-mono">{t.lead_phone}</td>
                            <td className="px-4 py-3 text-foreground/80 text-xs">{t.event_title}</td>
                            <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">
                              <div className="flex items-center gap-1">
                                <Calendar size={12} />
                                {formatDate(t.event_date)}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground text-xs">
                              {t.event_location ? (
                                <div className="flex items-center gap-1">
                                  <MapPin size={12} />
                                  <span className="truncate max-w-[200px]">{t.event_location}</span>
                                </div>
                              ) : '—'}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground text-xs">
                              {t.case_number ? (
                                <div className="flex items-center gap-1">
                                  <Hash size={12} />
                                  <span className="font-mono">{t.case_number}</span>
                                </div>
                              ) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Tempo estimado: ~{Math.ceil(broadcastTargets.length * broadcastInterval / 60)} min ({broadcastTargets.length} msgs × {broadcastInterval}s)
                  </p>
                </div>
              )}
            </div>

            {/* Aviso PAUSADO_AUTO — circuit breaker do anti-ban disparou */}
            {activeBroadcast && activeBroadcast.status === 'PAUSADO_AUTO' && (
              <div className="bg-card border border-amber-500/40 rounded-2xl p-6 space-y-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={16} className="text-amber-400" />
                  <h3 className="text-sm font-semibold text-foreground">Disparo pausado automaticamente</h3>
                  <span className="text-xs text-muted-foreground">— {activeBroadcast.name}</span>
                </div>
                {(activeBroadcast as any).pause_reason && (
                  <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                    {(activeBroadcast as any).pause_reason}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  O sistema detectou problema (instância desconectada ou falhas seguidas)
                  e parou o disparo pra preservar a conta. Verifique o WhatsApp, valide
                  os números, e clique em <strong>Retomar</strong> pra continuar de onde parou.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      if (!confirm('Retomar disparo? Os itens pendentes serão re-enfileirados.')) return;
                      try {
                        await apiFetch(`/followup/broadcasts/${activeBroadcast.id}/resume`, { method: 'PATCH' });
                        const data = await apiFetch(`/followup/broadcasts/${activeBroadcast.id}`);
                        setActiveBroadcast(data);
                      } catch (err) {
                        showError(err instanceof Error ? err.message : 'Erro ao retomar');
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 border border-emerald-600/30 text-emerald-400 hover:bg-emerald-600/30 text-xs font-medium transition-all duration-200"
                  >
                    <RefreshCw size={13} />
                    Retomar disparo
                  </button>
                  <button
                    onClick={() => handleCancelBroadcast(activeBroadcast.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600/20 border border-red-600/30 text-red-400 hover:bg-red-600/30 text-xs font-medium transition-all duration-200"
                  >
                    <XCircle size={13} />
                    Cancelar definitivamente
                  </button>
                </div>
              </div>
            )}

            {/* Progresso do disparo ativo */}
            {activeBroadcast && activeBroadcast.status === 'ENVIANDO' && (
              <div className="bg-card border border-blue-500/30 rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <RefreshCw size={16} className="text-blue-400 animate-spin" />
                    <h3 className="text-sm font-semibold text-foreground">Disparo em andamento</h3>
                    <span className="text-xs text-muted-foreground">— {activeBroadcast.name}</span>
                  </div>
                  <button
                    onClick={() => handleCancelBroadcast(activeBroadcast.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600/20 border border-red-600/30 text-red-400 hover:bg-red-600/30 text-xs font-medium transition-all duration-200"
                  >
                    <XCircle size={13} />
                    Cancelar
                  </button>
                </div>

                {/* Barra de progresso */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Progresso</span>
                    <span className="text-foreground font-medium">
                      {activeBroadcast.sent_count + activeBroadcast.failed_count} / {activeBroadcast.total_targets}
                    </span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-3 overflow-hidden">
                    <div className="h-full flex">
                      <div
                        className="bg-green-500 transition-all duration-500"
                        style={{ width: `${activeBroadcast.total_targets > 0 ? (activeBroadcast.sent_count / activeBroadcast.total_targets) * 100 : 0}%` }}
                      />
                      <div
                        className="bg-red-500 transition-all duration-500"
                        style={{ width: `${activeBroadcast.total_targets > 0 ? (activeBroadcast.failed_count / activeBroadcast.total_targets) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex gap-4 text-xs">
                    <span className="text-green-400">Enviados: {activeBroadcast.sent_count}</span>
                    {activeBroadcast.failed_count > 0 && (
                      <span className="text-red-400">Falhas: {activeBroadcast.failed_count}</span>
                    )}
                    <span className="text-muted-foreground">
                      Restante: {activeBroadcast.total_targets - activeBroadcast.sent_count - activeBroadcast.failed_count}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Histórico de disparos */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">Histórico de Disparos</h3>
                <button
                  onClick={fetchBroadcasts}
                  className="p-2 rounded-lg bg-muted border border-border text-muted-foreground hover:text-foreground hover:border-border transition-all duration-200"
                  title="Atualizar"
                >
                  <RefreshCw size={14} className={loadingBroadcasts ? 'animate-spin' : ''} />
                </button>
              </div>

              {loadingBroadcasts ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <RefreshCw size={18} className="animate-spin mr-2" />
                  Carregando...
                </div>
              ) : broadcasts.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-border rounded-2xl">
                  <Radio size={32} className="mx-auto mb-3 opacity-30 text-muted-foreground" />
                  <p className="text-muted-foreground text-sm">Nenhum disparo realizado ainda.</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">Use o formulário acima para criar o primeiro disparo.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {broadcasts.map(b => {
                    const progress = b.total_targets > 0 ? Math.round(((b.sent_count + b.failed_count) / b.total_targets) * 100) : 0;
                    const statusColors: Record<string, string> = {
                      PENDENTE: 'text-yellow-400 bg-yellow-400/10',
                      ENVIANDO: 'text-blue-400 bg-blue-400/10',
                      CONCLUIDO: 'text-green-400 bg-green-400/10',
                      CANCELADO: 'text-red-400 bg-red-400/10',
                      PAUSADO_AUTO: 'text-amber-400 bg-amber-400/10', // anti-ban 2026-05-13
                    };

                    return (
                      <div key={b.id} className="bg-card border border-border rounded-xl overflow-hidden transition-all duration-200">
                        <div className="flex items-center gap-4 px-5 py-4">
                          <button
                            onClick={() => setExpandedBroadcast(expandedBroadcast === b.id ? null : b.id)}
                            className="p-1 text-muted-foreground hover:text-foreground/80 transition-all duration-200"
                          >
                            <ChevronDown
                              size={16}
                              className={`transition-transform duration-200 ${expandedBroadcast === b.id ? 'rotate-180' : ''}`}
                            />
                          </button>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-foreground text-sm">{b.name}</span>
                              <Badge label={b.status} colorClass={statusColors[b.status] ?? 'text-muted-foreground bg-muted/50'} />
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                              <span>{b.sent_count}/{b.total_targets} enviados</span>
                              {b.failed_count > 0 && <span className="text-red-400">{b.failed_count} falhas</span>}
                              <span>·</span>
                              <span>{formatDate(b.created_at)}</span>
                              {b.created_by?.name && <><span>·</span><span>{b.created_by.name}</span></>}
                            </div>
                          </div>

                          {/* Mini progress bar */}
                          <div className="w-24 shrink-0">
                            <div className="w-full bg-muted rounded-full h-1.5">
                              <div
                                className={`h-1.5 rounded-full transition-all duration-500 ${b.status === 'CONCLUIDO' ? 'bg-green-500' : b.status === 'CANCELADO' ? 'bg-red-500' : 'bg-blue-500'}`}
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                            <p className="text-xs text-muted-foreground text-center mt-1">{progress}%</p>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {b.status === 'PAUSADO_AUTO' && (
                              <button
                                onClick={async () => {
                                  if (!confirm('Retomar disparo? Os itens pendentes serão re-enfileirados.')) return;
                                  try {
                                    await apiFetch(`/followup/broadcasts/${b.id}/resume`, { method: 'PATCH' });
                                    fetchBroadcasts();
                                  } catch (err) {
                                    showError(err instanceof Error ? err.message : 'Erro ao retomar');
                                  }
                                }}
                                title="Retomar disparo pausado automaticamente"
                                className="p-1.5 rounded text-emerald-400 hover:bg-emerald-400/10 transition-all duration-200"
                              >
                                <RefreshCw size={14} />
                              </button>
                            )}
                            {(b.status === 'ENVIANDO' || b.status === 'PAUSADO_AUTO') && (
                              <button
                                onClick={() => handleCancelBroadcast(b.id)}
                                title="Cancelar"
                                className="p-1.5 rounded text-red-400 hover:bg-red-400/10 transition-all duration-200"
                              >
                                <XCircle size={14} />
                              </button>
                            )}
                            <button
                              onClick={() => handleViewBroadcast(b.id)}
                              title="Ver detalhes"
                              className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-200"
                            >
                              <Eye size={14} />
                            </button>
                          </div>
                        </div>

                        {/* Items expandidos */}
                        {expandedBroadcast === b.id && activeBroadcast?.id === b.id && activeBroadcast.items && (
                          <div className="border-t border-border bg-background/40 px-5 py-4">
                            <div className="max-h-64 overflow-y-auto space-y-1.5">
                              {activeBroadcast.items.map(item => {
                                const itemStatusColors: Record<string, string> = {
                                  PENDENTE: 'text-yellow-400',
                                  ENVIADO: 'text-green-400',
                                  FALHOU: 'text-red-400',
                                  PULADO: 'text-muted-foreground',
                                };
                                const itemStatusIcons: Record<string, React.ReactNode> = {
                                  PENDENTE: <Clock size={12} />,
                                  ENVIADO: <CheckCircle size={12} />,
                                  FALHOU: <XCircle size={12} />,
                                  PULADO: <Pause size={12} />,
                                };
                                return (
                                  <div key={item.id} className="flex items-center gap-3 px-3 py-2 bg-muted/60 rounded-lg text-xs">
                                    <span className={itemStatusColors[item.status] ?? 'text-muted-foreground'}>
                                      {itemStatusIcons[item.status] ?? <Clock size={12} />}
                                    </span>
                                    <span className="text-foreground font-medium min-w-[120px]">{(item as any).lead?.name || '—'}</span>
                                    <span className="text-muted-foreground font-mono">{item.phone}</span>
                                    <Badge label={item.status} colorClass={`${itemStatusColors[item.status] ?? 'text-muted-foreground'} bg-muted/50`} />
                                    {item.sent_at && <span className="text-muted-foreground ml-auto">{formatDate(item.sent_at)}</span>}
                                    {item.error && <span className="text-red-400 truncate max-w-[200px]" title={item.error}>{item.error}</span>}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Modais ─────────────────────────────────────────────────────────── */}
      {seqModal.open && (
        <SequenceModal
          initial={seqModal.seq}
          onClose={() => setSeqModal({ open: false })}
          onSave={handleSaveSequence}
        />
      )}

      {stepModal.open && (
        <StepModal
          sequenceId={stepModal.seqId}
          initial={stepModal.step}
          onClose={() => setStepModal({ open: false, seqId: '' })}
          onSave={handleSaveStep}
        />
      )}

      {/* MELHORIA 1: Modal de Contexto */}
      {contextModal.open && contextModal.message && (
        <ContextModal
          msg={contextModal.message}
          onClose={() => setContextModal({ open: false, message: null })}
        />
      )}

      {/* MELHORIA 4: Modal de Enrolar Lead */}
      {enrollModal && (
        <EnrollLeadModal
          sequences={sequences.filter(s => s.active)}
          onClose={() => setEnrollModal(false)}
          onEnroll={handleEnrollLead}
        />
      )}
    </div>
  );
}
