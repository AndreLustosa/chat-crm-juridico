import { afterEach, beforeEach, describe, expect, test } from 'vitest';

// Setup envs antes do import — config.ts requires MCP_AUTH_TOKEN
process.env.MCP_AUTH_TOKEN = 'test-mcp-token';
process.env.CRM_API_URL = 'http://crm.test/api';
process.env.CRM_API_KEY = 'test-crm-token';

const {
  GuardRailError,
  checkBudgetChange,
  checkKillSwitch,
  checkRateLimit,
  _resetForTests,
} = await import('../../src/utils/guard-rails.js');

beforeEach(() => {
  _resetForTests();
  delete process.env.MCP_KILL_SWITCH;
  delete process.env.MCP_MUTATE_RATE_LIMIT_PER_HOUR;
  delete process.env.MCP_BUDGET_DAILY_HARD_CAP_BRL;
  delete process.env.MCP_BUDGET_CHANGE_MAX_PERCENT;
  delete process.env.MCP_BUDGET_REQUIRE_CONFIRM_PERCENT;
});

afterEach(() => {
  _resetForTests();
});

describe('checkKillSwitch', () => {
  test('passa quando flag false (default)', () => {
    expect(() => checkKillSwitch('traffic_pause_campaign')).not.toThrow();
  });

  test('bloqueia quando flag true', () => {
    process.env.MCP_KILL_SWITCH = 'true';
    expect(() => checkKillSwitch('traffic_pause_campaign')).toThrow(GuardRailError);
  });

  test('aceita "1" como true', () => {
    process.env.MCP_KILL_SWITCH = '1';
    expect(() => checkKillSwitch('traffic_pause_campaign')).toThrow(GuardRailError);
  });
});

describe('checkRateLimit', () => {
  test('permite ate o limite e bloqueia quando excede', () => {
    process.env.MCP_MUTATE_RATE_LIMIT_PER_HOUR = '3';
    expect(() => checkRateLimit('tool', 'user-A')).not.toThrow();
    expect(() => checkRateLimit('tool', 'user-A')).not.toThrow();
    expect(() => checkRateLimit('tool', 'user-A')).not.toThrow();
    expect(() => checkRateLimit('tool', 'user-A')).toThrow(GuardRailError);
  });

  test('buckets sao isolados por chave', () => {
    process.env.MCP_MUTATE_RATE_LIMIT_PER_HOUR = '2';
    expect(() => checkRateLimit('tool', 'user-A')).not.toThrow();
    expect(() => checkRateLimit('tool', 'user-A')).not.toThrow();
    // user-B fresh — nao bloqueia
    expect(() => checkRateLimit('tool', 'user-B')).not.toThrow();
    // user-A ja no limite
    expect(() => checkRateLimit('tool', 'user-A')).toThrow(GuardRailError);
  });
});

describe('checkBudgetChange', () => {
  test('hard cap rejeita budget acima do teto', () => {
    process.env.MCP_BUDGET_DAILY_HARD_CAP_BRL = '500';
    expect(() =>
      checkBudgetChange({
        toolName: 't',
        currentBrl: 100,
        newBrl: 600,
        confirmed: true,
      }),
    ).toThrow(/hard cap/);
  });

  test('delta cap rejeita mudanca > MAX_PERCENT', () => {
    process.env.MCP_BUDGET_CHANGE_MAX_PERCENT = '30';
    expect(() =>
      checkBudgetChange({
        toolName: 't',
        currentBrl: 100,
        newBrl: 200, // +100%
        confirmed: true,
      }),
    ).toThrow(/teto de 30%/);
  });

  test('exige confirm quando delta entre threshold e cap', () => {
    process.env.MCP_BUDGET_REQUIRE_CONFIRM_PERCENT = '20';
    process.env.MCP_BUDGET_CHANGE_MAX_PERCENT = '50';
    expect(() =>
      checkBudgetChange({
        toolName: 't',
        currentBrl: 100,
        newBrl: 130, // +30%, entre 20 e 50
        confirmed: false,
      }),
    ).toThrow(/confirmacao explicita/);
  });

  test('passa quando delta dentro do confirm threshold', () => {
    process.env.MCP_BUDGET_REQUIRE_CONFIRM_PERCENT = '30';
    expect(() =>
      checkBudgetChange({
        toolName: 't',
        currentBrl: 100,
        newBrl: 110,
        confirmed: false,
      }),
    ).not.toThrow();
  });

  test('rejeita budget zero ou negativo', () => {
    expect(() =>
      checkBudgetChange({ toolName: 't', currentBrl: 100, newBrl: 0, confirmed: true }),
    ).toThrow(/positivo/);
    expect(() =>
      checkBudgetChange({ toolName: 't', currentBrl: 100, newBrl: -5, confirmed: true }),
    ).toThrow(/positivo/);
  });

  test('sem baseline, valida apenas hard cap', () => {
    process.env.MCP_BUDGET_DAILY_HARD_CAP_BRL = '500';
    expect(() =>
      checkBudgetChange({
        toolName: 't',
        currentBrl: undefined,
        newBrl: 200,
        confirmed: false,
      }),
    ).not.toThrow();
    expect(() =>
      checkBudgetChange({
        toolName: 't',
        currentBrl: undefined,
        newBrl: 600,
        confirmed: true,
      }),
    ).toThrow(/hard cap/);
  });
});
