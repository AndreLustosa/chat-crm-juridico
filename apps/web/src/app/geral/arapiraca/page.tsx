import { HighConversionTemplate } from "@/components/lp/templates/HighConversionTemplate";
import { LPTracker } from "@/components/lp/LPTracker";
import { LPTemplateContent } from "@/types/landing-page";
import localFont from "next/font/local";
import { Playfair_Display } from "next/font/google";
import Script from "next/script";
import { Metadata } from "next";

const baseUrl = "https://andrelustosaadvogados.com.br";

const staticContent: LPTemplateContent = {
  hero: {
    title: "Escritório de Advocacia\nEspecializado em\nARAPIRACA-AL",
    subtitle: "Defenda seus direitos com quem entende. Atuação ágil e focada em resultados nas áreas Trabalhista, Previdenciária, Civil e do Consumidor.",
    ctaText: "Fale com um Especialista",
    ctaLink: "https://wa.me/5582996390799",
  },
  steps: [
    {
      title: "Agendamento de Consulta",
      description: "Entre em contato via WhatsApp para uma análise preliminar e agendamento.",
    },
    {
      title: "Análise Estratégica",
      description: "Nossos especialistas farão um estudo aprofundado do seu caso.",
    },
    {
      title: "Atuação e Resultados",
      description: "Atuamos com agilidade e transparência durante todo o processo.",
    },
  ],
  faq: [
    {
      question: "Qual o horário de atendimento?",
      answer: "Temos atendimento 24 horas para urgências e em horário comercial presencialmente.",
    },
    {
      question: "Onde o escritório está localizado?",
      answer: "Estamos localizados na Rua Francisco Rodrigues Viana, 244, bairro Baixa Grande, Arapiraca - AL.",
    },
    {
      question: "Atendem online?",
      answer: "Sim, atuamos digitalmente em todo o Brasil.",
    },
  ],
  footer: {
    address: "Rua Francisco Rodrigues Viana, 244, bairro Baixa Grande",
    phones: ["82 99639-0799"],
    email: "contato@andrelustosa.com.br",
    social: {
      instagram: "https://www.instagram.com/andrelustosaadvogados/",
      facebook: "https://www.facebook.com/andrelustosa",
      linkedin: "",
    },
  },
};

