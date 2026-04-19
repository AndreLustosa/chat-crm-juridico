/**
 * Helper para migrar prompts de skills existentes — injeta as variaveis do
 * sistema de memoria sem tocar no resto do texto.
 *
 * Seguro: so ADICIONA o header no topo se ainda nao estiver presente.
 * Idempotente: roda varias vezes sem cumulate.
 * Nao remove, nao reescreve, nao altera o corpo da skill.
 */

export const MEMORY_HEADER_BLOCK = `## Contexto do Escritório
{{office_memories}}

## Perfil do Cliente
{{lead_profile}}

## Interações Recentes
{{recent_episodes}}

---

`;

/**
 * Marker detectado para considerar que a skill ja foi migrada.
 * Se o prompt contem QUALQUER uma das variaveis novas, pula.
 */
const ALREADY_MIGRATED_MARKERS = [
  '{{office_memories}}',
  '{{lead_profile}}',
  '{{recent_episodes}}',
  '{{memory_block}}',
];

export interface MigrationResult {
  updated: string;
  changed: boolean;
  reason?: 'already_migrated' | 'header_prepended';
}

/**
 * Aplica a migracao em um prompt. Retorna o novo texto + flag indicando se
 * houve mudanca. Idempotente.
 */
export function applyMemoryVarsMigration(prompt: string): MigrationResult {
  if (!prompt || typeof prompt !== 'string') {
    return { updated: prompt, changed: false, reason: 'already_migrated' };
  }
  const alreadyHas = ALREADY_MIGRATED_MARKERS.some((m) => prompt.includes(m));
  if (alreadyHas) {
    return { updated: prompt, changed: false, reason: 'already_migrated' };
  }
  return {
    updated: MEMORY_HEADER_BLOCK + prompt,
    changed: true,
    reason: 'header_prepended',
  };
}
