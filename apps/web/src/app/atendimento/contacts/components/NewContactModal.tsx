'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, X, UserPlus, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { useRole } from '@/lib/useRole';
import { PhoneInput } from '@/components/PhoneInput';

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length <= 11) return `55${digits}`;
  return digits;
}

const LEGAL_AREAS = ['Trabalhista', 'Civil', 'Criminal', 'Previdenciário', 'Família', 'Consumidor', 'Administrativo', 'Tributário', 'Empresarial'];

export default function NewContactModal({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: (convId: string) => void;
}) {
  const router = useRouter();
  const { isAdmin, isFinanceiro, userId } = useRole();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [legalArea, setLegalArea] = useState('');
  const [selectedLawyerId, setSelectedLawyerId] = useState('');
  const [lawyers, setLawyers] = useState<{ id: string; name: string | null }[]>([]);
  const [checking, setChecking] = useState(false);
  const [duplicate, setDuplicate] = useState<{ name: string; convId?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Carregar advogados (para admin/financeiro)
  useEffect(() => {
    if (isAdmin || isFinanceiro) {
      api.get('/users/lawyers').then(r => setLawyers(r.data || [])).catch(() => {});
    }
  }, [isAdmin, isFinanceiro]);

  const checkPhoneDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const checkPhone = useCallback((phoneVal: string) => {
    if (checkPhoneDebounceRef.current) clearTimeout(checkPhoneDebounceRef.current);
    const normalized = normalizePhone(phoneVal);
    if (normalized.length < 10) { setDuplicate(null); return; }
    checkPhoneDebounceRef.current = setTimeout(async () => {
      setChecking(true);
      setDuplicate(null);
      try {
        const r = await api.get(`/leads/check-phone?phone=${normalized}`);
        if (r.data.exists) {
          const lead = r.data.lead;
          const convR = await api.get(`/conversations/lead/${lead.id}`).catch(() => ({ data: [] }));
          const convs = (convR.data as any[]).filter((c: any) => c.status === 'ABERTO');
          const convId = convs[0]?.id;
          setDuplicate({ name: lead.name || lead.phone, convId });
        }
      } catch { /* ignora */ } finally { setChecking(false); }
    }, 500);
  }, []);

  const openDuplicate = (convId?: string) => {
    if (convId) sessionStorage.setItem('crm_open_conv', convId);
    router.push('/atendimento');
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const normalized = normalizePhone(phone);
    if (normalized.length < 12) { setError('Telefone inválido. Use DDD + número (ex: 82 99913-0127)'); return; }
    if (!name.trim()) { setError('Nome é obrigatório'); return; }

    setSubmitting(true);
    try {
      // Verificar duplicata
      const check = await api.get(`/leads/check-phone?phone=${normalized}`);
      if (check.data.exists) {
        const lead = check.data.lead;
        const convR = await api.get(`/conversations/lead/${lead.id}`).catch(() => ({ data: [] }));
        const convId = (convR.data as any[]).filter(c => c.status === 'ABERTO')[0]?.id;
        setDuplicate({ name: lead.name || lead.phone, convId });
        setSubmitting(false);
        return;
      }

      // Criar lead
      const leadR = await api.post('/leads', {
        name: name.trim(),
        phone: normalized,
        ...(email.trim() ? { email: email.trim() } : {}),
        origin: 'manual',
        stage: 'QUALIFICANDO',
      });

      // Criar conversa — instância sempre "whatsapp", atendente = quem cadastrou
      const convR = await api.post('/conversations', {
        lead_id: leadR.data.id,
        channel: 'whatsapp',
        instance_name: 'whatsapp',
      });

      // Atribuir atendente (quem cadastrou)
      await api.patch(`/conversations/${convR.data.id}/assign`).catch(() => {});

      // Atribuir advogado responsável
      if (selectedLawyerId) {
        await api.patch(`/conversations/${convR.data.id}/assign-lawyer`, { lawyerId: selectedLawyerId }).catch(() => {});
      }

      // Definir área jurídica
      if (legalArea) {
        await api.patch(`/conversations/${convR.data.id}/legal-area`, { legalArea }).catch(() => {});
      }

      onCreated(convR.data.id);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Erro ao cadastrar contato. Tente novamente.');
    } finally { setSubmitting(false); }
  };

  return (
    <>
      <div className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-[3px]" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] z-[100] bg-card border border-border rounded-2xl shadow-2xl flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <UserPlus size={16} className="text-primary" />
            <h2 className="text-[15px] font-bold text-foreground">Novo Contato</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-6 py-5">
          {/* Nome */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Nome *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Nome completo"
              className="w-full px-3.5 py-2.5 bg-background border border-border rounded-xl text-[13px] text-foreground outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all placeholder:text-muted-foreground/40" />
          </div>

          {/* Telefone */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Telefone (DDD + número) *</label>
            <div className="relative">
              <PhoneInput value={phone} onChange={(digits) => { setPhone(digits); checkPhone(digits); }}
                className={`w-full px-3.5 py-2.5 bg-background border rounded-xl text-[13px] text-foreground outline-none focus:ring-2 transition-all placeholder:text-muted-foreground/40 ${duplicate ? 'border-amber-500/50 focus:ring-amber-500/20' : 'border-border focus:ring-primary/20 focus:border-primary'}`} />
              {checking && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />}
            </div>
            {duplicate && (
              <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                <div className="flex items-center gap-2">
                  <AlertCircle size={14} className="text-amber-500 shrink-0" />
                  <span className="text-[12px] text-amber-400 font-medium">Contato já existe: <strong>{duplicate.name}</strong></span>
                </div>
                <button type="button" onClick={() => openDuplicate(duplicate.convId)} className="text-[11px] font-bold text-amber-400 hover:underline whitespace-nowrap">Abrir no Chat →</button>
              </div>
            )}
          </div>

          {/* Email */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">E-mail <span className="normal-case font-normal opacity-60">(opcional)</span></label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@exemplo.com"
              className="w-full px-3.5 py-2.5 bg-background border border-border rounded-xl text-[13px] text-foreground outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all placeholder:text-muted-foreground/40" />
          </div>

          {/* Área Jurídica */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Área Jurídica <span className="normal-case font-normal opacity-60">(opcional)</span></label>
            <select value={legalArea} onChange={e => setLegalArea(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-background border border-border rounded-xl text-[13px] text-foreground outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all">
              <option value="">Selecionar...</option>
              {LEGAL_AREAS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>

          {/* Advogado (admin/financeiro) */}
          {(isAdmin || isFinanceiro) && lawyers.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Advogado Responsável <span className="normal-case font-normal opacity-60">(opcional)</span></label>
              <select value={selectedLawyerId} onChange={e => setSelectedLawyerId(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-background border border-border rounded-xl text-[13px] text-foreground outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all">
                <option value="">Sem advogado</option>
                {lawyers.map(l => <option key={l.id} value={l.id}>{l.name || l.id}</option>)}
              </select>
            </div>
          )}

          {/* Erro */}
          {error && (
            <div className="flex items-center gap-2 px-3 py-2.5 bg-red-500/10 border border-red-500/20 rounded-xl text-[12px] text-red-500">
              <AlertCircle size={13} className="shrink-0" />
              {error}
            </div>
          )}

          {/* Ações */}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-border text-[13px] font-semibold text-muted-foreground hover:bg-accent transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={submitting || !!duplicate}
              className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-[13px] font-bold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2">
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
              Cadastrar e Abrir Chat
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
