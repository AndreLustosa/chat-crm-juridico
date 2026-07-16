import { HighConversionTemplate } from "@/components/lp/templates/HighConversionTemplate";
import { LPTracker } from "@/components/lp/LPTracker";
import { LPTemplateContent } from "@/types/landing-page";
import localFont from "next/font/local";
import Script from "next/script";
import { Metadata } from "next";

const baseUrl = "https://andrelustosaadvogados.com.br";
const url = `${baseUrl}/arapiraca/previdenciario/aposentadoria`;
const image = `${baseUrl}/landing/previdenciario-aposentadoria-hero.png`;

const title = "Advogado de Aposentadoria pelo INSS em Arapiraca-AL";
const description =
  "Advogado previdenciário em Arapiraca-AL: aposentadoria por idade, tempo de contribuição, especial e rural, revisão e INSS que negou o pedido.";

export const metadata: Metadata = {
  title,
  description,
  keywords:
    "aposentadoria Arapiraca, aposentadoria INSS Arapiraca, INSS Arapiraca, advogado previdenciário Arapiraca, aposentadoria por idade, aposentadoria por tempo de contribuição, aposentadoria especial, aposentadoria rural, revisão de aposentadoria, INSS negou aposentadoria",
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
        alt: "Advogado previdenciário em Arapiraca com atuação em aposentadoria pelo INSS",
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
    question: "Como saber se já posso me aposentar?",
    answer:
      "Depende da idade, do tempo de contribuição e da regra de transição que se aplica ao seu caso após a Reforma da Previdência. Analisamos o seu extrato do CNIS para identificar em qual regra você se encaixa e qual o momento mais vantajoso para dar entrada.",
  },
  {
    question: "Trabalhei em atividade insalubre ou perigosa. Tenho direito à aposentadoria especial?",
    answer:
      "É possível, desde que comprovada a exposição a agentes nocivos (ruído, calor, químicos, biológicos, etc.) por meio de documentos como PPP e LTCAT. Verificamos os seus vínculos para saber se há tempo especial a ser reconhecido e convertido.",
  },
  {
    question: "Trabalhei na roça. Como comprovar o tempo rural?",
    answer:
      "O tempo de trabalho rural, inclusive como segurado especial ou na agricultura familiar, pode ser comprovado com início de prova material (documentos) complementado por testemunhas. Reunimos essa documentação para requerer o reconhecimento do período.",
  },
  {
    question: "O INSS negou minha aposentadoria. É possível reverter?",
    answer:
      "Sim. Muitas negativas ocorrem por período não reconhecido ou documentação incompleta. Analisamos o motivo do indeferimento e avaliamos o recurso administrativo ou a ação judicial para buscar o reconhecimento do tempo e a concessão do benefício.",
  },
  {
    question: "Desconfio que o valor da minha aposentadoria saiu menor do que deveria. Dá para revisar?",
    answer:
      "Em alguns casos cabe revisão do benefício, quando há erro no cálculo, períodos não considerados ou salários de contribuição incorretos. Fazemos a análise do seu histórico para verificar se há fundamento para pedir a revisão.",
  },
  {
    question: "Preciso comparecer ao escritório em Arapiraca?",
    answer:
      "Não é obrigatório. Você pode enviar o extrato do CNIS e os documentos pelo WhatsApp (82) 99639-0799 e ser atendido de forma 100% digital. Quem preferir o atendimento presencial é recebido na Rua Francisco Rodrigues Viana, 244, Baixa Grande, Arapiraca-AL.",
  },
];

const content: LPTemplateContent = {
  hero: {
    title:
      "Advogado Previdenciário em Arapiraca – AL\nAposentadoria pelo INSS no tempo certo",
    subtitle:
      "Chegou a hora de se aposentar, o INSS negou o seu pedido ou o valor veio menor do que deveria? Um advogado previdenciário analisa o seu caso e mostra o melhor caminho para o seu benefício.",
    mobileSubtitle:
      "Aposentadoria por idade, tempo de contribuição, especial ou rural — analisamos o seu caso pelo WhatsApp.",
    ctaText: "Analisar minha aposentadoria",
    ctaLink: "https://wa.me/5582996390799",
    backgroundDesktop: "/landing/previdenciario-aposentadoria-hero.webp",
    backgroundMobile: "/landing/previdenciario-aposentadoria-hero-mobile.webp",
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
      iconName: "Stethoscope",
      title: "Auxílio-doença",
      description:
        "Afastamento por incapacidade temporária, alta indevida e restabelecimento do benefício cessado.",
      href: "/arapiraca/previdenciario/auxilio-doenca",
      bgImage: "/landing/previdenciario-auxilio-doenca-hero.webp",
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
        "Você relata a sua história pelo WhatsApp e envia o extrato do CNIS e os documentos de trabalho que tiver. Com esses documentos, avaliamos o seu caso.",
    },
    {
      title: "Estratégia previdenciária",
      description:
        "Avaliamos idade, tempo de contribuição, tempo especial e rural para identificar a melhor regra e o momento mais vantajoso de aposentar.",
    },
    {
      title: "Atuação e acompanhamento",
      description:
        "Cuidamos do requerimento, do recurso ou da ação judicial e mantemos você informado até a concessão ou a revisão do benefício.",
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

export default function AposentadoriaPrevidenciarioPage() {
  const legalServiceJsonLd = {
    "@context": "https://schema.org",
    "@type": ["LegalService", "LocalBusiness"],
    name: "André Lustosa Advogados - Aposentadoria e INSS em Arapiraca",
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
      "Aposentadoria por idade",
      "Aposentadoria por tempo de contribuição",
      "Aposentadoria especial (insalubridade e periculosidade)",
      "Aposentadoria rural e segurado especial",
      "Revisão de aposentadoria",
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
        id="json-ld-aposentadoria-previdenciario-arapiraca"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(legalServiceJsonLd) }}
      />
      <Script
        id="json-ld-faq-aposentadoria-previdenciario-arapiraca"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <LPTracker />
      <HighConversionTemplate content={content} whatsappNumber="+5582996390799" />
    </div>
  );
}
