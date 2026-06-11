import { Metadata } from "next";
import Script from "next/script";
import { LPTracker } from "@/components/lp/LPTracker";
import { DefesaHomemMariaDaPenhaArapiracaTemplate } from "@/components/lp/templates/DefesaHomemMariaDaPenhaArapiracaTemplate";

const baseUrl =
  process.env.NEXT_PUBLIC_APP_URL || "https://andrelustosaadvogados.com.br";

const title =
  "Defesa do Homem na Lei Maria da Penha em Arapiraca | André Lustosa";
const description =
  "Atendimento jurídico reservado em Arapiraca para homens acusados na Lei Maria da Penha, medidas protetivas, intimações e defesa criminal.";
const url = `${baseUrl}/arapiraca/criminal/defesa-homem-lei-maria-da-penha`;
const image = `${baseUrl}/landing/defesa-homem-maria-da-penha-hero.png`;

const faq = [
  {
    question: "Fui acusado injustamente. O que devo fazer primeiro?",
    answer:
      "Evite contato com a outra parte, preserve provas e busque orientação antes de depor ou responder mensagens. A defesa deve ser construída com documentos, contexto e estratégia, não com exposição pública.",
  },
  {
    question: "Posso falar com a mulher para resolver a situação?",
    answer:
      "Se existir medida protetiva com proibição de contato ou aproximação, não. Descumprir a ordem pode gerar consequências graves. O caminho seguro é tratar qualquer providência por meio jurídico.",
  },
  {
    question: "Medida protetiva significa condenação criminal?",
    answer:
      "Não necessariamente. A medida protetiva é uma decisão de proteção e pode existir antes de uma condenação. Ainda assim, precisa ser levada a sério e cumprida enquanto estiver vigente.",
  },
  {
    question: "O escritório atende casos urgentes em Arapiraca?",
    answer:
      "Sim. O atendimento inicial pode ser feito pelo WhatsApp para entender a urgência, analisar documentos e orientar os próximos passos possíveis.",
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
        alt: "Defesa do homem na Lei Maria da Penha em Arapiraca - André Lustosa Advogados",
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
    "defesa homem Lei Maria da Penha Arapiraca",
    "advogado defesa Lei Maria da Penha Arapiraca",
    "homem acusado Lei Maria da Penha Arapiraca",
    "medida protetiva defesa homem",
    "acusação injusta Lei Maria da Penha",
    "advogado criminal Lei Maria da Penha",
    "advogado criminal Arapiraca",
    "defesa em medida protetiva Arapiraca",
    "André Lustosa Advogados",
  ],
};

export default function DefesaHomemMariaDaPenhaArapiracaPage() {
  const legalServiceJsonLd = {
    "@context": "https://schema.org",
    "@type": ["LegalService", "LocalBusiness"],
    name: "André Lustosa Advogados - Defesa do Homem na Lei Maria da Penha em Arapiraca",
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
      "Defesa na Lei Maria da Penha",
      "Defesa de homens acusados",
      "Defesa em medida protetiva",
      "Violência doméstica",
      "Inquérito policial",
      "Advocacia criminal em Arapiraca",
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
    isPartOf: {
      "@type": "WebSite",
      name: "André Lustosa Advogados",
      url: baseUrl,
    },
    about: {
      "@type": "LegalService",
      name: "Defesa do homem na Lei Maria da Penha em Arapiraca",
      serviceType: "Defesa criminal",
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
        id="json-ld-defesa-homem-maria-da-penha-arapiraca"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(legalServiceJsonLd) }}
      />
      <Script
        id="json-ld-defesa-homem-maria-da-penha-arapiraca-webpage"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageJsonLd) }}
      />
      <Script
        id="json-ld-defesa-homem-maria-da-penha-arapiraca-faq"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <LPTracker />
      <DefesaHomemMariaDaPenhaArapiracaTemplate />
    </>
  );
}
