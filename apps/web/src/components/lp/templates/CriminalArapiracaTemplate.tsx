"use client";

import Image from "next/image";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  BriefcaseBusiness,
  CheckCircle2,
  Clock,
  FileSearch,
  Fingerprint,
  Gavel,
  MapPin,
  MessageCircle,
  Phone,
  Scale,
  Shield,
} from "lucide-react";
import { trackWhatsappClick } from "../LPTracker";

const whatsappNumber = "5582996390799";
const whatsappHref = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(
  "Olá, vim da página de Direito Criminal em Arapiraca e preciso de orientação jurídica.",
)}`;

const practiceAreas = [
  {
    icon: AlertTriangle,
    title: "Prisão em flagrante",
    description:
      "Orientação imediata para familiares e acompanhamento dos primeiros atos após a prisão.",
  },
  {
    icon: Gavel,
    title: "Audiência de custódia",
    description:
      "Atuação técnica na análise da legalidade da prisão e das medidas cabíveis ao caso.",
  },
  {
    icon: FileSearch,
    title: "Inquérito policial",
    description:
      "Acompanhamento de depoimentos, intimações, diligências e produção de elementos defensivos.",
  },
  {
    icon: Shield,
    title: "Medidas protetivas",
    description:
      "Atuação em casos ligados à Lei Maria da Penha, com análise cuidadosa dos fatos e provas.",
    href: "/arapiraca/criminal/medidas-protetivas",
  },
  {
    icon: Fingerprint,
    title: "Lei de Drogas",
    description:
      "Defesa em investigações e ações penais envolvendo posse, tráfico e condutas relacionadas.",
  },
  {
    icon: BriefcaseBusiness,
    title: "Crimes patrimoniais",
    description:
      "Atuação em acusações de furto, roubo, estelionato, apropriação indébita e situações correlatas.",
  },
];

const steps = [
  {
    title: "Contato reservado",
    description:
      "Você relata a situação pelo WhatsApp, com sigilo e objetividade.",
  },
  {
    title: "Análise inicial",
    description:
      "A equipe entende o cenário, documentos e urgência antes de orientar os próximos passos.",
  },
  {
    title: "Estratégia defensiva",
    description:
      "Definimos a atuação adequada para inquérito, flagrante, audiência ou processo criminal.",
  },
  {
    title: "Acompanhamento",
    description:
      "O caso segue com comunicação clara e atualização sobre os atos relevantes.",
  },
];

const trustItems = [
  { text: "Sigilo profissional", icon: Shield },
  { text: "OAB/AL 14209", icon: BadgeCheck },
  { text: "Atendimento em urgências", icon: Clock },
];

const faq = [
  {
    question: "Fui intimado para depor. Preciso ir com advogado?",
    answer:
      "É recomendável buscar orientação antes do depoimento. O advogado pode avaliar o conteúdo da intimação, explicar seus direitos e acompanhar o ato quando cabível.",
  },
  {
    question: "O que fazer em caso de prisão em flagrante em Arapiraca?",
    answer:
      "Entre em contato imediatamente com um advogado criminalista. As primeiras horas são importantes para analisar a legalidade da prisão, comunicar familiares e preparar a atuação na audiência de custódia.",
  },
  {
    question: "O atendimento é sigiloso?",
    answer:
      "Sim. As informações compartilhadas são tratadas com reserva profissional e usadas apenas para a análise jurídica do caso.",
  },
  {
    question: "O escritório atende apenas em Arapiraca?",
    answer:
      "A sede fica em Arapiraca-AL, com atendimento presencial mediante agendamento e atendimento digital para clientes de outras cidades de Alagoas e do Brasil.",
  },
];

function openWhatsapp() {
  trackWhatsappClick();
  window.open(whatsappHref, "_blank", "noopener,noreferrer");
}

export function CriminalArapiracaTemplate() {
  return (
    <div className="min-h-screen bg-[#080808] text-[#f7f3ea]">
      <section className="relative min-h-[92svh] overflow-hidden border-b border-[#a89048]/30">
        <Image
          src="/landing/criminal-hero-andre-lustosa.png"
          alt="André Lustosa Advogados - Direito Criminal em Arapiraca"
          fill
          priority
          sizes="100vw"
          className="object-cover object-[64%_center]"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,5,5,0.96)_0%,rgba(8,8,8,0.82)_31%,rgba(8,8,8,0.28)_61%,rgba(8,8,8,0.2)_100%)]" />
        <div className="absolute inset-x-0 top-0 z-20">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 md:px-8">
            <Image
              src="/landing/logo_andre_lustosa_transparente.webp"
              alt="André Lustosa Advogados"
              width={220}
              height={60}
              className="h-10 w-auto object-contain"
            />
            <button
              onClick={openWhatsapp}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#a89048]/40 bg-black/40 px-4 text-sm font-semibold text-[#f7f3ea] backdrop-blur transition hover:border-[#d5bd7a] hover:bg-black/60"
            >
              <MessageCircle size={17} />
              WhatsApp
            </button>
          </div>
        </div>

        <div className="relative z-10 mx-auto flex min-h-[92svh] max-w-7xl items-center px-5 pb-12 pt-24 md:px-8">
          <div className="max-w-2xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-lg border border-[#a89048]/40 bg-black/40 px-3 py-2 text-xs font-bold uppercase tracking-[0.18em] text-[#d6bd74] backdrop-blur">
              <MapPin size={15} />
              Arapiraca-AL | Direito Criminal
            </div>
            <h1 className="text-[clamp(2.4rem,6vw,5.4rem)] font-medium leading-[0.98] tracking-normal text-white">
              Advocacia Criminal em Arapiraca
            </h1>
            <p className="mt-6 max-w-xl text-[clamp(1rem,1.6vw,1.25rem)] leading-relaxed text-[#d8d2c6]">
              Atendimento jurídico sigiloso em flagrantes, inquéritos,
              audiências de custódia e processos criminais.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button
                onClick={openWhatsapp}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[#25d366] px-6 text-base font-bold text-[#07110b] shadow-[0_18px_45px_rgba(37,211,102,0.22)] transition hover:bg-[#2ee273]"
              >
                Falar com advogado criminalista
                <ArrowRight size={19} />
              </button>
              <a
                href="#areas"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/10 px-6 text-base font-semibold text-white transition hover:border-[#a89048]/70 hover:bg-white/15"
              >
                Ver áreas atendidas
              </a>
            </div>
            <div className="mt-8 grid max-w-2xl grid-cols-1 gap-3 text-sm text-[#d8d2c6] sm:grid-cols-3">
              {trustItems.map(({ text, icon: Icon }) => (
                <div
                  key={text}
                  className="flex min-h-12 items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-3 backdrop-blur"
                >
                  <Icon className="h-4 w-4 shrink-0 text-[#d6bd74]" />
                  <span>{text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="areas" className="bg-[#0c0c0c] py-16 md:py-24">
        <div className="mx-auto max-w-7xl px-5 md:px-8">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#a89048]">
              Atuação criminal
            </p>
            <h2 className="mt-4 text-[clamp(1.9rem,4vw,3.4rem)] font-medium leading-tight text-white">
              Defesa técnica desde os primeiros atos da investigação.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-[#bdb6aa]">
              Em matéria criminal, agir com orientação adequada desde o início
              ajuda a preservar direitos, organizar provas e evitar decisões
              precipitadas.
            </p>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {practiceAreas.map(({ icon: Icon, title, description, href }) => (
              <article
                key={title}
                className="rounded-lg border border-white/10 bg-[#141414] p-6 transition hover:border-[#a89048]/60 hover:bg-[#171513]"
              >
                <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg border border-[#a89048]/40 bg-[#a89048]/10 text-[#d6bd74]">
                  <Icon size={22} />
                </div>
                <h3 className="text-xl font-semibold text-white">{title}</h3>
                <p className="mt-3 leading-relaxed text-[#aaa397]">
                  {description}
                </p>
                {href && (
                  <a
                    href={href}
                    className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-[#d6bd74] transition hover:text-white"
                  >
                    Ver página específica
                    <ArrowRight size={16} />
                  </a>
                )}
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#f4f0e6] py-16 text-[#151515] md:py-24">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 md:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#8b6630]">
              Atendimento sigiloso
            </p>
            <h2 className="mt-4 text-[clamp(1.9rem,4vw,3.2rem)] font-medium leading-tight">
              Clareza para agir em momentos de pressão.
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              "Orientação para quem recebeu intimação policial ou judicial.",
              "Atuação para familiares em casos de prisão em flagrante.",
              "Análise de documentos, provas, mensagens e histórico do caso.",
              "Comunicação objetiva sobre riscos, alternativas e próximos passos.",
            ].map((item) => (
              <div
                key={item}
                className="flex gap-3 rounded-lg border border-[#d7ccb7] bg-white/75 p-5"
              >
                <CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-[#8b6630]" />
                <p className="leading-relaxed text-[#3a3227]">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#0b0b0b] py-16 md:py-24">
        <div className="mx-auto max-w-7xl px-5 md:px-8">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#a89048]">
              Como funciona
            </p>
            <h2 className="mt-4 text-[clamp(1.9rem,4vw,3.2rem)] font-medium leading-tight text-white">
              Um atendimento direto, reservado e orientado por estratégia.
            </h2>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-4">
            {steps.map((step, index) => (
              <article
                key={step.title}
                className="rounded-lg border border-white/10 bg-[#131313] p-6"
              >
                <span className="text-sm font-bold text-[#a89048]">
                  0{index + 1}
                </span>
                <h3 className="mt-5 text-xl font-semibold text-white">
                  {step.title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-[#aaa397]">
                  {step.description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#111] py-16 md:py-24">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 md:px-8 lg:grid-cols-[1fr_0.85fr] lg:items-start">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#a89048]">
              Dúvidas frequentes
            </p>
            <h2 className="mt-4 text-[clamp(1.9rem,4vw,3.2rem)] font-medium leading-tight text-white">
              Perguntas comuns antes de falar com um advogado criminalista.
            </h2>
          </div>
          <div className="space-y-3">
            {faq.map((item) => (
              <details
                key={item.question}
                className="group rounded-lg border border-white/10 bg-[#181818] p-5"
              >
                <summary className="cursor-pointer list-none text-base font-semibold text-white">
                  <span className="flex items-center justify-between gap-4">
                    {item.question}
                    <Scale className="h-5 w-5 shrink-0 text-[#a89048]" />
                  </span>
                </summary>
                <p className="mt-4 leading-relaxed text-[#aaa397]">
                  {item.answer}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#f7f3ea] py-14 text-[#111]">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 md:flex-row md:items-center md:justify-between md:px-8">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#8b6630]">
              André Lustosa Advogados
            </p>
            <h2 className="mt-2 text-2xl font-semibold md:text-3xl">
              Precisa de orientação criminal em Arapiraca?
            </h2>
            <p className="mt-2 text-[#4a4033]">
              Rua Francisco Rodrigues Viana, 244, Baixa Grande, Arapiraca-AL.
            </p>
          </div>
          <button
            onClick={openWhatsapp}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[#111] px-6 font-bold text-white transition hover:bg-[#27231f]"
          >
            <Phone size={18} />
            Chamar no WhatsApp
          </button>
        </div>
      </section>

      <footer className="border-t border-white/10 bg-[#070707] py-8 text-sm text-[#8f897e]">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 md:flex-row md:items-center md:justify-between md:px-8">
          <span>
            © {new Date().getFullYear()} André Lustosa Advogados. OAB/AL
            14209.
          </span>
          <span>Atendimento presencial em Arapiraca e digital mediante agendamento.</span>
        </div>
      </footer>

      <button
        onClick={openWhatsapp}
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[#25d366] text-[#07110b] shadow-[0_14px_35px_rgba(37,211,102,0.32)] transition hover:scale-105"
        aria-label="Falar pelo WhatsApp"
      >
        <MessageCircle size={27} />
      </button>
    </div>
  );
}
