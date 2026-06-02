import { TrabalhistaTemaTemplate } from "@/components/lp/templates/TrabalhistaTemaTemplate";
import { LPTracker } from "@/components/lp/LPTracker";
import { LPSpecificThemeContent } from "@/types/landing-page-theme";
import { Metadata } from "next";
import Script from "next/script";

const baseUrl = "https://andrelustosaadvogados.com.br";
const url = `${baseUrl}/arapiraca/trabalhista/horas-extras`;
const image = `${baseUrl}/landing/horas-extras-hero.png`;

const title = "Horas Extras em Arapiraca | Advogado Trabalhista";
const description =
  "Trabalhou além do horário, teve banco de horas irregular ou intervalo reduzido? Entenda seus direitos sobre horas extras em Arapiraca-AL.";

export const metadata: Metadata = {
  title,
  description,
  keywords:
    "horas extras Arapiraca, advogado horas extras Arapiraca, banco de horas irregular, intervalo intrajornada, jornada excessiva, hora extra não paga, advogado trabalhista Arapiraca",
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
        width: 1672,
        height: 941,
        alt: "Horas extras não pagas em Arapiraca",
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

const horasExtrasContent: LPSpecificThemeContent = {
  seo: {
    title,
    description,
    keywords:
      "horas extras Arapiraca, hora extra não paga, banco de horas irregular, intervalo de almoço reduzido, advogado trabalhista Arapiraca",
  },
  city: "Arapiraca",
  state: "AL",
  hero: {
    title: "Horas extras não pagas em Arapiraca",
    subtitle:
      "Se você trabalhava além do horário, ficava depois do expediente, perdia intervalo ou tinha banco de horas confuso, pode haver valores a conferir.",
    ctaText: "Analisar minhas horas extras",
    ctaLink: "#",
    backgroundImage: "/landing/horas-extras-hero.png",
    mobileBackgroundImage: "/landing/horas-extras-hero.png",
  },
  problem: {
    title: "A jornada real era maior do que aparecia no contracheque?",
    description:
      "A cobrança de horas extras depende da rotina, dos controles de ponto e das provas sobre entrada, saída, intervalo e trabalho fora do expediente.",
    items: [
      "Você entrava mais cedo ou saía mais tarde com frequência",
      "O cartão de ponto não registrava a jornada real",
      "Havia mensagens de trabalho antes ou depois do expediente",
      "O intervalo de almoço era reduzido, interrompido ou não existia",
      "A empresa usava banco de horas sem explicar saldo, prazo ou compensação",
      "Domingos, feriados ou folgas eram trabalhados sem pagamento correto",
    ],
  },
  rights: {
    title: "O que pode entrar no cálculo de horas extras?",
    items: [
      {
        iconName: "Clock",
        title: "Jornada acima do limite",
        description:
          "Análise de trabalho além da jornada contratual, acima de 8 horas diárias ou 44 semanais, conforme o caso concreto.",
      },
      {
        iconName: "FileText",
        title: "Banco de horas irregular",
        description:
          "Conferência de acordos, saldo, compensações, prazos e registros usados pela empresa para abater horas trabalhadas.",
      },
      {
        iconName: "AlertTriangle",
        title: "Intervalo reduzido",
        description:
          "Avaliação de intervalo intrajornada não concedido, concedido parcialmente ou interrompido por demandas da empresa.",
      },
      {
        iconName: "CircleDollarSign",
        title: "Reflexos nas verbas",
        description:
          "Horas extras habituais podem refletir em descanso semanal remunerado, férias, 13º salário, FGTS, aviso-prévio e rescisão.",
      },
      {
        iconName: "Scale",
        title: "Adicional mínimo legal",
        description:
          "A hora extra deve observar o adicional aplicável, em regra com mínimo de 50% sobre a hora normal, salvo condição mais favorável.",
      },
      {
        iconName: "Briefcase",
        title: "Trabalho fora do ponto",
        description:
          "Mensagens, sistemas, deslocamentos e tarefas depois do expediente podem ajudar a demonstrar trabalho não registrado.",
      },
    ],
  },
  howHelp: {
    title: "Como o escritório confere a jornada e o valor devido?",
    description:
      "A análise começa pela reconstrução da rotina de trabalho. Cruzamos ponto, holerites, escalas, mensagens e documentos para separar o que foi pago do que ainda pode ser discutido.",
    items: [
      "Levantamento da jornada real praticada no contrato",
      "Comparação entre cartões de ponto, contracheques e escalas",
      "Identificação de banco de horas inválido, incompleto ou não compensado",
      "Cálculo dos reflexos em férias, 13º, FGTS, aviso-prévio e rescisão",
      "Organização das provas para avaliar viabilidade de cobrança trabalhista",
    ],
  },
  process: {
    title: "Como funciona a análise de horas extras?",
    steps: [
      {
        num: "1",
        title: "ROTINA DE TRABALHO",
        description:
          "Você informa horários de entrada, saída, intervalo, folgas, domingos, feriados e como a empresa registrava o ponto.",
      },
      {
        num: "2",
        title: "CONFERÊNCIA DOS DOCUMENTOS",
        description:
          "Analisamos holerites, ponto, escalas, banco de horas, mensagens e comprovantes de trabalho fora do expediente.",
      },
      {
        num: "3",
        title: "ESTIMATIVA DOS VALORES",
        description:
          "Apuramos horas, adicional, médias e reflexos que podem afetar rescisão, FGTS, férias e 13º.",
      },
      {
        num: "4",
        title: "ESTRATÉGIA DO CASO",
        description:
          "Organizamos o melhor caminho para buscar pagamento correto ou revisar uma rescisão que não considerou a jornada real.",
      },
    ],
  },
  documents: {
    title: "Documentos e provas úteis para horas extras",
    description:
      "Você não precisa ter todos os documentos para iniciar a conversa. O importante é preservar qualquer prova da rotina de trabalho.",
    items: [
      "Cartões de ponto, espelhos de ponto ou prints de sistema",
      "Contracheques e recibos de pagamento",
      "Escalas, folgas, turnos e registros de plantão",
      "Mensagens de WhatsApp com chefes, supervisores ou clientes",
      "E-mails, chamados, logs de sistema ou comprovantes de acesso",
      "Comprovantes de deslocamento, localização ou trabalho remoto",
      "Fotos no ambiente de trabalho fora do horário",
      "Termos ou políticas de banco de horas",
      "Testemunhas que conheciam sua jornada",
    ],
  },
  finalCta: {
    title: "Trabalhou além do horário e não recebeu corretamente?",
    ctaText: "FALAR COM ADVOGADO TRABALHISTA",
    ctaLink: "#",
  },
  footer: {
    address: "Rua Francisco Rodrigues Viana, 244, Baixa Grande, Arapiraca-AL",
    phones: ["(82) 99639-0799"],
    email: "contato@andrelustosaadvogados.com.br",
  },
};

export default function HorasExtrasPage() {
  const legalServiceJsonLd = {
    "@context": "https://schema.org",
    "@type": ["LegalService", "LocalBusiness"],
    name: "André Lustosa Advogados - Horas Extras em Arapiraca",
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
      "Horas extras não pagas",
      "Banco de horas irregular",
      "Intervalo intrajornada",
      "Jornada excessiva",
      "Direito Trabalhista em Arapiraca",
    ],
    sameAs: [
      "https://www.instagram.com/andrelustosaadvogados/",
      "https://www.facebook.com/andrelustosa",
    ],
  };

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Início",
        item: baseUrl,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Direito Trabalhista em Arapiraca",
        item: `${baseUrl}/arapiraca/trabalhista`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: "Horas Extras",
        item: url,
      },
    ],
  };

  return (
    <main>
      <Script
        id="json-ld-horas-extras-arapiraca"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(legalServiceJsonLd) }}
      />
      <Script
        id="json-ld-horas-extras-breadcrumb"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <LPTracker />
      <TrabalhistaTemaTemplate
        content={horasExtrasContent}
        whatsappNumber="5582996390799"
        city="Arapiraca"
        state="AL"
      />
    </main>
  );
}
