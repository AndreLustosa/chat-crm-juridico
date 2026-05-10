/**
 * Validacao real de CPF e CNPJ via algoritmo modulo 11 (Receita Federal).
 *
 * Bug fix 2026-05-10 (Honorarios PR4 #25): antes financial-dashboard.service
 * inlineCpf validava so length (11 ou 14 digitos). Lead cadastrava
 * "11111111111" e o sistema aceitava. Asaas rejeitava na criacao de
 * customer com erro generico, advogado nao entendia.
 */

/** Remove tudo que nao for digito */
function onlyDigits(s: string): string {
  return (s || '').replace(/\D/g, '');
}

/** Calcula digito verificador via algoritmo modulo 11 */
function mod11Digit(digits: string, weights: number[]): number {
  const sum = digits.split('').reduce((acc, d, i) => acc + parseInt(d, 10) * weights[i], 0);
  const rem = sum % 11;
  return rem < 2 ? 0 : 11 - rem;
}

/**
 * Valida CPF (11 digitos). Rejeita sequencias repetidas tipo "11111111111".
 *
 * Algoritmo:
 *   1. 11 digitos numericos
 *   2. Nao todos iguais
 *   3. Digito 10 calculado dos 9 primeiros (pesos 10..2)
 *   4. Digito 11 calculado dos 10 primeiros (pesos 11..2)
 *   5. Ambos batem com os digitos enviados
 */
export function isValidCPF(input: string): boolean {
  const cpf = onlyDigits(input);
  if (cpf.length !== 11) return false;
  // Sequencias repetidas (11111..., 22222..., 00000...) sao matematicamente
  // validas mas nunca sao CPF real. Receita rejeita.
  if (/^(\d)\1+$/.test(cpf)) return false;

  const d1 = mod11Digit(cpf.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (d1 !== parseInt(cpf[9], 10)) return false;

  const d2 = mod11Digit(cpf.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (d2 !== parseInt(cpf[10], 10)) return false;

  return true;
}

/**
 * Valida CNPJ (14 digitos).
 *
 * Algoritmo (pesos diferentes do CPF):
 *   1. 14 digitos numericos
 *   2. Nao todos iguais
 *   3. Digito 13 calculado dos 12 primeiros (pesos 5,4,3,2,9,8,7,6,5,4,3,2)
 *   4. Digito 14 calculado dos 13 primeiros (pesos 6,5,4,3,2,9,8,7,6,5,4,3,2)
 */
export function isValidCNPJ(input: string): boolean {
  const cnpj = onlyDigits(input);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1+$/.test(cnpj)) return false;

  const d1 = mod11Digit(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (d1 !== parseInt(cnpj[12], 10)) return false;

  const d2 = mod11Digit(cnpj.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (d2 !== parseInt(cnpj[13], 10)) return false;

  return true;
}

/** Aceita CPF (11) ou CNPJ (14). Util pra campos genericos cpf_cnpj. */
export function isValidCpfOrCnpj(input: string): boolean {
  const digits = onlyDigits(input);
  if (digits.length === 11) return isValidCPF(digits);
  if (digits.length === 14) return isValidCNPJ(digits);
  return false;
}
