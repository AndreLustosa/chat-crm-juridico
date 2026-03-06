'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Shield, Clock, CheckCircle2, ChevronRight, Scale, FileText, Briefcase, Lock } from 'lucide-react';
import FichaTrabalhista from '@/components/FichaTrabalhista';

const STEPS = [
  { icon: FileText, label: 'Dados Pessoais', desc: 'Nome, CPF, contato e endereço' },
  { icon: Briefcase, label: 'Dados do Emprego', desc: 'Empresa, função, contrato e jornada' },
  { icon: Scale, label: 'Direitos e Verbas', desc: 'FGTS, férias, horas extras e benefícios' },
  { icon: Shield, label: 'Provas e Resumo', desc: 'Testemunhas, documentos e seu relato' },
];

export default function FormularioTrabalhistaPage() {
  const params = useParams();
  const router = useRouter();
  const leadId = params?.leadId as string;
  const [started, setStarted] = useState(false);

  if (!leadId) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-4">
            <Scale size={28} className="text-red-400" />
          </div>
          <p className="text-zinc-400 text-sm">Link inválido ou expirado.</p>
          <p className="text-zinc-600 text-xs mt-1">Entre em contato com o escritório.</p>
        </div>
      </div>
    );
  }

  /* ─── Welcome screen ─────────────────────────────────────────── */
  if (!started) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col">
        {/* Gradient background */}
        <div className="absolute inset-0 bg-gradient-to-br from-amber-950/30 via-zinc-950 to-zinc-950 pointer-events-none" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />

        {/* Header */}
        <header className="relative z-10 border-b border-white/5 bg-zinc-950/80 backdrop-blur-md">
          <div className="max-w-2xl mx-auto px-5 py-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/20 flex items-center justify-center shrink-0">
              <span className="text-amber-400 text-sm font-black">AL</span>
            </div>
            <div>
              <p className="text-white text-sm font-bold leading-tight">André Lustosa Advogados</p>
              <p className="text-zinc-500 text-[10px] uppercase tracking-widest">Advocacia Trabalhista</p>
            </div>
          </div>
        </header>

        {/* Main content */}
        <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-5 py-10">
          <div className="w-full max-w-xl">

            {/* Hero */}
            <div className="text-center mb-8">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px] font-bold uppercase tracking-widest mb-5">
                <Scale size={12} />
                Atendimento Digital
              </div>

              <h1 className="text-3xl sm:text-4xl font-black text-white leading-tight mb-3">
                Ficha{' '}
                <span className="text-amber-400">Trabalhista</span>{' '}
                Digital
              </h1>

              <p className="text-zinc-400 text-[15px] leading-relaxed max-w-sm mx-auto">
                Preencha as informações do seu caso para que nosso advogado possa analisar e preparar o melhor atendimento para você.
              </p>
            </div>

            {/* Info pills */}
            <div className="flex items-center justify-center gap-3 flex-wrap mb-8">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-800/80 border border-zinc-700/50 text-zinc-300 text-[12px]">
                <Clock size={12} className="text-amber-400" />
                ~10 minutos
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-800/80 border border-zinc-700/50 text-zinc-300 text-[12px]">
                <Shield size={12} className="text-emerald-400" />
                100% seguro
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-800/80 border border-zinc-700/50 text-zinc-300 text-[12px]">
                <CheckCircle2 size={12} className="text-blue-400" />
                Auto-salvo
              </div>
            </div>

            {/* Steps */}
            <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-2xl p-5 mb-6">
              <p className="text-zinc-500 text-[11px] uppercase tracking-widest font-bold mb-4">O que você vai preencher</p>
              <div className="flex flex-col gap-3">
                {STEPS.map((step, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/15 flex items-center justify-center shrink-0 mt-0.5">
                      <step.icon size={13} className="text-amber-400" />
                    </div>
                    <div>
                      <p className="text-zinc-200 text-[13px] font-semibold leading-tight">{step.label}</p>
                      <p className="text-zinc-500 text-[11px] mt-0.5">{step.desc}</p>
                    </div>
                    <div className="ml-auto">
                      <span className="text-zinc-600 text-[10px] font-bold bg-zinc-800 px-1.5 py-0.5 rounded-full">
                        {i + 1}/{STEPS.length}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* CTA */}
            <button
              onClick={() => {
                setStarted(true);
                setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 50);
              }}
              className="w-full py-4 rounded-2xl font-black text-[15px] text-zinc-950 bg-amber-400 hover:bg-amber-300 active:scale-[0.98] transition-all shadow-[0_0_30px_rgba(251,191,36,0.25)] flex items-center justify-center gap-2"
            >
              INICIAR PREENCHIMENTO
              <ChevronRight size={18} />
            </button>

            {/* Privacy notice */}
            <div className="flex items-start gap-2 mt-5 px-2">
              <Lock size={12} className="text-zinc-500 shrink-0 mt-0.5" />
              <p className="text-zinc-500 text-[11px] leading-relaxed">
                Seus dados são protegidos e utilizados exclusivamente para análise do seu caso trabalhista. Não compartilhamos suas informações com terceiros.
              </p>
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="relative z-10 border-t border-white/5 py-4">
          <p className="text-center text-zinc-600 text-[11px]">
            © {new Date().getFullYear()} André Lustosa Advogados — Todos os direitos reservados
          </p>
        </footer>
      </div>
    );
  }

  /* ─── Form screen ────────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Header */}
      <header className="border-b border-white/5 bg-zinc-950/90 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3.5 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/20 flex items-center justify-center shrink-0">
            <span className="text-amber-400 text-xs font-black">AL</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-[13px] font-bold leading-tight truncate">
              André Lustosa Advogados
            </p>
            <p className="text-zinc-500 text-[10px] uppercase tracking-widest">Ficha Trabalhista</p>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold shrink-0">
            <Shield size={10} />
            Seguro
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-5">
          <h2 className="text-lg sm:text-xl font-black text-white mb-1.5">
            Informações do Caso
          </h2>
          <p className="text-zinc-400 text-[13px] leading-relaxed">
            Preencha os campos abaixo. As informações são salvas automaticamente.
            Campos marcados com <span className="text-red-400 font-bold">*</span> são obrigatórios.
          </p>
        </div>

        <FichaTrabalhista
          leadId={leadId}
          isPublic={true}
          onFinalize={() => router.push('/formulario/trabalhista/sucesso')}
        />
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 py-5 mt-8">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 text-center">
          <p className="text-zinc-600 text-[11px]">
            Suas informações são protegidas e utilizadas exclusivamente para análise do seu caso.
            © {new Date().getFullYear()} André Lustosa Advogados
          </p>
        </div>
      </footer>
    </div>
  );
}
