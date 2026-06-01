export const baseUrl = "https://andrelustosaadvogados.com.br";
export const pagePath =
  "/arapiraca/trabalhista/verbas-rescisorias/aviso-previo";
export const pageUrl = `${baseUrl}${pagePath}`;
export const parentPath = "/arapiraca/trabalhista/verbas-rescisorias";
export const heroImage = `${baseUrl}/landing/aviso-previo-hero.png`;

export const pageTitle =
  "Aviso-Prévio em Arapiraca | Cálculo, Desconto e Direitos";

export const pageDescription =
  "Está em aviso-prévio ou recebeu desconto na rescisão? Entenda aviso trabalhado, indenizado, proporcional, redução de jornada e erros no cálculo.";

export const whatsappNumber = "5582996390799";
export const whatsappMessage =
  "Olá, quero conferir se meu aviso-prévio foi calculado corretamente na rescisão.";

export const heroStats = [
  { value: "30 dias", label: "base comum do aviso-prévio" },
  { value: "+3 dias", label: "por ano completo, quando aplicável" },
  { value: "90 dias", label: "limite do aviso proporcional" },
];

export const conceptCards = [
  {
    title: "Comunicação da saída",
    description:
      "O aviso-prévio informa que o contrato vai acabar e organiza o período até o desligamento efetivo.",
  },
  {
    title: "Pode ser trabalhado ou indenizado",
    description:
      "Na prática, a empresa pode exigir trabalho no período ou indenizar o aviso na rescisão, conforme a modalidade.",
  },
  {
    title: "Pode gerar desconto",
    description:
      "No pedido de demissão, se o trabalhador não cumpre o aviso e a empresa não dispensa, pode haver desconto.",
  },
];

export const noticeTypes = [
  {
    title: "Aviso-prévio trabalhado",
    description:
      "O trabalhador continua prestando serviço durante o período do aviso. Na dispensa sem justa causa, deve ser conferida a redução legal da jornada.",
  },
  {
    title: "Aviso-prévio indenizado",
    description:
      "A empresa dispensa o trabalho no período e paga o valor correspondente na rescisão, com reflexos quando cabíveis.",
  },
  {
    title: "Aviso-prévio proporcional",
    description:
      "Além dos 30 dias, pode haver acréscimo de 3 dias por ano completo de serviço na mesma empresa, até o limite legal.",
  },
  {
    title: "Desconto no pedido de demissão",
    description:
      "Quando o trabalhador pede demissão e não cumpre o aviso, a empresa pode descontar o período, salvo dispensa ou situação específica.",
  },
  {
    title: "Redução de 2 horas ou 7 dias",
    description:
      "No aviso trabalhado dado pela empresa, a jornada pode ser reduzida em 2 horas diárias ou o trabalhador pode faltar 7 dias corridos.",
  },
  {
    title: "Acordo e outras modalidades",
    description:
      "Na rescisão por acordo, pedido de demissão, experiência e rescisão indireta, a regra do aviso precisa ser ajustada à modalidade correta.",
  },
];

export const calculationItems = [
  "salário-base usado no cálculo",
  "tempo completo de serviço na empresa",
  "data de início e fim do aviso",
  "modalidade da rescisão",
  "projeção do aviso no tempo de serviço",
  "reflexos em férias, 13º e FGTS",
  "descontos lançados no TRCT",
  "dispensa ou exigência de cumprimento do aviso",
];

export const warningItems = [
  "empresa descontou aviso mesmo tendo dispensado o cumprimento",
  "aviso proporcional não foi considerado",
  "período do aviso não projetou na rescisão",
  "não houve redução de jornada no aviso trabalhado",
  "empresa confundiu pedido de demissão com acordo",
  "desconto maior que o período devido",
  "base salarial usada no cálculo está errada",
  "férias, 13º ou FGTS não refletiram o aviso",
];

export const analysisSteps = [
  {
    title: "Confirmar a modalidade",
    description:
      "Identificamos se foi dispensa sem justa causa, pedido de demissão, acordo, experiência ou rescisão indireta.",
  },
  {
    title: "Conferir o prazo",
    description:
      "Verificamos se o aviso era de 30 dias, proporcional, trabalhado, indenizado ou sujeito a desconto.",
  },
  {
    title: "Recalcular reflexos",
    description:
      "Analisamos projeção do aviso, férias, 13º, FGTS, multa e descontos lançados no termo de rescisão.",
  },
  {
    title: "Apontar diferenças",
    description:
      "Se houver erro, explicamos quais valores podem ser cobrados e quais documentos sustentam a revisão.",
  },
];

export const documents = [
  "Comunicado de aviso-prévio",
  "Termo de rescisão do contrato de trabalho",
  "Comprovante de pagamento da rescisão",
  "CTPS física ou digital",
  "Contracheques",
  "Extrato completo do FGTS",
  "Cartões de ponto do período do aviso",
  "Mensagens de WhatsApp sobre dispensa ou cumprimento",
  "E-mails ou comunicados do RH",
  "Carta de pedido de demissão, se houver",
  "Acordo de rescisão, se houver",
  "Comprovantes de horas extras ou comissões",
];

export const faqItems = [
  {
    question: "O que é aviso-prévio?",
    answer:
      "É a comunicação antecipada de que o contrato de trabalho será encerrado. Ele pode ser trabalhado, indenizado ou, em algumas situações, gerar desconto na rescisão.",
  },
  {
    question: "Qual é o prazo do aviso-prévio?",
    answer:
      "A base comum é de 30 dias. Em algumas situações, pode haver aviso proporcional, com acréscimo de 3 dias por ano completo de serviço na mesma empresa, até o limite legal.",
  },
  {
    question: "A empresa pode descontar aviso-prévio?",
    answer:
      "No pedido de demissão, se o trabalhador não cumprir o aviso e a empresa não dispensar o cumprimento, pode haver desconto. É preciso conferir o que foi comunicado e lançado no TRCT.",
  },
  {
    question: "Tenho direito a sair 2 horas mais cedo?",
    answer:
      "Na dispensa sem justa causa com aviso trabalhado, a jornada pode ser reduzida em 2 horas diárias ou substituída por 7 dias corridos, conforme a regra legal.",
  },
  {
    question: "Aviso-prévio indenizado conta para férias e 13º?",
    answer:
      "O aviso pode projetar o fim do contrato e gerar reflexos em parcelas como férias, 13º e FGTS, conforme a modalidade e o cálculo aplicado.",
  },
  {
    question: "No acordo trabalhista, como fica o aviso?",
    answer:
      "Na rescisão por acordo, se o aviso for indenizado, a regra prevê pagamento pela metade. O restante do cálculo precisa ser conferido no TRCT.",
  },
  {
    question: "Assinei a rescisão. Posso cobrar aviso calculado errado?",
    answer:
      "Assinar o TRCT não impede automaticamente a análise de diferenças. Se houve desconto indevido ou falta de reflexos, o caso pode ser revisado.",
  },
  {
    question: "Quais documentos preciso para conferir o aviso?",
    answer:
      "Comunicado de aviso, TRCT, comprovante de pagamento, CTPS, contracheques, cartões de ponto e mensagens sobre cumprimento ou dispensa ajudam na análise.",
  },
];
