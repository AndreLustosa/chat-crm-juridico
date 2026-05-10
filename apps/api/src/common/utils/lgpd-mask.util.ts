/**
 * Mascara dados pessoais antes de enviar pra provider IA externo
 * (OpenAI, Anthropic).
 *
 * Bug fix 2026-05-10 (Peticoes PR1 #5):
 * Antes prompts continham CPF/RG/endereco/salario em plaintext em
 * api.openai.com — provider US sem DPA assinado, sem registro de
 * consentimento. Multa ANPD direta + risco reputacional.
 *
 * Estrategia:
 *   - Default: mascara fields sensiveis (xxx.xxx.xxx-12)
 *   - lgpdConsent=true: passa raw (advogado confirmou na UI)
 *
 * Mascaras preservam ULTIMOS 2-4 digitos pra IA contextualizar
 * sem expor dado completo (mais util que xxx puro).
 */

/** CPF: 12345678901 → ***********01 ou xxx.xxx.xxx-01 */
export function maskCpf(cpf: string | null | undefined): string {
  if (!cpf) return '';
  const digits = String(cpf).replace(/\D/g, '');
  if (digits.length !== 11) return '[CPF invalido]';
  return `xxx.xxx.xxx-${digits.slice(-2)}`;
}

/** CNPJ: 12345678000123 → xx.xxx.xxx/0001-23 */
export function maskCnpj(cnpj: string | null | undefined): string {
  if (!cnpj) return '';
  const digits = String(cnpj).replace(/\D/g, '');
  if (digits.length !== 14) return '[CNPJ invalido]';
  return `xx.xxx.xxx/${digits.slice(8, 12)}-${digits.slice(-2)}`;
}

/** RG: 123456789 → xxxxxxx-89 */
export function maskRg(rg: string | null | undefined): string {
  if (!rg) return '';
  const digits = String(rg).replace(/\D/g, '');
  if (digits.length < 4) return '[RG invalido]';
  return `xxxxxx${digits.slice(-2)}`;
}

/** Endereco completo → "Rua [omitido], no [omitido], Bairro X, Cidade Y/UF" */
export function maskAddress(address: string | null | undefined): string {
  if (!address) return '';
  // Tenta preservar bairro/cidade/UF, omite rua + numero
  // Formato comum: "Rua A, 123, Bairro B, Cidade C/UF, CEP 12345-678"
  const parts = String(address).split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length < 3) return '[endereco omitido]';
  // Mantem do indice 2 em diante (bairro, cidade, UF) — primeiros 2 sao rua + numero
  return `[Rua/Numero omitidos], ${parts.slice(2).join(', ')}`;
}

/** Salario: "R$ 5000,00" → "R$ 5.000 (faixa 4-6k)" pra IA contextualizar sem valor exato */
export function maskSalary(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const num = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^\d.,-]/g, '').replace(',', '.'));
  if (Number.isNaN(num)) return '[salario invalido]';
  // Faixa de R$ 1k pra preservar contexto sem valor exato
  const lower = Math.floor(num / 1000) * 1000;
  const upper = lower + 1000;
  return `[faixa salarial R$ ${lower.toLocaleString('pt-BR')}-${upper.toLocaleString('pt-BR')}]`;
}

/** Telefone: 5582999887766 → +55 82 9****-7766 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 8) return '[telefone invalido]';
  return `${digits.slice(0, 4)}****${digits.slice(-4)}`;
}

/** Email: joao.silva@example.com → j****@example.com */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return '';
  const [local, domain] = String(email).split('@');
  if (!domain) return '[email invalido]';
  const maskedLocal = local.length > 1 ? `${local[0]}****` : '*';
  return `${maskedLocal}@${domain}`;
}

/**
 * Aplica mascara em dict de campos comuns. Use quando construir
 * prompt pra IA com dados de Lead/Ficha/CaseHonorario.
 */
export interface PiiData {
  cpf?: string | null;
  cnpj?: string | null;
  rg?: string | null;
  endereco?: string | null;
  salario?: number | string | null;
  telefone?: string | null;
  email?: string | null;
}

export function maskPii(data: PiiData, lgpdConsent = false): PiiData {
  if (lgpdConsent) {
    // Advogado deu consent explicito — passa raw
    return data;
  }
  return {
    cpf: data.cpf ? maskCpf(data.cpf) : data.cpf,
    cnpj: data.cnpj ? maskCnpj(data.cnpj) : data.cnpj,
    rg: data.rg ? maskRg(data.rg) : data.rg,
    endereco: data.endereco ? maskAddress(data.endereco) : data.endereco,
    salario: data.salario ? maskSalary(data.salario) : data.salario,
    telefone: data.telefone ? maskPhone(data.telefone) : data.telefone,
    email: data.email ? maskEmail(data.email) : data.email,
  };
}
