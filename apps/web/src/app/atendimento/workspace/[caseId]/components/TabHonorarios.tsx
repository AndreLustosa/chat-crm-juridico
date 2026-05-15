'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DollarSign, Loader2, Plus, ChevronDown, ChevronUp,
  Trash2, Check, Calendar, CreditCard, Copy, ExternalLink, QrCode,
  AlertTriangle, Pencil, Coins,
} from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

// ─── Types ───────────────────────────────────────────────

interface HonorarioPaymentItem {
  id: string;
  amount: string;
  paid_amount?: string | null; // Recebimento parcial (feature 2026-05-15)
  due_date: string | null;
  paid_at: string | null;
  payment_method: string | null;
  status: string;
  notes: string | null;
}

interface CaseHonorarioItem {
  id: string;
  type: string;
  total_value: string;
  success_percentage: string | null;
  calculated_value: string | null;
  sentence_value: string | null;
  interest_rate: string | null;
  status: string;
  installment_count: number;
  contract_date: string | null;
  notes: string | null;
  created_at: string;
  payments: HonorarioPaymentItem[];
}

const HONORARIO_TYPES = [
  { id: 'CONTRATUAL', label: 'Honorários Contratuais' },
  { id: 'SUCUMBENCIA', label: 'Honorários de Sucumbência' },
  { id: 'ENTRADA', label: 'Entrada' },
  { id: 'ACORDO', label: 'Acordo' },
];

const PAYMENT_METHODS = [
  { id: 'PIX', label: 'PIX' },
  { id: 'BOLETO', label: 'Boleto' },
  { id: 'CARTAO', label: 'Cartão' },
  { id: 'DINHEIRO', label: 'Dinheiro' },
  { id: 'TRANSFERENCIA', label: 'Transferência' },
];

const STATUS_COLORS: Record<string, string> = {
  PAGO: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  PARCIAL: 'bg-blue-500/15 text-blue-400 border-blue-500/30', // Feature 2026-05-15
  PENDENTE: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  ATRASADO: 'bg-red-500/15 text-red-400 border-red-500/30',
};

const STATUS_LABEL: Record<string, string> = {
  PAGO: 'Pago',
  PARCIAL: 'Parcial',
  PENDENTE: 'Pendente',
  ATRASADO: 'Atrasado',
};

const TYPE_COLORS: Record<string, string> = {
  CONTRATUAL: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  SUCUMBENCIA: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  ENTRADA: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  ACORDO: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  // Compat antigos
  FIXO: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  EXITO: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  MISTO: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
};

function formatCurrency(value: number | string): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(num);
}

/**
 * Input monetário formato brasileiro: R$ 1.000,00
 * Armazena valor numérico internamente, exibe formatado.
 */
function CurrencyInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const [display, setDisplay] = useState(() => {
    if (!value) return '';
    const num = parseFloat(value);
    return isNaN(num) || num === 0 ? '' : num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  });

  const handleChange = (raw: string) => {
    // Remove tudo exceto dígitos
    const digits = raw.replace(/\D/g, '');
    if (!digits) {
      setDisplay('');
      onChange('');
      return;
    }
    // Converte para centavos → reais
    const cents = parseInt(digits, 10);
    const reais = cents / 100;
    const formatted = reais.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    setDisplay(formatted);
    onChange(reais.toString());
  };

  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground font-bold">R$</span>
      <input
        type="text"
        inputMode="numeric"
        value={display}
        onChange={e => handleChange(e.target.value)}
        placeholder={placeholder || '0,00'}
        autoFocus={autoFocus}
        className={className || "w-full pl-9 pr-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"}
      />
    </div>
  );
}

function formatDate(d: string | null) {
  if (!d) return '—';
  // Bug fix 2026-05-15 (Andre reportou "mostra um dia a menos"):
  // Datas armazenadas como UTC midnight (ex: 2026-07-01T00:00:00Z)
  // sem timeZone='UTC' eram convertidas pra BRT local e perdiam 1 dia
  // (vinha 30/06/2026 em vez de 01/07/2026). Agora usamos timeZone:'UTC'
  // pra exibir a data como ela foi gravada, sem deslocamento.
  return new Date(d).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    timeZone: 'UTC',
  });
}

// ─── Custom Select (sem fundo branco) ───────────────────

function CustomSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { id: string; label: string }[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [open]);

  const selected = options.find(o => o.id === value);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all cursor-pointer"
      >
        <span className={selected ? 'text-foreground' : 'text-muted-foreground/50'}>
          {selected?.label || placeholder || 'Selecione...'}
        </span>
        <ChevronDown size={12} className={`text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-card border border-border rounded-xl shadow-xl shadow-black/20 py-1 max-h-48 overflow-y-auto">
          {options.map(o => (
            <button
              key={o.id}
              type="button"
              onClick={() => { onChange(o.id); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-[11px] transition-colors ${value === o.id ? 'text-primary font-bold bg-primary/10' : 'text-foreground hover:bg-accent/30'}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Component ───────────────────────────────────────────

export default function TabHonorarios({ caseId }: { caseId: string }) {
  const [honorarios, setHonorarios] = useState<CaseHonorarioItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/honorarios/case/${caseId}`);
      setHonorarios(res.data || []);
    } catch {
      showError('Erro ao carregar honorários');
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ─── Summary ──────────────────────────────────────────

  const summary = honorarios.reduce(
    (acc, h) => {
      const total = parseFloat(h.total_value);
      acc.contracted += total;
      h.payments.forEach(p => {
        const amount = parseFloat(p.amount);
        if (p.status === 'PAGO') acc.received += amount;
        else if (p.status === 'ATRASADO') acc.overdue += amount;
        else acc.pending += amount;
      });
      return acc;
    },
    { contracted: 0, received: 0, pending: 0, overdue: 0 },
  );

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-primary" />
          Honorários
          {honorarios.length > 0 && (
            <span className="text-xs text-muted-foreground">({honorarios.length})</span>
          )}
        </h2>
        <button
          onClick={() => setShowCreate(true)}
          className="btn btn-primary btn-sm gap-1"
        >
          <Plus className="h-3.5 w-3.5" /> Novo Contrato
        </button>
      </div>

      {/* Summary bar */}
      {honorarios.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-accent/20 rounded-lg p-3 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Contratado</p>
            <p className="text-sm font-bold text-foreground mt-0.5">{formatCurrency(summary.contracted)}</p>
          </div>
          <div className="bg-emerald-500/10 rounded-lg p-3 text-center">
            <p className="text-[10px] text-emerald-400 uppercase tracking-wider">Recebido</p>
            <p className="text-sm font-bold text-emerald-400 mt-0.5">{formatCurrency(summary.received)}</p>
          </div>
          <div className="bg-amber-500/10 rounded-lg p-3 text-center">
            <p className="text-[10px] text-amber-400 uppercase tracking-wider">Pendente</p>
            <p className="text-sm font-bold text-amber-400 mt-0.5">{formatCurrency(summary.pending)}</p>
          </div>
          <div className="bg-red-500/10 rounded-lg p-3 text-center">
            <p className="text-[10px] text-red-400 uppercase tracking-wider">Atrasado</p>
            <p className="text-sm font-bold text-red-400 mt-0.5">{formatCurrency(summary.overdue)}</p>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-14">
          <Loader2 size={20} className="animate-spin text-primary" />
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <CreateHonorarioForm
          caseId={caseId}
          onCreated={() => { setShowCreate(false); fetchData(); }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* Empty state */}
      {!loading && honorarios.length === 0 && !showCreate && (
        <div className="text-center py-12 text-muted-foreground">
          <DollarSign className="h-12 w-12 mx-auto mb-2 opacity-30" />
          <p>Nenhum contrato de honorários</p>
          <p className="text-xs mt-1">Clique em &quot;Novo Contrato&quot; para registrar</p>
        </div>
      )}

      {/* List */}
      {!loading && honorarios.length > 0 && (
        <div className="space-y-4">
          {honorarios.map(h => (
            <HonorarioCard
              key={h.id}
              honorario={h}
              expanded={expandedIds.has(h.id)}
              onToggle={() => toggleExpand(h.id)}
              onRefresh={fetchData}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Create Form ─────────────────────────────────────────

function CreateHonorarioForm({
  caseId,
  onCreated,
  onCancel,
}: {
  caseId: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState('CONTRATUAL');
  const [totalValue, setTotalValue] = useState('');
  const [sentenceValue, setSentenceValue] = useState('');
  const [successPercentage, setSuccessPercentage] = useState('');
  const [installmentCount, setInstallmentCount] = useState('1');
  const [contractDate, setContractDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  // Pagamento retroativo — marcar tudo como pago ao criar
  const [alreadyPaid, setAlreadyPaid] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('PIX');

  const isSucumbencia = type === 'SUCUMBENCIA';

  // Valor calculado da sucumbência
  const calculatedValue = isSucumbencia && sentenceValue && successPercentage
    ? (parseFloat(sentenceValue) * parseFloat(successPercentage) / 100)
    : 0;

  const handleCreate = async () => {
    if (isSucumbencia) {
      if (!sentenceValue || parseFloat(sentenceValue) <= 0 || !successPercentage || parseFloat(successPercentage) <= 0) {
        showError('Informe o valor da condenação e a porcentagem');
        return;
      }
    } else {
      if (!totalValue || parseFloat(totalValue) <= 0) {
        showError('Informe o valor total');
        return;
      }
    }

    setSaving(true);
    try {
      await api.post(`/honorarios/case/${caseId}`, {
        type,
        ...(isSucumbencia
          ? {
              sentence_value: parseFloat(sentenceValue),
              success_percentage: parseFloat(successPercentage),
            }
          : {
              total_value: parseFloat(totalValue),
              installment_count: parseInt(installmentCount) || 1,
              contract_date: contractDate || undefined,
            }),
        notes: notes.trim() || undefined,
        // Pagamento retroativo — backend marca todas as parcelas como PAGO
        // e cria FinancialTransaction correspondente (regime de caixa).
        ...(alreadyPaid && !isSucumbencia ? {
          already_paid: true,
          payment_method: paymentMethod,
        } : {}),
      });
      showSuccess(
        alreadyPaid && !isSucumbencia
          ? 'Contrato criado e parcelas marcadas como pagas'
          : 'Contrato criado com parcelas geradas',
      );
      onCreated();
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao criar contrato');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-card border border-primary/30 rounded-2xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-primary/20 bg-primary/5">
        <h3 className="text-[13px] font-bold text-foreground flex items-center gap-2">
          <Plus size={14} className="text-primary" />
          Novo Contrato de Honorários
        </h3>
      </div>
      <div className="p-5 space-y-4">
        {/* Tipo */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Tipo de Honorário</label>
          <CustomSelect
            value={type}
            onChange={(v) => { setType(v); if (v !== 'SUCUMBENCIA') setInstallmentCount('1'); }}
            options={HONORARIO_TYPES}
          />
        </div>

        {/* ── SUCUMBENCIA: valor condenação + porcentagem ── */}
        {isSucumbencia ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Valor da Condenação</label>
                <CurrencyInput
                  value={sentenceValue}
                  onChange={setSentenceValue}
                  placeholder="50.000,00"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Porcentagem de Sucumbência (%)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  placeholder="20"
                  value={successPercentage}
                  onChange={e => setSuccessPercentage(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
                />
              </div>
            </div>
            {calculatedValue > 0 && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-violet-500/10 border border-violet-500/20">
                <DollarSign size={14} className="text-violet-400" />
                <span className="text-[12px] text-violet-400 font-bold">
                  Valor calculado: {formatCurrency(calculatedValue)}
                </span>
              </div>
            )}
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <AlertTriangle size={14} className="text-amber-400" />
              <span className="text-[11px] text-amber-400">
                Pagamento via alvará judicial — sem data de vencimento definida
              </span>
            </div>
          </div>
        ) : (
          /* ── CONTRATUAL / ENTRADA / ACORDO ── */
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  {type === 'ENTRADA' ? 'Valor da Entrada' : 'Valor Total'}
                </label>
                <CurrencyInput
                  value={totalValue}
                  onChange={setTotalValue}
                  placeholder="5.000,00"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">N. de Parcelas</label>
                <input
                  type="number"
                  min="1"
                  max="120"
                  value={installmentCount}
                  onChange={e => setInstallmentCount(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Data do 1° Vencimento</label>
                <input
                  type="date"
                  value={contractDate}
                  onChange={e => setContractDate(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
                />
              </div>
            </div>
          </div>
        )}

        {/* Observações */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Observações</label>
          <input
            type="text"
            placeholder="Observações (opcional)"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
          />
        </div>

        {/* ── Pagamento retroativo — so pra tipos com data definida ── */}
        {!isSucumbencia && (
          <div className="space-y-2.5 px-4 py-3.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={alreadyPaid}
                onChange={e => setAlreadyPaid(e.target.checked)}
                className="w-4 h-4 rounded border-border accent-emerald-500 cursor-pointer"
              />
              <div className="flex-1">
                <span className="text-[12px] font-bold text-emerald-400 flex items-center gap-1.5">
                  <Check size={12} />
                  Já recebido
                </span>
                <span className="text-[10px] text-muted-foreground block mt-0.5">
                  Marca todas as parcelas como PAGAS (pagamento retroativo — registra entrada no financeiro)
                </span>
              </div>
            </label>

            {alreadyPaid && (
              <div className="pl-6 pt-2 border-t border-emerald-500/15 space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  Método de pagamento
                </label>
                <CustomSelect
                  value={paymentMethod}
                  onChange={setPaymentMethod}
                  options={[
                    { id: 'PIX', label: 'PIX' },
                    { id: 'DINHEIRO', label: 'Dinheiro' },
                    { id: 'TRANSFERENCIA', label: 'Transferência' },
                    { id: 'CARTAO', label: 'Cartão' },
                    { id: 'BOLETO', label: 'Boleto' },
                  ]}
                />
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            disabled={saving}
            className="px-4 py-2 rounded-xl border border-border text-[11px] font-bold text-muted-foreground hover:bg-accent/30 transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleCreate}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-[11px] font-bold hover:opacity-90 transition-opacity disabled:opacity-50 shadow-lg shadow-primary/20"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            Criar Contrato
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Honorario Card ──────────────────────────────────────

function HonorarioCard({
  honorario,
  expanded,
  onToggle,
  onRefresh,
}: {
  honorario: CaseHonorarioItem;
  expanded: boolean;
  onToggle: () => void;
  onRefresh: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null);
  const [showAddPayment, setShowAddPayment] = useState(false);
  // Edicao (feature 2026-05-14): andre reportou que honorarios cadastrados
  // nao eram editaveis. Forms inline pra editar o contrato e cada parcela.
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [editingContract, setEditingContract] = useState(false);
  // Recebimento parcial (feature 2026-05-15): modal pra registrar valor
  // recebido < amount total da parcela.
  const [partialReceiveId, setPartialReceiveId] = useState<string | null>(null);
  const [chargingId, setChargingId] = useState<string | null>(null);
  const [chargeResult, setChargeResult] = useState<{ paymentId: string; type: string; pixCopyPaste?: string; pixQrCode?: string; boletoUrl?: string; invoiceUrl?: string } | null>(null);
  const [chargeMenuId, setChargeMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setChargeMenuId(null);
      }
    }
    if (chargeMenuId) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [chargeMenuId]);

  const handleCreateCharge = async (paymentId: string, billingType: string) => {
    setChargeMenuId(null);
    setChargingId(paymentId);
    try {
      const res = await api.post('/payment-gateway/charges', { honorarioPaymentId: paymentId, billingType });
      const charge = res.data;
      setChargeResult({
        paymentId,
        type: billingType,
        pixCopyPaste: charge.pix_copy_paste,
        pixQrCode: charge.pix_qr_code,
        boletoUrl: charge.boleto_url,
        invoiceUrl: charge.invoice_url,
      });
      showSuccess(`Cobrança ${billingType} gerada!`);
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao gerar cobrança');
    } finally {
      setChargingId(null);
    }
  };

  const paidCount = honorario.payments.filter(p => p.status === 'PAGO').length;
  const totalPayments = honorario.payments.length;
  const totalPaid = honorario.payments
    .filter(p => p.status === 'PAGO')
    .reduce((s, p) => s + parseFloat(p.amount), 0);

  const typeLabel = HONORARIO_TYPES.find(t => t.id === honorario.type)?.label || honorario.type;

  const handleDelete = async () => {
    if (!confirm('Excluir este contrato e todas as parcelas?')) return;
    setDeleting(true);
    try {
      await api.delete(`/honorarios/${honorario.id}`);
      showSuccess('Contrato excluído');
      onRefresh();
    } catch {
      showError('Erro ao excluir');
    } finally {
      setDeleting(false);
    }
  };

  const handleMarkPaid = async (paymentId: string) => {
    setMarkingId(paymentId);
    try {
      await api.patch(`/honorarios/payments/${paymentId}/mark-paid`, {});
      showSuccess('Parcela marcada como paga');
      onRefresh();
    } catch {
      showError('Erro ao marcar como pago');
    } finally {
      setMarkingId(null);
    }
  };

  const handleDeletePayment = async (paymentId: string) => {
    if (!confirm('Excluir esta parcela?')) return;
    setDeletingPaymentId(paymentId);
    try {
      await api.delete(`/honorarios/payments/${paymentId}`);
      showSuccess('Parcela excluída');
      onRefresh();
    } catch {
      showError('Erro ao excluir parcela');
    } finally {
      setDeletingPaymentId(null);
    }
  };

  const pctPaid = parseFloat(honorario.total_value) > 0
    ? Math.round((totalPaid / parseFloat(honorario.total_value)) * 100)
    : 0;

  // Calcular juros para parcelas vencidas
  const monthlyRate = honorario.interest_rate ? parseFloat(honorario.interest_rate) : 1.0;
  const now = new Date();

  function calcInterest(payment: HonorarioPaymentItem) {
    if (payment.status === 'PAGO' || !payment.due_date) return 0;
    const dueDate = new Date(payment.due_date);
    if (dueDate >= now) return 0;
    const msPerMonth = 30.44 * 24 * 60 * 60 * 1000;
    const months = Math.max(0, (now.getTime() - dueDate.getTime()) / msPerMonth);
    return Math.round(parseFloat(payment.amount) * (monthlyRate / 100) * months * 100) / 100;
  }

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-accent/10 transition-colors bg-accent/20"
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
          <DollarSign size={14} className="text-primary shrink-0" />
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-lg border ${TYPE_COLORS[honorario.type] || 'bg-accent/30 text-foreground border-border'}`}>
            {typeLabel}
          </span>
          {honorario.success_percentage && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg border border-border bg-accent/30 text-muted-foreground">
              {parseFloat(honorario.success_percentage)}%
            </span>
          )}
          <span className="text-[14px] font-bold text-foreground">
            {formatCurrency(honorario.total_value)}
          </span>
          {honorario.sentence_value && (
            <span className="text-[11px] text-violet-400 font-semibold">
              (Condenação: {formatCurrency(honorario.sentence_value)})
            </span>
          )}
          <span className="text-[11px] text-muted-foreground">
            ({paidCount}/{totalPayments} parcelas)
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {honorario.contract_date && (
            <span className="text-[11px] text-muted-foreground/60 flex items-center gap-1.5">
              <Calendar size={11} />
              {formatDate(honorario.contract_date)}
            </span>
          )}
          {expanded ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border">
          {/* Progress bar */}
          <div className="px-5 pt-4">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-2">
              <span>Progresso: {formatCurrency(totalPaid)} / {formatCurrency(honorario.total_value)}</span>
              <span className="font-bold text-emerald-400">{pctPaid}%</span>
            </div>
            <div className="w-full bg-accent/30 rounded-full h-2 overflow-hidden">
              <div
                className="bg-gradient-to-r from-emerald-500 to-emerald-400 h-2 rounded-full transition-all"
                style={{ width: `${Math.min(100, pctPaid)}%` }}
              />
            </div>
          </div>

          {honorario.notes && (
            <p className="px-5 pt-3 text-[11px] text-muted-foreground/70 italic">{honorario.notes}</p>
          )}

          {/* Payments list */}
          <div className="px-5 pt-4 pb-2">
            {/*
              Refatoracao 2026-05-14 (terceira iteracao): painel lateral
              eh estreito (~600px) — grid horizontal com 7 colunas + 4
              botoes de acao nao cabia. Acoes ficavam clipadas pelo
              overflow do drawer e o operador so via o primeiro icone
              (cobranca). Agora cada parcela vira um CARD vertical:
              - Linha 1: numero + valor + status (sempre visivel)
              - Linha 2: vencimento + metodo + pago em
              - Linha 3: SEMPRE 4 botoes de acao (cobranca / pago / editar / excluir)
                em flex row. Garantido caber porque sao 4 botoes pequenos
                de ~28px = 112px + gaps em ~140px no total.
            */}
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">
              Parcelas
            </p>

            {honorario.payments.map((p, idx) => {
              const interest = calcInterest(p);
              return (
                <div key={p.id} className="border border-border/40 rounded-lg p-3 mb-2 hover:bg-accent/10 transition-colors">
                  {/* Linha 1: # + valor + status */}
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <span className="text-[11px] font-mono text-muted-foreground shrink-0">#{idx + 1}</span>
                    <span className="text-[13px] font-bold text-foreground shrink-0">{formatCurrency(p.amount)}</span>
                    {interest > 0 && (
                      <span className="text-[10px] text-red-400">+ {formatCurrency(interest)} juros</span>
                    )}
                    {/* Recebimento parcial (feature 2026-05-15): mostra "R$ X recebido" */}
                    {p.status === 'PARCIAL' && p.paid_amount && (
                      <span className="text-[10px] text-blue-400 font-semibold">
                        ({formatCurrency(p.paid_amount)} recebido · saldo {formatCurrency(parseFloat(p.amount) - parseFloat(p.paid_amount))})
                      </span>
                    )}
                    <span className="ml-auto shrink-0">
                      <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-lg border ${STATUS_COLORS[p.status] || 'bg-accent/30 text-muted-foreground border-border'}`}>
                        {STATUS_LABEL[p.status] || p.status}
                      </span>
                    </span>
                  </div>
                  {/* Barra de progresso quando PARCIAL */}
                  {p.status === 'PARCIAL' && p.paid_amount && (
                    <div className="w-full bg-accent/30 rounded-full h-1.5 overflow-hidden mb-1.5">
                      <div
                        className="h-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all"
                        style={{ width: `${Math.min(100, (parseFloat(p.paid_amount) / parseFloat(p.amount)) * 100)}%` }}
                      />
                    </div>
                  )}

                  {/* Linha 2: metadados (vencimento, metodo, pago em) */}
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap mb-2">
                    <span className="flex items-center gap-1">
                      <Calendar size={10} />
                      {p.due_date ? formatDate(p.due_date) : <span className="italic">Alvará</span>}
                    </span>
                    {p.payment_method && (
                      <span>Método: <span className="text-foreground">{p.payment_method}</span></span>
                    )}
                    {p.paid_at && (
                      <span>Pago em: <span className="text-emerald-400">{formatDate(p.paid_at)}</span></span>
                    )}
                  </div>

                  {/* Linha 3: botoes de acao — sempre visiveis */}
                  <div className="flex items-center gap-1.5 pt-2 border-t border-border/30">
                    {p.status !== 'PAGO' && (
                      <>
                        {/* Cobranca: dropdown PIX/Boleto/Cartao */}
                        <div className="relative shrink-0" ref={chargeMenuId === p.id ? menuRef : undefined}>
                          <button
                            onClick={() => setChargeMenuId(chargeMenuId === p.id ? null : p.id)}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-primary/30 text-primary hover:bg-primary/10 transition-colors text-[11px] font-semibold"
                            title="Gerar cobrança"
                          >
                            {chargingId === p.id ? <Loader2 size={12} className="animate-spin" /> : <CreditCard size={12} />}
                            Cobrar
                          </button>
                          {chargeMenuId === p.id && (
                            <div className="absolute left-0 top-full mt-1 z-50 bg-card border border-border rounded-xl shadow-xl shadow-black/20 py-1 min-w-[120px]">
                              <button onClick={() => handleCreateCharge(p.id, 'PIX')} className="w-full text-left px-3 py-2 text-[11px] text-foreground hover:bg-accent/30 transition-colors">PIX</button>
                              <button onClick={() => handleCreateCharge(p.id, 'BOLETO')} className="w-full text-left px-3 py-2 text-[11px] text-foreground hover:bg-accent/30 transition-colors">Boleto</button>
                              <button onClick={() => handleCreateCharge(p.id, 'CREDIT_CARD')} className="w-full text-left px-3 py-2 text-[11px] text-foreground hover:bg-accent/30 transition-colors">Cartão</button>
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => handleMarkPaid(p.id)}
                          disabled={markingId === p.id}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 transition-colors disabled:opacity-50 text-[11px] font-semibold shrink-0"
                          title="Marcar como pago (valor total)"
                        >
                          {markingId === p.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                          Pago
                        </button>
                        {/* Recebimento parcial (feature 2026-05-15) */}
                        <button
                          onClick={() => setPartialReceiveId(p.id)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-blue-500/30 text-blue-400 hover:bg-blue-500/10 transition-colors text-[11px] font-semibold shrink-0"
                          title="Registrar recebimento parcial (valor menor que o total da parcela)"
                        >
                          <Coins size={12} />
                          Parcial
                        </button>
                      </>
                    )}
                    {/* Editar parcela — sempre visivel */}
                    <button
                      onClick={() => setEditingPaymentId(editingPaymentId === p.id ? null : p.id)}
                      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md border transition-colors shrink-0 text-[11px] font-semibold ${editingPaymentId === p.id ? 'bg-blue-500/20 border-blue-500/40 text-blue-400' : 'border-blue-500/30 text-blue-400 hover:bg-blue-500/10'}`}
                      title="Editar parcela"
                    >
                      <Pencil size={12} />
                      Editar
                    </button>
                    <button
                      onClick={() => handleDeletePayment(p.id)}
                      disabled={deletingPaymentId === p.id}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50 text-[11px] font-semibold shrink-0 ml-auto"
                      title="Excluir parcela"
                    >
                      {deletingPaymentId === p.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      Excluir
                    </button>
                  </div>
                {/* Form de edicao inline (feature 2026-05-14) */}
                {editingPaymentId === p.id && (
                  <EditPaymentForm
                    payment={p}
                    onSaved={() => { setEditingPaymentId(null); onRefresh(); }}
                    onCancel={() => setEditingPaymentId(null)}
                  />
                )}
                </div>
              );
            })}
          </div>

          {/* Add payment form */}
          {showAddPayment && (
            <AddPaymentForm
              honorarioId={honorario.id}
              onAdded={() => { setShowAddPayment(false); onRefresh(); }}
              onCancel={() => setShowAddPayment(false)}
            />
          )}

          {/* Charge result inline */}
          {chargeResult && (
            <div className="mx-5 mb-4 p-4 rounded-xl border border-primary/30 bg-primary/5 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-[13px] font-bold text-foreground flex items-center gap-2">
                  {chargeResult.type === 'PIX' ? <QrCode size={14} className="text-emerald-400" /> : <CreditCard size={14} className="text-blue-400" />}
                  Cobrança {chargeResult.type} Gerada
                </h4>
                <button onClick={() => setChargeResult(null)} className="p-1 rounded-lg hover:bg-accent/30 text-muted-foreground transition-colors text-[12px]">&#10005;</button>
              </div>

              {chargeResult.pixCopyPaste && (
                <div className="space-y-2">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Código PIX Copia e Cola:</p>
                  <div className="flex gap-2">
                    <input readOnly value={chargeResult.pixCopyPaste} className="flex-1 px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[11px] font-mono text-foreground focus:outline-none" />
                    <button
                      onClick={() => { navigator.clipboard.writeText(chargeResult.pixCopyPaste!); showSuccess('Copiado!'); }}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-[11px] font-bold hover:opacity-90 transition-opacity shadow-lg shadow-primary/20"
                    >
                      <Copy size={12} /> Copiar
                    </button>
                  </div>
                </div>
              )}

              {chargeResult.boletoUrl && (
                <a href={chargeResult.boletoUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1.5 w-full px-4 py-2 rounded-xl bg-primary text-primary-foreground text-[11px] font-bold hover:opacity-90 transition-opacity shadow-lg shadow-primary/20">
                  <ExternalLink size={12} /> Abrir Boleto
                </a>
              )}

              {chargeResult.invoiceUrl && (
                <a href={chargeResult.invoiceUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1.5 w-full px-4 py-2 rounded-xl border border-border text-[11px] font-bold text-muted-foreground hover:bg-accent/30 transition-colors">
                  <ExternalLink size={12} /> Ver Fatura
                </a>
              )}
            </div>
          )}

          {/* Form de edicao do contrato (feature 2026-05-14) */}
          {editingContract && (
            <EditHonorarioForm
              honorario={honorario}
              onSaved={() => { setEditingContract(false); onRefresh(); }}
              onCancel={() => setEditingContract(false)}
            />
          )}

          {/* Actions footer */}
          <div className="flex items-center justify-between border-t border-border px-5 py-3">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowAddPayment(!showAddPayment)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-primary hover:bg-primary/10 transition-colors"
              >
                <Plus size={12} /> Adicionar Parcela
              </button>
              <button
                onClick={() => setEditingContract(!editingContract)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-blue-400 hover:bg-blue-500/10 transition-colors ${editingContract ? 'bg-blue-500/10' : ''}`}
              >
                <Pencil size={12} /> {editingContract ? 'Cancelar' : 'Editar Contrato'}
              </button>
            </div>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
            >
              {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              Excluir Contrato
            </button>
          </div>
        </div>
      )}

      {/* Modal de recebimento parcial (feature 2026-05-15) */}
      {partialReceiveId && (() => {
        const targetPayment = honorario.payments.find(p => p.id === partialReceiveId);
        if (!targetPayment) return null;
        return (
          <PartialReceiveModal
            payment={targetPayment}
            onSaved={() => { setPartialReceiveId(null); onRefresh(); }}
            onCancel={() => setPartialReceiveId(null)}
          />
        );
      })()}
    </div>
  );
}

// ─── Add Payment Form ────────────────────────────────────

function AddPaymentForm({
  honorarioId,
  onAdded,
  onCancel,
}: {
  honorarioId: string;
  onAdded: () => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [method, setMethod] = useState('');
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    const val = parseFloat(amount);
    if (!val || val <= 0) {
      showError('Informe o valor da parcela');
      return;
    }
    setSaving(true);
    try {
      await api.post(`/honorarios/${honorarioId}/payments`, {
        amount: val,
        due_date: dueDate || undefined,
        payment_method: method || undefined,
      });
      showSuccess('Parcela adicionada');
      onAdded();
    } catch {
      showError('Erro ao adicionar parcela');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-t border-border bg-accent/10 px-5 py-4 space-y-3">
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Nova Parcela</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Valor</label>
          <CurrencyInput
            value={amount}
            onChange={setAmount}
            placeholder="1.000,00"
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Vencimento (opcional)</label>
          <input
            type="date"
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Método</label>
          <CustomSelect
            value={method}
            onChange={setMethod}
            options={PAYMENT_METHODS}
            placeholder="Método"
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-4 py-2 rounded-xl border border-border text-[11px] font-bold text-muted-foreground hover:bg-accent/30 transition-colors">Cancelar</button>
        <button
          onClick={handleAdd}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-[11px] font-bold hover:opacity-90 transition-opacity disabled:opacity-50 shadow-lg shadow-primary/20"
        >
          {saving && <Loader2 size={12} className="animate-spin" />}
          Adicionar
        </button>
      </div>
    </div>
  );
}

// ─── EditPaymentForm (feature 2026-05-14) ─────────────────────
//
// Form inline pra editar uma parcela existente: amount, due_date,
// payment_method, notes. Backend: PATCH /honorarios/payments/:paymentId
// (so afeta parcelas nao pagas — pra mudar status usar mark-paid).

function EditPaymentForm({
  payment,
  onSaved,
  onCancel,
}: {
  payment: HonorarioPaymentItem;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState(payment.amount || '');
  const [dueDate, setDueDate] = useState(payment.due_date ? payment.due_date.slice(0, 10) : '');
  const [method, setMethod] = useState(payment.payment_method || '');
  const [notes, setNotes] = useState(payment.notes || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const val = parseFloat(amount);
    if (!val || val <= 0) {
      showError('Informe o valor da parcela');
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/honorarios/payments/${payment.id}`, {
        amount: val,
        due_date: dueDate || null,
        payment_method: method || null,
        notes: notes || null,
      });
      showSuccess('Parcela atualizada');
      onSaved();
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao atualizar parcela');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-blue-500/[0.04] border-t border-blue-500/20 px-5 py-4 space-y-3">
      <p className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">Editar Parcela</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Valor</label>
          <CurrencyInput value={amount} onChange={setAmount} autoFocus />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Vencimento</label>
          <input
            type="date"
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Método</label>
          <CustomSelect value={method} onChange={setMethod} options={PAYMENT_METHODS} placeholder="Método" />
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Observações</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          className="w-full px-3 py-2 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all resize-none"
          placeholder="Notas internas sobre essa parcela"
        />
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-4 py-2 rounded-xl border border-border text-[11px] font-bold text-muted-foreground hover:bg-accent/30 transition-colors">Cancelar</button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-[11px] font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving && <Loader2 size={12} className="animate-spin" />}
          Salvar
        </button>
      </div>
    </div>
  );
}

// ─── EditHonorarioForm (feature 2026-05-14) ──────────────────
//
// Form inline pra editar o contrato de honorario: type, total_value,
// contract_date, interest_rate, notes. Backend: PATCH /honorarios/:id.

function EditHonorarioForm({
  honorario,
  onSaved,
  onCancel,
}: {
  honorario: CaseHonorarioItem;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState(honorario.type || '');
  const [totalValue, setTotalValue] = useState(honorario.total_value || '');
  const [contractDate, setContractDate] = useState(honorario.contract_date ? honorario.contract_date.slice(0, 10) : '');
  const [interestRate, setInterestRate] = useState(honorario.interest_rate || '');
  const [notes, setNotes] = useState(honorario.notes || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const val = parseFloat(totalValue);
    if (!val || val <= 0) {
      showError('Informe o valor total do contrato');
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/honorarios/${honorario.id}`, {
        type: type || undefined,
        total_value: val,
        contract_date: contractDate || undefined,
        interest_rate: interestRate ? parseFloat(interestRate) : undefined,
        notes: notes !== undefined ? notes : undefined,
      });
      showSuccess('Contrato atualizado');
      onSaved();
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao atualizar contrato');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-blue-500/[0.04] border-t border-blue-500/20 px-5 py-4 space-y-3">
      <p className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">Editar Contrato</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Tipo</label>
          <CustomSelect value={type} onChange={setType} options={HONORARIO_TYPES} placeholder="Tipo de honorário" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Valor Total</label>
          <CurrencyInput value={totalValue} onChange={setTotalValue} autoFocus />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Data do Contrato</label>
          <input
            type="date"
            value={contractDate}
            onChange={e => setContractDate(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Juros Mensal (%)</label>
          <input
            type="number"
            value={interestRate}
            onChange={e => setInterestRate(e.target.value)}
            step="0.01"
            placeholder="1.00"
            className="w-full px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Observações</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          className="w-full px-3 py-2 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all resize-none"
          placeholder="Notas internas sobre o contrato"
        />
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-4 py-2 rounded-xl border border-border text-[11px] font-bold text-muted-foreground hover:bg-accent/30 transition-colors">Cancelar</button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-[11px] font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving && <Loader2 size={12} className="animate-spin" />}
          Salvar
        </button>
      </div>
    </div>
  );
}

// ─── PartialReceiveModal (feature 2026-05-15) ────────────────
//
// Modal pra registrar recebimento PARCIAL de uma parcela. Cliente paga
// parte do valor (ex: R$ 3.000 de R$ 7.000), operador registra esse
// recebimento — paid_amount acumula. Quando atinge amount total, status
// vira PAGO automaticamente. Backend: PATCH /honorarios/payments/:id/
// partial-receive.

function PartialReceiveModal({
  payment,
  onSaved,
  onCancel,
}: {
  payment: HonorarioPaymentItem;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const totalAmount = parseFloat(payment.amount);
  const previousPaid = parseFloat(payment.paid_amount || '0');
  const remainingBalance = Math.max(0, totalAmount - previousPaid);

  const [amount, setAmount] = useState('');
  const [paidDate, setPaidDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const numericAmount = parseFloat(amount) || 0;
  const willClose = numericAmount >= remainingBalance && numericAmount > 0;

  const handleSave = async () => {
    if (!numericAmount || numericAmount <= 0) {
      showError('Informe o valor recebido');
      return;
    }
    if (numericAmount > remainingBalance + 0.01) {
      showError(`Valor excede o saldo da parcela (${formatCurrency(remainingBalance)})`);
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/honorarios/payments/${payment.id}/partial-receive`, {
        amount: numericAmount,
        payment_method: method || undefined,
        paid_at: paidDate || undefined,
        notes: notes || undefined,
      });
      showSuccess(willClose ? 'Parcela quitada!' : 'Recebimento parcial registrado');
      onSaved();
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao registrar recebimento');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !saving && onCancel()} />
      <div className="relative z-10 w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl p-5 space-y-4">
        <div className="flex items-center gap-2 text-blue-400 text-[14px] font-bold">
          <Coins size={16} /> Recebimento parcial
        </div>

        {/* Resumo da parcela */}
        <div className="bg-accent/30 rounded-lg p-3 space-y-1.5 text-[12px]">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total da parcela:</span>
            <span className="font-bold text-foreground">{formatCurrency(totalAmount)}</span>
          </div>
          {previousPaid > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Já recebido:</span>
              <span className="font-semibold text-emerald-400">{formatCurrency(previousPaid)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-border pt-1.5">
            <span className="text-muted-foreground">Saldo a receber:</span>
            <span className="font-bold text-amber-400">{formatCurrency(remainingBalance)}</span>
          </div>
        </div>

        {/* Form */}
        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              Valor recebido <span className="text-red-400">*</span>
            </label>
            <div className="mt-1">
              <CurrencyInput value={amount} onChange={setAmount} placeholder="0,00" autoFocus />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Data
              </label>
              <input
                type="date"
                value={paidDate}
                onChange={e => setPaidDate(e.target.value)}
                className="mt-1 w-full px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Método
              </label>
              <div className="mt-1">
                <CustomSelect value={method} onChange={setMethod} options={PAYMENT_METHODS} placeholder="Método" />
              </div>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              Observação
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full px-3 py-2 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/30 resize-none"
              placeholder="Ex: PIX confirmado, prometeu o restante até dia 25..."
            />
          </div>
        </div>

        {/* Aviso quando valor quita a parcela */}
        {willClose && numericAmount > 0 && (
          <p className="text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2 flex items-center gap-1.5">
            <Check size={12} />
            Esse valor quita a parcela — vai ser marcada como PAGO.
          </p>
        )}

        {/* Botoes */}
        <div className="flex gap-2 pt-2">
          <button
            onClick={onCancel}
            disabled={saving}
            className="flex-1 py-2.5 text-sm font-semibold border border-border rounded-lg hover:bg-accent transition-colors text-muted-foreground disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !numericAmount}
            className="flex-1 py-2.5 text-sm font-bold bg-blue-500 text-white rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Coins size={14} />}
            {willClose ? 'Quitar parcela' : 'Registrar recebimento'}
          </button>
        </div>
      </div>
    </div>
  );
}
