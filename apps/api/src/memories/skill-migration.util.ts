/**
 * Helper para migrar prompts de skills existentes — injeta as variaveis do
 * sistema de memoria com INSTRUCOES explicando como usar.
 *
 * Seguro e idempotente:
 *   - Detecta o header ANTIGO (versao "nua" sem instrucoes) e substitui pelo NOVO.
 *   - Se skill foi editada manualmente pelo admin (variaveis presentes fora do
 *     header padrao), preserva — nao sobrescreve trabalho humano.
 *   - Se skill nao tem variaveis → prepend do novo header.
 */

/**
 * Header NOVO — com instrucoes contextualizadas. Resolve o problema de
 * "variaveis nuas sem orientacao" que deixava a IA confusa sobre quando usar.
 */
export const MEMORY_HEADER_BLOCK = `# CONTEXTO DE REFERÊNCIA (leia antes de responder)

Você tem acesso a 3 fontes de informação abaixo. CONSULTE-AS SEMPRE antes de qualquer resposta:

## 🏛️ Sobre nosso escritório
Use quando o cliente perguntar sobre endereço, telefone, horário de atendimento, equipe, honorários, fóruns, procedimentos ou qualquer dado institucional. NÃO invente — responda apenas com base no que está aqui. Se a informação não estiver nesta seção, diga que precisa confirmar internamente.
{{office_memories}}

## 👤 Quem é este cliente
Perfil consolidado com tudo que já sabemos sobre ele (nome, caso, documentos enviados, preferências, pendências). LEIA ANTES de fazer qualquer pergunta — se a resposta já estiver aqui, NÃO pergunte de novo. Use para personalizar o tom e referenciar informações passadas naturalmente. Se o cliente perguntar sobre os próprios dados (nome, telefone, email), CONFIRME usando o bloco "IDENTIDADE DO CONTATO ATUAL" das regras técnicas — nunca ignore a pergunta nem diga "não sei".
{{lead_profile}}

## 🕒 Últimas interações
Eventos recentes registrados na conversa (documentos enviados, dúvidas específicas, compromissos agendados). Referencie naturalmente quando fizer sentido: "como você me mandou semana passada...", "sobre aquele documento que você enviou...". Só cite se for relevante ao contexto atual.
{{recent_episodes}}

---

`;

/**
 * Header ANTIGO — versao "nua" sem instrucoes. Usado pela primeira versao
 * do endpoint de migracao. Detectamos pela string exata para upgrade idempotente.
 */
const OLD_MEMORY_HEADER_BLOCK = `## Contexto do Escritório
{{office_memories}}

## Perfil do Cliente
{{lead_profile}}

## Interações Recentes
{{recent_episodes}}

---

`;

export interface MigrationResult {
  updated: string;
  changed: boolean;
  reason?: 'up_to_date' | 'header_prepended' | 'header_upgraded' | 'custom_preserved';
}

/**
 * Aplica a migracao em um prompt. Retorna o novo texto + flag indicando se
 * houve mudanca. Idempotente.
 *
 * Casos:
 *   1. Prompt comeca com OLD_HEADER → substitui por NEW_HEADER (upgrade)
 *   2. Prompt comeca com NEW_HEADER → nada a fazer (up-to-date)
 *   3. Prompt tem variaveis de memoria mas nao comeca com nenhum header padrao
 *      → preservado (admin editou manualmente, nao tocar)
 *   4. Prompt nao tem variaveis → prepend NEW_HEADER
 */
export function applyMemoryVarsMigration(prompt: string): MigrationResult {
  if (!prompt || typeof prompt !== 'string') {
    return { updated: prompt, changed: false, reason: 'up_to_date' };
  }

  // Caso 2: ja esta no formato novo
  if (prompt.startsWith(MEMORY_HEADER_BLOCK)) {
    return { updated: prompt, changed: false, reason: 'up_to_date' };
  }

  // Caso 1: esta no formato antigo → upgrade
  if (prompt.startsWith(OLD_MEMORY_HEADER_BLOCK)) {
    const body = prompt.substring(OLD_MEMORY_HEADER_BLOCK.length);
    return {
      updated: MEMORY_HEADER_BLOCK + body,
      changed: true,
      reason: 'header_upgraded',
    };
  }

  // Caso 3: tem variaveis fora do header padrao (edicao manual)
  const MEMORY_VAR_MARKERS = ['{{office_memories}}', '{{lead_profile}}', '{{recent_episodes}}', '{{memory_block}}'];
  const hasAnyVar = MEMORY_VAR_MARKERS.some((m) => prompt.includes(m));
  if (hasAnyVar) {
    return { updated: prompt, changed: false, reason: 'custom_preserved' };
  }

  // Caso 4: prompt cru, sem variaveis → prepend
  return {
    updated: MEMORY_HEADER_BLOCK + prompt,
    changed: true,
    reason: 'header_prepended',
  };
}
