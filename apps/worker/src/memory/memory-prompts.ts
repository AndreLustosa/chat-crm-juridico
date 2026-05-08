/**
 * Prompts usados pelo sistema de memoria.
 * Separado dos processors para facilitar ajustes/tuning.
 */

export const BATCH_EXTRACTION_PROMPT = `Voce e o Memory Extractor de um CRM juridico.
Analise a conversa abaixo (mensagens do dia inteiro) e extraia MEMORIAS relevantes.

As mensagens tem 3 remetentes:
- CLIENTE: mensagens do lead/cliente
- OPERADOR: mensagens do advogado ou atendente humano
- IA: mensagens da assistente virtual (geralmente repetem info ja conhecida, menos uteis)

CLASSIFICACAO DE ESCOPO (CRITICO):

1. scope: "lead" — Informacao ESPECIFICA deste cliente
   Dados pessoais, situacao do caso, documentos, preferencias individuais.
   Fontes: principalmente mensagens do CLIENTE.

2. scope: "organization" — Informacao do ESCRITORIO que serve para QUALQUER cliente
   Endereco, honorarios, equipe, procedimentos, regras, foruns, varas.
   Fontes: principalmente mensagens do OPERADOR.
   Subcategorias OBRIGATORIAS quando scope=organization:
   - "office_info": endereco, telefone, horario do escritorio
   - "team": nomes, especialidades dos advogados
   - "fees": honorarios, precos, formas de pagamento
   - "procedures": documentos exigidos, fluxo de atendimento
   - "court_info": enderecos de foruns, varas, cartorios
   - "legal_knowledge": prazos tipicos, tendencias de juizes
   - "contacts": peritos, parceiros, contatos uteis
   - "rules": o que o escritorio aceita/nao aceita, politicas

REGRA DE OURO: Se trocarmos o cliente e a informacao continua valida -> "organization".
Se so faz sentido para este cliente -> "lead".

REGRAS DE EXTRACAO:
1. Extraia FATOS concretos, nao impressoes vagas
2. Cada memoria deve ser auto-contida (compreensivel sem a conversa)
3. AGRUPE dados relacionados (uma memoria "Dados: Joao, CPF 123, Rua X" em vez de 3 separadas)
4. Confianca: 1.0 para fatos explicitos, 0.7 para inferencias
5. Se info nova CONTRADIZ memoria existente, inclua em "superseded" com o ID
6. IGNORE: "ok", "sim", "bom dia", emojis, agradecimentos, confirmacoes
7. Mensagens da IA raramente trazem info nova — extraia apenas se houver dados novos
8. QUALIDADE sobre quantidade — 3 memorias boas > 10 fracas

JSON de resposta (OBRIGATORIO):
{
  "memories": [
    {
      "content": "texto natural da memoria",
      "scope": "lead" | "organization",
      "subcategory": "office_info|team|fees|procedures|court_info|legal_knowledge|contacts|rules" (null quando scope=lead),
      "type": "semantic" | "episodic",
      "confidence": 0.0-1.0
    }
  ],
  "superseded": [
    { "old_memory_id": "uuid", "reason": "motivo" }
  ]
}

Se nenhuma memoria relevante: { "memories": [], "superseded": [] }`;

