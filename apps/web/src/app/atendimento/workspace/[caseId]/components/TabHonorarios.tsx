'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import {
  DollarSign, Loader2, Plus, ChevronDown, ChevronUp,
  Trash2, Check, Calendar, CreditCard, Copy, ExternalLink, QrCode,
} from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

// ─── Types ───────────────────────────────────────────────

interface HonorarioPaymentItem {
  id: string;
  amount: string; // Decimal comes as string from Prisma
  due_date: string;
  paid_at: string | null;
  payment_method: string | null;
  status: string;
  notes: string | null;
}

interface CaseHonorarioItem {
  id: string;
  type: string;
  total_value: string; // Decimal comes as string
  success_percentage: string | null; // Percentual de êxito
  calculated_value: string | null; // Valor calculado do êxito
  status: string;
  installment_count: number;
  contract_date: string | null;
  notes: string | null;
  created_at: string;
  payments: HonorarioPaymentItem[];
}

const HONORARIO_TYPES = [
  { id: 'FIXO', label: 'Fixo' },
  { id: 'EXITO', label: 'Êxito' },
  { id: 'MISTO', label: 'Misto' },
  { id: 'ENTRADA', label: 'Entrada/Sinal' },
];

const PAYMENT_METHODS = [
  { id: 'PIX', label: 'PIX' },
  { id: 'BOLETO', label: 'Boleto' },
  { id: 'CARTAO', label: 'Cartão' },
  { id: 'DINHEIRO', label: 'Dinheiro' },
  { id: 'TRANSFERENCIA', label: 'Transferência' },
];

const STATUS_LABEL: Record<string, string> = {
  PAGO: 'Pago',
  PENDENTE: 'Pendente',
  ATRASADO: 'Atrasado',
};

const STATUS_COLORS: Record<string, string> = {
  PAGO: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  PENDENTE: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  ATRASADO: 'bg-red-500/15 text-red-400 border-red-500/30',
};

const TYPE_COLORS: Record<string, string> = {
  FIXO: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  EXITO: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  MISTO: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  ENTRADA: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
};

function formatCurrency(value: number | string): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(num);
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

