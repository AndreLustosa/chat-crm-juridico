import dotenv from 'dotenv';
import { DEFAULT_CACHE_TTL_MS, DEFAULT_REPORT_DAILY_LIMIT } from './constants.js';

dotenv.config();

function firstEnv(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function required(name: string, aliases: string[] = []): string {
  const value = firstEnv([name, ...aliases]);
  if (!value || value.trim().length === 0) {
    const acceptedNames = [name, ...aliases].join(' ou ');
    throw new Error(`Variavel de ambiente obrigatoria ausente: ${acceptedNames}`);
  }
  return value;
}

function optional(name: string, aliases: string[] = []): string | undefined {
  return firstEnv([name, ...aliases]);
}

const crmApiUrl = optional('CRM_API_URL');
const crmApiKey = optional('CRM_API_KEY', ['CRM_AUTH_TOKEN']);
const runtimeMode = optional('TRAFFIC_MCP_MODE') ?? (crmApiUrl && crmApiKey ? 'crm' : 'google_ads');
const publicBaseUrl = optional('MCP_PUBLIC_BASE_URL') ?? 'https://andrelustosaadvogados.com.br/traffic-mcp';
const normalizedPublicBaseUrl = publicBaseUrl.replace(/\/+$/, '');

export const config = {
  port: Number(process.env.MCP_PORT ?? 3100),
  authToken: required('MCP_AUTH_TOKEN'),
  publicBaseUrl: normalizedPublicBaseUrl,
  publicMcpUrl: optional('MCP_PUBLIC_URL') ?? `${normalizedPublicBaseUrl}/mcp`,
  oauth: {
    authorizationToken: optional('MCP_OAUTH_AUTHORIZATION_TOKEN') ?? required('MCP_AUTH_TOKEN'),
    accessTokenTtlSeconds: Number(process.env.MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS ?? 3600),
    refreshTokenTtlSeconds: Number(process.env.MCP_OAUTH_REFRESH_TOKEN_TTL_SECONDS ?? 60 * 60 * 24 * 30),
    scopes: ['mcp:tools'],
  },
  runtimeMode,
  cacheTtlMs: Number(process.env.CACHE_TTL_MS ?? DEFAULT_CACHE_TTL_MS),
  reportDailyLimit: Number(process.env.REPORT_DAILY_LIMIT ?? DEFAULT_REPORT_DAILY_LIMIT),
  auditLogPath: process.env.WRITE_AUDIT_LOG ?? './logs/write-audit.log',
  googleAds: {
    clientId: runtimeMode === 'google_ads' ? required('GOOGLE_ADS_CLIENT_ID', ['GOOGLE_OAUTH_CLIENT_ID']) : optional('GOOGLE_ADS_CLIENT_ID', ['GOOGLE_OAUTH_CLIENT_ID']),
    clientSecret: runtimeMode === 'google_ads' ? required('GOOGLE_ADS_CLIENT_SECRET', ['GOOGLE_OAUTH_CLIENT_SECRET']) : optional('GOOGLE_ADS_CLIENT_SECRET', ['GOOGLE_OAUTH_CLIENT_SECRET']),
    developerToken: runtimeMode === 'google_ads' ? required('GOOGLE_ADS_DEVELOPER_TOKEN') : optional('GOOGLE_ADS_DEVELOPER_TOKEN'),
    refreshToken: runtimeMode === 'google_ads' ? required('GOOGLE_ADS_REFRESH_TOKEN') : optional('GOOGLE_ADS_REFRESH_TOKEN'),
    customerId: (runtimeMode === 'google_ads' ? required('GOOGLE_ADS_CUSTOMER_ID') : optional('GOOGLE_ADS_CUSTOMER_ID'))?.replace(/\D/g, '') ?? '',
    loginCustomerId: optional('GOOGLE_ADS_LOGIN_CUSTOMER_ID')?.replace(/\D/g, ''),
  },
  crm: {
    apiUrl: runtimeMode === 'crm' ? required('CRM_API_URL') : crmApiUrl,
    apiKey: runtimeMode === 'crm' ? required('CRM_API_KEY', ['CRM_AUTH_TOKEN']) : crmApiKey,
  },
};
