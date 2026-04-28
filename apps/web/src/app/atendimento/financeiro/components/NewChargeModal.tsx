'use client';

/**
 * Modal Asaas-style pra criar cobranca em 4 etapas:
 *  1. Dados da cobranca: parcelamento, vencimento, formas de pagamento
 *  2. Juros e Multa: juros ao mes, multa, desconto ate o vencimento
 *  3. Dados do cliente: leitura — confirma o lead e CPF (sem editar aqui)
 *  4. Resumo: revisao final antes de confirmar
 *
 * Mapeamento pro backend (POST /payment-gateway/charges):
 *  - billingType:
 *      pix+boleto + cartao  → UNDEFINED (cliente escolhe na tela do Asaas)
 *      pix+boleto sem cartao → BOLETO (Asaas trata como pix+boleto)
 *      apenas cartao         → CREDIT_CARD
 *  - installmentCount: ≥2 quando parcelado
 *  - interest, fine, discount, splitFees opcionais
 */

import { useEffect, useState } from 'react';
import { X, Check, ChevronLeft, ChevronRight, Loader2, FileText, Percent, DollarSign, User, ListChecks } from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

/* ──────────────────────────────────────────────────────────────
   Types
────────────────────────────────────────────────────────────── */

export interface ChargeRowMinimal {
  id: string;                         // honorarioPaymentId
  amount: number;
  dueDate: string | null;
  leadId: string | null;
  leadName: string | null;
  leadCpf: string | null;
  caseNumber: string | null;
  legalArea: string | null;
}

export interface ChargeResult {
  type: string;
  pixCopyPaste?: string | null;
  pixQrCode?: string | null;
  boletoUrl?: string | null;
  invoiceUrl?: string | null;
}

interface NewChargeModalProps {
  row: ChargeRowMinimal;
  onClose: () => void;
  onSuccess: (result: ChargeResult) => void;
}

/* ──────────────────────────────────────────────────────────────
   Helpers
────────────────────────────────────────────────────────────── */

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 }).format(v || 0);

const todayPlusDaysIso = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const formatBrDate = (iso: string) => {
  if (!iso) return '—';
  const dt = new Date(iso);
  return `${String(dt.getUTCDate()).padStart(2, '0')}/${String(dt.getUTCMonth() + 1).padStart(2, '0')}/${dt.getUTCFullYear()}`;
};

/* ──────────────────────────────────────────────────────────────
   Stepper visual (top do modal)
────────────────────────────────────────────────────────────── */

const STEPS = [
  { n: 1, label: 'Dados da cobrança' },
  { n: 2, label: 'Juros e Multa' },
  { n: 3, label: 'Dados do cliente' },
  { n: 4, label: 'Resumo' },
] as const;

