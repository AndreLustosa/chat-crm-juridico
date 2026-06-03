import { LPTracker } from "@/components/lp/LPTracker";
import { InsalubridadePericulosidadeTemplate } from "@/components/lp/templates/InsalubridadePericulosidadeTemplate";
import { Metadata } from "next";
import Script from "next/script";
import {
  baseUrl,
  faqItems,
  heroImage,
  pageDescription,
  pageTitle,
  pageUrl,
  parentPath,
} from "./content";

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  keywords:
    "insalubridade Arapiraca, periculosidade Arapiraca, adicional de insalubridade, adicional de periculosidade, advogado trabalhista Arapiraca, EPI adicional trabalhista",
  alternates: {
    canonical: pageUrl,
  },
  openGraph: {
    title: pageTitle,
    description: pageDescription,
    url: pageUrl,
    siteName: "André Lustosa Advogados",
    locale: "pt_BR",
    type: "website",
    images: [
      {
        url: heroImage,
        width: 1200,
        height: 630,
        alt: "Insalubridade e periculosidade em Arapiraca",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: pageTitle,
    description: pageDescription,
    images: [heroImage],
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

export default function InsalubridadePericulosidadePage() {
  const legalServiceJsonLd = {
    "@context": "https://schema.org",
    "@type": ["LegalService", "LocalBusiness"],
    name: "André Lustosa Advogados - Insalubridade e Periculosidade em Arapiraca",
    description: pageDescription,
    image: heroImage,
    url: pageUrl,
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
      "Adicional de insalubridade",
      "Adicional de periculosidade",
      "Ambiente de trabalho perigoso",
      "Ambiente de trabalho insalubre",
      "Direito Trabalhista em Arapiraca",
    ],
    sameAs: [
      "https://www.instagram.com/andrelustosaadvogados/",
      "https://www.facebook.com/andrelustosa",
    ],
  };

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqItems.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Início",
        item: baseUrl,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Direito Trabalhista em Arapiraca",
        item: `${baseUrl}${parentPath}`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: "Insalubridade e Periculosidade",
        item: pageUrl,
      },
    ],
  };

  return (
    <>
      <Script
        id="json-ld-insalubridade-periculosidade-service"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(legalServiceJsonLd) }}
      />
      <Script
        id="json-ld-insalubridade-periculosidade-faq"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <Script
        id="json-ld-insalubridade-periculosidade-breadcrumb"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <LPTracker />
      <InsalubridadePericulosidadeTemplate />
    </>
  );
}
