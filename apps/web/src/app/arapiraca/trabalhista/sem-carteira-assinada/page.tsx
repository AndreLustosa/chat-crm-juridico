import { TrabalhistaTemaTemplate } from "@/components/lp/templates/TrabalhistaTemaTemplate";
import { LPTracker } from "@/components/lp/LPTracker";
import { LPSpecificThemeContent } from "@/types/landing-page-theme";
import { Metadata } from "next";
import Script from "next/script";

const baseUrl = "https://andrelustosaadvogados.com.br";
const url = `${baseUrl}/arapiraca/trabalhista/sem-carteira-assinada`;
const image = `${baseUrl}/landing/reconhecimento-vinculo-hero.png`;

const title =
  "Reconhecimento de Vínculo em Arapiraca | Trabalho sem Carteira";
const description =
  "Trabalhou sem registro, como autônomo, PJ ou informal, mas cumpria horário e recebia ordens? Entenda o reconhecimento de vínculo empregatício em Arapiraca-AL.";

export const metadata: Metadata = {
  title,
  description,
  keywords:
    "reconhecimento de vínculo Arapiraca, vínculo empregatício Arapiraca, trabalhei sem carteira assinada, trabalho sem registro direitos, falso autônomo, pejotização, advogado trabalhista Arapiraca",
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
        alt: "Reconhecimento de vínculo empregatício em Arapiraca",
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

const vinculoContent: LPSpecificThemeContent = {
  seo: {
    title,
    description,
    keywords:
      "reconhecimento de vínculo Arapiraca, vínculo empregatício, trabalho sem carteira assinada, trabalho sem registro, falso autônomo, pejotização, advogado trabalhista Arapiraca",
  },
  city: "Arapiraca",
  state: "AL",
  hero: {
    title: "Reconhecimento de vínculo trabalhista em Arapiraca",
    subtitle:
      "Se você tinha horário, recebia ordens, trabalhava com frequência e dependia daquele pagamento, pode existir vínculo de emprego mesmo sem carteira assinada.",
    ctaText: "Analisar meu vínculo no WhatsApp",
    ctaLink: "#",
    backgroundImage: "/landing/reconhecimento-vinculo-hero.png",
    mobileBackgroundImage: "/landing/sem_carteira_hero_bg.png",
  },
  problem: {
    title: "A empresa chamou de informal, mas a rotina parecia emprego?",
    description:
      "O nome dado ao contrato não decide tudo. A Justiça do Trabalho analisa como a relação acontecia na prática: subordinação, habitualidade, pessoalidade e pagamento.",
    items: [
      "Você cumpria horário, escala ou jornada definida pela empresa",
      "Recebia ordens diretas de chefe, gerente, supervisor ou dono do negócio",
      "Trabalhava de forma contínua, sem poder mandar outra pessoa no seu lugar",
      "Recebia salário, comissão, diária, PIX ou pagamento fixo com frequência",
      "Usava uniforme, crachá, sistema, ferramentas ou estrutura da empresa",
      "Era tratado como funcionário, mas sem carteira, FGTS, férias ou 13º",
    ],
  },
  rights: {
    title: "O que pode ser pedido no reconhecimento de vínculo?",
    items: [
      {
        iconName: "FileCheck",
        title: "Registro retroativo",
        description:
          "Pedido para reconhecer o período trabalhado como contrato de emprego, com anotação correspondente e reflexos legais.",
      },
      {
        iconName: "Briefcase",
        title: "Férias e 13º salário",
        description:
          "Cobrança de férias vencidas ou proporcionais, adicional de 1/3 e décimos terceiros do período reconhecido.",
      },
      {
        iconName: "CircleDollarSign",
        title: "FGTS e multa de 40%",
        description:
          "Apuração dos depósitos de FGTS que deveriam ter sido feitos e da multa rescisória quando aplicável.",
      },
      {
        iconName: "Clock",
        title: "Horas extras e adicionais",
        description:
          "Análise de jornada, intervalos, adicional noturno, domingos, feriados, insalubridade ou periculosidade quando houver prova.",
      },
      {
        iconName: "Scale",
        title: "Verbas rescisórias",
        description:
          "Avaliação de aviso prévio, saldo de salário, liberação de guias e demais direitos conforme o tipo de encerramento.",
      },
      {
        iconName: "AlertTriangle",
        title: "Falso autônomo ou PJ",
        description:
          "Estudo de casos em que a empresa usou contrato de autônomo, MEI ou PJ para esconder uma relação de emprego.",
      },
    ],
  },
  howHelp: {
    title: "Como o escritório organiza a prova do vínculo?",
    description:
      "A atuação começa pelo entendimento da rotina real de trabalho. A partir daí, organizamos documentos, conversas, pagamentos e testemunhas para avaliar a viabilidade da ação trabalhista.",
    items: [
      "Análise inicial da sua rotina, função, jornada e forma de pagamento",
      "Separação das provas que demonstram subordinação e frequência",
      "Estimativa técnica dos direitos que podem ser discutidos",
      "Estratégia para ação trabalhista sem criar duplicidade com outros pedidos",
    ],
  },
  process: {
    title: "Como funciona o atendimento?",
    steps: [
      {
        num: "1",
        title: "RELATO DO CASO",
        description:
          "Você explica como trabalhava, por quanto tempo, quem dava ordens e como recebia.",
      },
      {
        num: "2",
        title: "ANÁLISE DOS REQUISITOS",
        description:
          "Verificamos se há sinais de subordinação, habitualidade, pessoalidade e pagamento.",
      },
      {
        num: "3",
        title: "ORGANIZAÇÃO DAS PROVAS",
        description:
          "Mapeamos mensagens, recibos, PIX, escalas, fotos, crachás, uniformes e testemunhas.",
      },
      {
        num: "4",
        title: "PLANO DE AÇÃO",
        description:
          "Definimos os pedidos adequados e os próximos passos para buscar seus direitos.",
      },
    ],
  },
  documents: {
    title: "Provas que ajudam no reconhecimento do vínculo",
    description:
      "Você não precisa ter tudo. O importante é preservar o que demonstra a realidade do trabalho.",
    items: [
      "Mensagens com chefes, gerentes, clientes ou colegas",
      "Comprovantes de PIX, depósitos, recibos ou pagamentos",
      "Escalas, controles de ponto, planilhas ou prints de sistema",
      "Fotos trabalhando, uniforme, crachá, rota, ferramentas ou local",
      "Contratos de autônomo, MEI ou PJ usados pela empresa",
      "Testemunhas que conheciam sua rotina de trabalho",
    ],
  },
  finalCta: {
    title: "Trabalhou como empregado, mas ficou sem registro?",
    ctaText: "FALAR COM ADVOGADO TRABALHISTA",
    ctaLink: "#",
  },
  footer: {
    address: "Rua Francisco Rodrigues Viana, 244, Baixa Grande, Arapiraca-AL",
    phones: ["(82) 99639-0799"],
    email: "contato@andrelustosaadvogados.com.br",
  },
};

export default function SemCarteiraAssinadaPage() {
  const legalServiceJsonLd = {
    "@context": "https://schema.org",
    "@type": ["LegalService", "LocalBusiness"],
    name: "André Lustosa Advogados - Reconhecimento de Vínculo em Arapiraca",
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
      "Reconhecimento de vínculo empregatício",
      "Trabalho sem carteira assinada",
      "Falso autônomo",
      "Pejotização",
      "Direito Trabalhista em Arapiraca",
    ],
  };

  return (
    <main>
      <Script
        id="json-ld-reconhecimento-vinculo-arapiraca"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(legalServiceJsonLd) }}
      />
      <LPTracker />
      <TrabalhistaTemaTemplate
        content={vinculoContent}
        whatsappNumber="5582996390799"
        city="Arapiraca"
        state="AL"
      />
    </main>
  );
}
