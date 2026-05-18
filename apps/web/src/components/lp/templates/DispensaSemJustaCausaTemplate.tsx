"use client";

import type { ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  Calculator,
  FileCheck2,
  MessageCircle,
  Scale,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { trackWhatsappClick } from "../LPTracker";
import {
  analysisSteps,
  documents,
  faqItems,
  heroStats,
  mainRights,
  parentPath,
  warningItems,
  whatsappMessage,
  whatsappNumber,
} from "@/app/arapiraca/trabalhista/verbas-rescisorias/dispensa-sem-justa-causa/content";

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

export function DispensaSemJustaCausaTemplate() {
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
              src="/landing/verbas-rescisorias-hero.png"
              alt="Carteira de trabalho e documentos para dispensa sem justa causa"
              className="h-full w-full object-cover object-center opacity-85"
            />
          </div>
          <div className="absolute inset-0 bg-linear-to-r from-black via-black/85 to-black/45" />
          <div className="absolute inset-0 bg-linear-to-t from-[#080808] via-transparent to-black/40" />

          <div className="relative z-10 mx-auto flex min-h-[calc(94svh-6rem)] w-full max-w-7xl items-center px-5 py-16 sm:px-8">
            <div className="max-w-3xl">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#b8944d]/40 bg-black/45 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-[#d8bd79]">
                <BriefcaseBusiness size={15} />
                Dispensa sem justa causa em Arapiraca-AL
              </div>
              <h1 className="max-w-4xl text-[clamp(2.4rem,6vw,6.2rem)] font-black leading-[0.95] tracking-normal">
                Foi demitido sem justa causa?
              </h1>
              <p className="mt-7 max-w-2xl text-lg leading-relaxed text-slate-200 sm:text-xl">
                Confira se sua rescisão inclui aviso-prévio, férias, 13º,
                FGTS, multa de 40% e guias corretas antes de aceitar o valor
                como definitivo.
              </p>
              <div className="mt-9 flex flex-col gap-4 sm:flex-row">
                <PrimaryButton>Analisar minha demissão</PrimaryButton>
                <a
                  href="#direitos"
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/10 px-6 py-4 text-sm font-black uppercase tracking-wide text-white transition hover:border-[#d8bd79]/70 hover:bg-white/15 sm:text-base"
                >
                  Ver direitos
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
          <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <div>
              <SectionLabel>Entenda a modalidade</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                O que é dispensa sem justa causa?
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-slate-300">
                É quando a empresa encerra o contrato sem apontar falta grave
                do trabalhador. Nessa situação, a rescisão costuma ser mais
                completa, mas precisa ser conferida com documentos para evitar
                pagamento menor do que o devido.
              </p>
              <div className="mt-8 rounded-lg border border-[#b8944d]/25 bg-[#171717] p-5">
                <div className="flex gap-3">
                  <AlertTriangle className="mt-1 shrink-0 text-[#d8bd79]" />
                  <p className="leading-relaxed text-slate-200">
                    O valor total do TRCT não basta. É preciso conferir base de
                    cálculo, médias variáveis, depósitos de FGTS e prazo de
                    pagamento.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-[#22c55e]/25 bg-[#0d1a12] p-7 sm:p-9">
              <Calculator className="mb-5 text-[#22c55e]" size={34} />
              <h3 className="text-2xl font-black">Quando vale pedir análise?</h3>
              <p className="mt-4 leading-relaxed text-slate-200">
                Quando houve atraso no pagamento, FGTS faltando, aviso-prévio
                estranho, descontos altos, ausência de guias ou qualquer dúvida
                sobre o cálculo.
              </p>
              <div className="mt-7">
                <PrimaryButton>Conferir minha rescisão</PrimaryButton>
              </div>
            </div>
          </div>
        </section>

        <section id="direitos" className="bg-[#080808] py-20 sm:py-24">
          <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
            <div className="max-w-3xl">
              <SectionLabel>Direitos principais</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                O que normalmente entra na rescisão
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-slate-300">
                A dispensa sem justa causa exige uma conferência completa das
                verbas pagas e dos documentos entregues pela empresa.
              </p>
            </div>

            <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {mainRights.map((right) => (
                <article
                  key={right.title}
                  className="rounded-lg border border-[#b8944d]/20 bg-[#141414] p-6 transition hover:border-[#d8bd79]/60"
                >
                  <WalletCards className="mb-5 text-[#d8bd79]" size={28} />
                  <h3 className="text-2xl font-black">{right.title}</h3>
                  <p className="mt-3 leading-relaxed text-slate-300">
                    {right.description}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#101010] py-20 sm:py-24">
          <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 sm:px-8 lg:grid-cols-[0.85fr_1.15fr]">
            <div>
              <SectionLabel>Erros comuns</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                Sinais de que a rescisão pode estar errada
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-slate-300">
                Algumas diferenças não aparecem de forma óbvia. O erro pode
                estar em médias, FGTS, multa, aviso-prévio ou descontos.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {warningItems.map((item) => (
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

        <section className="bg-[#080808] py-20 sm:py-24">
          <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
            <div className="max-w-3xl">
              <SectionLabel>Como funciona</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                Análise jurídica da demissão
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

        <section className="bg-[#101010] py-20 sm:py-24">
          <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 sm:px-8 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <SectionLabel>Documentos</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                O que separar para conferir
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-slate-300">
                Não precisa ter tudo para começar. Mas esses documentos tornam
                o cálculo mais preciso e ajudam a identificar diferenças.
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

        <section className="bg-[#080808] py-20 sm:py-24">
          <div className="mx-auto w-full max-w-5xl px-5 sm:px-8">
            <div className="text-center">
              <SectionLabel>Dúvidas frequentes</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                Perguntas sobre dispensa sem justa causa
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

        <section className="bg-[#101010] py-20 sm:py-28">
          <div className="mx-auto w-full max-w-5xl px-5 text-center sm:px-8">
            <ShieldCheck className="mx-auto mb-6 text-[#d8bd79]" size={44} />
            <h2 className="text-[clamp(2.2rem,5vw,4.6rem)] font-black leading-tight">
              Quer saber se recebeu tudo corretamente?
            </h2>
            <p className="mx-auto mt-6 max-w-3xl text-lg leading-relaxed text-slate-300">
              Envie seus documentos para uma análise da dispensa sem justa
              causa. A conferência mostra o que foi pago, o que pode estar
              faltando e quais próximos passos fazem sentido.
            </p>
            <div className="mt-9">
              <PrimaryButton>Enviar documentos para análise</PrimaryButton>
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
