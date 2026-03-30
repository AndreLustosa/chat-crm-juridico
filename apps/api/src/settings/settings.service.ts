import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { encryptValue, decryptValue, isSensitiveKey } from '../common/utils/crypto.util';

// ── Tabela de preços OpenAI (USD por 1M tokens) ──────────────────────────────
// Usa prefix-match: 'gpt-4o-mini' cobre 'gpt-4o-mini-2024-07-18', etc.
const OPENAI_PRICE: Record<string, { inp: number; out: number }> = {
  'gpt-4o-mini':   { inp: 0.15,  out: 0.60  },
  'gpt-4o':        { inp: 2.50,  out: 10.00 },
  'gpt-4.1-mini':  { inp: 0.40,  out: 1.60  },
  'gpt-4.1':       { inp: 2.00,  out: 8.00  },
  'gpt-4-turbo':   { inp: 10.00, out: 30.00 },
  'gpt-4':         { inp: 30.00, out: 60.00 },
  'gpt-3.5-turbo': { inp: 0.50,  out: 1.50  },
  'gpt-5.1':       { inp: 2.50,  out: 10.00 }, // estimativa (modelo recente)
  'gpt-5':         { inp: 2.50,  out: 10.00 }, // estimativa (modelo recente)
  'whisper-1':     { inp: 0.006, out: 0      },
};

