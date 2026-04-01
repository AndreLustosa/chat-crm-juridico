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
    title: "Escritório de Advocacia em Arapiraca – AL\nAdvogados Especialistas para Defender Seus Direitos",
    subtitle: "Atendimento jurídico em Arapiraca e online para todo Brasil.\nAnalisamos seu caso e orientamos o melhor caminho para resolver seu problema.",
    mobileSubtitle: "Atendimento jurídico em Arapiraca e online para todo Brasil. Analisamos seu caso sem compromisso.",
    ctaText: "Falar com advogado",
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
      question: "Onde encontro um bom advogado em Arapiraca?",
      answer: "O escritório André Lustosa Advogados está localizado na Rua Francisco Rodrigues Viana, 244, bairro Baixa Grande, Arapiraca-AL. Com +10 anos de atuação, atende presencialmente em Arapiraca e digitalmente em todo o Brasil pelo WhatsApp +55 82 99639-0799.",
    },
    {
      question: "Tem advogado trabalhista em Arapiraca que atende pelo WhatsApp?",
      answer: "Sim. O André Lustosa Advogados em Arapiraca-AL tem especialistas em Direito Trabalhista e atende via WhatsApp +55 82 99639-0799. Casos de rescisão injusta, horas extras não pagas, assédio moral, FGTS e seguro-desemprego são analisados de forma gratuita no primeiro contato.",
    },
    {
      question: "Advogado previdenciário em Arapiraca — como conseguir aposentadoria ou benefício do INSS?",
      answer: "O escritório tem especialistas em Direito Previdenciário em Arapiraca-AL que atuam na obtenção de aposentadoria por tempo de contribuição, aposentadoria especial, BPC/LOAS, revisão de benefícios negados e pensão por morte. Entre em contato pelo WhatsApp +55 82 99639-0799.",
    },
    {
      question: "Quanto custa uma consulta com advogado em Arapiraca?",
      answer: "A análise inicial do caso é feita sem custo pelo WhatsApp. Após entender a situação, a equipe apresenta as opções de honorários de forma clara e transparente, adequadas a cada tipo de demanda.",
    },
    {
      question: "Advogado de família em Arapiraca — como funciona para divórcio, guarda e pensão?",
      answer: "O André Lustosa Advogados em Arapiraca-AL atua em divórcio consensual e litigioso, regulamentação de guarda, fixação e revisão de pensão alimentícia e reconhecimento de união estável. Atendimento presencial no escritório ou 100% online.",
    },
    {
      question: "Advogado do consumidor em Arapiraca — quando devo procurar?",
      answer: "Sempre que houver cobrança indevida, produto com defeito, serviço não prestado, negativação irregular ou prática abusiva por parte de empresa. O escritório em Arapiraca analisa o caso e orienta sobre a viabilidade de ação judicial ou extrajudicial.",
    },
    {
      question: "O escritório André Lustosa atende toda a região do Agreste alagoano?",
      answer: "Sim. Além de Arapiraca, atendemos presencialmente e digitalmente cidades do Agreste e Sertão de Alagoas, como Palmeira dos Índios, São Sebastião, Girau do Ponciano, Taquarana e outras. Também atuamos em todo o Brasil via atendimento digital.",
    },
    {
      question: "Como funciona a consulta jurídica online para quem mora em Arapiraca ou região?",
      answer: "Basta enviar mensagem pelo WhatsApp +55 82 99639-0799. A equipe faz a triagem do caso, solicita os documentos necessários por foto ou PDF e agenda uma videoconferência com o especialista. Todo o processo é sigiloso e sem necessidade de ir ao escritório.",
    },
    {
      question: "Advogado criminal em Arapiraca — o que fazer em caso de flagrante ou inquérito?",
      answer: "Em caso de prisão em flagrante ou abertura de inquérito, contate imediatamente o escritório pelo WhatsApp +55 82 99639-0799. Os advogados criminalistas do André Lustosa Advogados em Arapiraca-AL atuam na defesa desde o inquérito até o julgamento em todas as instâncias.",
    },
    {
      question: "É necessário agendar para ser atendido presencialmente em Arapiraca?",
      answer: "Sim. Para garantir atendimento exclusivo e sigiloso, as visitas presenciais devem ser agendadas previamente pelo WhatsApp +55 82 99639-0799. O escritório funciona de segunda a sexta, das 8h às 18h, na Rua Francisco Rodrigues Viana, 244, Baixa Grande, Arapiraca-AL.",
    },
  ],
  sectionLabels: {
    servicesTag: "ADVOGADOS EM ARAPIRACA-AL",
    servicesTitle: "Escritório de Advocacia em <span style=\"color:#A89048\">Arapiraca-AL</span>",
    servicesDescription: "Representação jurídica completa para moradores de Arapiraca e região do Agreste alagoano. Atendimento presencial no escritório ou 100% digital pelo WhatsApp.",
    bannerTitle: "Referência em advocacia <span style=\"color:#A89048\">em Arapiraca-AL</span>",
    officeTag: "ESCRITÓRIO JURÍDICO EM ARAPIRACA",
    officeTitle: "Atendimento Presencial em <span style=\"color:#A89048\">Arapiraca-AL</span> e Digital para Todo o Brasil",
    officeDescription: "<p>O <strong>André Lustosa Advogados</strong> está em Arapiraca há mais de 10 anos, consolidado como referência jurídica no Agreste alagoano. Nossa sede fica na Rua Francisco Rodrigues Viana, 244, bairro Baixa Grande, Arapiraca-AL.</p><p>Atendemos presencialmente moradores de Arapiraca, Palmeira dos Índios, São Sebastião, Girau do Ponciano, Taquarana e toda a região. Também operamos com estrutura 100% digital para clientes em qualquer estado do Brasil.</p>",
  },
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
  title: "Advogado em Arapiraca-AL | André Lustosa Advogados",
  description: "Escritório de advocacia em Arapiraca-AL com +10 anos. Especialistas em Direito Trabalhista, Previdenciário, Consumidor e Civil. Consulta online ou presencial.",
  authors: [{ name: "André Lustosa Advogados" }],
  alternates: {
    canonical: `${baseUrl}/geral/arapiraca`,
  },
  openGraph: {
    title: "Advogado em Arapiraca-AL | André Lustosa Advogados",
    description: "Escritório de advocacia em Arapiraca-AL com +10 anos. Especialistas em Direito Trabalhista, Previdenciário, Consumidor e Civil. Consulta online ou presencial.",
    url: `${baseUrl}/geral/arapiraca`,
    siteName: "André Lustosa Advogados",
    locale: "pt_BR",
    type: "website",
    images: [
      {
        url: `${baseUrl}/landing/Design sem nome (35).png`,
        width: 1200,
        height: 630,
        alt: "André Lustosa Advogados em Arapiraca-AL",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Advogado em Arapiraca-AL | André Lustosa Advogados",
    description: "Escritório de advocacia em Arapiraca-AL com +10 anos. Especialistas em Direito Trabalhista, Previdenciário, Consumidor e Civil. Consulta online ou presencial.",
    images: [`${baseUrl}/landing/Design sem nome (35).png`],
    creator: "@andrelustosaadvogados",
  },
  robots: { index: true, follow: true },
  keywords: [
    "advogado em Arapiraca",
    "advogado Arapiraca AL",
    "escritório de advocacia Arapiraca",
    "advogado trabalhista Arapiraca",
    "advogado previdenciário Arapiraca",
    "advogado do consumidor Arapiraca",
    "advogado de família Arapiraca",
    "advogado criminal Arapiraca",
    "advogado civil Arapiraca",
    "advogado imobiliário Arapiraca",
    "consulta jurídica Arapiraca",
    "advogado Arapiraca WhatsApp",
    "melhor advogado Arapiraca",
    "André Lustosa Advogados",
    "escritório advocacia Alagoas",
    "advogado Agreste alagoano",
  ],
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
    "@type": ["LegalService", "LocalBusiness"],
    "name": "André Lustosa Advogados",
    "description": "Escritório de advocacia em Arapiraca-AL com +10 anos de experiência. Especialistas em Direito Trabalhista, Previdenciário, do Consumidor, Civil, de Família, Criminal e Imobiliário. Atendimento presencial em Arapiraca e digital em todo o Brasil.",
    "image": `${baseUrl}/landing/logo_andre_lustosa_transparente.png`,
    "url": `${baseUrl}/geral/arapiraca`,
    "telephone": "+5582996390799",
    "email": "contato@andrelustosa.com.br",
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
    "hasMap": "https://maps.app.goo.gl/arapiraca-andre-lustosa",
    "openingHoursSpecification": [
      {
        "@type": "OpeningHoursSpecification",
        "dayOfWeek": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        "opens": "08:00",
        "closes": "18:00",
      },
      {
        "@type": "OpeningHoursSpecification",
        "dayOfWeek": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
        "opens": "00:00",
        "closes": "23:59",
        "description": "Atendimento digital 24h pelo WhatsApp",
      },
    ],
    "areaServed": [
      { "@type": "City", "name": "Arapiraca", "containedInPlace": { "@type": "State", "name": "Alagoas" } },
      { "@type": "City", "name": "Palmeira dos Índios", "containedInPlace": { "@type": "State", "name": "Alagoas" } },
      { "@type": "City", "name": "São Sebastião", "containedInPlace": { "@type": "State", "name": "Alagoas" } },
      { "@type": "City", "name": "Girau do Ponciano", "containedInPlace": { "@type": "State", "name": "Alagoas" } },
      { "@type": "City", "name": "Taquarana", "containedInPlace": { "@type": "State", "name": "Alagoas" } },
      { "@type": "City", "name": "Coité do Nóia", "containedInPlace": { "@type": "State", "name": "Alagoas" } },
      { "@type": "City", "name": "Batalha", "containedInPlace": { "@type": "State", "name": "Alagoas" } },
      { "@type": "State", "name": "Alagoas" },
      { "@type": "Country", "name": "Brasil" },
    ],
    "serviceType": [
      "Advogado Trabalhista em Arapiraca",
      "Advogado Previdenciário em Arapiraca",
      "Advogado do Consumidor em Arapiraca",
      "Advogado de Família em Arapiraca",
      "Advogado Criminal em Arapiraca",
      "Advogado Civil em Arapiraca",
      "Advogado Imobiliário em Arapiraca",
      "Escritório de Advocacia em Arapiraca-AL",
    ],
    "sameAs": [
      "https://www.instagram.com/andrelustosaadvogados/",
      "https://www.facebook.com/andrelustosa",
    ],
    "dateModified": "2026-04-01",
  };

  const webPageJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "name": "Advogado em Arapiraca-AL | André Lustosa Advogados",
    "description": "Escritório de advocacia em Arapiraca-AL com +10 anos. Especialistas em Direito Trabalhista, Previdenciário, Consumidor e Civil. Consulta online ou presencial.",
    "url": `${baseUrl}/geral/arapiraca`,
    "dateModified": "2026-04-01",
    "inLanguage": "pt-BR",
    "publisher": {
      "@type": "LegalService",
      "name": "André Lustosa Advogados",
      "url": baseUrl,
    },
    "author": {
      "@type": "Person",
      "name": "André Lustosa",
      "jobTitle": "Advogado",
      "description": "Advogado com mais de 10 anos de experiência em Direito Trabalhista, Previdenciário, Civil e do Consumidor em Arapiraca-AL.",
      "worksFor": {
        "@type": "LegalService",
        "name": "André Lustosa Advogados",
      },
      "address": {
        "@type": "PostalAddress",
        "addressLocality": "Arapiraca",
        "addressRegion": "AL",
        "addressCountry": "BR",
      },
    },
  };

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      {
        "@type": "Question",
        "name": "Onde encontro um bom advogado em Arapiraca?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "O escritório André Lustosa Advogados está localizado na Rua Francisco Rodrigues Viana, 244, bairro Baixa Grande, Arapiraca-AL. Com +10 anos de atuação, atende presencialmente em Arapiraca e digitalmente em todo o Brasil pelo WhatsApp +55 82 99639-0799.",
        },
      },
      {
        "@type": "Question",
        "name": "Tem advogado trabalhista em Arapiraca que atende pelo WhatsApp?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Sim. O André Lustosa Advogados em Arapiraca-AL tem especialistas em Direito Trabalhista e atende via WhatsApp +55 82 99639-0799. Casos de rescisão injusta, horas extras não pagas, assédio moral, FGTS e seguro-desemprego são analisados de forma gratuita no primeiro contato.",
        },
      },
      {
        "@type": "Question",
        "name": "Advogado previdenciário em Arapiraca — como conseguir aposentadoria ou benefício do INSS?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "O escritório tem especialistas em Direito Previdenciário em Arapiraca-AL que atuam na obtenção de aposentadoria por tempo de contribuição, aposentadoria especial, BPC/LOAS, revisão de benefícios negados e pensão por morte. Entre em contato pelo WhatsApp +55 82 99639-0799.",
        },
      },
      {
        "@type": "Question",
        "name": "Quanto custa uma consulta com advogado em Arapiraca?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "A análise inicial do caso é feita sem custo pelo WhatsApp. Após entender a situação, a equipe apresenta as opções de honorários de forma clara e transparente, adequadas a cada tipo de demanda.",
        },
      },
      {
        "@type": "Question",
        "name": "Advogado de família em Arapiraca — como funciona para divórcio, guarda e pensão?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "O André Lustosa Advogados em Arapiraca-AL atua em divórcio consensual e litigioso, regulamentação de guarda, fixação e revisão de pensão alimentícia e reconhecimento de união estável. Atendimento presencial no escritório ou 100% online.",
        },
      },
      {
        "@type": "Question",
        "name": "Advogado do consumidor em Arapiraca — quando devo procurar?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Sempre que houver cobrança indevida, produto com defeito, serviço não prestado, negativação irregular ou prática abusiva por parte de empresa. O escritório em Arapiraca analisa o caso e orienta sobre a viabilidade de ação judicial ou extrajudicial.",
        },
      },
      {
        "@type": "Question",
        "name": "O escritório André Lustosa atende toda a região do Agreste alagoano?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Sim. Além de Arapiraca, atendemos presencialmente e digitalmente cidades do Agreste e Sertão de Alagoas, como Palmeira dos Índios, São Sebastião, Girau do Ponciano, Taquarana e outras. Também atuamos em todo o Brasil via atendimento digital.",
        },
      },
      {
        "@type": "Question",
        "name": "Como funciona a consulta jurídica online para quem mora em Arapiraca ou região?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Basta enviar mensagem pelo WhatsApp +55 82 99639-0799. A equipe faz a triagem do caso, solicita os documentos necessários por foto ou PDF e agenda uma videoconferência com o especialista. Todo o processo é sigiloso e sem necessidade de ir ao escritório.",
        },
      },
      {
        "@type": "Question",
        "name": "Advogado criminal em Arapiraca — o que fazer em caso de flagrante ou inquérito?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Em caso de prisão em flagrante ou abertura de inquérito, contate imediatamente o escritório pelo WhatsApp +55 82 99639-0799. Os advogados criminalistas do André Lustosa Advogados em Arapiraca-AL atuam na defesa desde o inquérito até o julgamento em todas as instâncias.",
        },
      },
      {
        "@type": "Question",
        "name": "É necessário agendar para ser atendido presencialmente em Arapiraca?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Sim. Para garantir atendimento exclusivo e sigiloso, as visitas presenciais devem ser agendadas previamente pelo WhatsApp +55 82 99639-0799. O escritório funciona de segunda a sexta, das 8h às 18h, na Rua Francisco Rodrigues Viana, 244, Baixa Grande, Arapiraca-AL.",
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
        id="json-ld-webpage-arapiraca"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageJsonLd) }}
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
