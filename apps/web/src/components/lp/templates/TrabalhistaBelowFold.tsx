"use client";

import { useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { ChevronRight, ChevronDown, ChevronUp, MapPin, Phone, Mail, Instagram, Clock, Briefcase, Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { LPTemplateContent } from "@/types/landing-page";

type TrabalhistaBelowFoldProps = {
  content: LPTemplateContent;
  city?: string;
  state?: string;
  onCtaClick: () => void;
  iconMap: Record<string, LucideIcon>;
};

/**
 * Conteúdo abaixo da dobra da LP Trabalhista (SECTION 2 → footer).
 * Extraído verbatim e carregado via next/dynamic(ssr:true) pelo template,
 * para não pesar o caminho crítico de hidratação do hero (ganho de LCP mobile).
 */
export function TrabalhistaBelowFold({
  content,
  city = "Arapiraca",
  state = "AL",
  onCtaClick,
  iconMap,
}: TrabalhistaBelowFoldProps) {
  const { faq = [], footer, practiceAreas = [] } = content;
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);
  const handleCtaClick = onCtaClick;

  return (
    <>
      {/* SECTION 2 — COMO POSSO TE AJUDAR (Checklist) */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <section
        id="about"
        className="py-16 md:py-24 overflow-hidden"
        style={{ background: "#f2f2f2" }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
            {/* Esquerda: Imagem */}
            <div className="flex justify-center">
              <Image
                src="/landing/advogado-andre-lustosa.webp"
                alt="Dr. André Lustosa — Advogado Trabalhista"
                width={560}
                height={660}
                className="object-contain w-full max-w-[500px]"
              />
            </div>

            {/* Direita: Checklist */}
            <div>
              <h2
                className="font-black leading-tight mb-3"
                style={{
                  color: "#1a1a1a",
                  fontSize: "clamp(1.75rem, 3vw, 2.5rem)",
                }}
              >
                Como posso te ajudar?
              </h2>
              <p className="mb-6 text-base" style={{ color: "#555555" }}>
                Abaixo, confira alguns exemplos de nossa área de atuação:
              </p>

              <div className="flex flex-col gap-3">
                {[
                  "Trabalho sem carteira assinada;",
                  "Seguro-desemprego",
                  "Reversão de justa causa;",
                  "Falta de pagamento de rescisão;",
                  "Rescisão indireta;",
                  "Horas extras;",
                  "Reintegração;",
                  "Assédio no local de trabalho e indenização por danos morais;",
                  "Acidente e doença do trabalho;",
                  "Insalubridade e periculosidade;",
                  "Adicional noturno;",
                  "Estabilidade de empregada grávida;",
                ].map((item, i) => (
                  <button
                    key={i}
                    onClick={handleCtaClick}
                    className="flex items-center gap-3 text-left group hover:opacity-80 transition-opacity cursor-pointer"
                  >
                    <div
                      className="w-6 h-6 shrink-0 flex items-center justify-center rounded-sm transition-colors"
                      style={{
                        border: "2px solid #A89048",
                        background: "transparent",
                      }}
                    >
                      <Check
                        className="w-3.5 h-3.5"
                        style={{ color: "#A89048" }}
                        strokeWidth={3}
                      />
                    </div>
                    <span
                      className="text-sm font-medium underline-offset-2 group-hover:underline"
                      style={{ color: "#2a2a2a" }}
                    >
                      {item}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* SECTION 3 — ETAPAS DO ATENDIMENTO */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <section id="steps" className="py-16 md:py-24 bg-[#0D0D0D] relative">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(168,144,72,0.03)_0%,transparent_70%)]" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <p className="text-[#A89048] font-bold text-xs uppercase tracking-widest mb-4 font-serif">
              PROCESSO
            </p>
            <h2 className="text-[clamp(1.5rem,3vw,2.25rem)] font-extrabold text-[#FAFAFA] uppercase mb-4 font-[family-name:var(--font-playfair)]">
              Como são as etapas do nosso atendimento?
            </h2>
            <p className="text-[#9a9a9a] max-w-3xl mx-auto text-[clamp(0.9rem,1.1vw,1.05rem)]">
              Entender o nosso processo de atendimento é essencial para
              assegurar que você está no caminho certo. Veja como funciona cada
              etapa:
            </p>
          </div>

          {/* 4-Step Timeline */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 relative">
            {/* Connecting line (desktop only) */}
            <div className="hidden lg:block absolute top-12 left-[12.5%] right-[12.5%] h-[2px] bg-[#A89048]/30" />

            {[
              {
                num: "1",
                title: "RECEBEMOS SEU CASO",
                desc: "Nossa Equipe fará o seu atendimento, coletando informações sobre o caso.",
              },
              {
                num: "2",
                title: "ESTUDAMOS O SEU CASO",
                desc: "Seu caso será estudado por uma equipe de advogados trabalhistas, que vão preparar o melhor plano para cobrar os seus direitos.",
              },
              {
                num: "3",
                title: "COLETAMOS EVIDÊNCIAS",
                desc: "Solicitamos todos os documentos e provas disponíveis, para garantir o sucesso da ação.",
              },
              {
                num: "4",
                title: "ANDAMENTO E RESULTADO",
                desc: "A equipe irá providenciar o protocolo da ação, cuidando dos trâmites burocráticos para garantir o sucesso da ação, mantendo o cliente informado sobre todos os passos do processo.",
              },
            ].map((step, idx) => (
              <div key={idx} className="flex flex-col items-center text-center">
                {/* Number circle */}
                <div className="relative z-10 w-24 h-24 rounded-full border-[3px] border-[#A89048] border-dashed flex items-center justify-center bg-[#0D0D0D] mb-6">
                  <span className="text-3xl font-black text-[#A89048] font-[family-name:var(--font-playfair)]">
                    {step.num}
                  </span>
                </div>
                <h3 className="font-black text-[#FAFAFA] text-sm uppercase tracking-wider mb-3 leading-tight">
                  {step.title}
                </h3>
                <p className="text-[#9a9a9a] text-sm leading-relaxed max-w-[260px]">
                  {step.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Gold divider */}
      <div className="h-px bg-gradient-to-r from-transparent via-[#A89048]/40 to-transparent" />

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* AUTHOR/LAWYER PROFILE SECTION */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <section className="py-16 md:py-24 bg-[#141414] relative overflow-hidden">
        {/* Subtle background glow */}
        <div className="absolute top-1/2 left-1/4 -translate-y-1/2 w-[500px] h-[500px] bg-[#A89048]/5 rounded-full blur-[120px] pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            {/* Esquerda: Texto */}
            <div className="order-2 lg:order-1">
              <h2 className="text-[clamp(1.75rem,4vw,2.5rem)] font-extrabold text-[#FAFAFA] leading-tight mb-2 font-[family-name:var(--font-playfair)]">
                Dr. André Lustosa
              </h2>
              <p className="text-[#A89048] font-bold text-sm tracking-widest mb-6">
                OAB/AL 14209
              </p>

              <div className="space-y-4 text-slate-300 text-base md:text-[17px] leading-relaxed mb-10">
                <p>
                  Sou advogado atuante desde 2016 e fundador do{" "}
                  <strong className="text-white">
                    escritório André Lustosa Advogados
                  </strong>
                  , onde nossa equipe atua com dedicação em causas{" "}
                  <strong className="text-white">
                    cíveis, trabalhistas, previdenciárias e de direito do
                    consumidor
                  </strong>
                  .
                </p>
                <p>
                  Nosso escritório conta com profissionais altamente
                  qualificados, preparados para oferecer um atendimento próximo,
                  ético e eficiente, sempre buscando as melhores soluções
                  jurídicas para cada cliente.
                </p>
                <p>
                  Ao longo da minha trajetória, construí uma atuação marcada
                  pela seriedade, transparência e compromisso com resultados,
                  transformando desafios jurídicos em conquistas reais para
                  aqueles que confiam no nosso trabalho.
                </p>
              </div>

              <Button
                onClick={handleCtaClick}
                size="lg"
                className="bg-[#25D366] hover:bg-[#20bd5a] text-white font-bold text-base px-10 py-6 rounded-xl shadow-[0_10px_30px_rgba(37,211,102,0.25)] hover:shadow-[0_15px_40px_rgba(37,211,102,0.35)] transition-all duration-300 hover:scale-[1.02] uppercase tracking-wider w-full sm:w-auto"
              >
                FALAR COM ADVOGADO
              </Button>
            </div>

            {/* Direita: Imagem com moldura estilo "André Lustosa" vazada */}
            <div className="order-1 lg:order-2 flex justify-center lg:justify-end relative">
              <div className="relative w-full max-w-[450px]">
                {/* Decorative border lines */}
                <div className="absolute -top-4 -left-4 w-32 h-32 border-t-2 border-l-2 border-[#A89048]/40 rounded-tl-3xl pointer-events-none" />
                <div className="absolute -bottom-4 -right-4 w-32 h-32 border-b-2 border-r-2 border-[#A89048]/40 rounded-br-3xl pointer-events-none" />

                {/* Main image container */}
                <div className="relative bg-[#262626] rounded-sm overflow-hidden border border-white/5 shadow-2xl group">
                  
                  {/* The Image */}
                  <div className="relative z-10 aspect-[3/4] w-full">
                    <Image
                      src="/landing/advogado-andre-lustosa.webp"
                      alt="Dr. André Lustosa"
                      fill
                      className="object-cover object-top transition-transform duration-700 group-hover:scale-105"
                      sizes="(max-width: 768px) 100vw, 500px"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Gold divider */}
      <div className="h-px bg-gradient-to-r from-transparent via-[#A89048]/40 to-transparent" />

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* SECTION 4 — ÁREAS DE ATUAÇÃO TRABALHISTA (Cards) */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <section id="areas" className="py-16 md:py-24 bg-[#0A0A0A] relative">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(168,144,72,0.03)_0%,transparent_70%)]" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <p className="text-[#A89048] font-bold text-xs uppercase tracking-widest mb-4 font-serif">
              ÁREAS DE ATUAÇÃO TRABALHISTA
            </p>
            <h2 className="text-[clamp(1.5rem,3vw,2.25rem)] font-extrabold text-[#FAFAFA] leading-tight max-w-3xl mx-auto font-[family-name:var(--font-playfair)]">
              O escritório possui experiência em reclamações trabalhistas para
              pedidos diversos, como:
            </h2>
          </div>

          {/* Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {practiceAreas.map((area, idx) => {
              const Icon = iconMap[area.iconName] || Briefcase;
              const action = area.href ? (
                <a
                  href={area.href}
                  className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-[#A89048] transition-colors cursor-pointer group/link"
                >
                  <ChevronRight className="w-4 h-4 group-hover/link:translate-x-0.5 transition-transform" />
                  Ver página específica
                </a>
              ) : (
                <button
                  onClick={handleCtaClick}
                  className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-[#A89048] transition-colors cursor-pointer group/link"
                >
                  <ChevronRight className="w-4 h-4 group-hover/link:translate-x-0.5 transition-transform" />
                  Ler mais
                </button>
              );

              return (
                <div
                  key={idx}
                  className={`bg-linear-to-br from-[#1a1a1a] to-[#141414] rounded-2xl border border-[#A89048]/20 p-6 flex flex-col hover:border-[#A89048]/60 hover:shadow-[0_8px_30px_rgba(168,144,72,0.08)] hover:-translate-y-1 transition-all duration-300 group ${area.colSpan2 ? "lg:col-span-2" : ""}`}
                >
                  {/* Icon + Title */}
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 rounded-xl bg-[#A89048]/10 flex items-center justify-center shrink-0 border border-[#A89048]/20">
                      <Icon className="w-6 h-6 text-[#A89048]" />
                    </div>
                    <h3 className="font-bold text-[#FAFAFA] text-[15px] leading-tight">
                      {area.title}
                    </h3>
                  </div>

                  {/* Description */}
                  <p className="text-[#9a9a9a] text-sm leading-relaxed mb-5 flex-1">
                    {area.description}
                  </p>

                  {/* Link */}
                  {action}
                </div>
              );
            })}
          </div>

          {/* CTA */}
          <div className="flex justify-center mt-14">
            <Button
              onClick={handleCtaClick}
              size="lg"
              className={`btn-premium h-auto w-full max-w-[calc(100vw-2rem)] sm:w-auto bg-linear-to-r from-[#e3c788] via-[#d4b568] to-[#c8aa62] text-slate-900 font-bold text-[clamp(0.9rem,1.2vw,1.25rem)] px-5 sm:px-12 py-5 sm:py-7 rounded-lg shadow-[0_72px_80px_rgba(168,144,72,0.14),0_30px_33px_rgba(168,144,72,0.1),0_16px_18px_rgba(168,144,72,0.08)] uppercase tracking-widest text-center !whitespace-normal transition-all duration-300`}
            >
              <span className="btn-premium-glow-overlay" />
              <span className="relative z-10 flex flex-wrap items-center justify-center gap-2 leading-tight">
                FALAR COM ADVOGADO TRABALHISTA
                <ChevronRight className="w-6 h-6 shrink-0" />
              </span>
            </Button>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* FAQ */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {faq.length > 0 && (
        <section id="faq" className="py-16 md:py-24 bg-[#0D0D0D] relative">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(168,144,72,0.03)_0%,transparent_70%)]" />
          <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-14">
              <p className="text-[#A89048] font-bold text-xs uppercase tracking-widest mb-4 font-serif">
                FAQ
              </p>
              <h2 className="text-[clamp(1.5rem,3vw,2.25rem)] font-extrabold text-[#FAFAFA] uppercase font-[family-name:var(--font-playfair)]">
                Dúvidas Frequentes
              </h2>
            </div>

            <div className="space-y-2">
              {faq.map((item, idx) => (
                <div
                  key={idx}
                  className="border border-[#A89048]/20 rounded-xl overflow-hidden hover:border-[#A89048]/40 transition-colors bg-[#1a1a1a]/50"
                >
                  <button
                    onClick={() =>
                      setOpenFaqIndex(openFaqIndex === idx ? null : idx)
                    }
                    className="w-full flex items-center justify-between p-4 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-[#A89048]/50 font-bold text-sm tabular-nums shrink-0">
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <span className="font-bold text-[#FAFAFA] text-sm md:text-base uppercase tracking-wide">
                        {item.question}
                      </span>
                    </div>
                    {openFaqIndex === idx ? (
                      <ChevronUp className="w-5 h-5 text-[#A89048] shrink-0 ml-4" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-slate-500 shrink-0 ml-4" />
                    )}
                  </button>
                  {openFaqIndex === idx && (
                    <div className="px-4 pb-4 pt-0">
                      <div className="h-px bg-[#A89048]/20 mb-3" />
                      <p className="text-[#9a9a9a] text-sm md:text-base leading-relaxed pl-9">
                        {item.answer}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* FOOTER */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <footer className="bg-[#0A0A0A] pt-16 pb-8 border-t border-[#A89048]/20">
        {/* Gold top line */}
        <div className="h-px bg-gradient-to-r from-transparent via-[#A89048]/40 to-transparent mb-16" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-3 gap-12 mb-12">
            {/* Logo + Description */}
            <div className="text-center md:text-left">
              <Image
                src="/landing/logo_andre_lustosa_transparente.webp"
                alt="André Lustosa Advogados"
                width={250}
                height={70}
                className="h-16 w-auto object-contain mx-auto md:mx-0 mb-4"
              />
              <p className="text-sm font-bold text-[#FAFAFA] mb-3">
                Escritório de Advocacia em Arapiraca – AL
              </p>
              <p className="text-[#9a9a9a] text-sm leading-relaxed">
                Atuamos com excelência técnica, visão estratégica e
                sensibilidade no atendimento. Com estrutura para atender
                presencialmente em Arapiraca e virtualmente em todo o Brasil.
              </p>
            </div>

            {/* Sitemap */}
            <div className="text-center">
              <h4 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-6">
                Mapa do Site
              </h4>
              <div className="space-y-3">
                {[
                  "Home",
                  "O Escritório",
                  "Áreas de Atuação",
                  "Blog",
                  "Equipe",
                  "Fale Conosco",
                ].map((item) => (
                  <button
                    key={item}
                    onClick={() =>
                      window.scrollTo({ top: 0, behavior: "smooth" })
                    }
                    className="block mx-auto text-[#9a9a9a] hover:text-[#A89048] transition-colors text-sm"
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            {/* Contacts */}
            <div className="text-center md:text-right">
              <h4 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-6">
                Contatos
              </h4>
              <div className="space-y-4">
                {footer?.phones?.map((phone, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 justify-center md:justify-end"
                  >
                    <div className="w-10 h-10 rounded-full border border-[#A89048]/30 flex items-center justify-center">
                      <Phone size={16} className="text-[#A89048]" />
                    </div>
                    <span className="text-[#9a9a9a] text-sm">{phone}</span>
                  </div>
                ))}
                {footer?.email && (
                  <div className="flex items-center gap-3 justify-center md:justify-end">
                    <div className="w-10 h-10 rounded-full border border-[#A89048]/30 flex items-center justify-center">
                      <Mail size={16} className="text-[#A89048]" />
                    </div>
                    <span className="text-[#9a9a9a] text-sm">
                      {footer.email}
                    </span>
                  </div>
                )}
                {footer?.social?.instagram && (
                  <div className="flex items-center gap-3 justify-center md:justify-end">
                    <div className="w-10 h-10 rounded-full border border-[#A89048]/30 flex items-center justify-center">
                      <Instagram size={16} className="text-[#A89048]" />
                    </div>
                    <span className="text-[#9a9a9a] text-sm">
                      @andrelustosaadvogados
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-3 justify-center md:justify-end">
                  <div className="w-10 h-10 rounded-full border border-[#A89048]/30 flex items-center justify-center">
                    <Clock size={16} className="text-[#A89048]" />
                  </div>
                  <span className="text-[#9a9a9a] text-sm">
                    Atendimento 24 Horas
                  </span>
                </div>
                <div className="flex items-center gap-3 justify-center md:justify-end">
                  <div className="w-10 h-10 rounded-full border border-[#A89048]/30 flex items-center justify-center">
                    <MapPin size={16} className="text-[#A89048]" />
                  </div>
                  <span className="text-[#9a9a9a] text-sm">{city}-{state}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row items-center justify-between gap-4 text-slate-500 text-xs">
            <p>
              &copy; 2026 – Todos os Direitos Reservados à André Lustosa
              Advogados.
            </p>
            <div className="flex gap-4">
              <a href="#" className="hover:text-[#A89048] transition-colors">
                Termos de Uso
              </a>
              <span>|</span>
              <a href="#" className="hover:text-[#A89048] transition-colors">
                Política de Privacidade
              </a>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