export const metadata: Metadata = {
  title: "André Lustosa Advogados | Escritório Especializado em Arapiraca-AL",
  description: "Escritório de advocacia em Arapiraca-AL especializado em Direito Trabalhista, Previdenciário, Consumidor, Civil e Imobiliário. Agende sua consulta online ou presencial.",
  authors: [{ name: "André Lustosa Advogados" }],
  alternates: {
    canonical: `${baseUrl}/geral/arapiraca`,
  },
  openGraph: {
    title: "André Lustosa Advogados | Escritório Especializado em Arapiraca-AL",
    description: "Escritório de advocacia em Arapiraca-AL especializado em Direito Trabalhista, Previdenciário, Consumidor, Civil e Imobiliário. Agende sua consulta online ou presencial.",
    url: `${baseUrl}/geral/arapiraca`,
    siteName: "André Lustosa Advogados",
    locale: "pt_BR",
    type: "website",
    images: [
      {
        url: "/landing/Design sem nome (35).png",
        width: 1200,
        height: 630,
        alt: "André Lustosa Advogados em Arapiraca-AL",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "André Lustosa Advogados | Arapiraca-AL",
    description: "Escritório de advocacia em Arapiraca-AL especializado em Direito Trabalhista, Previdenciário, Consumidor e Civil. Agende sua consulta.",
    images: ["/landing/Design sem nome (35).png"],
    creator: "@andrelustosa",
  },
  robots: { index: true, follow: true },
};

const neueMontreal = localFont({
  src: [
    { path: "../../../../public/fonts/NeueMontreal-Regular.woff2", weight: "400", style: "normal" },
    { path: "../../../../public/fonts/NeueMontreal-Medium.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-neue-montreal",
  display: "swap",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  display: "swap",
});

export default function LandingPageArapiraca() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LegalService",
    "name": "André Lustosa Advogados",
    "image": `${baseUrl}/landing/logo_andre_lustosa_transparente.png`,
    "url": `${baseUrl}/geral/arapiraca`,
    "telephone": "+5582996390799",
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "Rua Francisco Rodrigues Viana, 244",
      "addressLocality": "Arapiraca",
      "addressRegion": "AL",
      "postalCode": "57300-000",
      "addressCountry": "BR",
    },
    "geo": {
      "@type": "GeoCoordinates",
      "latitude": -9.751,
      "longitude": -36.660,
    },
    "priceRange": "$$$",
    "openingHoursSpecification": {
      "@type": "OpeningHoursSpecification",
      "dayOfWeek": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      "opens": "08:00",
      "closes": "18:00",
    },
    "areaServed": [
      { "@type": "City", "name": "Arapiraca", "containedInPlace": { "@type": "State", "name": "Alagoas" } },
      { "@type": "Country", "name": "Brasil" },
    ],
    "serviceType": ["Direito Trabalhista", "Direito Previdenciário", "Direito do Consumidor", "Direito Civil", "Direito Imobiliário"],
    "sameAs": [
      "https://www.instagram.com/andrelustosaadvogados/",
      "https://www.facebook.com/andrelustosa",
    ],
  };

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      {
        "@type": "Question",
        "name": "Tem advogado em Arapiraca especializado em direito trabalhista?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Sim. O escritório André Lustosa Advogados, localizado na Rua Francisco Rodrigues Viana, 244, bairro Baixa Grande, Arapiraca/AL, é especializado em Direito Trabalhista, atendendo casos de rescisão injusta, horas extras, assédio moral, FGTS e seguro-desemprego, tanto presencialmente quanto de forma digital em todo o Brasil. Contato: +55 82 99639-0799.",
        },
      },
      {
        "@type": "Question",
        "name": "Qual o melhor escritório de advocacia em Arapiraca Alagoas?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "O André Lustosa Advogados é um escritório de advocacia em Arapiraca/AL especializado em Direito Trabalhista, Previdenciário, do Consumidor e Civil. Localizado na Rua Francisco Rodrigues Viana, 244, Baixa Grande, Arapiraca/AL, oferece atendimento presencial e digital para todo o Brasil. WhatsApp: +55 82 99639-0799.",
        },
      },
      {
        "@type": "Question",
        "name": "Como consultar um advogado em Arapiraca pelo WhatsApp?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Entre em contato com o escritório André Lustosa Advogados pelo WhatsApp +55 82 99639-0799. O atendimento inicial é feito remotamente, com análise do caso e orientação jurídica. O escritório atende presencialmente em Arapiraca/AL e digitalmente em todo o Brasil.",
        },
      },
      {
        "@type": "Question",
        "name": "Advogado previdenciário em Arapiraca — como conseguir aposentadoria?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "O André Lustosa Advogados em Arapiraca/AL tem especialistas em Direito Previdenciário que auxiliam na obtenção de aposentadoria por tempo de contribuição, aposentadoria especial, BPC/LOAS para idosos e deficientes, revisão de benefícios negados e pensão por morte. Contato: +55 82 99639-0799 (WhatsApp).",
        },
      },
      {
        "@type": "Question",
        "name": "Onde fica o escritório de advocacia André Lustosa em Arapiraca?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "O escritório André Lustosa Advogados fica na Rua Francisco Rodrigues Viana, 244, bairro Baixa Grande, Arapiraca – AL, CEP 57300-000. Atendimento presencial de segunda a sexta, das 8h às 18h. Também atende digitalmente em todo o Brasil via WhatsApp +55 82 99639-0799.",
        },
      },
    ],
  };

  return (
    <div className={`${neueMontreal.variable} ${playfair.variable} font-sans`}>
      <Script
        id="json-ld-arapiraca"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Script
        id="json-ld-faq-arapiraca"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <LPTracker />
      <HighConversionTemplate
        content={staticContent}
        whatsappNumber="+5582996390799"
      />
    </div>
  );
}
