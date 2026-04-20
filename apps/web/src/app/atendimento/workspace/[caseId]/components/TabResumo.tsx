'use client';

import { useState, useEffect } from 'react';
import { Save, Loader2, Gavel, Scale, UserX, User, FileText, Brain, Sparkles, RefreshCw, DollarSign, Phone, Mail, MapPin, Building2, BadgeCheck } from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

interface WorkspaceData {
  id: string;
  case_number: string | null;
  legal_area: string | null;
  stage: string;
  in_tracking: boolean;
  tracking_stage: string | null;
  notes: string | null;
  court: string | null;
  action_type: string | null;
  claim_value: number | null;
  opposing_party: string | null;
  judge: string | null;
  created_at: string;
  updated_at: string;
  lead: {
    name: string | null;
    phone: string;
    email: string | null;
    // memory (AiMemory) removido 2026-04-20. Substituido por profile (LeadProfile).
    profile: { summary: string; facts: any } | null;
    ficha_trabalhista: { data: any; completion_pct: number; finalizado: boolean } | null;
  };
  lawyer: { id: string; name: string; email: string };
}

const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

function Field({ label, icon: Icon, value, onChange, placeholder, type = 'text' }: {
  label: string; icon?: any; value: string; onChange: (v: string) => void; placeholder: string; type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        {Icon && <Icon size={11} className="text-primary/60" />}
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
      />
    </div>
  );
}

function InfoRow({ label, value, icon: Icon }: { label: string; value: string | null; icon?: any }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border/30 last:border-0">
      <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
        {Icon && <Icon size={11} />}
        {label}
      </span>
      <span className="text-[12px] font-medium text-foreground">{value}</span>
    </div>
  );
}

function FinCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`rounded-xl border p-3.5 text-center ${color}`}>
      <p className="text-[9px] font-bold uppercase tracking-wider opacity-80">{label}</p>
      <p className="text-[15px] font-bold mt-1">{fmt(value)}</p>
    </div>
  );
}

