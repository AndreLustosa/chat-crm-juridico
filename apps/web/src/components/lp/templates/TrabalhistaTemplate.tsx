"use client";

import React, { useState, useEffect, useRef } from "react";
import Image from "next/image";
import {
  MessageCircle,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  MapPin,
  Phone,
  Mail,
  Instagram,
  Facebook,
  Linkedin,
  MessageSquare,
  Shield,
  Scale,
  Menu,
  X,
  Clock,
  Briefcase,
  Users,
  FileText,
  AlertTriangle,
  HeartPulse,
  ShieldCheck,
  HardHat,
  CircleDollarSign,
  Gavel,
  FileCheck,
  Laptop,
  Trophy,
  Check,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LPTemplateContent } from "@/types/landing-page";
import { trackWhatsappClick } from "../LPTracker";

interface TrabalhistaTemplateProps {
  content: LPTemplateContent;
  whatsappNumber?: string;
  city?: string;
  state?: string;
}

const iconMap: Record<string, LucideIcon> = {
  Clock,
  Briefcase,
  Users,
  FileText,
  AlertTriangle,
  HeartPulse,
  ShieldCheck,
  HardHat,
  CircleDollarSign,
  Shield,
  Scale,
  Gavel,
  FileCheck,
};

export function TrabalhistaTemplate({
  content,
  whatsappNumber,
  city = "Arapiraca",
  state = "AL",
}: TrabalhistaTemplateProps) {
  const { hero, faq = [], footer, practiceAreas = [] } = content;
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);
  const [isShining, setIsShining] = useState(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handleScroll = () => {
      setIsShining(true);
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => setIsShining(false), 1200);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, []);

  const waLink = whatsappNumber
    ? `https://wa.me/${whatsappNumber.replace(/\D/g, "")}?text=Olá, vim do site e gostaria de uma consulta trabalhista!`
    : hero.ctaLink || "#";

  const handleCtaClick = () => {
    trackWhatsappClick();
    window.open(waLink, "_blank");
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-[#FAFAFA] font-[family-name:var(--font-ubuntu)] overflow-x-hidden">
      {/* ═══════════════════════════════════════════════════════════ */}
      {/* NAVBAR — idêntico ao HighConversionTemplate */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <nav className="absolute top-0 left-0 right-0 z-50 pointer-events-none transition-all duration-300">
        <div className="mx-auto w-[90vw] lg:w-[min(90rem,80vw)] px-4 sm:px-6 lg:px-8 flex items-center justify-between pointer-events-auto pt-6">
          {/* Desktop & Tablet: Full Unified Bar */}
          <div className="hidden md:flex flex-1 items-center justify-between bg-[#0A0A0A]/80 backdrop-blur-xl rounded-2xl border border-[#A89048]/30 py-4 px-8 shadow-[0_8px_32px_rgba(0,0,0,0.6)] transition-all duration-300 hover:bg-[#0A0A0A]/90">
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className="flex items-center hover:opacity-80 transition-opacity cursor-pointer focus:outline-none"
              aria-label="Voltar para o topo"
            >
              <Image
                src="/landing/logo_andre_lustosa_transparente.png"
                alt="André Lustosa Advogado"
                width={220}
                height={60}
                className="h-10 lg:h-12 w-auto object-contain"
              />
            </button>

            <div className="flex items-center gap-10">
              <div className="flex items-center gap-6 mr-4">
                <button
                  onClick={() =>
                    document
                      .getElementById("areas")
                      ?.scrollIntoView({ behavior: "smooth" })
                  }
                  className="text-[11px] font-bold text-slate-300 hover:text-[#FAFAFA] transition-colors uppercase tracking-widest px-2"
                >
                  Serviços
                </button>
                <button
                  onClick={() =>
                    document
                      .getElementById("about")
                      ?.scrollIntoView({ behavior: "smooth" })
                  }
                  className="text-[11px] font-bold text-slate-300 hover:text-[#FAFAFA] transition-colors uppercase tracking-widest px-2"
                >
                  Sobre
                </button>
                <button
                  onClick={() =>
                    document
                      .getElementById("steps")
                      ?.scrollIntoView({ behavior: "smooth" })
                  }
                  className="text-[11px] font-bold text-slate-300 hover:text-[#FAFAFA] transition-colors uppercase tracking-widest px-2"
                >
                  Processo
                </button>
                <div className="w-px h-4 bg-white/20 mx-1 hidden lg:block" />
                <a
                  href="/portal"
                  className="text-[11px] font-bold text-slate-300 hover:text-[#FAFAFA] transition-colors uppercase tracking-widest px-2 flex items-center gap-2"
                >
                  <Users size={14} className="text-[#A89048]" />
                  Portal do Cliente
                </a>
                <a
                  href="/atendimento/login"
                  className="text-[11px] font-bold text-[#A89048] hover:text-[#e3c788] transition-colors uppercase tracking-widest px-3 py-1.5 border border-[#A89048]/30 hover:border-[#A89048] rounded-md flex items-center gap-2"
                >
                  <Briefcase size={14} />
                  Área do Advogado
                </a>
              </div>
            </div>
          </div>

          {/* Mobile: Minimal Floating Sandwich */}
          <div className="md:hidden flex flex-1 justify-end">
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="p-3 bg-slate-900/20 backdrop-blur-xl text-[#A89048] border border-[#A89048]/30 rounded-full shadow-[0_12px_40px_rgba(0,0,0,0.6)] transition-all hover:scale-105 active:scale-95"
              aria-label="Menu"
            >
              {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>

        {/* Mobile Menu Dropdown */}
        {isMenuOpen && (
          <div className="md:hidden mt-4 bg-slate-900/40 backdrop-blur-2xl rounded-2xl border border-[#A89048]/30 p-6 flex flex-col gap-6 animate-in fade-in slide-in-from-top-4 duration-300 shadow-[0_20px_50px_rgba(0,0,0,0.5)] pointer-events-auto">
            <button
              onClick={() => {
                document
                  .getElementById("about")
                  ?.scrollIntoView({ behavior: "smooth" });
                setIsMenuOpen(false);
              }}
              className="text-sm font-bold text-slate-100 border-b border-[#A89048]/10 pb-2 text-left uppercase tracking-widest"
            >
              Sobre
            </button>
            <button
              onClick={() => {
                document
                  .getElementById("areas")
                  ?.scrollIntoView({ behavior: "smooth" });
                setIsMenuOpen(false);
              }}
              className="text-sm font-bold text-slate-100 border-b border-[#A89048]/10 pb-2 text-left uppercase tracking-widest"
            >
              Serviços
            </button>
            <button
              onClick={() => {
                document
                  .getElementById("steps")
                  ?.scrollIntoView({ behavior: "smooth" });
                setIsMenuOpen(false);
              }}
              className="text-sm font-bold text-slate-100 border-b border-[#A89048]/10 pb-2 text-left uppercase tracking-widest"
            >
              Como Funciona
            </button>
            <button
              onClick={() => {
                document
                  .getElementById("faq")
                  ?.scrollIntoView({ behavior: "smooth" });
                setIsMenuOpen(false);
              }}
              className="text-sm font-bold text-slate-100 border-b border-[#A89048]/10 pb-2 text-left uppercase tracking-widest"
            >
              Dúvidas Frequentes
            </button>
            <a
              href="/portal"
              className="text-sm font-bold text-slate-100 border-b border-[#A89048]/10 pb-2 text-left uppercase tracking-widest flex items-center gap-2"
            >
              <Users size={16} className="text-[#A89048]" />
              Portal do Cliente
            </a>
            <a
              href="/atendimento/login"
              className="text-sm font-bold text-[#A89048] border-b border-[#A89048]/10 pb-2 text-left uppercase tracking-widest flex items-center gap-2"
            >
              <Briefcase size={16} />
              Área do Advogado
            </a>
          </div>
        )}
      </nav>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* HERO — Estilo da LP de referência */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {/*
        HERO — layout correto (best practices 2025):
        - h-[100dvh]: altura total sem corte no mobile
        - flex flex-col: divide em navbar-spacer + área de conteúdo
        - div.flex-1.flex.items-center: conteúdo centralizado no espaço restante
        - fonte: clamp(min, vw + rem, max) — fórmula recomendada para escala suave
      */}
      <section
        className="relative w-full overflow-hidden flex flex-col"
        style={{ height: "100dvh" }}
      >
        {/* Background Image — responsivo com picture */}
        <div className="absolute inset-0 z-0">
          <picture>
            <source
              media="(min-width: 768px)"
              srcSet={
                hero.backgroundDesktop || "/landing/carteira-trabalho-hero.webp"
              }
            />
            <img
              src={
                hero.backgroundMobile ||
                "/landing/carteira-trabalho-mobile.webp"
              }
              alt="Carteira de Trabalho"
              className="absolute inset-0 w-full h-full object-cover md:object-center object-top"
              fetchPriority="high"
            />
          </picture>
        </div>
        {/* Overlay */}
        <div className="absolute inset-0 z-[1] bg-gradient-to-r from-black/80 via-black/50 to-transparent" />
        <div className="absolute inset-0 z-[1] bg-gradient-to-t from-black/60 via-transparent to-black/30" />

        {/* Espaço da navbar (absoluta, ~80px) */}
        <div className="h-20 shrink-0" />

        {/* Área de conteúdo — ocupa tudo abaixo da navbar e centraliza */}
        <div className="relative z-10 flex-1 flex items-center">
          <div className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-12 w-full">
            <div className="max-w-3xl xl:max-w-4xl 2xl:max-w-5xl">
              {/* Badges */}
              {/* Badges */}
              <div className="flex items-center gap-3 mb-6">
                <div className="flex items-center gap-2 bg-[#0A0A0A]/50 backdrop-blur-sm text-[#FAFAFA] px-3 py-1.5 rounded-md border border-[#A89048]/30 text-xs">
                  <Shield size={14} className="text-[#A89048]" />
                  <span className="font-semibold">Segurança</span>
                </div>
                <div className="flex items-center gap-2 bg-[#0A0A0A]/50 backdrop-blur-sm text-[#FAFAFA] px-3 py-1.5 rounded-md border border-[#A89048]/30 text-xs">
                  <Scale size={14} className="text-[#A89048]" />
                  <span className="font-semibold">Competência</span>
                </div>
              </div>

              {/* Title — clamp(min, vw + rem, max): escala suave em qualquer tela */}
              <h1 className="text-[#FAFAFA] leading-[1.05] mb-6">
                <span
                  className="block font-medium uppercase font-[family-name:var(--font-playfair)]"
                  style={{ fontSize: "clamp(2.5rem, 4vw + 1rem, 5.5rem)" }}
                >
                  {hero.title.split("\n")[0] || "Advogado"}
                </span>
                <span
                  className="block font-medium uppercase text-[#A89048] font-[family-name:var(--font-playfair)]"
                  style={{ fontSize: "clamp(2.5rem, 4vw + 1rem, 5.5rem)" }}
                >
                  {hero.title.split("\n")[1] || "Trabalhista em"}
                </span>
                <span
                  className="block font-medium uppercase font-[family-name:var(--font-playfair)]"
                  style={{ fontSize: "clamp(2.5rem, 4vw + 1rem, 5.5rem)" }}
                >
                  {hero.title.split("\n")[2] || "ARAPIRACA-AL"}
                </span>
              </h1>

              {hero.subtitle && (
                <p
                  className="text-[#9a9a9a] leading-relaxed mb-4 max-w-xl"
                  style={{ fontSize: "clamp(0.95rem, 1vw + 0.5rem, 1.2rem)" }}
                >
                  {hero.subtitle}
                </p>
              )}

              {hero.secondarySubtitle && (
                <p
                  className="text-[#9a9a9a] leading-relaxed mb-8 max-w-xl"
                  style={{ fontSize: "clamp(0.95rem, 1vw + 0.5rem, 1.2rem)" }}
                >
                  {hero.secondarySubtitle}
                </p>
              )}

              {/* CTA Button */}
              <button
                onClick={handleCtaClick}
                className="bg-[#25D366] hover:bg-[#20bd5a] text-white font-bold text-base md:text-lg px-10 py-4 rounded-xl shadow-[0_10px_40px_rgba(37,211,102,0.35)] uppercase tracking-wider transition-all duration-300 hover:scale-105 hover:shadow-[0_15px_50px_rgba(37,211,102,0.45)]"
              >
                {hero.ctaText || "FALAR COM ADVOGADO"}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* TRUST BAR — card abaixo do hero */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div
        className="py-5"
        style={{ background: "#f4f0e6", borderBottom: "2px solid #A89048" }}
      >
        <div className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-12">
          <div className="flex flex-col md:flex-row items-center gap-6 md:gap-10">
            {/* Título esquerdo */}
            <div className="shrink-0 text-center md:text-left">
              <p
                className="font-black text-xl leading-tight"
                style={{ color: "#1c1c1c" }}
              >
                Especialista em
                <br />
                causas trabalhistas
              </p>
            </div>

            {/* Divisor vertical */}
            <div
              className="hidden md:block w-px h-12 shrink-0"
              style={{ background: "#A89048", opacity: 0.5 }}
            />

            {/* 3 itens */}
            <div className="flex flex-col sm:flex-row items-center gap-8 flex-1 justify-around w-full">
              {[
                { Icon: Laptop, text: "100% Online e direto\nno seu WhatsApp" },
                {
                  Icon: Users,
                  text: `Atendimento Presencial\ne ágil para ${city}\ne Região`,
                },
                { Icon: Trophy, text: "Avaliação Gratuita\ndo Caso" },
              ].map(({ Icon, text }, i) => (
                <div key={i} className="flex items-center gap-4">
                  <div
                    className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0"
                    style={{ border: "2px solid #A89048" }}
                  >
                    <Icon
                      className="w-7 h-7"
                      style={{ color: "#A89048" }}
                      strokeWidth={1.5}
                    />
                  </div>
                  <p
                    className="text-sm font-medium leading-snug whitespace-pre-line"
                    style={{ color: "#2a2a2a" }}
                  >
                    {text}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════ */}
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
                      src="https://framerusercontent.com/images/JPKhS2hs5A6C1FbCO8XVVvGW5s.webp"
                      alt="Dr. André Lustosa"
                      fill
                      unoptimized
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
                  <button
                    onClick={handleCtaClick}
                    className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-[#A89048] transition-colors cursor-pointer group/link"
                  >
                    <ChevronRight className="w-4 h-4 group-hover/link:translate-x-0.5 transition-transform" />
                    Ler mais
                  </button>
                </div>
              );
            })}
          </div>

          {/* CTA */}
          <div className="flex justify-center mt-14">
            <Button
              onClick={handleCtaClick}
              size="lg"
              className={`btn-premium bg-linear-to-r from-[#e3c788] via-[#d4b568] to-[#c8aa62] text-slate-900 font-bold text-[clamp(0.9rem,1.2vw,1.25rem)] px-12 py-7 rounded-lg shadow-[0_72px_80px_rgba(168,144,72,0.14),0_30px_33px_rgba(168,144,72,0.1),0_16px_18px_rgba(168,144,72,0.08)] uppercase tracking-widest transition-all duration-300 ${isShining ? "is-shining scale-105 shadow-xl" : ""}`}
            >
              <span className="btn-premium-glow-overlay" />
              <span className="relative z-10 flex items-center">
                FALAR COM ADVOGADO TRABALHISTA
                <ChevronRight className="ml-2 w-6 h-6" />
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
                src="/landing/logo_andre_lustosa_transparente.png"
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

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* HIGH CONVERSION FLOATING WHATSAPP BUTTON */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <button
        onClick={handleCtaClick}
        className="fixed bottom-6 right-6 md:bottom-8 md:right-8 z-50 w-16 h-16 bg-linear-to-r from-[#20bd5a] to-[#25D366] hover:from-[#1da851] hover:to-[#20bd5a] text-white rounded-full shadow-[0_4px_20px_rgba(37,211,102,0.5)] flex items-center justify-center transition-all duration-300 hover:scale-[1.15] animate-bounce hover:animate-none group"
        aria-label="Fale pelo WhatsApp"
      >
        <div className="absolute inset-0 bg-[#25D366] rounded-full blur-md opacity-30 group-hover:opacity-60 transition-opacity"></div>
        <MessageCircle size={30} fill="white" className="relative z-10" />
      </button>
    </div>
  );
}
