import { Metadata } from "next";
import Script from "next/script";
import { LPTracker } from "@/components/lp/LPTracker";
import { MedidasProtetivasArapiracaTemplate } from "@/components/lp/templates/MedidasProtetivasArapiracaTemplate";

const baseUrl =
  process.env.NEXT_PUBLIC_APP_URL || "https://andrelustosaadvogados.com.br";

const title =
  "Medidas Protetivas em Arapiraca-AL | André Lustosa Advogados";
const description =
  "Orientação jurídica sigilosa em Arapiraca-AL para medidas protetivas, Lei Maria da Penha, descumprimento, audiência, acompanhamento e defesa. Fale com André Lustosa Advogados.";
const url = `${baseUrl}/arapiraca/criminal/medidas-protetivas`;
const image = `${baseUrl}/landing/medidas-protetivas-arapiraca-hero.png`;

const faq = [
  {
    question: "Medida protetiva precisa de advogado?",
    answer:
      "A vítima pode procurar a autoridade policial ou o Judiciário, mas a orientação de um advogado ajuda a organizar documentos, entender riscos, acompanhar decisões e adotar providências jurídicas adequadas.",
  },
  {
    question: "O escritório atende casos urgentes em Arapiraca?",
    answer:
      "Sim. O atendimento inicial pode ser feito pelo WhatsApp para entender a urgência e orientar os próximos passos. Em risco imediato, acione a Polícia Militar pelo 190 ou procure a Delegacia.",
  },
  {
    question: "Também atuam para quem recebeu uma medida protetiva?",
    answer:
      "Sim. O escritório analisa a decisão, intimações, provas e possibilidades jurídicas cabíveis, sempre com atuação técnica e responsável.",
  },
  {
    question: "O atendimento é sigiloso?",
    answer:
      "Sim. As informações são tratadas com reserva profissional e usadas apenas para análise e condução jurídica do caso.",
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
    "advogado medidas protetivas Arapiraca",
    "Lei Maria da Penha Arapiraca",
    "advogado Lei Maria da Penha Arapiraca",
    "violência doméstica Arapiraca",
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
      "Medidas protetivas",
      "Lei Maria da Penha",
      "Violência doméstica",
      "Descumprimento de medida protetiva",
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
      name: "Medidas protetivas em Arapiraca",
      serviceType: "Lei Maria da Penha",
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
