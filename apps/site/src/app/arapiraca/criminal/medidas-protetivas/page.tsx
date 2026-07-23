import { Metadata } from "next";
import Script from "next/script";
import { LPTracker } from "@/components/lp/LPTracker";
import { MedidasProtetivasArapiracaTemplate } from "@/components/lp/templates/MedidasProtetivasArapiracaTemplate";

const baseUrl =
  process.env.NEXT_PUBLIC_APP_URL || "https://andrelustosaadvogados.com.br";

const title =
  "Advogado para Medidas Protetivas em Arapiraca-AL | Lei Maria da Penha";
const description =
  "Advogado para medidas protetivas em Arapiraca-AL na Lei Maria da Penha: orientação para quem precisa requerer proteção e defesa técnica para quem foi alvo de uma medida protetiva. Atendimento sigiloso pelo WhatsApp.";
const url = `${baseUrl}/arapiraca/criminal/medidas-protetivas`;
const image = `${baseUrl}/landing/medidas-protetivas-arapiraca-hero.png`;

const faq = [
  {
    question: "Preciso de advogado para pedir uma medida protetiva?",
    answer:
      "A mulher pode procurar diretamente a autoridade policial, o Judiciário, a Defensoria ou o Ministério Público. A orientação de um advogado ajuda a organizar documentos, entender riscos, acompanhar decisões e adotar as providências jurídicas adequadas ao caso.",
  },
  {
    question: "Que tipos de violência podem justificar proteção?",
    answer:
      "Além da agressão física, a Lei Maria da Penha abrange violência psicológica, moral, sexual e patrimonial. A análise jurídica identifica quais fatos são relevantes para o pedido ou para o acompanhamento da medida protetiva.",
  },
  {
    question: "Fui alvo de uma medida protetiva. Como funciona a defesa?",
    answer:
      "Se você recebeu intimação ou foi atingido por uma medida protetiva, cumpra integralmente a decisão enquanto a defesa avalia o caso. A atuação técnica analisa provas, contexto e fundamentos e organiza os próximos passos, sem prometer resultado.",
  },
  {
    question: "O que fazer se a medida protetiva for descumprida?",
    answer:
      "Preserve mensagens, áudios, registros e dados de testemunhas e comunique a autoridade competente. O descumprimento pode gerar consequências ao agressor. A orientação jurídica ajuda a documentar os fatos e a adotar as providências legais cabíveis.",
  },
  {
    question: "O escritório atende casos urgentes em Arapiraca?",
    answer:
      "Sim. O atendimento inicial pode ser feito pelo WhatsApp para entender a urgência e orientar os próximos passos. Em perigo imediato, acione a Polícia Militar pelo 190. Para orientação e denúncias, também existe o Ligue 180.",
  },
  {
    question: "O atendimento é sigiloso?",
    answer:
      "Sim. As informações compartilhadas são tratadas com reserva profissional e usadas apenas para a análise e a condução jurídica do caso. O sigilo é um dever da advocacia e vale para o atendimento presencial e pelo WhatsApp.",
  },
];

export const metadata: Metadata = {
  title,
  description,
  authors: [{ name: "André Lustosa Advogados" }],
  alternates: {
    canonical: url,
  },
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
        width: 1792,
        height: 1024,
        alt: "Medidas protetivas em Arapiraca - André Lustosa Advogados",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [image],
    creator: "@andrelustosaadvogados",
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
  keywords: [
    "medidas protetivas Arapiraca",
    "medida protetiva Arapiraca",
    "advogado medidas protetivas Arapiraca",
    "Lei Maria da Penha Arapiraca",
    "advogado Lei Maria da Penha Arapiraca",
    "violência doméstica Arapiraca",
    "violência doméstica contra mulher Arapiraca",
    "advogado violência doméstica Arapiraca",
    "descumprimento de medida protetiva",
    "advogado criminal Arapiraca",
    "André Lustosa Advogados",
  ],
};

export default function MedidasProtetivasArapiracaPage() {
  const legalServiceJsonLd = {
    "@context": "https://schema.org",
    "@type": ["LegalService", "LocalBusiness"],
    name: "André Lustosa Advogados - Medidas Protetivas em Arapiraca",
    description,
    image,
    url,
    telephone: "+5582996390799",
    email: "contato@andrelustosa.com.br",
    founder: {
      "@type": "Person",
      name: "André Lustosa",
      jobTitle: "Advogado",
      identifier: "OAB/AL 14209",
    },
    address: {
      "@type": "PostalAddress",
      streetAddress: "Rua Francisco Rodrigues Viana, 244",
      addressLocality: "Arapiraca",
      addressRegion: "AL",
      postalCode: "57300-000",
      addressCountry: "BR",
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: -9.751,
      longitude: -36.66,
    },
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        opens: "08:00",
        closes: "18:00",
      },
    ],
    areaServed: [
      {
        "@type": "City",
        name: "Arapiraca",
        containedInPlace: { "@type": "State", name: "Alagoas" },
      },
      { "@type": "State", name: "Alagoas" },
      { "@type": "Country", name: "Brasil" },
    ],
    serviceType: [
      "Medidas protetivas",
      "Medida protetiva para mulheres",
      "Lei Maria da Penha",
      "Violência doméstica",
      "Violência doméstica contra mulher",
      "Descumprimento de medida protetiva",
      "Advocacia criminal em Arapiraca",
    ],
    sameAs: [
      "https://www.instagram.com/andrelustosaadvogados/",
      "https://www.facebook.com/andrelustosa",
    ],
    dateModified: "2026-07-23",
  };

  const webPageJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: title,
    description,
    url,
    inLanguage: "pt-BR",
    primaryImageOfPage: image,
    dateModified: "2026-07-23",
    isPartOf: {
      "@type": "WebSite",
      name: "André Lustosa Advogados",
      url: baseUrl,
    },
    about: {
      "@type": "LegalService",
      name: "Medidas protetivas em Arapiraca",
      serviceType: "Lei Maria da Penha",
    },
    author: {
      "@type": "Person",
      name: "André Lustosa",
      jobTitle: "Advogado",
      identifier: "OAB/AL 14209",
      description:
        "André Lustosa (OAB/AL 14209), advogado com atuação em Direito Criminal e na Lei Maria da Penha em Arapiraca-AL.",
      worksFor: {
        "@type": "LegalService",
        name: "André Lustosa Advogados",
      },
      address: {
        "@type": "PostalAddress",
        addressLocality: "Arapiraca",
        addressRegion: "AL",
        addressCountry: "BR",
      },
    },
  };

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };

  return (
    <>
      <Script
        id="json-ld-medidas-protetivas-arapiraca"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(legalServiceJsonLd) }}
      />
      <Script
        id="json-ld-medidas-protetivas-arapiraca-webpage"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageJsonLd) }}
      />
      <Script
        id="json-ld-medidas-protetivas-arapiraca-faq"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <LPTracker />
      <MedidasProtetivasArapiracaTemplate />
    </>
  );
}
