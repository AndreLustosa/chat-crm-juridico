import { TrabalhistaTemaTemplate } from "@/components/lp/templates/TrabalhistaTemaTemplate";
import { LPTracker } from "@/components/lp/LPTracker";
import { LPSpecificThemeContent } from "@/types/landing-page-theme";
import { Metadata } from "next";
import Script from "next/script";

const baseUrl = "https://andrelustosaadvogados.com.br";
const url = `${baseUrl}/arapiraca/previdenciario/bpc-loas`;
const image = `${baseUrl}/landing/previdenciario-bpc-loas-hero.png`;

const title =
  "BPC/LOAS negado em Arapiraca? Advogado (idoso e PcD)";
const description =
  "Idoso 65+ ou pessoa com deficiência de baixa renda teve o BPC/LOAS negado ou cortado em Arapiraca-AL? Entenda o benefício assistencial de 1 salário mínimo e como recorrer.";

export const metadata: Metadata = {
  title,
  description,
  keywords:
    "BPC LOAS Arapiraca, benefício assistencial Arapiraca, BPC idoso Arapiraca, BPC deficiente Arapiraca, LOAS negado Arapiraca, INSS Arapiraca, advogado previdenciário Arapiraca, benefício de prestação continuada Arapiraca",
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
        alt: "Advogado de BPC/LOAS em Arapiraca-AL",
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

const bpcLoasContent: LPSpecificThemeContent = {
  seo: {
    title,
    description,
    keywords:
      "BPC LOAS Arapiraca, benefício assistencial Arapiraca, BPC idoso, BPC pessoa com deficiência, LOAS negado, INSS Arapiraca, advogado previdenciário Arapiraca, benefício de prestação continuada",
  },
  city: "Arapiraca",
  state: "AL",
  hero: {
    title: "BPC/LOAS negado em Arapiraca? Você pode ter direito a 1 salário mínimo",
    subtitle:
      "O Benefício de Prestação Continuada garante 1 salário mínimo por mês ao idoso com 65 anos ou mais e à pessoa com deficiência de baixa renda. Não é aposentadoria e não exige contribuição ao INSS. Se o pedido foi negado ou cortado, é possível recorrer.",
    ctaText: "Analisar meu BPC no WhatsApp",
    ctaLink: "#",
    backgroundImage: "/landing/previdenciario-bpc-loas-hero.webp",
    mobileBackgroundImage: "/landing/previdenciario-bpc-loas-hero-mobile.webp",
  },
  problem: {
    title: "O INSS negou seu BPC/LOAS mesmo com toda a necessidade?",
    description:
      "A negativa do benefício assistencial é muito comum e nem sempre significa que você não tem direito. Muitas recusas acontecem por análise de renda mal feita, cadastro desatualizado ou laudo pericial superficial. Veja se o seu caso se encaixa:",
    items: [
      "Você tem 65 anos ou mais e vive em família de baixa renda, mas teve o pedido negado",
      "É pessoa com deficiência (física, mental, intelectual ou sensorial) e o INSS não reconheceu o impedimento de longo prazo",
      "O benefício foi negado por renda familiar, mesmo com muitas despesas de saúde, remédios ou aluguel",
      "A perícia médica concluiu que não há deficiência ou que a limitação seria temporária",
      "Seu BPC ativo foi cortado, suspenso ou cessado em revisão do INSS",
      "O CadÚnico está desatualizado ou com dados divergentes que travaram a concessão",
    ],
  },
  rights: {
    title: "O que analisamos no seu direito ao BPC/LOAS",
    items: [
      {
        iconName: "Landmark",
        title: "Benefício de 1 salário mínimo",
        description:
          "O BPC/LOAS paga 1 salário mínimo mensal a quem preenche os requisitos. É benefício assistencial, não gera 13º e não depende de contribuição prévia ao INSS.",
      },
      {
        iconName: "Users",
        title: "BPC do idoso (65+)",
        description:
          "Idosos com 65 anos ou mais que não têm meios de prover o próprio sustento nem de tê-lo provido pela família podem ter direito, conforme análise da renda do grupo familiar.",
      },
      {
        iconName: "HeartPulse",
        title: "BPC da pessoa com deficiência",
        description:
          "Pessoas com impedimento de longo prazo, de natureza física, mental, intelectual ou sensorial, que dificulta a participação plena na sociedade, podem ter direito em qualquer idade.",
      },
      {
        iconName: "CircleDollarSign",
        title: "Critério de renda e miserabilidade",
        description:
          "Avaliamos a renda por pessoa do grupo familiar e a situação de miserabilidade, considerando despesas com saúde e outras vulnerabilidades reconhecidas pela Justiça.",
      },
      {
        iconName: "Stethoscope",
        title: "Perícia médica e avaliação social",
        description:
          "Orientamos sobre a avaliação médica e social do INSS e reunimos laudos e documentos que demonstram a real condição de saúde e social da pessoa.",
      },
      {
        iconName: "Scale",
        title: "Recurso e ação judicial",
        description:
          "Quando o INSS nega, cabe recurso administrativo e, se necessário, ação judicial para rever a decisão. Cada caso é analisado individualmente, sem promessa de resultado.",
      },
    ],
  },
  howHelp: {
    title: "Como o escritório atua no seu pedido de BPC/LOAS",
    description:
      "A atuação começa por entender a real situação da família e a condição de saúde da pessoa. A partir daí, verificamos os requisitos legais, organizamos a documentação e definimos o melhor caminho, administrativo ou judicial, para buscar o benefício.",
    items: [
      "Análise da idade, da deficiência e da composição e renda do grupo familiar",
      "Verificação do CadÚnico, das despesas e da situação de miserabilidade",
      "Organização de laudos, exames e documentos para a perícia e a avaliação social",
      "Definição da estratégia: novo requerimento, recurso administrativo ou ação judicial",
    ],
  },
  process: {
    title: "Como funciona o atendimento?",
    steps: [
      {
        num: "1",
        title: "RELATO DO CASO",
        description:
          "Você conta a situação: idade, condição de saúde, quem mora na casa e a renda da família.",
      },
      {
        num: "2",
        title: "ANÁLISE DOS REQUISITOS",
        description:
          "Verificamos idade ou deficiência, renda por pessoa e os documentos que comprovam a necessidade.",
      },
      {
        num: "3",
        title: "ORGANIZAÇÃO DA PROVA",
        description:
          "Reunimos laudos médicos, exames, CadÚnico e comprovantes de despesas e vulnerabilidade.",
      },
      {
        num: "4",
        title: "PLANO DE AÇÃO",
        description:
          "Definimos entre requerimento, recurso administrativo ou ação judicial e acompanhamos cada etapa.",
      },
    ],
  },
  documents: {
    title: "Documentos que ajudam no BPC/LOAS",
    description:
      "Você não precisa ter tudo em mãos agora. O importante é reunir o que demonstra a idade ou a deficiência e a situação de baixa renda da família.",
    items: [
      "Documento de identidade e CPF do requerente e dos membros da família",
      "Comprovante de inscrição e atualização no CadÚnico (Cadastro Único)",
      "Laudos médicos, exames e receitas que comprovem a deficiência ou o impedimento de longo prazo",
      "Comprovantes de renda de todos que moram na casa (ou declaração de ausência de renda)",
      "Comprovantes de despesas com saúde, remédios, aluguel e cuidados especiais",
      "Carta ou comunicado de indeferimento, corte ou cessação enviado pelo INSS",
    ],
  },
  finalCta: {
    title: "Teve o BPC/LOAS negado ou cortado em Arapiraca?",
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

export default function BpcLoasPrevidenciarioPage() {
  const legalServiceJsonLd = {
    "@context": "https://schema.org",
    "@type": ["LegalService", "LocalBusiness"],
    name: "André Lustosa Advogados - BPC/LOAS em Arapiraca",
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
      "BPC/LOAS",
      "Benefício de Prestação Continuada",
      "BPC do idoso",
      "BPC da pessoa com deficiência",
      "Benefício assistencial INSS",
      "Direito Previdenciário em Arapiraca",
    ],
  };

  return (
    <main>
      <Script
        id="json-ld-bpc-loas-arapiraca"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(legalServiceJsonLd) }}
      />
      <LPTracker />
      <TrabalhistaTemaTemplate
        content={bpcLoasContent}
        whatsappNumber="5582996390799"
        city="Arapiraca"
        state="AL"
      />
    </main>
  );
}