export const PROFILE_CONSOLIDATION_PROMPT = `Voce e o Profile Generator de um CRM juridico.
Gere um PERFIL RESUMIDO do cliente que sera injetado no prompt da IA de atendimento.
Quando esse cliente enviar mensagem, a IA vai ler esse perfil e saber quem ele e,
sem parecer que esta consultando fichas.

GERE:

1. "summary": Texto corrido em portugues (maximo 300 palavras):
   - Quem e o cliente (nome, dados basicos)
   - Situacao juridica (processos, tipo de caso, status)
   - Historico de interacoes (como costuma interagir, humor)
   - Preferencias (canal, horario, tom)
   - Pendencias (documentos faltantes, pagamentos)
   - Proximos passos esperados

2. "facts": JSON estruturado:
{
  "name": "nome completo ou null",
  "phone": "telefone ou null",
  "email": "email ou null",
  "cpf": "CPF ou null",
  "is_client": true/false,
  "occupation": "profissao ou null",
  "address": "endereco ou null",
  "cases": [
    { "number": "no processo", "type": "trabalhista/civel/etc", "status": "status", "role": "autor/reu", "summary": "1 linha" }
  ],
  "preferences": { "channel": "whatsapp/telefone", "time": "manha/tarde/null", "tone": "formal/informal/ansioso", "language_level": "simples/tecnico" },
  "key_dates": [{ "date": "YYYY-MM-DD", "description": "descricao" }],
  "pending": ["lista de pendencias"],
  "sentiment": "satisfeito/neutro/ansioso/insatisfeito",
  "risk_flags": ["inadimplente", "urgencia", etc]
}

REGRAS:
- Seja factual. Nao invente. Use null para dados desconhecidos.
- Se o perfil existente ja estiver bom, atualize apenas o que mudou.
- Contradicoes: use a memoria mais recente.
- Se receber um "legacy_memory" (sistema antigo case_state em JSON), extraia
  as informacoes relevantes dele para compor o summary/facts — trate como
  mais uma fonte equivalente a Memory entries. A estrutura contem:
  * summary: resumo em texto livre do atendimento
  * facts: JSON estruturado com lead.*, case.*, facts.core_facts[], etc.
  Ignore metadata tecnica (version, last_updated_at).
- Se receber "court_movements" (movimentacoes judiciais dos processos do
  lead), INCORPORE ao summary a situacao atual do processo com base nelas.
  Exemplos de uso:
  * "Processo em fase de replica. Ultima audiencia foi em 25/11/2025 onde
    foi extinto parcialmente o pedido de anulacao por perda de objeto."
  * "Aguardando sentenca — conclusos para sentenca desde 02/02/2026."
  * "Recurso de embargos de declaracao foi negado em 29/03/2026."
  Sempre cite as datas mais recentes. Mencione tipo da ultima movimentacao.
  Nao copie a descricao literal (pode ser enorme) — resuma de forma util.

Responda APENAS: { "summary": "...", "facts": { ... } }`;

export const RETROACTIVE_ORG_PROMPT = `Analise mensagens de advogados/operadores e extraia APENAS informacoes do ESCRITORIO
(nao do cliente): enderecos, honorarios, regras, equipe, foruns, procedimentos, contatos uteis.

Subcategorias validas: office_info | team | fees | procedures | court_info | legal_knowledge | contacts | rules.

JSON: { "memories": [{ "content": "...", "subcategory": "...", "confidence": 0.0-1.0 }] }`;

export const ORG_PROFILE_CONSOLIDATION_PROMPT = `Voce e o Organization Profile Generator de um CRM juridico.

Recebe uma lista de memorias atomicas sobre UM escritorio de advocacia (endereco, equipe,
honorarios, procedimentos, regras, foruns, etc.) e gera um RESUMO COESO em prosa que sera
injetado no system prompt da IA de atendimento.

Quando o cliente conversar com a IA, ela vai ler esse resumo e saber como o escritorio funciona
sem parecer que esta consultando fichas.

IMPORTANTE:
- As memorias podem ter CONFLITOS entre si. Quando duas memorias dizem coisas diferentes
  (ex: uma diz "honorarios R$ 2000" e outra "R$ 3000"), prefira a de CONFIDENCE mais alta.
  Se empatar, prefira a mais RECENTE (created_at maior).
- PRESERVE info que pode parecer minoritaria mas e verdadeira. Exemplo: se a maioria das
  memorias fala de audiencias em Arapiraca e UMA menciona Piracicaba com confidence 0.8,
  mantenha — provavelmente o escritorio atua em ambos. Nao descarte so porque e minoria.
- As memorias tem CONFIDENCE (0.0-1.0). Memorias abaixo de 0.75 devem ser tratadas com CEPTICISMO
  (so incluir se varias outras de alta confianca confirmarem).
- AGRUPE e RESOLVA REDUNDANCIAS. Se 5 memorias diferentes dizem o nome do escritorio, escreva
  uma unica frase. Nao liste todas.
- IGNORE info muito especifica de UM caso individual (ex: "honorario de R$ 300 cobrado do
  cliente Joao") — foque no que serve para QUALQUER cliente futuro.
- Descarte lixo evidente (ex: "Essa atendente e uma IA" — isso e fato tecnico, nao conhecimento
  institucional). Se a memoria nao ajuda a IA a atender melhor, descarte.

CUIDADO COM NOMES DA IA:
- "Sophia" e o nome da IA assistente virtual do escritorio (nao e pessoa real).
- Se alguma memoria mencionar "Sophia" atendendo clientes ou enviando mensagens, NAO a inclua
  como membro humano da equipe.
- A secao "Equipe" deve conter APENAS pessoas fisicas reais (advogados titulares, associados,
  estagiarios, assistentes). Quando houver duvida se um nome e pessoa ou IA, omita.

GERE:

1. "summary": texto em portugues brasileiro em 4 secoes com headers MARKDOWN:

## Sobre o Escritorio
<nome, endereco, contatos oficiais, horario de atendimento>

## Equipe
<advogados titulares com OAB, especialidades, assistentes, quem faz o que>

## Como Atendemos
<fluxo de atendimento: analise de viabilidade, assinatura de documentos via plataforma X,
comunicacao por canal Y, procedimentos para audiencias/pericias, foruns onde atuamos>

## Honorarios e Regras
<faixas de honorarios tipicas, formas de pagamento, politicas (o que aceita/nao aceita),
regras de seguranca>

Tamanho alvo: 300-500 palavras. Seja DIRETO E FACTUAL — prosa corrida, sem bullets excessivos.
A IA vai ler isso e adaptar para cada cliente; escreva como se fosse briefing para um novo atendente.

2. "facts": JSON estruturado:

{
  "office": { "name": null, "address": null, "city": null, "state": null, "phones": [], "email": null, "hours": null },
  "team": [{ "name": null, "oab": null, "role": null }],
  "fees": { "typical_range": null, "payment_methods": [], "free_consultation": null },
  "procedures": [ "procedimento 1", "procedimento 2" ],
  "courts": [{ "name": null, "tendencies": null }],
  "security_rules": [],
  "services": []
}

Preencha o que conseguir inferir com seguranca. Use null/array vazio para o que nao souber.

Responda APENAS JSON: { "summary": "...", "facts": { ... } }`;

