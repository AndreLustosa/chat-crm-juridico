'use client';

import { useState, FormEvent, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, Lock, AlertCircle, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import { motion } from 'framer-motion';
import Image from 'next/image';
import api, { API_BASE_URL } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [dbStatus, setDbStatus] = useState<'online' | 'offline' | 'checking'>('checking');
  const [sessionMsg, setSessionMsg] = useState<string | null>(null);

  useEffect(() => {
    const savedEmail = localStorage.getItem('remembered_email');
    if (savedEmail) {
      setEmail(savedEmail);
      setRememberMe(true);
    }
    // Verifica se foi redirecionado por logout automático
    const reason = localStorage.getItem('auth_logout_reason');
    if (reason) {
      localStorage.removeItem('auth_logout_reason');
      setSessionMsg(
        reason === 'expired'
          ? 'Sua sessão expirou. Faça login novamente.'
          : 'Acesso não autorizado. Faça login novamente.'
      );
    }
  }, []);

  useEffect(() => {
    const checkDb = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/health/db`);
        const data = await res.json();
        setDbStatus(data.status === 'ok' ? 'online' : 'offline');
      } catch {
        setDbStatus('offline');
      }
    };
    checkDb();
    const interval = setInterval(checkDb, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/auth/login', { email, password });
      localStorage.setItem('token', res.data.access_token);
      if (rememberMe) {
        localStorage.setItem('remembered_email', email);
      } else {
        localStorage.removeItem('remembered_email');
      }
      router.push('/atendimento');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || 'Credenciais inválidas');
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0A0A0A]">
      {/* Background effects */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(168,144,72,0.07)_0%,transparent_70%)]" />
      <div className="absolute -left-40 -top-40 h-[500px] w-[500px] rounded-full bg-[#A89048]/5 blur-[120px] animate-pulse" />
      <div className="absolute -bottom-40 -right-40 h-[500px] w-[500px] rounded-full bg-[#A89048]/5 blur-[120px] animate-pulse" />

      <div className="relative flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-[1100px]">
          <div className="grid gap-8 lg:grid-cols-2 lg:gap-20">

            {/* ── Left — Branding ─────────────────────────────────── */}
            <div className="hidden flex-col justify-center lg:flex">
              <div className="mb-12">
                <Image
                  src="/logo_andre_lustosa.png"
                  alt="André Lustosa Advogados"
                  width={320}
                  height={100}
                  className="h-20 w-auto object-contain"
                />
              </div>

              <h1 className="mb-6 text-5xl font-black leading-tight text-white uppercase tracking-tight">
                Excelência em <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#e3c788] via-[#d4b568] to-[#c8aa62]">
                  Justiça Digital
                </span>
              </h1>

              <p className="mb-10 text-lg text-slate-400 font-medium leading-relaxed max-w-md">
                Acesse sua plataforma exclusiva de gestão estratégica.
                Tecnologia de ponta a serviço do seu direito.
              </p>

              <div className="space-y-5">
                {[
                  'Gestão Estratégica de Processos',
                  'Inteligência Jurídica Avançada',
                  'Ambiente Seguro e Privativo',
                  'Atendimento Nacional Digital',
                ].map((feature, i) => (
                  <div key={i} className="flex items-center gap-4 group">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#A89048]/10 border border-[#A89048]/30 transition-all group-hover:bg-[#A89048]/20 group-hover:scale-110 shrink-0">
                      <CheckCircle2 className="h-4 w-4 text-[#A89048]" />
                    </div>
                    <span className="text-slate-300 font-semibold tracking-wide">{feature}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Right — Login Form ───────────────────────────────── */}
            <div className="flex items-center justify-center">
              <div className="w-full max-w-md border border-white/[0.08] bg-[#111111] shadow-[0_20px_60px_rgba(0,0,0,0.6)] rounded-[2rem] overflow-hidden">
                <div className="p-8 md:p-12">

                  {/* Mobile logo */}
                  <div className="mb-10 flex flex-col items-center justify-center lg:hidden">
                    <Image
                      src="/logo_andre_lustosa.png"
                      alt="André Lustosa Advogados"
                      width={200}
                      height={60}
                      className="h-12 w-auto object-contain"
                    />
                  </div>

                  {/* Heading */}
                  <div className="mb-10 text-center lg:text-left">
                    <h2 className="text-3xl font-black text-white uppercase tracking-tight">
                      Bem-vindo
                    </h2>
                    <div className="w-12 h-1 bg-[#A89048] mt-3 mb-4 rounded-full mx-auto lg:mx-0 shadow-[0_0_10px_rgba(168,144,72,0.5)]" />
                    <p className="text-slate-400 font-medium">Acesse seu painel com segurança</p>
                  </div>

                  {/* Session expired banner */}
                  {sessionMsg && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="mb-6"
                    >
                      <div className="flex items-center gap-3 rounded-xl bg-amber-500/10 border border-amber-500/20 p-4 text-sm text-amber-400 font-medium">
                        <AlertCircle className="h-5 w-5 flex-shrink-0" />
                        {sessionMsg}
                      </div>
                    </motion.div>
                  )}

                  {/* Error banner */}
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="mb-6 space-y-3"
                    >
                      <div className="flex items-center gap-3 rounded-xl bg-red-500/10 border border-red-500/20 p-4 text-sm text-red-400 font-medium">
                        <AlertCircle className="h-5 w-5 flex-shrink-0" />
                        {error}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          localStorage.setItem('token', 'mock-dev-token');
                          router.push('/atendimento');
                        }}
                        className="w-full py-2 text-[12px] font-bold text-[#A89048]/80 hover:text-[#A89048] transition-colors underline decoration-[#A89048]/30"
                      >
                        Entrar em Modo de Demonstração (Bypass)
                      </button>
                    </motion.div>
                  )}

                  <form onSubmit={handleSubmit} className="space-y-6">
                    {/* Email */}
                    <div className="space-y-2">
                      <label className="text-[11px] font-black uppercase tracking-widest text-[#A89048] ml-1">
                        E-mail
                      </label>
                      <div className="relative">
                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 pointer-events-none" />
                        <input
                          autoComplete="email"
                          type="email"
                          placeholder="nome@andrelustosa.adv.br"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          required
                          className="w-full h-14 pl-11 pr-4 rounded-xl border border-white/10 bg-white/5 text-white placeholder:text-slate-600 outline-none focus:border-[#A89048] focus:ring-2 focus:ring-[#A89048]/20 transition-all text-sm"
                        />
                      </div>
                    </div>

                    {/* Password */}
                    <div className="space-y-2">
                      <label className="text-[11px] font-black uppercase tracking-widest text-[#A89048] ml-1">
                        Senha
                      </label>
                      <div className="relative">
                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 pointer-events-none" />
                        <input
                          autoComplete="current-password"
                          type={showPassword ? 'text' : 'password'}
                          placeholder="••••••••"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          className="w-full h-14 pl-11 pr-12 rounded-xl border border-white/10 bg-white/5 text-white placeholder:text-slate-600 outline-none focus:border-[#A89048] focus:ring-2 focus:ring-[#A89048]/20 transition-all text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-[#A89048] transition-colors"
                        >
                          {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                        </button>
                      </div>
                    </div>

                    {/* Remember me + Recover password */}
                    <div className="flex items-center justify-between text-xs font-bold">
                      <label className="flex items-center gap-3 text-slate-400 cursor-pointer group select-none">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={rememberMe}
                          onClick={() => setRememberMe(v => !v)}
                          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none ${
                            rememberMe ? 'bg-[#A89048]' : 'bg-white/10'
                          }`}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200 ${
                              rememberMe ? 'translate-x-[18px]' : 'translate-x-[3px]'
                            }`}
                          />
                        </button>
                        <span className="group-hover:text-slate-200 transition-colors">Lembrar acesso</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => setError('Funcionalidade em breve')}
                        className="text-[#A89048] hover:text-[#e3c788] uppercase tracking-widest transition-colors"
                      >
                        Recuperar Senha
                      </button>
                    </div>

                    {/* Submit */}
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full h-14 rounded-xl bg-gradient-to-r from-[#e3c788] via-[#d4b568] to-[#c8aa62] text-[#0A0A0A] font-black uppercase tracking-widest text-sm shadow-[0_10px_30px_rgba(168,144,72,0.2)] hover:shadow-[0_15px_40px_rgba(168,144,72,0.3)] hover:scale-[1.02] transition-all active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:scale-100"
                    >
                      {loading ? (
                        <span className="flex items-center justify-center gap-2">
                          <svg className="animate-spin h-5 w-5 text-[#0A0A0A]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          Entrando...
                        </span>
                      ) : (
                        'Acessar Plataforma'
                      )}
                    </button>
                  </form>

                  {/* DB status */}
                  <div className="flex items-center justify-center gap-2 pt-6 mt-6 border-t border-white/5">
                    <div className={`w-2.5 h-2.5 rounded-full transition-all duration-500 ${
                      dbStatus === 'online'   ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]' :
                      dbStatus === 'offline'  ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)] animate-pulse' :
                                               'bg-amber-500 animate-pulse'
                    }`} />
                    <span className="text-[11px] font-bold uppercase tracking-widest text-slate-600">
                      Banco de Dados:{' '}
                      <span className={dbStatus === 'online' ? 'text-emerald-500/80' : 'text-red-500/80'}>
                        {dbStatus === 'online' ? 'Online' : dbStatus === 'offline' ? 'Offline' : 'Verificando...'}
                      </span>
                    </span>
                  </div>

                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
