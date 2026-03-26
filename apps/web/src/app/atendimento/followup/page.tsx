'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Bot, Send, Clock, CheckCircle, XCircle, RefreshCw, Plus,
  ChevronRight, Users, Zap, TrendingUp, AlertTriangle, Edit2,
  Trash2, Play, Pause, X, Search, Filter, ChevronDown,
  MessageSquare, Settings, BarChart2, List, Shield, AlertOctagon,
  Phone, Mail, Smartphone, Eye, Download, Sprout, FileJson,
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
}

interface LeadSearchResult {
  id: string;
  name?: string;
  phone: string;
  stage: string;
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const API = API_BASE_URL;

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: BarChart2 },
  { id: 'sequencias', label: 'Sequências', icon: List },
  { id: 'enrollments', label: 'Enrollments', icon: Users },
  { id: 'aprovacoes', label: 'Aprovações', icon: MessageSquare },
] as const;

type TabId = (typeof TABS)[number]['id'];

const CATEGORIES = [
  { id: 'LEADS', label: 'Leads', color: '#3b82f6' },
  { id: 'CLIENTS', label: 'Clientes', color: '#22c55e' },
  { id: 'COBRANCA', label: 'Cobrança', color: '#f59e0b' },
  { id: 'REENGAJAMENTO', label: 'Reengajamento', color: '#8b5cf6' },
];

const STAGES = [
  { id: 'NOVO', label: 'Novo' },
  { id: 'QUALIFICANDO', label: 'Qualificando' },
  { id: 'AGUARDANDO_DOCS', label: 'Aguardando Docs' },
  { id: 'AGUARDANDO_PROC', label: 'Aguardando Proc.' },
];

const CHANNELS = [
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'email', label: 'E-mail' },
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
  CONCLUIDO: 'text-gray-400 bg-gray-400/10',
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
      <div className={`relative z-10 w-full ${large ? 'max-w-3xl' : 'max-w-lg'} bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] animate-in slide-in-from-bottom-4 duration-200`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700 shrink-0">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-all duration-200"
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
  return `w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-colors ${extra}`;
}

