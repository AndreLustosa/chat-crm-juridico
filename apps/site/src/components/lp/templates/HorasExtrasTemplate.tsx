"use client";

import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import {
  ArrowRight,
  BriefcaseBusiness,
  CheckCircle2,
  MessageCircle,
  ShieldCheck,
} from "lucide-react";
import {
  heroStats,
  office,
  parentPath,
  quickAnswer,
  whatsappMessage,
  whatsappNumber,
} from "@/app/arapiraca/trabalhista/horas-extras/content";
import { appendRefToWaLink, trackWhatsappClick } from "../LPTracker";

const HorasExtrasBelowFold = dynamic(
  () =>
    import("./HorasExtrasBelowFold").then((mod) => mod.HorasExtrasBelowFold),
  {
    ssr: true,
    loading: () => (
      <div className="bg-[#101010] py-16 text-center text-sm text-slate-400">
        Carregando detalhes da análise...
      </div>
    ),
  },
);

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
      className="inline-flex w-full max-w-[calc(100vw-2rem)] items-center justify-center gap-3 rounded-lg bg-[#22c55e] px-5 py-4 text-center text-sm font-black uppercase tracking-wide text-[#07110b] shadow-[0_18px_45px_rgba(34,197,94,0.28)] transition hover:-translate-y-0.5 hover:bg-[#2ee66d] focus:outline-none focus:ring-2 focus:ring-[#22c55e] focus:ring-offset-2 focus:ring-offset-black sm:w-auto sm:px-7 sm:text-base"
    >
      <MessageCircle size={20} className="shrink-0" />
      <span className="leading-tight">{children}</span>
      <ArrowRight size={18} className="shrink-0" />
    </button>
  );
}

export function HorasExtrasTemplate() {
  return (
    <div className="min-h-screen bg-[#080808] text-white">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-[#080808]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
          <a href={parentPath} aria-label="André Lustosa Advogados">
            <Image
              src="/landing/logo_andre_lustosa_transparente.webp"
              alt="André Lustosa Advogados"
              width={220}
              height={60}
              className="h-10 w-auto object-contain sm:h-11"
            />
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
            <Image
              src="/landing/horas-extras-hero.webp"
              alt="Carteira de trabalho, relogio e documentos de jornada para horas extras"
              fill
              priority
              sizes="100vw"
              className="hidden h-full w-full object-cover object-center opacity-90 md:block"
            />
            <Image
              src="/landing/horas-extras-hero-mobile.webp"
              alt="Carteira de trabalho, relogio e documentos de jornada para horas extras"
              fill
              priority
              sizes="100vw"
              className="h-full w-full object-cover object-center opacity-90 md:hidden"
            />
          </div>
          <div className="absolute inset-0 bg-linear-to-r from-black via-black/84 to-black/35" />
          <div className="absolute inset-0 bg-linear-to-t from-[#080808] via-transparent to-black/35" />

          <div className="relative z-10 mx-auto flex min-h-[calc(94svh-6rem)] w-full max-w-7xl items-center px-5 py-16 sm:px-8">
            <div className="max-w-3xl">
              <div className="flex flex-wrap gap-3">
                <div className="inline-flex items-center gap-2 rounded-full border border-[#b8944d]/40 bg-black/45 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-[#d8bd79]">
                  <BriefcaseBusiness size={15} />
                  Atuação em Direito Trabalhista
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-[#22c55e]/35 bg-[#22c55e]/10 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-[#9bf2b8]">
                  <ShieldCheck size={15} />
                  Atendimento Sigiloso
                </div>
              </div>

              <p className="mt-6 text-sm font-black uppercase tracking-[0.16em] text-[#f6e3aa]">
                Arapiraca-AL | {office.lawyer} - {office.oab}
              </p>

              <h1 className="mt-4 max-w-4xl text-[clamp(2.35rem,6vw,6.1rem)] font-black leading-[0.95] tracking-normal">
                Horas extras não pagas em Arapiraca
              </h1>

              <p className="mt-7 max-w-2xl text-lg leading-relaxed text-slate-100 sm:text-xl">
                {quickAnswer}
              </p>
              <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">
                O escritório confere jornada, banco de horas, intervalo,
                mensagens fora do expediente e reflexos em férias, 13º, FGTS e
                rescisão.
              </p>

              <div className="mt-9 flex flex-col gap-4 sm:flex-row">
                <PrimaryButton>Analisar minhas horas extras</PrimaryButton>
                <a
                  href="#documentos"
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/10 px-6 py-4 text-sm font-black uppercase tracking-wide text-white transition hover:border-[#d8bd79]/70 hover:bg-white/15 sm:text-base"
                >
                  Ver documentos
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

              <div className="mt-7 inline-flex items-start gap-3 rounded-lg border border-white/10 bg-black/35 p-4 text-sm leading-relaxed text-slate-300">
                <CheckCircle2 className="mt-0.5 shrink-0 text-[#22c55e]" size={18} />
                <span>
                  Atendimento presencial em Arapiraca e remoto para análise de
                  documentos trabalhistas.
                </span>
              </div>
            </div>
          </div>
        </section>

        <HorasExtrasBelowFold />
      </main>

      <footer className="border-t border-white/10 bg-black py-10">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-5 text-sm text-slate-400 sm:px-8 md:flex-row md:items-center md:justify-between">
          <div>
            <strong className="block text-white">{office.name}</strong>
            <span>{office.lawyer} - {office.oab}</span>
          </div>
          <p className="max-w-2xl leading-relaxed">
            Escritório de advocacia em Arapiraca-AL, atuante em Direito do
            Trabalho e na defesa de direitos dos trabalhadores.
          </p>
        </div>
      </footer>
    </div>
  );
}
