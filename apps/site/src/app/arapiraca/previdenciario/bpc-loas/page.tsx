import { HighConversionTemplate } from "@/components/lp/templates/HighConversionTemplate";
import { LPTracker } from "@/components/lp/LPTracker";
import { LPTemplateContent } from "@/types/landing-page";
import localFont from "next/font/local";
import Script from "next/script";
import { Metadata } from "next";

const baseUrl = "https://andrelustosaadvogados.com.br";
const url = `${baseUrl}/arapiraca/previdenciario/bpc-loas`;
const image = `${baseUrl}/landing/previdenciario-bpc-loas-hero.png`;

const title = "BPC/LOAS negado em Arapiraca? Advogado (idoso e PcD)";
const description =
  "Idoso 65+ ou pessoa com deficiência de baixa renda teve o BPC/LOAS negado ou cortado em Arapiraca-AL? Entenda o benefício assistencial de 1 salário mínimo e como recorrer.";

export const metadata: Metadata = {
  title,
  description,
  keywords:
    "BPC LOAS Arapiraca, benefício assistencial Arapiraca, BPC idoso Arapiraca, BPC deficiente Arapiraca, LOAS negado Arapiraca, INSS Arapiraca, advogado previdenciário Arapiraca, benefício de prestação continuada Arapiraca",
  alternates: { canonical: url },
  openGraph: {
    title,
    description,
    url,
    siteName: "André Lustosa Advogados",
    locale: "pt_BR",
    type: "website",
    images: [
      {
        url: image,
        width: 1672,
        height: 941,
        alt: "Advogado de BPC/LOAS em Arapiraca-AL",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [image],
    creator: "@andrelustosa",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

const neueMontreal = localFont({
  src: [
    { path: "../../../../../public/fonts/NeueMontreal-Regular.woff2", weight: "400", style: "normal" },
    { path: "../../../../../public/fonts/NeueMontreal-Medium.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-neue-montreal",
  display: "swap",
});

const displayFont = localFont({
  src: [{ path: "../../../../../public/fonts/NeueMontreal-Medium.woff2", weight: "500", style: "normal" }],
  variable: "--font-playfair",
  display: "swap",
});

const faqItems = [
  {
    question: "O que é o BPC/LOAS e quem tem direito?",
    answer:
      "O Benefício de Prestação Continuada (BPC/LOAS) garante um salário mínimo por mês ao idoso com 65 anos ou mais e à pessoa com deficiência, ambos de baixa renda. Não é aposentadoria e não exige contribuição ao INSS — é um benefício assistencial.",
  },
  {
    question: "Qual é o limite de renda para receber o BPC?",
    answer:
      "Em regra, a renda por pessoa da família deve ser igual ou inferior a 1/4 do salário mínimo, mas esse critério pode ser flexibilizado diante de despesas com saúde, remédios e outras situações. Por isso, mesmo quem já foi negado por renda pode ter o caso reavaliado.",
  },
  {
    question: "O INSS negou meu BPC. Posso recorrer?",
    answer:
      "Sim. A negativa do benefício assistencial é comum e nem sempre correta. Analisamos o motivo (renda, perícia ou cadastro) e avaliamos o recurso administrativo ou a ação judicial para buscar a concessão do BPC.",
  },
  {
    question: "A perícia disse que não há deficiência. E agora?",
    answer:
      "Para o BPC, considera-se a deficiência que gera impedimento de longo prazo (mínimo de 2 anos). Quando a perícia do INSS não reconhece esse impedimento, é possível levar o caso à Justiça, com perícia médica judicial e laudos que demonstrem a limitação.",
  },
  {
    question: "Meu BPC estava ativo e foi cortado. Dá para restabelecer?",
    answer:
      "Sim. O corte ou a suspensão do BPC em revisão pode ser questionado. Reunimos os documentos da família e o histórico do benefício para pedir o restabelecimento pela via administrativa ou judicial.",
  },
  {
    question: "Atende idosos e pessoas com deficiência em Arapiraca e região?",
    answer:
      "Sim. Atendemos presencialmente na Rua Francisco Rodrigues Viana, 244, Baixa Grande, Arapiraca-AL, e de forma 100% digital pelo WhatsApp (82) 99639-0799, facilitando o atendimento de quem tem dificuldade de locomoção.",
  },
];

const content: LPTemplateContent = {
  hero: {
    title:
      "Advogado Previdenciário em Arapiraca – AL\nBPC/LOAS negado? 1 salário mínimo (idoso e PcD)",
    subtitle:
      "O Benefício de Prestação Continuada garante um salário mínimo por mês ao idoso com 65 anos ou mais e à pessoa com deficiência de baixa renda. Não é aposentadoria e não exige contribuição ao INSS. Se o pedido foi negado ou cortado, é possível recorrer.",
    mobileSubtitle:
      "1 salário mínimo por mês para idoso 65+ e pessoa com deficiência de baixa renda. Foi negado? Vamos analisar.",
    ctaText: "Analisar meu BPC",
    ctaLink: "https://wa.me/5582996390799",
    backgroundDesktop: "/landing/previdenciario-bpc-loas-hero.webp",
    backgroundMobile: "/landing/previdenciario-bpc-loas-hero-mobile.webp",
    badgesPosition: "low",
  },
  practiceAreas: [
    {
      iconName: "FileWarning",
      title: "INSS negou seu benefício",
      description:
        "Recurso administrativo e ação judicial contra a negativa ou o corte indevido do INSS.",
      href: "/arapiraca/previdenciario/beneficio-negado",
      bgImage: "/landing/previdenciario-beneficio-negado-hero.webp",
      tag: "PREVIDENCIÁRIO",
    },
    {
      iconName: "Stethoscope",
      title: "Auxílio-doença",
      description:
        "Afastamento por incapacidade temporária, alta indevida e restabelecimento do benefício cessado.",
      href: "/arapiraca/previdenciario/auxilio-doenca",
      bgImage: "/landing/previdenciario-auxilio-doenca-hero.webp",
      tag: "PREVIDENCIÁRIO",
    },
    {
      iconName: "ShieldCheck",
      title: "Aposentadoria",
      description:
        "Análise do tempo de contribuição e concessão da aposentadoria pelo INSS no momento certo.",
      href: "/arapiraca/previdenciario/aposentadoria",
      bgImage: "/landing/previdenciario-aposentadoria-hero.webp",
      tag: "PREVIDENCIÁRIO",
    },
  ],
  sectionLabels: {
    servicesTag: "OUTRAS ÁREAS DO PREVIDENCIÁRIO",
    servicesTitle:
      "Veja também em <span style=\"color:#A89048\">Previdenciário / INSS</span>",
    servicesDescription:
      "Além deste tema, o escritório atua em outras demandas de benefícios do INSS em Arapiraca e região do Agreste. Conheça e fale com um advogado pelo WhatsApp.",
    bannerTitle:
      "Advocacia Previdenciária <span style=\"color:#A89048\">em Arapiraca-AL</span>",
    officeTag: "ESCRITÓRIO JURÍDICO EM ARAPIRACA",
    officeTitle:
      "Atendimento Presencial em <span style=\"color:#A89048\">Arapiraca-AL</span> e Digital para Todo o Brasil",
    officeDescription:
      "<p>O <strong>André Lustosa Advogados</strong> atende em Arapiraca-AL há mais de 10 anos, com atuação dedicada em Direito Previdenciário e nos benefícios do INSS. Nossa sede fica na Rua Francisco Rodrigues Viana, 244, bairro Baixa Grande, Arapiraca-AL.</p><p>Atendemos presencialmente moradores de Arapiraca, Palmeira dos Índios, São Sebastião, Girau do Ponciano, Taquarana e toda a região do Agreste. Também operamos com estrutura 100% digital para clientes em qualquer estado do Brasil.</p>",
    excellenceTitle: "Atendimento humano, técnico e transparente",
  },
  steps: [
    {
      title: "Análise do seu caso",
      description:
        "Você conta a situação pelo WhatsApp e envia documentos da família, laudos e a decisão do INSS que tiver. Com esses documentos, avaliamos o seu caso.",
    },
    {
      title: "Estratégia previdenciária",
      description:
        "Avaliamos a renda familiar, o CadÚnico e o impedimento de longo prazo para definir entre o recurso no INSS ou a ação judicial.",
    },
    {
      title: "Atuação e acompanhamento",
      description:
        "Cuidamos do recurso ou do processo, dos pedidos de perícia médica e social e mantemos você informado até a decisão final.",
    },
  ],
  faq: faqItems,
  footer: {
    address: "Rua Francisco Rodrigues Viana, 244, Baixa Grande, Arapiraca-AL",
    phones: ["82 99639-0799"],
    email: "contato@andrelustosaadvogados.com.br",
    social: {
      instagram: "https://www.instagram.com/andrelustosaadvogados/",
      facebook: "https://www.facebook.com/andrelustosa",
      linkedin: "",
    },
  },
};

export default function BpcLoasPrevidenciarioPage() {
  const legalServiceJsonLd = {
    "@context": "https://schema.org",
    "@type": ["LegalService", "LocalBusiness"],
    name: "André Lustosa Advogados - BPC/LOAS em Arapiraca",
    description,
    image,
    url,
    telephone: "+5582996390799",
    address: {
      "@type": "PostalAddress",
      streetAddress: "Rua Francisco Rodrigues Viana, 244",
      addressLocality: "Arapiraca",
      addressRegion: "AL",
      postalCode: "57300-000",
      addressCountry: "BR",
    },
    areaServed: [
      {
        "@type": "City",
        name: "Arapiraca",
        containedInPlace: { "@type": "State", name: "Alagoas" },
      },
      { "@type": "State", name: "Alagoas" },
    ],
    serviceType: [
      "BPC/LOAS para idoso 65+",
      "BPC/LOAS para pessoa com deficiência",
      "Recurso contra negativa do BPC/LOAS",
      "Restabelecimento de BPC cortado",
      "Ação judicial de benefício assistencial",
      "Direito Previdenciário em Arapiraca",
    ],
  };

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqItems.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };

  return (
    <div className={`${neueMontreal.variable} ${displayFont.variable} font-sans`}>
      <Script
        id="json-ld-bpc-loas-previdenciario-arapiraca"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(legalServiceJsonLd) }}
      />
      <Script
        id="json-ld-faq-bpc-loas-previdenciario-arapiraca"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <LPTracker />
      <HighConversionTemplate content={content} whatsappNumber="+5582996390799" />
    </div>
  );
}
