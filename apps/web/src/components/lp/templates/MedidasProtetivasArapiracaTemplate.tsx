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
  "Olá, vim da página de Medidas Protetivas em Arapiraca e preciso de orientação jurídica.",
)}`;

const urgencyItems = [
  "Recebeu ameaça, perseguição, agressão ou intimidação no ambiente familiar.",
  "Precisa entender como pedir, acompanhar ou contestar medidas protetivas.",
  "Tem audiência marcada ou recebeu intimação sobre Lei Maria da Penha.",
  "Quer organizar provas, mensagens, boletins ou documentos antes de agir.",
];

const services = [
  {
    icon: Shield,
    title: "Pedido de medidas protetivas",
    description:
      "Orientação jurídica para organizar fatos, documentos e próximos passos em situações de risco.",
  },
  {
    icon: FileText,
    title: "Acompanhamento do procedimento",
    description:
      "Análise de boletim de ocorrência, intimações, decisões e comunicações recebidas.",
  },
  {
    icon: Scale,
    title: "Audiências e manifestações",
    description:
      "Atuação técnica em audiências, pedidos de revisão, esclarecimentos e defesas cabíveis.",
  },
  {
    icon: BadgeCheck,
    title: "Descumprimento de medida",
    description:
      "Avaliação jurídica sobre descumprimento, provas, urgência e providências adequadas ao caso.",
  },
  {
    icon: HeartHandshake,
    title: "Atendimento sigiloso",
    description:
      "Conversa reservada para entender o cenário com cuidado, respeito e objetividade.",
  },
  {
    icon: Clock,
    title: "Urgência em Arapiraca",
    description:
      "Direcionamento rápido quando a situação exige resposta jurídica imediata.",
  },
];

const steps = [
  {
    num: "01",
    title: "Contato reservado",
    description:
      "Você explica o que aconteceu pelo WhatsApp, com sigilo e sem exposição desnecessária.",
  },
  {
    num: "02",
    title: "Análise da urgência",
    description:
      "Avaliamos risco, documentos, mensagens, boletim de ocorrência e intimações existentes.",
  },
  {
    num: "03",
    title: "Orientação jurídica",
    description:
      "Indicamos os caminhos possíveis para pedido, acompanhamento, revisão ou defesa.",
  },
  {
    num: "04",
    title: "Acompanhamento",
    description:
      "Seguimos com comunicação clara sobre prazos, audiências e providências relevantes.",
  },
];

const documents = [
  "Mensagens, áudios, ligações ou prints relevantes",
  "Boletim de ocorrência ou número do procedimento",
  "Intimações, decisões ou medidas já recebidas",
  "Dados de testemunhas ou pessoas que presenciaram fatos",
  "Fotos, vídeos, relatórios ou documentos médicos, se existirem",
  "Histórico de ameaças, perseguições ou descumprimentos",
];

const faq = [
  {
    question: "Medida protetiva precisa de advogado?",
    answer:
      "A vítima pode procurar a autoridade policial ou o Judiciário, mas a orientação de um advogado ajuda a organizar documentos, entender riscos, acompanhar decisões e adotar providências jurídicas adequadas.",
  },
  {
    question: "O escritório atende casos urgentes em Arapiraca?",
    answer:
      "Sim. O atendimento inicial pode ser feito pelo WhatsApp para entender a urgência e orientar os próximos passos. Em risco imediato, acione a Polícia Militar pelo 190 ou procure a Delegacia.",
  },
  {
    question: "Também atuam para quem recebeu uma medida protetiva?",
    answer:
      "Sim. O escritório analisa a decisão, intimações, provas e possibilidades jurídicas cabíveis, sempre com atuação técnica e responsável.",
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
              Arapiraca-AL | Lei Maria da Penha
            </div>
            <h1 className="text-[clamp(2.35rem,5.9vw,5.2rem)] font-medium leading-[0.98] tracking-normal text-white">
              Medidas protetivas em Arapiraca
            </h1>
            <p className="mt-6 max-w-xl text-[clamp(1rem,1.6vw,1.22rem)] leading-relaxed text-[#d8d2c6]">
              Orientação jurídica sigilosa para pedidos, acompanhamento,
              descumprimento ou defesa em medidas protetivas ligadas à Lei
              Maria da Penha.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button
                onClick={openWhatsapp}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[#25d366] px-6 text-base font-bold text-[#07110b] shadow-[0_18px_45px_rgba(37,211,102,0.22)] transition hover:bg-[#2ee273]"
              >
                Falar com advogado agora
                <ArrowRight size={19} />
              </button>
              <a
                href="#como-ajudamos"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/10 px-6 text-base font-semibold text-white transition hover:border-[#a89048]/70 hover:bg-white/15"
              >
                Entender a atuação
              </a>
            </div>
            <div className="mt-8 rounded-lg border border-red-300/20 bg-red-950/25 p-4 text-sm leading-relaxed text-[#f2d4c8] backdrop-blur">
              <strong className="text-white">Risco imediato?</strong> Acione a
              Polícia Militar pelo 190 ou procure a Delegacia. O atendimento
              jurídico entra para orientar e acompanhar as providências legais.
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#0c0c0c] py-16 md:py-24">
        <div className="mx-auto max-w-7xl px-5 md:px-8">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#a89048]">
              Situações comuns
            </p>
            <h2 className="mt-4 text-[clamp(1.9rem,4vw,3.3rem)] font-medium leading-tight text-white">
              Quando procurar orientação sobre medidas protetivas?
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-[#bdb6aa]">
              Cada caso precisa ser analisado com cuidado. A orientação jurídica
              ajuda a organizar fatos, preservar provas e evitar decisões tomadas
              apenas sob pressão.
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
              Como ajudamos
            </p>
            <h2 className="mt-4 text-[clamp(1.9rem,4vw,3.3rem)] font-medium leading-tight text-white">
              Atuação técnica, sigilosa e responsável em Arapiraca.
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
              Documentos e provas
            </p>
            <h2 className="mt-4 text-[clamp(1.9rem,4vw,3.2rem)] font-medium leading-tight">
              O que reunir antes do atendimento?
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-[#4a4033]">
              Se for possível e seguro, separar informações ajuda na análise
              inicial. Não se coloque em risco para buscar documentos.
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
              Atendimento
            </p>
            <h2 className="mt-4 text-[clamp(1.9rem,4vw,3.2rem)] font-medium leading-tight text-white">
              Um caminho claro para decidir o próximo passo.
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
              Precisa de orientação sobre medidas protetivas?
            </h2>
            <p className="mt-2 text-[#4a4033]">
              Atendimento em Arapiraca-AL e online, com sigilo e cuidado.
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
