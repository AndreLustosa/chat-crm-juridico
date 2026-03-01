'use client';

import { useState, FormEvent, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, Lock, ArrowRight, Scale } from 'lucide-react';
import api from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [dbStatus, setDbStatus] = useState<'online' | 'offline' | 'checking'>('checking');

  // Carregar email salvo se existir
  useEffect(() => {
    const savedEmail = localStorage.getItem('remembered_email');
    if (savedEmail) {
      setEmail(savedEmail);
      setRememberMe(true);
    }
  }, []);

  useEffect(() => {
    const checkDb = async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005'}/health/db`);
        const data = await res.json();
        setDbStatus(data.status === 'ok' ? 'online' : 'offline');
      } catch (error) {
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

      router.push('/');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Credenciais inválidas');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-black font-sans antialiased text-[#f0f0f5]">
      <div 
        className="w-full max-w-[420px] rounded-2xl bg-[#111111]/80 backdrop-blur-[20px] border border-white/10"
        style={{ 
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          padding: '48px 40px'
        }}
      >
        <div className="flex flex-col items-center mb-10">
          <div 
            className="w-12 h-12 rounded-xl flex items-center justify-center mb-6"
            style={{ 
              background: 'linear-gradient(135deg, #a1773d 0%, #eae2a1 100%)', 
              border: '1px solid rgba(255, 255, 255, 0.06)',
              color: '#000000',
              boxShadow: '0 0 20px rgba(161, 119, 61, 0.3)'
            }}
          >
            <Scale size={28} strokeWidth={1.5} />
          </div>
          
          <h1 
            className="text-white font-bold" 
            style={{ letterSpacing: '-0.02em', fontSize: '28px' }}
          >
            ANDRÉ LUSTOSA
          </h1>
          <p 
            style={{ 
              letterSpacing: '0.2em', 
              textTransform: 'uppercase', 
              fontSize: '11px',
              color: '#a1773d',
              fontWeight: 600,
              marginTop: '4px'
            }}
          >
            — Advogados —
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col">
          <div className="mb-5 text-left">
            <label 
              htmlFor="email" 
              className="block mb-2 font-medium"
              style={{ fontSize: '13px', color: '#dcdcdc' }}
            >
              Email Corporativo
            </label>
            <div className="relative">
              <Mail 
                size={18} 
                color="#888888" 
                className="absolute left-[14px] top-[13px]" 
              />
              <input
                id="email"
                name="email"
                type="email"
                required
                className="w-full rounded-xl border bg-[#1a1a1a] text-white outline-none transition-all"
                style={{ 
                  paddingLeft: '42px', 
                  paddingRight: '14px',
                  height: '44px',
                  fontSize: '14px',
                  borderColor: 'rgba(255, 255, 255, 0.1)',
                }}
                placeholder="nome@andrelustosa.adv.br"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={(e) => {
                  e.target.style.borderColor = '#a1773d';
                  e.target.style.boxShadow = '0 0 0 3px rgba(161, 119, 61, 0.15)';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                  e.target.style.boxShadow = 'none';
                }}
              />
            </div>
          </div>

          <div className="mb-7 text-left">
            <label 
              htmlFor="password" 
              className="block mb-2 font-medium"
              style={{ fontSize: '13px', color: '#dcdcdc' }}
            >
              Senha
            </label>
            <div className="relative">
              <Lock 
                size={18} 
                color="#888888" 
                className="absolute left-[14px] top-[13px]" 
              />
              <input
                id="password"
                name="password"
                type="password"
                required
                className="w-full rounded-xl border bg-[#1a1a1a] text-white outline-none transition-all"
                style={{ 
                  paddingLeft: '42px', 
                  paddingRight: '14px',
                  height: '44px',
                  fontSize: '14px',
                  borderColor: 'rgba(255, 255, 255, 0.1)',
                }}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={(e) => {
                  e.target.style.borderColor = '#a1773d';
                  e.target.style.boxShadow = '0 0 0 3px rgba(161, 119, 61, 0.15)';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                  e.target.style.boxShadow = 'none';
                }}
              />
            </div>
          </div>

          <div className="flex items-center justify-between mb-6">
            <label className="flex items-center cursor-pointer group">
              <div className="relative">
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                />
                <div className={`w-5 h-5 rounded-md border transition-all flex items-center justify-center ${
                  rememberMe 
                    ? 'bg-[#a1773d] border-[#a1773d]' 
                    : 'bg-[#1a1a1a] border-white/10 group-hover:border-[#a1773d]/50'
                }`}>
                  {rememberMe && (
                    <svg className="w-3.5 h-3.5 text-black font-bold" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path>
                    </svg>
                  )}
                </div>
              </div>
              <span className="ml-2.5 text-[13px] text-[#dcdcdc] font-medium select-none">Lembrar-me</span>
            </label>
            
            <button 
              type="button"
              className="text-[12px] text-[#a1773d] hover:text-[#eae2a1] font-medium transition-colors"
              onClick={() => setError('Funcionalidade em breve')}
            >
              Esqueceu a senha?
            </button>
          </div>

          {error && (
            <div className="space-y-3 mb-4">
              <p className="text-center rounded-lg bg-red-500/10 p-3 text-[13px] font-medium text-red-500 border border-red-500/20">
                {error}
              </p>
              <button
                type="button"
                onClick={() => {
                  localStorage.setItem('token', 'mock-dev-token');
                  router.push('/');
                }}
                className="w-full py-2 text-[12px] font-bold text-primary/80 hover:text-primary transition-colors underline decoration-primary/30"
              >
                Entrar em Modo de Demonstração (Bypass)
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="group relative flex items-center justify-center font-semibold text-black transition-all disabled:opacity-70 disabled:cursor-not-allowed cursor-pointer mb-6"
            style={{ 
              width: '100%', 
              height: '48px',
              fontSize: '15px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #a1773d 0%, #eae2a1 100%)',
              boxShadow: '0 0 20px rgba(161, 119, 61, 0.3)',
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 0 30px rgba(161, 119, 61, 0.5)';
              }
            }}
            onMouseLeave={(e) => {
              if (!loading) {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 0 20px rgba(161, 119, 61, 0.3)';
              }
            }}
          >
            {loading ? (
              <svg className="animate-spin h-5 w-5 text-black" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : (
              <>
                Acessar Painel
                <ArrowRight size={18} className="ml-1.5 transition-transform group-hover:translate-x-1" />
              </>
            )}
          </button>

          <div className="flex items-center justify-center gap-2 pt-2 border-t border-white/5 mt-2">
            <div className={`w-2.5 h-2.5 rounded-full transition-all duration-500 ${
              dbStatus === 'online' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]' : 
              dbStatus === 'offline' ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)] animate-pulse' : 
              'bg-amber-500 animate-pulse'
            }`} />
            <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/60">
              Banco de Dados: <span className={dbStatus === 'online' ? 'text-emerald-500/80' : 'text-red-500/80'}>
                {dbStatus === 'online' ? 'Online' : dbStatus === 'offline' ? 'Offline' : 'Verificando...'}
              </span>
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}
