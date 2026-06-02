export const baseUrl = "https://andrelustosaadvogados.com.br";
export const pagePath = "/arapiraca/trabalhista/verbas-rescisorias";
export const pageUrl = `${baseUrl}${pagePath}`;
export const heroImage = `${baseUrl}/landing/verbas-rescisorias-hero.png`;

export const pageTitle =
  "Verbas Rescisórias Trabalhistas em Arapiraca | André Lustosa Advogados";

export const pageDescription =
  "Entenda o cálculo de verbas rescisórias, FGTS, multa de 40%, aviso-prévio, férias, 13º salário e prazos após a demissão. Atendimento trabalhista em Arapiraca-AL.";

export const whatsappNumber = "5582996390799";
export const whatsappMessage =
  "Olá, vim do site de verbas rescisórias e gostaria de analisar minha demissão.";

export const navItems = [
  { href: "#calculo", label: "Calcular rescisão" },
  { href: "#tipos", label: "Tipos de demissão" },
  { href: "#direitos", label: "Direitos" },
  { href: "#documentos", label: "Documentos" },
  { href: "#faq", label: "Dúvidas" },
];

export const quickStats = [
  { value: "10 dias", label: "prazo legal para pagar a rescisão" },
  { value: "40%", label: "multa do FGTS na dispensa sem justa causa" },
  { value: "7º ao 120º dia", label: "janela comum para pedir seguro-desemprego" },
];

export const calculationItems = [
  "Saldo de salário pelos dias trabalhados no mês da demissão",
  "Aviso-prévio trabalhado, indenizado ou proporcional ao tempo de serviço",
  "13º salário proporcional e parcelas já pagas no ano",
  "Férias vencidas, férias proporcionais e adicional constitucional de 1/3",
  "Depósitos de FGTS, multa de 40% ou 20% quando aplicável",
  "Descontos legais, adiantamentos, faltas e verbas pagas por fora",
];

export const rescisionTypes = [
  {
    title: "Dispensa sem justa causa",
    href: "/arapiraca/trabalhista/verbas-rescisorias/dispensa-sem-justa-causa",
    summary:
      "É a modalidade em que normalmente entram mais parcelas: aviso-prévio, férias, 13º, FGTS, multa de 40% e possibilidade de seguro-desemprego.",
    items: [
      "saldo de salário",
      "aviso-prévio trabalhado ou indenizado",
      "13º salário proporcional",
      "férias vencidas e proporcionais + 1/3",
      "saque do FGTS e multa de 40%",
      "seguro-desemprego, se cumprir os requisitos",
    ],
  },
  {
    title: "Pedido de demissão",
    href: "/arapiraca/trabalhista/verbas-rescisorias/pedido-de-demissao",
    summary:
      "O trabalhador recebe as verbas básicas, mas geralmente perde a multa de 40%, o saque integral do FGTS e o seguro-desemprego.",
    items: [
      "saldo de salário",
      "13º proporcional",
      "férias vencidas e proporcionais + 1/3",
      "possível desconto do aviso-prévio não cumprido",
    ],
  },
  {
    title: "Justa causa",
    href: "/arapiraca/trabalhista/verbas-rescisorias/justa-causa",
    summary:
      "A penalidade é grave e reduz bastante as verbas. Quando aplicada sem prova, pode ser discutida judicialmente para tentar reversão.",
    items: [
      "saldo de salário",
      "férias vencidas + 1/3, se houver",
      "análise de provas da falta grave",
      "possível pedido de reversão da justa causa",
    ],
  },
  {
    title: "Rescisão indireta",
    href: "/arapiraca/trabalhista/verbas-rescisorias/rescisao-indireta",
    summary:
      "É a justa causa do empregador. Quando reconhecida, pode gerar verbas como na dispensa sem justa causa.",
    items: [
      "atraso reiterado de salário",
      "ausência de FGTS",
      "assédio moral",
      "falta de segurança",
      "excesso de jornada",
      "descumprimento grave do contrato",
    ],
  },
  {
    title: "Rescisão por acordo",
    href: "/arapiraca/trabalhista/verbas-rescisorias/rescisao-por-acordo",
    summary:
      "Na rescisão consensual, há regras próprias para aviso-prévio, multa do FGTS, saque do FGTS e ausência de seguro-desemprego.",
    items: [
      "metade do aviso-prévio indenizado",
      "metade da multa do FGTS",
      "saque de até 80% do FGTS",
      "sem direito ao seguro-desemprego",
    ],
  },
  {
    title: "Contrato de experiência",
    href: "/arapiraca/trabalhista/verbas-rescisorias/contrato-de-experiencia",
    summary:
      "O cálculo muda conforme o contrato terminou no prazo ou foi encerrado antes pela empresa ou pelo trabalhador.",
    items: [
      "término normal do prazo",
      "encerramento antecipado pela empresa",
      "encerramento antecipado pelo trabalhador",
      "indenização do art. 479 da CLT quando cabível",
    ],
  },
];

