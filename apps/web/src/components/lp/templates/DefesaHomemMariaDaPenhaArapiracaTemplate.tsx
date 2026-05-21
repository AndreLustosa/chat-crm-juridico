"use client";

import Image from "next/image";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Ban,
  CheckCircle2,
  Clock,
  FileCheck,
  FileSearch,
  LockKeyhole,
  MapPin,
  MessageCircle,
  PhoneCall,
  Scale,
  ShieldAlert,
  UserCheck,
} from "lucide-react";
import { trackWhatsappClick, appendRefToWaLink } from "../LPTracker";

const whatsappNumber = "5582996390799";
const whatsappHref = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(
  "Olá, vim da página de defesa na Lei Maria da Penha em Arapiraca e preciso de orientação reservada.",
)}`;

const situations = [
  "Você recebeu intimação policial ou judicial e não sabe o que falar.",
  "Foi surpreendido por medida protetiva, afastamento do lar ou proibição de contato.",
  "Existe acusação que você considera injusta, exagerada ou baseada em mensagens fora de contexto.",
  "Há filhos, patrimônio, reputação profissional ou convivência familiar em risco.",
];

const services = [
  {
    icon: FileSearch,
    title: "Análise da acusação",
    description:
      "Leitura técnica de boletim, intimação, prints, áudios, decisões e histórico do relacionamento para entender o risco real do caso.",
  },
  {
    icon: ShieldAlert,
    title: "Defesa em medida protetiva",
    description:
      "Atuação para contestar, revisar ou delimitar medidas quando houver fatos, provas e fundamentos jurídicos para isso.",
  },
  {
    icon: UserCheck,
    title: "Preparação para depoimento",
    description:
      "Orientação antes de comparecer à delegacia ou audiência, com clareza sobre direitos, limites e cuidados na fala.",
  },
  {
    icon: Scale,
    title: "Inquérito e processo criminal",
    description:
      "Defesa técnica em investigação, ação penal, audiência, pedidos urgentes e acompanhamento das decisões do caso.",
  },
  {
    icon: Ban,
    title: "Prevenção de agravamento",
    description:
      "Orientação para evitar descumprimento de medida, contato indevido, exposição pública ou atitudes que piorem a situação.",
  },
  {
    icon: LockKeyhole,
    title: "Atendimento reservado",
    description:
      "Conversa sigilosa, objetiva e sem julgamento para organizar os fatos e definir uma estratégia proporcional ao caso.",
  },
];

const steps = [
  {
    num: "01",
    title: "Contato reservado",
    description:
      "Você explica o que aconteceu e envia, se tiver, intimações, decisões, prints, áudios ou documentos relevantes.",
  },
  {
    num: "02",
    title: "Mapeamento do risco",
    description:
      "Avaliamos se há medida vigente, prazo, audiência marcada, risco de prisão ou restrições que precisam ser obedecidas.",
  },
  {
    num: "03",
    title: "Organização das provas",
    description:
      "Separação do que ajuda a demonstrar contexto, contradições, histórico, localização, testemunhas e boa-fé.",
  },
  {
    num: "04",
    title: "Estratégia de defesa",
    description:
      "Definição dos próximos atos para delegacia, processo, audiência ou revisão de medidas, sem promessa de resultado.",
  },
];

const cautions = [
  "Não procure a outra parte se existir ordem de afastamento ou proibição de contato.",
  "Não apague conversas, áudios, comprovantes, registros de localização ou documentos.",
  "Não publique acusações, indiretas ou versões do caso em redes sociais.",
  "Não vá depor sem entender antes seus direitos e os riscos da situação.",
  "Guarde decisões, intimações e qualquer comunicação oficial recebida.",
  "Anote datas, locais, testemunhas e fatos importantes enquanto a memória está recente.",
];

const faq = [
  {
    question: "Fui acusado injustamente. O que devo fazer primeiro?",
    answer:
      "Evite contato com a outra parte, preserve provas e busque orientação antes de depor ou responder mensagens. A defesa deve ser construída com documentos, contexto e estratégia, não com exposição pública.",
  },
  {
    question: "Posso falar com a mulher para resolver a situação?",
    answer:
      "Se existir medida protetiva com proibição de contato ou aproximação, não. Descumprir a ordem pode gerar consequências graves. O caminho seguro é tratar qualquer providência por meio jurídico.",
  },
  {
    question: "Medida protetiva significa condenação criminal?",
    answer:
      "Não necessariamente. A medida protetiva é uma decisão de proteção e pode existir antes de uma condenação. Ainda assim, precisa ser levada a sério e cumprida enquanto estiver vigente.",
  },
  {
    question: "O escritório atende casos urgentes em Arapiraca?",
    answer:
      "Sim. O atendimento inicial pode ser feito pelo WhatsApp para entender a urgência, analisar documentos e orientar os próximos passos possíveis.",
  },
];

function openWhatsapp() {
  trackWhatsappClick();
  window.open(appendRefToWaLink(whatsappHref), "_blank", "noopener,noreferrer");
}

export function DefesaHomemMariaDaPenhaArapiracaTemplate() {
  return (
    <div className="min-h-screen bg-[#07090d] text-[#f7f3ea]">
      <section className="relative min-h-[94svh] overflow-hidden border-b border-[#a89048]/30">
        <Image
          src="/landing/defesa-homem-maria-da-penha-hero.png"
          alt="Defesa do homem na Lei Maria da Penha em Arapiraca"
          fill
          priority
          sizes="100vw"
          className="object-cover object-[66%_center]"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,6,9,0.98)_0%,rgba(7,9,13,0.9)_34%,rgba(7,9,13,0.48)_66%,rgba(7,9,13,0.2)_100%)]" />
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
              Arapiraca-AL | Defesa na Lei Maria da Penha
            </div>
            <h1 className="text-[clamp(2.35rem,5.7vw,5.05rem)] font-medium leading-[0.98] tracking-normal text-white">
              Acusado injustamente? Sua defesa precisa começar agora.
            </h1>
            <p className="mt-6 max-w-xl text-[clamp(1rem,1.55vw,1.2rem)] leading-relaxed text-[#d8d2c6]">
              Atendimento jurídico reservado para homens que receberam
              intimação, medida protetiva ou acusação na Lei Maria da Penha em
              Arapiraca.
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
                href="#cuidados"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/10 px-6 text-base font-semibold text-white transition hover:border-[#a89048]/70 hover:bg-white/15"
              >
                O que evitar imediatamente
              </a>
            </div>
            <div className="mt-8 rounded-lg border border-[#a89048]/25 bg-black/45 p-4 text-sm leading-relaxed text-[#efe5cf] backdrop-blur">
              <strong className="text-white">Atenção:</strong> se já existe
              medida protetiva, cumpra integralmente a decisão enquanto a defesa
              avalia os caminhos jurídicos. Uma atitude impulsiva pode piorar o
              caso.
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#0b0d12] py-16 md:py-24">
        <div className="mx-auto max-w-7xl px-5 md:px-8">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#a89048]">
              Quando procurar defesa
            </p>
            <h2 className="mt-4 text-[clamp(1.9rem,4vw,3.3rem)] font-medium leading-tight text-white">
              Em uma acusação, o improviso pode custar caro.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-[#bdb6aa]">
              A Lei Maria da Penha deve ser tratada com seriedade. Quando o
              homem entende que está sendo acusado injustamente, a resposta
              precisa ser técnica, documentada e responsável.
            </p>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-2">
            {situations.map((item) => (
              <div
                key={item}
                className="flex min-h-20 gap-4 rounded-lg border border-white/10 bg-[#12151d] p-5"
              >
                <AlertTriangle className="mt-1 h-5 w-5 shrink-0 text-[#d6bd74]" />
                <p className="leading-relaxed text-[#d8d2c6]">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#11141b] py-16 md:py-24">
        <div className="mx-auto max-w-7xl px-5 md:px-8">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#a89048]">
              Defesa técnica
            </p>
            <h2 className="mt-4 text-[clamp(1.9rem,4vw,3.3rem)] font-medium leading-tight text-white">
              Estratégia, provas e postura correta desde o primeiro contato.
            </h2>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {services.map(({ icon: Icon, title, description }) => (
              <article
                key={title}
                className="rounded-lg border border-white/10 bg-[#171a22] p-6 transition hover:border-[#a89048]/60 hover:bg-[#1b1a18]"
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

      <section id="cuidados" className="bg-[#f4f0e6] py-16 text-[#151515] md:py-24">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 md:px-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#8b6630]">
              Primeiras atitudes
            </p>
            <h2 className="mt-4 text-[clamp(1.9rem,4vw,3.2rem)] font-medium leading-tight">
              O que você faz nas primeiras horas pode mudar o rumo da defesa.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-[#4a4033]">
              Antes de tentar resolver sozinho, preserve provas e evite qualquer
              atitude que possa ser interpretada como pressão, ameaça ou
              descumprimento.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {cautions.map((item) => (
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

      <section className="bg-[#0b0d12] py-16 md:py-24">
        <div className="mx-auto max-w-7xl px-5 md:px-8">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#a89048]">
              Como funciona
            </p>
            <h2 className="mt-4 text-[clamp(1.9rem,4vw,3.2rem)] font-medium leading-tight text-white">
              Defesa com método, sem exposição desnecessária.
            </h2>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-4">
            {steps.map((step) => (
              <article
                key={step.title}
                className="rounded-lg border border-white/10 bg-[#131722] p-6"
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
              Perguntas comuns de quem foi acusado na Lei Maria da Penha.
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
              Recebeu intimação ou medida protetiva?
            </h2>
            <p className="mt-2 text-[#4a4033]">
              Atendimento reservado em Arapiraca-AL e online mediante
              agendamento.
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

      <footer className="border-t border-white/10 bg-[#070707] py-8 text-sm text-[#8f897e]">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 md:flex-row md:items-center md:justify-between md:px-8">
          <span>
            © {new Date().getFullYear()} André Lustosa Advogados. OAB/AL
            14209.
          </span>
          <span>Atuação criminal em Arapiraca e atendimento digital.</span>
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