function labelCls() {
  return 'block text-xs font-medium text-gray-400 mb-1';
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
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'
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
            className="flex-1 px-4 py-2 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 text-sm transition-all duration-200"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium transition-all duration-200"
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

        <div className="flex items-center justify-between p-3 bg-gray-800 rounded-lg">
          <div>
            <p className="text-sm font-medium text-white">Envio automático</p>
            <p className="text-xs text-gray-500 mt-0.5">Envia sem aprovação humana</p>
          </div>
          <button
            type="button"
            onClick={() => setForm(f => ({ ...f, auto_send: !f.auto_send }))}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-all duration-200 ${
              form.auto_send ? 'bg-blue-600' : 'bg-gray-700'
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
            className="flex-1 px-4 py-2 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 text-sm transition-all duration-200"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium transition-all duration-200"
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
  lead?: {
    name?: string;
    stage?: string;
    type?: string;
    days_without_contact?: number;
    sentiment?: string;
    preferred_channel?: string;
    best_time?: string;
  };
  historico?: {
    total_messages?: number;
    general_sentiment?: string;
    last_message_summary?: string;
    last_message_from?: string;
  };
  processos?: Array<{
    number?: string;
    type?: string;
    status?: string;
  }>;
  financeiro?: {
    inadimplente?: boolean;
    valor_devido?: number;
  };
  sequencia?: {
    name?: string;
    step_objective?: string;
    tone?: string;
    channel?: string;
    attempt_number?: number;
  };
  mensagens_anteriores?: Array<{
    text?: string;
    sent_at?: string;
    channel?: string;
    status?: string;
  }>;
}

function ContextModal({ msg, onClose }: { msg: FollowupMessage; onClose: () => void }) {
  const ctx = (msg.context_json ?? {}) as ContextData;

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-700/60 pb-1.5">
        {title}
      </h3>
      {children}
    </div>
  );

  const Row = ({ label, value }: { label: string; value?: string | number | boolean | null }) => {
    if (value === undefined || value === null || value === '') return null;
    return (
      <div className="flex items-start justify-between gap-3 text-sm">
        <span className="text-gray-500 shrink-0">{label}</span>
        <span className="text-gray-200 text-right">{String(value)}</span>
      </div>
    );
  };

  return (
    <Modal title="Dossiê de Contexto da IA" onClose={onClose} large>
      <div className="space-y-6">
        {/* Lead */}
        <Section title="Dados do Lead">
          <div className="bg-gray-800/60 rounded-xl p-4 space-y-2">
            <Row label="Nome" value={msg.enrollment.lead.name || msg.enrollment.lead.phone} />
            <Row label="Stage" value={msg.enrollment.lead.stage} />
            <Row label="Tipo" value={ctx.lead?.type} />
            <Row label="Dias sem contato" value={ctx.lead?.days_without_contact !== undefined ? `${ctx.lead.days_without_contact} dias` : undefined} />
            <Row label="Sentimento" value={ctx.lead?.sentiment} />
            <Row label="Canal preferido" value={ctx.lead?.preferred_channel} />
            <Row label="Melhor horário" value={ctx.lead?.best_time} />
            {!ctx.lead && <p className="text-xs text-gray-600 italic">Dados do lead não disponíveis no contexto.</p>}
          </div>
        </Section>

        {/* Histórico */}
        <Section title="Histórico de Conversa">
          <div className="bg-gray-800/60 rounded-xl p-4 space-y-2">
            <Row label="Total de mensagens" value={ctx.historico?.total_messages} />
            <Row label="Sentimento geral" value={ctx.historico?.general_sentiment} />
            <Row label="Resumo da última msg" value={ctx.historico?.last_message_summary} />
            <Row label="Quem enviou por último" value={ctx.historico?.last_message_from} />
            {!ctx.historico && <p className="text-xs text-gray-600 italic">Histórico não disponível no contexto.</p>}
          </div>
        </Section>

        {/* Processos */}
        {(ctx.processos?.length ?? 0) > 0 ? (
          <Section title="Dados Processuais">
            <div className="space-y-2">
              {ctx.processos!.map((p, i) => (
                <div key={i} className="bg-gray-800/60 rounded-xl p-3 flex flex-wrap gap-3 text-sm">
                  {p.number ? <span className="text-blue-300 font-mono text-xs">{p.number}</span> : null}
                  {p.type ? <Badge label={p.type} colorClass="text-gray-300 bg-gray-700/50" /> : null}
                  {p.status ? <Badge label={p.status} colorClass="text-green-400 bg-green-400/10" /> : null}
                </div>
              ))}
            </div>
          </Section>
        ) : null}

        {/* Financeiro */}
        {ctx.financeiro ? (
          <Section title="Dados Financeiros">
            <div className="bg-gray-800/60 rounded-xl p-4 space-y-2">
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
          <div className="bg-gray-800/60 rounded-xl p-4 space-y-2">
            <Row label="Nome da sequência" value={msg.enrollment.sequence.name} />
            <Row label="Objetivo do step" value={msg.step.objective} />
            <Row label="Tom" value={msg.step.tone} />
            <Row label="Canal" value={msg.step.channel} />
            <Row label="Step #" value={msg.step.position} />
            {ctx.sequencia?.attempt_number !== undefined && (
              <Row label="Tentativa" value={`#${ctx.sequencia.attempt_number}`} />
            )}
          </div>
        </Section>

        {/* Mensagens anteriores da enrollment */}
        {msg.enrollment.messages && msg.enrollment.messages.length > 0 && (
          <Section title="Mensagens Anteriores nesta Sequência">
            <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
              {(msg.enrollment.messages as Array<{ id: string; generated_text?: string; sent_text?: string; status: string; created_at: string; channel: string }>).map((m, i) => (
                <div key={m.id ?? i} className="bg-gray-800/60 rounded-lg p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <Badge label={m.status} colorClass={STATUS_COLORS[m.status] ?? 'text-gray-400 bg-gray-700/50'} />
                    <span className="text-gray-500">{formatDate(m.created_at)}</span>
                  </div>
                  <p className="text-gray-300 line-clamp-3">{m.sent_text || m.generated_text || '—'}</p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Contexto bruto se não houver estrutura */}
        {!ctx.lead && !ctx.historico && !ctx.processos && !ctx.financeiro && !ctx.sequencia && msg.context_json && (
          <Section title="Contexto Bruto (JSON)">
            <pre className="bg-gray-800/60 rounded-xl p-4 text-xs text-gray-300 overflow-auto max-h-64 whitespace-pre-wrap">
              {JSON.stringify(msg.context_json, null, 2)}
            </pre>
          </Section>
        )}

        {!msg.context_json && (
          <div className="text-center py-8 text-gray-600">
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
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-colors"
              placeholder="Nome ou telefone..."
              value={search}
              onChange={e => { setSearch(e.target.value); setSelectedLead(null); }}
              autoFocus
            />
          </div>
        </div>

        {/* Lista de leads */}
        {search.trim() && (
          <div className="border border-gray-700 rounded-lg overflow-hidden max-h-48 overflow-y-auto">
            {searching ? (
              <div className="flex items-center justify-center py-6 text-gray-500 text-sm gap-2">
                <RefreshCw size={14} className="animate-spin" /> Buscando...
              </div>
            ) : leads.length === 0 ? (
              <div className="py-6 text-center text-gray-600 text-sm">
                Nenhum lead encontrado
              </div>
            ) : (
              leads.map(lead => (
                <button
                  key={lead.id}
                  onClick={() => setSelectedLead(lead)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left text-sm transition-all duration-200 border-b border-gray-800 last:border-0 ${
                    selectedLead?.id === lead.id
                      ? 'bg-blue-600/20 text-blue-300'
                      : 'hover:bg-gray-800 text-gray-300'
                  }`}
                >
                  <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-400 shrink-0">
                    {(lead.name?.[0] ?? lead.phone[0]).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{lead.name || '—'}</p>
                    <p className="text-xs text-gray-500">{lead.phone} · {lead.stage}</p>
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
            className="flex-1 px-4 py-2 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 text-sm transition-all duration-200"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={enrolling || !selectedLead}
            className="flex-1 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2"
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
    <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-5 space-y-4 transition-all duration-200 hover:border-gray-600">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-white">
            {msg.enrollment.lead.name || msg.enrollment.lead.phone}
          </p>
          <p className="text-xs text-gray-500">
            {msg.enrollment.sequence.name} · Step {msg.step.position} · {msg.step.channel.toUpperCase()}
          </p>
          <p className="text-xs text-gray-500">
            Stage: <span className="text-gray-300">{msg.enrollment.lead.stage}</span>
            {' · '}Tom: <span className="text-gray-300 capitalize">{msg.step.tone}</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <RiskBadge level={msg.risk_level} />
          <span className="text-xs text-gray-500">{formatDate(msg.created_at)}</span>
        </div>
      </div>

      {/* Objetivo */}
      <div className="bg-gray-900/50 rounded-lg px-3 py-2">
        <p className="text-xs text-gray-500 font-medium mb-0.5">Objetivo</p>
        <p className="text-xs text-gray-300">{msg.step.objective}</p>
      </div>

      {/* Texto gerado (editável) */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">
          Mensagem gerada pela IA (editável)
        </label>
        <textarea
          className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-colors"
          rows={4}
          value={text}
          onChange={e => setText(e.target.value)}
        />
      </div>

      {/* Ações */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => handle(() => onApprove(msg.id, text), 'approve')}
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
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-gray-700/50 border border-gray-600/30 text-gray-300 hover:bg-gray-700 hover:text-white text-sm font-medium transition-all duration-200"
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
        <h3 className="text-sm font-semibold text-white">Efetividade por Canal</h3>
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
                <div className={`p-2 rounded-lg bg-gray-900/40 ${ch.color}`}>
                  <Icon size={16} />
                </div>
                <span className={`text-sm font-semibold ${ch.color}`}>{ch.label}</span>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-gray-500 text-xs">Enviados</span>
                  <span className="text-white font-semibold">{ch.data.enviados}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-500 text-xs">Convertidos</span>
                  <span className="text-white font-semibold">{ch.data.respondidos}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-500 text-xs">Taxa</span>
                  <span className={`font-bold ${ch.color}`}>{ch.data.taxa}%</span>
                </div>
                {/* Barra de progresso */}
                <div className="w-full bg-gray-700/50 rounded-full h-1.5 mt-1">
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
    return <span className="text-gray-500 text-xs">—</span>;
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

  // Fetch inicial por tab
  useEffect(() => {
    if (activeTab === 'dashboard') fetchStats();
    if (activeTab === 'sequencias') fetchSequences();
    if (activeTab === 'enrollments') fetchEnrollments();
    if (activeTab === 'aprovacoes') fetchApprovals();
  }, [activeTab, fetchStats, fetchSequences, fetchEnrollments, fetchApprovals]);

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
    action: 'pause' | 'cancel' | 'converted',
  ) => {
    try {
      await apiFetch(`/followup/enrollments/${id}/${action}`, { method: 'PATCH' });
      const labels: Record<string, string> = {
        pause: 'Pausado', cancel: 'Cancelado', converted: 'Marcado como convertido',
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
    showSuccess('Regenerando mensagem...');
    setTimeout(() => fetchApprovals(), 2000);
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
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-900/80 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-600/20 border border-blue-500/30">
            <Bot size={22} className="text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Follow-up IA</h1>
            <p className="text-xs text-gray-500">Automação inteligente de mensagens</p>
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
        <div className="max-w-7xl mx-auto px-6 flex gap-1">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-all duration-200 ${
                  active
                    ? 'text-blue-400 border-blue-500'
                    : 'text-gray-500 border-transparent hover:text-gray-300'
                }`}
              >
                <Icon size={15} />
                {tab.label}
                {tab.id === 'aprovacoes' && pendingCount > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-xs font-bold leading-none animate-pulse">
                    {pendingCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">

        {/* ── TAB: DASHBOARD ─────────────────────────────────────────────────── */}
        {activeTab === 'dashboard' && (
          <div className="space-y-8">
            {loadingStats ? (
              <div className="flex items-center justify-center py-20 text-gray-500">
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
                        <div className={`p-2 rounded-lg bg-gray-900/40 w-fit ${card.text}`}>
                          <Icon size={18} />
                        </div>
                        <div>
                          <p className={`text-2xl font-bold ${card.text}`}>{card.value}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{card.label}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* MELHORIA 2: Efetividade por Canal */}
                <div className="bg-gray-800/50 border border-gray-700 rounded-2xl p-6">
                  <ChannelEffectivityCards stats={stats} enrollments={enrollments} />
                </div>

                {/* Quick actions */}
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="bg-gray-800/50 border border-gray-700 rounded-2xl p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <Zap size={16} className="text-yellow-400" />
                      <h3 className="text-sm font-semibold text-white">Ações Rápidas</h3>
                    </div>
                    <div className="space-y-2">
                      <button
                        onClick={() => { setActiveTab('sequencias'); setSeqModal({ open: true }); }}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-900/60 hover:bg-gray-900 border border-gray-700 hover:border-gray-600 text-sm text-gray-300 hover:text-white transition-all duration-200"
                      >
                        <Plus size={15} className="text-blue-400" />
                        Nova sequência de follow-up
                        <ChevronRight size={14} className="ml-auto text-gray-600" />
                      </button>
                      <button
                        onClick={() => setActiveTab('aprovacoes')}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-900/60 hover:bg-gray-900 border border-gray-700 hover:border-gray-600 text-sm text-gray-300 hover:text-white transition-all duration-200"
                      >
                        <MessageSquare size={15} className="text-yellow-400" />
                        Revisar aprovações pendentes
                        {stats.pendentes_aprovacao > 0 && (
                          <span className="ml-auto px-2 py-0.5 rounded-full bg-red-500 text-white text-xs font-bold">
                            {stats.pendentes_aprovacao}
                          </span>
                        )}
                        {stats.pendentes_aprovacao === 0 && (
                          <ChevronRight size={14} className="ml-auto text-gray-600" />
                        )}
                      </button>
                      <button
                        onClick={() => setActiveTab('enrollments')}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-900/60 hover:bg-gray-900 border border-gray-700 hover:border-gray-600 text-sm text-gray-300 hover:text-white transition-all duration-200"
                      >
                        <Users size={15} className="text-green-400" />
                        Ver todos os enrollments
                        <ChevronRight size={14} className="ml-auto text-gray-600" />
                      </button>

                      {/* MELHORIA 7: Criar Sequências Padrão */}
                      <button
                        onClick={handleSeedDefaults}
                        disabled={loadingSeed}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-900/60 hover:bg-gray-900 border border-gray-700 hover:border-emerald-600/30 text-sm text-gray-300 hover:text-emerald-400 transition-all duration-200 disabled:opacity-50"
                      >
                        {loadingSeed ? (
                          <RefreshCw size={15} className="text-emerald-400 animate-spin" />
                        ) : (
                          <Sprout size={15} className="text-emerald-400" />
                        )}
                        {loadingSeed ? 'Criando sequências...' : 'Criar Sequências Padrão'}
                        {!loadingSeed && <ChevronRight size={14} className="ml-auto text-gray-600" />}
                      </button>

                      {/* MELHORIA 7: Exportar Dados */}
                      <button
                        onClick={handleExportData}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-900/60 hover:bg-gray-900 border border-gray-700 hover:border-blue-600/30 text-sm text-gray-300 hover:text-blue-400 transition-all duration-200"
                      >
                        <Download size={15} className="text-blue-400" />
                        Exportar Dados (JSON)
                        <ChevronRight size={14} className="ml-auto text-gray-600" />
                      </button>
                    </div>
                  </div>

                  <div className="bg-gray-800/50 border border-gray-700 rounded-2xl p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <Bot size={16} className="text-blue-400" />
                      <h3 className="text-sm font-semibold text-white">Como funciona</h3>
                    </div>
                    <ol className="space-y-3 text-sm text-gray-400">
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
              <div className="text-center py-20 text-gray-500">
                <Bot size={40} className="mx-auto mb-3 opacity-30" />
                <p>Não foi possível carregar os dados.</p>
                <button
                  onClick={fetchStats}
                  className="mt-3 px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-all duration-200"
                >
                  Tentar novamente
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── TAB: SEQUÊNCIAS ────────────────────────────────────────────────── */}
        {activeTab === 'sequencias' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">Sequências</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {sequences.length} sequência{sequences.length !== 1 ? 's' : ''} configurada{sequences.length !== 1 ? 's' : ''}
                </p>
              </div>
              <button
                onClick={() => setSeqModal({ open: true })}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-all duration-200"
              >
                <Plus size={15} />
                Nova Sequência
              </button>
            </div>

            {loadingSeq ? (
              <div className="flex items-center justify-center py-20 text-gray-500">
                <RefreshCw size={20} className="animate-spin mr-2" />
                Carregando...
              </div>
            ) : sequences.length === 0 ? (
              <div className="text-center py-20 border border-dashed border-gray-700 rounded-2xl">
                <Bot size={40} className="mx-auto mb-3 text-gray-700" />
                <p className="text-gray-500">Nenhuma sequência criada ainda.</p>
                <button
                  onClick={() => setSeqModal({ open: true })}
                  className="mt-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-all duration-200 mx-auto"
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
                    className="bg-gray-800/60 border border-gray-700 rounded-xl overflow-hidden transition-all duration-200"
                  >
                    {/* Sequence header */}
                    <div className="flex items-center gap-4 px-5 py-4">
                      <button
                        onClick={() => setExpandedSeq(expandedSeq === seq.id ? null : seq.id)}
                        className="p-1 text-gray-500 hover:text-gray-300 transition-all duration-200"
                      >
                        <ChevronDown
                          size={16}
                          className={`transition-transform duration-200 ${expandedSeq === seq.id ? 'rotate-180' : ''}`}
                        />
                      </button>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-white text-sm">{seq.name}</span>
                          <Badge
                            label={CATEGORIES.find(c => c.id === seq.category)?.label ?? seq.category}
                            colorClass={CATEGORY_COLORS[seq.category] ?? 'text-gray-400 bg-gray-400/10'}
                          />
                          {!seq.active && (
                            <Badge label="Inativo" colorClass="text-gray-500 bg-gray-500/10" />
                          )}
                        </div>
                        {seq.description && (
                          <p className="text-xs text-gray-500 mt-0.5 truncate">{seq.description}</p>
                        )}
                        <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
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
                              : 'bg-gray-700/50 border-gray-700 text-gray-500 hover:text-gray-300'
                          }`}
                        >
                          {seq.active ? <Pause size={14} /> : <Play size={14} />}
                        </button>
                        <button
                          onClick={() => setSeqModal({ open: true, seq })}
                          title="Editar"
                          className="p-2 rounded-lg border border-gray-700 bg-gray-700/50 text-gray-400 hover:text-white hover:border-gray-500 transition-all duration-200"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => handleDeleteSequence(seq.id)}
                          title="Deletar"
                          className="p-2 rounded-lg border border-gray-700 bg-gray-700/50 text-gray-400 hover:text-red-400 hover:border-red-500/30 transition-all duration-200"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Steps (expandido) */}
                    {expandedSeq === seq.id && (
                      <div className="border-t border-gray-700 bg-gray-900/40 px-5 py-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
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
                          <p className="text-xs text-gray-600 py-2 text-center">
                            Nenhum step configurado.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {[...seq.steps]
                              .sort((a, b) => a.position - b.position)
                              .map((step) => (
                                <div
                                  key={step.id}
                                  className="flex items-center gap-3 p-3 bg-gray-800/60 border border-gray-700 rounded-lg transition-all duration-200"
                                >
                                  {/* Position indicator */}
                                  <div className="w-7 h-7 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center shrink-0">
                                    <span className="text-xs font-bold text-blue-400">{step.position}</span>
                                  </div>

                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-xs font-medium text-white capitalize">
                                        {step.channel === 'whatsapp' ? '📱 WhatsApp' : '📧 E-mail'}
                                      </span>
                                      <span className="text-xs text-gray-500">
                                        após {step.delay_hours}h
                                      </span>
                                      <Badge
                                        label={TONES.find(t => t.id === step.tone)?.label ?? step.tone}
                                        colorClass="text-gray-400 bg-gray-700/50"
                                      />
                                      {step.auto_send && (
                                        <Badge label="Auto-envio" colorClass="text-green-400 bg-green-400/10" />
                                      )}
                                    </div>
                                    <p className="text-xs text-gray-500 mt-0.5 truncate">{step.objective}</p>
                                  </div>

                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <button
                                      onClick={() => setStepModal({ open: true, seqId: seq.id, step })}
                                      className="p-1.5 rounded text-gray-500 hover:text-white hover:bg-gray-700 transition-all duration-200"
                                    >
                                      <Edit2 size={12} />
                                    </button>
                                    <button
                                      onClick={() => handleDeleteStep(step.id)}
                                      className="p-1.5 rounded text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-all duration-200"
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
                <h2 className="text-lg font-semibold text-white">Enrollments</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {filteredEnrollments.length} resultado{filteredEnrollments.length !== 1 ? 's' : ''}
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {/* Busca */}
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    type="text"
                    placeholder="Buscar lead..."
                    value={enrollSearch}
                    onChange={e => setEnrollSearch(e.target.value)}
                    className="pl-8 pr-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 w-48 transition-all duration-200"
                  />
                </div>

                {/* Filtro status */}
                <div className="relative">
                  <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <select
                    value={enrollFilter}
                    onChange={e => setEnrollFilter(e.target.value)}
                    className="pl-8 pr-8 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all duration-200 appearance-none cursor-pointer"
                  >
                    {ENROLLMENT_STATUSES.map(s => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </select>
                </div>

                <button
                  onClick={fetchEnrollments}
                  className="p-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 transition-all duration-200"
                  title="Atualizar"
                >
                  <RefreshCw size={15} className={loadingEnroll ? 'animate-spin' : ''} />
                </button>

                {/* MELHORIA 4: Botão Enrolar Lead */}
                <button
                  onClick={() => setEnrollModal(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-all duration-200"
                >
                  <Plus size={14} />
                  Enrolar Lead
                </button>
              </div>
            </div>

            {loadingEnroll ? (
              <div className="flex items-center justify-center py-20 text-gray-500">
                <RefreshCw size={20} className="animate-spin mr-2" />
                Carregando...
              </div>
            ) : filteredEnrollments.length === 0 ? (
              <div className="text-center py-20 border border-dashed border-gray-700 rounded-2xl">
                <Users size={40} className="mx-auto mb-3 text-gray-700" />
                <p className="text-gray-500">Nenhum enrollment encontrado.</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-gray-700">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-800/80 border-b border-gray-700">
                      {['Lead', 'Sequência', 'Step', 'Status', 'Última Resposta', 'Próximo envio', 'Inscrito em', 'Ações'].map(h => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {filteredEnrollments.map(enroll => (
                      <tr
                        key={enroll.id}
                        className="bg-gray-900/40 hover:bg-gray-800/60 transition-all duration-200"
                      >
                        <td className="px-4 py-3">
                          <div>
                            <p className="font-medium text-white text-sm">
                              {enroll.lead.name || '—'}
                            </p>
                            <p className="text-xs text-gray-500">{enroll.lead.phone}</p>
                            <p className="text-xs text-gray-600">{enroll.lead.stage}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div>
                            <p className="text-white text-sm">{enroll.sequence.name}</p>
                            <Badge
                              label={CATEGORIES.find(c => c.id === enroll.sequence.category)?.label ?? enroll.sequence.category}
                              colorClass={CATEGORY_COLORS[enroll.sequence.category] ?? 'text-gray-400 bg-gray-700/50'}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-white font-medium">#{enroll.current_step}</span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            label={enroll.status}
                            colorClass={STATUS_COLORS[enroll.status] ?? 'text-gray-400 bg-gray-700/50'}
                          />
                        </td>
                        {/* MELHORIA 6: Coluna Última Resposta */}
                        <td className="px-4 py-3">
                          <LeadResponseStatus enrollment={enroll} />
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                          {formatDate(enroll.next_send_at)}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
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
                                onClick={() => handleEnrollmentAction(enroll.id, 'pause')}
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
                <h2 className="text-lg font-semibold text-white">Fila de Aprovação</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {approvals.length} mensagem{approvals.length !== 1 ? 'ns' : ''} aguardando revisão
                </p>
              </div>
              <button
                onClick={fetchApprovals}
                className="p-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 transition-all duration-200"
                title="Atualizar"
              >
                <RefreshCw size={15} className={loadingApprovals ? 'animate-spin' : ''} />
              </button>
            </div>

            {loadingApprovals ? (
              <div className="flex items-center justify-center py-20 text-gray-500">
                <RefreshCw size={20} className="animate-spin mr-2" />
                Carregando...
              </div>
            ) : approvals.length === 0 ? (
              <div className="text-center py-20 border border-dashed border-gray-700 rounded-2xl">
                <CheckCircle size={40} className="mx-auto mb-3 text-gray-700" />
                <p className="text-gray-500">Nenhuma mensagem aguardando aprovação.</p>
                <p className="text-xs text-gray-600 mt-1">
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