export const rightPages = [
  {
    title: "Saldo de salário",
    description:
      "Cálculo dos dias trabalhados no mês da demissão, conferindo faltas, adiantamentos e descontos.",
  },
  {
    title: "Aviso-prévio",
    href: "/arapiraca/trabalhista/verbas-rescisorias/aviso-previo",
    description:
      "Pode ser trabalhado, indenizado ou proporcional. A lei prevê acréscimo de 3 dias por ano de serviço, além dos 30 dias iniciais, até o limite legal.",
  },
  {
    title: "Férias",
    description:
      "Análise de férias vencidas, proporcionais, férias em dobro e adicional de 1/3.",
  },
  {
    title: "13º salário proporcional",
    description:
      "Conferência mês a mês, considerando a regra de fração igual ou superior a 15 dias.",
  },
  {
    title: "FGTS e multa",
    href: "/arapiraca/trabalhista/verbas-rescisorias/fgts-multa-40",
    description:
      "Verificação dos depósitos mensais, diferenças, saque, multa de 40% na dispensa sem justa causa e 20% no acordo.",
  },
  {
    title: "Seguro-desemprego",
    href: "/arapiraca/trabalhista/verbas-rescisorias/seguro-desemprego",
    description:
      "Avaliação de requisitos, prazo de solicitação, quantidade de parcelas e valores conforme faixas vigentes.",
  },
];

export const forgottenRights = [
  {
    title: "Multa do art. 477 da CLT",
    href: "/arapiraca/trabalhista/verbas-rescisorias/multa-art-477",
    description:
      "Pode ser discutida quando a empresa não paga a rescisão ou não entrega os documentos no prazo legal.",
  },
  {
    title: "Multa do art. 467 da CLT",
    description:
      "Verbas rescisórias incontroversas não pagas na primeira audiência podem sofrer acréscimo de 50%.",
  },
  {
    title: "Salário pago por fora",
    description:
      "Valores habituais podem refletir em FGTS, férias, 13º, aviso-prévio, horas extras e INSS.",
  },
  {
    title: "Horas extras na rescisão",
    description:
      "Horas extras habituais podem aumentar a base de cálculo das verbas rescisórias.",
  },
  {
    title: "Adicionais e comissões",
    description:
      "Adicional noturno, insalubridade, periculosidade, comissões, gorjetas e prêmios habituais podem gerar reflexos.",
  },
];

export const calculatorFields = [
  "salário bruto",
  "data de admissão",
  "data de demissão",
  "tipo de rescisão",
  "aviso-prévio",
  "férias vencidas",
  "média de horas extras",
  "média de comissões",
  "saldo de FGTS",
  "FGTS não depositado",
  "13º já recebido",
  "documentos disponíveis",
];

export const documents = [
  "CTPS física ou digital",
  "Termo de rescisão",
  "Comprovante de pagamento",
  "Extrato do FGTS",
  "Contracheques",
  "Contrato de trabalho",
  "Comprovantes de comissões",
  "Cartões de ponto",
  "Conversas de WhatsApp",
  "E-mails",
  "Advertências ou suspensões",
  "Comunicado de dispensa",
  "Guias do seguro-desemprego",
  "Comprovantes de salário",
];

export const captureTopics = [
  "Empresa não pagou minha rescisão",
  "Como saber se minha rescisão está correta?",
  "Fui demitido por justa causa: posso reverter?",
  "FGTS não depositado dá rescisão indireta?",
  "A empresa pode parcelar minha rescisão?",
  "Recebia comissão por fora: entra no cálculo?",
  "Trabalhei sem carteira: tenho direito à rescisão?",
  "Demissão de gestante ou trabalhador em estabilidade",
];

export const faqItems = [
  {
    question: "Fui demitido, quanto devo receber?",
    answer:
      "Depende do tipo de demissão, salário, tempo de contrato, férias, aviso-prévio, FGTS, comissões e descontos. A conferência correta começa pelo termo de rescisão, extrato do FGTS e contracheques.",
  },
  {
    question: "A empresa tem quantos dias para pagar minha rescisão?",
    answer:
      "A regra geral é pagamento das verbas e entrega dos documentos rescisórios em até 10 dias contados do término do contrato.",
  },
  {
    question: "A empresa não pagou minha rescisão. O que fazer?",
    answer:
      "Guarde documentos, comprovantes e mensagens. Pode haver cobrança das verbas, multa por atraso e outras diferenças, conforme o caso.",
  },
  {
    question: "Posso sacar o FGTS se pedi demissão?",
    answer:
      "No pedido de demissão, em regra, não há saque integral do FGTS nem multa de 40%. Existem exceções e situações específicas que precisam ser avaliadas.",
  },
  {
    question: "Tenho direito ao seguro-desemprego se pedi demissão?",
    answer:
      "Em regra, não. O seguro-desemprego normalmente exige dispensa sem justa causa e cumprimento dos demais requisitos legais.",
  },
  {
    question: "Fui demitido por justa causa. Tenho direito a quê?",
    answer:
      "Normalmente o pagamento é limitado a saldo de salário e férias vencidas + 1/3, se houver. Se a justa causa foi aplicada de forma indevida, pode ser analisada a reversão.",
  },
  {
    question: "Assinar o TRCT impede ação trabalhista?",
    answer:
      "Assinar o termo de rescisão não impede automaticamente a discussão judicial de diferenças, erros de cálculo ou direitos não pagos.",
  },
  {
    question: "Recebia salário por fora. Isso entra na rescisão?",
    answer:
      "Se os valores eram habituais e relacionados ao trabalho, podem ter reflexos em férias, 13º, FGTS, aviso-prévio e outras verbas.",
  },
  {
    question: "Quanto tempo tenho para entrar com ação trabalhista?",
    answer:
      "Em regra, o trabalhador tem até 2 anos após o término do contrato para ajuizar ação, podendo discutir direitos dos últimos 5 anos.",
  },
];
