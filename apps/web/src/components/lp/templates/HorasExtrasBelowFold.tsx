"use client";

import type { ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  MessageCircle,
  Scale,
} from "lucide-react";
import {
  documents,
  faqItems,
  issueCards,
  office,
  processSteps,
  rightsItems,
  warningItems,
  whatsappMessage,
  whatsappNumber,
} from "@/app/arapiraca/trabalhista/horas-extras/content";
import { appendRefToWaLink, trackWhatsappClick } from "../LPTracker";

const whatsappHref = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(
  whatsappMessage,
)}`;

function openWhatsapp() {
  trackWhatsappClick();
  window.open(appendRefToWaLink(whatsappHref), "_blank", "noopener,noreferrer");
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#b8944d]/40 bg-[#b8944d]/10 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-[#d8bd79]">
      <Scale size={14} />
      {children}
    </div>
  );
}

function PrimaryButton({ children }: { children: ReactNode }) {
  return (
    <button
      onClick={openWhatsapp}
      className="inline-flex w-full max-w-[calc(100vw-2rem)] items-center justify-center gap-3 rounded-lg bg-[#22c55e] px-5 py-4 text-center text-sm font-black uppercase tracking-wide text-[#07110b] shadow-[0_18px_45px_rgba(34,197,94,0.28)] transition hover:-translate-y-0.5 hover:bg-[#2ee66d] focus:outline-none focus:ring-2 focus:ring-[#22c55e] focus:ring-offset-2 focus:ring-offset-black sm:w-auto sm:px-7 sm:text-base"
    >
      <MessageCircle size={20} className="shrink-0" />
      <span className="leading-tight">{children}</span>
      <ArrowRight size={18} className="shrink-0" />
    </button>
  );
}

export function HorasExtrasBelowFold() {
  return (
    <>
      <section className="bg-[#101010] py-20 sm:py-24">
        <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
          <div className="max-w-3xl">
            <SectionLabel>Jornada real</SectionLabel>
            <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
              A hora extra nasce quando a rotina passa do limite permitido
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-slate-300">
              A análise não depende apenas do contracheque. É preciso cruzar
              ponto, escala, banco de horas, intervalo, mensagens e a forma como
              o trabalho era cobrado no dia a dia.
            </p>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {issueCards.map((item) => (
              <article
                key={item.title}
                className="rounded-lg border border-[#b8944d]/20 bg-[#141414] p-6"
              >
                <AlertTriangle className="mb-5 text-[#d8bd79]" size={28} />
                <h3 className="text-2xl font-black">{item.title}</h3>
                <p className="mt-3 leading-relaxed text-slate-300">
                  {item.description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#080808] py-20 sm:py-24">
        <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
          <div className="max-w-3xl">
            <SectionLabel>O que conferir</SectionLabel>
            <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
              Verbas e situações que podem entrar na conta
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-slate-300">
              Cada contrato tem uma base de cálculo. Por isso, salário, jornada,
              adicionais, comissões e frequência das horas precisam ser
              analisados em conjunto.
            </p>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {rightsItems.map((item) => (
              <article
                key={item.title}
                className="rounded-lg border border-[#b8944d]/20 bg-[#141414] p-6 transition hover:border-[#d8bd79]/60"
              >
                <CheckCircle2 className="mb-5 text-[#22c55e]" size={28} />
                <h3 className="text-xl font-black">{item.title}</h3>
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
            <SectionLabel>Pontos de atenção</SectionLabel>
            <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
              Banco de horas, ponto e mensagens precisam conversar entre si
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-slate-300">
              Divergências entre o registro formal e a rotina real podem mudar
              completamente a leitura do caso. O objetivo é separar o que foi
              pago do que ainda pode ser discutido.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {warningItems.map((item) => (
              <div
                key={item}
                className="flex items-start gap-3 rounded-lg border border-white/10 bg-[#181818] p-4"
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

      <section id="como-funciona" className="bg-[#080808] py-20 sm:py-24">
        <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
          <div className="max-w-3xl">
            <SectionLabel>Como funciona</SectionLabel>
            <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
              Análise em quatro etapas, com foco em provas e cálculo
            </h2>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-4">
            {processSteps.map((step, index) => (
              <article
                key={step.title}
                className="rounded-lg border border-[#b8944d]/20 bg-[#141414] p-6"
              >
                <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-full border border-[#d8bd79]/50 bg-[#d8bd79]/10 text-lg font-black text-[#f6e3aa]">
                  {index + 1}
                </div>
                <h3 className="text-xl font-black">{step.title}</h3>
                <p className="mt-3 leading-relaxed text-slate-300">
                  {step.description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="documentos" className="bg-[#101010] py-20 sm:py-24">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 sm:px-8 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <SectionLabel>Documentos</SectionLabel>
            <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
              Provas úteis para conferir horas extras
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-slate-300">
              Você não precisa ter todos os documentos para iniciar a conversa.
              O importante é preservar qualquer material que ajude a reconstruir
              a jornada trabalhada.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {documents.map((item) => (
              <div
                key={item}
                className="flex items-start gap-3 rounded-lg border border-white/10 bg-[#181818] p-4"
              >
                <FileCheck2
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

      <section className="bg-[#080808] py-20 sm:py-24">
        <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
          <div className="max-w-3xl">
            <SectionLabel>Dúvidas frequentes</SectionLabel>
            <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
              Perguntas comuns sobre horas extras
            </h2>
          </div>

          <div className="mt-12 grid gap-4 lg:grid-cols-2">
            {faqItems.map((item) => (
              <article
                key={item.question}
                className="rounded-lg border border-[#b8944d]/20 bg-[#141414] p-6"
              >
                <h3 className="text-xl font-black">{item.question}</h3>
                <p className="mt-3 leading-relaxed text-slate-300">
                  {item.answer}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#101010] py-20 sm:py-24">
        <div className="mx-auto w-full max-w-5xl px-5 text-center sm:px-8">
          <ClipboardCheck className="mx-auto mb-6 text-[#d8bd79]" size={40} />
          <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
            Trabalhou além do horário e não recebeu corretamente?
          </h2>
          <p className="mx-auto mt-5 max-w-3xl text-lg leading-relaxed text-slate-300">
            Envie os documentos e conte como era sua jornada. O escritório
            analisa os registros, identifica pontos de atenção e orienta o
            próximo passo de forma sigilosa.
          </p>
          <div className="mt-9">
            <PrimaryButton>Analisar minhas horas extras</PrimaryButton>
          </div>
          <p className="mt-6 text-sm text-slate-500">
            {office.lawyer} - {office.oab}
          </p>
        </div>
      </section>
    </>
  );
}