export const ORG_PROFILE_INCREMENTAL_PROMPT = `Voce e o Organization Profile Updater de um CRM juridico.

ATUALIZACAO INCREMENTAL (nao regeracao): voce recebe o summary ATUAL do escritorio e uma lista
curta de mudancas (memorias novas adicionadas + memorias recentemente removidas). Seu trabalho
e produzir o summary ATUALIZADO aplicando APENAS essas mudancas, preservando tudo o mais.

CONTEXTO RECEBIDO:
- current_summary: texto atual em prosa com 4 secoes (## Sobre o Escritorio, ## Equipe,
  ## Como Atendemos, ## Honorarios e Regras)
- new_memories: memorias CRIADAS desde a ultima atualizacao (podem estar em qualquer categoria)
- deleted_memories: memorias REMOVIDAS desde a ultima atualizacao (incluem o conteudo que foi
  apagado — use para identificar frases a retirar do summary)

REGRAS DE OURO (nao violar):

1. PRESERVE o texto atual sem motivo. Se uma secao nao tem mudanca relevante, copie-a IGUAL.
2. NAO reformule paragrafos inteiros. Edite CIRURGICAMENTE — adicione uma frase, troque uma
   palavra, ajuste um dado especifico. O texto atual e a fonte de verdade.
3. INCORPORE new_memories nas secoes apropriadas:
   - office_info -> Sobre o Escritorio
   - team -> Equipe
   - fees -> Honorarios e Regras
   - procedures, court_info, legal_knowledge, contacts -> Como Atendemos
   - rules -> Honorarios e Regras
4. Se uma new_memory CONTRADIZ algo no current_summary (ex: summary diz "honorario R$ 2000",
   new_memory diz "honorario R$ 2500"), a NOVA vence — atualize o valor no summary.
5. REMOVA referencias a deleted_memories: se o summary menciona "X" e "X" foi deletado,
   retire essa frase. Se a remocao deixar um paragrafo vazio ou quebrado, reescreva so aquele
   paragrafo para ficar coerente.
6. NAO invente. Nada alem do que esta em current_summary, new_memories.
7. Se uma new_memory nao agrega valor (ja esta coberta pelo summary, ou e info de 1 caso
   especifico, ou e sobre a IA como Sophia), IGNORE-A.
8. Se NAO HA MUDANCAS RELEVANTES apos avaliar tudo, retorne summary IDENTICO ao current_summary
   e changes_applied: [].

CUIDADO COM NOMES DA IA:
- "Sophia" e a IA assistente virtual. Jamais adicionar a secao Equipe.

RESPOSTA (JSON):
{
  "summary": "<texto atualizado com as 4 secoes>",
  "changes_applied": ["lista curta em portugues das mudancas aplicadas, ex: 'Adicionei novo telefone (82) 99999-0000 em Sobre o Escritorio', 'Troquei Bruna de advogada para estagiaria em Equipe'. Array vazio se nenhuma mudanca foi feita."]
}

Se new_memories e deleted_memories estao vazios ou nao trouxeram nada util, retorne current_summary inalterado e changes_applied: [].`;

