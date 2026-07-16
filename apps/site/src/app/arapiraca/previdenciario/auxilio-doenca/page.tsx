import { HighConversionTemplate } from "@/components/lp/templates/HighConversionTemplate";
import { LPTracker } from "@/components/lp/LPTracker";
import { LPTemplateContent } from "@/types/landing-page";
import localFont from "next/font/local";
import Script from "next/script";
import { Metadata } from "next";

const baseUrl = "https://andrelustosaadvogados.com.br";
const url = `${baseUrl}/arapiraca/previdenciario/auxilio-doenca`;
const image = `${baseUrl}/landing/previdenciario-auxilio-doenca-hero.png`;

const title = "Auxílio-doença negado em Arapiraca? Advogado do INSS";
const description =
  "INSS negou, cortou ou não marca a perícia do seu auxílio-doença em Arapiraca-AL? Advogado previdenciário analisa o seu caso e busca o benefício.";

export const metadata: Metadata = {
  title,
  description,
  keywords:
    "auxílio-doença Arapiraca, auxílio-doença negado Arapiraca, auxílio por incapacidade temporária, INSS Arapiraca, advogado previdenciário Arapiraca, perícia médica INSS, benefício por incapacidade Arapiraca, alta indevida INSS",
  alternates: { canonical: url },
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
        width: 1672,
        height: 941,
        alt: "Advogado de auxílio-doença e INSS em Arapiraca-AL",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [image],
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

const neueMontreal = localFont({
  src: [
    { path: "../../../../../public/fonts/NeueMontreal-Regular.woff2", weight: "400", style: "normal" },
    { path: "../../../../../public/fonts/NeueMontreal-Medium.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-neue-montreal",
  display: "swap",
});

const displayFont = localFont({
  src: [{ path: "../../../../../public/fonts/NeueMontreal-Medium.woff2", weight: "500", style: "normal" }],
  variable: "--font-playfair",
  display: "swap",
});

const faqItems = [
  {
    question: "O INSS negou meu auxílio-doença mesmo eu estando doente. É comum?",
    answer:
      "Sim, é comum a perícia concluir que não há incapacidade mesmo diante de laudos e exames. Quando isso acontece, é possível recorrer administrativamente ou buscar o benefício na Justiça, com perícia médica judicial, reunindo bem a documentação médica que comprova a limitação para o trabalho.",
  },
  {
    question: "Recebi alta da perícia, mas ainda não tenho condições de trabalhar. O que fazer?",
    answer:
      "Você pode pedir a prorrogação do benefício dentro do prazo (Pedido de Prorrogação) e, se ainda assim houver alta indevida, questionar a decisão. Reunimos laudos e exames atualizados para demonstrar que a incapacidade persiste.",
  },
  {
    question: "Qual a diferença entre auxílio-doença e aposentadoria por invalidez?",
    answer:
      "O auxílio-doença (auxílio por incapacidade temporária) é para quem está temporariamente incapaz e pode se recuperar. Quando a incapacidade é permanente e não há como voltar ao trabalho, o caso pode ser de aposentadoria por incapacidade permanente (antiga aposentadoria por invalidez).",
  },
  {
    question: "Preciso ter contribuído por quanto tempo para ter direito?",
    answer:
      "Em regra, é exigida uma carência de 12 contribuições mensais, mas há situações (como acidentes e algumas doenças graves) em que a carência é dispensada. Avaliamos o seu CNIS para confirmar a qualidade de segurado e a carência no seu caso.",
  },
  {
    question: "A perícia do INSS demora e estou sem salário e sem benefício. Dá para agilizar?",
    answer:
      "A demora na marcação da perícia é um problema frequente. Dependendo do tempo de espera, é possível pleitear judicialmente a análise do pedido ou a concessão do benefício. Analisamos o seu caso pelo WhatsApp para indicar o caminho.",
  },
  {
    question: "Atende quem mora em Arapiraca e região?",
    answer:
      "Sim. Atendemos presencialmente na Rua Francisco Rodrigues Viana, 244, Baixa Grande, Arapiraca-AL, e de forma 100% digital pelo WhatsApp (82) 99639-0799 para toda a região do Agreste e demais estados.",
  },
];

const content: LPTemplateContent = {
  hero: {
    title:
      "Advogado Previdenciário em Arapiraca – AL\nAuxílio-doença negado ou cortado? Vamos analisar",
    subtitle:
      "Se você está doente, foi afastado do trabalho e o INSS negou o pedido, deu alta indevida ou não marca a perícia, é possível recorrer administrativamente ou buscar o benefício na Justiça.",
    mobileSubtitle:
      "INSS negou, cortou ou não marca a perícia do seu auxílio-doença? Analisamos o seu caso pelo WhatsApp.",
    ctaText: "Falar com advogado do INSS",
    ctaLink: "https://wa.me/5582996390799",
    backgroundDesktop: "/landing/previdenciario-auxilio-doenca-hero.webp",
    backgroundMobile: "/landing/previdenciario-auxilio-doenca-hero-mobile.webp",
    badgesPosition: "low",
  },
  practiceAreas: [
    {
      iconName: "FileWarning",
      title: "INSS negou seu benefício",
      description:
        "Recurso administrativo e ação judicial contra a negativa ou o corte indevido do INSS.",
      href: "/arapiraca/previdenciario/beneficio-negado",
      bgImage: "/landing/previdenciario-beneficio-negado-hero.webp",
      tag: "PREVIDENCIÁRIO",
    },
    {
      iconName: "ShieldCheck",
      title: "Aposentadoria",
      description:
        "Análise do tempo de contribuição e concessão da aposentadoria pelo INSS no momento certo.",
      href: "/arapiraca/previdenciario/aposentadoria",
      bgImage: "/landing/previdenciario-aposentadoria-hero.webp",
      tag: "PREVIDENCIÁRIO",
    },
    {
      iconName: "HeartHandshake",
      title: "BPC / LOAS",
      description:
        "Benefício assistencial de um salário mínimo para idosos 65+ e pessoas com deficiência de baixa renda.",
      href: "/arapiraca/previdenciario/bpc-loas",
      bgImage: "/landing/previdenciario-bpc-loas-hero.webp",
      tag: "PREVIDENCIÁRIO",
    },
  ],
  sectionLabels: {
    servicesTag: "OUTRAS ÁREAS DO PREVIDENCIÁRIO",
    servicesTitle:
      "Veja também em <span style=\"color:#A89048\">Previdenciário / INSS</span>",
    servicesDescription:
      "Além deste tema, o escritório atua em outras demandas de benefícios do INSS em Arapiraca e região do Agreste. Conheça e fale com um advogado pelo WhatsApp.",
    bannerTitle:
      "Advocacia Previdenciária <span style=\"color:#A89048\">em Arapiraca-AL</span>",
    officeTag: "ESCRITÓRIO JURÍDICO EM ARAPIRACA",
    officeTitle:
      "Atendimento Presencial em <span style=\"color:#A89048\">Arapiraca-AL</span> e Digital para Todo o Brasil",
    officeDescription:
      "<p>O <strong>André Lustosa Advogados</strong> atende em Arapiraca-AL há mais de 10 anos, com atuação dedicada em Direito Previdenciário e nos benefícios do INSS. Nossa sede fica na Rua Francisco Rodrigues Viana, 244, bairro Baixa Grande, Arapiraca-AL.</p><p>Atendemos presencialmente moradores de Arapiraca, Palmeira dos Índios, São Sebastião, Girau do Ponciano, Taquarana e toda a região do Agreste. Também operamos com estrutura 100% digital para clientes em qualquer estado do Brasil.</p>",
    excellenceTitle: "Atendimento humano, técnico e transparente",
  },
  steps: [
    {
      title: "Análise do seu caso",
      description:
        "Você relata a situação pelo WhatsApp e envia laudos, exames e a decisão do INSS que tiver. Com esses documentos, avaliamos o seu caso.",
    },
    {
      title: "Estratégia previdenciária",
      description:
        "Avaliamos a incapacidade, a carência e a qualidade de segurado para definir entre o pedido de prorrogação, o recurso no INSS ou a ação judicial.",
    },
    {
      title: "Atuação e acompanhamento",
      description:
        "Cuidamos do recurso ou do processo, dos pedidos de perícia médica judicial e mantemos você informado até a decisão final.",
    },
  ],
  faq: faqItems,
  footer: {
    address: "Rua Francisco Rodrigues Viana, 244, Baixa Grande, Arapiraca-AL",
    phones: ["82 99639-0799"],
    email: "contato@andrelustosaadvogados.com.br",
    social: {
      instagram: "https://www.instagram.com/andrelustosaadvogados/",
      facebook: "https://www.facebook.com/andrelustosa",
      linkedin: "",
    },
  },
};

export default function AuxilioDoencaPrevidenciarioPage() {
  const legalServiceJsonLd = {
    "@context": "https://schema.org",
    "@type": ["LegalService", "LocalBusiness"],
    name: "André Lustosa Advogados - Auxílio-doença e INSS em Arapiraca",
    description,
    image,
    url,
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
      "Auxílio-doença (auxílio por incapacidade temporária)",
      "Contestação de alta indevida do INSS",
      "Prorrogação e restabelecimento de benefício por incapacidade",
      "Aposentadoria por incapacidade permanente",
      "Ação judicial previdenciária",
      "Direito Previdenciário em Arapiraca",
    ],
  };

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqItems.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };

  return (
    <div className={`${neueMontreal.variable} ${displayFont.variable} font-sans`}>
      <Script
        id="json-ld-auxilio-doenca-previdenciario-arapiraca"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(legalServiceJsonLd) }}
      />
      <Script
        id="json-ld-faq-auxilio-doenca-previdenciario-arapiraca"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <LPTracker />
      <HighConversionTemplate content={content} whatsappNumber="+5582996390799" />
    </div>
  );
}
