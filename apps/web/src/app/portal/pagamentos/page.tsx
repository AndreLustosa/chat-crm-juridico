'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, AlertCircle, CreditCard, Copy, ExternalLink, CheckCircle2, Clock, AlertTriangle, FileText, Bell, BellOff } from 'lucide-react';
import { PortalHeader } from '../components/PortalHeader';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005';

type Payment = {
  id: string;
  source: 'lead' | 'case';
  amount: string;
  due_date: string | null;
  paid_at: string | null;
  payment_method: string | null;
  status: 'PENDENTE' | 'PAGO' | 'ATRASADO' | 'CANCELADO' | string;
  context: string;
  case?: { id: string; case_number: string | null; title: string };
  gateway: {
    billing_type: string | null;
    pix_qr_code: string | null;
    pix_copy_paste: string | null;
    pix_expiration_date: string | null;
    boleto_url: string | null;
    boleto_barcode: string | null;
    invoice_url: string | null;
  } | null;
};

type PaymentsResponse = {
  items: Payment[];
  summary: {
    total_pending: string;
    count_pending: number;
    count_overdue: number;
    count_paid: number;
  };
};

function formatBrDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
  });
}

function formatBRL(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = {
  PENDENTE: { label: 'Pendente', color: 'amber', icon: Clock },
  ATRASADO: { label: 'Atrasado', color: 'red', icon: AlertTriangle },
  PAGO: { label: 'Pago', color: 'emerald', icon: CheckCircle2 },
  CANCELADO: { label: 'Cancelado', color: 'gray', icon: AlertCircle },
};

export default function PagamentosPage() {
  const router = useRouter();
  const [data, setData] = useState<PaymentsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Toggle de opt-out de avisos via WhatsApp. null = ainda carregando,
  // bool = preferencia atual. Disabled=true significa que cliente NAO
  // recebe lembretes/cobrancas via WhatsApp.
  const [remindersDisabled, setRemindersDisabled] = useState<boolean | null>(null);
  const [savingPrefs, setSavingPrefs] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/portal/payments`, { credentials: 'include' })
      .then(async r => {
        if (r.status === 401) { router.push('/portal'); return null; }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(d => { if (d) setData(d); })
      .catch(e => setError(e.message || 'Falha ao carregar'));
  }, [router]);

  // Carrega preferencias separadamente (endpoint separado pra UI poder
  // mostrar a lista mesmo se prefs falharem)
  useEffect(() => {
    fetch(`${API_BASE}/portal/payments/preferences`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setRemindersDisabled(!!d.remindersDisabled); })
      .catch(() => setRemindersDisabled(false));
  }, []);

  async function toggleReminders() {
    if (remindersDisabled === null || savingPrefs) return;
    const next = !remindersDisabled;
    setSavingPrefs(true);
    // Otimismo: ja muda na UI. Reverte se PATCH falhar.
    setRemindersDisabled(next);
    try {
      const res = await fetch(`${API_BASE}/portal/payments/preferences`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remindersDisabled: next }),
      });
      if (!res.ok) throw new Error('falha');
    } catch {
      setRemindersDisabled(!next); // revert
    } finally {
      setSavingPrefs(false);
    }
  }

  return (
    <>
      <PortalHeader showBack />
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-8">
        <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold mb-1">Seus pagamentos</h1>
            <p className="text-white/50 text-sm">Honorários, entradas e parcelas relacionados aos seus casos.</p>
          </div>
          {/* Toggle WhatsApp — opt-out de lembretes/cobranca pelo cliente.
              Esconde enquanto carrega (null) pra evitar piscar no estado
              errado. Visivel mesmo sem pagamento, pra cliente poder
              configurar antes de receber a 1a cobranca. */}
          {remindersDisabled !== null && (
            <button
              onClick={toggleReminders}
              disabled={savingPrefs}
              className={`flex items-start gap-3 px-4 py-3 rounded-xl border transition-colors disabled:opacity-50 ${
                remindersDisabled
                  ? 'border-white/15 bg-white/5 hover:bg-white/10'
                  : 'border-[#A89048]/40 bg-[#A89048]/5 hover:bg-[#A89048]/10'
              }`}
              title={remindersDisabled
                ? 'Você não recebe lembretes de pagamento via WhatsApp'
                : 'Você recebe lembretes de pagamento via WhatsApp'}
            >
              <div className="shrink-0 mt-0.5">
                {remindersDisabled
                  ? <BellOff size={16} className="text-white/40" />
                  : <Bell size={16} className="text-[#A89048]" />}
              </div>
              <div className="text-left">
                <p className={`text-xs font-bold uppercase tracking-wider ${
                  remindersDisabled ? 'text-white/40' : 'text-[#A89048]'
                }`}>
                  Avisos no WhatsApp
                </p>
                <p className="text-[10px] text-white/50 mt-0.5">
                  {remindersDisabled ? 'Desligado · clique pra ativar' : 'Ativado · clique pra desligar'}
                </p>
              </div>
            </button>
          )}
        </div>

        {data === null && !error && (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="animate-spin text-[#A89048]" size={28} />
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 flex items-start gap-3">
            <AlertCircle className="text-red-400 mt-0.5" size={18} />
            <div>
              <p className="text-red-400 font-bold text-sm">Não foi possível carregar</p>
              <p className="text-red-400/70 text-xs mt-1">{error}</p>
            </div>
          </div>
        )}

        {data && data.items.length === 0 && (
          <div className="rounded-xl border border-white/10 bg-[#0d0d14] p-12 text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#A89048]/15 border border-[#A89048]/30 mb-4">
              <CreditCard className="text-[#A89048]" size={24} />
            </div>
            <h2 className="text-lg font-bold mb-2">Nenhum pagamento ainda</h2>
            <p className="text-white/50 text-sm">
              Quando o escritório gerar uma cobrança, ela aparece aqui com instruções de pagamento.
            </p>
          </div>
        )}

        {data && data.items.length > 0 && (
          <>
            {/* Sumário */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <SummaryCard label="Total pendente" value={formatBRL(data.summary.total_pending)} color="amber" highlight />
              <SummaryCard label="Pendentes" value={String(data.summary.count_pending)} color="amber" />
              <SummaryCard label="Atrasados" value={String(data.summary.count_overdue)} color="red" />
              <SummaryCard label="Pagos" value={String(data.summary.count_paid)} color="emerald" />
            </div>

            {/* Lista */}
            <div className="space-y-3">
              {data.items.map(p => <PaymentCard key={p.id} p={p} />)}
            </div>
          </>
        )}
      </main>
    </>
  );
}

function SummaryCard({ label, value, color, highlight }: { label: string; value: string; color: string; highlight?: boolean }) {
  const colorClasses: Record<string, string> = {
    amber: 'border-amber-500/30 bg-amber-500/5 text-amber-300',
    red: 'border-red-500/30 bg-red-500/5 text-red-300',
    emerald: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300',
  };
  return (
    <div className={`rounded-xl border p-3 ${colorClasses[color]} ${highlight ? 'col-span-2 md:col-span-1' : ''}`}>
      <p className="text-[10px] uppercase tracking-wider opacity-70 mb-0.5">{label}</p>
      <p className={`font-bold ${highlight ? 'text-xl' : 'text-base'} text-white`}>{value}</p>
    </div>
  );
}

function PaymentCard({ p }: { p: Payment }) {
  const cfg = STATUS_CONFIG[p.status] || STATUS_CONFIG.PENDENTE;
  const Icon = cfg.icon;
  const colorClasses: Record<string, string> = {
    amber: 'border-amber-500/30 bg-amber-500/5',
    red: 'border-red-500/30 bg-red-500/5',
    emerald: 'border-emerald-500/30 bg-emerald-500/5',
    gray: 'border-white/10 bg-white/5',
  };
  const iconClasses: Record<string, string> = {
    amber: 'text-amber-400',
    red: 'text-red-400',
    emerald: 'text-emerald-400',
    gray: 'text-white/40',
  };

  const isOpen = p.status === 'PENDENTE' || p.status === 'ATRASADO';
  const hasPix = isOpen && p.gateway?.pix_copy_paste;
  const hasBoleto = isOpen && p.gateway?.boleto_url;

  const [copied, setCopied] = useState(false);
  function copyPix() {
    if (!p.gateway?.pix_copy_paste) return;
    navigator.clipboard.writeText(p.gateway.pix_copy_paste);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={`rounded-xl border p-4 ${colorClasses[cfg.color]}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-${cfg.color}-500/15 border border-${cfg.color}-500/30`}>
            <Icon className={iconClasses[cfg.color]} size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className={`text-[10px] font-bold uppercase tracking-wider ${iconClasses[cfg.color]}`}>
                {cfg.label}
              </span>
              {p.case && (
                <span className="text-[10px] text-white/50 truncate">
                  · {p.case.title}
                </span>
              )}
            </div>
            <h3 className="font-bold text-base text-white">{p.context}</h3>
            <p className="text-[11px] text-white/50 mt-0.5">
              {p.status === 'PAGO'
                ? `Pago em ${formatBrDate(p.paid_at)}`
                : `Vencimento: ${formatBrDate(p.due_date)}`}
            </p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className={`text-xl font-bold ${p.status === 'PAGO' ? 'text-emerald-400' : 'text-white'}`}>
            {formatBRL(p.amount)}
          </p>
        </div>
      </div>

      {/* PIX */}
      {hasPix && (
        <div className="mt-3 pt-3 border-t border-white/10 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-emerald-300 flex items-center gap-1">
              💳 Pague com PIX
            </span>
            <button
              onClick={copyPix}
              className="text-xs font-bold flex items-center gap-1 text-emerald-300 hover:text-emerald-200 transition-colors"
            >
              {copied ? <CheckCircle2 size={12} /> : <Copy size={12} />}
              {copied ? 'Copiado!' : 'Copiar código'}
            </button>
          </div>
          <code className="block text-[10px] text-white/60 break-all bg-black/30 rounded px-2 py-1.5 font-mono">
            {p.gateway!.pix_copy_paste}
          </code>
        </div>
      )}

      {/* Boleto */}
      {hasBoleto && (
        <div className="mt-3 pt-3 border-t border-white/10">
          <a
            href={p.gateway!.boleto_url!}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-300 hover:text-amber-200 transition-colors"
          >
            <FileText size={12} /> Abrir boleto
            <ExternalLink size={10} />
          </a>
        </div>
      )}

      {/* Fallback: invoice_url */}
      {isOpen && !hasPix && !hasBoleto && p.gateway?.invoice_url && (
        <div className="mt-3 pt-3 border-t border-white/10">
          <a
            href={p.gateway.invoice_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-[#A89048] hover:text-[#B89A50] transition-colors"
          >
            <ExternalLink size={12} /> Ver instruções de pagamento
          </a>
        </div>
      )}
    </div>
  );
}
