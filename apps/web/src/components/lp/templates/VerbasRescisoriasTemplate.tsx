"use client";

import type { ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BriefcaseBusiness,
  Calculator,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  FileCheck2,
  FileText,
  Landmark,
  MessageCircle,
  Scale,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { trackWhatsappClick } from "../LPTracker";
import {
  calculationItems,
  calculatorFields,
  captureTopics,
  documents,
  faqItems,
  forgottenRights,
  navItems,
  quickStats,
  rescisionTypes,
  rightPages,
  whatsappMessage,
  whatsappNumber,
} from "@/app/arapiraca/trabalhista/verbas-rescisorias/content";

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
      className="inline-flex items-center justify-center gap-3 rounded-lg bg-[#22c55e] px-6 py-4 text-sm font-black uppercase tracking-wide text-[#07110b] shadow-[0_18px_45px_rgba(34,197,94,0.28)] transition hover:-translate-y-0.5 hover:bg-[#2ee66d] focus:outline-none focus:ring-2 focus:ring-[#22c55e] focus:ring-offset-2 focus:ring-offset-black sm:text-base"
    >
      <MessageCircle size={20} />
      {children}
      <ArrowRight size={18} />
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

export function VerbasRescisoriasTemplate() {
  return (
    <div className="min-h-screen bg-[#080808] text-white">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-[#080808]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between px-5 sm:px-8">
          <a href="/arapiraca/trabalhista/verbas-rescisorias" className="flex items-center gap-3">
            <img
              src="/landing/logo_andre_lustosa_transparente.png"
              alt="André Lustosa Advogados"
              className="h-11 w-auto"
            />
          </a>
          <nav className="hidden items-center gap-6 lg:flex">
            {navItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="text-sm font-bold text-slate-300 transition hover:text-[#d8bd79]"
              >
                {item.label}
              </a>
            ))}
          </nav>
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
              alt="Carteira de trabalho e documentos de rescisão trabalhista"
              className="h-full w-full object-cover object-center opacity-85"
            />
          </div>
          <div className="absolute inset-0 bg-linear-to-r from-black via-black/85 to-black/40" />
          <div className="absolute inset-0 bg-linear-to-t from-[#080808] via-transparent to-black/40" />

          <div className="relative z-10 mx-auto flex min-h-[calc(94svh-6rem)] w-full max-w-7xl items-center px-5 py-16 sm:px-8">
            <div className="max-w-3xl">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#b8944d]/40 bg-black/45 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-[#d8bd79]">
                <BriefcaseBusiness size={15} />
                Direito Trabalhista em Arapiraca-AL
              </div>
              <h1 className="max-w-4xl text-[clamp(2.6rem,6vw,6.6rem)] font-black leading-[0.95] tracking-normal">
                Verbas Rescisórias Trabalhistas
              </h1>
              <p className="mt-7 max-w-2xl text-lg leading-relaxed text-slate-200 sm:text-xl">
                Foi demitido, pediu demissão ou recebeu uma rescisão que não
                fecha? Entenda seus direitos antes de assinar, conferir ou
                aceitar qualquer valor.
              </p>
              <div className="mt-9 flex flex-col gap-4 sm:flex-row">
                <PrimaryButton>Calcular minha rescisão</PrimaryButton>
                <a
                  href="#tipos"
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/10 px-6 py-4 text-sm font-black uppercase tracking-wide text-white transition hover:border-[#d8bd79]/70 hover:bg-white/15 sm:text-base"
                >
                  Ver tipos de demissão
                  <ChevronRight size={18} />
                </a>
              </div>

              <div className="mt-10 grid gap-3 sm:grid-cols-3">
                {quickStats.map((item) => (
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

        <section id="calculo" className="bg-[#101010] py-20 sm:py-24">
          <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <div>
              <SectionLabel>Conferência da rescisão</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                O que são verbas rescisórias?
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-slate-300">
                Verbas rescisórias são os valores devidos quando o contrato de
                trabalho termina. O cálculo muda conforme o tipo de demissão, o
                tempo de serviço, o salário, as férias, o FGTS e a existência de
                horas extras, comissões ou adicionais.
              </p>
              <div className="mt-8">
                <PrimaryButton>Analisar minha demissão</PrimaryButton>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {calculationItems.map((item) => (
                <div
                  key={item}
                  className="rounded-lg border border-white/10 bg-[#171717] p-5"
                >
                  <CheckCircle2 className="mb-4 text-[#22c55e]" size={24} />
                  <p className="font-semibold leading-relaxed text-slate-100">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="tipos" className="bg-[#080808] py-20 sm:py-24">
          <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
            <div className="max-w-3xl">
              <SectionLabel>Tipos de demissão</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                Cada modalidade muda o que você recebe
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-slate-300">
                O primeiro erro comum é comparar a própria rescisão com a de
                outro trabalhador. Sem justa causa, pedido de demissão, justa
                causa, acordo e experiência têm regras diferentes.
              </p>
            </div>

            <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {rescisionTypes.map((type) => (
                <article
                  key={type.title}
                  className="rounded-lg border border-[#b8944d]/20 bg-[#141414] p-6 transition hover:border-[#d8bd79]/60"
                >
                  <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-lg bg-[#b8944d]/12 text-[#d8bd79]">
                    <FileText size={24} />
                  </div>
                  <h3 className="text-2xl font-black">{type.title}</h3>
                  <p className="mt-3 min-h-[5.25rem] leading-relaxed text-slate-300">
                    {type.summary}
                  </p>
                  <ul className="mt-6 space-y-2">
                    {type.items.map((item) => (
                      <li key={item} className="flex gap-2 text-sm text-slate-200">
                        <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-[#22c55e]" />
                        {item}
                      </li>
                    ))}
                  </ul>
                  {"href" in type && type.href ? (
                    <a
                      href={type.href}
                      className="mt-7 inline-flex items-center gap-2 rounded-lg border border-[#b8944d]/35 px-4 py-3 text-sm font-black uppercase tracking-wide text-[#d8bd79] transition hover:border-[#d8bd79] hover:bg-[#b8944d]/10"
                    >
                      Ver detalhes
                      <ArrowRight size={16} />
                    </a>
                  ) : null}
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="direitos" className="bg-[#101010] py-20 sm:py-24">
          <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
            <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
              <div>
                <SectionLabel>Direitos na rescisão</SectionLabel>
                <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                  As verbas que precisam ser conferidas uma por uma
                </h2>
                <p className="mt-5 text-lg leading-relaxed text-slate-300">
                  Uma rescisão pode parecer correta no total, mas esconder erro
                  em férias, aviso-prévio, FGTS, médias variáveis ou multas. A
                  análise técnica separa o que foi pago do que ainda pode ser
                  cobrado.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {rightPages.map((item) => (
                  <div
                    key={item.title}
                    className="rounded-lg border border-white/10 bg-[#181818] p-6"
                  >
                    <WalletCards className="mb-4 text-[#d8bd79]" size={24} />
                    <h3 className="text-xl font-black">{item.title}</h3>
                    <p className="mt-3 leading-relaxed text-slate-300">
                      {item.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="bg-[#080808] py-20 sm:py-24">
          <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
            <div className="max-w-3xl">
              <SectionLabel>Direitos esquecidos</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                Onde muitas rescisões ficam erradas
              </h2>
            </div>
            <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-5">
              {forgottenRights.map((item) => (
                <div
                  key={item.title}
                  className="rounded-lg border border-[#b8944d]/20 bg-[#141414] p-5"
                >
                  <AlertTriangle className="mb-4 text-[#d8bd79]" size={22} />
                  <h3 className="text-lg font-black">{item.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-slate-300">
                    {item.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#101010] py-20 sm:py-24">
          <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 sm:px-8 lg:grid-cols-[1fr_0.9fr]">
            <div className="rounded-lg border border-[#22c55e]/25 bg-[#0d1a12] p-7 sm:p-9">
              <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-lg bg-[#22c55e]/15 text-[#22c55e]">
                <Calculator size={30} />
              </div>
              <h2 className="text-[clamp(2rem,4vw,3.7rem)] font-black leading-tight">
                Calculadora de verbas rescisórias
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-slate-200">
                A calculadora será o centro do site: ela coleta os dados da
                demissão, mostra uma estimativa e direciona os casos com risco
                de erro para análise jurídica com documentos.
              </p>
              <div className="mt-8">
                <PrimaryButton>Quero calcular minha rescisão</PrimaryButton>
              </div>
              <p className="mt-5 text-sm leading-relaxed text-slate-400">
                O cálculo exibido no site deve ser tratado como estimativa. A
                análise final depende dos documentos e da modalidade correta de
                desligamento.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {calculatorFields.map((field) => (
                <div
                  key={field}
                  className="flex items-center gap-3 rounded-lg border border-white/10 bg-[#181818] px-4 py-4"
                >
                  <ClipboardCheck size={19} className="shrink-0 text-[#d8bd79]" />
                  <span className="font-semibold text-slate-200">{field}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="documentos" className="bg-[#080808] py-20 sm:py-24">
          <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
            <div className="max-w-3xl">
              <SectionLabel>Documentos necessários</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                O que enviar para conferir sua rescisão
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-slate-300">
                Você não precisa ter tudo para iniciar a conversa. Mas quanto
                mais documentos forem reunidos, mais precisa fica a conferência.
              </p>
            </div>
            <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {documents.map((item) => (
                <div
                  key={item}
                  className="flex min-h-16 items-center gap-3 rounded-lg border border-white/10 bg-[#151515] px-4 py-4"
                >
                  <FileCheck2 size={19} className="shrink-0 text-[#22c55e]" />
                  <span className="font-semibold text-slate-200">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#101010] py-20 sm:py-24">
          <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <SectionLabel>Captação qualificada</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                Conteúdos que viram atendimento
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-slate-300">
                A partir desta página principal, o site pode crescer com páginas
                específicas para dúvidas de alta intenção de busca. Cada tema
                educa o trabalhador e leva para análise jurídica.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {captureTopics.map((topic) => (
                <div
                  key={topic}
                  className="rounded-lg border border-[#b8944d]/20 bg-[#171717] p-5"
                >
                  <Landmark className="mb-4 text-[#d8bd79]" size={22} />
                  <p className="font-black text-slate-100">{topic}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="faq" className="bg-[#080808] py-20 sm:py-24">
          <div className="mx-auto w-full max-w-5xl px-5 sm:px-8">
            <div className="text-center">
              <SectionLabel>Dúvidas frequentes</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,4rem)] font-black leading-tight">
                Perguntas comuns sobre rescisão trabalhista
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
              Desconfia que sua rescisão foi paga errado?
            </h2>
            <p className="mx-auto mt-6 max-w-3xl text-lg leading-relaxed text-slate-300">
              Envie seus documentos para uma análise trabalhista. O atendimento
              é direto pelo WhatsApp, com orientação simples e foco no que pode
              ser cobrado.
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
          <p>Rua Francisco Rodrigues Viana, 244, Baixa Grande, Arapiraca-AL</p>
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
