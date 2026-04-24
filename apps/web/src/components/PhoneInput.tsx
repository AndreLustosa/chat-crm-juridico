'use client';

import { forwardRef, useCallback, type InputHTMLAttributes } from 'react';

/**
 * PhoneInput — input de telefone com mascara visual brasileira.
 *
 * Comportamento:
 *   - O usuario digita `82999130127` ou `(82) 9 9913-0127` — o componente
 *     mostra sempre formatado: `82 99913-0127` ou `82 9913-0127`.
 *   - O `value` da prop deve ser RAW digits (ou vazio). O `onChange` devolve
 *     sempre RAW digits (so numeros).
 *   - Ao colar um telefone de qualquer formato (com DDI, com parentese, etc),
 *     extrai os digitos automaticamente.
 *
 * O backend normaliza pro formato canonico (55+DDD+8dig) via
 * toCanonicalBrPhone. Aqui nao tentamos canonizar — apenas mostrar bonito.
 *
 * Criado em 2026-04-24 pra unificar inputs de telefone em todos os modais
 * de cadastro (Cadastro Direto, DJEN, Novo Contato, cadastro de User).
 */
type PhoneInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: string;
  onChange: (rawDigits: string) => void;
};

/**
 * Formata `d` (so digitos) pra exibicao humana conforme o tamanho.
 * Exemplos:
 *   ""             -> ""
 *   "82"           -> "82 "
 *   "829"          -> "82 9"
 *   "8299"         -> "82 9299"        (nao tem hifen ainda)
 *   "82999913012"  -> "82 99999-1301"  (11 digitos)
 *   "8299991301"   -> "82 9999-1301"   (10 digitos — fixo antigo)
 *   "5582999130127"-> "+55 82 99913-0127"
 */
export function formatBrPhoneInput(raw: string): string {
  const d = (raw || '').replace(/\D/g, '');
  if (!d) return '';

  // Remove DDI 55 pra mascara local (mostramos em um prefixo separado se quiser)
  let rest = d;
  let prefix = '';
  if (d.length > 11 && d.startsWith('55')) {
    prefix = '+55 ';
    rest = d.substring(2);
  }

  if (rest.length <= 2) {
    return `${prefix}${rest}`;
  }
  const ddd = rest.substring(0, 2);
  const tail = rest.substring(2);

  // Celular com 9 digitos (9XXXX-XXXX) ou sem 9 (XXXX-XXXX)
  if (tail.length <= 4) {
    return `${prefix}${ddd} ${tail}`;
  }
  if (tail.length <= 8) {
    // 4+até4: 9913-0127 ou 99-9913
    const firstPart = tail.substring(0, tail.length - 4);
    const lastPart = tail.substring(tail.length - 4);
    return `${prefix}${ddd} ${firstPart}-${lastPart}`;
  }
  // 9 digitos: 9 9913-0127
  if (tail.length === 9) {
    return `${prefix}${ddd} ${tail.substring(0, 5)}-${tail.substring(5)}`;
  }
  // >9: corta em 5-4 pros ultimos 9
  return `${prefix}${ddd} ${tail.substring(0, tail.length - 4)}-${tail.substring(tail.length - 4)}`;
}

export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(
  function PhoneInput({ value, onChange, ...rest }, ref) {
    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const digits = e.target.value.replace(/\D/g, '');
        onChange(digits);
      },
      [onChange],
    );

    return (
      <input
        {...rest}
        ref={ref}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={formatBrPhoneInput(value || '')}
        onChange={handleChange}
        placeholder={rest.placeholder ?? '(82) 9 9913-0127'}
      />
    );
  },
);
