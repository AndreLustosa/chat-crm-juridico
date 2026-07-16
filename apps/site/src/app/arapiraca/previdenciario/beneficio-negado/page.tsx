import { HighConversionTemplate } from "@/components/lp/templates/HighConversionTemplate";
import { LPTracker } from "@/components/lp/LPTracker";
import { LPTemplateContent } from "@/types/landing-page";
import localFont from "next/font/local";
import Script from "next/script";
import { Metadata } from "next";

const baseUrl = "https://andrelustosaadvogados.com.br";
const url = `${baseUrl}/arapiraca/previdenciario/beneficio-negado`;
const image = `${baseUrl}/landing/previdenciario-beneficio-negado-hero.png`;

const title = "INSS negou seu benefício em Arapiraca? Recurso e ação";
const description =
  "O INSS negou ou cessou seu auxílio, aposentadoria ou BPC/LOAS em Arapiraca-AL? Entenda o recurso administrativo e a ação judicial contra a negativa indevida.";

export const metadata: Metadata = {
  title,
  description,
  keywords:
    "benefício negado Arapiraca, INSS negou benefício Arapiraca, INSS Arapiraca, recurso INSS Arapiraca, ação contra o INSS Arapiraca, auxílio-doença negado Arapiraca, BPC LOAS negado Arapiraca, advogado previdenciário Arapiraca",
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
        alt: "Advogado previdenciário em Arapiraca para benefício negado pelo INSS",
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
    question: "O INSS negou meu benefício. Ainda dá para reverter?",
    answer:
      "Sim. A negativa do INSS não é definitiva. É possível apresentar recurso administrativo à Junta e ao Conselho de Recursos da Previdência Social ou, conforme o caso, ingressar com ação judicial. O primeiro passo é ler a carta de indeferimento para entender o motivo exato da recusa.",
  },
  {
    question: "Qual o prazo para recorrer da negativa do INSS?",
    answer:
      "O recurso administrativo deve ser apresentado, em regra, em até 30 dias contados da ciência da decisão. Perder esse prazo não impede necessariamente a ação judicial, mas o ideal é buscar orientação o quanto antes para não prejudicar o caso.",
  },
  {
    question: "É melhor recorrer no próprio INSS ou entrar na Justiça?",
    answer:
      "Depende do motivo da negativa. Em alguns casos o recurso administrativo resolve mais rápido; em outros, a ação na Justiça Federal ou no Juizado Especial é o caminho mais adequado. Analisamos a carta de indeferimento e o seu histórico no CNIS antes de definir a estratégia.",
  },
  {
    question: "O INSS cortou meu benefício que já estava ativo. O que fazer?",
    answer:
      "A cessação de um benefício que estava em pagamento pode ser questionada. Reunimos os laudos e o histórico do benefício para pedir o restabelecimento pela via administrativa ou judicial, especialmente quando não houve melhora do quadro que justificasse o corte.",
  },
  {
    question: "Preciso ir até o escritório em Arapiraca?",
    answer:
      "Não é obrigatório. Atendemos presencialmente na Rua Francisco Rodrigues Viana, 244, Baixa Grande, Arapiraca-AL, e também de forma 100% digital pelo WhatsApp (82) 99639-0799, com envio de documentos por foto ou PDF.",
  },
  {
    question: "Quais documentos preciso para analisar minha negativa?",
    answer:
      "A carta de indeferimento já permite uma primeira avaliação. Ajudam também o número do benefício (NB), o extrato do CNIS, laudos e exames médicos, carteira de trabalho e, no caso do BPC/LOAS, comprovantes de renda da família.",
  },
];

const content: LPTemplateContent = {
  hero: {
    title:
      "Advogado Previdenciário em Arapiraca – AL\nINSS negou seu benefício? Recurso e ação",
    subtitle:
      "Recebeu a carta de indeferimento ou teve o benefício cessado sem entender o motivo? A negativa do INSS não é a palavra final: existe recurso administrativo e ação judicial para discutir o seu direito.",
    mobileSubtitle:
      "A negativa do INSS não é a palavra final. Analisamos a sua carta de indeferimento pelo WhatsApp.",
    ctaText: "Analisar minha negativa",
    ctaLink: "https://wa.me/5582996390799",
    backgroundDesktop: "/landing/previdenciario-beneficio-negado-hero.webp",
    backgroundMobile: "/landing/previdenciario-beneficio-negado-hero-mobile.webp",
  },
  practiceAreas: [
    {
      iconName: "Stethoscope",
      title: "Auxílio-doença",
      description:
        "Afastamento por incapacidade temporária, alta indevida e restabelecimento do benefício cessado.",
      href: "/arapiraca/previdenciario/auxilio-doenca",
      bgImage: "/landing/previdenciario-auxilio-doenca-hero.webp",
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
        "Você relata a situação pelo WhatsApp e envia a carta do INSS, laudos e documentos que tiver. Com esses documentos, avaliamos o seu caso.",
    },
    {
      title: "Estratégia previdenciária",
      description:
        "Avaliamos o motivo da negativa e o seu histórico no CNIS para definir o melhor caminho: recurso administrativo no INSS ou ação na Justiça.",
    },
    {
      title: "Atuação e acompanhamento",
      description:
        "Cuidamos do recurso ou do processo, dos pedidos de perícia e mantemos você informado até a decisão final.",
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

export default function BeneficioNegadoPrevidenciarioPage() {
  const legalServiceJsonLd = {
    "@context": "https://schema.org",
    "@type": ["LegalService", "LocalBusiness"],
    name: "André Lustosa Advogados - Benefício Negado pelo INSS em Arapiraca",
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
      "Recurso contra negativa do INSS",
      "Ação judicial previdenciária",
      "Benefício negado ou cessado pelo INSS",
      "Auxílio-doença e aposentadoria por incapacidade permanente",
      "BPC/LOAS negado",
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
        id="json-ld-beneficio-negado-previdenciario-arapiraca"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(legalServiceJsonLd) }}
      />
      <Script
        id="json-ld-faq-beneficio-negado-previdenciario-arapiraca"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <LPTracker />
      <HighConversionTemplate content={content} whatsappNumber="+5582996390799" />
    </div>
  );
}
