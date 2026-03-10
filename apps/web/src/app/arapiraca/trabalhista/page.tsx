import { TrabalhistaTemplate } from "@/components/lp/templates/TrabalhistaTemplate";
import { LPTracker } from "@/components/lp/LPTracker";
import { LPTemplateContent } from "@/types/landing-page";
import localFont from "next/font/local";
import { Playfair_Display } from "next/font/google";
import Script from "next/script";
import { Metadata } from "next";

const baseUrl = "https://andrelustosaadvogados.com.br";

const staticContent: LPTemplateContent = {
  hero: {
    title: "Advogado\nTrabalhista em\nARAPIRACA-AL",
    secondarySubtitle:
      "Advogados em Arapiraca especialistas em reverter Justa Causa, Rescisão indireta e Verbas Rescisórias. Análise do seu caso sem compromisso.",
    ctaText: "Falar com Advogado Trabalhista",
    ctaLink: "https://wa.me/5582996390799",
    backgroundDesktop: "/landing/carteira-trabalho-hero.webp",
    backgroundMobile: "/landing/carteira-trabalho-mobile.webp",
  },
  practiceAreas: [
    {
      iconName: "FileCheck",
      title: "Reconhecimento de\nVínculo de Emprego",
      description: "Garante ao trabalhador sem registro em carteira o reconhecimento formal da relação de emprego, com todos os direitos trabalhistas.",
      colSpan2: true,
    },
    {
      iconName: "FileText",
      title: "Verbas Rescisórias",
      description: "Atuação para garantir o pagamento correto de férias, 13º, FGTS, aviso prévio e demais valores devidos na rescisão.",
    },
    {
      iconName: "FileText",
      title: "Rescisão Indireta:",
      description: "Defesa do empregado em casos de falta grave do empregador, buscando a rescisão do contrato com todos os direitos garantidos",
    },
    {
      iconName: "Clock",
      title: "Horas Extras",
      description: "Atuação para garantir o pagamento correto de férias, 13º, FGTS, aviso prévio e demais valores devidos na rescisão.",
    },
    {
      iconName: "AlertTriangle",
      title: "Adicional de\nInsalubridade\ne Periculosidade",
      description: "Ações para assegurar o pagamento do adicional devido ao trabalho em condições nocivas ou perigosas.",
    },
    {
      iconName: "Scale",
      title: "Assédio Moral\ne Sexual",
      description: "Proteção contra abusos, humilhações ou condutas inapropriadas no ambiente de trabalho, com pedido de indenização.",
    },
    {
      iconName: "HeartPulse",
      title: "Acidente de Trabalho\ne Doença Ocupacional",
      description: "Defesa de direitos em casos de afastamento, indenização, estabilidade no emprego e benefícios do INSS.",
    },
    {
      iconName: "CircleDollarSign",
      title: "Irregularidade no Depósito\ndo FGTS",
      description: "Cobrança de depósitos não realizados e liberação de valores retidos indevidamente pelo empregador.",
    },
    {
      iconName: "ShieldCheck",
      title: "Estabilidade no Emprego",
      description: "Garantia de permanência em casos de gestantes, acidentados, dirigentes sindicais ou membros da CIPA.",
    },
    {
      iconName: "HardHat",
      title: "Trabalho em\nCondições Irregulares",
      description: "Atuação em casos de jornada exaustiva, trabalho degradante ou sem registro formal.",
    },
    {
      iconName: "Users",
      title: "Direitos de Terceirizados\ne Temporários",
      description: "Defesa para assegurar igualdade de direitos e proteção legal frente à empresa contratante.",
    },
  ],
  sectionLabels: {
    servicesTag: "ÁREAS DE ATUAÇÃO TRABALHISTA",
    servicesTitle:
      'Especialistas em <span class="text-[#A89048]">Direito Trabalhista</span> <br /> em Arapiraca-AL',
    servicesDescription:
      "Nosso escritório é referência em Direito do Trabalho em Arapiraca e região. Atuamos com dedicação exclusiva na defesa dos direitos do trabalhador, garantindo que cada cliente receba a orientação e representação jurídica que merece.",
    bannerTitle:
      'Referência em <span class="text-[#A89048]">Direito Trabalhista</span> na cidade de <br class="md:block" /> Arapiraca-AL',
    officeTag: "ESTRUTURA & COMPROMISSO",
    officeTitle:
      'Defesa Trabalhista com <br class="hidden md:block" /><span class="text-[#A89048]">Excelência e Dedicação!</span>',
    officeDescription:
      '<p>O escritório <span class="text-[#FAFAFA] font-bold">André Lustosa Advogados</span> consolidou-se como referência em Direito Trabalhista em Arapiraca e região, defendendo os direitos de trabalhadores com seriedade, transparência e resultados concretos.</p><p>Contamos com uma equipe especializada e estrutura moderna para atender presencialmente e de forma 100% digital. Desde rescisões injustas até ações complexas de assédio e acidentes de trabalho, estamos preparados para lutar pelo que é seu por direito.</p>',
    excellenceTitle:
      'ADVOCACIA TRABALHISTA <br /><span class="text-[#A89048]">ANDRÉ LUSTOSA</span> <br /><span class="text-[#A89048]">ADVOGADOS!</span>',
  },
  steps: [
    {
      title: "Contato Inicial",
      description:
        "Entre em contato via WhatsApp para uma análise preliminar do seu caso trabalhista.",
    },
    {
      title: "Análise do Caso",
      description:
        "Nossos especialistas farão um estudo aprofundado dos seus direitos trabalhistas.",
    },
    {
      title: "Atuação e Resultados",
      description:
        "Atuamos com agilidade e transparência durante todo o processo trabalhista.",
    },
  ],
  faq: [
    {
      question: "Fui demitido por justa causa injustamente. Posso reverter?",
      answer:
        "Sim. Se a justa causa foi aplicada sem fundamento legal ou sem provas suficientes, é possível reverter judicialmente. O trabalhador pode receber todas as verbas rescisórias como se a demissão fosse sem justa causa, incluindo aviso prévio, multa de 40% do FGTS e seguro-desemprego.",
    },
    {
      question: "Quanto tempo tenho para entrar com ação trabalhista?",
      answer:
        "O prazo prescricional para ajuizar uma ação trabalhista é de até 2 anos após o término do contrato de trabalho. Além disso, é possível cobrar direitos referentes aos últimos 5 anos trabalhados. Por isso, é importante buscar orientação jurídica o mais rápido possível.",
    },
    {
      question: "Posso processar a empresa por horas extras não pagas?",
      answer:
        "Sim. Se você trabalhou além da jornada contratual e não recebeu o pagamento correspondente com adicional de no mínimo 50%, pode ingressar com ação trabalhista para cobrar essas horas extras, incluindo reflexos em férias, 13º salário e FGTS.",
    },
    {
      question: "O que fazer se a empresa não deposita meu FGTS?",
      answer:
        "O depósito do FGTS é obrigação do empregador. Se não está sendo depositado, você pode fazer uma denúncia ao Ministério do Trabalho e também ingressar com ação trabalhista para cobrar os valores devidos, com correção monetária e multa.",
    },
    {
      question: "Sofri assédio moral no trabalho. Quais meus direitos?",
      answer:
        "Assédio moral no trabalho é conduta ilegal que pode gerar direito a indenização por danos morais, rescisão indireta do contrato (com todas as verbas) e até responsabilização criminal do agressor. Documente as situações e procure um advogado trabalhista imediatamente.",
    },
    {
      question:
        "Tenho direito a estabilidade após acidente de trabalho?",
      answer:
        "Sim. O trabalhador que sofre acidente de trabalho e recebe auxílio-doença acidentário tem garantia de emprego por 12 meses após o retorno ao trabalho. Se for demitido neste período, pode ser reintegrado ou receber indenização correspondente.",
    },
    {
      question: "A empresa pode me demitir durante atestado médico?",
      answer:
        "Em regra, o empregador não pode demitir o trabalhador enquanto estiver afastado por doença. Se a demissão ocorrer durante o atestado, pode ser considerada nula. Em casos de doença ocupacional, o trabalhador tem direito a estabilidade provisória.",
    },
    {
      question: "Como funciona o cálculo de verbas rescisórias?",
      answer:
        "As verbas rescisórias variam conforme o tipo de demissão. Na demissão sem justa causa, o trabalhador tem direito a saldo de salário, aviso prévio, férias proporcionais + 1/3, 13º proporcional, multa de 40% do FGTS e liberação do seguro-desemprego. Nossos especialistas calculam cada centavo.",
    },
    {
      question: "Trabalho sem registro. Quais meus direitos?",
      answer:
        "O trabalhador sem registro na carteira tem os mesmos direitos de qualquer empregado formal: FGTS, férias, 13º, horas extras, aviso prévio e demais verbas. É possível ingressar com ação trabalhista para reconhecer o vínculo empregatício e cobrar todos os direitos retroativos.",
    },
    {
      question: "Quanto tempo demora um processo trabalhista?",
      answer:
        "O tempo varia conforme a complexidade do caso e a comarca. Em Arapiraca, um processo trabalhista pode levar de 6 meses a 2 anos em primeira instância. Muitos casos são resolvidos em audiência de conciliação, de forma mais rápida. Nossa equipe trabalha para acelerar ao máximo o resultado.",
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
  title:
    "Advogado Trabalhista em Arapiraca-AL | André Lustosa Advogados",
  description:
    "Advogado especializado em Direito Trabalhista em Arapiraca-AL. Rescisão injusta, horas extras, assédio moral, FGTS, acidente de trabalho e verbas rescisórias. Consulta online e presencial.",
  authors: [{ name: "André Lustosa Advogados" }],
  alternates: {
    canonical: `${baseUrl}/arapiraca/trabalhista`,
  },
  openGraph: {
    title:
      "Advogado Trabalhista em Arapiraca-AL | André Lustosa Advogados",
    description:
      "Especialistas em Direito Trabalhista em Arapiraca. Rescisão, horas extras, assédio moral, FGTS, acidentes. Análise gratuita do seu caso.",
    url: `${baseUrl}/arapiraca/trabalhista`,
    siteName: "André Lustosa Advogados",
    locale: "pt_BR",
    type: "website",
    images: [
      {
        url: "/landing/Design sem nome (35).png",
        width: 1200,
        height: 630,
        alt: "André Lustosa Advogados - Direito Trabalhista em Arapiraca-AL",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title:
      "Advogado Trabalhista em Arapiraca-AL | André Lustosa Advogados",
    description:
      "Especialistas em Direito Trabalhista em Arapiraca. Análise gratuita do seu caso.",
    images: ["/landing/Design sem nome (35).png"],
    creator: "@andrelustosa",
  },
  robots: { index: true, follow: true },
};

const neueMontreal = localFont({
  src: [
    {
      path: "../../../../public/fonts/NeueMontreal-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../../../public/fonts/NeueMontreal-Medium.woff2",
      weight: "500",
      style: "normal",
    },
  ],
  variable: "--font-neue-montreal",
  display: "swap",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  display: "swap",
});

export default function LandingPageArapiracaTrabalhista() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LegalService",
    name: "André Lustosa Advogados - Direito Trabalhista",
    image: `${baseUrl}/landing/logo_andre_lustosa_transparente.png`,
    url: `${baseUrl}/arapiraca/trabalhista`,
    telephone: "+5582996390799",
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
    priceRange: "$$$",
    openingHoursSpecification: {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
      ],
      opens: "08:00",
      closes: "18:00",
    },
    areaServed: [
      {
        "@type": "City",
        name: "Arapiraca",
        containedInPlace: {
          "@type": "State",
          name: "Alagoas",
        },
      },
      { "@type": "Country", name: "Brasil" },
    ],
    serviceType: [
      "Direito Trabalhista",
      "Rescisão Trabalhista",
      "Horas Extras",
      "Assédio Moral",
      "Acidente de Trabalho",
      "FGTS",
      "Verbas Rescisórias",
    ],
    sameAs: [
      "https://www.instagram.com/andrelustosaadvogados/",
      "https://www.facebook.com/andrelustosa",
    ],
  };

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: staticContent.faq!.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };

  return (
    <div
      className={`${neueMontreal.variable} ${playfair.variable} font-sans`}
    >
      <Script
        id="json-ld-trabalhista"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Script
        id="json-ld-faq-trabalhista"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <LPTracker />
      <TrabalhistaTemplate
        content={staticContent}
        whatsappNumber="+5582996390799"
        city="Arapiraca"
        state="AL"
      />
    </div>
  );
}
