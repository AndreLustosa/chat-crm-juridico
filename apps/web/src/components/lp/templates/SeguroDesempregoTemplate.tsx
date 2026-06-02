"use client";

import type { ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  FileCheck2,
  FileText,
  Landmark,
  MessageCircle,
  Scale,
  ShieldCheck,
  Smartphone,
  WalletCards,
} from "lucide-react";
import { trackWhatsappClick } from "../LPTracker";
import {
  analysisSteps,
  calculationItems,
  conceptCards,
  documents,
  eligibilityItems,
  faqItems,
  heroStats,
  parentPath,
  warningItems,
  whatsappMessage,
  whatsappNumber,
} from "@/app/arapiraca/trabalhista/verbas-rescisorias/seguro-desemprego/content";

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
      className="inline-flex h-auto w-full max-w-[calc(100vw-2rem)] items-center justify-center gap-3 rounded-lg bg-[#38bdf8] px-5 py-4 text-center text-sm font-black uppercase tracking-wide text-[#031018] shadow-[0_18px_45px_rgba(56,189,248,0.28)] transition hover:-translate-y-0.5 hover:bg-[#7dd3fc] focus:outline-none focus:ring-2 focus:ring-[#38bdf8] focus:ring-offset-2 focus:ring-offset-black sm:w-auto sm:px-7 sm:text-base"
    >
      <MessageCircle size={20} className="shrink-0" />
      <span className="leading-tight">{children}</span>
      <ArrowRight size={18} className="shrink-0" />
    </button>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#38bdf8]/35 bg-[#38bdf8]/10 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-[#7dd3fc]">
      <Scale size={14} />
      {children}
    </div>
  );
}

