import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPhone(phone: string | null | undefined) {
  if (!phone) return '-';

  // Limpa tudo que não for número
  let cleaned = phone.replace(/\D/g, '');

  // Remove o prefixo 55 se existir
  if (cleaned.startsWith('55') && cleaned.length > 10) {
    cleaned = cleaned.substring(2);
  }

  // Formata DDD + Número (Brasil)
  if (cleaned.length === 11) {
    // Celular com 9 dígitos: (XX) 9 XXXX-XXXX
    return `(${cleaned.substring(0, 2)}) ${cleaned.substring(2, 3)} ${cleaned.substring(3, 7)}-${cleaned.substring(7)}`;
  } else if (cleaned.length === 10) {
    // Armazenado sem nono dígito: exibe como (XX) XXXX-XXXX
    return `(${cleaned.substring(0, 2)}) ${cleaned.substring(2, 6)}-${cleaned.substring(6)}`;
  }

  // Fallback para outros formatos ou internacional sem 55
  return cleaned;
}
