import { TrabalhistaTemaTemplate } from "@/components/lp/templates/TrabalhistaTemaTemplate";
import { LPTracker } from "@/components/lp/LPTracker";
import { LPSpecificThemeContent } from "@/types/landing-page-theme";
import { Metadata } from "next";
import Script from "next/script";

const baseUrl = "https://andrelustosaadvogados.com.br";
const url = `${baseUrl}/arapiraca/previdenciario/beneficio-negado`;
const image = `${baseUrl}/landing/previdenciario-beneficio-negado-hero.png`;

const title =
  "INSS negou seu benefício em Arapiraca? Recurso e ação";
const description =
  "O INSS negou ou cessou seu auxílio, aposentadoria ou BPC/LOAS em Arapiraca-AL? Entenda o recurso administrativo e a ação judicial contra a negativa indevida.";

export const metadata: Metadata = {
  title,
  description,
  keywords:
    "benefício negado Arapiraca, INSS negou benefício Arapiraca, INSS Arapiraca, recurso INSS Arapiraca, ação contra o INSS Arapiraca, auxílio-doença negado Arapiraca, BPC LOAS negado Arapiraca, advogado previdenciário Arapiraca",
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

const beneficioNegadoContent: LPSpecificThemeContent = {
  seo: {
    title,
    description,
    keywords:
      "benefício negado Arapiraca, INSS negou benefício, INSS Arapiraca, recurso administrativo INSS, ação contra o INSS, auxílio-doença negado, aposentadoria negada, BPC LOAS negado, advogado previdenciário Arapiraca",
  },
  city: "Arapiraca",
  state: "AL",
  hero: {
    title: "INSS negou seu benefício em Arapiraca?",
    subtitle:
      "Recebeu a carta de indeferimento ou teve o benefício cessado sem entender o motivo? A negativa do INSS não é a palavra final: existe recurso administrativo e ação judicial para discutir o seu direito.",
    ctaText: "Analisar minha negativa no WhatsApp",
    ctaLink: "#",
    backgroundImage: "/landing/previdenciario-beneficio-negado-hero.webp",
    mobileBackgroundImage: "/landing/previdenciario-beneficio-negado-hero-mobile.webp",
  },
  problem: {
    title: "O INSS negou ou cortou seu benefício sem explicação clara?",
    description:
      "Muitas negativas acontecem por falha na análise, perícia apressada ou documentação mal interpretada. Cada indeferimento tem um motivo específico na carta, e é possível revisar essa decisão pela via administrativa ou judicial.",
    items: [
      "Você recebeu a carta de indeferimento e não entendeu o real motivo da negativa",
      "O benefício (auxílio, aposentadoria ou BPC) foi cessado de surpresa, mesmo sem melhora",
      "O INSS alegou que não há incapacidade, mesmo você estando doente e com laudos",
      "A perícia médica foi rápida e não considerou seus exames, receitas e atestados",
      "Negaram por suposta falta de qualidade de segurado ou de tempo de contribuição",
      "O BPC/LOAS foi negado por renda ou por não reconhecer a deficiência ou a idade",
    ],
  },
  rights: {
    title: "O que pode ser feito diante da negativa do INSS?",
    items: [
      {
        iconName: "FileText",
        title: "Leitura da carta de indeferimento",
        description:
          "Análise do motivo exato da negativa registrado pelo INSS, para definir o caminho correto e evitar repetir o mesmo erro no novo pedido.",
      },
      {
        iconName: "Scale",
        title: "Recurso administrativo no INSS",
        description:
          "Apresentação de recurso à Junta e ao Conselho de Recursos da Previdência Social, dentro do prazo, com novos argumentos e documentos.",
      },
      {
        iconName: "Landmark",
        title: "Ação judicial previdenciária",
        description:
          "Quando a negativa é indevida, é possível levar o caso à Justiça Federal ou ao Juizado Especial para buscar a concessão do benefício.",
      },
      {
        iconName: "Stethoscope",
        title: "Contestação da perícia médica",
        description:
          "Organização de laudos, exames e histórico clínico para demonstrar a incapacidade, inclusive com perícia médica judicial quando cabível.",
      },
      {
        iconName: "CircleDollarSign",
        title: "Cobrança dos valores atrasados",
        description:
          "Quando o benefício é reconhecido, é possível pleitear os valores retroativos devidos desde a data de entrada do requerimento (DER).",
      },
      {
        iconName: "HeartPulse",
        title: "Restabelecimento do benefício cessado",
        description:
          "Atuação para tentar restabelecer auxílio ou aposentadoria cortados antes da efetiva recuperação ou sem fundamento adequado.",
      },
    ],
  },
  howHelp: {
    title: "Como o escritório atua no seu caso de benefício negado?",
    description:
      "O trabalho começa pela leitura técnica da carta de indeferimento e do seu histórico no CNIS e no processo administrativo. A partir do motivo real da negativa, definimos se o melhor caminho é o recurso no próprio INSS ou a ação judicial, sempre com análise honesta das chances.",
    items: [
      "Análise da carta de indeferimento e do processo administrativo no Meu INSS",
      "Verificação da qualidade de segurado, carência e documentos médicos apresentados",
      "Definição entre recurso administrativo ou ação judicial, conforme o caso",
      "Organização das provas e acompanhamento até a decisão final",
    ],
  },
  process: {
    title: "Como funciona o atendimento?",
    steps: [
      {
        num: "1",
        title: "RELATO E DOCUMENTOS",
        description:
          "Você conta o que aconteceu e envia a carta de negativa, laudos e documentos que tiver em mãos.",
      },
      {
        num: "2",
        title: "ANÁLISE DA NEGATIVA",
        description:
          "Avaliamos o motivo do indeferimento, os prazos e se o caso é de recurso administrativo ou ação judicial.",
      },
      {
        num: "3",
        title: "RECURSO OU AÇÃO",
        description:
          "Preparamos o recurso no INSS ou a ação na Justiça, com os argumentos e provas adequados ao seu caso.",
      },
      {
        num: "4",
        title: "ACOMPANHAMENTO",
        description:
          "Acompanhamos o andamento, os pedidos de perícia e mantemos você informado até a decisão.",
      },
    ],
  },
  documents: {
    title: "Documentos que ajudam a analisar sua negativa",
    description:
      "Você não precisa ter tudo agora. Traga o que estiver disponível: a carta de indeferimento já permite uma primeira avaliação do caso.",
    items: [
      "Carta de indeferimento ou comunicado de cessação do benefício",
      "Número do benefício (NB) e acesso ao gov.br / Meu INSS para consulta",
      "Laudos médicos, exames, receitas e atestados que comprovem a doença",
      "Carteira de trabalho, carnês de contribuição e extrato do CNIS",
      "Comprovantes de renda da família, no caso de BPC/LOAS",
      "Documentos pessoais: RG, CPF e comprovante de residência em Arapiraca",
    ],
  },
  finalCta: {
    title: "Teve o benefício negado ou cortado pelo INSS? Vamos analisar.",
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
      "Auxílio-doença e aposentadoria por invalidez",
      "BPC/LOAS negado",
      "Direito Previdenciário em Arapiraca",
    ],
  };

  return (
    <main>
      <Script
        id="json-ld-beneficio-negado-previdenciario-arapiraca"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(legalServiceJsonLd) }}
      />
      <LPTracker />
      <TrabalhistaTemaTemplate
        content={beneficioNegadoContent}
        whatsappNumber="5582996390799"
        city="Arapiraca"
        state="AL"
      />
    </main>
  );
}
