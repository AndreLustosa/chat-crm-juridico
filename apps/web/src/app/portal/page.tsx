'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { MessageCircle, Phone, Loader2, Lock, ArrowRight, ArrowLeft, LogOut, CheckCircle2, Scale, FileText, CreditCard, Calendar, FileSignature, UploadCloud } from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005';
const WHATSAPP_FALLBACK = 'https://wa.me/5582996390799';

type Stage = 'check' | 'phone' | 'code' | 'dashboard';
type ClientMe = { id: string; name: string | null; email: string | null; phone: string; is_client: boolean };

/**
 * Portal do Cliente — Fase 1: login passwordless via OTP no WhatsApp.
 *
 * Fluxo:
 *   1. Verifica sessao existente via GET /portal/auth/me
 *   2. Se nao logado: tela telefone -> tela OTP 4 digitos -> dashboard
 *   3. Se logado: dashboard direto (placeholder ate Fase 2)
 *
 * Token httpOnly cookie — frontend nao toca em JWT diretamente.
 */
export default function PortalPage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('check');
  const [me, setMe] = useState<ClientMe | null>(null);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState(['', '', '', '']);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const codeRefs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];

  // Verifica sessao ao montar
  useEffect(() => {
    fetch(`${API_BASE}/portal/auth/me`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.id) {
          setMe(data);
          setStage('dashboard');
        } else {
          setStage('phone');
        }
      })
      .catch(() => setStage('phone'));
  }, []);

  // Cooldown timer pra reenviar codigo
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  function formatPhone(raw: string): string {
    const digits = raw.replace(/\D/g, '').slice(0, 11);
    if (digits.length <= 2) return digits;
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }

  async function requestCode() {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) {
      setError('Digite o telefone completo com DDD.');
      return;
    }
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/portal/auth/request-code`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: digits }),
      });
      if (!res.ok) {
        if (res.status === 429) {
          setError('Muitas tentativas. Tente novamente em alguns minutos.');
        } else {
          setError('Erro ao gerar codigo. Tente novamente.');
        }
        return;
      }
      const data = await res.json();
      setCooldown(data.cooldownSeconds || 60);
      setInfo('Se o telefone estiver cadastrado, você receberá um código no WhatsApp em alguns segundos.');
      setStage('code');
      setTimeout(() => codeRefs[0].current?.focus(), 100);
    } catch {
      setError('Falha de conexão. Verifique sua internet.');
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode() {
    const c = code.join('');
    if (c.length !== 4) {
      setError('Digite os 4 dígitos.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/portal/auth/verify-code`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.replace(/\D/g, ''), code: c }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || 'Código inválido ou expirado.');
        setCode(['', '', '', '']);
        codeRefs[0].current?.focus();
        return;
      }
      // Token salvo em cookie. Carrega me.
      const meRes = await fetch(`${API_BASE}/portal/auth/me`, { credentials: 'include' });
      if (meRes.ok) {
        const data = await meRes.json();
        setMe(data);
        setStage('dashboard');
      }
    } catch {
      setError('Falha de conexão.');
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    await fetch(`${API_BASE}/portal/auth/logout`, { method: 'POST', credentials: 'include' });
    setMe(null);
    setPhone('');
    setCode(['', '', '', '']);
    setStage('phone');
  }

  function handleCodeChange(idx: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...code];
    next[idx] = digit;
    setCode(next);
    if (digit && idx < 3) codeRefs[idx + 1].current?.focus();
    // Auto-submete quando completar 4 digitos
    if (digit && idx === 3 && next.every(d => d)) {
      setTimeout(() => verifyCode(), 100);
    }
  }

  function handleCodeKeyDown(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !code[idx] && idx > 0) {
      codeRefs[idx - 1].current?.focus();
    }
  }

  // ─── Render ───

  if (stage === 'check') {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="animate-spin text-[#A89048]" size={32} />
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <header className="border-b border-white/10 bg-[#0d0d14]/80 backdrop-blur-xl">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/landing/logo_andre_lustosa_transparente.png"
              alt="André Lustosa Advogados"
              className="h-8 w-auto"
            />
            <div className="hidden sm:block w-px h-6 bg-white/20" />
            <span className="hidden sm:block text-xs font-bold text-[#A89048] uppercase tracking-widest">
              Portal do Cliente
            </span>
          </div>
          {stage === 'dashboard' ? (
            <button
              onClick={logout}
              className="flex items-center gap-2 text-white/70 hover:text-white text-xs font-bold px-4 py-2 rounded-full hover:bg-white/5 transition-colors"
            >
              <LogOut size={14} />
              Sair
            </button>
          ) : (
            <a
              href={WHATSAPP_FALLBACK}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 transition-colors text-white text-xs font-bold px-4 py-2 rounded-full"
            >
              <MessageCircle size={14} />
              Suporte
            </a>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        {stage === 'phone' && (
          <div className="w-full max-w-md">
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#A89048]/15 border border-[#A89048]/30 mb-4">
                <Lock className="text-[#A89048]" size={24} />
              </div>
              <h1 className="text-2xl font-bold mb-2">Acesse seu Portal</h1>
              <p className="text-white/60 text-sm">
                Enviaremos um código de 4 dígitos no seu WhatsApp.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-white/50 mb-2">
                  Telefone WhatsApp
                </label>
                <div className="relative">
                  <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" size={18} />
                  <input
                    type="tel"
                    inputMode="numeric"
                    placeholder="(82) 99999-9999"
                    value={phone}
                    onChange={(e) => setPhone(formatPhone(e.target.value))}
                    onKeyDown={(e) => e.key === 'Enter' && requestCode()}
                    autoFocus
                    className="w-full bg-[#16161f] border border-white/10 rounded-xl py-3.5 pl-12 pr-4 text-base focus:border-[#A89048] focus:outline-none transition-colors"
                  />
                </div>
              </div>

              {error && (
                <div className="text-red-400 text-sm flex items-center gap-2 px-2">{error}</div>
              )}

              <button
                onClick={requestCode}
                disabled={loading || phone.replace(/\D/g, '').length < 10}
                className="w-full flex items-center justify-center gap-2 bg-[#A89048] hover:bg-[#B89A50] disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-[#0a0a0f] font-bold py-3.5 rounded-xl"
              >
                {loading ? <Loader2 className="animate-spin" size={18} /> : <>Gerar código <ArrowRight size={16} /></>}
              </button>

              <p className="text-center text-xs text-white/40 pt-2">
                Não tem cadastro? <a href={WHATSAPP_FALLBACK} target="_blank" rel="noopener noreferrer" className="text-[#A89048] hover:underline">Fale com o escritório</a>
              </p>
            </div>
          </div>
        )}

        {stage === 'code' && (
          <div className="w-full max-w-md">
            <button
              onClick={() => { setStage('phone'); setError(null); setInfo(null); setCode(['', '', '', '']); }}
              className="flex items-center gap-1 text-white/50 hover:text-white text-sm mb-6 transition-colors"
            >
              <ArrowLeft size={14} /> Trocar telefone
            </button>

            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 mb-4">
                <MessageCircle className="text-emerald-400" size={24} />
              </div>
              <h1 className="text-2xl font-bold mb-2">Digite o código</h1>
              <p className="text-white/60 text-sm">
                Enviamos um código para <strong className="text-white">{phone}</strong>
              </p>
            </div>

            <div className="space-y-5">
              <div className="flex justify-center gap-3">
                {code.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={codeRefs[idx]}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleCodeChange(idx, e.target.value)}
                    onKeyDown={(e) => handleCodeKeyDown(idx, e)}
                    className="w-14 h-16 text-center text-2xl font-bold bg-[#16161f] border border-white/10 rounded-xl focus:border-[#A89048] focus:outline-none transition-colors"
                  />
                ))}
              </div>

              {info && !error && (
                <div className="text-emerald-400 text-xs text-center px-2 leading-relaxed">{info}</div>
              )}
              {error && (
                <div className="text-red-400 text-sm text-center px-2">{error}</div>
              )}

              <button
                onClick={verifyCode}
                disabled={loading || code.some(d => !d)}
                className="w-full flex items-center justify-center gap-2 bg-[#A89048] hover:bg-[#B89A50] disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-[#0a0a0f] font-bold py-3.5 rounded-xl"
              >
                {loading ? <Loader2 className="animate-spin" size={18} /> : <>Entrar <ArrowRight size={16} /></>}
              </button>

              <button
                onClick={requestCode}
                disabled={cooldown > 0 || loading}
                className="w-full text-sm text-white/50 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {cooldown > 0 ? `Reenviar código em ${cooldown}s` : 'Reenviar código'}
              </button>
            </div>
          </div>
        )}

        {stage === 'dashboard' && me && (
          <div className="w-full max-w-2xl">
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 mb-4">
                <CheckCircle2 className="text-emerald-400" size={24} />
              </div>
              <h1 className="text-3xl font-bold mb-2">
                Olá, {me.name?.split(' ')[0] || 'cliente'}!
              </h1>
              <p className="text-white/60">
                Bem-vindo ao seu portal. Em breve você vai poder acompanhar tudo por aqui.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FeatureCard
                title="Seus processos"
                description="Acompanhe movimentações em tempo real"
                icon={Scale}
                onClick={() => router.push('/portal/processos')}
              />
              <FeatureCard
                title="Documentos"
                description="Procurações, contratos e laudos"
                icon={FileText}
                onClick={() => router.push('/portal/documentos')}
              />
              <FeatureCard
                title="Pagamentos"
                description="Honorários e boletos do seu caso"
                icon={CreditCard}
                onClick={() => router.push('/portal/pagamentos')}
              />
              <FeatureCard
                title="Contratos"
                description="Contratos pra assinar digitalmente"
                icon={FileSignature}
                onClick={() => router.push('/portal/contratos')}
              />
              <FeatureCard
                title="Agendar consulta"
                description="Marque um horário com seu advogado"
                icon={Calendar}
                onClick={() => router.push('/portal/agendar')}
              />
              <FeatureCard
                title="Enviar documento"
                description="Suba RG, comprovantes ou outros arquivos"
                icon={UploadCloud}
                onClick={() => router.push('/portal/enviar-documento')}
              />
            </div>

            <p className="text-center text-xs text-white/40 mt-8">
              Por enquanto, fale conosco diretamente:{' '}
              <a href={WHATSAPP_FALLBACK} target="_blank" rel="noopener noreferrer" className="text-[#A89048] hover:underline">
                WhatsApp
              </a>
            </p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 py-4 text-center text-xs text-white/30">
        André Lustosa Advogados — © {new Date().getFullYear()}
      </footer>
    </>
  );
}

