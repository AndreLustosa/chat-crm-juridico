import { LPTracker } from "@/components/lp/LPTracker";
import { HorasExtrasTemplate } from "@/components/lp/templates/HorasExtrasTemplate";
import { Metadata } from "next";
import Script from "next/script";
import {
  baseUrl,
  dateModified,
  faqItems,
  heroImage,
  office,
  pageDescription,
  pageTitle,
  pageUrl,
  parentPath,
} from "./content";

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  keywords:
    "horas extras Arapiraca, advogado horas extras Arapiraca, banco de horas irregular, intervalo intrajornada, jornada excessiva, hora extra não paga, advogado trabalhista Arapiraca",
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
        width: 1600,
        height: 900,
        alt: "Horas extras não pagas em Arapiraca",
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

export default function HorasExtrasPage() {
  const legalServiceJsonLd = {
    "@context": "https://schema.org",
    "@type": ["LegalService", "LocalBusiness"],
    name: "André Lustosa Advogados - Horas Extras em Arapiraca",
    description: pageDescription,
    image: heroImage,
    url: pageUrl,
    telephone: office.telephone,
    email: office.email,
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
      latitude: office.geo.latitude,
      longitude: office.geo.longitude,
    },
    openingHours: "Mo-Fr 08:00-18:00",
    priceRange: "$$",
    areaServed: [
      {
        "@type": "City",
        name: "Arapiraca",
        containedInPlace: { "@type": "State", name: "Alagoas" },
      },
      { "@type": "State", name: "Alagoas" },
    ],
    serviceType: [
      "Horas extras não pagas",
      "Banco de horas irregular",
      "Intervalo intrajornada",
      "Jornada de trabalho",
      "Direito Trabalhista em Arapiraca",
    ],
    founder: {
      "@type": "Person",
      name: "André Lustosa",
      jobTitle: "Advogado",
      identifier: "OAB/AL 14209",
    },
    sameAs: [
      "https://www.instagram.com/andrelustosaadvogados/",
      "https://www.facebook.com/andrelustosa",
    ],
  };

  const webPageJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: pageTitle,
    description: pageDescription,
    url: pageUrl,
    inLanguage: "pt-BR",
    isPartOf: {
      "@type": "WebSite",
      name: "André Lustosa Advogados",
      url: baseUrl,
    },
    author: {
      "@type": "Person",
      name: "André Lustosa",
      jobTitle: "Advogado",
      identifier: "OAB/AL 14209",
    },
    primaryImageOfPage: {
      "@type": "ImageObject",
      url: heroImage,
      width: 1600,
      height: 900,
    },
    dateModified,
    breadcrumb: {
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
          name: "Horas Extras",
          item: pageUrl,
        },
      ],
    },
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

  return (
    <>
      <Script
        id="json-ld-horas-extras-service"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(legalServiceJsonLd) }}
      />
      <Script
        id="json-ld-horas-extras-webpage"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageJsonLd) }}
      />
      <Script
        id="json-ld-horas-extras-faq"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <LPTracker />
      <HorasExtrasTemplate />
    </>
  );
}
