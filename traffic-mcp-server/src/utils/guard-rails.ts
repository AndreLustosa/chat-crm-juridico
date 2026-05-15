/**
 * Guard-rails operacionais pra impedir o Claude de fazer estrago via MCP.
 *
 * Por que aqui e nao no CRM:
 *   - O CRM ja tem auditoria + concurrency:1 + validacao OAB. Esses sao
 *     guard-rails de DOMINIO (qualidade do mutate em si).
 *   - Estes aqui sao guard-rails de USO (frequencia, magnitude, kill-switch).
 *     Vivem no MCP porque o MCP eh quem expoe a superficie pro Claude.
 *
 * Estado em memoria do processo:
 *   - rate limit por janela rolante de 1h, contador in-memory
 *   - kill-switch via env var (lida em cada chamada — admin pode mudar via
 *     redeploy/restart sem recompile)
 *
 * Trade-off: se rodarmos varias instancias do MCP no futuro, o rate limit
 * fica per-instance. Por enquanto eh single-instance no docker-compose, ok.
 */

import { logger } from './logger.js';

type Bucket = {
  windowStart: number;
  count: number;
};

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1h

const mutateBuckets = new Map<string, Bucket>();

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw.toLowerCase() === 'true' || raw === '1';
}

export type GuardRailViolation = {
  rule: 'kill_switch' | 'rate_limit' | 'budget_delta_cap' | 'budget_hard_cap' | 'requires_confirmation';
  message: string;
  details?: Record<string, unknown>;
};

export class GuardRailError extends Error {
  readonly violation: GuardRailViolation;

  constructor(violation: GuardRailViolation) {
    super(violation.message);
    this.name = 'GuardRailError';
    this.violation = violation;
  }
}

/**
 * Bloqueia toda tool de mutate quando MCP_KILL_SWITCH=true. Util pra paradinhas
 * de emergencia sem precisar derrubar o container (Claude continua podendo ler).
 */
export function checkKillSwitch(toolName: string): void {
  if (envBool('MCP_KILL_SWITCH', false)) {
    const violation: GuardRailViolation = {
      rule: 'kill_switch',
      message:
        'Gestao autonoma de trafego desativada (MCP_KILL_SWITCH=true). Use o painel do CRM pra agir manualmente.',
      details: { tool: toolName },
    };
    logger.warn('guard_rail_block', { ...violation, tool: toolName });
    throw new GuardRailError(violation);
  }
}

/**
 * Rate limit por chave (geralmente "user_id" extraido do token, ou "global"
 * se nao houver). Janela rolante simples — contador zera apos 1h sem chamadas.
 */
export function checkRateLimit(toolName: string, key = 'global'): void {
  const max = envInt('MCP_MUTATE_RATE_LIMIT_PER_HOUR', 60);
  const now = Date.now();
  const bucket = mutateBuckets.get(key);

  if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
    mutateBuckets.set(key, { windowStart: now, count: 1 });
    return;
  }

  if (bucket.count >= max) {
    const violation: GuardRailViolation = {
      rule: 'rate_limit',
      message: `Limite de ${max} mutates/hora atingido. Aguarde antes de novas alteracoes.`,
      details: { tool: toolName, key, count: bucket.count, max },
    };
    logger.warn('guard_rail_block', { ...violation, tool: toolName });
    throw new GuardRailError(violation);
  }

  bucket.count += 1;
}

/**
 * Verifica se um update_budget cabe nos limites configurados:
 *   - delta percentual maximo (default 50% do budget atual)
 *   - hard cap em BRL/dia (default 1000)
 * Quando o delta excede o limite "soft", exige `confirm: true` no input.
 */
export function checkBudgetChange(params: {
  toolName: string;
  currentBrl: number | undefined;
  newBrl: number;
  confirmed: boolean;
}): void {
  const { toolName, currentBrl, newBrl, confirmed } = params;
  const hardCap = envFloat('MCP_BUDGET_DAILY_HARD_CAP_BRL', 1000);
  const deltaPercentMax = envFloat('MCP_BUDGET_CHANGE_MAX_PERCENT', 50);
  const requireConfirmAbove = envFloat('MCP_BUDGET_REQUIRE_CONFIRM_PERCENT', 30);

  if (newBrl <= 0) {
    throw new GuardRailError({
      rule: 'budget_delta_cap',
      message: 'Budget diario tem que ser positivo.',
      details: { tool: toolName, new_brl: newBrl },
    });
  }

  if (newBrl > hardCap) {
    const violation: GuardRailViolation = {
      rule: 'budget_hard_cap',
      message: `Budget diario solicitado (R$ ${newBrl.toFixed(2)}) excede o hard cap configurado (R$ ${hardCap.toFixed(2)}). Para aumentar o cap, ajuste MCP_BUDGET_DAILY_HARD_CAP_BRL no servidor.`,
      details: { tool: toolName, new_brl: newBrl, cap_brl: hardCap },
    };
    logger.warn('guard_rail_block', { ...violation, tool: toolName });
    throw new GuardRailError(violation);
  }

  if (currentBrl === undefined || currentBrl <= 0) {
    // Sem budget anterior conhecido — nao da pra calcular delta. Permite,
    // mas loga pra observabilidade.
    logger.info('guard_rail_pass', {
      tool: toolName,
      reason: 'no_baseline_for_delta',
      new_brl: newBrl,
    });
    return;
  }

  const deltaPercent = Math.abs((newBrl - currentBrl) / currentBrl) * 100;

  if (deltaPercent > deltaPercentMax) {
    const violation: GuardRailViolation = {
      rule: 'budget_delta_cap',
      message: `Mudanca de ${deltaPercent.toFixed(1)}% no budget excede o teto de ${deltaPercentMax}% por operacao. Faca em passos menores ou ajuste MCP_BUDGET_CHANGE_MAX_PERCENT.`,
      details: { tool: toolName, current_brl: currentBrl, new_brl: newBrl, delta_percent: deltaPercent, max_percent: deltaPercentMax },
    };
    logger.warn('guard_rail_block', { ...violation, tool: toolName });
    throw new GuardRailError(violation);
  }

  if (deltaPercent > requireConfirmAbove && !confirmed) {
    const violation: GuardRailViolation = {
      rule: 'requires_confirmation',
      message: `Mudanca de ${deltaPercent.toFixed(1)}% no budget exige confirmacao explicita. Re-envie a tool com confirm=true se a magnitude estiver correta.`,
      details: { tool: toolName, current_brl: currentBrl, new_brl: newBrl, delta_percent: deltaPercent, threshold_percent: requireConfirmAbove },
    };
    logger.warn('guard_rail_block', { ...violation, tool: toolName });
    throw new GuardRailError(violation);
  }
}

/**
 * Reset usado em testes — nao chamar em runtime.
 */
export function _resetForTests(): void {
  mutateBuckets.clear();
}
