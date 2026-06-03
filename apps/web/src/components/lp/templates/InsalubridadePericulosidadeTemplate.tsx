"use client";

import type { ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Calculator,
  CheckCircle2,
  FileCheck2,
  HardHat,
  MessageCircle,
  ReceiptText,
  Scale,
  ShieldCheck,
  ThermometerSun,
} from "lucide-react";
import { trackWhatsappClick } from "../LPTracker";
import {
  additionalRights,
  analysisSteps,
  calculationItems,
  conceptCards,
  documents,
  faqItems,
  heroStats,
  parentPath,
  warningItems,
  whatsappMessage,
  whatsappNumber,
} from "@/app/arapiraca/trabalhista/insalubridade-periculosidade/content";

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
    <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#22c55e]/35 bg-[#22c55e]/10 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-[#6ee7a0]">
      <Scale size={14} />
      {children}
    </div>
  );
}

export function InsalubridadePericulosidadeTemplate() {
  return (
    <div className="min-h-screen bg-[#071008] text-white">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-[#071008]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between px-5 sm:px-8">
          <a
            href={parentPath}
            className="flex items-center gap-2 text-sm font-black text-[#d8bd79]"
          >
            <ArrowLeft size={18} />
            Direito Trabalhista
          </a>
          <button
            onClick={openWhatsapp}
            className="inline-flex items-center gap-2 rounded-lg border border-[#22c55e]/35 bg-[#0f2414] px-4 py-3 text-sm font-black text-[#dcfce7] transition hover:border-[#22c55e] hover:bg-[#14351d]"
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
              src="/landing/insalubridade-periculosidade-hero.png"
              alt="EPI, CTPS e laudo técnico para análise de insalubridade e periculosidade"
              className="h-full w-full object-cover object-center opacity-100"
            />
          </div>
          <div className="absolute inset-0 bg-linear-to-r from-black/84 via-black/44 to-black/0" />
          <div className="absolute inset-0 bg-linear-to-t from-[#071008]/86 via-transparent to-black/10" />

          <div className="relative z-10 mx-auto flex min-h-[calc(94svh-6rem)] w-full max-w-7xl items-center px-5 py-16 sm:px-8">
            <div className="max-w-3xl">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#22c55e]/35 bg-black/45 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-[#86efac]">
                <HardHat size={15} />
                Adicionais trabalhistas em Arapiraca-AL
              </div>
              <h1 className="max-w-4xl text-[clamp(2.35rem,6vw,6.1rem)] font-black leading-[0.95] tracking-normal">
                Trabalha em ambiente perigoso ou prejudicial à saúde?
              </h1>
              <p className="mt-7 max-w-2xl text-lg leading-relaxed text-slate-200 sm:text-xl">
                Confira se a rotina, os agentes de risco e os documentos indicam
                adicional de insalubridade ou periculosidade.
              </p>
              <div className="mt-9 flex flex-col gap-4 sm:flex-row">
                <PrimaryButton>Analisar meu adicional</PrimaryButton>
                <a
                  href="#direitos"
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/10 px-6 py-4 text-sm font-black uppercase tracking-wide text-white transition hover:border-[#22c55e]/70 hover:bg-white/15 sm:text-base"
                >
                  Ver direitos
                  <ArrowRight size={18} />
                </a>
              </div>

              <div className="mt-10 grid gap-3 sm:grid-cols-3">
                {heroStats.map((item) => (
                  <div
                    key={item.value}
                    className="border-l-2 border-[#22c55e] bg-black/42 px-4 py-3 backdrop-blur"
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

        <section className="bg-[#0d140f] py-20 sm:py-24">
          <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
            <div className="max-w-3xl">
              <SectionLabel>Entenda os adicionais</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                O adicional depende da rotina real e das provas
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-slate-300">
                O nome do cargo não resolve a análise. É preciso conferir o
                ambiente, o tipo de exposição, os equipamentos e a documentação
                produzida durante o contrato.
              </p>
            </div>

            <div className="mt-12 grid gap-5 md:grid-cols-3">
              {conceptCards.map((item) => (
                <article
                  key={item.title}
                  className="rounded-lg border border-[#22c55e]/18 bg-[#111913] p-6"
                >
                  <ThermometerSun className="mb-5 text-[#6ee7a0]" size={28} />
                  <h3 className="text-2xl font-black">{item.title}</h3>
                  <p className="mt-3 leading-relaxed text-slate-300">
                    {item.description}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="direitos" className="bg-[#071008] py-20 sm:py-24">
          <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
            <div className="max-w-3xl">
              <SectionLabel>Direitos ligados ao risco</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                O que precisa ser conferido no contrato
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-slate-300">
                Insalubridade e periculosidade podem alterar remuneração,
                reflexos trabalhistas e valores de rescisão.
              </p>
            </div>

            <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {additionalRights.map((item) => (
                <article
                  key={item.title}
                  className="rounded-lg border border-[#22c55e]/18 bg-[#111913] p-6 transition hover:border-[#22c55e]/55"
                >
                  <ReceiptText className="mb-5 text-[#6ee7a0]" size={28} />
                  <h3 className="text-2xl font-black">{item.title}</h3>
                  <p className="mt-3 leading-relaxed text-slate-300">
                    {item.description}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#0d140f] py-20 sm:py-24">
          <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 sm:px-8 lg:grid-cols-[0.85fr_1.15fr]">
            <div>
              <SectionLabel>Cálculo</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                A base correta depende do adicional e da exposição
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-slate-300">
                Para avaliar diferenças, a conferência cruza função, rotina,
                prova técnica, contracheques e reflexos pagos na rescisão.
              </p>
              <div className="mt-8 rounded-lg border border-[#d8bd79]/25 bg-[#201806] p-6">
                <div className="flex gap-3">
                  <Calculator className="mt-1 shrink-0 text-[#d8bd79]" />
                  <p className="leading-relaxed text-slate-200">
                    Percentual, base de cálculo e reflexos precisam ser
                    analisados conforme o tipo de adicional e o período de
                    exposição.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {calculationItems.map((item) => (
                <div
                  key={item}
                  className="flex items-start gap-3 rounded-lg border border-white/10 bg-[#121a14] p-4"
                >
                  <CheckCircle2
                    size={19}
                    className="mt-0.5 shrink-0 text-[#22c55e]"
                  />
                  <span className="font-semibold leading-relaxed text-slate-200">
                    {item}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#071008] py-20 sm:py-24">
          <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 sm:px-8 lg:grid-cols-[0.85fr_1.15fr]">
            <div>
              <SectionLabel>Sinais de atenção</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                Quando o adicional merece análise
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-slate-300">
                O pagamento pode estar ausente, menor que o devido ou sem
                reflexos nas demais verbas do contrato.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {warningItems.map((item) => (
                <div
                  key={item}
                  className="flex items-start gap-3 rounded-lg border border-white/10 bg-[#121a14] p-4"
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

        <section className="bg-[#0d140f] py-20 sm:py-24">
          <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
            <div className="max-w-3xl">
              <SectionLabel>Como funciona</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                Conferência jurídica do adicional
              </h2>
            </div>
            <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              {analysisSteps.map((step, index) => (
                <div
                  key={step.title}
                  className="rounded-lg border border-[#22c55e]/18 bg-[#111913] p-6"
                >
                  <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-[#22c55e]/12 text-lg font-black text-[#6ee7a0]">
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

        <section className="bg-[#071008] py-20 sm:py-24">
          <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 sm:px-8 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <SectionLabel>Documentos</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                O que separar para analisar o adicional
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-slate-300">
                A documentação ajuda a reconstruir a rotina real e comparar o
                que foi pago com o risco existente no ambiente de trabalho.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {documents.map((item) => (
                <div
                  key={item}
                  className="flex min-h-16 items-center gap-3 rounded-lg border border-white/10 bg-[#121a14] px-4 py-4"
                >
                  <FileCheck2 size={19} className="shrink-0 text-[#22c55e]" />
                  <span className="font-semibold text-slate-200">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#0d140f] py-20 sm:py-24">
          <div className="mx-auto w-full max-w-5xl px-5 sm:px-8">
            <div className="text-center">
              <SectionLabel>Dúvidas frequentes</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                Perguntas sobre insalubridade e periculosidade
              </h2>
            </div>
            <div className="mt-10 divide-y divide-white/10 rounded-lg border border-white/10 bg-[#111913]">
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

        <section className="bg-[#071008] py-20 sm:py-28">
          <div className="mx-auto w-full max-w-5xl px-5 text-center sm:px-8">
            <ShieldCheck className="mx-auto mb-6 text-[#6ee7a0]" size={44} />
            <h2 className="text-[clamp(2.2rem,5vw,4.6rem)] font-black leading-tight">
              Trabalha com risco, agentes nocivos ou EPI insuficiente?
            </h2>
            <p className="mx-auto mt-6 max-w-3xl text-lg leading-relaxed text-slate-300">
              Envie documentos do contrato, contracheques e informações da
              rotina para uma conferência inicial do adicional trabalhista.
            </p>
            <div className="mt-9">
              <PrimaryButton>Analisar meu adicional</PrimaryButton>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 bg-[#071008] py-10">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-5 text-sm text-slate-400 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
          <p>André Lustosa Advogados - Direito Trabalhista em Arapiraca-AL</p>
          <a
            href={parentPath}
            className="font-bold text-[#6ee7a0] hover:text-white"
          >
            Voltar para Direito Trabalhista
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
