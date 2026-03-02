"use client";

import React, { useState, useEffect, useRef } from "react";
import Image from "next/image";
import {
  MessageCircle,
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
  ChevronRight,
  ChevronLeft,
  Menu,
  X,
  Briefcase,
  ShoppingCart,
  HeartPulse,
  Users,
  Gavel,
  FileText,
  Building2,
  Landmark,
  CheckCircle2,
  Clock,
  Award,
  Globe,
  ShieldCheck,
  Lightbulb,
  Bot,
  Headphones,
  Zap,
  Search,
} from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { LPTemplateContent } from "@/types/landing-page";
import { trackWhatsappClick } from "../LPTracker";

interface HighConversionTemplateProps {
  content: LPTemplateContent;
  whatsappNumber?: string;
  onWhatsAppClick?: () => void;
}

export function HighConversionTemplate({
  content,
  whatsappNumber,
  onWhatsAppClick,
}: HighConversionTemplateProps) {
  const { hero, steps = [], faq = [], footer } = content;
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isShining, setIsShining] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Common Premium Journey Data
  const robustJourney = [
    {
      title: "Acolhimento Estratégico",
      description:
        "Iniciamos com uma triagem humanizada e técnica, garantindo o sigilo absoluto das suas informações desde o primeiro contato digital.",
      icon: <MessageCircle size={48} />,
    },
    {
      title: "Análise de Viabilidade Técnica",
      description:
        "Nossa equipe de especialistas realiza um diagnóstico profundo das provas e fundamentos, mapeando as chances reais de êxito da sua demanda.",
      icon: <Search size={48} />,
    },
    {
      title: "Consultoria de Especialidade",
      description:
        "Agendamos uma conferência estratégica para alinhar expectativas, sanar dúvidas técnicas e apresentar o caminho jurídico mais seguro.",
      icon: <Users size={48} />,
    },
    {
      title: "Estruturação de Tese Individualizada",
      description:
        "Construímos uma peça jurídica exclusiva, fundamentada na jurisprudência mais recente e em estratégias comprovadas de alta performance.",
      icon: <FileText size={48} />,
    },
    {
      title: "Ajuizamento e Protocolo de Urgência",
      description:
        "Protocolamos sua ação com prioridade máxima, focando em medidas liminares e tutelas de urgência para proteger seus direitos imediatamente.",
      icon: <Gavel size={48} />,
    },
    {
      title: "Monitoramento Processual Inteligente",
      description:
        "Utilizamos tecnologia de ponta para vigilância 24h do seu processo, antecipando movimentações judiciais e garantindo respostas ágeis.",
      icon: <Zap size={48} />,
    },
    {
      title: "Mediação e Negociação de Alto Nível",
      description:
        "Buscamos ativamente composições amigáveis e acordos vantajosos, visando a satisfação do seu crédito sem abdicar da justiça plena.",
      icon: <CheckCircle2 size={48} />,
    },
    {
      title: "Instrução e Defesa em Juízo",
      description:
        "Realizamos uma defesa intransigente em todas as instâncias e audiências, com acompanhamento presencial e técnica oratória de excelência.",
      icon: <ShieldCheck size={48} />,
    },
    {
      title: "Execução e Recebimento Garantido",
      description:
        "Após a vitória, nossa força-tarefa atua na fase de execução para assegurar que o pagamento chegue à sua conta no menor tempo possível.",
      icon: <Award size={48} />,
    },
  ];

  const displaySteps =
    steps.length <= 4 || steps.length === 9 ? robustJourney : steps;

  const nextStep = () =>
    setActiveStep((prev) => (prev + 1) % displaySteps.length);
  const prevStep = () =>
    setActiveStep(
      (prev) => (prev - 1 + displaySteps.length) % displaySteps.length
    );

  const robustFaq = [
    {
      question:
        "Onde está localizado o escritório físico do André Lustosa Advogados em Arapiraca?",
      answer:
        "Nossa unidade central está estrategicamente situada na Rua Francisco Rodrigues Viana, 242, bairro Baixa Grande, Arapiraca-AL, oferecendo um ambiente seguro, privativo e de alto padrão para reuniões presenciais e consultorias estratégicas.",
    },
    {
      question:
        "O escritório atende apenas clientes residentes em Arapiraca?",
      answer:
        "Não. Embora tenhamos nossa base em Arapiraca, atendemos com a mesma excelência em todo o Agreste, Sertão e demais regiões de Alagoas, além de possuirmos estrutura para representação jurídica em âmbito nacional através do nosso sistema 100% digital.",
    },
    {
      question:
        "Quais áreas do direito o escritório atende nesta unidade?",
      answer:
        "Atuamos de forma multidisciplinar (Geral), com especialistas prontos para defender seus interesses em Direito Civil, Família e Sucessões, Direito do Trabalho, Consumidor e demandas de reparação de danos (Indenizações).",
    },
    {
      question:
        "É necessário agendar horário para ser atendido pessoalmente?",
      answer:
        "Sim. Para garantirmos a máxima atenção, sigilo e um atendimento exclusivo de alto nível, todas as visitas presenciais em Arapiraca devem ser agendadas previamente através dos nossos canais digitais.",
    },
    {
      question:
        "Como funciona o atendimento para quem mora em cidades vizinhas?",
      answer:
        "Oferecemos a 'Jornada Digital Lustosa', onde todo o processo — desde a consultoria inicial até o envio de documentos e assinatura de contratos — é feito via WhatsApp e videoconferência, com o suporte físico da nossa sede em Arapiraca quando necessário.",
    },
    {
      question:
        "O escritório possui advogados especialistas locais que conhecem o judiciário de Alagoas?",
      answer:
        "Sim. Nossa equipe é composta por advogados que residem e atuam diariamente nas comarcas do interior de Alagoas, o que garante um conhecimento profundo dos trâmites e particularidades do judiciário local.",
    },
    {
      question:
        "Quais são os diferenciais do André Lustosa Advogados frente aos escritórios tradicionais da região?",
      answer:
        "Unimos o acolhimento humano e a proximidade do escritório local com a tecnologia de ponta dos grandes centros, garantindo agilidade no protocolo, acompanhamento 24h por sistema e uma comunicação clara e direta.",
    },
    {
      question:
        "Como posso enviar documentos para análise sem precisar ir ao escritório?",
      answer:
        "Através do nosso canal exclusivo de triagem digital. Você pode enviar fotos ou PDFs dos documentos diretamente pelo WhatsApp. Nossa tecnologia garante que o sigilo seja mantido e os dados sejam processados com segurança.",
    },
    {
      question:
        "O André Lustosa Advogados realiza atendimentos fora do horário comercial em Arapiraca?",
      answer:
        "Entendemos que nossos clientes possuem agendas complexas. Por isso, oferecemos horários flexíveis para consultas online e, em casos específicos, agendamentos presenciais diferenciados sob consulta prévia.",
    },
    {
      question:
        "Como faço para iniciar meu caso imediatamente em Arapiraca?",
      answer:
        "Basta clicar no botão de atendimento digital nesta página. Você será conectado à nossa triagem estratégica, que realizará o diagnóstico inicial do seu caso e agendará sua consultoria com o especialista responsável.",
    },
  ];

  const displayFaq = faq.length > 5 ? faq : robustFaq;

  // Toggle shine effect on scroll (for mobile engagement)
  useEffect(() => {
    const handleScroll = () => {
      setIsShining(true);

      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);

      scrollTimeoutRef.current = setTimeout(() => {
        setIsShining(false);
      }, 1200); // Duration matches the CSS animation
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, []);

  // Determine WhatsApp Link
  const waLink = whatsappNumber
    ? `https://wa.me/${whatsappNumber.replace(/\D/g, "")}?text=Olá, vim do site e gostaria de realizar uma consulta!`
    : hero.ctaLink || "#";

  const handleCtaClick = () => {
    trackWhatsappClick();
    if (onWhatsAppClick) onWhatsAppClick();
    window.open(waLink, "_blank");
  };

  return (
    <div className="min-h-screen bg-white text-slate-900 font-sans overflow-x-hidden">
      <nav className="absolute top-0 left-0 right-0 z-50 pointer-events-none transition-all duration-300">
        <div className="mx-auto w-[90vw] lg:w-[min(90rem,80vw)] px-4 sm:px-6 lg:px-8 flex items-center justify-between pointer-events-auto pt-6">
          {/* Desktop & Tablet: Full Unified Bar */}
          <div className="hidden md:flex flex-1 items-center justify-between bg-[#0A0A0A]/80 backdrop-blur-xl rounded-2xl border border-[#A89048]/30 py-4 px-8 shadow-[0_8px_32px_rgba(0,0,0,0.6)] transition-all duration-300 hover:bg-[#0A0A0A]/90">
            {/* Logo - Now as a Scroll-to-Top Button */}
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

            {/* Right Side Group: Menu + CTA */}
            <div className="flex items-center gap-10">
              {/* Desktop Menu */}
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
                      .getElementById("office")
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
          <div className="md:hidden mt-4 bg-slate-900/40 backdrop-blur-2xl rounded-2xl border border-[#A89048]/30 p-6 flex flex-col gap-6 animate-in fade-in slide-in-from-top-4 duration-300 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
            <button
              onClick={() => {
                document
                  .getElementById("office")
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

      {/* HERO SECTION - Strict Full Screen on Mobile */}
      <section
        id="about"
        className="relative h-dvh min-h-[600px] w-full flex items-center bg-black group/hero overflow-hidden"
      >
        {/* Background com Imagem de Biblioteca/Escritório com Overlay Escuro */}
        <div className="absolute inset-0 z-0 overflow-hidden">
          {/* Desktop Background */}
          <div className="hidden md:block absolute inset-0">
            <Image
              src="/landing/Design sem nome (35).png"
              alt="Fundo Escritório Desktop"
              fill
              className="object-cover object-top"
              priority
            />
          </div>
          {/* Mobile Background */}
          <div className="md:hidden absolute inset-0">
            <Image
              src="/landing/Design sem nome (26).png"
              alt="Fundo Escritório Mobile"
              fill
              className="object-cover object-top"
              priority
            />
          </div>

          {/* Premium Gradient Overlay - Lighter Version */}
          <div className="absolute inset-0 bg-linear-to-t from-black/90 via-black/40 to-transparent z-10 pointer-events-none" />
          <div className="absolute inset-0 bg-linear-to-r from-black/80 via-black/20 to-transparent z-10 pointer-events-none" />
        </div>

        {/* Content Container - Senior Fluid Strategy */}
        <div className="mx-auto w-[90vw] lg:w-[min(90rem,80vw)] px-4 sm:px-6 lg:px-8 relative z-20 grid lg:grid-cols-12 gap-8 items-center h-full">
          {/* TEXT BLOCK (7 Cols) - Anchored to Bottom on Mobile */}
          <div className="lg:col-span-7 xl:col-span-6 flex flex-col items-center lg:items-start text-center lg:text-left gap-4 animate-in fade-in slide-in-from-bottom duration-1000 max-w-[52rem] lg:mx-0 py-8 min-w-0 h-full justify-end pb-24 lg:pb-0 lg:justify-center">
            {/* MOBILE ONLY: Trust Badges (Excelência & Segurança) positioned at the top */}
            <div className="flex lg:hidden flex-wrap justify-center gap-3 mb-6">
              <div className="flex items-center gap-2 bg-slate-900/40 backdrop-blur-xl border border-[#A89048]/30 rounded-lg px-4 py-2">
                <div className="bg-[#A89048]/10 p-1.5 rounded-full">
                  <Scale size={14} className="text-[#A89048]" />
                </div>
                <div className="flex flex-col text-left">
                  <span className="text-[#A89048] text-[8px] font-bold uppercase tracking-widest leading-tight">
                    Excelência e
                  </span>
                  <span className="text-[#FAFAFA] text-[10px] font-serif tracking-widest">
                    COMPETÊNCIA
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 bg-slate-900/40 backdrop-blur-xl border border-[#A89048]/30 rounded-lg px-4 py-2">
                <div className="bg-[#A89048]/10 p-1.5 rounded-full">
                  <Shield size={14} className="text-[#A89048]" />
                </div>
                <div className="flex flex-col text-left">
                  <span className="text-[#A89048] text-[8px] font-bold uppercase tracking-widest leading-tight">
                    Total
                  </span>
                  <span className="text-[#FAFAFA] text-[10px] font-serif tracking-widest">
                    SEGURANÇA
                  </span>
                </div>
              </div>
            </div>

            {/* Tags de Confiança */}
            <div className="flex items-center gap-4">
              <div className="bg-[#A89048]/10 border border-[#A89048]/30 px-4 py-1.5 rounded-full flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-[#A89048] animate-pulse" />
                <span className="text-[#A89048] text-[clamp(0.7rem,0.8vw,0.875rem)] font-bold tracking-widest uppercase">
                  +10 Anos de Experiência
                </span>
              </div>
            </div>

            {/* Título Monumental - Elegante */}
            <h1 className="text-[clamp(1.75rem,3vw,3rem)] 2xl:text-[clamp(2.25rem,3.5vw,4.25rem)] font-medium text-[#FAFAFA] leading-tight tracking-normal font-[family-name:var(--font-playfair)] drop-shadow-[0_4px_4px_rgba(0,0,0,0.5)] flex flex-col items-center lg:items-start text-center lg:text-left">
              {hero.title.split('\n').map((line, lineIndex) => (
                <span key={lineIndex} className="block w-full">
                  {line}
                </span>
              ))}
            </h1>

            {/* Subtítulos Impactantes - Centered on Mobile */}
            <div className="space-y-2 max-w-2xl flex flex-col items-center lg:items-start">
              <p className="text-[clamp(1.125rem,2vw,1.25rem)] lg:text-[clamp(0.875rem,1vw,1rem)] 2xl:text-[clamp(1rem,1.2vw,1.25rem)] font-semibold text-[#FAFAFA]/90 leading-relaxed">
                {hero.subtitle}
              </p>
              {hero.secondarySubtitle && (
                <p className="text-[#A89048] text-[clamp(1rem,1.4vw,1.25rem)] font-semibold">
                  {hero.secondarySubtitle}
                </p>
              )}
            </div>

            <div className="pt-2 flex flex-col items-center lg:items-start gap-6 w-full">
              {/* Botão + Bandeiras */}
              <div className="flex flex-col items-center lg:items-start gap-1 w-full md:w-auto">
                <Button
                  onClick={handleCtaClick}
                  size="lg"
                  className={`btn-premium bg-linear-to-r from-[#e3c788] via-[#d4b568] to-[#c8aa62] text-slate-900 font-bold text-[clamp(0.9rem,1.2vw,1.25rem)] 2xl:text-[clamp(1.25rem,1.5vw,1.5rem)] px-10 py-6 2xl:py-8 rounded-lg shadow-[0_72px_80px_rgba(168,144,72,0.14),0_30px_33px_rgba(168,144,72,0.1),0_16px_18px_rgba(168,144,72,0.08)] uppercase tracking-widest w-full md:w-auto transition-all duration-300 ${isShining ? "is-shining scale-105 shadow-xl" : ""}`}
                >
                  {/* Glow overlay — masked by rotating conic-gradient */}
                  <span className="btn-premium-glow-overlay" />
                  <span className="relative z-10 flex items-center">
                    REALIZAR CONSULTA
                    <ChevronRight className="ml-2 w-6 h-6" />
                  </span>
                </Button>
              </div>
            </div>
          </div>

          {/* IMAGE BLOCK (5 Cols) - Absolute on Mobile to allow text to slide down */}
          <div className="absolute inset-x-0 bottom-0 h-[70vh] lg:relative lg:h-full lg:col-span-5 xl:col-span-6 flex items-end justify-center lg:justify-end pointer-events-none z-10 lg:z-20">
            {/* Badge Competência - Desktop Only */}
            <div className="hidden lg:flex absolute top-[25%] left-[5%] z-20 pointer-events-auto animate-in fade-in slide-in-from-left duration-1000 delay-500">
              <div className="flex items-center gap-3 bg-slate-900/40 backdrop-blur-xl border border-[#A89048]/30 rounded-lg px-6 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.4)] transition-all duration-500 hover:scale-105 hover:border-[#A89048]/60 hover:shadow-[0_0_20px_rgba(168,144,72,0.2)] group cursor-default">
                <div className="bg-[#A89048]/10 p-2 rounded-full">
                  <Scale size={18} className="text-[#A89048]" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[#A89048] text-[10px] font-bold uppercase tracking-[0.2em] leading-tight">
                    Excelência e
                  </span>
                  <span className="text-[#FAFAFA] text-xs font-serif tracking-widest">
                    COMPETÊNCIA
                  </span>
                </div>
              </div>
            </div>

            {/* Badge Segurança - Desktop Only */}
            <div className="hidden lg:flex absolute bottom-[25%] right-[5%] z-20 pointer-events-auto animate-in fade-in slide-in-from-right duration-1000 delay-700">
              <div className="flex items-center gap-3 bg-slate-900/40 backdrop-blur-xl border border-[#A89048]/30 rounded-lg px-6 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.4)] transition-all duration-500 hover:scale-105 hover:border-[#A89048]/60 hover:shadow-[0_0_20px_rgba(168,144,72,0.2)] group cursor-default">
                <div className="bg-[#A89048]/10 p-2 rounded-full">
                  <Shield size={18} className="text-[#A89048]" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[#A89048] text-[10px] font-bold uppercase tracking-[0.2em] leading-tight">
                    Total
                  </span>
                  <span className="text-[#FAFAFA] text-xs font-serif tracking-widest">
                    SEGURANÇA
                  </span>
                </div>
              </div>
            </div>

            {/* Imagem do Advogado (Se existir) */}
            {hero.lawyerImage && (
              <div className="relative w-full h-[90%]">
                <div className="absolute inset-0 bg-linear-to-t from-black via-transparent to-transparent z-10"></div>
                <Image
                  src={hero.lawyerImage}
                  alt="Advogado"
                  fill
                  className="object-contain object-bottom relative z-0"
                  priority
                />
              </div>
            )}
          </div>
        </div>

        {/* LOGO MARQUEE (CARROSSEL INFINITO) — Inside Hero, at the bottom */}
        <div className="absolute bottom-0 left-0 right-0 z-30 overflow-hidden bg-slate-900/5 backdrop-blur-xl border-y border-[#A89048]/15 py-[3px]">
          <style>{`
            @keyframes marquee-scroll {
              0% { transform: translateX(0); }
              100% { transform: translateX(-50%); }
            }
            .marquee-belt {
              display: flex;
              white-space: nowrap;
              animation: marquee-scroll 35s linear infinite;
            }
            @media (max-width: 768px) {
              .marquee-belt {
                animation-duration: 20s;
              }
            }
          `}</style>
          <div className="marquee-belt">
            {[...Array(20)].map((_, i) => (
              <div
                key={i}
                className="relative h-[65px] w-[220px] mx-0.5 shrink-0"
              >
                <Image
                  src="/landing/logo_andre_lustosa_transparente.png"
                  alt="André Lustosa Logo"
                  fill
                  className="object-contain"
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRACTICE AREAS / LEGAL DESIGN SECTION */}
      <section
        id="areas"
        className="pt-24 pb-12 md:py-24 px-4 md:px-8 bg-[#0A0A0A] relative overflow-hidden"
      >
        {/* Subtle Top Gradient Glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-4xl h-32 bg-linear-to-b from-[#A89048]/10 to-transparent blur-3xl rounded-full z-10 pointer-events-none" />

        {/* Blurred Decorative Element — Top */}
        <div className="absolute left-[-100px] top-[-100px] opacity-30 z-0 pointer-events-none">
          <div className="w-[400px] h-[400px] bg-linear-to-br from-[#A89048]/20 via-slate-800/30 to-transparent rounded-full blur-3xl"></div>
        </div>

        <div className="mx-auto w-[90vw] lg:w-[min(90rem,80vw)] px-4 sm:px-6 lg:px-8 relative z-20">
          {/* Header */}
          <div className="text-center mb-[clamp(3rem,5vw,5rem)] px-4">
            <span className="text-[#A89048] font-bold tracking-widest uppercase text-sm mb-4 block">
              NOSSOS SERVIÇOS
            </span>
            <h2 className="text-[clamp(1.75rem,3.5vw,3rem)] 2xl:text-[clamp(2.25rem,4vw,4rem)] font-extrabold text-[#FAFAFA] mb-6 leading-tight">
              Escritório de Advocacia <br /> em{" "}
              <span className="text-[#A89048]">Arapiraca-AL</span>
            </h2>
            <p className="text-[clamp(1rem,1.1vw,1.125rem)] 2xl:text-[clamp(1.125rem,1.5vw,1.375rem)] text-[#9a9a9a] max-w-3xl mx-auto leading-relaxed">
              Somos um escritório de advocacia com atendimento &quot;FULL
              SERVICE&quot;, e estamos comprometidos com a excelência na atuação
              em diferentes áreas do direito.
            </p>
          </div>

          {/* Grid of Cards — Premium Elegant Style with Framer Motion Entrance */}
          <motion.div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-16"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={{
              hidden: { opacity: 0 },
              visible: {
                opacity: 1,
                transition: {
                  staggerChildren: 0.1,
                },
              },
            }}
          >
            {[
              {
                icon: Briefcase,
                title: "Direito Trabalhista",
                description:
                  "Protege os direitos dos trabalhadores, regulando relações como salários, jornada, férias, FGTS e demissões. Atuamos na defesa de quem busca justiça nas relações de emprego.",
              },
              {
                icon: ShoppingCart,
                title: "Direito do Consumidor",
                description:
                  "Garante a proteção contra práticas abusivas nas relações de consumo. Atuamos na defesa de clientes lesados por empresas, cobranças indevidas, produtos defeituosos ou serviços mal prestados.",
              },
              {
                icon: HeartPulse,
                title: "Direito Previdenciário",
                description:
                  "Voltado à garantia de benefícios como aposentadoria, pensão, auxílio-doença e BPC/LOAS. Defendemos os direitos de quem busca amparo do INSS em momentos de necessidade.",
              },
              {
                icon: Users,
                title: "Direito de Família",
                description:
                  "Cuida das relações familiares, como divórcio, guarda de filhos, pensão alimentícia e inventário. Atuamos com sensibilidade e firmeza na defesa dos seus direitos e da sua família.",
              },
              {
                icon: Gavel,
                title: "Direito Criminal",
                description:
                  "Defesa em processos criminais, desde inquérito até julgamento. Atuamos com estratégia e compromisso na proteção dos direitos do acusado, sempre respeitando o devido processo legal.",
              },
              {
                icon: FileText,
                title: "Direito Civil",
                description:
                  "Abrange questões do dia a dia como contratos, indenizações, posse, propriedade e responsabilidade civil. Atuamos na prevenção e resolução de conflitos com segurança jurídica.",
              },
              {
                icon: Building2,
                title: "Direito Imobiliário",
                description:
                  "Atuação em compra e venda de imóveis, contratos de locação, usucapião, inventário de bens imóveis e regularização fundiária. Protegemos seu patrimônio com segurança jurídica.",
              },
              {
                icon: Landmark,
                title: "Direito das Sucessões",
                description:
                  "Regula a transferência do patrimônio após o falecimento. Atuamos em inventários, partilhas, testamentos e planejamento sucessório, garantindo segurança jurídica e respeito à vontade dos herdeiros.",
              },
            ].map((area, index) => {
              const Icon = area.icon;
              return (
                <motion.div
                  key={index}
                  variants={{
                    hidden: { opacity: 0, y: 30 },
                    visible: {
                      opacity: 1,
                      y: 0,
                      transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
                    },
                  }}
                  className="relative bg-linear-to-br from-[#1a1a1a] to-[#141414] border border-[#A89048]/20 rounded-2xl p-7 flex flex-col justify-between hover:border-[#A89048]/60 hover:shadow-[0_8px_40px_rgba(168,144,72,0.15)] hover:-translate-y-2 transition-all duration-500 group overflow-hidden"
                >
                  {/* Subtle corner glow */}
                  <div className="absolute -top-20 -right-20 w-40 h-40 bg-[#A89048]/5 rounded-full blur-3xl group-hover:bg-[#A89048]/15 transition-all duration-500 pointer-events-none" />

                  <div className="relative z-10 flex flex-col items-center md:items-start text-center md:text-left">
                    {/* Gold icon circle */}
                    <div className="w-12 h-12 rounded-xl bg-[#A89048]/10 border border-[#A89048]/20 flex items-center justify-center mb-5 group-hover:bg-[#A89048]/20 group-hover:border-[#A89048]/40 transition-all duration-300">
                      <Icon className="w-6 h-6 text-[#A89048]" />
                    </div>
                    <h3 className="text-lg font-bold text-[#FAFAFA] mb-3 group-hover:text-[#A89048] transition-colors duration-300 w-full">
                      {area.title}
                    </h3>
                    <p className="text-sm text-[#9a9a9a] leading-relaxed mb-6 w-full">
                      {area.description}
                    </p>
                  </div>

                  {/* Divider + Link */}
                  <div className="relative z-10 flex flex-col items-center md:items-start">
                    <div className="h-px w-full bg-linear-to-r from-[#A89048]/30 via-[#A89048]/10 to-transparent mb-4" />
                    <button
                      onClick={handleCtaClick}
                      className="flex items-center gap-1.5 text-sm font-semibold text-[#A89048]/70 hover:text-[#A89048] transition-colors cursor-pointer group/link justify-center md:justify-start w-full"
                    >
                      <ChevronRight className="w-4 h-4 group-hover/link:translate-x-0.5 transition-transform" />
                      Ler mais
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>

          {/* Centered Button — Reference Style */}
          <div className="flex justify-center relative z-40 mt-12 mb-10 md:mb-20">
            <Button
              onClick={handleCtaClick}
              size="lg"
              className={`btn-premium bg-linear-to-r from-[#e3c788] via-[#d4b568] to-[#c8aa62] text-slate-900 font-bold text-lg md:text-xl px-12 py-7 rounded-lg shadow-[0_72px_80px_rgba(168,144,72,0.14),0_30px_33px_rgba(168,144,72,0.1),0_16px_18px_rgba(168,144,72,0.08)] uppercase tracking-widest w-full md:w-auto transition-all duration-300 ${isShining ? "is-shining scale-105 shadow-xl" : ""}`}
            >
              {/* Glow overlay — masked by rotating conic-gradient */}
              <span className="btn-premium-glow-overlay" />
              <span className="relative z-10 flex items-center">
                REALIZAR CONSULTA
                <ChevronRight className="ml-2 w-6 h-6" />
              </span>
            </Button>
          </div>
        </div>
      </section>

      {/* SECTION SEPARATOR LINE */}
      <div className="relative z-10 w-full h-px bg-linear-to-r from-transparent via-[#A89048]/30 to-transparent" />

      {/* FLOATING VALUE BANNER */}
      <div className="relative z-50 w-full overflow-visible py-[clamp(2rem,4vw,4rem)] md:py-0 bg-[#0A0A0A] -mt-12 md:-mt-24 group/banner">
        {/* Decorative background line (behind banner) - Increased thickness and presence */}
        <div className="absolute top-1/2 left-0 right-0 h-[4px] bg-linear-to-r from-transparent via-[#A89048]/40 to-transparent z-0 pointer-events-none hidden md:block" />

        <div className="mx-auto w-[90vw] lg:w-[min(90rem,80vw)] px-4 sm:px-6 lg:px-8 relative z-10">
          <motion.div
            className="bg-white rounded-3xl shadow-[0_32px_64px_rgba(0,0,0,0.2)] p-[clamp(1.5rem,3vw,3rem)] flex flex-col lg:flex-row items-center gap-[clamp(1.5rem,3vw,3rem)] border-l-12 border-[#A89048] ring-1 ring-[#A89048]/15"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{
              opacity: 1,
              y: 0,
              transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] },
            }}
            viewport={{ once: true, margin: "-100px" }}
          >
            {/* Left Title */}
            <div className="lg:w-1/3 text-center lg:text-left">
              <h3 className="text-[clamp(1.5rem,4vw,2rem)] lg:text-[clamp(1.25rem,2vw,1.75rem)] 2xl:text-[clamp(1.5rem,2.5vw,2rem)] font-black text-slate-800 leading-snug md:leading-tight">
                Referência em <span className="text-[#A89048]">direito</span> na
                cidade de <br className="md:block" /> Arapiraca-AL
              </h3>
            </div>

            {/* Divider & Arrow icon from reference */}
            <div className="hidden lg:flex items-center shrink-0">
              <div className="h-24 w-px bg-slate-100" />
              <div className="mx-6 w-12 h-12 rounded-full border-2 border-[#A89048]/30 flex items-center justify-center bg-[#A89048]">
                <ChevronRight size={24} className="text-white" />
              </div>
              <div className="h-24 w-px bg-slate-100" />
            </div>

            {/* Right Pillars */}
            <div className="lg:w-2/3 grid md:grid-cols-3 gap-8">
              <div className="space-y-4 flex flex-col items-center lg:items-start text-center lg:text-left">
                <div className="flex flex-col lg:flex-row items-center justify-center lg:justify-start gap-3 w-full">
                  <div className="w-10 h-10 rounded-full bg-[#A89048]/10 flex items-center justify-center shrink-0">
                    <Clock className="w-5 h-5 text-[#A89048]" />
                  </div>
                  <h4 className="font-bold text-slate-900 text-base md:text-sm uppercase tracking-wider">
                    Disponibilidade imediata
                  </h4>
                </div>
                <p className="text-slate-500 text-sm md:text-xs leading-loose md:leading-relaxed font-medium">
                  Agilidade e suporte de advogados prontos para atuar com
                  rapidez, conforto e profissionalismo.
                </p>
              </div>

              <div className="space-y-4 flex flex-col items-center lg:items-start text-center lg:text-left">
                <div className="flex flex-col lg:flex-row items-center justify-center lg:justify-start gap-3 w-full">
                  <div className="w-10 h-10 rounded-full bg-[#A89048]/10 flex items-center justify-center shrink-0">
                    <Scale className="w-5 h-5 text-[#A89048]" />
                  </div>
                  <h4 className="font-bold text-slate-900 text-base md:text-sm uppercase tracking-wider">
                    Profissionais experientes
                  </h4>
                </div>
                <p className="text-slate-500 text-sm md:text-xs leading-loose md:leading-relaxed font-medium">
                  Confiança de ter sua ação conduzida pelos melhores Advogados.
                </p>
              </div>

              <div className="space-y-4 flex flex-col items-center lg:items-start text-center lg:text-left">
                <div className="flex flex-col lg:flex-row items-center justify-center lg:justify-start gap-3 w-full">
                  <div className="w-10 h-10 rounded-full bg-[#A89048]/10 flex items-center justify-center shrink-0">
                    <Award className="w-5 h-5 text-[#A89048]" />
                  </div>
                  <h4 className="font-bold text-slate-900 text-base md:text-sm uppercase tracking-wider">
                    Advocacia de excelência
                  </h4>
                </div>
                <p className="text-slate-500 text-sm md:text-xs leading-loose md:leading-relaxed font-medium">
                  Escritório de advocacia com reputação sólida, confiável e
                  referência no meio jurídico.
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* NOSSO ESCRITÓRIO SECTION */}
      <section
        id="office"
        className="pt-20 md:pt-40 pb-24 px-4 md:px-8 bg-[#0D0D0D] relative overflow-hidden"
      >
        {/* Subtle Top Shadow for Depth Differentiation */}
        <div className="absolute top-0 left-0 w-full h-32 bg-linear-to-b from-black/40 to-transparent z-10 pointer-events-none" />

        {/* Decorative Light Glows & Spotlight */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-[radial-gradient(circle_at_50%_50%,rgba(168,144,72,0.03)_0%,transparent_70%)] pointer-events-none" />
        <div className="absolute top-0 right-0 w-[300px] md:w-[500px] h-[300px] md:h-[500px] bg-[#A89048]/5 rounded-full blur-[100px] md:blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[300px] md:w-[500px] h-[300px] md:h-[500px] bg-[#A89048]/5 rounded-full blur-[100px] md:blur-[120px] pointer-events-none" />

        <div className="mx-auto w-[90vw] lg:w-[min(90rem,80vw)] px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid lg:grid-cols-2 gap-[clamp(2.5rem,5vw,5rem)] items-center w-full">
            {/* Left Column: Text & Values */}
            <div className="space-y-10 flex flex-col items-center lg:items-start text-center lg:text-left w-full h-auto min-w-0">
              <div className="px-4 w-full">
                <span className="text-[#A89048] font-bold tracking-widest md:tracking-[.3em] uppercase text-sm mb-4 block">
                  INFRAESTRUTURA & VALORES
                </span>
                <h2 className="text-[clamp(2.15rem,5vw,3rem)] lg:text-[clamp(1.75rem,3.5vw,3rem)] 2xl:text-[clamp(2.25rem,4vw,4rem)] font-black text-[#FAFAFA] leading-[1.1] mb-6">
                  Excelência no Atendimento <br className="hidden md:block" />
                  <span className="text-[#A89048]">Presencial ou Online!</span>
                </h2>
                <div className="space-y-4 text-[clamp(1.125rem,2vw,1.25rem)] lg:text-[clamp(0.9rem,1.1vw,1.125rem)] text-slate-400 font-medium max-w-2xl lg:max-w-none">
                  <p>
                    O escritório{" "}
                    <span className="text-[#FAFAFA] font-bold">
                      André Lustosa Advogados
                    </span>{" "}
                    consolidou-se como referência jurídica em Arapiraca e
                    região, unindo tradição e modernidade para entregar
                    resultados concretos aos nossos clientes.
                  </p>
                  <p>
                    Contamos com uma infraestrutura moderna e acolhedora,
                    projetada para garantir o máximo de sigilo e conforto
                    durante as consultas presenciais. Além disso, operamos com
                    um sistema 100% digital, permitindo que você resolva seus
                    problemas jurídicos sem sair de casa, com a mesma segurança
                    e proximidade.
                  </p>
                </div>
              </div>

              {/* Value Pillars */}
              <div className="grid sm:grid-cols-2 gap-10 w-full pt-4">
                <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 text-center sm:text-left">
                  <div className="shrink-0 w-16 h-16 sm:w-10 sm:h-10 rounded-xl sm:rounded-lg bg-[#A89048]/10 border border-[#A89048]/20 flex items-center justify-center">
                    <Shield className="w-8 h-8 sm:w-5 sm:h-5 text-[#A89048]" />
                  </div>
                  <div>
                    <h4 className="text-[#FAFAFA] font-bold mb-2 sm:mb-1 uppercase tracking-wider text-sm sm:text-sm">
                      Sigilo Absoluto
                    </h4>
                    <p className="text-slate-500 text-base sm:text-xs leading-relaxed">
                      Proteção total aos seus dados.
                    </p>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 text-center sm:text-left">
                  <div className="shrink-0 w-16 h-16 sm:w-10 sm:h-10 rounded-xl sm:rounded-lg bg-[#A89048]/10 border border-[#A89048]/20 flex items-center justify-center">
                    <CheckCircle2 className="w-8 h-8 sm:w-5 sm:h-5 text-[#A89048]" />
                  </div>
                  <div>
                    <h4 className="text-[#FAFAFA] font-bold mb-2 sm:mb-1 uppercase tracking-wider text-sm sm:text-sm">
                      Foco em Resultados
                    </h4>
                    <p className="text-slate-500 text-base sm:text-xs leading-relaxed">
                      Solução definitiva do seu caso.
                    </p>
                  </div>
                </div>
              </div>

              {/* CTA In-section */}
              <div className="pt-6 w-full flex justify-center lg:justify-start">
                <Button
                  onClick={handleCtaClick}
                  className={`btn-premium bg-linear-to-r from-[#e3c788] via-[#d4b568] to-[#c8aa62] text-slate-900 font-bold text-[12px] md:text-lg px-4 md:px-8 py-5 md:py-7 rounded-lg shadow-[0_30px_40px_rgba(168,144,72,0.1)] uppercase tracking-widest w-[85%] mx-auto sm:w-auto transition-all duration-300 ${isShining ? "is-shining scale-105 shadow-xl" : ""}`}
                >
                  {/* Glow overlay — masked by rotating conic-gradient */}
                  <span className="btn-premium-glow-overlay" />
                  <span className="relative z-10 flex items-center">
                    CONHECER NOSSO ATENDIMENTO
                    <ChevronRight size={16} className="ml-2" />
                  </span>
                </Button>
              </div>
            </div>

            {/* Right Column: Visual Element / Office Image placeholder */}
            <div className="relative group w-full md:w-full max-w-3xl mx-auto lg:ml-auto lg:mr-0 px-2 md:px-0 mt-12 lg:mt-0">
              {/* Frame decoration */}
              <div className="absolute inset-1 md:-inset-4 border border-[#A89048]/10 rounded-2xl group-hover:border-[#A89048]/30 transition-all duration-700" />

              <div className="relative w-full min-h-[450px] md:min-h-[650px] lg:min-h-[750px] overflow-hidden rounded-xl border border-[#A89048]/20 shadow-2xl bg-linear-to-b from-[#1a1a1a] to-[#0A0A0A]">
                <Image
                  src="/landing/Design-sem-nome-_34_.webp"
                  alt="Escritório André Lustosa Advogados"
                  fill
                  className="object-contain p-2 md:p-4 group-hover:scale-105 transition-transform duration-1000"
                />
                {/* Overlay for branding — adjusted positioning for contained image */}
                <div className="absolute inset-0 bg-linear-to-t from-black/60 via-transparent to-transparent flex items-end p-8 pointer-events-none">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <MapPin size={16} className="text-[#A89048]" />
                      <span className="text-[#FAFAFA] text-xs font-bold uppercase tracking-widest">
                        Arapiraca - AL
                      </span>
                    </div>
                    <p className="text-slate-400 text-sm italic font-serif">
                      A maior estrutura jurídica dedicada ao seu direito na
                      região.
                    </p>
                  </div>
                </div>
              </div>

              {/* Floating Badge */}
              <div className="absolute top-8 right-8 md:top-auto md:-bottom-6 md:-right-6 bg-slate-900 border border-[#A89048]/30 p-3 md:p-6 rounded-2xl shadow-2xl animate-in zoom-in duration-700 delay-500">
                <div className="text-[#A89048] text-xl md:text-3xl font-black leading-none mb-1">
                  10+
                </div>
                <div className="text-[#FAFAFA] text-[8px] md:text-[10px] font-bold uppercase tracking-widest opacity-60">
                  Anos de <br /> Atuação
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* NATIONAL COVERAGE SECTION — Premium Refinement */}
      <section
        id="national-coverage"
        className="py-[clamp(4rem,8vw,8rem)] px-4 sm:px-6 lg:px-8 bg-[#0D0D0D] relative text-center lg:text-left w-full overflow-hidden"
      >
        {/* Background Decorative Elemets */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full md:w-[800px] h-full md:h-[800px] bg-[#A89048]/5 rounded-full blur-[100px] md:blur-[120px] pointer-events-none" />
        <div className="absolute -top-24 -right-24 w-64 md:w-96 h-64 md:h-96 bg-[#A89048]/10 rounded-full blur-[80px] md:blur-[100px] pointer-events-none" />

        <div className="mx-auto w-[90vw] lg:w-[min(90rem,80vw)] px-4 sm:px-6 lg:px-8 relative z-10 overflow-visible">
          <div className="grid lg:grid-cols-2 gap-[clamp(2rem,5vw,5rem)] items-center w-full">
            {/* Left Content */}
            <div className="order-1 lg:order-1 min-w-0">
              <motion.div
                initial={{ opacity: 0, x: -30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8 }}
              >
                <div className="inline-flex items-center gap-3 px-4 py-2 rounded-full bg-[#A89048]/10 border border-[#A89048]/20 mb-8 backdrop-blur-md mx-auto lg:mx-0">
                  <Globe size={14} className="text-[#A89048]" />
                  <span className="text-[#A89048] text-[10px] font-black uppercase tracking-widest md:tracking-[0.2em]">
                    Cobertura Nacional • Full Support
                  </span>
                </div>

                <h2
                  className="text-[clamp(1.5rem,3vw,2.5rem)] 2xl:text-[clamp(2.25rem,3.5vw,3.5rem)] font-black text-[#FAFAFA] mb-6 leading-[1.1] tracking-tight text-center lg:text-left"
                  style={{ textWrap: "balance" }}
                >
                  Atendimento Digital de{" "}
                  <span className="text-[#A89048]">Alta Performance</span> em
                  todo o Brasil
                </h2>

                <p className="text-slate-400 text-[clamp(1rem,1.1vw,1.125rem)] leading-relaxed mb-10 max-w-xl mx-auto lg:mx-0 font-medium">
                  Não importa onde você esteja. Nossa estrutura foi desenhada
                  para oferecer{" "}
                  <span className="text-slate-200">defesa de excelência</span>{" "}
                  em qualquer estado brasileiro, unindo tecnologia de ponta ao
                  atendimento humano e personalizado que seu caso exige.
                </p>

                {/* Feature Grid */}
                <div className="grid sm:grid-cols-2 gap-4 mb-8">
                  <div className="flex flex-col sm:flex-row items-center sm:items-start gap-2 p-2 rounded-xl bg-white/5 border border-white/10 hover:border-[#A89048]/30 transition-colors text-center sm:text-left">
                    <div className="p-1.5 rounded-lg bg-[#A89048]/20 text-[#A89048]">
                      <ShieldCheck size={16} />
                    </div>
                    <div>
                      <h4 className="text-[#FAFAFA] font-bold text-xs mb-0.5">
                        Presença Nacional
                      </h4>
                      <p className="text-slate-500 text-[10px]">
                        Todas as instâncias e estados.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row items-center sm:items-start gap-2 p-2 rounded-xl bg-white/5 border border-white/10 hover:border-[#A89048]/30 transition-colors text-center sm:text-left">
                    <div className="p-1.5 rounded-lg bg-[#A89048]/20 text-[#A89048]">
                      <Scale size={16} />
                    </div>
                    <div>
                      <h4 className="text-[#FAFAFA] font-bold text-xs mb-0.5">
                        100% Digital
                      </h4>
                      <p className="text-slate-500 text-[10px]">
                        Consultas com agilidade total.
                      </p>
                    </div>
                  </div>
                </div>

                <Button
                  onClick={handleCtaClick}
                  className={`btn-premium bg-linear-to-r from-[#e3c788] via-[#d4b568] to-[#c8aa62] text-slate-900 font-bold text-[clamp(0.9rem,1.2vw,1.25rem)] px-6 py-4 md:px-8 md:py-8 rounded-xl md:rounded-2xl shadow-[0_20px_50px_rgba(168,144,72,0.15)] uppercase tracking-wider transition-all duration-300 w-[90%] mx-auto md:w-auto overflow-hidden text-center justify-center flex ${isShining ? "is-shining scale-105 shadow-xl" : ""}`}
                >
                  {/* Glow overlay — masked by rotating conic-gradient */}
                  <span className="btn-premium-glow-overlay" />
                  <span className="relative z-10 flex items-center gap-2 md:gap-3">
                    FALAR COM ADVOGADO
                    <ChevronRight size={20} className="hidden md:block" />
                    <ChevronRight size={18} className="md:hidden" />
                  </span>
                </Button>
              </motion.div>
            </div>

            {/* Right Content: Animated Map with Luxury Backdrop */}
            <div className="order-2 lg:order-2 flex flex-col items-center lg:items-end relative mt-12 lg:mt-0">
              {/* Radial Glow behind map */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full lg:w-[120%] h-full lg:h-[120%] bg-radial from-[#A89048]/15 to-transparent blur-[60px] pointer-events-none" />

              <motion.div
                initial={{ opacity: 0, scale: 0.9, rotate: -5 }}
                whileInView={{ opacity: 1, scale: 1, rotate: 0 }}
                viewport={{ once: true }}
                animate={{
                  y: [0, -20, 0],
                  rotate: [0, 1, 0, -1, 0],
                }}
                transition={{
                  y: { duration: 6, repeat: Infinity, ease: "easeInOut" },
                  rotate: { duration: 10, repeat: Infinity, ease: "easeInOut" },
                  default: { duration: 1.2, ease: [0.22, 1, 0.36, 1] },
                }}
                className="relative w-[95%] md:w-full max-w-2xl aspect-square drop-shadow-[0_0_50px_rgba(168,144,72,0.15)] mx-auto"
              >
                <Image
                  src="/landing/mapa-brasil-cobertura.png"
                  alt="Mapa de Cobertura Nacional André Lustosa"
                  fill
                  className="object-contain"
                  priority
                />
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.5, duration: 0.8 }}
                className="mt-12 lg:-mt-24 text-center lg:text-right w-full relative z-10"
              >
                <div className="inline-block px-6 py-3 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm">
                  <h4 className="text-[#FAFAFA] font-bold text-xl mb-1 text-center lg:text-right">
                    Nossa Sede Central
                  </h4>
                  <div className="flex items-center justify-center lg:justify-end gap-2 text-[#A89048]">
                    <MapPin size={16} />
                    <p className="font-black tracking-widest md:tracking-[0.2em] text-xs uppercase">
                      Arapiraca - AL
                    </p>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      </section>

      <section
        id="excellence"
        className="py-[clamp(4rem,8vw,8rem)] px-4 sm:px-6 lg:px-8 bg-linear-to-b from-[#E8E8E8] to-[#DCDCDC] overflow-hidden text-center lg:text-left relative"
      >
        {/* Luxury Background Ornaments - Refined for visibility and elegance */}
        <div className="absolute inset-0 bg-[radial-gradient(#A89048_1px,transparent_1px)] bg-size-[40px_40px] opacity-[0.05] pointer-events-none" />
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-[#A89048]/10 rounded-full blur-[120px] -translate-y-1/2 translate-x-1/2 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-[#A89048]/10 rounded-full blur-[120px] translate-y-1/2 -translate-x-1/2 pointer-events-none" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-[radial-gradient(circle_at_50%_50%,rgba(168,144,72,0.04)_0%,transparent_70%)] pointer-events-none" />

        <div className="mx-auto w-[90vw] lg:w-[min(90rem,80vw)] px-4 sm:px-6 lg:px-8 relative z-10">
          {/* Header - Centered for more impact and "middle of the page" presence */}
          <div className="flex flex-col items-center text-center mb-[clamp(3rem,5vw,5rem)] px-4 max-w-4xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="w-full flex flex-col items-center"
            >
              <div className="flex items-center justify-center gap-4 mb-6">
                <div className="h-[2px] w-12 bg-[#A89048]" />
                <span className="text-[#A89048] text-sm font-black tracking-[0.4em] uppercase">
                  Excelência
                </span>
                <div className="h-[2px] w-12 bg-[#A89048]" />
              </div>
              <h2 className="text-[clamp(1.5rem,2.8vw,2.75rem)] 2xl:text-[clamp(2rem,3.2vw,3.5rem)] font-black text-[#1A1A1A] leading-[1.1] uppercase wrap-break-word hyphens-auto mb-8">
                O ESCRITÓRIO JURÍDICO <br />
                <span className="text-[#A89048]">ANDRÉ LUSTOSA</span> <br />
                <span className="text-[#A89048]">ADVOGADOS!</span>
              </h2>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="w-full"
            >
              <p className="text-[#444444] text-[clamp(1rem,1.1vw,1.125rem)] font-medium leading-relaxed max-w-2xl mx-auto">
                Unimos tradição jurídica à inovação tecnológica para entregar
                resultados excepcionais. Nossa estrutura é moldada para a
                agilidade do mundo moderno e a máxima proteção dos seus
                interesses.
              </p>
            </motion.div>
          </div>

          {/* Values Grid */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 px-4">
            {[
              {
                icon: <Lightbulb size={32} strokeWidth={1.5} />,
                title: "Criatividade e Inovação",
                desc: "Desenvolvemos soluções sólidas e criativas que desafiam o status quo. Nossa abordagem inovadora transforma obstáculos complexos em oportunidades estratégicas para garantir o seu direito.",
              },
              {
                icon: <Bot size={32} strokeWidth={1.5} />,
                title: "Tecnologia e Agilidade",
                desc: "Utilizamos as mais modernas ferramentas de inteligência jurídica para processar dados e acelerar decisões. Tecnologia de ponta a serviço da sua causa para resultados mais rápidos e precisos.",
              },
              {
                icon: <Users size={32} strokeWidth={1.5} />,
                title: "Equipe de Especialista",
                desc: "Nossa equipe é formada por especialistas renomados em diversas áreas do Direito. Cada caso é analisado por mentes brilhantes dedicadas a encontrar a melhor estratégia jurídica possível.",
              },
              {
                icon: <Headphones size={32} strokeWidth={1.5} />,
                title: "Atendimento Exclusivo",
                desc: "Oferecemos um suporte humanizado e 100% focado no cliente. Você tem acesso direto aos especialistas, garantindo transparência total e uma experiência de atendimento verdadeiramente VIP.",
              },
              {
                icon: <Zap size={32} strokeWidth={1.5} />,
                title: "Resolução Eficiente",
                desc: "Nosso padrão é a celeridade absoluta. Combatemos a morosidade com proatividade e diligência constante para que sua demanda seja resolvida no menor tempo viável, sem abrir mão da qualidade.",
              },
              {
                icon: <Phone size={32} strokeWidth={1.5} />,
                title: "Plantão Jurídico 24h",
                desc: "Emergências não escolhem hora. Por isso, mantemos suporte ininterrupto via canais digitais. Estamos onde você estiver, a qualquer momento, garantindo segurança jurídica quando você mais precisa.",
              },
            ].map((value, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: idx * 0.1 }}
                whileHover={{
                  scale: 1.02,
                  backgroundColor: "#272727",
                  borderColor: "#A89048",
                  boxShadow: "0 25px 50px rgba(0,0,0,0.25)",
                }}
                className="group bg-[#EEF0F3] p-6 md:p-8 rounded-2xl border border-slate-200 shadow-sm flex flex-col items-center lg:items-start transition-all duration-300 cursor-default text-center lg:text-left gap-6 overflow-hidden relative"
              >
                {/* Accent Line on Hover */}
                <div className="absolute top-0 left-0 w-full h-1 bg-[#A89048] opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                <div className="w-14 h-14 rounded-xl bg-[#A89048]/10 flex items-center justify-center text-[#A89048] group-hover:bg-[#A89048] group-hover:text-white transition-all duration-300 shrink-0 relative z-10">
                  {value.icon}
                </div>
                <div className="relative z-10">
                  <h3 className="text-[#1A1A1A] text-xl font-black mb-3 group-hover:text-[#FAFAFA] transition-colors duration-300">
                    {value.title}
                  </h3>
                  <p className="text-[#666666] text-sm leading-relaxed group-hover:text-slate-300 transition-colors duration-300 font-medium">
                    {value.desc}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Redundant sections below removed as per design unification */}

      {/* COMO FUNCIONA — Interactive Journey Navigator */}
      <section
        id="steps"
        className="py-[clamp(4rem,8vw,8rem)] bg-[#0B0B0B] relative overflow-hidden"
      >
            {/* Background Decor */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-[radial-gradient(circle_at_50%_20%,rgba(168,144,72,0.12)_0%,transparent_70%)] pointer-events-none" />
            <div className="absolute -left-24 top-1/4 w-96 h-96 bg-[#A89048]/5 rounded-full blur-[100px] pointer-events-none" />

            <div className="mx-auto w-[90vw] lg:w-[min(90rem,80vw)] px-4 sm:px-6 lg:px-8 relative z-10">
              <div className="flex flex-col items-center text-center mb-[clamp(4rem,6vw,6rem)]">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.8 }}
                >
                  <div className="inline-flex items-center gap-3 px-4 py-2 rounded-full bg-[#A89048]/10 border border-[#A89048]/20 mb-6 backdrop-blur-md">
                    <Clock size={14} className="text-[#A89048]" />
                    <span className="text-[#A89048] text-[10px] font-black uppercase tracking-widest">
                      A Jornada do Cliente • André Lustosa Advogados
                    </span>
                  </div>
                  <h2 className="text-[clamp(1.75rem,3.5vw,3rem)] font-black text-[#FAFAFA] mb-6 leading-tight uppercase">
                    Como Funciona Seu{" "}
                    <span className="text-[#A89048]">Atendimento</span>
                  </h2>
                  <p className="text-[clamp(1rem,1.1vw,1.125rem)] text-slate-400 max-w-2xl mx-auto font-medium">
                    Uma experiência digital de{" "}
                    <span className="text-slate-200">alto padrão</span>,
                    desenhada para quem busca agilidade e segurança jurídica.
                  </p>
                </motion.div>
              </div>

              <div className="relative max-w-6xl mx-auto">
                {/* Stage Selector Bar - Compacted to avoid scroll on PC */}
                <div className="flex items-center gap-1 md:gap-2 mb-12 p-2 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl relative z-20 overflow-x-auto scrollbar-hide">
                  {displaySteps.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => setActiveStep(index)}
                      className={`flex-1 min-w-[85px] md:min-w-0 py-3 md:py-4 px-2 md:px-4 rounded-xl transition-all duration-500 relative flex flex-col items-center gap-1 md:gap-2 group ${
                        activeStep === index
                          ? "bg-[#A89048] shadow-[0_10px_30px_rgba(168,144,72,0.4)]"
                          : "hover:bg-white/5"
                      }`}
                    >
                      <span
                        className={`text-[10px] font-black uppercase tracking-tighter ${activeStep === index ? "text-[#0B0B0B]" : "text-slate-500"}`}
                      >
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div
                        className={`w-8 h-1 rounded-full transition-all duration-500 ${activeStep === index ? "bg-[#0B0B0B]/30" : "bg-white/10"}`}
                      />
                    </button>
                  ))}
                </div>

                {/* Active Step Content Stage */}
                <div className="relative min-h-[450px] md:min-h-[500px]">
                  {displaySteps.map((step: { title: string; description: string; icon?: React.ReactNode }, index: number) => {
                    const getStepIcon = (idx: number, title: string) => {
                      if (step.icon) return step.icon;
                      const t = title.toLowerCase();
                      if (t.includes("contato") || t.includes("whatsapp"))
                        return <MessageCircle key="whatsapp" size={48} />;
                      if (t.includes("análise") || t.includes("documento"))
                        return <FileText key="filetext" size={48} />;
                      if (t.includes("consult") || t.includes("reunião"))
                        return <Users key="users" size={48} />;
                      if (t.includes("estratégia") || t.includes("plano"))
                        return <Lightbulb key="lightbulb" size={48} />;
                      if (t.includes("ação") || t.includes("protocolo"))
                        return <Gavel key="gavel" size={48} />;
                      if (t.includes("resultado") || t.includes("fim"))
                        return <Award key="award" size={48} />;
                      
                      const defaults = [
                        <MessageCircle key="d1" size={48} />,
                        <Search key="d2" size={48} />,
                        <FileText key="d3" size={48} />,
                        <CheckCircle2 key="d4" size={48} />,
                      ];
                      return defaults[idx] || <Zap key="dz" size={48} />;
                    };

                    return (
                      <motion.div
                        key={index}
                        initial={{ opacity: 0, x: 20, scale: 0.98 }}
                        animate={{
                          opacity: activeStep === index ? 1 : 0,
                          x:
                            activeStep === index
                              ? 0
                              : activeStep > index
                                ? -20
                                : 20,
                          scale: activeStep === index ? 1 : 0.98,
                          zIndex: activeStep === index ? 10 : 0,
                        }}
                        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                        className={`absolute inset-0 w-full h-full pointer-events-none ${activeStep === index ? "pointer-events-auto" : ""}`}
                      >
                        <div className="h-full w-full p-8 md:p-16 rounded-[2.5rem] bg-linear-to-br from-white/[0.08] to-transparent border border-white/10 backdrop-blur-3xl shadow-[0_30px_60px_rgba(0,0,0,0.5)] flex flex-col md:flex-row items-center gap-6 md:gap-12 overflow-hidden relative">
                          {/* Large Background Numerals */}
                          <span className="absolute -left-10 -top-10 text-[15rem] md:text-[20rem] font-black text-[#A89048]/5 italic pointer-events-none select-none">
                            {index + 1}
                          </span>

                          {/* Visual Area */}
                          <div className="w-full md:w-1/3 flex flex-col items-center justify-center relative">
                            <motion.div
                              animate={
                                activeStep === index
                                  ? {
                                      scale: [1, 1.05, 1],
                                      rotate: [0, 2, 0, -2, 0],
                                    }
                                  : {}
                              }
                              transition={{
                                duration: 6,
                                repeat: Infinity,
                                ease: "linear",
                              }}
                              className="w-24 h-24 md:w-48 md:h-48 rounded-[2rem] bg-linear-to-br from-[#A89048]/20 to-[#A89048]/5 border border-[#A89048]/30 flex items-center justify-center text-[#A89048] shadow-[0_0_50px_rgba(168,144,72,0.2)] [&>svg]:w-10 [&>svg]:h-10 md:[&>svg]:w-16 md:[&>svg]:h-16"
                            >
                              {getStepIcon(index, step.title)}
                            </motion.div>
                          </div>

                          {/* Text Area */}
                          <div className="flex-1 text-center md:text-left relative z-10">
                            <motion.div
                              initial={{ opacity: 0, y: 10 }}
                              animate={
                                activeStep === index ? { opacity: 1, y: 0 } : {}
                              }
                              transition={{ delay: 0.3 }}
                            >
                              <h3 className="text-xl md:text-5xl font-black text-[#FAFAFA] uppercase tracking-tight mb-3 md:mb-6 leading-tight">
                                {step.title}
                              </h3>
                              <p className="text-base md:text-xl text-slate-400 leading-relaxed font-medium">
                                {step.description}
                              </p>

                              {/* Step Progress Info */}
                              <div className="mt-8 md:mt-12 pt-6 md:pt-8 border-t border-white/10 flex items-center justify-center md:justify-start gap-8 md:gap-12">
                                <div>
                                  <p className="text-[9px] md:text-[10px] uppercase tracking-widest text-[#A89048] font-black mb-1">
                                    Status
                                  </p>
                                  <p className="text-slate-200 font-bold text-sm md:text-base">
                                    100% Digital
                                  </p>
                                </div>
                                <div className="h-6 md:h-8 w-px bg-white/10" />
                                <div>
                                  <p className="text-[9px] md:text-[10px] uppercase tracking-widest text-[#A89048] font-black mb-1">
                                    Foco
                                  </p>
                                  <p className="text-slate-200 font-bold text-sm md:text-base">
                                    Agilidade Total
                                  </p>
                                </div>
                              </div>
                            </motion.div>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>

              {/* Navigation Controls (Dots & Arrows) */}
              <div className="mt-10 md:mt-12 flex items-center justify-center gap-4 md:gap-8">
                <button
                  onClick={prevStep}
                  className="w-10 h-10 md:w-12 md:h-12 rounded-full border border-white/10 bg-white/5 flex items-center justify-center text-slate-400 hover:bg-[#A89048] hover:text-[#0B0B0B] transition-all group"
                >
                  <ChevronLeft
                    size={20}
                    className="md:w-6 md:h-6 transition-transform"
                  />
                </button>
                <div className="flex items-center gap-2 md:gap-3">
                  {displaySteps.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => setActiveStep(index)}
                      className={`h-1.5 md:h-2 rounded-full transition-all duration-500 ${activeStep === index ? "w-8 md:w-12 bg-[#A89048]" : "w-1.5 md:w-2 bg-white/20"}`}
                    />
                  ))}
                </div>
                <button
                  onClick={nextStep}
                  className="w-10 h-10 md:w-12 md:h-12 rounded-full border border-white/10 bg-white/5 flex items-center justify-center text-slate-400 hover:bg-[#A89048] hover:text-[#0B0B0B] transition-all group"
                >
                  <ChevronRight
                    size={20}
                    className="md:w-6 md:h-6 transition-transform"
                  />
                </button>
              </div>

              {/* Final CTA in section */}
              <div className="mt-12 md:mt-16 text-center px-4">
                <Button
                  onClick={handleCtaClick}
                  className={`btn-premium bg-linear-to-r from-[#e3c788] via-[#d4b568] to-[#c8aa62] text-[#0B0B0B] font-black w-full md:w-auto px-8 md:px-12 py-5 md:py-7 rounded-xl md:rounded-2xl shadow-[0_15px_50px_rgba(168,144,72,0.3)] transition-all transform hover:scale-105 active:scale-95 text-base md:text-lg ${isShining ? "is-shining scale-105 shadow-xl" : ""}`}
                >
                  <span className="btn-premium-glow-overlay" />
                  <span className="relative z-10 flex items-center justify-center">
                    INICIAR MEU ATENDIMENTO AGORA
                    <ChevronRight className="ml-2 w-5 h-5 md:w-6 md:h-6" />
                  </span>
                </Button>
              </div>
            </div>
      </section>

      {/* FAQ — Elegant Light Section */}
      <section
        id="faq"
        className="py-[clamp(4rem,10vw,10rem)] bg-slate-50 relative overflow-hidden"
      >
            {/* Subtitle floating background deco */}
            <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#A89048]/5 rounded-full blur-[120px] -mr-64 -mt-64 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-slate-200/50 rounded-full blur-[100px] -ml-48 -mb-48 pointer-events-none" />

            <div className="mx-auto w-[90vw] lg:w-[min(90rem,80vw)] px-4 sm:px-6 lg:px-8 relative z-10">
              <div className="flex flex-col items-center text-center mb-[clamp(4rem,6vw,6rem)]">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                >
                  <div className="inline-flex items-center gap-3 px-4 py-2 rounded-full bg-slate-200 border border-slate-300 mb-6 shadow-sm">
                    <Lightbulb size={14} className="text-[#A89048]" />
                    <span className="text-slate-600 text-[10px] font-black uppercase tracking-widest">
                      Esclarecimentos Jurídicos
                    </span>
                  </div>
                  <h2 className="text-[clamp(1.75rem,3.5vw,3rem)] font-black text-slate-900 mb-6 leading-tight uppercase">
                    Dúvidas <span className="text-[#A89048]">Frequentes</span>
                  </h2>
                  <p className="text-[clamp(1rem,1.1vw,1.125rem)] text-slate-500 max-w-2xl mx-auto font-medium">
                    Transparência total sobre os seus direitos. Clique nas
                    perguntas para entender como atuamos na{" "}
                    <span className="text-slate-800">sua defesa</span>.
                  </p>
                </motion.div>
              </div>

              <div className="max-w-4xl mx-auto">
                <div className="grid grid-cols-1 gap-4">
                  {displayFaq.map((item, index) => (
                    <FaqItem
                      key={index}
                      question={item.question}
                      answer={item.answer}
                      index={index}
                    />
                  ))}
                </div>

                <motion.div
                  initial={{ opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.5 }}
                  className="mt-16 p-8 rounded-3xl bg-white border border-slate-100 shadow-xl shadow-slate-200/50 flex flex-col md:flex-row items-center justify-between gap-8"
                >
                  <div className="flex items-center gap-6">
                    <div className="w-16 h-16 rounded-2xl bg-[#A89048]/10 flex items-center justify-center text-[#A89048] shrink-0">
                      <Headphones size={32} />
                    </div>
                    <div className="text-center md:text-left">
                      <h4 className="text-xl font-black text-slate-900 uppercase tracking-tight">
                        Ainda tem dúvidas específicas?
                      </h4>
                      <p className="text-slate-500 font-medium">
                        Nossa equipe jurídica está pronta para uma consulta
                        imediata.
                      </p>
                    </div>
                  </div>
                  <Button
                    onClick={handleCtaClick}
                    className="bg-[#0B0B0B] hover:bg-slate-800 text-[#FAFAFA] font-black px-8 py-6 rounded-xl space-x-2 tracking-widest uppercase transition-all shadow-lg hover:shadow-xl shrink-0"
                  >
                    <span>Falar com Advogado Agora</span>
                    <ChevronRight size={18} />
                  </Button>
                </motion.div>
              </div>
            </div>
      </section>

      {/* PREMIUM CREATIVE FOOTER */}
      <footer className="relative bg-[#111111] text-slate-300 py-[clamp(3rem,6vw,6rem)] w-full overflow-hidden font-ubuntu border-t border-[#A89048]/20">
        
        {/* Glow effects */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(168,144,72,0.05)_0%,transparent_60%)] pointer-events-none" />

        {/* GIANT BACKGROUND TYPOGRAPHY */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full flex items-center justify-center pointer-events-none z-0 overflow-hidden">
          <span className="text-[clamp(5rem,12vh,20rem)] md:text-[clamp(6rem,15vw,20rem)] font-black text-[#FAFAFA]/[0.02] tracking-tighter leading-none block select-none -rotate-90 md:rotate-0 whitespace-nowrap">
            ARAPIRACA
          </span>
        </div>

        <div className="mx-auto w-[90vw] lg:w-[min(90rem,80vw)] px-4 sm:px-6 lg:px-8 relative z-10 grid md:grid-cols-12 gap-12 items-start py-8">
          
          {/* BRAND & INFO (5 cols) */}
          <div className="md:col-span-5 flex flex-col items-center md:items-start text-center md:text-left">
            <Image
              src="/landing/logo_andre_lustosa_transparente.png"
              alt="André Lustosa Advogados"
              width={240}
              height={65}
              className="h-20 lg:h-24 w-auto object-contain mb-6 drop-shadow-[0_2px_10px_rgba(255,255,255,0.1)]"
            />
            <h4 className="text-[#FAFAFA] font-bold text-sm md:text-base mb-6 tracking-wide drop-shadow-sm">
              Escritório de Advocacia em Arapiraca – AL
            </h4>
            <p className="text-slate-300 text-sm md:text-[0.95rem] leading-relaxed max-w-sm md:max-w-md font-medium">
              Atuamos com excelência técnica, visão estratégica e sensibilidade no atendimento.<br/>
              Com estrutura para atender presencialmente em Arapiraca e virtualmente em todo o Brasil, oferecemos soluções jurídicas personalizadas e eficazes para pessoas físicas e jurídicas.
            </p>
          </div>

          {/* MAPA DO SITE (3 cols) */}
          <div className="md:col-span-3 flex flex-col items-center">
            <h3 className="text-[#FAFAFA] font-bold text-base md:text-lg mb-8 tracking-wider opacity-90">MAPA DO SITE</h3>
            <ul className="space-y-5 text-center text-sm font-bold text-slate-200">
              <li><a href="#" className="hover:text-[#A89048] transition-colors">Home</a></li>
              <li><button onClick={() => document.getElementById('office')?.scrollIntoView({ behavior: 'smooth' })} className="hover:text-[#A89048] transition-colors">O Escritório</button></li>
              <li>
                <button onClick={() => document.getElementById('areas')?.scrollIntoView({ behavior: 'smooth' })} className="hover:text-[#A89048] transition-colors flex items-center justify-center gap-1">
                  Áreas de Atuação <ChevronDown size={14} />
                </button>
              </li>
              <li><a href="#" className="hover:text-[#A89048] transition-colors">Advocacia digital</a></li>
              <li><a href="#" className="hover:text-[#A89048] transition-colors">Blog</a></li>
              <li><a href="#" className="hover:text-[#A89048] transition-colors">Equipe</a></li>
              <li><a href="#" className="hover:text-[#A89048] transition-colors">Fale Conosco</a></li>
            </ul>
          </div>

          {/* CONTATOS (4 cols) */}
          <div className="md:col-span-4 flex flex-col items-center lg:items-start lg:pl-8">
            <h3 className="text-[#FAFAFA] font-bold text-base md:text-lg mb-8 tracking-wider opacity-90">CONTATOS:</h3>
            <div className="space-y-6 text-sm md:text-[0.95rem] text-slate-300 font-medium w-full max-w-[280px]">
              <a href={waLink} target="_blank" rel="noreferrer" className="flex items-center gap-5 group">
                <div className="w-11 h-11 rounded-full border border-[#A89048] flex items-center justify-center text-[#A89048] group-hover:bg-[#A89048]/20 transition-all shadow-[0_0_15px_rgba(168,144,72,0.15)] shrink-0">
                  <Phone size={20} />
                </div>
                <span className="group-hover:text-white transition-colors">{footer?.phones?.[0] || "82 99639-0799"}</span>
              </a>
              <a href={`mailto:${footer?.email || "contato@andrelustosa.com.br"}`} className="flex items-center gap-5 group">
                <div className="w-11 h-11 rounded-full border border-[#A89048] flex items-center justify-center text-[#A89048] group-hover:bg-[#A89048]/20 transition-all shadow-[0_0_15px_rgba(168,144,72,0.15)] shrink-0">
                  <Mail size={20} />
                </div>
                <span className="group-hover:text-white transition-colors">{footer?.email || "contato@andrelustosa.com.br"}</span>
              </a>
              <a href={footer?.social?.instagram || "https://www.instagram.com/andrelustosaadvogados/"} target="_blank" rel="noreferrer" className="flex items-center gap-5 group">
                <div className="w-11 h-11 rounded-full border border-[#A89048] flex items-center justify-center text-[#A89048] group-hover:bg-[#A89048]/20 transition-all shadow-[0_0_15px_rgba(168,144,72,0.15)] shrink-0">
                  <Instagram size={20} />
                </div>
                <span className="group-hover:text-white transition-colors">@andrelustosaadvogados</span>
              </a>
              <div className="flex items-center gap-5 group">
                <div className="w-11 h-11 rounded-full border border-[#A89048] flex items-center justify-center text-[#A89048] group-hover:bg-[#A89048]/20 transition-all shadow-[0_0_15px_rgba(168,144,72,0.15)] shrink-0">
                  <Clock size={20} />
                </div>
                <span className="group-hover:text-white transition-colors">Atendimento 24 Horas</span>
              </div>
              <div className="flex items-center gap-5 group">
                <div className="w-11 h-11 rounded-full border border-[#A89048] flex items-center justify-center text-[#A89048] group-hover:bg-[#A89048]/20 transition-all shadow-[0_0_15px_rgba(168,144,72,0.15)] shrink-0">
                  <MapPin size={20} />
                </div>
                <span className="group-hover:text-white transition-colors">Arapiraca-AL</span>
              </div>
            </div>
          </div>

        </div>

        {/* BOTTOM BAR */}
        <div className="relative z-10 mx-auto w-[90vw] lg:w-[min(90rem,80vw)] px-4 sm:px-6 lg:px-8">
          <div className="border-t border-white/10 pt-8 pb-4 flex flex-col md:flex-row items-center justify-between text-[13px] text-slate-400 font-medium">
            <p>&copy; {new Date().getFullYear()} – Todos os Direitos Reservados à André Lustosa Advogados.</p>
            <div className="flex items-center gap-2 mt-4 md:mt-0 font-bold">
              <a href="#" className="hover:text-white transition-colors">Termos de Uso</a>
              <span className="opacity-50">|</span>
              <a href="#" className="hover:text-white transition-colors">Política de Privacidade</a>
            </div>
          </div>
        </div>
      </footer>

      {/* FLOATING WHATSAPP */}
      <button
        onClick={handleCtaClick}
        className="fixed bottom-6 right-6 bg-[#25D366] hover:bg-[#128C7E] text-[#FAFAFA] p-4 rounded-full shadow-[0_10px_30px_rgba(37,211,102,0.4)] z-50 animate-bounce hover:animate-none transition-all duration-300 group"
      >
        <div className="absolute inset-0 rounded-full bg-white opacity-0 group-hover:opacity-20 transition-opacity" />
        <MessageCircle size={32} />
      </button>
    </div>
  );
}

// Sub-components
function FaqItem({
  question,
  answer,
  index,
}: {
  question: string;
  answer: string;
  index: number;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.05 }}
      className={`group rounded-[1.25rem] transition-all duration-300 ${
        isOpen
          ? "bg-white border-transparent shadow-2xl shadow-[#A89048]/10"
          : "bg-white/60 hover:bg-white border border-slate-200/50 hover:border-[#A89048]/30 shadow-sm"
      }`}
    >
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-6 md:p-8 text-left transition-all"
      >
        <div className="flex items-center gap-4 md:gap-6">
          <span
            className={`text-sm font-black transition-colors ${isOpen ? "text-[#A89048]" : "text-slate-300"}`}
          >
            {String(index + 1).padStart(2, "0")}
          </span>
          <span
            className={`text-base md:text-lg font-black tracking-tight leading-snug uppercase ${isOpen ? "text-slate-900" : "text-slate-700"}`}
          >
            {question}
          </span>
        </div>
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-500 border ${
            isOpen
              ? "bg-[#A89048] border-[#A89048] text-[#0B0B0B] rotate-180"
              : "bg-slate-50 border-slate-200 text-slate-400 group-hover:border-[#A89048]/30"
          }`}
        >
          <ChevronDown size={20} />
        </div>
      </button>
      <motion.div
        initial={false}
        animate={{ height: isOpen ? "auto" : 0, opacity: isOpen ? 1 : 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="overflow-hidden"
      >
        <div className="px-6 md:px-8 pb-8 pt-2">
          <div className="flex gap-4 md:gap-6">
            <div className="w-px bg-linear-to-b from-[#A89048] to-transparent ml-[15px] md:ml-[23px] shrink-0" />
            <p className="text-slate-500 text-base md:text-lg leading-relaxed font-medium">
              {answer}
            </p>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
