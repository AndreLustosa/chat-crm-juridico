"use client";

import React, { useState, useEffect, useRef } from "react";
import Image from "next/image";
import {
  MessageCircle,
  ChevronRight,
  Menu,
  X,
  Shield,
  Scale,
  Briefcase,
  Users,
  Check,
  AlertTriangle,
  Gavel,
  FileText,
  Clock,
  MapPin,
  Phone,
  Mail,
  Instagram,
  FileCheck,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LPSpecificThemeContent } from "@/types/landing-page-theme";
import { trackWhatsappClick } from "../LPTracker";

interface TrabalhistaTemaTemplateProps {
  content: LPSpecificThemeContent;
  whatsappNumber?: string;
  city?: string;
  state?: string;
}

const iconMap: Record<string, LucideIcon> = {
  AlertTriangle,
  Scale,
  Briefcase,
  Users,
  Check,
  Gavel,
  FileText,
  Clock,
  Shield,
  FileCheck,
};

export function TrabalhistaTemaTemplate({
  content,
  whatsappNumber,
  city = "Arapiraca",
  state = "AL",
}: TrabalhistaTemaTemplateProps) {
  const {
    hero,
    problem,
    rights,
    howHelp,
    process,
    documents,
    finalCta,
    footer,
  } = content;

  const [isMenuOpen, setIsMenuOpen] = useState(false);
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
    ? `https://wa.me/${whatsappNumber.replace(/\D/g, "")}?text=Olá, vim do site e gostaria de conversar com um especialista!`
    : hero.ctaLink || "#";

  const handleCtaClick = () => {
    trackWhatsappClick();
    window.open(waLink, "_blank");
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-[#FAFAFA] font-[family-name:var(--font-ubuntu)] overflow-x-hidden">
      {/* 1. NAVBAR */}
      <nav className="absolute top-0 left-0 right-0 z-50 pointer-events-none transition-all duration-300">
        <div className="mx-auto w-[90vw] lg:w-[min(90rem,80vw)] px-4 sm:px-6 lg:px-8 flex items-center justify-between pointer-events-auto pt-6">
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
        {isMenuOpen && (
          <div className="md:hidden mt-4 bg-slate-900/40 backdrop-blur-2xl rounded-2xl border border-[#A89048]/30 p-6 flex flex-col gap-6 animate-in fade-in slide-in-from-top-4 duration-300 shadow-[0_20px_50px_rgba(0,0,0,0.5)] pointer-events-auto mx-4">
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

      {/* 2. HERO */}
      <section
        className="relative w-full overflow-hidden flex flex-col"
        style={{ minHeight: "95lvh" }}
      >
        <div className="absolute inset-0 z-0">
          <picture>
            <source
              media="(min-width: 768px)"
              srcSet={hero.backgroundImage || "/landing/carteira-trabalho-hero.webp"}
            />
            <img
              src={hero.mobileBackgroundImage || hero.backgroundImage || "/landing/carteira-trabalho-mobile.webp"}
              alt="Tema Trabalhista"
              className="absolute inset-0 w-full h-full object-cover md:object-center object-top"
              fetchPriority="high"
            />
          </picture>
        </div>
        <div className="absolute inset-0 z-[1] bg-linear-to-r from-black/90 via-black/70 to-transparent" />
        <div className="absolute inset-0 z-[1] bg-linear-to-t from-black/80 via-transparent to-black/40" />
        <div className="h-24 shrink-0" />
        <div className="relative z-10 flex-1 flex items-center">
          <div className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-12 w-full">
            <div className="max-w-3xl xl:max-w-4xl pt-8">
              <div className="flex flex-wrap items-center gap-3 mb-6">
                <div className="flex items-center gap-2 bg-[#0A0A0A]/50 backdrop-blur-sm text-[#FAFAFA] px-3 py-1.5 rounded-md border border-[#A89048]/30 text-xs">
                  <Shield size={14} className="text-[#A89048]" />
                  <span className="font-semibold">Sigilo Absoluto</span>
                </div>
                <div className="flex items-center gap-2 bg-[#0A0A0A]/50 backdrop-blur-sm text-[#FAFAFA] px-3 py-1.5 rounded-md border border-[#A89048]/30 text-xs">
                  <Scale size={14} className="text-[#A89048]" />
                  <span className="font-semibold">Atuação Especializada</span>
                </div>
              </div>
              <h1 className="text-[#FAFAFA] leading-[1.05] mb-6">
                <span
                  className="block font-medium uppercase font-[family-name:var(--font-playfair)]"
                  style={{ fontSize: "clamp(2.5rem, 4vw + 1rem, 5.5rem)" }}
                >
                  {hero.title}
                </span>
              </h1>
              {hero.subtitle && (
                <p
                  className="text-[#9a9a9a] leading-relaxed mb-8 max-w-xl text-lg md:text-xl font-medium"
                >
                  {hero.subtitle}
                </p>
              )}
              <div className="relative inline-block group mt-2">
                <div className="absolute inset-0 bg-[#25D366] rounded-xl blur-lg opacity-40 group-hover:opacity-60 group-hover:blur-xl transition-all duration-500 animate-pulse"></div>
                <button
                  onClick={handleCtaClick}
                  className="relative bg-linear-to-r from-[#20bd5a] to-[#25D366] hover:from-[#1da851] hover:to-[#20bd5a] border border-[#25D366]/50 text-white font-black text-base md:text-lg px-8 sm:px-12 py-5 rounded-xl uppercase tracking-wider transition-transform duration-300 hover:scale-[1.03] flex items-center gap-3 shadow-[0_10px_40px_rgba(37,211,102,0.35)]"
                >
                  <MessageCircle className="w-6 h-6" />
                  {hero.ctaText}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. PROBLEM IDENTIFICATION */}
      <section className="py-16 md:py-24 bg-[#0A0A0A] relative border-b border-[#A89048]/10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <AlertTriangle className="w-12 h-12 text-[#A89048] mx-auto mb-6" />
          <h2 className="text-[clamp(1.75rem,3vw,2.5rem)] font-extrabold text-[#FAFAFA] uppercase mb-6 font-[family-name:var(--font-playfair)]">
            {problem.title}
          </h2>
          {problem.description && (
            <p className="text-[#9a9a9a] text-lg mb-10 max-w-3xl mx-auto">
              {problem.description}
            </p>
          )}
          <div className="grid sm:grid-cols-2 gap-4 max-w-4xl mx-auto text-left">
            {problem.items.map((item, idx) => (
              <div key={idx} className="bg-[#141414] p-5 rounded-xl border border-[#A89048]/20 flex items-start gap-3">
                <Check className="w-5 h-5 text-[#A89048] shrink-0 mt-0.5" />
                <span className="text-slate-200 font-medium">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 4. WORKER'S RIGHTS */}
      <section className="py-16 md:py-24 bg-[#141414] relative">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#A89048]/5 rounded-full blur-[120px] pointer-events-none" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center mb-16">
            <h2 className="text-[clamp(1.75rem,3vw,2.5rem)] font-extrabold text-[#FAFAFA] uppercase font-[family-name:var(--font-playfair)]">
              {rights.title}
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {rights.items.map((item, idx) => {
              const Icon = item.iconName ? iconMap[item.iconName] || Scale : Scale;
              return (
                <div key={idx} className="bg-[#1a1a1a] rounded-2xl p-8 border border-[#A89048]/20 hover:border-[#A89048]/50 transition-colors">
                  <div className="w-14 h-14 rounded-xl bg-[#A89048]/10 flex items-center justify-center mb-6">
                    <Icon className="w-7 h-7 text-[#A89048]" />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-3">{item.title}</h3>
                  <p className="text-[#9a9a9a] leading-relaxed">{item.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 5. HOW LAWYER HELPS */}
      <section className="py-16 md:py-24 bg-[#0A0A0A] relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-[clamp(1.75rem,4vw,2.5rem)] font-extrabold text-[#A89048] leading-tight mb-6 font-[family-name:var(--font-playfair)]">
                {howHelp.title}
              </h2>
              <p className="text-slate-300 text-lg leading-relaxed mb-8">
                {howHelp.description}
              </p>
              <div className="space-y-4">
                {howHelp.items.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-4">
                    <div className="w-8 h-8 rounded-full bg-[#A89048]/20 flex items-center justify-center shrink-0">
                      <Shield className="w-4 h-4 text-[#A89048]" />
                    </div>
                    <span className="text-slate-200 font-medium">{item}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="relative aspect-square md:aspect-auto md:h-[500px] w-full max-w-[500px] mx-auto hidden md:block">
              {/* Moldura da imagem (usar imagem com IA ou similar depois na página) */}
              <div className="absolute inset-0 border-2 border-[#A89048]/40 rounded-3xl translate-x-4 translate-y-4" />
              <div className="absolute inset-0 bg-[#262626] rounded-3xl overflow-hidden shadow-2xl z-10">
                <Image
                  src="/landing/advogado-andre-lustosa.webp"
                  alt="Advogado ajudando trabalhador"
                  fill
                  className="object-cover"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 6. HOW IT WORKS (STEPS) */}
      <section className="py-16 md:py-24 bg-[#141414] relative">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-[clamp(1.75rem,3vw,2.5rem)] font-extrabold text-[#FAFAFA] uppercase mb-4 font-[family-name:var(--font-playfair)]">
              {process.title}
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 relative">
            <div className="hidden lg:block absolute top-12 left-[12.5%] right-[12.5%] h-[2px] bg-[#A89048]/30" />
            {process.steps.map((step, idx) => (
              <div key={idx} className="flex flex-col items-center text-center">
                <div className="relative z-10 w-24 h-24 rounded-full border-[3px] border-[#A89048] border-dashed flex items-center justify-center bg-[#141414] mb-6 shadow-xl">
                  <span className="text-3xl font-black text-[#A89048] font-[family-name:var(--font-playfair)]">
                    {step.num}
                  </span>
                </div>
                <h3 className="font-bold text-[#FAFAFA] text-lg mb-3">
                  {step.title}
                </h3>
                <p className="text-[#9a9a9a] text-sm leading-relaxed max-w-[260px]">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 7. REQUIRED DOCUMENTS */}
      <section className="py-16 bg-[#0A0A0A] relative border-t border-[#A89048]/10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-[#141414] border border-[#A89048]/30 rounded-3xl p-8 md:p-12 text-center md:text-left flex flex-col md:flex-row gap-10 items-center">
            <div className="flex-1">
              <h2 className="text-[clamp(1.5rem,2.5vw,2rem)] font-extrabold text-[#FAFAFA] uppercase mb-4 font-[family-name:var(--font-playfair)]">
                {documents.title}
              </h2>
              {documents.description && (
                <p className="text-[#9a9a9a] text-lg mb-6">
                  {documents.description}
                </p>
              )}
              <div className="flex flex-wrap gap-3 justify-center md:justify-start">
                {documents.items.map((item, idx) => (
                  <div key={idx} className="bg-[#0A0A0A] px-4 py-2 border border-[#A89048]/20 rounded-lg text-sm font-medium text-slate-300">
                    {item}
                  </div>
                ))}
              </div>
            </div>
            <div className="shrink-0">
              <FileCheck className="w-32 h-32 text-[#A89048]/30" />
            </div>
          </div>
        </div>
      </section>

      {/* 8. FINAL CTA */}
      <section className="py-20 md:py-32 bg-linear-to-b from-[#0A0A0A] to-[#141414] relative overflow-hidden">
        <div className="absolute inset-0 bg-[#A89048]/5" />
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
          <h2 className="text-[clamp(2rem,4vw,3rem)] font-extrabold text-[#FAFAFA] mb-10 font-[family-name:var(--font-playfair)] leading-tight">
            {finalCta.title}
          </h2>
          <Button
            onClick={handleCtaClick}
            size="lg"
            className={`btn-premium bg-linear-to-r from-[#e3c788] via-[#d4b568] to-[#c8aa62] text-slate-900 font-black text-lg md:text-xl px-12 py-8 rounded-2xl shadow-[0_20px_60px_rgba(168,144,72,0.2)] uppercase tracking-widest transition-all duration-300 ${isShining ? "is-shining scale-105 shadow-xl" : ""}`}
          >
            <span className="btn-premium-glow-overlay" />
            <span className="relative z-10 flex items-center justify-center gap-3">
              <MessageCircle className="w-6 h-6" />
              {finalCta.ctaText}
            </span>
          </Button>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-[#0A0A0A] pt-16 pb-8 border-t border-[#A89048]/20">
        <div className="h-px bg-linear-to-r from-transparent via-[#A89048]/40 to-transparent mb-16" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-3 gap-12 mb-12">
            <div className="text-center md:text-left">
              <Image
                src="/landing/logo_andre_lustosa_transparente.png"
                alt="André Lustosa Advogados"
                width={250}
                height={70}
                className="h-16 w-auto object-contain mx-auto md:mx-0 mb-4"
              />
              <p className="text-[#9a9a9a] text-sm leading-relaxed max-w-sm mx-auto md:mx-0">
                Escritório de Advocacia em {city} – {state}, referência em
                direitos trabalhistas e na defesa incansável dos trabalhadores.
              </p>
            </div>
            <div className="text-center md:flex md:flex-col md:items-center">
              <h4 className="text-[#FAFAFA] font-bold uppercase tracking-wider mb-6">
                Endereço presencial
              </h4>
              <p className="text-[#9a9a9a] text-sm leading-relaxed max-w-[250px]">
                {footer?.address || "Escritório em Arapiraca. Agende já."}
              </p>
              <div className="mt-4 flex gap-4 justify-center md:justify-start">
                <a
                  href="#"
                  className="w-10 h-10 rounded-full bg-[#1a1a1a] border border-[#A89048]/20 flex items-center justify-center text-[#A89048] hover:bg-[#A89048] hover:text-white transition-all hover:scale-110"
                >
                  <Instagram size={18} />
                </a>
              </div>
            </div>
            <div className="text-center md:text-right">
              <h4 className="text-[#FAFAFA] font-bold uppercase tracking-wider mb-6">
                Contato
              </h4>
              <div className="space-y-4 inline-block text-left">
                {footer?.phones?.map((phone, idx) => (
                  <div key={idx} className="flex items-center gap-3 justify-center md:justify-end">
                    <div className="w-10 h-10 rounded-full border border-[#A89048]/30 flex items-center justify-center">
                      <Phone size={16} className="text-[#A89048]" />
                    </div>
                    <span className="text-[#9a9a9a] text-sm">{phone}</span>
                  </div>
                ))}
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
              &copy; {new Date().getFullYear()} – Todos os Direitos Reservados à André Lustosa Advogados.
            </p>
            <div className="flex gap-4">
              <a href="#" className="hover:text-[#A89048] transition-colors">Termos de Uso</a>
              <span>|</span>
              <a href="#" className="hover:text-[#A89048] transition-colors">Política de Privacidade</a>
            </div>
          </div>
        </div>
      </footer>

      {/* FLOATING WHATSAPP BUTTON */}
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
