"use client";

import type { ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgePercent,
  BriefcaseBusiness,
  Calculator,
  FileCheck2,
  Handshake,
  MessageCircle,
  Scale,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { trackWhatsappClick } from "../LPTracker";
import {
  agreementRules,
  analysisSteps,
  conceptCards,
  documents,
  faqItems,
  fullRights,
  heroStats,
  parentPath,
  risks,
  whatsappMessage,
  whatsappNumber,
} from "@/app/arapiraca/trabalhista/verbas-rescisorias/rescisao-por-acordo/content";

const whatsappHref = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(
  whatsappMessage,
)}`;

function openWhatsapp() {
  trackWhatsappClick();
  window.open(whatsappHref, "_blank", "noopener,noreferrer");
}

function PrimaryButton({ children }: { children: ReactNode }) {
  return (
    <button
      onClick={openWhatsapp}
      className="inline-flex h-auto w-full max-w-[calc(100vw-2rem)] items-center justify-center gap-3 rounded-lg bg-[#22c55e] px-5 py-4 text-center text-sm font-black uppercase tracking-wide text-[#07110b] shadow-[0_18px_45px_rgba(34,197,94,0.28)] transition hover:-translate-y-0.5 hover:bg-[#2ee66d] focus:outline-none focus:ring-2 focus:ring-[#22c55e] focus:ring-offset-2 focus:ring-offset-black sm:w-auto sm:px-7 sm:text-base"
    >
      <MessageCircle size={20} className="shrink-0" />
      <span className="leading-tight">{children}</span>
      <ArrowRight size={18} className="shrink-0" />
    </button>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#b8944d]/40 bg-[#b8944d]/10 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-[#d8bd79]">
      <Scale size={14} />
      {children}
    </div>
  );
}

export function RescisaoPorAcordoTemplate() {
  return (
    <div className="min-h-screen bg-[#080808] text-white">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-[#080808]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between px-5 sm:px-8">
          <a href={parentPath} className="flex items-center gap-2 text-sm font-black text-[#d8bd79]">
            <ArrowLeft size={18} />
            Verbas Rescisórias
          </a>
          <button
            onClick={openWhatsapp}
            className="inline-flex items-center gap-2 rounded-lg border border-[#b8944d]/40 bg-[#1b1308] px-4 py-3 text-sm font-black text-[#f6e3aa] transition hover:border-[#d8bd79] hover:bg-[#2a1c0a]"
          >
            <MessageCircle size={18} />
            WhatsApp
          </button>
        </div>
      </header>

      <main>
        <section className="relative min-h-[94svh] overflow-hidden pt-24">
          <div className="absolute inset-0">
            <img
              src="/landing/rescisao-por-acordo-hero.webp"
              srcSet="/landing/rescisao-por-acordo-hero-mobile.webp 800w, /landing/rescisao-por-acordo-hero.webp 1600w"
              sizes="100vw"
              alt="Trabalhador negociando rescisão por acordo com documentos e carteira de trabalho"
              className="h-full w-full object-cover object-center opacity-85"
              loading="eager"
              fetchPriority="high"
              decoding="async"
            />
          </div>
          <div className="absolute inset-0 bg-linear-to-r from-black via-black/86 to-black/34" />
          <div className="absolute inset-0 bg-linear-to-t from-[#080808] via-transparent to-black/40" />

          <div className="relative z-10 mx-auto flex min-h-[calc(94svh-6rem)] w-full max-w-7xl items-center px-5 py-16 sm:px-8">
            <div className="max-w-3xl">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#b8944d]/40 bg-black/45 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-[#d8bd79]">
                <BriefcaseBusiness size={15} />
                Rescisão por acordo em Arapiraca-AL
              </div>
              <h1 className="max-w-4xl text-[clamp(2.35rem,6vw,6.1rem)] font-black leading-[0.95] tracking-normal">
                A empresa propôs acordo para sair?
              </h1>
              <p className="mt-7 max-w-2xl text-lg leading-relaxed text-slate-200 sm:text-xl">
                Entenda quanto você recebe, o que muda no FGTS e por que o
                seguro-desemprego fica fora antes de assinar qualquer documento.
              </p>
              <div className="mt-9 flex flex-col gap-4 sm:flex-row">
                <PrimaryButton>Analisar proposta de acordo</PrimaryButton>
                <a
                  href="#regras"
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/10 px-6 py-4 text-sm font-black uppercase tracking-wide text-white transition hover:border-[#d8bd79]/70 hover:bg-white/15 sm:text-base"
                >
                  Ver regras do acordo
                  <ArrowRight size={18} />
                </a>
              </div>

              <div className="mt-10 grid gap-3 sm:grid-cols-3">
                {heroStats.map((item) => (
                  <div
                    key={item.value}
                    className="border-l-2 border-[#d8bd79] bg-black/40 px-4 py-3 backdrop-blur"
                  >
                    <strong className="block text-2xl text-white">{item.value}</strong>
                    <span className="text-sm text-slate-300">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="bg-[#101010] py-20 sm:py-24">
          <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
            <div className="max-w-3xl">
              <SectionLabel>Entenda a modalidade</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                Acordo trabalhista exige decisão consciente
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-slate-300">
                A rescisão por acordo pode ser útil quando trabalhador e empresa
                querem encerrar o contrato. Mas ela reduz parte dos direitos e
                precisa ser comparada com outras modalidades antes da assinatura.
              </p>
            </div>

            <div className="mt-12 grid gap-5 md:grid-cols-3">
              {conceptCards.map((item) => (
                <article
                  key={item.title}
                  className="rounded-lg border border-[#b8944d]/20 bg-[#141414] p-6"
                >
                  <Handshake className="mb-5 text-[#d8bd79]" size={28} />
                  <h3 className="text-2xl font-black">{item.title}</h3>
                  <p className="mt-3 leading-relaxed text-slate-300">
                    {item.description}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="regras" className="bg-[#080808] py-20 sm:py-24">
          <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
            <div className="max-w-3xl">
              <SectionLabel>Regras do acordo</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                O que muda na rescisão por acordo
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-slate-300">
                O acordo tem uma lógica própria: ele preserva algumas verbas,
                reduz outras e elimina o direito ao seguro-desemprego.
              </p>
            </div>

            <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {agreementRules.map((item) => (
                <article
                  key={item.title}
                  className="rounded-lg border border-[#b8944d]/20 bg-[#141414] p-6 transition hover:border-[#d8bd79]/60"
                >
                  <BadgePercent className="mb-5 text-[#d8bd79]" size={28} />
                  <h3 className="text-2xl font-black">{item.title}</h3>
                  <p className="mt-3 leading-relaxed text-slate-300">
                    {item.description}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#101010] py-20 sm:py-24">
          <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 sm:px-8 lg:grid-cols-[0.85fr_1.15fr]">
            <div>
              <SectionLabel>Verbas que continuam</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                O que deve ser conferido integralmente
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-slate-300">
                Mesmo no acordo, várias parcelas precisam ser calculadas de forma
                completa. O erro costuma aparecer nas médias, férias, 13º, FGTS
                e descontos.
              </p>
              <div className="mt-8 rounded-lg border border-[#22c55e]/25 bg-[#0d1a12] p-6">
                <div className="flex gap-3">
                  <Calculator className="mt-1 shrink-0 text-[#22c55e]" />
                  <p className="leading-relaxed text-slate-200">
                    A melhor decisão nasce da comparação: quanto receberia no
                    acordo, no pedido de demissão, na dispensa sem justa causa ou
                    em eventual rescisão indireta.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {fullRights.map((item) => (
                <div
                  key={item}
                  className="flex items-start gap-3 rounded-lg border border-white/10 bg-[#181818] p-4"
                >
                  <WalletCards size={19} className="mt-0.5 shrink-0 text-[#22c55e]" />
                  <span className="font-semibold leading-relaxed text-slate-200">
                    {item}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#080808] py-20 sm:py-24">
          <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 sm:px-8 lg:grid-cols-[0.85fr_1.15fr]">
            <div>
              <SectionLabel>Antes de assinar</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                Quando o acordo merece atenção
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-slate-300">
                O acordo deve ser livre e documentado. Se existe pressão,
                promessa informal ou valor fora do termo, o risco aumenta.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {risks.map((item) => (
                <div
                  key={item}
                  className="flex items-start gap-3 rounded-lg border border-white/10 bg-[#181818] p-4"
                >
                  <AlertTriangle size={19} className="mt-0.5 shrink-0 text-[#d8bd79]" />
                  <span className="font-semibold leading-relaxed text-slate-200">
                    {item}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#101010] py-20 sm:py-24">
          <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
            <div className="max-w-3xl">
              <SectionLabel>Como funciona</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                Análise da proposta de acordo
              </h2>
            </div>
            <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              {analysisSteps.map((step, index) => (
                <div
                  key={step.title}
                  className="rounded-lg border border-[#b8944d]/20 bg-[#141414] p-6"
                >
                  <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-[#b8944d]/12 text-lg font-black text-[#d8bd79]">
                    {index + 1}
                  </div>
                  <h3 className="text-xl font-black">{step.title}</h3>
                  <p className="mt-3 leading-relaxed text-slate-300">
                    {step.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#080808] py-20 sm:py-24">
          <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 sm:px-8 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <SectionLabel>Documentos</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                O que separar para conferir o acordo
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-slate-300">
                O ideal é analisar a proposta antes da assinatura. Se já assinou,
                os documentos ajudam a verificar se o pagamento foi correto.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {documents.map((item) => (
                <div
                  key={item}
                  className="flex min-h-16 items-center gap-3 rounded-lg border border-white/10 bg-[#181818] px-4 py-4"
                >
                  <FileCheck2 size={19} className="shrink-0 text-[#22c55e]" />
                  <span className="font-semibold text-slate-200">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#101010] py-20 sm:py-24">
          <div className="mx-auto w-full max-w-5xl px-5 sm:px-8">
            <div className="text-center">
              <SectionLabel>Dúvidas frequentes</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                Perguntas sobre rescisão por acordo
              </h2>
            </div>
            <div className="mt-10 divide-y divide-white/10 rounded-lg border border-white/10 bg-[#141414]">
              {faqItems.map((item) => (
                <div key={item.question} className="p-5 sm:p-6">
                  <h3 className="font-black text-white">{item.question}</h3>
                  <p className="mt-2 leading-relaxed text-slate-300">
                    {item.answer}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#080808] py-20 sm:py-28">
          <div className="mx-auto w-full max-w-5xl px-5 text-center sm:px-8">
            <ShieldCheck className="mx-auto mb-6 text-[#d8bd79]" size={44} />
            <h2 className="text-[clamp(2.2rem,5vw,4.6rem)] font-black leading-tight">
              Antes de aceitar o acordo, confira o impacto no seu bolso.
            </h2>
            <p className="mx-auto mt-6 max-w-3xl text-lg leading-relaxed text-slate-300">
              Envie a proposta, TRCT e extrato do FGTS para uma análise. A ideia é
              entender se o acordo compensa, se o cálculo está correto e se existe
              algum risco antes da assinatura.
            </p>
            <div className="mt-9">
              <PrimaryButton>Conferir acordo trabalhista</PrimaryButton>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 bg-[#080808] py-10">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-5 text-sm text-slate-400 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
          <p>André Lustosa Advogados - Direito Trabalhista em Arapiraca-AL</p>
          <a href={parentPath} className="font-bold text-[#d8bd79] hover:text-white">
            Voltar para Verbas Rescisórias
          </a>
        </div>
      </footer>

      <button
        onClick={openWhatsapp}
        className="fixed bottom-5 right-5 z-50 flex h-16 w-16 items-center justify-center rounded-full bg-[#22c55e] text-[#07110b] shadow-[0_14px_40px_rgba(34,197,94,0.38)] transition hover:scale-105"
        aria-label="Falar pelo WhatsApp"
      >
        <MessageCircle size={30} />
      </button>
    </div>
  );
}