function FeatureCard({
  title,
  description,
  soon,
  icon: Icon,
  onClick,
}: {
  title: string;
  description: string;
  soon?: boolean;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  onClick?: () => void;
}) {
  const isClickable = !soon && !!onClick;
  return (
    <button
      onClick={onClick}
      disabled={!isClickable}
      className={`rounded-xl border border-white/10 bg-[#0d0d14] p-5 relative text-left transition-all ${
        isClickable ? 'hover:border-[#A89048]/50 hover:bg-[#13131c] cursor-pointer' : 'cursor-default'
      }`}
    >
      <div className="flex items-start gap-3">
        {Icon && (
          <div className="w-10 h-10 rounded-lg bg-[#A89048]/15 border border-[#A89048]/30 flex items-center justify-center shrink-0">
            <Icon size={18} className="text-[#A89048]" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-base mb-1">{title}</h3>
          <p className="text-white/50 text-sm">{description}</p>
        </div>
        {isClickable && <ArrowRight size={16} className="text-[#A89048] shrink-0 mt-1" />}
      </div>
      {soon && (
        <span className="absolute top-3 right-3 text-[10px] font-bold text-[#A89048] uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#A89048]/10 border border-[#A89048]/30">
          Em breve
        </span>
      )}
    </button>
  );
}