function Stepper({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-between px-2">
      {STEPS.map((s, idx) => {
        const completed = current > s.n;
        const active = current === s.n;
        return (
          <div key={s.n} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold ${
                  completed
                    ? 'bg-primary text-primary-foreground'
                    : active
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {completed ? <Check size={14} /> : s.n}
              </div>
              <span
                className={`text-[10px] mt-1 ${active ? 'text-foreground font-bold' : 'text-muted-foreground'}`}
              >
                {s.label}
              </span>
            </div>
            {idx < STEPS.length - 1 && (
              <div
                className={`flex-1 h-0.5 mx-2 mt-[-14px] ${completed ? 'bg-primary' : 'bg-muted'}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Modal principal
────────────────────────────────────────────────────────────── */

export default function NewChargeModal({ row, onClose, onSuccess }: NewChargeModalProps) {
  // ─── Estado dos 4 steps ──────────────────────────────────
  const [step, setStep] = useState(1);

  // Step 1: Dados da cobrança
  const [installments, setInstallments] = useState(1);
  const [dueDate, setDueDate] = useState(
    row.dueDate ? row.dueDate.slice(0, 10) : todayPlusDaysIso(3),
  );
  const [acceptBoletoPix, setAcceptBoletoPix] = useState(true);
  const [acceptCard, setAcceptCard] = useState(true);
  const [splitFees, setSplitFees] = useState(false);

  // Step 2: Juros e Multa + Desconto
  const [interestPct, setInterestPct] = useState('1.00');     // % ao mes
  const [finePct, setFinePct] = useState('2.00');             // % multa
  const [discountPct, setDiscountPct] = useState('0.00');     // % desconto
  const [discountUntil, setDiscountUntil] = useState<'until_due' | 'days_before'>('until_due');
  const [discountDaysBefore, setDiscountDaysBefore] = useState(0);

  // Step 4: Submit
  const [submitting, setSubmitting] = useState(false);

  /* ─── Validacoes por step ────────────────────────────── */

  const step1Errors: string[] = [];
  if (!dueDate) step1Errors.push('Data de vencimento é obrigatória');
  if (!acceptBoletoPix && !acceptCard) step1Errors.push('Selecione pelo menos uma forma de pagamento');
  if (installments < 1 || installments > 24) step1Errors.push('Parcelamento entre 1 e 24');
  if (acceptBoletoPix && !acceptCard && installments > 1) {
    step1Errors.push('Parcelamento só está disponível para Cartão de Crédito');
  }

  const step2Errors: string[] = [];
  const interestNum = parseFloat(interestPct) || 0;
  const fineNum = parseFloat(finePct) || 0;
  const discountNum = parseFloat(discountPct) || 0;
  if (interestNum < 0 || interestNum > 10) step2Errors.push('Juros entre 0% e 10% ao mês');
  if (fineNum < 0 || fineNum > 20) step2Errors.push('Multa entre 0% e 20%');
  if (discountNum < 0 || discountNum > 50) step2Errors.push('Desconto entre 0% e 50%');

  // Cliente sem CPF/CNPJ: bloqueia avanco no step 3
  const step3Errors: string[] = [];
  if (!row.leadCpf) step3Errors.push('Cliente sem CPF/CNPJ — cadastre antes de gerar cobrança');

  /* ─── Submit final ───────────────────────────────────── */

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      // Mapeamento billingType conforme regras Asaas:
      let billingType: 'BOLETO' | 'CREDIT_CARD' | 'UNDEFINED';
      if (acceptBoletoPix && acceptCard) billingType = 'UNDEFINED';
      else if (acceptCard && !acceptBoletoPix) billingType = 'CREDIT_CARD';
      else billingType = 'BOLETO'; // pix+boleto via gateway

      const payload: any = {
        honorarioPaymentId: row.id,
        billingType,
        dueDate,
      };

      // Parcelamento (so envia se >=2)
      if (installments >= 2) payload.installmentCount = installments;

      // Juros/multa/desconto
      if (interestNum > 0) payload.interest = { value: interestNum };
      if (fineNum > 0) payload.fine = { value: fineNum, type: 'PERCENTAGE' };
      if (discountNum > 0) {
        const days = discountUntil === 'until_due' ? 0 : discountDaysBefore;
        payload.discount = { value: discountNum, dueDateLimitDays: days, type: 'PERCENTAGE' };
      }

      if (splitFees && acceptCard) payload.splitFees = true;

      const res = await api.post('/payment-gateway/charges', payload);
      const charge = res.data;
      showSuccess('Cobrança gerada — cliente recebe no WhatsApp em segundos.');
      onSuccess({
        type: billingType,
        pixCopyPaste: charge.pix_copy_paste || charge.pix?.copyPaste,
        pixQrCode: charge.pix_qr_code || charge.pix?.qrCode,
        boletoUrl: charge.boleto_url || charge.boleto?.url,
        invoiceUrl: charge.invoice_url,
      });
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao gerar cobrança');
    } finally {
      setSubmitting(false);
    }
  };

  /* ─── Navegacao ──────────────────────────────────────── */

  const canAdvance = () => {
    if (step === 1) return step1Errors.length === 0;
    if (step === 2) return step2Errors.length === 0;
    if (step === 3) return step3Errors.length === 0;
    return true;
  };

  const handleNext = () => {
    if (!canAdvance()) return;
    if (step < 4) setStep((s) => (s + 1) as any);
    else handleSubmit();
  };

  const handleBack = () => {
    if (step > 1) setStep((s) => (s - 1) as any);
  };

  // ESC fecha
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  /* ─── Render ─────────────────────────────────────────── */

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 z-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-foreground">Criar cobrança</h2>
            <button
              onClick={onClose}
              disabled={submitting}
              className="p-1 rounded hover:bg-accent/30 text-muted-foreground hover:text-foreground"
              title="Fechar (Esc)"
            >
              <X size={18} />
            </button>
          </div>
          <Stepper current={step} />
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {step === 1 && (
            <Step1
              row={row}
              installments={installments}
              setInstallments={setInstallments}
              dueDate={dueDate}
              setDueDate={setDueDate}
              acceptBoletoPix={acceptBoletoPix}
              setAcceptBoletoPix={setAcceptBoletoPix}
              acceptCard={acceptCard}
              setAcceptCard={setAcceptCard}
              splitFees={splitFees}
              setSplitFees={setSplitFees}
              errors={step1Errors}
            />
          )}

          {step === 2 && (
            <Step2
              interestPct={interestPct}
              setInterestPct={setInterestPct}
              finePct={finePct}
              setFinePct={setFinePct}
              discountPct={discountPct}
              setDiscountPct={setDiscountPct}
              discountUntil={discountUntil}
              setDiscountUntil={setDiscountUntil}
              discountDaysBefore={discountDaysBefore}
              setDiscountDaysBefore={setDiscountDaysBefore}
              errors={step2Errors}
            />
          )}

          {step === 3 && <Step3 row={row} errors={step3Errors} />}

          {step === 4 && (
            <Step4
              row={row}
              installments={installments}
              dueDate={dueDate}
              acceptBoletoPix={acceptBoletoPix}
              acceptCard={acceptCard}
              splitFees={splitFees}
              interestNum={interestNum}
              fineNum={fineNum}
              discountNum={discountNum}
              discountUntil={discountUntil}
              discountDaysBefore={discountDaysBefore}
            />
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-card border-t border-border px-6 py-3 flex items-center justify-between">
          <button
            onClick={step === 1 ? onClose : handleBack}
            disabled={submitting}
            className="flex items-center gap-1 px-4 py-2 rounded-lg border border-border text-foreground hover:bg-accent/30 text-xs font-semibold disabled:opacity-50"
          >
            {step === 1 ? (
              <>
                <X size={12} /> Fechar
              </>
            ) : (
              <>
                <ChevronLeft size={12} /> Voltar
              </>
            )}
          </button>

          <button
            onClick={handleNext}
            disabled={submitting || !canAdvance()}
            className="flex items-center gap-1 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 size={12} className="animate-spin" /> Enviando...
              </>
            ) : step === 4 ? (
              <>
                Confirmar e gerar <Check size={12} />
              </>
            ) : (
              <>
                Avançar <ChevronRight size={12} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Step 1: Dados da cobrança
────────────────────────────────────────────────────────────── */

function Step1({
  row,
  installments,
  setInstallments,
  dueDate,
  setDueDate,
  acceptBoletoPix,
  setAcceptBoletoPix,
  acceptCard,
  setAcceptCard,
  splitFees,
  setSplitFees,
  errors,
}: any) {
  const value = row.amount;
  const installmentValue = installments >= 2 ? value / installments : value;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <FileText size={12} />
        <span>O valor será cobrado uma vez ou conforme parcelamento escolhido.</span>
      </div>

      {/* Cliente + valor (resumo no topo) */}
      <div className="bg-muted/30 rounded-lg p-3 grid grid-cols-2 gap-3">
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Cliente</div>
          <div className="text-sm font-semibold text-foreground truncate">{row.leadName || '—'}</div>
          <div className="text-[10px] text-muted-foreground tabular-nums">{row.leadCpf || 'Sem CPF'}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Valor</div>
          <div className="text-base font-bold text-foreground tabular-nums">{fmt(value)}</div>
          {installments >= 2 && (
            <div className="text-[10px] text-muted-foreground tabular-nums">
              {installments}x de {fmt(installmentValue)}
            </div>
          )}
        </div>
      </div>

      {/* Parcelamento + vencimento */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] font-semibold text-muted-foreground block mb-1">Parcelamento</label>
          <select
            value={installments}
            onChange={(e) => setInstallments(parseInt(e.target.value))}
            className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg focus:outline-none focus:border-primary"
          >
            <option value={1}>À vista</option>
            {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => (
              <option key={n} value={n}>
                {n}x — {fmt(value / n)}
              </option>
            ))}
          </select>
          <div className="text-[10px] text-muted-foreground mt-1">
            Parcelamento só vale para Cartão de Crédito.
          </div>
        </div>
        <div>
          <label className="text-[11px] font-semibold text-muted-foreground block mb-1">Vencimento</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg focus:outline-none focus:border-primary"
          />
        </div>
      </div>

      {/* Formas de pagamento */}
      <div>
        <label className="text-[11px] font-semibold text-muted-foreground block mb-2">
          Qual será a forma de pagamento?
        </label>
        <div className="space-y-2">
          <label
            className={`block p-3 border rounded-lg cursor-pointer transition-colors ${
              acceptBoletoPix ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/20'
            }`}
          >
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={acceptBoletoPix}
                onChange={(e) => setAcceptBoletoPix(e.target.checked)}
                className="mt-0.5"
              />
              <div className="flex-1">
                <div className="text-sm font-semibold text-foreground">Boleto Bancário / Pix</div>
                <div className="text-[11px] text-muted-foreground">
                  Cliente pode pagar via PIX (segundos) ou boleto (1 dia útil).
                </div>
              </div>
            </div>
          </label>

          <label
            className={`block p-3 border rounded-lg cursor-pointer transition-colors ${
              acceptCard ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/20'
            }`}
          >
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={acceptCard}
                onChange={(e) => setAcceptCard(e.target.checked)}
                className="mt-0.5"
              />
              <div className="flex-1">
                <div className="text-sm font-semibold text-foreground">Cartão de Crédito</div>
                <div className="text-[11px] text-muted-foreground">
                  Taxa Asaas: 2,99% + R$ 0,49 por parcela. Recebimento em ~32 dias.
                </div>
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* Repasse de taxa do cartao ao cliente */}
      {acceptCard && (
        <label className="flex items-start gap-2 cursor-pointer p-3 bg-muted/20 rounded-lg">
          <input
            type="checkbox"
            checked={splitFees}
            onChange={(e) => setSplitFees(e.target.checked)}
            className="mt-0.5"
          />
          <div className="flex-1">
            <div className="text-xs font-semibold text-foreground">Repassar taxa de cartão ao cliente</div>
            <div className="text-[11px] text-muted-foreground">
              A taxa do cartão (2,99% + R$ 0,49) será somada ao valor cobrado, em vez de descontada do recebimento.
            </div>
          </div>
        </label>
      )}

      {errors.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2 space-y-1">
          {errors.map((e: string, i: number) => (
            <div key={i} className="text-[11px] text-red-400">
              • {e}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Step 2: Juros, Multa, Desconto
────────────────────────────────────────────────────────────── */

function Step2({
  interestPct,
  setInterestPct,
  finePct,
  setFinePct,
  discountPct,
  setDiscountPct,
  discountUntil,
  setDiscountUntil,
  discountDaysBefore,
  setDiscountDaysBefore,
  errors,
}: any) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Percent size={12} />
        <span>Configure encargos e descontos. Todos opcionais — deixe 0 pra ignorar.</span>
      </div>

      {/* Juros */}
      <div>
        <h3 className="text-sm font-bold text-foreground mb-1">Juros</h3>
        <p className="text-[11px] text-muted-foreground mb-2">
          Aplicado quando o pagamento atrasa. Cobrado pro rata diariamente sobre o valor da parcela.
        </p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">% ao mês:</span>
          <input
            type="number"
            step="0.01"
            min="0"
            max="10"
            value={interestPct}
            onChange={(e) => setInterestPct(e.target.value)}
            className="w-24 px-3 py-1.5 text-xs bg-background border border-border rounded-lg tabular-nums focus:outline-none focus:border-primary"
          />
          <span className="text-[10px] text-muted-foreground">(0 a 10%)</span>
        </div>
      </div>

      {/* Multa */}
      <div>
        <h3 className="text-sm font-bold text-foreground mb-1">Multa</h3>
        <p className="text-[11px] text-muted-foreground mb-2">
          Aplicada uma única vez se houver atraso, somada ao valor da parcela.
        </p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">%:</span>
          <input
            type="number"
            step="0.01"
            min="0"
            max="20"
            value={finePct}
            onChange={(e) => setFinePct(e.target.value)}
            className="w-24 px-3 py-1.5 text-xs bg-background border border-border rounded-lg tabular-nums focus:outline-none focus:border-primary"
          />
          <span className="text-[10px] text-muted-foreground">(máx. 20%)</span>
        </div>
      </div>

      {/* Desconto */}
      <div>
        <h3 className="text-sm font-bold text-foreground mb-1">Desconto por pagamento antecipado</h3>
        <p className="text-[11px] text-muted-foreground mb-2">
          Incentiva o cliente a pagar antes do vencimento.
        </p>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-muted-foreground">%:</span>
          <input
            type="number"
            step="0.01"
            min="0"
            max="50"
            value={discountPct}
            onChange={(e) => setDiscountPct(e.target.value)}
            className="w-24 px-3 py-1.5 text-xs bg-background border border-border rounded-lg tabular-nums focus:outline-none focus:border-primary"
          />
          <span className="text-[10px] text-muted-foreground">(máx. 50%)</span>
        </div>

        {parseFloat(discountPct) > 0 && (
          <div className="space-y-1.5">
            <span className="text-[11px] text-muted-foreground block">Prazo máximo do desconto:</span>
            <div className="flex items-center gap-2">
              <select
                value={discountUntil}
                onChange={(e) => setDiscountUntil(e.target.value as any)}
                className="px-3 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:border-primary"
              >
                <option value="until_due">Até o dia do vencimento</option>
                <option value="days_before">N dias antes do vencimento</option>
              </select>
              {discountUntil === 'days_before' && (
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={discountDaysBefore}
                  onChange={(e) => setDiscountDaysBefore(parseInt(e.target.value) || 0)}
                  className="w-20 px-3 py-1.5 text-xs bg-background border border-border rounded-lg tabular-nums focus:outline-none focus:border-primary"
                  placeholder="dias"
                />
              )}
            </div>
          </div>
        )}
      </div>

      {errors.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2 space-y-1">
          {errors.map((e: string, i: number) => (
            <div key={i} className="text-[11px] text-red-400">
              • {e}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Step 3: Dados do cliente (read-only)
────────────────────────────────────────────────────────────── */

function Step3({ row, errors }: any) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <User size={12} />
        <span>Confira os dados do cliente. CPF/CNPJ é obrigatório no Asaas.</span>
      </div>

      <div className="bg-muted/30 rounded-lg p-4 space-y-2">
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Nome</div>
          <div className="text-sm font-semibold text-foreground">{row.leadName || '—'}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">CPF / CNPJ</div>
          <div className="text-sm font-semibold text-foreground tabular-nums">
            {row.leadCpf || (
              <span className="text-amber-400">Não cadastrado — feche este modal e use o link "Cadastrar CPF" da linha.</span>
            )}
          </div>
        </div>
        {row.caseNumber && (
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Processo vinculado</div>
            <div className="text-xs font-medium text-foreground">{row.caseNumber}</div>
            {row.legalArea && <div className="text-[10px] text-muted-foreground">{row.legalArea}</div>}
          </div>
        )}
      </div>

      {errors.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2 space-y-1">
          {errors.map((e: string, i: number) => (
            <div key={i} className="text-[11px] text-red-400">
              • {e}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Step 4: Resumo
────────────────────────────────────────────────────────────── */

function Step4({
  row,
  installments,
  dueDate,
  acceptBoletoPix,
  acceptCard,
  splitFees,
  interestNum,
  fineNum,
  discountNum,
  discountUntil,
  discountDaysBefore,
}: any) {
  const value = row.amount;
  const installmentValue = installments >= 2 ? value / installments : value;
  const formas: string[] = [];
  if (acceptBoletoPix) formas.push('Boleto/PIX');
  if (acceptCard) formas.push('Cartão de Crédito');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <ListChecks size={12} />
        <span>Confira os dados antes de confirmar. Após gerar, o cliente recebe o link no WhatsApp imediatamente.</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <SummaryRow label="Cliente" value={row.leadName || '—'} />
        <SummaryRow label="CPF / CNPJ" value={row.leadCpf || '—'} />
        <SummaryRow label="Valor total" value={fmt(value)} highlight />
        <SummaryRow label="Vencimento" value={formatBrDate(dueDate)} />
        <SummaryRow
          label="Parcelamento"
          value={installments === 1 ? 'À vista' : `${installments}x de ${fmt(installmentValue)}`}
        />
        <SummaryRow label="Formas de pagamento" value={formas.join(' + ') || '—'} />
        {splitFees && acceptCard && (
          <SummaryRow label="Repasse de taxas" value="Cliente paga taxa do cartão" />
        )}
      </div>

      {(interestNum > 0 || fineNum > 0 || discountNum > 0) && (
        <div className="border-t border-border pt-3">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">Encargos e descontos</div>
          <div className="grid grid-cols-2 gap-3">
            {interestNum > 0 && <SummaryRow label="Juros" value={`${interestNum.toFixed(2)}% ao mês`} />}
            {fineNum > 0 && <SummaryRow label="Multa por atraso" value={`${fineNum.toFixed(2)}%`} />}
            {discountNum > 0 && (
              <SummaryRow
                label="Desconto antecipado"
                value={`${discountNum.toFixed(2)}% ${discountUntil === 'until_due' ? 'até o vencimento' : `até ${discountDaysBefore}d antes`}`}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryRow({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={`text-xs font-semibold ${highlight ? 'text-emerald-400 text-base' : 'text-foreground'}`}>
        {value}
      </div>
    </div>
  );
}
