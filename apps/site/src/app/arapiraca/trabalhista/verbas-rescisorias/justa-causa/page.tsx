import { LPTracker } from "@/components/lp/LPTracker";
import { JustaCausaTemplate } from "@/components/lp/templates/JustaCausaTemplate";
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
    "reversão de justa causa Arapiraca, demissão por justa causa, justa causa indevida, advogado trabalhista justa causa, verbas rescisórias justa causa",
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
        alt: "Reversão de demissão por justa causa em Arapiraca",
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

export default function JustaCausaPage() {
  const legalServiceJsonLd = {
    "@context": "https://schema.org",
    "@type": ["LegalService", "LocalBusiness"],
    name: "André Lustosa Advogados - Reversão de Justa Causa em Arapiraca",
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
      "Reversão de justa causa",
      "Demissão por justa causa",
      "Verbas rescisórias",
      "FGTS e seguro-desemprego",
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
        name: "Reversão de Justa Causa",
        item: pageUrl,
      },
    ],
  };

  return (
    <>
      <Script
        id="json-ld-justa-causa-service"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(legalServiceJsonLd) }}
      />
      <Script
        id="json-ld-justa-causa-faq"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <Script
        id="json-ld-justa-causa-breadcrumb"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <LPTracker />
      <JustaCausaTemplate />
    </>
  );
}
