import { TrabalhistaTemaTemplate } from "@/components/lp/templates/TrabalhistaTemaTemplate";
import { LPTracker } from "@/components/lp/LPTracker";
import { LPSpecificThemeContent } from "@/types/landing-page-theme";
import { Metadata } from "next";
import Script from "next/script";

const baseUrl = "https://andrelustosaadvogados.com.br";
const url = `${baseUrl}/arapiraca/previdenciario/auxilio-doenca`;
const image = `${baseUrl}/landing/previdenciario-auxilio-doenca-hero.png`;

const title =
  "Auxílio-doença negado em Arapiraca? Advogado do INSS";
const description =
  "Está doente, foi afastado e o INSS negou, cortou ou não marca a perícia? Entenda o auxílio-doença (auxílio por incapacidade temporária) em Arapiraca-AL e como buscar seu benefício.";

export const metadata: Metadata = {
  title,
  description,
  keywords:
    "auxílio-doença Arapiraca, auxílio-doença negado Arapiraca, auxílio por incapacidade temporária, INSS Arapiraca, advogado previdenciário Arapiraca, perícia médica INSS, benefício por incapacidade Arapiraca, alta indevida INSS",
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
        width: 1200,
        height: 630,
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

const auxilioDoencaContent: LPSpecificThemeContent = {
  seo: {
    title,
    description,
    keywords:
      "auxílio-doença Arapiraca, auxílio-doença negado, auxílio por incapacidade temporária, INSS Arapiraca, advogado previdenciário Arapiraca, perícia médica INSS, alta indevida, prorrogação auxílio-doença",
  },
  city: "Arapiraca",
  state: "AL",
  hero: {
    title: "Auxílio-doença negado ou cortado em Arapiraca?",
    subtitle:
      "Se você está doente, foi afastado do trabalho e o INSS negou o pedido, deu alta indevida ou não marca a perícia, é possível recorrer administrativamente ou buscar o benefício na Justiça.",
    ctaText: "Falar com advogado do INSS",
    ctaLink: "#",
    backgroundImage: "/landing/previdenciario-auxilio-doenca-hero.webp",
    mobileBackgroundImage: "/landing/previdenciario-auxilio-doenca-hero-mobile.webp",
  },
  problem: {
    title: "O INSS decidiu, mas você continua sem condições de trabalhar?",
    description:
      "O auxílio-doença (hoje chamado auxílio por incapacidade temporária) é devido a quem está temporariamente incapaz para o trabalho. Muitos pedidos são negados ou encerrados mesmo com a pessoa ainda doente.",
    items: [
      "O INSS negou o auxílio-doença dizendo que não há incapacidade, mesmo com laudos e exames",
      "Você recebeu alta da perícia (alta programada), mas ainda não tem condições de voltar ao trabalho",
      "O benefício foi cortado ou cessado de forma indevida, sem nova avaliação médica adequada",
      "A perícia médica demora para ser marcada e você está sem salário e sem benefício",
      "O pedido foi indeferido por suposta falta de carência ou por perda da qualidade de segurado",
      "Seu quadro é grave e pode ser caso de conversão em aposentadoria por incapacidade permanente",
    ],
  },
  rights: {
    title: "O que pode ser discutido no seu caso de auxílio-doença?",
    items: [
      {
        iconName: "Stethoscope",
        title: "Perícia médica revista",
        description:
          "Análise do laudo pericial do INSS e da documentação médica para questionar conclusões que não refletem sua real condição de saúde.",
      },
      {
        iconName: "HeartPulse",
        title: "Incapacidade comprovada",
        description:
          "Organização de laudos, exames e relatórios que demonstram a incapacidade temporária para o seu trabalho ou atividade habitual.",
      },
      {
        iconName: "CalendarClock",
        title: "Prorrogação e restabelecimento",
        description:
          "Pedido de prorrogação (PP) quando você ainda está incapaz e busca do restabelecimento do benefício encerrado por alta indevida.",
      },
      {
        iconName: "CircleDollarSign",
        title: "Valores atrasados",
        description:
          "Cobrança das parcelas devidas desde a data em que a incapacidade ficou demonstrada, quando reconhecido o direito ao benefício.",
      },
      {
        iconName: "Scale",
        title: "Recurso e ação judicial",
        description:
          "Recurso administrativo à Junta e ao Conselho de Recursos da Previdência Social e, se necessário, ação judicial com perícia determinada pelo juiz.",
      },
      {
        iconName: "ShieldCheck",
        title: "Conversão em aposentadoria",
        description:
          "Avaliação de casos em que a incapacidade se mostra permanente, com pedido de conversão em aposentadoria por incapacidade permanente.",
      },
    ],
  },
  howHelp: {
    title: "Como o escritório atua no seu pedido de benefício?",
    description:
      "O trabalho começa pela análise da negativa ou da alta do INSS e da sua documentação médica. A partir daí, definimos o caminho mais adequado, seja o recurso administrativo, seja a ação judicial.",
    items: [
      "Análise do indeferimento, da carta de concessão ou do motivo da cessação do benefício",
      "Organização dos laudos, exames, atestados e do histórico de tratamento médico",
      "Avaliação da carência e da qualidade de segurado na data do início da incapacidade",
      "Definição da estratégia: pedido de prorrogação, recurso administrativo ou ação judicial",
    ],
  },
  process: {
    title: "Como funciona o atendimento?",
    steps: [
      {
        num: "1",
        title: "RELATO DO CASO",
        description:
          "Você conta sua doença, o afastamento, o que o INSS decidiu e há quanto tempo está sem trabalhar.",
      },
      {
        num: "2",
        title: "ANÁLISE DOS REQUISITOS",
        description:
          "Verificamos incapacidade, carência e qualidade de segurado, além do motivo da negativa ou da alta.",
      },
      {
        num: "3",
        title: "ORGANIZAÇÃO DA PROVA MÉDICA",
        description:
          "Reunimos laudos, exames, atestados e relatórios que demonstram a incapacidade para o trabalho.",
      },
      {
        num: "4",
        title: "PLANO DE AÇÃO",
        description:
          "Definimos o caminho: prorrogação, recurso administrativo ou ação judicial com perícia.",
      },
    ],
  },
  documents: {
    title: "Documentos que ajudam no pedido de auxílio-doença",
    description:
      "Você não precisa ter tudo em mãos agora. O importante é reunir o que comprova sua doença e o vínculo com o INSS.",
    items: [
      "Documento de identidade, CPF e comprovante de residência",
      "Carta de indeferimento, comunicação de decisão ou de cessação do INSS",
      "Laudos médicos, atestados, receitas e relatórios do seu tratamento",
      "Exames de imagem, laboratoriais e resultados que confirmem o diagnóstico",
      "Carteira de trabalho, CNIS ou comprovantes de contribuição ao INSS",
      "Senha do Meu INSS, se possível, para acompanhamento do processo",
    ],
  },
  finalCta: {
    title: "Está doente e o INSS negou seu auxílio-doença?",
    ctaText: "FALAR COM ADVOGADO PREVIDENCIÁRIO",
    ctaLink: "#",
  },
  officeBlurb:
    "com atuação dedicada em Direito Previdenciário e nos benefícios do INSS",
  footer: {
    address: "Rua Francisco Rodrigues Viana, 244, Baixa Grande, Arapiraca-AL",
    phones: ["(82) 99639-0799"],
    email: "contato@andrelustosaadvogados.com.br",
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
      "Auxílio-doença",
      "Auxílio por incapacidade temporária",
      "Benefício por incapacidade negado pelo INSS",
      "Perícia médica e recurso administrativo",
      "Direito Previdenciário em Arapiraca",
    ],
  };

  return (
    <main>
      <Script
        id="json-ld-auxilio-doenca-arapiraca"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(legalServiceJsonLd) }}
      />
      <LPTracker />
      <TrabalhistaTemaTemplate
        content={auxilioDoencaContent}
        whatsappNumber="5582996390799"
        city="Arapiraca"
        state="AL"
      />
    </main>
  );
}