export default function TabResumo({ data, onRefresh }: { data: WorkspaceData; onRefresh: () => void }) {
  const [saving, setSaving] = useState(false);
  const [briefing, setBriefing] = useState<string | null>(null);
  const [generatingBriefing, setGeneratingBriefing] = useState(false);

  const [caseFin, setCaseFin] = useState<{ honorarios: number; received: number; pending: number; overdue: number; expenses: number } | null>(null);
  useEffect(() => {
    api.get('/financeiro/transactions', { params: { legalCaseId: data.id, limit: 500 } })
      .then(r => {
        const txs: any[] = r.data?.data || r.data || [];
        const s = { honorarios: 0, received: 0, pending: 0, overdue: 0, expenses: 0 };
        txs.forEach((t: any) => {
          const amt = parseFloat(t.amount) || 0;
          if (t.type === 'DESPESA' && t.status !== 'CANCELADO') { s.expenses += amt; return; }
          if (t.type === 'RECEITA') {
            s.honorarios += amt;
            if (t.status === 'PAGO') s.received += amt;
            else if (t.status === 'PENDENTE' && t.due_date && new Date(t.due_date) < new Date()) s.overdue += amt;
            else if (t.status === 'PENDENTE') s.pending += amt;
          }
        });
        setCaseFin(s);
      })
      .catch(() => {});
  }, [data.id]);

  const handleGenerateBriefing = async () => {
    setGeneratingBriefing(true);
    try {
      const res = await api.post(`/legal-cases/${data.id}/briefing`);
      setBriefing(res.data.briefing);
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao gerar briefing');
    } finally {
      setGeneratingBriefing(false);
    }
  };

  const [actionType, setActionType] = useState(data.action_type || '');
  const [claimValue, setClaimValue] = useState(data.claim_value?.toString() || '');
  const [opposingParty, setOpposingParty] = useState(data.opposing_party || '');
  const [judge, setJudge] = useState(data.judge || '');
  const [notes, setNotes] = useState(data.notes || '');
  const [court, setCourt] = useState(data.court || '');
  const [legalArea, setLegalArea] = useState(data.legal_area || '');

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch(`/legal-cases/${data.id}/details`, {
        action_type: actionType || null,
        claim_value: claimValue ? parseFloat(claimValue) : null,
        opposing_party: opposingParty || null,
        judge: judge || null,
        notes: notes || null,
        court: court || null,
        legal_area: legalArea || null,
      });
      showSuccess('Dados salvos');
      onRefresh();
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  // Substituido em 2026-04-20 (fase 2d): lead.memory -> lead.profile.
  const profile = data.lead?.profile;
  const ficha = data.lead?.ficha_trabalhista;
  const pctReceived = caseFin && caseFin.honorarios > 0 ? Math.round((caseFin.received / caseFin.honorarios) * 100) : 0;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">

      {/* Row 1: Dados do Caso + Cliente */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Dados do Caso (2/3) */}
        <div className="lg:col-span-2 bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border flex items-center justify-between bg-accent/20">
            <h2 className="text-[13px] font-bold text-foreground flex items-center gap-2">
              <Gavel size={14} className="text-primary" />
              Dados do Caso
            </h2>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-[11px] font-bold hover:opacity-90 transition-opacity disabled:opacity-50 shadow-lg shadow-primary/20"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              Salvar
            </button>
          </div>
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Area Juridica" icon={Scale} value={legalArea} onChange={setLegalArea} placeholder="Trabalhista, Civil..." />
            <Field label="Tipo de Acao" icon={FileText} value={actionType} onChange={setActionType} placeholder="Reclamatoria Trabalhista..." />
            <Field label="Valor da Causa (R$)" icon={DollarSign} value={claimValue} onChange={setClaimValue} placeholder="0,00" type="number" />
            <Field label="Vara / Tribunal" icon={Building2} value={court} onChange={setCourt} placeholder="1a Vara do Trabalho..." />
            <Field label="Parte Contraria" icon={UserX} value={opposingParty} onChange={setOpposingParty} placeholder="Nome da parte contraria" />
            <Field label="Juiz / Desembargador" icon={Gavel} value={judge} onChange={setJudge} placeholder="Nome do juiz" />
          </div>
          <div className="px-5 pb-5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-1.5">
              <FileText size={11} className="text-primary/60" /> Observacoes
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Notas sobre o caso..."
              className="w-full px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 min-h-[80px] resize-y transition-all"
            />
          </div>
        </div>

        {/* Cliente (1/3) */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border bg-emerald-500/5">
            <h2 className="text-[13px] font-bold text-foreground flex items-center gap-2">
              <User size={14} className="text-emerald-400" />
              Cliente
            </h2>
          </div>
          <div className="p-5">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 border border-emerald-500/30 flex items-center justify-center">
                <span className="text-xl font-bold text-emerald-400">{(data.lead.name || '?')[0]?.toUpperCase()}</span>
              </div>
              <div>
                <p className="text-[15px] font-bold text-foreground">{data.lead.name || 'Sem nome'}</p>
                <p className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider">Cliente</p>
              </div>
            </div>
            <div className="space-y-0">
              <InfoRow label="Telefone" value={data.lead.phone} icon={Phone} />
              {data.lead.email && <InfoRow label="Email" value={data.lead.email} icon={Mail} />}
              <InfoRow label="Advogado" value={data.lawyer.name} icon={BadgeCheck} />
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: Financeiro */}
      {caseFin && (caseFin.honorarios > 0 || caseFin.expenses > 0) && (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border bg-emerald-500/5">
            <h2 className="text-[13px] font-bold text-foreground flex items-center gap-2">
              <DollarSign size={14} className="text-emerald-400" />
              Financeiro
            </h2>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <FinCard label="Honorarios" value={caseFin.honorarios} color="bg-blue-500/10 border-blue-500/20 text-blue-400" />
              <FinCard label="Recebido" value={caseFin.received} color="bg-emerald-500/10 border-emerald-500/20 text-emerald-400" />
              <FinCard label="Pendente" value={caseFin.pending} color="bg-amber-500/10 border-amber-500/20 text-amber-400" />
              <FinCard label="Atrasado" value={caseFin.overdue} color="bg-red-500/10 border-red-500/20 text-red-400" />
              <FinCard label="Despesas" value={caseFin.expenses} color="bg-purple-500/10 border-purple-500/20 text-purple-400" />
            </div>
            {caseFin.honorarios > 0 && (
              <div className="mt-4 flex items-center gap-4">
                <div className="flex-1 bg-accent/30 rounded-full h-2.5 overflow-hidden">
                  <div className="bg-gradient-to-r from-emerald-500 to-emerald-400 h-2.5 rounded-full transition-all" style={{ width: `${Math.min(100, pctReceived)}%` }} />
                </div>
                <span className="text-[12px] font-bold text-emerald-400 shrink-0">{pctReceived}%</span>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  Lucro: <span className={`font-bold ${(caseFin.received - caseFin.expenses) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {fmt(caseFin.received - caseFin.expenses)}
                  </span>
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Row 3: IA Memory + Briefing */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {profile && (
          <div className="bg-card border border-violet-500/20 rounded-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-violet-500/20 bg-violet-500/5">
              <h2 className="text-[13px] font-bold text-violet-300 flex items-center gap-2">
                <Brain size={14} /> Perfil do Cliente
              </h2>
            </div>
            <div className="p-5 text-[12px] text-foreground/80 leading-relaxed whitespace-pre-line max-h-[280px] overflow-y-auto custom-scrollbar">
              {profile.summary}
            </div>
          </div>
        )}
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border flex items-center justify-between bg-sky-500/5">
            <h2 className="text-[13px] font-bold text-foreground flex items-center gap-2">
              <Sparkles size={14} className="text-sky-400" /> Briefing IA
            </h2>
            <button
              onClick={handleGenerateBriefing}
              disabled={generatingBriefing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 text-[10px] font-bold transition-colors disabled:opacity-50"
            >
              {generatingBriefing ? <><Loader2 size={11} className="animate-spin" /> Gerando...</>
                : briefing ? <><RefreshCw size={11} /> Regenerar</>
                : <><Sparkles size={11} /> Gerar</>}
            </button>
          </div>
          <div className="p-5">
            {generatingBriefing && (
              <div className="space-y-2.5 animate-pulse">
                <div className="h-3 bg-muted rounded w-3/4" />
                <div className="h-3 bg-muted rounded w-full" />
                <div className="h-3 bg-muted rounded w-5/6" />
              </div>
            )}
            {briefing && !generatingBriefing && (
              <div className="text-[12px] text-foreground/80 leading-relaxed whitespace-pre-wrap max-h-[280px] overflow-y-auto custom-scrollbar">
                {briefing}
              </div>
            )}
            {!briefing && !generatingBriefing && (
              <p className="text-[11px] text-muted-foreground text-center py-8">
                Clique em "Gerar" para um resumo com situacao atual, proximos passos e pontos de atencao.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Row 4: Ficha Trabalhista */}
      {ficha && (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border flex items-center gap-3 bg-cyan-500/5">
            <h2 className="text-[13px] font-bold text-foreground flex items-center gap-2">
              <MapPin size={14} className="text-cyan-400" /> Ficha Trabalhista
            </h2>
            <div className="flex items-center gap-2">
              <div className="w-24 bg-accent/30 rounded-full h-2 overflow-hidden">
                <div className="bg-gradient-to-r from-cyan-500 to-cyan-400 h-2 rounded-full" style={{ width: `${ficha.completion_pct}%` }} />
              </div>
              <span className="text-[11px] font-bold text-cyan-400">{ficha.completion_pct}%</span>
              {ficha.finalizado && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">Finalizada</span>}
            </div>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-0">
              {Object.entries(ficha.data as Record<string, any>)
                .filter(([, v]) => v != null && v !== '')
                .slice(0, 24)
                .map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between py-2 border-b border-border/20">
                    <span className="text-[10px] text-muted-foreground truncate max-w-[45%]">{key.replace(/_/g, ' ')}</span>
                    <span className="text-[11px] font-medium text-foreground text-right truncate max-w-[50%]">{String(value)}</span>
                  </div>
                ))}
            </div>
            {Object.keys(ficha.data as Record<string, any>).length > 24 && (
              <p className="text-[10px] text-muted-foreground mt-3">...e mais {Object.keys(ficha.data as Record<string, any>).length - 24} campos</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
