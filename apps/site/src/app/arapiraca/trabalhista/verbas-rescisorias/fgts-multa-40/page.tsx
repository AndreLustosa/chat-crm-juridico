import { LPTracker } from "@/components/lp/LPTracker";
import { FgtsMulta40Template } from "@/components/lp/templates/FgtsMulta40Template";
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
    "FGTS Arapiraca, multa 40 FGTS, FGTS não depositado, advogado trabalhista Arapiraca, diferença de FGTS, saque FGTS rescisão",
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
        alt: "FGTS e multa de 40% na rescisão em Arapiraca",
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

export default function FgtsMulta40Page() {
  const legalServiceJsonLd = {
    "@context": "https://schema.org",
    "@type": ["LegalService", "LocalBusiness"],
    name: "André Lustosa Advogados - FGTS e Multa de 40% em Arapiraca",
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
      "FGTS não depositado",
      "Multa de 40% do FGTS",
      "Diferenças de FGTS na rescisão",
      "Cálculo de verbas rescisórias",
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
        name: "Verbas Rescisórias Trabalhistas",
        item: `${baseUrl}${parentPath}`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: "FGTS e Multa de 40%",
        item: pageUrl,
      },
    ],
  };

  return (
    <>
      <Script
        id="json-ld-fgts-multa-40-service"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(legalServiceJsonLd) }}
      />
      <Script
        id="json-ld-fgts-multa-40-faq"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <Script
        id="json-ld-fgts-multa-40-breadcrumb"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <LPTracker />
      <FgtsMulta40Template />
    </>
  );
}
