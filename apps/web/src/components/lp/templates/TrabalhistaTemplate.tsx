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
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LPTemplateContent } from "@/types/landing-page";
import { trackWhatsappClick } from "../LPTracker";

interface TrabalhistaTemplateProps {
  content: LPTemplateContent;
  whatsappNumber?: string;
}

const iconMap: Record<string, LucideIcon> = {
  Clock, Briefcase, Users, FileText, AlertTriangle, HeartPulse,
  ShieldCheck, HardHat, CircleDollarSign, Shield, Scale, Gavel, FileCheck,
};

export function TrabalhistaTemplate({
  content,
  whatsappNumber,
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
    <div className="min-h-screen bg-[#f8f8f8] text-slate-900 font-sans overflow-x-hidden">

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* NAVBAR */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <nav className="absolute top-0 left-0 right-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="hover:opacity-80 transition-opacity"
          >
            <Image
              src="/landing/logo_andre_lustosa_transparente.png"
              alt="André Lustosa Advogados"
              width={220}
              height={60}
              className="h-12 w-auto object-contain"
            />
          </button>

          {/* Mobile hamburger */}
          <div className="md:hidden">
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="p-3 bg-slate-900/40 backdrop-blur-xl text-[#A89048] border border-[#A89048]/30 rounded-full"
            >
              {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>

        {isMenuOpen && (
          <div className="md:hidden mx-4 mt-2 bg-slate-900/90 backdrop-blur-2xl rounded-2xl border border-[#A89048]/30 p-6 flex flex-col gap-4">
            {["about", "steps", "areas", "faq"].map((id) => (
              <button
                key={id}
                onClick={() => { document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }); setIsMenuOpen(false); }}
                className="text-white text-sm font-bold uppercase tracking-widest hover:text-[#A89048] transition-colors text-left"
              >
                {id === "about" ? "Sobre" : id === "steps" ? "Processo" : id === "areas" ? "Serviços" : "FAQ"}
              </button>
            ))}
            <button onClick={handleCtaClick} className="bg-[#25D366] text-white font-bold py-3 rounded-lg text-sm uppercase tracking-wider">
              Falar com Advogado
            </button>
          </div>
        )}
      </nav>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* HERO — Estilo da LP de referência */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <section className="relative min-h-[100vh] md:min-h-[85vh] w-full flex items-center overflow-hidden">
        {/* Background Image — responsivo com picture */}
        <div className="absolute inset-0 z-0">
          <picture>
            <source
              media="(min-width: 768px)"
              srcSet={hero.backgroundDesktop || "/landing/carteira-trabalho-hero.webp"}
            />
            <img
              src={hero.backgroundMobile || "/landing/carteira-trabalho-mobile.webp"}
              alt="Carteira de Trabalho"
              className="absolute inset-0 w-full h-full object-cover md:object-center object-top"
              fetchPriority="high"
            />
          </picture>
        </div>
        {/* Overlay — mais leve como na referência */}
        <div className="absolute inset-0 z-[1] bg-gradient-to-r from-[#1a1a1a]/75 via-[#1a1a1a]/45 to-[#1a1a1a]/20" />
        <div className="absolute inset-0 z-[1] bg-gradient-to-t from-[#1a1a1a]/50 via-transparent to-[#1a1a1a]/20" />

        {/* Watermark — texto lateral como na referência */}
        <div className="absolute right-6 md:right-12 top-1/2 -translate-y-1/2 z-[2] hidden lg:block pointer-events-none select-none">
          <p
            className="text-white/[0.06] text-[4.5rem] font-black uppercase leading-none tracking-[0.15em]"
            style={{ fontFamily: "var(--font-playfair), serif", writingMode: "vertical-rl", textOrientation: "mixed" }}
          >
            André Lustosa Advogados
          </p>
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-16 w-full">
          <div className="max-w-2xl">
            {/* Badges — abaixo do logo, à esquerda, como na referência */}
            <div className="flex items-center gap-3 mb-6 mt-2">
              <div className="flex items-center gap-2 bg-[#1a1a1a]/50 backdrop-blur-sm text-white px-3 py-1.5 rounded-md border border-[#A89048]/30 text-xs">
                <Shield size={14} className="text-[#A89048]" />
                <span className="font-semibold">Segurança</span>
              </div>
              <div className="flex items-center gap-2 bg-[#1a1a1a]/50 backdrop-blur-sm text-white px-3 py-1.5 rounded-md border border-[#A89048]/30 text-xs">
                <Scale size={14} className="text-[#A89048]" />
                <span className="font-semibold">Competência</span>
              </div>
            </div>

            {/* Title */}
            <h1 className="text-white leading-[1.05] mb-8">
              <span className="block text-[clamp(2.5rem,6vw,4.5rem)] font-black" style={{ fontFamily: "var(--font-playfair), serif" }}>
                Advogado
              </span>
              <span className="block text-[clamp(2.5rem,6vw,4.5rem)] font-black text-[#A89048]" style={{ fontFamily: "var(--font-playfair), serif" }}>
                Trabalhista em
              </span>
              <span className="block text-[clamp(2.5rem,6vw,4.5rem)] font-black" style={{ fontFamily: "var(--font-playfair), serif" }}>
                ARAPIRACA-AL
              </span>
            </h1>

            {/* Subtitle */}
            {hero.subtitle && (
              <p className="text-white font-bold text-[clamp(1rem,2vw,1.35rem)] leading-relaxed mb-4">
                &quot;{hero.subtitle}&quot;
              </p>
            )}

            {hero.secondarySubtitle && (
              <p className="text-white/80 text-[clamp(0.95rem,1.5vw,1.15rem)] leading-relaxed mb-10 max-w-xl">
                &quot;{hero.secondarySubtitle}&quot;
              </p>
            )}

            {/* CTA Button — Verde como na referência */}
            <button
              onClick={handleCtaClick}
              className="bg-[#25D366] hover:bg-[#20bd5a] text-white font-bold text-lg md:text-xl px-10 py-5 rounded-xl shadow-[0_10px_40px_rgba(37,211,102,0.35)] uppercase tracking-wider transition-all duration-300 hover:scale-105 hover:shadow-[0_15px_50px_rgba(37,211,102,0.45)]"
            >
              FALAR COM ADVOGADO
            </button>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* SECTION 2 — SOBRE O ADVOGADO (Bio) */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <section id="about" className="py-16 md:py-24 bg-[#242526] relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left: Text */}
            <div className="text-white space-y-6 order-2 lg:order-1">
              <p className="text-[#A89048] font-bold text-sm uppercase tracking-widest">
                OAB/AL 14290
              </p>
              <div className="space-y-5 text-[clamp(1rem,1.2vw,1.15rem)] leading-relaxed text-gray-300">
                <p>
                  Sou advogado atuante desde 2016 e fundador do escritório{" "}
                  <strong className="text-white">André Lustosa Advogados</strong>, onde nossa equipe
                  atua com dedicação em causas <strong className="text-white">cíveis, trabalhistas,
                  previdenciárias e de direito do consumidor</strong>.
                </p>
                <p>
                  Nosso escritório conta com profissionais altamente qualificados,
                  preparados para oferecer um atendimento próximo, ético e eficiente,
                  sempre buscando as melhores soluções jurídicas para cada cliente.
                </p>
                <p>
                  Ao longo da minha trajetória, construí uma atuação marcada pela
                  seriedade, transparência e compromisso com resultados, transformando
                  desafios jurídicos em conquistas reais para aqueles que confiam no
                  nosso trabalho.
                </p>
              </div>

              <div className="pt-4">
                <Button
                  onClick={handleCtaClick}
                  size="lg"
                  className={`btn-premium bg-linear-to-r from-[#e3c788] via-[#d4b568] to-[#c8aa62] text-slate-900 font-bold text-base md:text-lg px-8 py-6 rounded-lg shadow-[0_20px_40px_rgba(168,144,72,0.15)] uppercase tracking-widest transition-all duration-300 ${isShining ? "is-shining scale-105 shadow-xl" : ""}`}
                >
                  <span className="btn-premium-glow-overlay" />
                  <span className="relative z-10 flex items-center">
                    FALAR COM ADVOGADO
                    <ChevronRight className="ml-2 w-5 h-5" />
                  </span>
                </Button>
              </div>
            </div>

            {/* Right: Photo */}
            <div className="relative order-1 lg:order-2 flex justify-center">
              <div className="relative w-[300px] md:w-[380px] lg:w-[420px]">
                {/* Gold corner accent */}
                <div className="absolute -top-3 -right-3 w-full h-full border-2 border-[#A89048]/40 rounded-xl" />
                <div className="relative rounded-xl overflow-hidden shadow-2xl">
                  <Image
                    src="/landing/advogado-andre-lustosa.webp"
                    alt="Dr. André Lustosa — Advogado Trabalhista"
                    width={420}
                    height={553}
                    className="object-cover w-full"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* SECTION 3 — ETAPAS DO ATENDIMENTO */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <section id="steps" className="py-16 md:py-24 bg-[#f0f0f0]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h2 className="text-[clamp(1.5rem,3vw,2.25rem)] font-black text-[#1a1a1a] uppercase mb-4">
              Como são as etapas do nosso atendimento?
            </h2>
            <p className="text-gray-600 max-w-3xl mx-auto text-[clamp(0.9rem,1.1vw,1.05rem)]">
              Entender o nosso processo de atendimento é essencial para assegurar que
              você está no caminho certo. Veja como funciona cada etapa:
            </p>
          </div>

          {/* 4-Step Timeline */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 relative">
            {/* Connecting line (desktop only) */}
            <div className="hidden lg:block absolute top-12 left-[12.5%] right-[12.5%] h-[2px] bg-[#A89048]/30" />

            {[
              { num: "1", title: "RECEBEMOS SEU CASO", desc: "Nossa Equipe fará o seu atendimento, coletando informações sobre o caso." },
              { num: "2", title: "ESTUDAMOS O SEU CASO", desc: "Seu caso será estudado por uma equipe de advogados trabalhistas, que vão preparar o melhor plano para cobrar os seus direitos." },
              { num: "3", title: "COLETAMOS EVIDÊNCIAS", desc: "Solicitamos todos os documentos e provas disponíveis, para garantir o sucesso da ação." },
              { num: "4", title: "ANDAMENTO E RESULTADO", desc: "A equipe irá providenciar o protocolo da ação, cuidando dos trâmites burocráticos para garantir o sucesso da ação, mantendo o cliente informado sobre todos os passos do processo." },
            ].map((step, idx) => (
              <div key={idx} className="flex flex-col items-center text-center">
                {/* Number circle */}
                <div className="relative z-10 w-24 h-24 rounded-full border-[3px] border-[#A89048] border-dashed flex items-center justify-center bg-[#f0f0f0] mb-6">
                  <span className="text-3xl font-black text-[#A89048]" style={{ fontFamily: "var(--font-playfair), serif" }}>
                    {step.num}
                  </span>
                </div>
                <h3 className="font-black text-[#1a1a1a] text-sm uppercase tracking-wider mb-3 leading-tight">
                  {step.title}
                </h3>
                <p className="text-gray-600 text-sm leading-relaxed max-w-[260px]">
                  {step.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Gold divider */}
      <div className="h-1 bg-gradient-to-r from-transparent via-[#A89048] to-transparent" />

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* SECTION 4 — ÁREAS DE ATUAÇÃO TRABALHISTA (Cards) */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <section id="areas" className="py-16 md:py-24 bg-[#f8f8f8]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h2 className="text-[clamp(1.5rem,3vw,2.25rem)] font-black text-[#1a1a1a] leading-tight max-w-3xl mx-auto" style={{ fontFamily: "var(--font-playfair), serif" }}>
              O escritório possui experiência em reclamações trabalhistas para pedidos diversos, como:
            </h2>
          </div>

          {/* Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {practiceAreas.map((area, idx) => {
              const Icon = iconMap[area.iconName] || Briefcase;
              return (
                <div
                  key={idx}
                  className="bg-white rounded-2xl border-2 border-[#A89048]/30 p-6 flex flex-col hover:border-[#A89048] hover:shadow-lg hover:-translate-y-1 transition-all duration-300 group"
                >
                  {/* Icon + Title */}
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 rounded-xl bg-[#A89048]/10 flex items-center justify-center shrink-0">
                      <Icon className="w-6 h-6 text-[#A89048]" />
                    </div>
                    <h3 className="font-bold text-[#1a1a1a] text-[15px] leading-tight">
                      {area.title}
                    </h3>
                  </div>

                  {/* Description */}
                  <p className="text-gray-600 text-sm leading-relaxed mb-5 flex-1">
                    {area.description}
                  </p>

                  {/* Link */}
                  <button
                    onClick={handleCtaClick}
                    className="flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-[#A89048] transition-colors cursor-pointer group/link"
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
              className={`btn-premium bg-linear-to-r from-[#e3c788] via-[#d4b568] to-[#c8aa62] text-slate-900 font-bold text-lg md:text-xl px-12 py-7 rounded-lg shadow-[0_30px_50px_rgba(168,144,72,0.15)] uppercase tracking-widest transition-all duration-300 ${isShining ? "is-shining scale-105 shadow-xl" : ""}`}
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
        <section id="faq" className="py-16 md:py-24 bg-white">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-14">
              <h2 className="text-[clamp(1.5rem,3vw,2.25rem)] font-black text-[#1a1a1a] uppercase">
                Dúvidas Frequentes
              </h2>
            </div>

            <div className="space-y-4">
              {faq.map((item, idx) => (
                <div
                  key={idx}
                  className="border border-gray-200 rounded-xl overflow-hidden hover:border-[#A89048]/40 transition-colors"
                >
                  <button
                    onClick={() => setOpenFaqIndex(openFaqIndex === idx ? null : idx)}
                    className="w-full flex items-center justify-between p-5 md:p-6 text-left"
                  >
                    <div className="flex items-center gap-4">
                      <span className="text-[#A89048]/50 font-bold text-sm tabular-nums shrink-0">
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <span className="font-bold text-[#1a1a1a] text-sm md:text-base uppercase tracking-wide">
                        {item.question}
                      </span>
                    </div>
                    {openFaqIndex === idx ? (
                      <ChevronUp className="w-5 h-5 text-[#A89048] shrink-0 ml-4" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-gray-400 shrink-0 ml-4" />
                    )}
                  </button>
                  {openFaqIndex === idx && (
                    <div className="px-5 md:px-6 pb-5 md:pb-6 pt-0">
                      <div className="h-px bg-gray-200 mb-4" />
                      <p className="text-gray-600 text-sm md:text-base leading-relaxed pl-10">
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
      <footer className="bg-[#1a1a1a] pt-16 pb-8 text-white">
        {/* Gold top line */}
        <div className="h-1 bg-gradient-to-r from-transparent via-[#A89048] to-transparent mb-16" />

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
              <p className="text-sm font-bold text-gray-300 mb-3">
                Escritório de Advocacia em Arapiraca – AL
              </p>
              <p className="text-gray-500 text-sm leading-relaxed">
                Atuamos com excelência técnica, visão estratégica e sensibilidade no
                atendimento. Com estrutura para atender presencialmente em Arapiraca e
                virtualmente em todo o Brasil.
              </p>
            </div>

            {/* Sitemap */}
            <div className="text-center">
              <h4 className="text-sm font-bold uppercase tracking-widest text-gray-400 mb-6">
                Mapa do Site
              </h4>
              <div className="space-y-3">
                {["Home", "O Escritório", "Áreas de Atuação", "Blog", "Equipe", "Fale Conosco"].map((item) => (
                  <button key={item} onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} className="block mx-auto text-gray-300 hover:text-[#A89048] transition-colors text-sm">
                    {item}
                  </button>
                ))}
              </div>
            </div>

            {/* Contacts */}
            <div className="text-center md:text-right">
              <h4 className="text-sm font-bold uppercase tracking-widest text-gray-400 mb-6">
                Contatos
              </h4>
              <div className="space-y-4">
                {footer?.phones?.map((phone, i) => (
                  <div key={i} className="flex items-center gap-3 justify-center md:justify-end">
                    <div className="w-10 h-10 rounded-full border border-[#A89048]/40 flex items-center justify-center">
                      <Phone size={16} className="text-[#A89048]" />
                    </div>
                    <span className="text-gray-300 text-sm">{phone}</span>
                  </div>
                ))}
                {footer?.email && (
                  <div className="flex items-center gap-3 justify-center md:justify-end">
                    <div className="w-10 h-10 rounded-full border border-[#A89048]/40 flex items-center justify-center">
                      <Mail size={16} className="text-[#A89048]" />
                    </div>
                    <span className="text-gray-300 text-sm">{footer.email}</span>
                  </div>
                )}
                {footer?.social?.instagram && (
                  <div className="flex items-center gap-3 justify-center md:justify-end">
                    <div className="w-10 h-10 rounded-full border border-[#A89048]/40 flex items-center justify-center">
                      <Instagram size={16} className="text-[#A89048]" />
                    </div>
                    <span className="text-gray-300 text-sm">@andrelustosaadvogados</span>
                  </div>
                )}
                <div className="flex items-center gap-3 justify-center md:justify-end">
                  <div className="w-10 h-10 rounded-full border border-[#A89048]/40 flex items-center justify-center">
                    <Clock size={16} className="text-[#A89048]" />
                  </div>
                  <span className="text-gray-300 text-sm">Atendimento 24 Horas</span>
                </div>
                <div className="flex items-center gap-3 justify-center md:justify-end">
                  <div className="w-10 h-10 rounded-full border border-[#A89048]/40 flex items-center justify-center">
                    <MapPin size={16} className="text-[#A89048]" />
                  </div>
                  <span className="text-gray-300 text-sm">Arapiraca-AL</span>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="border-t border-gray-800 pt-8 flex flex-col md:flex-row items-center justify-between gap-4 text-gray-500 text-xs">
            <p>&copy; 2026 – Todos os Direitos Reservados à André Lustosa Advogados.</p>
            <div className="flex gap-4">
              <a href="#" className="hover:text-[#A89048] transition-colors">Termos de Uso</a>
              <span>|</span>
              <a href="#" className="hover:text-[#A89048] transition-colors">Política de Privacidade</a>
            </div>
          </div>
        </div>
      </footer>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* FLOATING WHATSAPP BUTTON */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <button
        onClick={handleCtaClick}
        className="fixed bottom-6 right-6 z-50 w-16 h-16 bg-[#25D366] hover:bg-[#20bd5a] text-white rounded-full shadow-[0_4px_20px_rgba(37,211,102,0.4)] flex items-center justify-center transition-all hover:scale-110 animate-bounce"
        aria-label="Fale pelo WhatsApp"
      >
        <MessageCircle size={28} fill="white" />
      </button>
    </div>
  );
}