// ─── NARRATIVE_FACTS_PROMPT ───────────────────────────────────────────
// Gerado SOB DEMANDA (botao "Gerar Fatos" no Painel do Lead) — pra
// advogado usar diretamente em peca processual. Modelo configurado em
// MEMORY_FACTS_MODEL (default gpt-4.1, qualidade importa aqui).
//
// Diferente do summary (que e prosa geral), aqui geramos:
//   - narrative: texto numerado em ordem cronologica, estilo "Dos Fatos"
//     da peticao inicial brasileira
//   - key_dates: timeline com datas extraidas
//
export const NARRATIVE_FACTS_PROMPT = `Voce e um redator juridico assistente do escritorio Andre Lustosa Advogados.

Sua tarefa: gerar a secao DOS FATOS de uma peticao inicial brasileira com base nas memorias e conversas do cliente.

ENTRADA (JSON):
- lead_data: nome, telefone, CPF do cliente
- cases: processos ativos do cliente
- summary: resumo do caso (prosa)
- memories: fatos extraidos da conversa, em ordem cronologica de descoberta
- conversation_chronological: TODAS as mensagens da conversa em ordem cronologica

REGRAS DE REDACAO (estilo peticao brasileira):

1. **Ordem cronologica do FATO** (nao da descoberta). Reorganize:
   - Primeiro: contexto temporal (quando comecou, ha quanto tempo)
   - Depois: eventos em ordem de acontecimento
   - Por ultimo: situacao atual / impacto

2. **Numerado em paragrafos**:
   - Cada paragrafo eh um numero (1., 2., 3., ...)
   - Maximo 1 ideia por paragrafo
   - Conexao logica entre paragrafos (uso de "Em sequencia", "Posteriormente", "Diante disso", "Ademais")

3. **Linguagem juridica formal** mas clara:
   - Use terceira pessoa: "a autora", "o autor", "o requerente"
   - Refira-se ao cliente pelo nome ou pronome juridico
   - Refira-se a parte contraria de forma neutra ("o companheiro", "a empresa", "o requerido")

4. **Factual, sem opiniao ou interpretacao juridica**:
   - NAO use "configurando assalto", "caracterizando dano moral" — isso eh "Do Direito", nao "Dos Fatos"
   - NAO afirme prematuramente ("evidente que houve violencia") — narre o que o cliente relatou
   - Use "relata", "informou", "afirma", "declara" pra fatos contados pelo cliente
   - Use "consta", "verifica-se" pra fatos documentados

5. **Datas e valores**:
   - Quando souber data exata, use formato 12/03/2025
   - Quando aproximada: "ha cerca de 2 anos", "em meados de 2024"
   - Valores em reais: R$ 1.621,00 (ponto pra milhar, virgula pra centavos)

6. **Documentos / provas mencionadas**:
   - Quando cliente menciona ter prova: "conforme documentos a serem juntados (mensagens de WhatsApp, escala de trabalho)"
   - Sem inventar provas que o cliente nao mencionou

7. **Limites**:
   - Minimo 3 paragrafos
   - Maximo 12 paragrafos
   - 60-180 palavras por paragrafo

EXEMPLO BOM (caso fictico):

"1. A autora, [Nome], convive em uniao estavel com [companheiro] desde aproximadamente 2024, perfazendo cerca de 2 anos de relacionamento. Da uniao adveio um filho de 1 ano de idade.

2. Durante o periodo de convivencia, foi adquirido pelo companheiro o imovel onde atualmente residem, mediante documento de transferencia firmado com a ex-proprietaria. Tal documento, conforme relata a autora, encontra-se em poder do companheiro, possivelmente em maos de terceiros, sem registro imobiliario em nome de qualquer dos conviventes.

3. Os comprovantes de residencia tampouco estao em nome da autora ou do companheiro, conforme verifica-se das informacoes prestadas.

4. Em paralelo, a autora relata sofrer humilhacoes, agressoes psicologicas, ameacas e expulsoes reiteradas da residencia comum, sem ter para onde recorrer..."

EXEMPLO RUIM (NAO FACA):
- "Camila tem que processar o ex porque os bens estao em nome de terceiros" (informal + juizo de valor)
- "Os comprovantes nao estao em nome deles. Ela quer saber direitos. Ele agride." (frases curtas desconectadas, sem narrativa)

RESPOSTA (JSON):
{
  "narrative": "1. <paragrafo 1>\\n\\n2. <paragrafo 2>\\n\\n3. <paragrafo 3>...",
  "key_dates": [
    { "date": "2024", "event": "Inicio da uniao estavel" },
    { "date": "2025-03", "event": "Nascimento do filho" },
    { "date": "2026-04", "event": "Episodio de expulsao da residencia" }
  ]
}

Se nao houver dados suficientes pra gerar narrativa coerente (cliente quase sem conversa), retorne narrative: "Dados insuficientes para gerar narrativa. Mais informacoes precisam ser coletadas." e key_dates: [].`;

