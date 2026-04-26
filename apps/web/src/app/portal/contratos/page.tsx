'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, AlertCircle, FileSignature, ExternalLink, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
import { PortalHeader } from '../components/PortalHeader';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005';

type Contract = {
  id: string;
  status: 'PENDENTE' | 'ASSINADO' | 'CANCELADO' | 'EXPIRADO' | string;
  signing_url: string | null;
  signed_at: string | null;
  created_at: string;
  updated_at: string;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = {
  PENDENTE:  { label: 'Aguardando assinatura', color: 'amber',   icon: Clock },
  ASSINADO:  { label: 'Assinado',              color: 'emerald', icon: CheckCircle2 },
  CANCELADO: { label: 'Cancelado',             color: 'gray',    icon: AlertCircle },
  EXPIRADO:  { label: 'Expirado',              color: 'red',     icon: AlertTriangle },
};

function formatBrDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'UTC',
  });
}

export default function ContratosPage() {
  const router = useRouter();
  const [contracts, setContracts] = useState<Contract[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/portal/contracts`, { credentials: 'include' })
      .then(async r => {
        if (r.status === 401) { router.push('/portal'); return null; }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => { if (data) setContracts(data); })
      .catch(e => setError(e.message || 'Falha ao carregar'));
  }, [router]);

  const pendingCount = contracts?.filter(c => c.status === 'PENDENTE').length || 0;

  return (
    <>
      <PortalHeader showBack />
      <main className="flex-1 max-w-3xl w-full mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-1">Seus contratos</h1>
          <p className="text-white/50 text-sm">Contratos enviados pra assinatura digital.</p>
        </div>

        {/* Alerta de pendentes */}
        {pendingCount > 0 && (
          <div className="rounded-xl border-2 border-amber-500/40 bg-amber-500/5 p-4 mb-6 flex items-start gap-3">
            <AlertTriangle className="text-amber-400 shrink-0 mt-0.5" size={20} />
            <div>
              <p className="font-bold text-amber-300">
                {pendingCount === 1 ? 'Você tem 1 contrato' : `Você tem ${pendingCount} contratos`} aguardando sua assinatura
              </p>
              <p className="text-xs text-amber-300/70 mt-0.5">
                Clique em "Assinar agora" pra abrir o contrato no Clicksign e assinar digitalmente.
              </p>
            </div>
          </div>
        )}

        {contracts === null && !error && (
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

        {contracts && contracts.length === 0 && (
          <div className="rounded-xl border border-white/10 bg-[#0d0d14] p-12 text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#A89048]/15 border border-[#A89048]/30 mb-4">
              <FileSignature className="text-[#A89048]" size={24} />
            </div>
            <h2 className="text-lg font-bold mb-2">Nenhum contrato ainda</h2>
            <p className="text-white/50 text-sm">
              Quando o escritório enviar um contrato pra assinatura, ele aparece aqui.
            </p>
          </div>
        )}

        {contracts && contracts.length > 0 && (
          <div className="space-y-3">
            {contracts.map(c => <ContractCard key={c.id} c={c} />)}
          </div>
        )}
      </main>
    </>
  );
}

function ContractCard({ c }: { c: Contract }) {
  const cfg = STATUS_CONFIG[c.status] || STATUS_CONFIG.PENDENTE;
  const Icon = cfg.icon;
  const colorClasses: Record<string, string> = {
    amber: 'border-amber-500/30 bg-amber-500/5',
    emerald: 'border-emerald-500/30 bg-emerald-500/5',
    gray: 'border-white/10 bg-white/5',
    red: 'border-red-500/30 bg-red-500/5',
  };
  const iconClasses: Record<string, string> = {
    amber: 'text-amber-400',
    emerald: 'text-emerald-400',
    gray: 'text-white/40',
    red: 'text-red-400',
  };

  return (
    <div className={`rounded-xl border p-4 ${colorClasses[cfg.color]}`}>
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-${cfg.color}-500/15 border border-${cfg.color}-500/30`}>
          <Icon className={iconClasses[cfg.color]} size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`text-[10px] font-bold uppercase tracking-wider ${iconClasses[cfg.color]}`}>
              {cfg.label}
            </span>
          </div>
          <h3 className="font-bold text-base text-white">Contrato de honorários</h3>
          <p className="text-[11px] text-white/50 mt-0.5">
            {c.status === 'ASSINADO' && c.signed_at
              ? `Assinado em ${formatBrDateTime(c.signed_at)}`
              : `Enviado em ${formatBrDateTime(c.created_at)}`}
          </p>
        </div>
      </div>

      {c.status === 'PENDENTE' && c.signing_url && (
        <a
          href={c.signing_url}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full inline-flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-[#0a0a0f] font-bold py-2.5 rounded-lg transition-colors"
        >
          <FileSignature size={14} /> Assinar agora
          <ExternalLink size={12} />
        </a>
      )}

      {c.status === 'ASSINADO' && (
        <div className="text-xs text-emerald-300/80">
          ✅ Contrato assinado com sucesso. Uma cópia foi salva nos seus documentos.
        </div>
      )}
    </div>
  );
}
