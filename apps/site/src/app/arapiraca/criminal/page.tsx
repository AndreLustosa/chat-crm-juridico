import { Metadata } from "next";
import Script from "next/script";
import { LPTracker } from "@/components/lp/LPTracker";
import { CriminalArapiracaTemplate } from "@/components/lp/templates/CriminalArapiracaTemplate";

const baseUrl =
  process.env.NEXT_PUBLIC_APP_URL || "https://andrelustosaadvogados.com.br";

const title =
  "Advocacia Criminal em Arapiraca-AL | André Lustosa Advogados";
const description =
  "Atendimento jurídico criminal em Arapiraca-AL para flagrantes, inquéritos, audiências de custódia e processos criminais. Fale com André Lustosa Advogados.";
const url = `${baseUrl}/arapiraca/criminal`;
const image = `${baseUrl}/landing/criminal-hero-andre-lustosa.png`;

const faq = [
  {
    question: "Fui intimado para depor. Preciso ir com advogado?",
    answer:
      "É recomendável buscar orientação antes do depoimento. O advogado pode avaliar o conteúdo da intimação, explicar seus direitos e acompanhar o ato quando cabível.",
  },
  {
    question: "O que fazer em caso de prisão em flagrante em Arapiraca?",
    answer:
      "Entre em contato imediatamente com um advogado criminalista. As primeiras horas são importantes para analisar a legalidade da prisão, comunicar familiares e preparar a atuação na audiência de custódia.",
  },
  {
    question: "O atendimento é sigiloso?",
    answer:
      "Sim. As informações compartilhadas são tratadas com reserva profissional e usadas apenas para a análise jurídica do caso.",
  },
  {
    question: "O escritório atende apenas em Arapiraca?",
    answer:
      "A sede fica em Arapiraca-AL, com atendimento presencial mediante agendamento e atendimento digital para clientes de outras cidades de Alagoas e do Brasil.",
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
        alt: "Advocacia Criminal em Arapiraca - André Lustosa Advogados",
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
    "advogado criminal Arapiraca",
    "advogado criminalista Arapiraca",
    "advocacia criminal Arapiraca",
    "prisão em flagrante Arapiraca",
    "audiência de custódia Arapiraca",
    "inquérito policial Arapiraca",
    "direito criminal Alagoas",
    "André Lustosa Advogados",
  ],
};

export default function CriminalArapiracaPage() {
  const legalServiceJsonLd = {
    "@context": "https://schema.org",
    "@type": ["LegalService", "LocalBusiness"],
    name: "André Lustosa Advogados - Direito Criminal",
    description,
    image,
    url,
    telephone: "+5582996390799",
    email: "contato@andrelustosa.com.br",
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
      "Direito Criminal",
      "Advocacia Criminal em Arapiraca",
      "Prisão em flagrante",
      "Audiência de custódia",
      "Inquérito policial",
      "Processo criminal",
      "Lei de Drogas",
      "Crimes contra o patrimônio",
    ],
    sameAs: [
      "https://www.instagram.com/andrelustosaadvogados/",
      "https://www.facebook.com/andrelustosa",
    ],
  };

  const webPageJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: title,
    description,
    url,
    inLanguage: "pt-BR",
    primaryImageOfPage: image,
    publisher: {
      "@type": "LegalService",
      name: "André Lustosa Advogados",
      url: baseUrl,
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
        id="json-ld-criminal-arapiraca"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(legalServiceJsonLd) }}
      />
      <Script
        id="json-ld-criminal-arapiraca-webpage"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageJsonLd) }}
      />
      <Script
        id="json-ld-criminal-arapiraca-faq"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <LPTracker />
      <CriminalArapiracaTemplate />
    </>
  );
}
