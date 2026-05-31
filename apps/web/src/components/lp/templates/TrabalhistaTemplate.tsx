"use client";

import React, { useState, useEffect, useRef } from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import {
  MessageCircle,
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
  type LucideIcon,
} from "lucide-react";
import { LPTemplateContent } from "@/types/landing-page";
import { trackWhatsappClick, appendRefToWaLink } from "../LPTracker";

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

const TrabalhistaBelowFold = dynamic(
  () => import("./TrabalhistaBelowFold").then((m) => m.TrabalhistaBelowFold),
  { ssr: true },
);

export function TrabalhistaTemplate({
  content,
  whatsappNumber,
  city = "Arapiraca",
  state = "AL",
}: TrabalhistaTemplateProps) {
  const { hero } = content;
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const handleScroll = () => {
      root.classList.add("shine-on-scroll");
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(
        () => root.classList.remove("shine-on-scroll"),
        1200,
      );
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      root.classList.remove("shine-on-scroll");
    };
  }, []);

  const waLink = whatsappNumber
    ? `https://wa.me/${whatsappNumber.replace(/\D/g, "")}?text=Olá, vim do site e gostaria de uma consulta trabalhista!`
    : hero.ctaLink || "#";

  const handleCtaClick = () => {
    trackWhatsappClick();
    window.open(appendRefToWaLink(waLink), "_blank");
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-[#FAFAFA] font-[family-name:var(--font-neue-montreal)] overflow-x-hidden">
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
                src="/landing/logo_andre_lustosa_transparente.webp"
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
      <TrabalhistaBelowFold
        content={content}
        city={city}
        state={state}
        onCtaClick={handleCtaClick}
        iconMap={iconMap}
      />

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
