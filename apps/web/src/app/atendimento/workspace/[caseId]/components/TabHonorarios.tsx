'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  DollarSign, Loader2, Plus, ChevronDown, ChevronUp,
  Trash2, Check, Calendar,
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
];

const PAYMENT_METHODS = [
  { id: 'PIX', label: 'PIX' },
  { id: 'BOLETO', label: 'Boleto' },
  { id: 'CARTAO', label: 'Cartão' },
  { id: 'DINHEIRO', label: 'Dinheiro' },
  { id: 'TRANSFERENCIA', label: 'Transferência' },
];

const STATUS_BADGE: Record<string, string> = {
  PAGO: 'badge-success',
  PENDENTE: 'badge-warning',
  ATRASADO: 'badge-error',
};

const STATUS_LABEL: Record<string, string> = {
  PAGO: 'Pago',
  PENDENTE: 'Pendente',
  ATRASADO: 'Atrasado',
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
            <span className="text-xs text-base-content/50">({honorarios.length})</span>
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
          <div className="bg-base-200/50 rounded-lg p-3 text-center">
            <p className="text-[10px] text-base-content/50 uppercase tracking-wider">Contratado</p>
            <p className="text-sm font-bold text-base-content mt-0.5">{formatCurrency(summary.contracted)}</p>
          </div>
          <div className="bg-success/10 rounded-lg p-3 text-center">
            <p className="text-[10px] text-success uppercase tracking-wider">Recebido</p>
            <p className="text-sm font-bold text-success mt-0.5">{formatCurrency(summary.received)}</p>
          </div>
          <div className="bg-warning/10 rounded-lg p-3 text-center">
            <p className="text-[10px] text-warning uppercase tracking-wider">Pendente</p>
            <p className="text-sm font-bold text-warning mt-0.5">{formatCurrency(summary.pending)}</p>
          </div>
          <div className="bg-error/10 rounded-lg p-3 text-center">
            <p className="text-[10px] text-error uppercase tracking-wider">Atrasado</p>
            <p className="text-sm font-bold text-error mt-0.5">{formatCurrency(summary.overdue)}</p>
          </div>
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

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : honorarios.length === 0 ? (
        <div className="text-center py-12 text-base-content/50">
          <DollarSign className="h-12 w-12 mx-auto mb-2 opacity-30" />
          <p>Nenhum contrato de honorários</p>
          <p className="text-xs mt-1">Clique em &quot;Novo Contrato&quot; para registrar</p>
        </div>
      ) : (
        <div className="space-y-3">
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
    <div className="rounded-lg border border-primary/30 bg-base-200/50 p-4 space-y-3">
      <h3 className="text-sm font-semibold">Novo Contrato de Honorários</h3>
      <div className={`grid grid-cols-1 ${isExito ? 'md:grid-cols-4' : 'md:grid-cols-3'} gap-3`}>
        <div>
          <label className="label text-xs">Tipo</label>
          <select
            value={type}
            onChange={e => setType(e.target.value)}
            className="select select-bordered select-sm w-full"
          >
            {HONORARIO_TYPES.map(t => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>
        {isExito && (
          <div>
            <label className="label text-xs">Percentual de Êxito (%)</label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="100"
              placeholder="30"
              value={successPercentage}
              onChange={e => setSuccessPercentage(e.target.value)}
              className="input input-bordered input-sm w-full"
            />
          </div>
        )}
        <div>
          <label className="label text-xs">{isExito ? 'Valor Fixo/Entrada (R$)' : 'Valor Total (R$)'}</label>
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="5000.00"
            value={totalValue}
            onChange={e => setTotalValue(e.target.value)}
            className="input input-bordered input-sm w-full"
            autoFocus
          />
        </div>
        <div>
          <label className="label text-xs">N. de Parcelas</label>
          <input
            type="number"
            min="1"
            max="120"
            value={installmentCount}
            onChange={e => setInstallmentCount(e.target.value)}
            className="input input-bordered input-sm w-full"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="label text-xs">Data do Contrato</label>
          <input
            type="date"
            value={contractDate}
            onChange={e => setContractDate(e.target.value)}
            className="input input-bordered input-sm w-full"
          />
        </div>
        <div>
          <label className="label text-xs">Observações</label>
          <input
            type="text"
            placeholder="Observações (opcional)"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            className="input input-bordered input-sm w-full"
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} disabled={saving} className="btn btn-ghost btn-sm">
          Cancelar
        </button>
        <button
          onClick={handleCreate}
          disabled={saving}
          className="btn btn-primary btn-sm gap-1"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Criar Contrato
        </button>
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

  const typeBadgeColor =
    honorario.type === 'FIXO' ? 'badge-primary' :
    honorario.type === 'EXITO' ? 'badge-secondary' :
    'badge-accent';

  return (
    <div className="rounded-lg border border-base-300 overflow-hidden">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 hover:bg-base-200/50 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <DollarSign className="h-4 w-4 text-primary shrink-0" />
          <span className={`badge badge-xs ${typeBadgeColor}`}>
            {HONORARIO_TYPES.find(t => t.id === honorario.type)?.label || honorario.type}
          </span>
          {honorario.success_percentage && (
            <span className="badge badge-xs badge-outline text-[10px]">
              {parseFloat(honorario.success_percentage)}% êxito
            </span>
          )}
          <span className="font-semibold text-sm">
            {formatCurrency(honorario.total_value)}
          </span>
          {honorario.calculated_value && (
            <span className="text-xs text-emerald-500 font-medium">
              (Êxito: {formatCurrency(honorario.calculated_value)})
            </span>
          )}
          <span className="text-xs text-base-content/50">
            ({paidCount}/{totalPayments} parcelas)
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {honorario.contract_date && (
            <span className="text-xs text-base-content/40 flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatDate(honorario.contract_date)}
            </span>
          )}
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-base-300">
          {/* Progress bar */}
          <div className="px-3 pt-3">
            <div className="flex items-center justify-between text-xs text-base-content/50 mb-1">
              <span>Progresso: {formatCurrency(totalPaid)} / {formatCurrency(honorario.total_value)}</span>
              <span>{Math.round((totalPaid / parseFloat(honorario.total_value)) * 100)}%</span>
            </div>
            <div className="w-full bg-base-300 rounded-full h-1.5">
              <div
                className="bg-success h-1.5 rounded-full transition-all"
                style={{ width: `${Math.min(100, (totalPaid / parseFloat(honorario.total_value)) * 100)}%` }}
              />
            </div>
          </div>

          {honorario.notes && (
            <p className="px-3 pt-2 text-xs text-base-content/50">{honorario.notes}</p>
          )}

          {/* Payments table */}
          <div className="p-3">
            <div className="overflow-x-auto">
              <table className="table table-xs w-full">
                <thead>
                  <tr className="text-xs text-base-content/50">
                    <th>#</th>
                    <th>Valor</th>
                    <th>Vencimento</th>
                    <th>Status</th>
                    <th>Método</th>
                    <th>Pago em</th>
                    <th className="text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {honorario.payments.map((p, idx) => (
                    <tr key={p.id} className="hover">
                      <td className="text-xs font-mono">{idx + 1}</td>
                      <td className="text-xs font-medium">{formatCurrency(p.amount)}</td>
                      <td className="text-xs">{formatDate(p.due_date)}</td>
                      <td>
                        <span className={`badge badge-xs ${STATUS_BADGE[p.status] || ''}`}>
                          {STATUS_LABEL[p.status] || p.status}
                        </span>
                      </td>
                      <td className="text-xs text-base-content/50">{p.payment_method || '—'}</td>
                      <td className="text-xs text-base-content/50">
                        {p.paid_at ? formatDate(p.paid_at) : '—'}
                      </td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {p.status !== 'PAGO' && (
                            <button
                              onClick={() => handleMarkPaid(p.id)}
                              disabled={markingId === p.id}
                              className="btn btn-ghost btn-xs text-success"
                              title="Marcar como pago"
                            >
                              {markingId === p.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Check className="h-3 w-3" />
                              )}
                            </button>
                          )}
                          <button
                            onClick={() => handleDeletePayment(p.id)}
                            disabled={deletingPaymentId === p.id}
                            className="btn btn-ghost btn-xs text-error"
                            title="Excluir parcela"
                          >
                            {deletingPaymentId === p.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Trash2 className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Add payment form */}
          {showAddPayment && (
            <AddPaymentForm
              honorarioId={honorario.id}
              onAdded={() => { setShowAddPayment(false); onRefresh(); }}
              onCancel={() => setShowAddPayment(false)}
            />
          )}

          {/* Actions */}
          <div className="flex items-center justify-between border-t border-base-300 px-3 py-2">
            <button
              onClick={() => setShowAddPayment(!showAddPayment)}
              className="btn btn-ghost btn-xs gap-1"
            >
              <Plus className="h-3 w-3" />
              Adicionar Parcela
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="btn btn-ghost btn-xs text-error gap-1"
            >
              {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
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
    <div className="border-t border-base-300 bg-base-200/30 px-3 py-3 space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <input
          type="number"
          step="0.01"
          min="0"
          placeholder="Valor (R$)"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          className="input input-bordered input-xs"
          autoFocus
        />
        <input
          type="date"
          value={dueDate}
          onChange={e => setDueDate(e.target.value)}
          className="input input-bordered input-xs"
        />
        <select
          value={method}
          onChange={e => setMethod(e.target.value)}
          className="select select-bordered select-xs"
        >
          <option value="">Método</option>
          {PAYMENT_METHODS.map(m => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn btn-ghost btn-xs">Cancelar</button>
        <button onClick={handleAdd} disabled={saving} className="btn btn-primary btn-xs gap-1">
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          Adicionar
        </button>
      </div>
    </div>
  );
}