export function SeguroDesempregoTemplate() {
  return (
    <div className="min-h-screen bg-[#070a12] text-white">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-[#070a12]/90 backdrop-blur-xl">
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
            className="inline-flex items-center gap-2 rounded-lg border border-[#38bdf8]/35 bg-[#0b1b27] px-4 py-3 text-sm font-black text-[#e0f2fe] transition hover:border-[#38bdf8] hover:bg-[#10283a]"
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
              src="/landing/seguro-desemprego-hero.png"
              alt="Documentos para pedido de seguro-desemprego"
              className="h-full w-full object-cover object-center opacity-100"
            />
          </div>
          <div className="absolute inset-0 bg-linear-to-r from-black/86 via-black/50 to-black/8" />
          <div className="absolute inset-0 bg-linear-to-t from-[#070a12]/88 via-transparent to-black/14" />

          <div className="relative z-10 mx-auto flex min-h-[calc(94svh-6rem)] w-full max-w-7xl items-center px-5 py-16 sm:px-8">
            <div className="max-w-3xl">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#38bdf8]/35 bg-black/45 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-[#7dd3fc]">
                <Landmark size={15} />
                Seguro-desemprego em Arapiraca-AL
              </div>
              <h1 className="max-w-4xl text-[clamp(2.35rem,6vw,6.1rem)] font-black leading-[0.95] tracking-normal">
                Foi demitido e não sabe se tem direito ao seguro?
              </h1>
              <p className="mt-7 max-w-2xl text-lg leading-relaxed text-slate-200 sm:text-xl">
                Confira prazo, parcelas, guias e documentos antes de perder o
                benefício ou aceitar uma rescisão lançada de forma errada.
              </p>
              <div className="mt-9 flex flex-col gap-4 sm:flex-row">
                <PrimaryButton>Verificar meu seguro</PrimaryButton>
                <a
                  href="#requisitos"
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/10 px-6 py-4 text-sm font-black uppercase tracking-wide text-white transition hover:border-[#38bdf8]/70 hover:bg-white/15 sm:text-base"
                >
                  Ver requisitos
                  <ArrowRight size={18} />
                </a>
              </div>

              <div className="mt-10 grid gap-3 sm:grid-cols-3">
                {heroStats.map((item) => (
                  <div
                    key={item.value}
                    className="border-l-2 border-[#38bdf8] bg-black/42 px-4 py-3 backdrop-blur"
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

        <section className="bg-[#0d111c] py-20 sm:py-24">
          <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
            <div className="max-w-3xl">
              <SectionLabel>Entenda o benefício</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                Seguro-desemprego depende da rescisão correta
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-slate-300">
                Uma modalidade lançada de forma errada, uma justa causa indevida
                ou a falta das guias pode impedir o trabalhador de receber o que
                precisa logo depois da demissão.
              </p>
            </div>

            <div className="mt-12 grid gap-5 md:grid-cols-3">
              {conceptCards.map((item) => (
                <article
                  key={item.title}
                  className="rounded-lg border border-[#38bdf8]/18 bg-[#111827] p-6"
                >
                  <Smartphone className="mb-5 text-[#7dd3fc]" size={28} />
                  <h3 className="text-2xl font-black">{item.title}</h3>
                  <p className="mt-3 leading-relaxed text-slate-300">
                    {item.description}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="requisitos" className="bg-[#070a12] py-20 sm:py-24">
          <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
            <div className="max-w-3xl">
              <SectionLabel>Requisitos</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                Quem pode pedir seguro-desemprego
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-slate-300">
                O direito depende da forma de demissão, situação atual de emprego,
                renda e tempo mínimo de salários recebidos.
              </p>
            </div>

            <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {eligibilityItems.map((item) => (
                <article
                  key={item.title}
                  className="rounded-lg border border-[#38bdf8]/18 bg-[#111827] p-6 transition hover:border-[#38bdf8]/55"
                >
                  <FileText className="mb-5 text-[#7dd3fc]" size={28} />
                  <h3 className="text-2xl font-black">{item.title}</h3>
                  <p className="mt-3 leading-relaxed text-slate-300">
                    {item.description}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#0d111c] py-20 sm:py-24">
          <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 sm:px-8 lg:grid-cols-[0.85fr_1.15fr]">
            <div>
              <SectionLabel>Análise</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                O que define prazo, parcelas e valor
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-slate-300">
                Para avaliar o benefício, é preciso cruzar a modalidade da
                rescisão com histórico de trabalho, salários e prazo do pedido.
              </p>
              <div className="mt-8 rounded-lg border border-[#d8bd79]/25 bg-[#201806] p-6">
                <div className="flex gap-3">
                  <CalendarDays className="mt-1 shrink-0 text-[#d8bd79]" />
                  <p className="leading-relaxed text-slate-200">
                    Para trabalhador formal, o prazo comum de solicitação é do 7º
                    ao 120º dia contado da demissão.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {calculationItems.map((item) => (
                <div
                  key={item}
                  className="flex items-start gap-3 rounded-lg border border-white/10 bg-[#111827] p-4"
                >
                  <CheckCircle2
                    size={19}
                    className="mt-0.5 shrink-0 text-[#38bdf8]"
                  />
                  <span className="font-semibold leading-relaxed text-slate-200">
                    {item}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#070a12] py-20 sm:py-24">
          <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 sm:px-8 lg:grid-cols-[0.85fr_1.15fr]">
            <div>
              <SectionLabel>Sinais de problema</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                Quando o benefício pode travar ou ser negado
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-slate-300">
                Muitos problemas não estão no trabalhador, mas na forma como a
                rescisão foi comunicada ou nos documentos entregues pela empresa.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {warningItems.map((item) => (
                <div
                  key={item}
                  className="flex items-start gap-3 rounded-lg border border-white/10 bg-[#111827] p-4"
                >
                  <AlertTriangle
                    size={19}
                    className="mt-0.5 shrink-0 text-[#d8bd79]"
                  />
                  <span className="font-semibold leading-relaxed text-slate-200">
                    {item}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#0d111c] py-20 sm:py-24">
          <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
            <div className="max-w-3xl">
              <SectionLabel>Como funciona</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                Conferência do seguro-desemprego
              </h2>
            </div>
            <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              {analysisSteps.map((step, index) => (
                <div
                  key={step.title}
                  className="rounded-lg border border-[#38bdf8]/18 bg-[#111827] p-6"
                >
                  <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-[#38bdf8]/12 text-lg font-black text-[#7dd3fc]">
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

        <section className="bg-[#070a12] py-20 sm:py-24">
          <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 sm:px-8 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <SectionLabel>Documentos</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                O que separar para verificar o benefício
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-slate-300">
                A análise começa pela rescisão, guia do seguro e CTPS. Se houve
                negativa, o motivo informado também precisa ser conferido.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {documents.map((item) => (
                <div
                  key={item}
                  className="flex min-h-16 items-center gap-3 rounded-lg border border-white/10 bg-[#111827] px-4 py-4"
                >
                  <FileCheck2 size={19} className="shrink-0 text-[#38bdf8]" />
                  <span className="font-semibold text-slate-200">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#0d111c] py-20 sm:py-24">
          <div className="mx-auto w-full max-w-5xl px-5 sm:px-8">
            <div className="text-center">
              <SectionLabel>Dúvidas frequentes</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                Perguntas sobre seguro-desemprego
              </h2>
            </div>
            <div className="mt-10 divide-y divide-white/10 rounded-lg border border-white/10 bg-[#111827]">
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

        <section className="bg-[#070a12] py-20 sm:py-28">
          <div className="mx-auto w-full max-w-5xl px-5 text-center sm:px-8">
            <ShieldCheck className="mx-auto mb-6 text-[#7dd3fc]" size={44} />
            <h2 className="text-[clamp(2.2rem,5vw,4.6rem)] font-black leading-tight">
              A empresa não entregou as guias ou o benefício foi negado?
            </h2>
            <p className="mx-auto mt-6 max-w-3xl text-lg leading-relaxed text-slate-300">
              Envie sua rescisão, CTPS e comprovante de negativa para uma análise.
              O objetivo é identificar se há erro que possa ser corrigido.
            </p>
            <div className="mt-9">
              <PrimaryButton>Analisar meu seguro-desemprego</PrimaryButton>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 bg-[#070a12] py-10">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-5 text-sm text-slate-400 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
          <p>André Lustosa Advogados - Direito Trabalhista em Arapiraca-AL</p>
          <a
            href={parentPath}
            className="font-bold text-[#7dd3fc] hover:text-white"
          >
            Voltar para Verbas Rescisórias
          </a>
        </div>
      </footer>

      <button
        onClick={openWhatsapp}
        className="fixed bottom-5 right-5 z-50 flex h-16 w-16 items-center justify-center rounded-full bg-[#38bdf8] text-[#031018] shadow-[0_14px_40px_rgba(56,189,248,0.38)] transition hover:scale-105"
        aria-label="Falar pelo WhatsApp"
      >
        <MessageCircle size={30} />
      </button>
    </div>
  );
}