// ─── Summary Card ────────────────────────────────────────

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`rounded-xl border p-3.5 text-center ${color}`}>
      <p className="text-[9px] font-bold uppercase tracking-wider opacity-80">{label}</p>
      <p className="text-[15px] font-bold mt-1">{formatCurrency(value)}</p>
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
    <div className="p-6 max-w-5xl mx-auto space-y-5">

      {/* Header Card */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between bg-accent/20">
          <h2 className="text-[13px] font-bold text-foreground flex items-center gap-2">
            <DollarSign size={14} className="text-primary" />
            Honorarios
            {honorarios.length > 0 && (
              <span className="text-[11px] font-normal text-muted-foreground">({honorarios.length})</span>
            )}
          </h2>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-[11px] font-bold hover:opacity-90 transition-opacity shadow-lg shadow-primary/20"
          >
            <Plus size={12} /> Novo Contrato
          </button>
        </div>

        {/* Summary bar */}
        {honorarios.length > 0 && (
          <div className="p-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SummaryCard label="Contratado" value={summary.contracted} color="bg-blue-500/10 border-blue-500/20 text-blue-400" />
              <SummaryCard label="Recebido" value={summary.received} color="bg-emerald-500/10 border-emerald-500/20 text-emerald-400" />
              <SummaryCard label="Pendente" value={summary.pending} color="bg-amber-500/10 border-amber-500/20 text-amber-400" />
              <SummaryCard label="Atrasado" value={summary.overdue} color="bg-red-500/10 border-red-500/20 text-red-400" />
            </div>
            {summary.contracted > 0 && (
              <div className="mt-4 flex items-center gap-4">
                <div className="flex-1 bg-accent/30 rounded-full h-2.5 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-emerald-500 to-emerald-400 h-2.5 rounded-full transition-all"
                    style={{ width: `${Math.min(100, Math.round((summary.received / summary.contracted) * 100))}%` }}
                  />
                </div>
                <span className="text-[12px] font-bold text-emerald-400 shrink-0">
                  {Math.round((summary.received / summary.contracted) * 100)}%
                </span>
              </div>
            )}
          </div>
        )}

        {/* Empty state inside the card when no summary */}
        {honorarios.length === 0 && !loading && !showCreate && (
          <div className="py-14 flex flex-col items-center justify-center">
            <DollarSign size={48} className="text-muted-foreground opacity-20 mb-3" />
            <p className="text-[13px] font-medium text-muted-foreground">Nenhum contrato de honorarios</p>
            <p className="text-[11px] text-muted-foreground/60 mt-1">Clique em &quot;Novo Contrato&quot; para registrar</p>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="flex justify-center py-14">
            <Loader2 size={20} className="animate-spin text-primary" />
          </div>
        )}
      </div>

      {/* Create form */}
      {showCreate && (
        <CreateHonorarioForm
          caseId={caseId}
          onCreated={() => { setShowCreate(false); fetchData(); }}
          onCancel={() => setShowCreate(false)}
        />
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
  const [type, setType] = useState('FIXO');
  const [totalValue, setTotalValue] = useState('');
  const [successPercentage, setSuccessPercentage] = useState('');
  const [installmentCount, setInstallmentCount] = useState('1');
  const [contractDate, setContractDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const isExito = type === 'EXITO' || type === 'MISTO';
  const isEntrada = type === 'ENTRADA';

  const handleCreate = async () => {
    const value = parseFloat(totalValue);
    if (!value || value <= 0) {
      showError('Informe o valor total');
      return;
    }
    setSaving(true);
    try {
      await api.post(`/honorarios/case/${caseId}`, {
        type,
        total_value: value,
        success_percentage: isExito && successPercentage ? parseFloat(successPercentage) : undefined,
        installment_count: parseInt(installmentCount) || 1,
        contract_date: contractDate || undefined,
        notes: notes.trim() || undefined,
      });
      showSuccess('Contrato criado com parcelas geradas');
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
          Novo Contrato de Honorarios
        </h3>
      </div>
      <div className="p-5 space-y-4">
        <div className={`grid grid-cols-1 ${isExito ? 'md:grid-cols-4' : 'md:grid-cols-3'} gap-4`}>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Tipo</label>
            <select
              value={type}
              onChange={e => { setType(e.target.value); if (e.target.value === 'ENTRADA') setInstallmentCount('1'); }}
              className="w-full px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all appearance-none cursor-pointer"
            >
              {HONORARIO_TYPES.map(t => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>
          {isExito && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Percentual de Exito (%)</label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="100"
                placeholder="30"
                value={successPercentage}
                onChange={e => setSuccessPercentage(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              {isEntrada ? 'Valor da Entrada (R$)' : isExito ? 'Valor Fixo/Entrada (R$)' : 'Valor Total (R$)'}
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="5000.00"
              value={totalValue}
              onChange={e => setTotalValue(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
              autoFocus
            />
          </div>
          {!isEntrada && (
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
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              {isEntrada ? 'Data do Pagamento' : 'Data do Contrato'}
            </label>
            <input
              type="date"
              value={contractDate}
              onChange={e => setContractDate(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Observacoes</label>
            <input
              type="text"
              placeholder="Observacoes (opcional)"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
            />
          </div>
        </div>
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
  const [chargingId, setChargingId] = useState<string | null>(null);
  const [chargeResult, setChargeResult] = useState<{ paymentId: string; type: string; pixCopyPaste?: string; pixQrCode?: string; boletoUrl?: string; invoiceUrl?: string } | null>(null);
  const [chargeMenuId, setChargeMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close charge menu on outside click
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
      showSuccess(`Cobranca ${billingType} gerada!`);
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao gerar cobranca');
    } finally {
      setChargingId(null);
    }
  };

  const paidCount = honorario.payments.filter(p => p.status === 'PAGO').length;
  const totalPayments = honorario.payments.length;
  const totalPaid = honorario.payments
    .filter(p => p.status === 'PAGO')
    .reduce((s, p) => s + parseFloat(p.amount), 0);

  const handleDelete = async () => {
    if (!confirm('Excluir este contrato e todas as parcelas?')) return;
    setDeleting(true);
    try {
      await api.delete(`/honorarios/${honorario.id}`);
      showSuccess('Contrato excluido');
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
      showSuccess('Parcela excluida');
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

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-accent/10 transition-colors bg-accent/20"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <DollarSign size={14} className="text-primary shrink-0" />
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-lg border ${TYPE_COLORS[honorario.type] || 'bg-accent/30 text-foreground border-border'}`}>
            {HONORARIO_TYPES.find(t => t.id === honorario.type)?.label || honorario.type}
          </span>
          {honorario.success_percentage && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg border border-border bg-accent/30 text-muted-foreground">
              {parseFloat(honorario.success_percentage)}% exito
            </span>
          )}
          <span className="text-[14px] font-bold text-foreground">
            {formatCurrency(honorario.total_value)}
          </span>
          {honorario.calculated_value && (
            <span className="text-[11px] text-emerald-400 font-semibold">
              (Exito: {formatCurrency(honorario.calculated_value)})
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
            {/* Table header */}
            <div className="grid grid-cols-[32px_1fr_1fr_80px_90px_90px_auto] gap-2 pb-2 border-b border-border/50">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">#</span>
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Valor</span>
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Vencimento</span>
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Status</span>
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Metodo</span>
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Pago em</span>
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider text-right">Acoes</span>
            </div>

            {/* Table rows */}
            {honorario.payments.map((p, idx) => (
              <div
                key={p.id}
                className="grid grid-cols-[32px_1fr_1fr_80px_90px_90px_auto] gap-2 items-center py-2.5 border-b border-border/20 last:border-0 hover:bg-accent/10 transition-colors rounded-lg"
              >
                <span className="text-[11px] font-mono text-muted-foreground">{idx + 1}</span>
                <span className="text-[12px] font-bold text-foreground">{formatCurrency(p.amount)}</span>
                <span className="text-[11px] text-foreground">{formatDate(p.due_date)}</span>
                <span>
                  <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-lg border ${STATUS_COLORS[p.status] || 'bg-accent/30 text-muted-foreground border-border'}`}>
                    {STATUS_LABEL[p.status] || p.status}
                  </span>
                </span>
                <span className="text-[11px] text-muted-foreground">{p.payment_method || '--'}</span>
                <span className="text-[11px] text-muted-foreground">
                  {p.paid_at ? formatDate(p.paid_at) : '--'}
                </span>
                <div className="flex items-center justify-end gap-1">
                  {p.status !== 'PAGO' && (
                    <>
                      {/* Charge dropdown */}
                      <div className="relative" ref={chargeMenuId === p.id ? menuRef : undefined}>
                        <button
                          onClick={() => setChargeMenuId(chargeMenuId === p.id ? null : p.id)}
                          className="p-1.5 rounded-lg hover:bg-accent/40 text-primary transition-colors"
                          title="Gerar cobranca"
                        >
                          {chargingId === p.id ? <Loader2 size={12} className="animate-spin" /> : <CreditCard size={12} />}
                        </button>
                        {chargeMenuId === p.id && (
                          <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-xl shadow-xl shadow-black/20 py-1 min-w-[120px]">
                            <button
                              onClick={() => handleCreateCharge(p.id, 'PIX')}
                              className="w-full text-left px-3 py-2 text-[11px] text-foreground hover:bg-accent/30 transition-colors"
                            >
                              PIX
                            </button>
                            <button
                              onClick={() => handleCreateCharge(p.id, 'BOLETO')}
                              className="w-full text-left px-3 py-2 text-[11px] text-foreground hover:bg-accent/30 transition-colors"
                            >
                              Boleto
                            </button>
                            <button
                              onClick={() => handleCreateCharge(p.id, 'CREDIT_CARD')}
                              className="w-full text-left px-3 py-2 text-[11px] text-foreground hover:bg-accent/30 transition-colors"
                            >
                              Cartao
                            </button>
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => handleMarkPaid(p.id)}
                        disabled={markingId === p.id}
                        className="p-1.5 rounded-lg hover:bg-emerald-500/15 text-emerald-400 transition-colors disabled:opacity-50"
                        title="Marcar como pago"
                      >
                        {markingId === p.id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Check size={12} />
                        )}
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => handleDeletePayment(p.id)}
                    disabled={deletingPaymentId === p.id}
                    className="p-1.5 rounded-lg hover:bg-red-500/15 text-red-400 transition-colors disabled:opacity-50"
                    title="Excluir parcela"
                  >
                    {deletingPaymentId === p.id ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Trash2 size={12} />
                    )}
                  </button>
                </div>
              </div>
            ))}
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
                  Cobranca {chargeResult.type} Gerada
                </h4>
                <button
                  onClick={() => setChargeResult(null)}
                  className="p-1 rounded-lg hover:bg-accent/30 text-muted-foreground transition-colors text-[12px]"
                >
                  &#10005;
                </button>
              </div>

              {chargeResult.pixCopyPaste && (
                <div className="space-y-2">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Codigo PIX Copia e Cola:</p>
                  <div className="flex gap-2">
                    <input
                      readOnly
                      value={chargeResult.pixCopyPaste}
                      className="flex-1 px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[11px] font-mono text-foreground focus:outline-none"
                    />
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
                <a
                  href={chargeResult.boletoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 w-full px-4 py-2 rounded-xl bg-primary text-primary-foreground text-[11px] font-bold hover:opacity-90 transition-opacity shadow-lg shadow-primary/20"
                >
                  <ExternalLink size={12} /> Abrir Boleto
                </a>
              )}

              {chargeResult.invoiceUrl && (
                <a
                  href={chargeResult.invoiceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 w-full px-4 py-2 rounded-xl border border-border text-[11px] font-bold text-muted-foreground hover:bg-accent/30 transition-colors"
                >
                  <ExternalLink size={12} /> Ver Fatura
                </a>
              )}
            </div>
          )}

          {/* Actions footer */}
          <div className="flex items-center justify-between border-t border-border px-5 py-3">
            <button
              onClick={() => setShowAddPayment(!showAddPayment)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-primary hover:bg-primary/10 transition-colors"
            >
              <Plus size={12} />
              Adicionar Parcela
            </button>
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
    if (!val || val <= 0 || !dueDate) {
      showError('Informe valor e data de vencimento');
      return;
    }
    setSaving(true);
    try {
      await api.post(`/honorarios/${honorarioId}/payments`, {
        amount: val,
        due_date: dueDate,
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
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Valor (R$)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="Valor (R$)"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
            autoFocus
          />
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
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Metodo</label>
          <select
            value={method}
            onChange={e => setMethod(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all appearance-none cursor-pointer"
          >
            <option value="">Metodo</option>
            {PAYMENT_METHODS.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-xl border border-border text-[11px] font-bold text-muted-foreground hover:bg-accent/30 transition-colors"
        >
          Cancelar
        </button>
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
