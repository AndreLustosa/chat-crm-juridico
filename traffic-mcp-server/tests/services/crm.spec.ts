import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import nock from 'nock';

// Setup envs ANTES do import do config — config.ts roda dotenv + required() at import.
process.env.MCP_AUTH_TOKEN = 'test-mcp-token';
process.env.MCP_PORT = '3199';
process.env.TRAFFIC_MCP_MODE = 'crm';
process.env.CRM_API_URL = 'http://crm.test/api';
process.env.CRM_API_KEY = 'test-crm-token';
process.env.CACHE_TTL_MS = '60000';

const { CrmTrafficService } = await import('../../src/services/crm.js');
const { CrmError } = await import('../../src/utils/format.js');

beforeAll(() => {
  nock.disableNetConnect();
});

afterEach(() => {
  nock.cleanAll();
});

afterAll(() => {
  nock.enableNetConnect();
});

describe('CrmTrafficService.get', () => {
  test('GET happy path retorna body parseado', async () => {
    nock('http://crm.test')
      .get('/api/trafego/account')
      .matchHeader('authorization', 'Bearer test-crm-token')
      .reply(200, { connected: true, account: { customer_id: '4464129633' } });

    const svc = new CrmTrafficService();
    const result = await svc.get<{ connected: boolean }>('/trafego/account');
    expect(result.connected).toBe(true);
  });

  test('GET cache hit nao bate na rede de novo', async () => {
    nock('http://crm.test')
      .get('/api/trafego/campaigns')
      .reply(200, [{ id: 'a' }, { id: 'b' }]);

    const svc = new CrmTrafficService();
    const first = await svc.get<unknown[]>('/trafego/campaigns');
    expect(first).toHaveLength(2);
    // Sem segundo nock setado — se cache nao funcionar, o teste falha por
    // "Nock: No match for request".
    const second = await svc.get<unknown[]>('/trafego/campaigns');
    expect(second).toHaveLength(2);
  });

  test('POST invalida cache do GET anterior', async () => {
    nock('http://crm.test')
      .get('/api/trafego/campaigns')
      .reply(200, [{ id: 'a' }]);
    nock('http://crm.test')
      .post('/api/trafego/campaigns/X/pause')
      .reply(200, { queued: true });
    nock('http://crm.test')
      .get('/api/trafego/campaigns')
      .reply(200, [{ id: 'a', status: 'PAUSED' }]);

    const svc = new CrmTrafficService();
    const before = await svc.get<any[]>('/trafego/campaigns');
    expect(before[0].status).toBeUndefined();
    await svc.post('/trafego/campaigns/X/pause');
    const after = await svc.get<any[]>('/trafego/campaigns');
    expect(after[0].status).toBe('PAUSED');
  });
});

describe('CrmTrafficService error mapping', () => {
  test('401 vira CrmError(auth)', async () => {
    nock('http://crm.test')
      .get('/api/trafego/account')
      .reply(401, { message: 'Unauthorized' });

    const svc = new CrmTrafficService();
    await expect(svc.get('/trafego/account')).rejects.toMatchObject({
      name: 'CrmError',
      kind: 'auth',
      status: 401,
    });
  });

  test('404 vira CrmError(not_found)', async () => {
    nock('http://crm.test')
      .get('/api/trafego/campaigns/missing')
      .reply(404, { message: 'Campanha nao encontrada' });

    const svc = new CrmTrafficService();
    await expect(svc.get('/trafego/campaigns/missing')).rejects.toMatchObject({
      kind: 'not_found',
      status: 404,
    });
  });

  test('500 vira CrmError(upstream)', async () => {
    nock('http://crm.test')
      .get('/api/trafego/dashboard')
      .reply(500, { message: 'Internal' });

    const svc = new CrmTrafficService();
    await expect(svc.get('/trafego/dashboard')).rejects.toMatchObject({
      kind: 'upstream',
      status: 500,
    });
  });

  test('falha de rede vira CrmError(network)', async () => {
    // Nock interceptando com replyWithError simula falha de transporte.
    nock('http://crm.test')
      .get('/api/trafego/account')
      .replyWithError({ code: 'ECONNREFUSED', message: 'connection refused' });

    const svc = new CrmTrafficService();
    await expect(svc.get('/trafego/account')).rejects.toMatchObject({
      name: 'CrmError',
      kind: 'network',
    });
  });

  test('NestJS message como string[] vira mensagem joinada', async () => {
    nock('http://crm.test')
      .post('/api/trafego/campaigns')
      .reply(400, {
        statusCode: 400,
        message: ['name eh obrigatorio', 'daily_budget_brl deve ser positivo'],
        error: 'Bad Request',
      });

    const svc = new CrmTrafficService();
    try {
      await svc.post('/trafego/campaigns', {});
      throw new Error('era pra ter lancado');
    } catch (e: any) {
      expect(e).toBeInstanceOf(CrmError);
      expect(e.message).toContain('name eh obrigatorio');
      expect(e.message).toContain('daily_budget_brl deve ser positivo');
    }
  });
});
