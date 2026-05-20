/**
 * data.js — FONTE ÚNICA DE VERDADE DO ROTEIRO
 *
 * Edite SOMENTE este arquivo para mudar qualquer dado da página.
 * Não precisa tocar no HTML/CSS/script.js para alterar conteúdo.
 *
 * Última atualização: 2026-05-19 (André)
 *
 * ============ COMO USAR ============
 *
 * 1. POPULAR UM NOVO DIA:
 *    - Localize o objeto do dia no array `dias` abaixo
 *    - Troque `placeholder: true` por todos os campos do dia
 *    - Veja o Dia 1 como modelo
 *
 * 2. MARCAR ITEM "A CONFIRMAR":
 *    - Adicione `confirmar: true` no objeto da atividade ou hospedagem
 *    - A página mostra um badge amarelo automaticamente
 *
 * 3. ADICIONAR/REMOVER ATIVIDADE:
 *    - É só editar o array `atividades` dentro do dia
 *
 * 4. MUDAR COR DO DIA:
 *    - Edite `corAcento` (hex) — usada no card e no pin do mapa
 *
 * ===================================
 */
window.VIAGEM = {

  // -------- METADADOS GERAIS --------
  meta: {
    titulo: "Aventura da Família Lustosa em Santa Catarina",
    subtitulo: "6 dias entre Florianópolis, Balneário Camboriú e Beto Carrero",
    chegadaISO: "2026-08-16T10:35:00-03:00", // alvo do contador regressivo
    retornoISO: "2026-08-21T19:35:00-03:00",
    adultos: 10,
    criancas: 4,
    idadesCriancas: [5, 6, 10, 11],
    cidades: ["Florianópolis", "Balneário Camboriú", "Penha"],
    noites: 5,
    atualizadoEm: "2026-05-19",
    organizador: { nome: "André Lustosa", whatsapp: null },
  },

  // -------- VOOS --------
  voos: [
    {
      trecho: "Ida",
      origem: { sigla: "MCZ", cidade: "Maceió" },
      destino: { sigla: "FLN", cidade: "Florianópolis" },
      partidaISO: "2026-08-16T02:40:00-03:00",
      chegadaISO: "2026-08-16T10:35:00-03:00",
      obs: "Saída de Arapiraca em 15/08 ~22h",
    },
    {
      trecho: "Volta",
      origem: { sigla: "NVT", cidade: "Navegantes" },
      destino: { sigla: "MCZ", cidade: "Maceió" },
      partidaISO: "2026-08-21T19:35:00-03:00",
      chegadaISO: "2026-08-22T02:00:00-03:00",
      obs: null,
    },
  ],

  // -------- HOSPEDAGENS --------
  hospedagens: [
    {
      id: "floripa-lagoa",
      cidade: "Florianópolis",
      bairro: "Lagoa da Conceição",
      nome: "A definir",
      noites: 1,
      checkIn: "2026-08-16",
      checkOut: "2026-08-17",
      coords: { lat: -27.6021, lng: -48.4683 },
      confirmar: true,
    },
    {
      id: "bc-centro",
      cidade: "Balneário Camboriú",
      bairro: "Centro / 3ª Avenida",
      nome: "A definir",
      noites: 3,
      checkIn: "2026-08-17",
      checkOut: "2026-08-20",
      coords: { lat: -26.9906, lng: -48.6347 },
      confirmar: true,
    },
    {
      id: "penha-armacao",
      cidade: "Penha",
      bairro: "Armação",
      nome: "A definir",
      noites: 1,
      checkIn: "2026-08-20",
      checkOut: "2026-08-21",
      coords: { lat: -26.7931, lng: -48.6133 },
      confirmar: true,
    },
  ],

  // -------- ROTEIRO DIA A DIA --------
  // Por ora, apenas o Dia 1 está populado. Os outros vão sendo preenchidos.
  dias: [

    // ============== DIA 1 ==============
    {
      numero: 1,
      dataISO: "2026-08-16",
      diaSemana: "Domingo",
      cidade: "Florianópolis",
      regiao: "Norte da Ilha",
      titulo: "Chegada + Norte da Ilha",
      resumo: "Pouso em FLN, primeiro contato com o mar do sul, Forte histórico em Jurerê e jantar tranquilo na Lagoa.",
      hospedagemId: "floripa-lagoa",
      icone: "🛬",
      corAcento: "#FFD700", // amarelo dourado
      atividades: [
        {
          hora: "10:35",
          titulo: "Pouso em Florianópolis",
          local: "Aeroporto Hercílio Luz (FLN)",
          coords: { lat: -27.6705, lng: -48.5477 },
          dica: "Retirada de 2 SUVs 7 lugares na locadora. Confirmar reserva 24h antes.",
          tags: ["transporte"],
          icone: "✈️",
        },
        {
          hora: "12:30",
          titulo: "Almoço de ostras frescas",
          local: "Santo Antônio de Lisboa",
          coords: { lat: -27.5080, lng: -48.5194 },
          dica: "Vilarejo açoriano com ostras direto do cultivo. Reservar para 14 pessoas com antecedência.",
          tags: ["restaurante", "almoço"],
          icone: "🦪",
          confirmar: true,
        },
        {
          hora: "15:00",
          titulo: "Forte São José da Ponta Grossa",
          local: "Praia do Forte, Jurerê",
          coords: { lat: -27.4317, lng: -48.5178 },
          dica: "Entrada gratuita. Canhões históricos e vista da praia. Ótimo para as crianças correrem.",
          tags: ["passeio", "cultura"],
          icone: "🏰",
        },
        {
          hora: "17:00",
          titulo: "Pôr do sol em Jurerê Internacional",
          local: "Praia de Jurerê Internacional",
          coords: { lat: -27.4321, lng: -48.5140 },
          dica: "Caminhada pela orla mais badalada de Floripa. Sol põe ~17h50 em agosto.",
          tags: ["praia"],
          icone: "🌅",
        },
        {
          hora: "19:00",
          titulo: "Check-in e jantar",
          local: "Hospedagem na Lagoa da Conceição",
          coords: { lat: -27.6021, lng: -48.4683 },
          dica: "Jantar leve. Crianças cansadas da viagem. Lagoa tem botecos e restaurantes ao redor.",
          tags: ["hospedagem", "jantar"],
          icone: "🌙",
          confirmar: true,
        },
      ],
    },

    // ============== DIA 2 — em breve ==============
    {
      numero: 2,
      dataISO: "2026-08-17",
      diaSemana: "Segunda",
      cidade: "Florianópolis → Balneário Camboriú",
      titulo: "Centro de Floripa + transferência para BC",
      icone: "🚗",
      corAcento: "#4ADE80",
      placeholder: true,
    },

    // ============== DIA 3 — em breve ==============
    {
      numero: 3,
      dataISO: "2026-08-18",
      diaSemana: "Terça",
      cidade: "Balneário Camboriú",
      titulo: "Unipraias + Aquário + Summit BC",
      icone: "🚠",
      corAcento: "#FFD700",
      placeholder: true,
    },

    // ============== DIA 4 — em breve ==============
    {
      numero: 4,
      dataISO: "2026-08-19",
      diaSemana: "Quarta",
      cidade: "Pomerode (bate-volta)",
      titulo: "Zoo Pomerode + Rota do Enxaimel",
      icone: "🦁",
      corAcento: "#FF8C42",
      placeholder: true,
    },

    // ============== DIA 5 — em breve ==============
    {
      numero: 5,
      dataISO: "2026-08-20",
      diaSemana: "Quinta",
      cidade: "Penha",
      titulo: "Transferência + Beto Carrero (Dia 1)",
      icone: "🎢",
      corAcento: "#E30613",
      placeholder: true,
    },

    // ============== DIA 6 — em breve ==============
    {
      numero: 6,
      dataISO: "2026-08-21",
      diaSemana: "Sexta",
      cidade: "Penha → Navegantes",
      titulo: "Beto Carrero (Dia 2) + Voo de volta",
      icone: "🎠",
      corAcento: "#A855F7",
      placeholder: true,
    },

  ],

  // -------- CHECKLIST (estrutura — populamos depois) --------
  checklist: [],

  // -------- ORÇAMENTO (estrutura — populamos depois) --------
  orcamento: { itens: [], alvo: null },

  // -------- CONTATOS (estrutura — populamos depois) --------
  contatos: {
    emergencia: [
      { nome: "SAMU", numero: "192" },
      { nome: "Polícia", numero: "190" },
      { nome: "Bombeiros", numero: "193" },
    ],
  },

  // -------- FAQ (estrutura — populamos depois) --------
  faq: [],

};
