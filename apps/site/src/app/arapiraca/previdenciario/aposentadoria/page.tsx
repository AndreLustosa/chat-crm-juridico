import { TrabalhistaTemaTemplate } from "@/components/lp/templates/TrabalhistaTemaTemplate";
import { LPTracker } from "@/components/lp/LPTracker";
import { LPSpecificThemeContent } from "@/types/landing-page-theme";
import { Metadata } from "next";
import Script from "next/script";

const baseUrl = "https://andrelustosaadvogados.com.br";
const url = `${baseUrl}/arapiraca/previdenciario/aposentadoria`;
const image = `${baseUrl}/landing/previdenciario-aposentadoria-hero.png`;

const title =
  "Aposentadoria pelo INSS em Arapiraca | Advogado Previdenciário";
const description =
  "Quer se aposentar, teve o pedido negado pelo INSS ou desconfia que o valor saiu errado? Advogado previdenciário em Arapiraca-AL orienta sobre aposentadoria por idade, tempo de contribuição, especial, rural e revisão do benefício.";

export const metadata: Metadata = {
  title,
  description,
  keywords:
    "aposentadoria Arapiraca, aposentadoria INSS Arapiraca, INSS Arapiraca, advogado previdenciário Arapiraca, aposentadoria por idade, aposentadoria por tempo de contribuição, aposentadoria especial, aposentadoria rural, revisão de aposentadoria, INSS negou aposentadoria",
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
        width: 1792,
        height: 1024,
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

const aposentadoriaContent: LPSpecificThemeContent = {
  seo: {
    title,
    description,
    keywords:
      "aposentadoria Arapiraca, aposentadoria INSS Arapiraca, INSS Arapiraca, advogado previdenciário Arapiraca, aposentadoria por idade, aposentadoria por tempo de contribuição, aposentadoria especial, aposentadoria rural, revisão de aposentadoria",
  },
  city: "Arapiraca",
  state: "AL",
  hero: {
    title: "Aposentadoria pelo INSS em Arapiraca",
    subtitle:
      "Chegou a hora de se aposentar, o INSS negou o seu pedido ou o valor veio menor do que deveria? Um advogado previdenciário analisa o seu caso e mostra o melhor caminho para o seu benefício.",
    ctaText: "Analisar minha aposentadoria",
    ctaLink: "#",
    backgroundImage: "/landing/previdenciario-aposentadoria-hero.webp",
    mobileBackgroundImage: "/landing/previdenciario-aposentadoria-hero-mobile.webp",
  },
  problem: {
    title: "Dúvidas sobre a aposentadoria que travam a sua decisão",
    description:
      "As regras mudaram muito após a Reforma da Previdência e cada caso tem detalhes que fazem diferença no valor e no tempo. Entender o cenário certo evita perder direito ou se aposentar com valor menor.",
    items: [
      "Você não sabe se já tem idade e tempo de contribuição para se aposentar",
      "Ficou perdido com as regras de transição criadas pela Reforma da Previdência",
      "Trabalhou em atividade insalubre ou perigosa e não sabe se tem direito à aposentadoria especial",
      "Trabalhou na roça, na agricultura familiar ou como segurado especial e não consegue comprovar o tempo rural",
      "O INSS negou o pedido por falta de tempo, período não reconhecido ou documentação incompleta",
      "Desconfia que o valor da sua aposentadoria saiu errado ou menor do que deveria",
    ],
  },
  rights: {
    title: "Tipos de aposentadoria e o que pode ser analisado no seu caso",
    items: [
      {
        iconName: "CalendarClock",
        title: "Aposentadoria por idade",
        description:
          "Análise do cumprimento da idade mínima e da carência exigida, conferindo todos os períodos de contribuição registrados no seu CNIS.",
      },
      {
        iconName: "Clock",
        title: "Tempo de contribuição e transição",
        description:
          "Estudo das regras de transição da Reforma da Previdência (pontos, idade progressiva, pedágio) para identificar a regra mais vantajosa para você.",
      },
      {
        iconName: "Stethoscope",
        title: "Aposentadoria especial",
        description:
          "Avaliação do tempo em atividade insalubre ou perigosa, com análise de PPP e laudos para tentar comprovar a exposição a agentes nocivos.",
      },
      {
        iconName: "Landmark",
        title: "Aposentadoria rural e híbrida",
        description:
          "Trabalho na agricultura familiar, como segurado especial ou tempo misto (rural e urbano), com organização das provas do labor no campo.",
      },
      {
        iconName: "CircleDollarSign",
        title: "Revisão do valor",
        description:
          "Verificação do cálculo do benefício, dos salários de contribuição e de períodos não computados para avaliar se cabe revisão do valor.",
      },
      {
        iconName: "Scale",
        title: "Pedido negado pelo INSS",
        description:
          "Quando o INSS nega, é possível analisar recurso administrativo e, se for o caso, ação judicial para buscar o reconhecimento do direito.",
      },
    ],
  },
  howHelp: {
    title: "Como o escritório atua na sua aposentadoria",
    description:
      "O trabalho começa pela leitura completa da sua vida contributiva. A partir do CNIS e dos documentos, avaliamos qual aposentadoria é possível, qual é mais vantajosa e o que ainda precisa ser reunido.",
    items: [
      "Leitura do CNIS e levantamento de todos os vínculos e contribuições",
      "Simulação das regras aplicáveis para comparar tempo, idade e valor do benefício",
      "Identificação de períodos que podem ser incluídos, corrigidos ou reconhecidos",
      "Orientação sobre o requerimento no INSS, recurso administrativo ou ação judicial",
    ],
  },
  process: {
    title: "Como funciona o atendimento?",
    steps: [
      {
        num: "1",
        title: "RELATO E DOCUMENTOS",
        description:
          "Você conta sua história de trabalho e reúne os documentos que já possui, como carteiras e o extrato do CNIS.",
      },
      {
        num: "2",
        title: "ANÁLISE DO DIREITO",
        description:
          "Estudamos idade, tempo de contribuição e regras de transição para identificar qual aposentadoria é possível.",
      },
      {
        num: "3",
        title: "MELHOR ESTRATÉGIA",
        description:
          "Comparamos as regras para buscar o benefício mais vantajoso e definimos se é caso administrativo ou judicial.",
      },
      {
        num: "4",
        title: "PEDIDO E ACOMPANHAMENTO",
        description:
          "Encaminhamos o requerimento ou a ação e acompanhamos cada etapa, incluindo recurso ou perícia quando necessário.",
      },
    ],
  },
  documents: {
    title: "Documentos que ajudam na análise da aposentadoria",
    description:
      "Você não precisa ter tudo em mãos. Cada documento ajuda a montar o histórico e a comprovar o seu tempo de contribuição.",
    items: [
      "Documento de identidade, CPF e comprovante de residência",
      "Carteiras de trabalho (CTPS), físicas ou digital",
      "Extrato do CNIS e carta de concessão ou de indeferimento do INSS",
      "PPP, laudos técnicos e comprovantes de atividade insalubre ou perigosa",
      "Documentos de trabalho rural, notas de produtor, sindicato ou declarações",
      "Carnês, guias de recolhimento e comprovantes de contribuição como autônomo ou MEI",
    ],
  },
  finalCta: {
    title: "Quer se aposentar com segurança ou revisar o seu benefício?",
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

export default function AposentadoriaPrevidenciarioPage() {
  const legalServiceJsonLd = {
    "@context": "https://schema.org",
    "@type": ["LegalService", "LocalBusiness"],
    name: "André Lustosa Advogados - Aposentadoria pelo INSS em Arapiraca",
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
      "Aposentadoria especial",
      "Aposentadoria rural e híbrida",
      "Revisão de aposentadoria",
      "Direito Previdenciário em Arapiraca",
    ],
  };

  return (
    <main>
      <Script
        id="json-ld-aposentadoria-previdenciario-arapiraca"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(legalServiceJsonLd) }}
      />
      <LPTracker />
      <TrabalhistaTemaTemplate
        content={aposentadoriaContent}
        whatsappNumber="5582996390799"
        city="Arapiraca"
        state="AL"
      />
    </main>
  );
}
