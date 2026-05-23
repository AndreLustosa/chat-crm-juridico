/**
 * Catálogo de planos do SaaS (Fase 2). Fonte ÚNICA de verdade — exposto por
 * GET /plans para o frontend renderizar o seletor, e usado no checkout (preço
 * da assinatura Asaas) e nos limites de uso (processos / IA).
 *
 * Dois eixos: quantidade de processos × IA (on/off). "Demais planos depois" —
 * o catálogo é só acrescentar entradas aqui.
 *
 * Tenant.plan guarda o `code`; limites são DERIVADOS daqui (getPlan), nunca
 * duplicados no banco.
 */
export interface SaasPlan {
  /** Código salvo em Tenant.plan. */
  code: string;
  name: string;
  /** Limite de processos (LegalCase) do plano. */
  processos_limit: number;
  /** Libera os recursos de IA? */
  ai_enabled: boolean;
  /** Preço mensal em BRL (valor enviado ao Asaas). */
  price: number;
  /** Rótulo pronto para UI. */
  price_label: string;
  description: string;
  /** Ordem de exibição no seletor. */
  order: number;
}

export const SAAS_PLANS: SaasPlan[] = [
  {
    code: 'P100',
    name: '100 processos',
    processos_limit: 100,
    ai_enabled: false,
    price: 49.9,
    price_label: 'R$ 49,90',
    description: 'Até 100 processos. Gestão completa, sem recursos de IA.',
    order: 1,
  },
  {
    code: 'P100_IA',
    name: '100 processos + IA',
    processos_limit: 100,
    ai_enabled: true,
    price: 89.9,
    price_label: 'R$ 89,90',
    description: 'Até 100 processos, com inteligência artificial inclusa.',
    order: 2,
  },
  {
    code: 'P200',
    name: '200 processos',
    processos_limit: 200,
    ai_enabled: false,
    price: 89.9,
    price_label: 'R$ 89,90',
    description: 'Até 200 processos. Gestão completa, sem recursos de IA.',
    order: 3,
  },
  {
    code: 'P200_IA',
    name: '200 processos + IA',
    processos_limit: 200,
    ai_enabled: true,
    price: 139.9,
    price_label: 'R$ 139,90',
    description: 'Até 200 processos, com inteligência artificial inclusa.',
    order: 4,
  },
];

/** Resolve o plano pelo código salvo em Tenant.plan. null se desconhecido/ausente. */
export function getPlan(code?: string | null): SaasPlan | null {
  if (!code) return null;
  return SAAS_PLANS.find((p) => p.code === code) ?? null;
}

/** Catálogo ordenado para exibição. */
export function listPlans(): SaasPlan[] {
  return [...SAAS_PLANS].sort((a, b) => a.order - b.order);
}