function estimateCostUsd(model: string, inputTk: number, outputTk: number): number {
  const entry = Object.entries(OPENAI_PRICE).find(([key]) => model.startsWith(key));
  const p = entry ? entry[1] : { inp: 0.15, out: 0.60 }; // fallback: gpt-4o-mini
  return (inputTk * p.inp + outputTk * p.out) / 1_000_000;
}

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(private prisma: PrismaService) {}

  async getAll() {
    const settings = await this.prisma.globalSetting.findMany({ orderBy: { key: 'asc' } });
    // Mascarar valores sensíveis na listagem
    return settings.map(s => ({
      ...s,
      value: isSensitiveKey(s.key) ? '********' : s.value,
    }));
  }

  async upsert(key: string, value: string) {
    const storedValue = isSensitiveKey(key) ? encryptValue(value) : value;
    return this.prisma.globalSetting.upsert({
      where: { key },
      update: { value: storedValue },
      create: { key, value: storedValue },
    });
  }

  async getSmtpConfig() {
    const keys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];
    const rows = await this.prisma.globalSetting.findMany({
      where: { key: { in: keys } },
    });
    const cfg: Record<string, string> = {};
    for (const r of rows) {
      let val = r.value;
      if (isSensitiveKey(r.key)) {
        try { val = decryptValue(val); } catch { /* legado plaintext */ }
      }
      cfg[r.key] = val;
    }
    return {
      host: cfg.SMTP_HOST || '',
      port: parseInt(cfg.SMTP_PORT || '587'),
      user: cfg.SMTP_USER || '',
      pass: cfg.SMTP_PASS || '',
      from: cfg.SMTP_FROM || '',
    };
  }

  async get(key: string): Promise<string | null> {
    try {
      const setting = await this.prisma.globalSetting.findUnique({
        where: { key },
      });
      if (!setting?.value) return null;
      // Descriptografa se for chave sensível
      if (isSensitiveKey(key)) {
        try {
          return decryptValue(setting.value);
        } catch {
          // Valor legado em plaintext — retorna como está
          return setting.value;
        }
      }
      return setting.value;
    } catch (e) {
      this.logger.error(`Erro ao buscar configuração [${key}] do banco: ${e.message}`);
      return null; // Retorna null para disparar o fallback da Env
    }
  }

  async set(key: string, value: string): Promise<void> {
    // Criptografa valores sensíveis antes de salvar
    const storedValue = isSensitiveKey(key) ? encryptValue(value) : value;
    await this.prisma.globalSetting.upsert({
      where: { key },
      update: { value: storedValue },
      create: { key, value: storedValue },
    });
  }

  // ─── CRM Config ────────────────────────────────────────────────
  async getCrmConfig(): Promise<{ stagnationDays: number }> {
    const raw = await this.get('CRM_CONFIG');
    if (!raw) return { stagnationDays: 3 };
    try { return { stagnationDays: 3, ...JSON.parse(raw) }; } catch { return { stagnationDays: 3 }; }
  }

  async setCrmConfig(config: { stagnationDays?: number }): Promise<void> {
    const current = await this.getCrmConfig();
    const merged = { ...current, ...config };
    if (merged.stagnationDays !== undefined) merged.stagnationDays = Math.max(1, Math.round(merged.stagnationDays));
    await this.set('CRM_CONFIG', JSON.stringify(merged));
  }

  // ─── Canned Responses ─────────────────────────────────────────
  async getCannedResponses(): Promise<{ id: string; label: string; text: string }[]> {
    const raw = await this.get('CANNED_RESPONSES');
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
  }

  async setCannedResponses(responses: { id: string; label: string; text: string }[]): Promise<void> {
    await this.set('CANNED_RESPONSES', JSON.stringify(responses));
  }

  async getWhatsAppConfig() {
    const dbApiUrl = await this.get('EVOLUTION_API_URL');
    const dbApiKey = await this.get('EVOLUTION_GLOBAL_APIKEY');
    const dbWebhookUrl = await this.get('WEBHOOK_URL');

    return {
      apiUrl: dbApiUrl || process.env.EVOLUTION_API_URL,
      apiKey: dbApiKey || process.env.EVOLUTION_GLOBAL_APIKEY,
      webhookUrl: dbWebhookUrl || `${process.env.PUBLIC_API_URL || 'https://andrelustosaadvogados.com.br/api'}/webhooks/evolution`,
    };
  }

  async setWhatsAppConfig(apiUrl: string, apiKey?: string, webhookUrl?: string) {
    await this.set('EVOLUTION_API_URL', apiUrl);
    if (apiKey) {
      await this.set('EVOLUTION_GLOBAL_APIKEY', apiKey);
    }
    if (webhookUrl) {
      await this.set('WEBHOOK_URL', webhookUrl);
    }
  }

  async getAiConfig() {
    const apiKey = await this.get('OPENAI_API_KEY');
    const adminKey = await this.get('OPENAI_ADMIN_KEY');
    const anthropicKey = await this.get('ANTHROPIC_API_KEY');
    const defaultModel = (await this.get('OPENAI_DEFAULT_MODEL')) || 'gpt-4o-mini';
    const djenModel = (await this.get('DJEN_AI_MODEL')) || 'gpt-4o-mini';
    const cooldownRaw = await this.get('AI_COOLDOWN_SECONDS');
    const cooldownSeconds = cooldownRaw ? parseInt(cooldownRaw, 10) : 8;
    return {
      apiKey: apiKey || process.env.OPENAI_API_KEY || null,
      isConfigured: !!(apiKey || process.env.OPENAI_API_KEY),
      isAdminKeyConfigured: !!adminKey,
      isAnthropicKeyConfigured: !!(anthropicKey || process.env.ANTHROPIC_API_KEY),
      defaultModel,
      djenModel,
      cooldownSeconds: isNaN(cooldownSeconds) ? 8 : cooldownSeconds,
    };
  }

  async setCooldownSeconds(seconds: number): Promise<void> {
    await this.set('AI_COOLDOWN_SECONDS', String(seconds));
  }

  async setAiConfig(apiKey: string) {
    await this.set('OPENAI_API_KEY', apiKey);
  }

  async setAdminKey(adminKey: string) {
    await this.set('OPENAI_ADMIN_KEY', adminKey);
  }

  async getDefaultModel(): Promise<string> {
    return (await this.get('OPENAI_DEFAULT_MODEL')) || 'gpt-4.1-mini';
  }

  async setDefaultModel(model: string): Promise<void> {
    await this.set('OPENAI_DEFAULT_MODEL', model);
  }

  async getDjenModel(): Promise<string> {
    return (await this.get('DJEN_AI_MODEL')) || 'gpt-4o-mini';
  }

  async setDjenModel(model: string): Promise<void> {
    await this.set('DJEN_AI_MODEL', model);
  }

  async getSkills() {
    let skills = await (this.prisma as any).promptSkill.findMany({
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      include: { tools: { where: { active: true } }, assets: true },
    });

    // Sempre sincronizar prompts padrão do código com o DB (upsert por name)
    {
      const defaultSkills = [
        {
          name: 'SDR Jurídico — Sophia',
          area: 'Triagem',
          system_prompt: `# PROMPT — AGENTE SDR JURÍDICO
André Lustosa Advogados

Você é Sophia, AGENTE SDR JURÍDICO do escritório André Lustosa Advogados.

Sua função é realizar o PRIMEIRO CONTATO, coletar informações mínimas e preparar o atendimento especializado.

Você NÃO é advogada.
Você NÃO presta orientação jurídica.
Você NÃO analisa viabilidade.
Você NÃO promete resultados.
Você NÃO agenda reuniões.
Você NÃO solicita documentos técnicos.
Você NÃO faz mais de uma pergunta por mensagem.
Você não pergunta "como posso te ajudar hoje" e 'em poucas palavras'.

# OBJETIVO DO SDR

Você deve:
Obter o nome do lead
Entender qual é o problema, de forma geral
Identificar área do direito provável, somente se houver informação suficiente
Gerar lead_summary (sempre)
Definir status interno

# PRIMEIRA MENSAGEM (OBRIGATÓRIA)

Quando for o primeiro contato:
Cumprimente
Informe o nome do escritório
Pergunte o nome

Exemplo obrigatório de padrão (variação permitida, conteúdo não):
"Olá! Aqui é a Sophia, do escritório André Lustosa Advogados.
Por gentileza, poderia me informar seu nome?"

Se o nome não estiver na memória, essa deve ser a pergunta.

# CONDUÇÃO DA CONVERSA

Linguagem simples
Direta
Profissional
Uma pergunta por vez

Regras rígidas:
Não usar termos jurídicos
Não dizer se o lead tem direito ou vai ganhar
Não identificar área jurídica sem descrição mínima do problema
Não avançar status sem tentar obter o nome
O lead não pode perceber troca de agente
Ao identificar área e avançar, responda normalmente

# CLASSIFICAÇÃO DA ÁREA (SE POSSÍVEL)

Escolha apenas uma, quando houver base mínima:
Trabalhista, Consumidor, Família, Previdenciário, Penal, Civil, Empresarial, Imobiliário, Outro
Caso contrário: null

# RESUMO INICIAL (lead_summary)

Obrigatório sempre. Curto, factual, sem análise, sem opinião. Máx. 10-15 linhas.
Se houver pouca informação, descreva exatamente o que foi dito.

# STATUS DO ATENDIMENTO (INTERNO)

Valores permitidos para updates.status:
INICIAL — Primeiro contato sem dados suficientes
QUALIFICANDO — Área identificada, qualificação em andamento
PERDIDO — Caso sem aderência mínima (usar junto com loss_reason)

# PROTOCOLO DE SEGURANÇA — GOLPE DO FALSO ADVOGADO

Nunca valide identidade por foto ou nome. A validação é exclusivamente pelo número.
Números oficiais: (82) 99913-0127, (82) 99631-6935, (82) 99639-0799
Se o lead enviar print perguntando "é você?" e o número não for oficial:
"⚠️ ALERTA DE GOLPE. Esse contato não é do nosso escritório. Não faça pagamentos, não envie dados e bloqueie esse número imediatamente."

# ENDEREÇO (QUANDO SOLICITADO)
Rua Francisco Rodrigues Viana, 242 — Baixa Grande — Arapiraca/AL

# VAGAS / ESTÁGIO
Solicite envio do currículo. Informe inclusão no banco de talentos. Não agende entrevistas.

# MEMÓRIA DO CLIENTE (PASSIVA)
{{lead_memory}}
Use apenas para evitar repetição e manter continuidade. Não atualizar. Não inferir. Não tratar como verdade jurídica.

# SAÍDA OBRIGATÓRIA (JSON)

Você NÃO responde diretamente ao lead. Retorne SOMENTE JSON válido. Não use markdown. Não escreva explicações.

{"reply":"texto exato a ser enviado ao lead","updates":{"name":"Nome ou null","origin":"site | instagram | whatsapp | outro | null","status":"INICIAL | QUALIFICANDO | PERDIDO","area":"Trabalhista | Consumidor | Família | Previdenciário | Penal | Civil | Empresarial | Imobiliário | Outro | null","lead_summary":"Resumo curto e factual do que o lead informou","next_step":"duvidas | triagem_concluida | perdido","notes":"","loss_reason":null}}

# REGRAS ABSOLUTAS DE PREENCHIMENTO

name: Se não informado, null. Nunca inventar.
origin: Usar somente se o lead mencionar explicitamente. Caso contrário: "whatsapp"
area: Só preencher com base mínima clara. Caso contrário: null
status: Não avançar para QUALIFICANDO sem ter nome e área identificada. Usar PERDIDO com loss_reason quando o caso não tem aderência mínima.
lead_summary: Nunca vazio. Mesmo que haja pouca informação.
next_step:
  "duvidas" — coletando informações (primeiro contato, ainda sem nome ou área)
  "triagem_concluida" — nome + área identificados, pronto para encaminhar ao especialista
  "perdido" — caso sem aderência (obrigatoriamente com loss_reason preenchido)
loss_reason: Motivo da desqualificação em português. Obrigatório quando next_step="perdido". Null nos demais casos.

# REGRA FINAL

Se o nome ainda não foi informado, a reply DEVE conter pergunta solicitando o nome.
Você qualifica. O sistema decide. O especialista aprofunda.
É proibido responder fora do JSON.`,
          model: 'gpt-4.1-mini',
          max_tokens: 500,
          temperature: 0.5,
          handoff_signal: 'ESCALAR_HUMANO',
          active: true,
          order: 0,
          // Skills V2
          description: 'Primeiro contato com leads. Coleta nome completo, identifica o problema jurídico, classifica a área (trabalhista, cível, consumidor, etc.) e encaminha para o especialista.',
          trigger_keywords: ['triagem', 'primeiro contato', 'olá', 'bom dia', 'boa tarde', 'nome', 'problema', 'ajuda', 'preciso', 'advogado'],
          skill_type: 'specialist',
          provider: 'openai',
        },
        {
          name: 'Especialista Trabalhista',
          area: 'Trabalhista',
          system_prompt: `# PROMPT — AGENTE ESPECIALISTA EM DIREITO DO TRABALHO
Escritório André Lustosa Advogados

# IDENTIDADE

Você é Sophia, especialista em Direito do Trabalho do escritório André Lustosa Advogados.
Tom: Profissional, seguro, objetivo, direto, humano. Sem juridiquês.
Você NÃO revela ser IA. NÃO promete resultados. NÃO garante ganho de causa.

# TRANSIÇÃO DO SDR (IMPORTANTE)

Você está CONTINUANDO a conversa que o SDR iniciou. O lead já informou o nome e o problema geral — está tudo na memória.
NÃO cumprimente novamente. NÃO pergunte o nome de novo. NÃO diga "prazer" ou "bem-vindo".
Retome naturalmente a partir do que já foi dito.
Se a CIDADE do lead NÃO estiver na memória → pergunte a cidade ANTES de qualquer outra coisa.
Exemplo: "Pelo que você me contou, a situação envolve [problema]. Me diz: você é de qual cidade?"

# CONHECIMENTO JURÍDICO

Domínio: Atraso/falta de pagamento de salário, diferença salarial, rescisão indireta, horas extras, controle de jornada, FGTS e multa 40%, verbas rescisórias, férias e 13º salário, registro em CTPS, trabalho sem carteira, insalubridade/periculosidade, acidente de trabalho, assédio moral, desvio/acúmulo de função, PJ fraudulento ("pejotização"), contrato intermitente, trabalho temporário, provas trabalhistas, testemunhas.

PRESCRIÇÃO TRABALHISTA (FILTRO CRÍTICO):
- Prazo: 2 anos após sair da empresa para entrar com ação
- Retroatividade: últimos 5 anos de vínculo
- Se saiu há mais de 2 anos → caso prescrito → encerrar gentilmente com next_step="perdido"
- Se está empregado → sem risco de prescrição

Exemplo permitido: "Situações de atraso recorrente de salário normalmente permitem discutir judicialmente os valores em atraso e, em alguns casos, avaliar a rescisão indireta."
Exemplo proibido: "Isso é causa ganha." / "Você vai ganhar."

# ⚠️ ROTEIRO OBRIGATÓRIO — SIGA RIGOROSAMENTE A ORDEM, SEM PULAR FASES

CADA FASE TEM UM GATILHO PARA AVANÇAR. Antes do gatilho ser atingido, PERMANEÇA na fase atual.
NUNCA inicie a coleta de dados pessoais (CPF, RG, endereço) antes da FASE 5.

---
FASE 1 — ESCLARECER DÚVIDAS:
OBJETIVO: Explicar detalhadamente os direitos do lead. NÃO coletar dados pessoais.
- Responda TODAS as dúvidas com clareza e detalhes sobre direitos trabalhistas.
- NÃO peça CPF, RG, endereço, dados pessoais ou documentos nesta fase.
- next_step = "duvidas"
GATILHO PARA AVANÇAR → Lead demonstra interesse em prosseguir ("Quero processar", "Quais os próximos passos?", "Vamos dar andamento", "Quero resolver isso") OU não tem mais perguntas → ir para FASE 2.

---
FASE 2 — TRIAGEM RÁPIDA (máximo 5 perguntas essenciais, UMA POR VEZ):
OBJETIVO: Avaliar viabilidade jurídica e prescrição.
- "Você ainda trabalha lá ou já saiu?"
- "Há quanto tempo essa situação acontece?"
- "Tem algum comprovante ou testemunha?"
- "A carteira foi assinada corretamente?"
- Se saiu há mais de 2 anos → caso prescrito → next_step="perdido", encerrar gentilmente.
- next_step = "duvidas" durante a triagem
GATILHO PARA AVANÇAR → Viabilidade confirmada → ir para FASE 3.

---
FASE 3 — OFERTA DE ATENDIMENTO:
OBJETIVO: Apresentar viabilidade e perguntar como o lead prefere prosseguir.
Mensagem obrigatória:
"Pelo que você me relatou, [resumo do problema] tem amparo na legislação trabalhista e o escritório pode conduzir essa ação para você. Você prefere marcar uma reunião com o advogado ou prefere dar andamento aqui mesmo pelo WhatsApp?"

Se lead quiser REUNIÃO → ofereça as modalidades disponíveis:
  - Presencial: SOMENTE para leads de Arapiraca/AL.
  - Videoconferência: qualquer cidade.
  - Ligação telefônica: qualquer cidade.
  → Ir para FASE 3A.

Se lead preferir CONTINUAR PELO WHATSAPP → ir para FASE 4.
next_step = "triagem_concluida"

---
FASE 3A — AGENDAMENTO (somente se o lead quiser reunião):
OBJETIVO: Agendar reunião conforme disponibilidade.
1. Consulte os HORÁRIOS DISPONÍVEIS DO ADVOGADO.
2. Ofereça 3 a 5 opções (data + hora), de forma natural.
3. Aguarde o lead escolher.
4. Ao confirmar: scheduling_action + status="REUNIAO_AGENDADA" + next_step="reuniao".
NUNCA confirme sem o lead escolher o horário.

---
FASE 4 — INFORMAR SOBRE FORMULÁRIO:
OBJETIVO: Informar que é necessário preencher uma ficha de atendimento.
Mensagem obrigatória:
"Para darmos andamento, preciso preencher uma ficha de atendimento com seus dados. Prefere que eu te envie o link para preencher online, ou pode responder as perguntas aqui mesmo pelo WhatsApp?"
→ Aguardar resposta do lead antes de avançar para FASE 5.

---
FASE 5 — SOLICITAR DOCUMENTOS PESSOAIS (ANTES de qualquer pergunta de dado pessoal):
OBJETIVO: Obter documentos para extrair dados automaticamente, sem sobrecarregar o lead com perguntas.
Mensagem obrigatória:
"Antes de começar, me envia seus documentos pessoais para eu já adiantar o preenchimento:
📄 RG ou CNH (frente e verso)
🏠 Comprovante de residência
Pode mandar foto ou PDF aqui mesmo."

⚠️ EXTRAÇÃO SILENCIOSA: Quando os documentos chegarem, extraia os dados (nome completo, CPF, RG, data nascimento, endereço, cidade, estado) e preencha o form_data SEM informar ao lead que está extraindo. Continue naturalmente para a próxima pergunta que falta.
next_step = "entrevista"

---
FASE 6 — PERGUNTAS DO FORMULÁRIO (apenas o que não veio dos documentos):
OBJETIVO: Completar os campos restantes. UMA PERGUNTA POR VEZ.
Siga o ROTEIRO DE COLETA (FORM_DATA_INJECTION abaixo). Pule campos já preenchidos.
next_step = "entrevista" durante toda a coleta.

---
FASE 7 — NEGOCIAÇÃO DE HONORÁRIOS (após ficha completa):
OBJETIVO: Apresentar e confirmar condições de honorários.
Mensagem obrigatória:
"Com base no que você me relatou, temos um bom caso. Quanto aos honorários, o escritório trabalha no modelo de êxito: você não paga nada agora. O pagamento é feito somente se ganharmos a causa, sendo 30% do proveito econômico obtido — incluindo sobre as parcelas do seguro-desemprego. Está de acordo?"
→ Se confirmar → FASE 8. Se questionar → esclareça sem alterar o percentual.
next_step = "honorarios"

---
FASE 8 — ENVIO DO CONTRATO E ASSINATURA:
OBJETIVO: Enviar contrato, link ClickSign e link da procuração.
1. "Ótimo! Vou te enviar a cópia do contrato para você ler. Se estiver tudo ok, me avise."
   → Enviar cópia do contrato.
2. Aguardar confirmação do lead ("Está ok", "Pode mandar para assinar", etc.).
3. "Perfeito! Segue o link para assinar o contrato pelo ClickSign: [link_contrato]"
4. "E agora o link da procuração para o advogado representar você: [link_procuracao]"
next_step = "procuracao"

---
FASE 9 — COLETA DE DOCUMENTOS PROBATÓRIOS:
OBJETIVO: Esgotar o lead de TODOS os documentos necessários para provar os fatos alegados.
Analise TODO o contexto da conversa e solicite UMA CATEGORIA POR VEZ. Exemplos relevantes ao caso:
- Contracheques / holerites dos últimos meses
- Extrato do FGTS (app CAIXA Tem ou Caixa Econômica)
- Termo de rescisão (TRCT) se demitido
- Foto das páginas de registro da carteira de trabalho (CTPS)
- Comprovantes de pagamentos extras fora do holerite (se relatado)
- Prints/screenshots de mensagens relevantes (assédio, jornada, acordos)
- Atestados médicos (se acidente ou doença relacionada ao trabalho)
- Qualquer outro documento específico mencionado durante a conversa
next_step = "documentos"

---
FASE 10 — TRANSFERÊNCIA PARA ATENDENTE HUMANO:
Mensagem obrigatória: "Perfeito! Já tenho tudo que preciso. Vou passar seu caso para um dos nossos atendentes que vai dar continuidade. Em breve entrarão em contato. 😊"
next_step = "encerrado" + status = "FINALIZADO"

---
⚠️ TRANSFERÊNCIA IMEDIATA: Se o lead em QUALQUER MOMENTO pedir para falar com atendente humano, transfira IMEDIATAMENTE sem questionar:
"Claro! Estou te transferindo agora para um dos nossos atendentes. Um momento. 😊"
next_step = "encerrado" + status = "FINALIZADO"

# PERGUNTAS FREQUENTES

"Quanto custa?" / "Quais os honorários?" (antes da FASE 7):
→ "Os honorários são apresentados assim que analisarmos o caso completo. Pode ficar tranquilo(a), trabalhamos no modelo de êxito."

"Quanto tempo demora?":
→ "O prazo varia, mas ações trabalhistas costumam levar de 6 meses a 2 anos."

"Vou ganhar?" / "É certeza?":
→ "Não posso garantir resultado, mas pelo que você relatou, existem elementos que normalmente são reconhecidos pela Justiça do Trabalho."

"É de graça?" / "Tem custo inicial?":
→ "O atendimento é gratuito e o escritório trabalha no modelo de êxito — você só paga se ganhar."

# RE-ENGAJAMENTO (lead que voltou após dias)

Se a memória mostra conversa anterior e o lead volta após tempo:
"Oi, {{lead_name}}! Vi que já conversamos sobre [problema da memória]. Quer dar continuidade de onde paramos?"
→ Retomar exatamente da fase em que parou, sem repetir o que já foi coletado.

# SEGURANÇA — GOLPE DO FALSO ADVOGADO
Números oficiais: (82) 99913-0127, (82) 99631-6935, (82) 99639-0799
Se relatar pedido de PIX, alvará, conta bancária ou "causa ganha": Alerta imediato de golpe. Orientar a bloquear e não fazer pagamentos.

# ENDEREÇO: Rua Francisco Rodrigues Viana, 242 — Baixa Grande — Arapiraca/AL

# SAÍDA OBRIGATÓRIA (JSON)

Retorne SOMENTE JSON válido, sem markdown, sem explicações.

{"reply":"texto","updates":{"name":"Nome ou null","status":"QUALIFICANDO | REUNIAO_AGENDADA | AGUARDANDO_FORM | AGUARDANDO_DOCS | AGUARDANDO_PROC | FINALIZADO | PERDIDO","area":"Trabalhista","lead_summary":"resumo factual, nunca vazio","next_step":"duvidas | triagem_concluida | reuniao | entrevista | honorarios | formulario | documentos | procuracao | encerrado | perdido","notes":"obs internas","loss_reason":null,"form_data":{"campo":"valor"}},"scheduling_action":null}

status: deve refletir EXATAMENTE o estágio CRM correspondente ao next_step:
  QUALIFICANDO     → duvidas, triagem_concluida, entrevista, honorarios
  REUNIAO_AGENDADA → reuniao
  AGUARDANDO_FORM  → formulario
  AGUARDANDO_DOCS  → documentos
  AGUARDANDO_PROC  → procuracao
  FINALIZADO       → encerrado
  PERDIDO          → perdido (obrigatoriamente com loss_reason preenchido)

name: se já existir na memória, mantenha sem perguntar. Nunca inventar.
É proibido responder fora do JSON.`,
          model: 'gpt-4.1',
          max_tokens: 800,
          temperature: 0.5,
          handoff_signal: 'ESCALAR_HUMANO',
          active: true,
          order: 1,
          // Skills V2
          description: 'Especialista em direito do trabalho. Avalia viabilidade do caso, coleta a ficha trabalhista completa, solicita documentos, agenda reunião com o advogado e orienta sobre próximos passos.',
          trigger_keywords: ['trabalhista', 'CLT', 'demissão', 'demitido', 'salário', 'FGTS', 'empregador', 'carteira', 'horas extras', 'rescisão', 'férias', 'décimo terceiro', 'acidente de trabalho', 'assédio'],
          skill_type: 'specialist',
          provider: 'openai',
        },
        {
          name: 'Especialista Geral',
          area: 'Geral',
          system_prompt: `# PROMPT — ESPECIALISTA JURÍDICO (FALLBACK MULTIÁREA)
André Lustosa Advogados

Você é Sophia, especialista jurídico do escritório André Lustosa Advogados.
Você atua como ATENDIMENTO TÉCNICO GERAL para áreas que ainda não possuem especialista dedicado, conduzindo:
Esclarecimento de dúvidas, Avaliação jurídica preliminar, Coleta inicial de fatos, Preparação do caso para advogado humano.

Você NÃO revela ser IA, sistema ou automação.

# LIMITAÇÕES ABSOLUTAS

Você NÃO promete resultados. NÃO garante êxito. NÃO informa valores, custos ou honorários. NÃO decide sozinho sobre ajuizamento. NÃO substitui o advogado. NÃO inventa informações. NÃO faz mais de uma pergunta por mensagem.

# OBJETIVO DO ATENDIMENTO

Esclarecer dúvidas objetivamente. Identificar a área do direito. Verificar viabilidade jurídica mínima. Coletar fatos essenciais. Decidir se o caso segue para advogado, exige reunião, ou deve ser encerrado.

# ÁREAS ATENDIDAS

Use apenas uma, quando possível: Consumidor, Família, Previdenciário, Civil, Penal, Empresarial, Imobiliário
Caso não seja possível identificar: null

# CONDUÇÃO DA CONVERSA

Linguagem simples, objetiva, sem juridiquês, sem empatia verbalizada. Uma pergunta por vez.
Responda dúvidas antes de perguntar. Não inicie triagem se o lead só estiver curioso. Só avance quando houver interesse real.

# VIABILIDADE JURÍDICA (ANÁLISE PRELIMINAR)

Considere: Existe fato concreto? Está dentro de prazo razoável? Há indício de prova? A pretensão não é manifestamente inviável?
Se não houver viabilidade: Informe objetivamente. Encerrar com orientação básica. Marcar como Desqualificado.

# TRIAGEM SIMPLIFICADA

Quando houver interesse real: Pergunte fatos principais, datas relevantes, se há provas ou testemunhas, o que o lead espera resolver.

# REUNIÃO / PRÓXIMO PASSO

Após coleta mínima, avalie se é necessário: Reunião presencial (Arapiraca e região), Videoconferência, Ligação telefônica.
Se não for necessário: Encaminhar para análise do advogado.

# SEGURANÇA — GOLPE DO FALSO ADVOGADO
Números oficiais: (82) 99913-0127, (82) 99631-6935, (82) 99639-0799
Se o número do print não for oficial: "⚠️ ALERTA DE GOLPE. Esse contato não é do nosso escritório. Bloqueie o número e não faça pagamentos."

# ENDEREÇO: Rua Francisco Rodrigues Viana, 242 — Baixa Grande — Arapiraca/AL
# VAGAS/ESTÁGIO: Solicitar currículo. Informar banco de talentos. Não agendar entrevistas.

# MEMÓRIA DO CLIENTE (PASSIVA)
{{lead_memory}}
Use apenas para evitar repetição. Não atualizar. Não inferir.

# SAÍDA OBRIGATÓRIA (JSON)

Você NÃO responde diretamente ao lead. Retorne SOMENTE JSON válido, sem markdown e sem explicações.

{"reply":"texto exato para enviar ao lead (1 pergunta ou resposta objetiva)","updates":{"name":"Nome do lead","status":"Em Qualificação | Reunião Agendada | Aguard. Assinatura do Contrato/Procuração | Aguardando Documentos | Desqualificado","area":"Consumidor | Família | Previdenciário | Civil | Penal | Empresarial | Imobiliário | null","lead_summary":"Resumo curto e factual do que o lead informou","next_step":"duvidas | triagem_concluida | formulario | reuniao | encerrado","notes":"observações internas curtas"}}

name: sempre informar explicitamente. Se já existir na memória, mantenha sem perguntar. Nunca inventar nome.

# REGRAS FINAIS

Nunca prometer resultado. Nunca avançar sem viabilidade mínima. Nunca usar termos técnicos desnecessários. Nunca responder fora do JSON.
Você prepara o caso. O advogado decide.
É proibido responder fora do JSON.`,
          model: 'gpt-4.1',
          max_tokens: 500,
          temperature: 0.5,
          handoff_signal: 'ESCALAR_HUMANO',
          active: true,
          order: 10,
          // Skills V2
          description: 'Atendimento técnico para áreas sem especialista dedicado: cível, consumidor, família, previdenciário, imobiliário. Coleta dados do caso, avalia viabilidade básica e agenda reunião.',
          trigger_keywords: ['geral', 'dúvida', 'civil', 'consumidor', 'família', 'previdenciário', 'imobiliário', 'pensão', 'divórcio', 'herança', 'contrato', 'dano moral'],
          skill_type: 'specialist',
          provider: 'openai',
        },
      ];

      // Upsert por name: sincroniza system_prompt e configs do código com o DB.
      // Garante que atualizações nos prompts padrão sejam aplicadas mesmo após o primeiro deploy.
      for (const s of defaultSkills) {
        const existing = await (this.prisma as any).promptSkill.findFirst({ where: { name: s.name } });
        if (existing) {
          await (this.prisma as any).promptSkill.update({
            where: { id: existing.id },
            data: { system_prompt: s.system_prompt, max_tokens: s.max_tokens, model: s.model, temperature: s.temperature },
          });
        } else {
          await (this.prisma as any).promptSkill.create({ data: s });
        }
      }
      skills = await (this.prisma as any).promptSkill.findMany({
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
      });
    }

    return skills.map((s: any) => ({
      id: s.id,
      name: s.name,
      area: s.area,
      systemPrompt: s.system_prompt,
      model: s.model || 'gpt-4o-mini',
      maxTokens: s.max_tokens || 300,
      temperature: s.temperature ?? 0.7,
      handoffSignal: s.handoff_signal || null,
      isActive: s.active,
      order: s.order || 0,
      // Skills V2
      description: s.description || null,
      triggerKeywords: s.trigger_keywords || [],
      skillType: s.skill_type || 'specialist',
      maxContextTokens: s.max_context_tokens || 4000,
      provider: s.provider || 'openai',
      tools: s.tools || [],
      assets: s.assets || [],
    }));
  }

  async toggleSkill(id: string, active: boolean) {
    return (this.prisma as any).promptSkill.update({
      where: { id },
      data: { active },
    });
  }

  async createSkill(data: Record<string, any>) {
    return (this.prisma as any).promptSkill.create({ data });
  }

  async updateSkill(id: string, data: Record<string, any>) {
    return (this.prisma as any).promptSkill.update({ where: { id }, data });
  }

  async deleteSkill(id: string) {
    return (this.prisma as any).promptSkill.delete({ where: { id } });
  }

  // ─── Skill Tools CRUD ────────────────────────────────────────

  async getSkillTools(skillId: string) {
    return (this.prisma as any).skillTool.findMany({
      where: { skill_id: skillId },
      orderBy: { created_at: 'asc' },
    });
  }

  async createSkillTool(skillId: string, data: Record<string, any>) {
    return (this.prisma as any).skillTool.create({
      data: { ...data, skill_id: skillId },
    });
  }

  async updateSkillTool(toolId: string, data: Record<string, any>) {
    return (this.prisma as any).skillTool.update({
      where: { id: toolId },
      data,
    });
  }

  async deleteSkillTool(toolId: string) {
    return (this.prisma as any).skillTool.delete({ where: { id: toolId } });
  }

  // ─── Skill Assets CRUD ───────────────────────────────────────

  async getSkillAssets(skillId: string) {
    return (this.prisma as any).skillAsset.findMany({
      where: { skill_id: skillId },
      orderBy: { created_at: 'asc' },
    });
  }

  async createSkillAsset(skillId: string, data: {
    name: string;
    s3_key: string;
    mime_type: string;
    size: number;
    asset_type: string;
    inject_mode?: string;
    content_text?: string | null;
  }) {
    return (this.prisma as any).skillAsset.create({
      data: { ...data, skill_id: skillId },
    });
  }

  async deleteSkillAsset(assetId: string) {
    const asset = await (this.prisma as any).skillAsset.findUnique({ where: { id: assetId } });
    if (!asset) return null;
    await (this.prisma as any).skillAsset.delete({ where: { id: assetId } });
    return asset; // Return asset so controller can delete from S3
  }

  async findSkillAssetById(assetId: string) {
    return (this.prisma as any).skillAsset.findUnique({ where: { id: assetId } });
  }

  async updateSkillAsset(assetId: string, data: Record<string, any>) {
    return (this.prisma as any).skillAsset.update({
      where: { id: assetId },
      data,
    });
  }

  /** Apaga todas as skills e recria a partir dos defaults do código */
  async resetSkillsToDefaults() {
    await (this.prisma as any).promptSkill.deleteMany({});
    this.logger.log('Skills deletadas — recriando defaults...');
    // getSkills() detecta banco vazio e cria os defaults automaticamente
    const newSkills = await this.getSkills();
    this.logger.log(`${newSkills.length} skills recriadas com defaults atualizados`);
    return { ok: true, count: newSkills.length, skills: newSkills.map((s: any) => ({ name: s.name, model: s.model, area: s.area })) };
  }

  // ── OpenAI Organization API (requer Admin Key) ────────────────────────────

  /**
   * GET /v1/organization/costs — retorna custo real em USD por dia.
   * Documentação: https://platform.openai.com/docs/api-reference/usage/costs
   */
  /** Busca cotação USD→BRL da API pública AwesomeAPI (Banco Central BR). Fallback 5,80. */
  private async fetchUsdToBrl(): Promise<number> {
    try {
      const res = await fetch('https://economia.awesomeapi.com.br/last/USD-BRL', {
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return 5.80;
      const data = (await res.json()) as { USDBRL: { bid: string } };
      const rate = parseFloat(data?.USDBRL?.bid);
      return Number.isFinite(rate) && rate > 0 ? rate : 5.80;
    } catch {
      return 5.80;
    }
  }

  /**
   * GET /v1/organization/usage/completions — tokens por modelo.
   * Retorna uso agrupado por modelo e dia; os custos são calculados via tabela OPENAI_PRICE.
   */
  private async fetchOpenAiUsageByModel(startTs: number, endTs: number, adminKey: string) {
    const params = new URLSearchParams({
      start_time: String(startTs),
      end_time:   String(endTs),
      bucket_width: '1d',
      limit: '31',
    });
    params.append('group_by[]', 'model');
    const res = await fetch(`https://api.openai.com/v1/organization/usage/completions?${params}`, {
      headers: { Authorization: `Bearer ${adminKey}` },
    });
    if (!res.ok) throw new Error(`OpenAI Usage API: HTTP ${res.status}`);
    return res.json() as Promise<{
      data: Array<{
        start_time: number;
        end_time: number;
        results: Array<{
          input_tokens: number;
          output_tokens: number;
          num_model_requests: number;
          model: string | null;
          input_cached_tokens: number;
        }>;
      }>;
      has_more: boolean;
      next_page: string | null;
    }>;
  }

  // ─── Clicksign ──────────────────────────────────────────────────────────────

  async getClicksignConfig() {
    const baseUrl   = await this.get('CLICKSIGN_BASE_URL');
    const apiToken  = await this.get('CLICKSIGN_API_TOKEN');
    const webhookToken = await this.get('CLICKSIGN_WEBHOOK_TOKEN');
    return {
      baseUrl:       baseUrl      || process.env.CLICKSIGN_BASE_URL      || 'https://sandbox.clicksign.com',
      apiToken:      apiToken     || process.env.CLICKSIGN_API_TOKEN      || '',
      webhookToken:  webhookToken || process.env.CLICKSIGN_WEBHOOK_TOKEN  || '',
      isConfigured:  !!(apiToken  || process.env.CLICKSIGN_API_TOKEN),
    };
  }

  async setClicksignConfig(data: {
    baseUrl?: string;
    apiToken?: string;
    webhookToken?: string;
  }) {
    if (data.baseUrl      !== undefined) await this.set('CLICKSIGN_BASE_URL',      data.baseUrl);
    if (data.apiToken     !== undefined) await this.set('CLICKSIGN_API_TOKEN',     data.apiToken);
    if (data.webhookToken !== undefined) await this.set('CLICKSIGN_WEBHOOK_TOKEN', data.webhookToken);
  }

  // ─── Contrato Trabalhista — dados fixos ────────────────────────────────────

  async getContractConfig() {
    const raw = await this.get('CONTRACT_CONFIG');
    const defaults = {
      advogado1_nome:   'André Freire Lustosa',
      advogado1_oab:    'OAB/AL 14.209',
      advogado2_nome:   'Gianny Karla Oliveira Silva',
      advogado2_oab:    'OAB/AL 21.897',
      escritorio_logradouro: 'Rua Francisco Rodrigues Viana, nº 242, bairro Baixa Grande',
      escritorio_cidade: 'Arapiraca/AL',
      escritorio_cep:    '57307-260',
      foro:              'Arapiraca/AL',
      publicApiUrl:      process.env.PUBLIC_API_URL || '',
    };
    if (!raw) return defaults;
    try {
      return { ...defaults, ...JSON.parse(raw) };
    } catch {
      return defaults;
    }
  }

  async setContractConfig(data: Record<string, string>) {
    const current = await this.getContractConfig();
    await this.set('CONTRACT_CONFIG', JSON.stringify({ ...current, ...data }));
  }

  // ─── TTS (Text-to-Speech) ─────────────────────────────────────────────────

  async getTtsConfig() {
    const enabled      = await this.get('TTS_ENABLED');
    const googleApiKey = await this.get('GOOGLE_TTS_API_KEY');
    const voice        = await this.get('TTS_VOICE');
    const language     = await this.get('TTS_LANGUAGE');
    return {
      enabled:      enabled === 'true',
      isConfigured: !!googleApiKey,
      voice:        voice    || 'pt-BR-Neural2-B',
      language:     language || 'pt-BR',
    };
  }

  async setTtsConfig(data: {
    enabled?: boolean;
    googleApiKey?: string;
    voice?: string;
    language?: string;
  }) {
    if (data.enabled !== undefined)  await this.set('TTS_ENABLED',        String(data.enabled));
    if (data.googleApiKey?.trim())   await this.set('GOOGLE_TTS_API_KEY', data.googleApiKey.trim());
    if (data.voice?.trim())          await this.set('TTS_VOICE',          data.voice.trim());
    if (data.language?.trim())       await this.set('TTS_LANGUAGE',       data.language.trim());
  }

  async getAiCosts() {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const start7Days = new Date(startOfToday);
    start7Days.setDate(start7Days.getDate() - 6);

    const prismaAny = this.prisma as any;

    // ── Dados locais (AiUsage) — tabela pode não existir ainda se migration não rodou ──
    let todayAgg: any = { _sum: { cost_usd: 0, total_tokens: 0, prompt_tokens: 0, completion_tokens: 0 }, _count: { id: 0 } };
    let monthAgg: any = { _sum: { cost_usd: 0, total_tokens: 0, prompt_tokens: 0, completion_tokens: 0 }, _count: { id: 0 } };
    let byModel:  any[] = [];
    let byType:   any[] = [];
    let daily:    any[] = [];

    try {
      [todayAgg, monthAgg, byModel, byType, daily] = await Promise.all([
        prismaAny.aiUsage.aggregate({
          _sum: { cost_usd: true, total_tokens: true, prompt_tokens: true, completion_tokens: true },
          _count: { id: true },
          where: { created_at: { gte: startOfToday } },
        }),
        prismaAny.aiUsage.aggregate({
          _sum: { cost_usd: true, total_tokens: true, prompt_tokens: true, completion_tokens: true },
          _count: { id: true },
          where: { created_at: { gte: startOfMonth } },
        }),
        prismaAny.aiUsage.groupBy({
          by: ['model'],
          _sum: { cost_usd: true, total_tokens: true },
          _count: { id: true },
          where: { created_at: { gte: startOfMonth } },
          orderBy: { _sum: { cost_usd: 'desc' } },
        }),
        prismaAny.aiUsage.groupBy({
          by: ['call_type'],
          _sum: { cost_usd: true, total_tokens: true },
          _count: { id: true },
          where: { created_at: { gte: startOfMonth } },
        }),
        prismaAny.aiUsage.groupBy({
          by: ['created_at'],
          _sum: { cost_usd: true, total_tokens: true },
          _count: { id: true },
          where: { created_at: { gte: start7Days } },
          orderBy: { created_at: 'asc' },
        }),
      ]);
    } catch (e: any) {
      // Tabela AiUsage ainda não existe — retorna zerados
      this.logger.warn(`[getAiCosts] Prisma falhou (tabela pode não existir): ${e?.message}`);
    }

    // Agrega últimos 7 dias por data (yyyy-mm-dd)
    const dailyMap: Record<string, { cost_usd: number; total_tokens: number; calls: number }> = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(start7Days);
      d.setDate(d.getDate() + i);
      dailyMap[d.toISOString().slice(0, 10)] = { cost_usd: 0, total_tokens: 0, calls: 0 };
    }
    for (const row of daily) {
      const key = new Date(row.created_at).toISOString().slice(0, 10);
      if (dailyMap[key]) {
        dailyMap[key].cost_usd     += row._sum?.cost_usd     || 0;
        dailyMap[key].total_tokens += row._sum?.total_tokens || 0;
        dailyMap[key].calls        += row._count?.id         || 0;
      }
    }

    // ── Cotação USD→BRL (paralelo) ────────────────────────────────────────────
    const usdToBrl = await this.fetchUsdToBrl();

    // ── Dados reais da OpenAI (Admin Key) ────────────────────────────────────
    const adminKey = await this.get('OPENAI_ADMIN_KEY');

    let openai: {
      configured:           boolean;
      today_usd:            number | null;
      month_usd:            number | null;
      today_calls:          number | null;
      today_input_tokens:   number | null;
      today_output_tokens:  number | null;
      month_calls:          number | null;
      month_input_tokens:   number | null;
      month_output_tokens:  number | null;
      byModel:    Array<{ model: string; input_tokens: number; output_tokens: number; total_tokens: number; calls: number; cached_tokens: number; cost_usd: number }>;
      last7Days:  Array<{ date: string; cost_usd: number }>;
      error:      string | null;
    } = {
      configured: false,
      today_usd: null, month_usd: null,
      today_calls: null, today_input_tokens: null, today_output_tokens: null,
      month_calls: null, month_input_tokens: null, month_output_tokens: null,
      byModel: [], last7Days: [], error: null,
    };

    if (adminKey) {
      openai.configured = true;
      try {
        const startOfTodayTs = Math.floor(startOfToday.getTime() / 1000);
        const startOfMonthTs = Math.floor(startOfMonth.getTime() / 1000);
        const nowTs          = Math.floor(now.getTime() / 1000);

        // Usa apenas a usage API — custos são calculados pela tabela OPENAI_PRICE
        // (a /v1/organization/costs tem delay de billing de até 24h e pode retornar 0)
        const usageResp = await this.fetchOpenAiUsageByModel(startOfMonthTs, nowTs, adminKey);

        let monthUsd = 0, todayUsd = 0;
        let monthCalls = 0, todayCalls = 0;
        let monthIn = 0, monthOut = 0, todayIn = 0, todayOut = 0;

        const modelMap: Record<string, { input: number; output: number; requests: number; cached: number; cost: number }> = {};
        const dayUsdMap: Record<string, number> = {};

        for (const bucket of usageResp.data || []) {
          let bucketUsd = 0, bucketIn = 0, bucketOut = 0, bucketReqs = 0;

          for (const r of bucket.results || []) {
            const model = r.model || 'unknown';
            const cost  = estimateCostUsd(model, r.input_tokens || 0, r.output_tokens || 0);
            bucketUsd  += cost;
            bucketIn   += r.input_tokens        || 0;
            bucketOut  += r.output_tokens       || 0;
            bucketReqs += r.num_model_requests  || 0;
            if (!modelMap[model]) modelMap[model] = { input: 0, output: 0, requests: 0, cached: 0, cost: 0 };
            modelMap[model].input    += r.input_tokens        || 0;
            modelMap[model].output   += r.output_tokens       || 0;
            modelMap[model].requests += r.num_model_requests  || 0;
            modelMap[model].cached   += r.input_cached_tokens || 0;
            modelMap[model].cost     += cost;
          }

          const dayStr = new Date(bucket.start_time * 1000).toISOString().slice(0, 10);
          dayUsdMap[dayStr] = (dayUsdMap[dayStr] || 0) + bucketUsd;

          monthUsd   += bucketUsd;
          monthCalls += bucketReqs;
          monthIn    += bucketIn;
          monthOut   += bucketOut;

          if (bucket.start_time >= startOfTodayTs) {
            todayUsd   += bucketUsd;
            todayCalls += bucketReqs;
            todayIn    += bucketIn;
            todayOut   += bucketOut;
          }
        }

        openai.today_usd           = todayUsd;
        openai.month_usd           = monthUsd;
        openai.today_calls         = todayCalls;
        openai.today_input_tokens  = todayIn;
        openai.today_output_tokens = todayOut;
        openai.month_calls         = monthCalls;
        openai.month_input_tokens  = monthIn;
        openai.month_output_tokens = monthOut;

        openai.byModel = Object.entries(modelMap)
          .map(([model, v]) => ({
            model,
            input_tokens:  v.input,
            output_tokens: v.output,
            total_tokens:  v.input + v.output,
            calls:         v.requests,
            cached_tokens: v.cached,
            cost_usd:      v.cost,
          }))
          .sort((a, b) => b.total_tokens - a.total_tokens);

        // last7Days — 7 entradas fixas (com ou sem dados)
        openai.last7Days = [];
        for (let i = 0; i < 7; i++) {
          const d = new Date(start7Days);
          d.setDate(d.getDate() + i);
          const key = d.toISOString().slice(0, 10);
          openai.last7Days.push({ date: key, cost_usd: dayUsdMap[key] || 0 });
        }
      } catch (e: any) {
        openai.error = e?.message || 'Erro ao consultar OpenAI';
      }
    }

    return {
      usd_to_brl: usdToBrl,
      openai,
      today: {
        cost_usd:          todayAgg._sum.cost_usd          || 0,
        total_tokens:      todayAgg._sum.total_tokens      || 0,
        prompt_tokens:     todayAgg._sum.prompt_tokens     || 0,
        completion_tokens: todayAgg._sum.completion_tokens || 0,
        calls:             todayAgg._count.id              || 0,
      },
      month: {
        cost_usd:          monthAgg._sum.cost_usd          || 0,
        total_tokens:      monthAgg._sum.total_tokens      || 0,
        prompt_tokens:     monthAgg._sum.prompt_tokens     || 0,
        completion_tokens: monthAgg._sum.completion_tokens || 0,
        calls:             monthAgg._count.id              || 0,
      },
      byModel: byModel.map((r: any) => ({
        model:        r.model,
        cost_usd:     r._sum.cost_usd     || 0,
        total_tokens: r._sum.total_tokens || 0,
        calls:        r._count.id         || 0,
      })),
      byType: byType.map((r: any) => ({
        call_type:    r.call_type,
        cost_usd:     r._sum.cost_usd     || 0,
        total_tokens: r._sum.total_tokens || 0,
        calls:        r._count.id         || 0,
      })),
      last7Days: Object.entries(dailyMap).map(([date, v]) => ({ date, ...v })),
    };
  }
}
