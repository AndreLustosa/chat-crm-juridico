import { TrabalhistaTemaTemplate } from "@/components/lp/templates/TrabalhistaTemaTemplate";
import { LPSpecificThemeContent } from "@/types/landing-page-theme";
import { Metadata } from "next";

const baseUrl = "https://andrelustosaadvogados.com.br";

export const metadata: Metadata = {
  title: "Trabalhei sem carteira assinada em Arapiraca | Advogado Trabalhista",
  description:
    "Trabalhou sem carteira assinada? Descubra seus direitos como férias, 13º e FGTS. Escritório de advocacia trabalhista especialista em Arapiraca-AL. Fale conosco pelo WhatsApp.",
  keywords:
    "trabalhei sem carteira assinada, trabalho sem registro direitos, empregado sem carteira assinada, advogado trabalhista Arapiraca, direitos de quem trabalhou sem carteira, vínculo empregatício",
  alternates: {
    canonical: `${baseUrl}/arapiraca/trabalhista/sem-carteira-assinada`,
  },
  openGraph: {
    title: "Trabalhei sem carteira assinada em Arapiraca | Advogado Trabalhista",
    description:
      "Descubra se você tem dinheiro a receber. Advogados especialistas na defesa do trabalhador sem registro.",
    url: `${baseUrl}/arapiraca/trabalhista/sem-carteira-assinada`,
    siteName: "André Lustosa Advogados",
    locale: "pt_BR",
    type: "website",
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

const semCarteiraContent: LPSpecificThemeContent = {
  seo: {
    title: "Trabalhei sem carteira assinada em Arapiraca | Advogado Trabalhista",
    description:
      "Trabalhou sem carteira assinada? Descubra seus direitos como férias, 13º e FGTS. Escritório de advocacia trabalhista especialista em Arapiraca-AL.",
    keywords:
      "trabalhei sem carteira assinada, trabalho sem registro direitos, empregado sem carteira assinada, advogado trabalhista Arapiraca, direitos de quem trabalhou sem carteira",
  },
  city: "Arapiraca",
  state: "AL",
  hero: {
    title: "Trabalhou sem carteira assinada?\nVocê pode ter dinheiro\na receber.",
    subtitle:
      "Não deixe a empresa lucrar às custas do seu trabalho. A lei protege quem trabalha sem registro. Descubra seus direitos agora.",
    ctaText: "Falar com advogado no WhatsApp",
    ctaLink: "#", // will be populated by template with whatsappNumber
    backgroundImage: "/landing/sem_carteira_hero_bg.png",
  },
  problem: {
    title: "Vocé pode ter direito a indenização se:",
    description:
      "O trabalho informal é uma prática comum de empresas para sonegar direitos trabalhistas básicos. Se você vive alguma das situações abaixo, a lei está do seu lado:",
    items: [
      "Trabalha ou trabalhou cumprindo horários todos os dias sem assinatura na CTPS",
      "Recebe salário mensal, mas não tem FGTS depositado",
      "Não recebe férias remuneradas nem 13º salário",
      "Recebe ordens diretas de um chefe (subordinação) sem ter registro",
    ],
  },
  rights: {
    title: "Quais são os direitos de quem trabalha sem registro?",
    items: [
      {
        iconName: "FileCheck",
        title: "Registro Retroativo",
        description:
          "Assinatura na carteira de trabalho cobrindo todo o período trabalhado, contando para sua aposentadoria (INSS).",
      },
      {
        iconName: "Briefcase",
        title: "Férias e 13º Salário",
        description:
          "Pagamento de todas as férias (simples e em dobro) e décimos terceiros não pagos durante o contrato.",
      },
      {
        iconName: "CircleDollarSign",
        title: "FGTS + Multa de 40%",
        description:
          "Depósito de todo o FGTS que deveria ter sido recolhido mês a mês, mais a multa de 40% em caso de demissão sem justa causa.",
      },
      {
        iconName: "Clock",
        title: "Horas Extras",
        description:
          "Pagamento com acréscimo de 50% para todas as horas trabalhadas além da jornada legal (8h/dia ou 44h/semana).",
      },
      {
        iconName: "Scale",
        title: "Verbas Rescisórias",
        description:
          "Aviso prévio e todas as verbas garantidas em lei na hora da sua saída.",
      },
      {
        iconName: "AlertTriangle",
        title: "Seguro-Desemprego",
        description:
          "Possibilidade de receber as parcelas do seguro-desemprego, ou indenização substitutiva caso a empresa impeça o saque.",
      },
    ],
  },
  howHelp: {
    title: "Como o nosso escritório pode te ajudar a resgatar seus direitos?",
    description:
      "Somos especialistas em processos de Reconhecimento de Vínculo Empregatício em Arapiraca. Nosso papel é provar para a Justiça que você era um funcionário de fato e obrigar a empresa a pagar tudo o que sonegou.",
    items: [
      "Análise completa e gratuita do seu caso direto pelo WhatsApp",
      "Cálculo exato de todos os valores e direitos que a empresa te deve",
      "Ingresso rápido e seguro com a Ação Trabalhista",
      "Acompanhamento e suporte até o final do processo",
    ],
  },
  process: {
    title: "Como funciona nosso atendimento?",
    steps: [
      {
        num: "1",
        title: "CONTATO",
        description:
          "Você clica no botão do WhatsApp e fala diretamente com um advogado especialista.",
      },
      {
        num: "2",
        title: "ANÁLISE DO CASO",
        description:
          "Auvimos sua história, tiramos suas dúvidas e fazemos uma estimativa inicial dos seus direitos.",
      },
      {
        num: "3",
        title: "ENVIO DE DOCUMENTOS",
        description:
          "Você envia pelo próprio WhatsApp as provas e documentos necessários (mensagens, recibos, etc).",
      },
      {
        num: "4",
        title: "INGRESSO DA AÇÃO",
        description:
          "Nós protocolamos a ação e lutamos por cada centavo do seu dinheiro na Justiça.",
      },
    ],
  },
  documents: {
    title: "Estes documentos podem te ajudar a provar o vínculo:",
    description:
      "Para a Justiça, a verdade real importa mais do que uma carteira não assinada. Reúna tudo que comprova que você trabalhava na empresa:",
    items: [
      "Mensagens de WhatsApp com chefes e colegas",
      "Comprovantes de PIX ou depósitos da empresa na sua conta",
      "Fotos suas trabalhando no local ou de uniforme",
      "E-mails corporativos ou crachás",
      "Testemunhas (ex-colegas de trabalho ou clientes)",
    ],
  },
  finalCta: {
    title: "Não deixe a empresa ficar com o que é seu por direito.",
    ctaText: "DESCUBRA SE VOCÊ TEM DINHEIRO A RECEBER",
    ctaLink: "#",
  },
  footer: {
    address: "Escritório Master em Arapiraca-AL",
    phones: ["(82) 99639-0799"],
    email: "contato@andrelustosaadvogados.com.br",
  },
};

export default function SemCarteiraAssinadaPage() {
  return (
    <main>
      <TrabalhistaTemaTemplate
        content={semCarteiraContent}
        whatsappNumber="5582996390799"
        city="Arapiraca"
        state="AL"
      />
    </main>
  );
}
