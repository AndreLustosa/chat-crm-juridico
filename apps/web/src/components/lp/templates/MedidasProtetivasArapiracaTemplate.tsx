"use client";

import Image from "next/image";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Clock,
  FileCheck,
  FileText,
  HeartHandshake,
  MapPin,
  MessageCircle,
  PhoneCall,
  Scale,
  Shield,
} from "lucide-react";
import { trackWhatsappClick } from "../LPTracker";

const whatsappNumber = "5582996390799";
const whatsappHref = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(
  "Olá, vim da página de Medida Protetiva em Arapiraca e preciso de orientação jurídica sigilosa.",
)}`;

const urgencyItems = [
  "Você sofreu ameaça, agressão, perseguição, humilhação, controle financeiro ou intimidação.",
  "O agressor insiste em ligar, mandar mensagens, aparecer na sua casa ou se aproximar dos seus filhos.",
  "Você já registrou ocorrência, mas ainda não sabe como acompanhar o pedido de proteção.",
  "Existe uma medida protetiva, mas houve tentativa de contato, aproximação ou descumprimento.",
];

const services = [
  {
    icon: Shield,
    title: "Pedido de medida protetiva",
    description:
      "Organização dos fatos, provas e documentos para buscar proteção judicial com clareza e segurança.",
  },
  {
    icon: FileText,
    title: "Acompanhamento da vítima",
    description:
      "Análise do boletim de ocorrência, decisões, intimações e providências depois do pedido.",
  },
  {
    icon: Scale,
    title: "Audiências e decisões",
    description:
      "Atuação técnica em audiência e pedidos relacionados à manutenção, ampliação ou revisão da proteção.",
  },
  {
    icon: BadgeCheck,
    title: "Descumprimento de medida",
    description:
      "Orientação sobre como documentar o descumprimento e quais providências jurídicas podem ser adotadas.",
  },
  {
    icon: HeartHandshake,
    title: "Acolhimento com sigilo",
    description:
      "Escuta reservada, sem julgamento e com foco em segurança, direitos e próximos passos possíveis.",
  },
  {
    icon: Clock,
    title: "Resposta em situação urgente",
    description:
      "Direcionamento rápido quando há risco atual, audiência próxima ou decisão que precisa ser acompanhada.",
  },
];

const steps = [
  {
    num: "01",
    title: "Primeira conversa sigilosa",
    description:
      "Você relata a situação pelo WhatsApp, com discrição e sem exposição desnecessária.",
  },
  {
    num: "02",
    title: "Análise do risco",
    description:
      "Avaliamos ameaças, histórico, filhos envolvidos, documentos e medidas já existentes.",
  },
  {
    num: "03",
    title: "Caminho jurídico",
    description:
      "Explicamos o que pode ser pedido e como acompanhar a proteção sem prometer resultado.",
  },
  {
    num: "04",
    title: "Acompanhamento do caso",
    description:
      "Acompanhamos prazos, audiências, decisões e providências relevantes com comunicação clara.",
  },
];

const documents = [
  "Mensagens, áudios, ligações ou prints relevantes",
  "Boletim de ocorrência ou número do procedimento",
  "Intimações, decisões ou medidas já recebidas",
  "Dados de testemunhas ou pessoas que presenciaram fatos",
  "Fotos, vídeos, relatórios ou documentos médicos, se existirem",
  "Histórico de ameaças, perseguições, controle financeiro ou descumprimentos",
];

const faq = [
  {
    question: "Medida protetiva precisa de advogado?",
    answer:
      "A mulher pode procurar diretamente a autoridade policial, o Judiciário, a Defensoria ou o Ministério Público. A orientação de um advogado ajuda a organizar documentos, entender riscos, acompanhar decisões e adotar providências jurídicas adequadas.",
  },
  {
    question: "O escritório atende casos urgentes em Arapiraca?",
    answer:
      "Sim. O atendimento inicial pode ser feito pelo WhatsApp para entender a urgência e orientar os próximos passos. Em perigo imediato, acione a Polícia Militar pelo 190. Para orientação e denúncias, também existe o Ligue 180.",
  },
  {
    question: "Que tipos de violência podem justificar proteção?",
    answer:
      "Além da agressão física, a Lei Maria da Penha abrange violência psicológica, moral, sexual e patrimonial. A análise jurídica identifica quais fatos são relevantes para o pedido ou acompanhamento da medida.",
  },
  {
    question: "O atendimento é sigiloso?",
    answer:
      "Sim. As informações são tratadas com reserva profissional e usadas apenas para análise e condução jurídica do caso.",
  },
];

function openWhatsapp() {
  trackWhatsappClick();
  window.open(whatsappHref, "_blank", "noopener,noreferrer");
}

export function MedidasProtetivasArapiracaTemplate() {
  return (
    <div className="min-h-screen bg-[#080808] text-[#f7f3ea]">
      <section className="relative min-h-[94svh] overflow-hidden border-b border-[#a89048]/30">
        <Image
          src="/landing/medidas-protetivas-arapiraca-hero.png"
          alt="Medidas protetivas em Arapiraca - orientação jurídica sigilosa"
          fill
          priority
          sizes="100vw"
          className="object-cover object-[68%_center]"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,5,5,0.98)_0%,rgba(8,8,8,0.88)_34%,rgba(8,8,8,0.38)_66%,rgba(8,8,8,0.18)_100%)]" />
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
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#a89048]/40 bg-black/45 px-4 text-sm font-semibold text-[#f7f3ea] backdrop-blur transition hover:border-[#d5bd7a] hover:bg-black/65"
            >
              <MessageCircle size={17} />
              WhatsApp
            </button>
          </div>
        </div>

        <div className="relative z-10 mx-auto flex min-h-[94svh] max-w-7xl items-center px-5 pb-14 pt-24 md:px-8">
          <div className="max-w-2xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-lg border border-[#a89048]/40 bg-black/45 px-3 py-2 text-xs font-bold uppercase tracking-[0.18em] text-[#d6bd74] backdrop-blur">
              <MapPin size={15} />
              Arapiraca-AL | Violência doméstica
            </div>
            <h1 className="text-[clamp(2.35rem,5.9vw,5.2rem)] font-medium leading-[0.98] tracking-normal text-white">
              Medida protetiva para proteger você e sua família
            </h1>
            <p className="mt-6 max-w-xl text-[clamp(1rem,1.6vw,1.22rem)] leading-relaxed text-[#d8d2c6]">
              Atendimento jurídico sigiloso em Arapiraca para mulheres em
              situação de violência doméstica, ameaças, perseguição ou
              descumprimento de medida protetiva.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button
                onClick={openWhatsapp}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[#25d366] px-6 text-base font-bold text-[#07110b] shadow-[0_18px_45px_rgba(37,211,102,0.22)] transition hover:bg-[#2ee273]"
              >
                Quero orientação sigilosa
                <ArrowRight size={19} />
              </button>
              <a
                href="#como-ajudamos"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/10 px-6 text-base font-semibold text-white transition hover:border-[#a89048]/70 hover:bg-white/15"
              >
                Como funciona a proteção
              </a>
            </div>
            <div className="mt-8 rounded-lg border border-red-300/20 bg-red-950/25 p-4 text-sm leading-relaxed text-[#f2d4c8] backdrop-blur">
              <strong className="text-white">Está em perigo agora?</strong>{" "}
              Ligue 190. Para orientação e denúncias, use também o Ligue 180.
              O atendimento jurídico ajuda a acompanhar as providências legais
              com sigilo.
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#0c0c0c] py-16 md:py-24">
        <div className="mx-auto max-w-7xl px-5 md:px-8">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#a89048]">
              Sinais de alerta
            </p>
            <h2 className="mt-4 text-[clamp(1.9rem,4vw,3.3rem)] font-medium leading-tight text-white">
              A proteção pode ser necessária antes da violência escalar.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-[#bdb6aa]">
              A violência doméstica nem sempre começa com agressão física.
              Ameaças, controle, perseguição, humilhação e isolamento também
              precisam ser levados a sério.
            </p>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-2">
            {urgencyItems.map((item) => (
              <div
                key={item}
                className="flex min-h-20 gap-4 rounded-lg border border-white/10 bg-[#141414] p-5"
              >
                <AlertTriangle className="mt-1 h-5 w-5 shrink-0 text-[#d6bd74]" />
                <p className="leading-relaxed text-[#d8d2c6]">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="como-ajudamos" className="bg-[#141414] py-16 md:py-24">
        <div className="mx-auto max-w-7xl px-5 md:px-8">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#a89048]">
              Proteção jurídica
            </p>
            <h2 className="mt-4 text-[clamp(1.9rem,4vw,3.3rem)] font-medium leading-tight text-white">
              Cuidado no atendimento e firmeza nas providências legais.
            </h2>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {services.map(({ icon: Icon, title, description }) => (
              <article
                key={title}
                className="rounded-lg border border-white/10 bg-[#1a1a1a] p-6 transition hover:border-[#a89048]/60 hover:bg-[#1d1914]"
              >
                <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg border border-[#a89048]/40 bg-[#a89048]/10 text-[#d6bd74]">
                  <Icon size={22} />
                </div>
                <h3 className="text-xl font-semibold text-white">{title}</h3>
                <p className="mt-3 leading-relaxed text-[#aaa397]">
                  {description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#f4f0e6] py-16 text-[#151515] md:py-24">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 md:px-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#8b6630]">
              Provas seguras
            </p>
            <h2 className="mt-4 text-[clamp(1.9rem,4vw,3.2rem)] font-medium leading-tight">
              O que guardar para fortalecer o pedido?
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-[#4a4033]">
              Se for possível e seguro, preserve registros. Não confronte o
              agressor e não se coloque em risco para obter provas.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {documents.map((item) => (
              <div
                key={item}
                className="flex gap-3 rounded-lg border border-[#d7ccb7] bg-white/75 p-5"
              >
                <FileCheck className="mt-1 h-5 w-5 shrink-0 text-[#8b6630]" />
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
              Caminho seguro
            </p>
            <h2 className="mt-4 text-[clamp(1.9rem,4vw,3.2rem)] font-medium leading-tight text-white">
              Você não precisa organizar tudo sozinha.
            </h2>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-4">
            {steps.map((step) => (
              <article
                key={step.title}
                className="rounded-lg border border-white/10 bg-[#131313] p-6"
              >
                <span className="text-sm font-bold text-[#a89048]">
                  {step.num}
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
              Perguntas comuns sobre medidas protetivas.
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
              Precisa de proteção jurídica com sigilo?
            </h2>
            <p className="mt-2 text-[#4a4033]">
              Atendimento em Arapiraca-AL e online para mulheres em situação de
              violência doméstica.
            </p>
          </div>
          <button
            onClick={openWhatsapp}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[#111] px-6 font-bold text-white transition hover:bg-[#27231f]"
          >
            <PhoneCall size={19} />
            Falar pelo WhatsApp
          </button>
        </div>
      </section>

      <button
        onClick={openWhatsapp}
        className="fixed bottom-6 right-6 z-50 flex h-16 w-16 items-center justify-center rounded-full bg-[#25d366] text-[#07110b] shadow-[0_12px_36px_rgba(37,211,102,0.45)] transition hover:scale-105 hover:bg-[#2ee273]"
        aria-label="Falar pelo WhatsApp"
      >
        <MessageCircle size={30} />
      </button>
    </div>
  );
}
