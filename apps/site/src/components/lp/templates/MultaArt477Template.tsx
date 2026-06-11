"use client";

import type { ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileCheck2,
  FileText,
  MessageCircle,
  Scale,
  ShieldCheck,
} from "lucide-react";
import { trackWhatsappClick, appendRefToWaLink } from "../LPTracker";
import {
  analysisSteps,
  appliesItems,
  calculationItems,
  conceptCards,
  documents,
  faqItems,
  heroStats,
  parentPath,
  warningItems,
  whatsappMessage,
  whatsappNumber,
} from "@/app/arapiraca/trabalhista/verbas-rescisorias/multa-art-477/content";

const whatsappHref = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(
  whatsappMessage,
)}`;

function openWhatsapp() {
  trackWhatsappClick();
  window.open(appendRefToWaLink(whatsappHref), "_blank", "noopener,noreferrer");
}

function PrimaryButton({ children }: { children: ReactNode }) {
  return (
    <button
      onClick={openWhatsapp}
      className="inline-flex h-auto w-full max-w-[calc(100vw-2rem)] items-center justify-center gap-3 rounded-lg bg-[#f59e0b] px-5 py-4 text-center text-sm font-black uppercase tracking-wide text-[#140b02] shadow-[0_18px_45px_rgba(245,158,11,0.28)] transition hover:-translate-y-0.5 hover:bg-[#fbbf24] focus:outline-none focus:ring-2 focus:ring-[#f59e0b] focus:ring-offset-2 focus:ring-offset-black sm:w-auto sm:px-7 sm:text-base"
    >
      <MessageCircle size={20} className="shrink-0" />
      <span className="leading-tight">{children}</span>
      <ArrowRight size={18} className="shrink-0" />
    </button>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#f59e0b]/35 bg-[#f59e0b]/10 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-[#fcd34d]">
      <Scale size={14} />
      {children}
    </div>
  );
}

export function MultaArt477Template() {
  return (
    <div className="min-h-screen bg-[#0c0805] text-white">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-[#0c0805]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between px-5 sm:px-8">
          <a
            href={parentPath}
            className="flex items-center gap-2 text-sm font-black text-[#d8bd79]"
          >
            <ArrowLeft size={18} />
            Verbas Rescisórias
          </a>
          <button
            onClick={openWhatsapp}
            className="inline-flex items-center gap-2 rounded-lg border border-[#f59e0b]/35 bg-[#211305] px-4 py-3 text-sm font-black text-[#fef3c7] transition hover:border-[#f59e0b] hover:bg-[#321c06]"
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
              src="/landing/multa-art-477-hero.png"
              alt="Documento de rescisão com calendário de 10 dias"
              className="h-full w-full object-cover object-center opacity-100"
            />
          </div>
          <div className="absolute inset-0 bg-linear-to-r from-black/86 via-black/50 to-black/8" />
          <div className="absolute inset-0 bg-linear-to-t from-[#0c0805]/88 via-transparent to-black/14" />

          <div className="relative z-10 mx-auto flex min-h-[calc(94svh-6rem)] w-full max-w-7xl items-center px-5 py-16 sm:px-8">
            <div className="max-w-3xl">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#f59e0b]/35 bg-black/45 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-[#fcd34d]">
                <BriefcaseBusiness size={15} />
                Multa do art. 477 em Arapiraca-AL
              </div>
              <h1 className="max-w-4xl text-[clamp(2.35rem,6vw,6.1rem)] font-black leading-[0.95] tracking-normal">
                A empresa atrasou sua rescisão?
              </h1>
              <p className="mt-7 max-w-2xl text-lg leading-relaxed text-slate-200 sm:text-xl">
                O pagamento da rescisão e a entrega dos documentos têm prazo. Se
                a empresa passou do limite, a multa do art. 477 pode ser analisada.
              </p>
              <div className="mt-9 flex flex-col gap-4 sm:flex-row">
                <PrimaryButton>Verificar atraso da rescisão</PrimaryButton>
                <a
                  href="#quando-cabe"
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/10 px-6 py-4 text-sm font-black uppercase tracking-wide text-white transition hover:border-[#f59e0b]/70 hover:bg-white/15 sm:text-base"
                >
                  Ver quando cabe
                  <ArrowRight size={18} />
                </a>
              </div>

              <div className="mt-10 grid gap-3 sm:grid-cols-3">
                {heroStats.map((item) => (
                  <div
                    key={item.value}
                    className="border-l-2 border-[#f59e0b] bg-black/42 px-4 py-3 backdrop-blur"
                  >
                    <strong className="block text-2xl text-white">
                      {item.value}
                    </strong>
                    <span className="text-sm text-slate-300">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="bg-[#130d08] py-20 sm:py-24">
          <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
            <div className="max-w-3xl">
              <SectionLabel>Entenda o prazo</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                Rescisão atrasada não é detalhe administrativo
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-slate-300">
                O atraso pode afetar saque do FGTS, seguro-desemprego, pagamento
                das verbas e a tranquilidade financeira logo depois da demissão.
              </p>
            </div>

            <div className="mt-12 grid gap-5 md:grid-cols-3">
              {conceptCards.map((item) => (
                <article
                  key={item.title}
                  className="rounded-lg border border-[#f59e0b]/18 bg-[#19110a] p-6"
                >
                  <Clock3 className="mb-5 text-[#fcd34d]" size={28} />
                  <h3 className="text-2xl font-black">{item.title}</h3>
                  <p className="mt-3 leading-relaxed text-slate-300">
                    {item.description}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="quando-cabe" className="bg-[#0c0805] py-20 sm:py-24">
          <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
            <div className="max-w-3xl">
              <SectionLabel>Quando pode caber</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                Situações que merecem análise
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-slate-300">
                O ponto principal é provar datas: quando o contrato terminou, quando
                o valor caiu e quando os documentos foram entregues.
              </p>
            </div>

            <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {appliesItems.map((item) => (
                <article
                  key={item.title}
                  className="rounded-lg border border-[#f59e0b]/18 bg-[#19110a] p-6 transition hover:border-[#f59e0b]/55"
                >
                  <FileText className="mb-5 text-[#fcd34d]" size={28} />
                  <h3 className="text-2xl font-black">{item.title}</h3>
                  <p className="mt-3 leading-relaxed text-slate-300">
                    {item.description}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#130d08] py-20 sm:py-24">
          <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 sm:px-8 lg:grid-cols-[0.85fr_1.15fr]">
            <div>
              <SectionLabel>Conferência</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                O que define se houve atraso
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-slate-300">
                A multa do art. 477 depende de prova objetiva. Datas, recibos e
                extratos bancários costumam ser o centro da análise.
              </p>
              <div className="mt-8 rounded-lg border border-[#f59e0b]/25 bg-[#211305] p-6">
                <div className="flex gap-3">
                  <CalendarDays className="mt-1 shrink-0 text-[#fcd34d]" />
                  <p className="leading-relaxed text-slate-200">
                    O prazo geral é de até 10 dias contados do término do contrato
                    para pagamento e entrega dos documentos rescisórios.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {calculationItems.map((item) => (
                <div
                  key={item}
                  className="flex items-start gap-3 rounded-lg border border-white/10 bg-[#19110a] p-4"
                >
                  <CheckCircle2
                    size={19}
                    className="mt-0.5 shrink-0 text-[#f59e0b]"
                  />
                  <span className="font-semibold leading-relaxed text-slate-200">
                    {item}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#0c0805] py-20 sm:py-24">
          <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 sm:px-8 lg:grid-cols-[0.85fr_1.15fr]">
            <div>
              <SectionLabel>Alertas</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                Sinais de que a rescisão precisa ser revisada
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-slate-300">
                Atraso, parcelamento e documentos incompletos costumam aparecer
                juntos. O ideal é conferir tudo antes de aceitar a explicação da
                empresa.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {warningItems.map((item) => (
                <div
                  key={item}
                  className="flex items-start gap-3 rounded-lg border border-white/10 bg-[#19110a] p-4"
                >
                  <AlertTriangle
                    size={19}
                    className="mt-0.5 shrink-0 text-[#fcd34d]"
                  />
                  <span className="font-semibold leading-relaxed text-slate-200">
                    {item}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#130d08] py-20 sm:py-24">
          <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
            <div className="max-w-3xl">
              <SectionLabel>Como funciona</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                Análise da multa do art. 477
              </h2>
            </div>
            <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              {analysisSteps.map((step, index) => (
                <div
                  key={step.title}
                  className="rounded-lg border border-[#f59e0b]/18 bg-[#19110a] p-6"
                >
                  <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-[#f59e0b]/12 text-lg font-black text-[#fcd34d]">
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

        <section className="bg-[#0c0805] py-20 sm:py-24">
          <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 sm:px-8 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <SectionLabel>Documentos</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                O que separar para provar o atraso
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-slate-300">
                O melhor caminho é montar uma linha do tempo com término do
                contrato, pagamento, documentos e mensagens da empresa.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {documents.map((item) => (
                <div
                  key={item}
                  className="flex min-h-16 items-center gap-3 rounded-lg border border-white/10 bg-[#19110a] px-4 py-4"
                >
                  <FileCheck2 size={19} className="shrink-0 text-[#f59e0b]" />
                  <span className="font-semibold text-slate-200">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#130d08] py-20 sm:py-24">
          <div className="mx-auto w-full max-w-5xl px-5 sm:px-8">
            <div className="text-center">
              <SectionLabel>Dúvidas frequentes</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                Perguntas sobre multa do art. 477
              </h2>
            </div>
            <div className="mt-10 divide-y divide-white/10 rounded-lg border border-white/10 bg-[#19110a]">
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

        <section className="bg-[#0c0805] py-20 sm:py-28">
          <div className="mx-auto w-full max-w-5xl px-5 text-center sm:px-8">
            <ShieldCheck className="mx-auto mb-6 text-[#fcd34d]" size={44} />
            <h2 className="text-[clamp(2.2rem,5vw,4.6rem)] font-black leading-tight">
              Sua rescisão passou do prazo de 10 dias?
            </h2>
            <p className="mx-auto mt-6 max-w-3xl text-lg leading-relaxed text-slate-300">
              Envie o TRCT, comprovante de pagamento e mensagens da empresa para
              conferir se a multa do art. 477 pode ser cobrada.
            </p>
            <div className="mt-9">
              <PrimaryButton>Analisar atraso da rescisão</PrimaryButton>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 bg-[#0c0805] py-10">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-5 text-sm text-slate-400 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
          <p>André Lustosa Advogados - Direito Trabalhista em Arapiraca-AL</p>
          <a
            href={parentPath}
            className="font-bold text-[#fcd34d] hover:text-white"
          >
            Voltar para Verbas Rescisórias
          </a>
        </div>
      </footer>

      <button
        onClick={openWhatsapp}
        className="fixed bottom-5 right-5 z-50 flex h-16 w-16 items-center justify-center rounded-full bg-[#f59e0b] text-[#140b02] shadow-[0_14px_40px_rgba(245,158,11,0.38)] transition hover:scale-105"
        aria-label="Falar pelo WhatsApp"
      >
        <MessageCircle size={30} />
      </button>
    </div>
  );
}
