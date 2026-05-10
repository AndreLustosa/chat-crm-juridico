import axios from 'axios';

const CONFIGURED_API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function cleanTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function getSameOriginApiUrl(): string {
  return typeof window !== 'undefined' ? `${window.location.origin}/api` : 'http://localhost:3005';
}

function resolveApiBaseUrl(): string {
  if (typeof window === 'undefined') {
    return cleanTrailingSlash(CONFIGURED_API_BASE_URL || 'http://localhost:3005');
  }

  const fallback = getSameOriginApiUrl();
  if (!CONFIGURED_API_BASE_URL) return fallback;

  try {
    const configured = new URL(CONFIGURED_API_BASE_URL, window.location.origin);
    const pageIsPublicHttps = window.location.protocol === 'https:' && !LOCAL_HOSTS.has(window.location.hostname);
    const pointsToLocalhost = LOCAL_HOSTS.has(configured.hostname);
    const wouldBeMixedContent = window.location.protocol === 'https:' && configured.protocol === 'http:';

    if (pageIsPublicHttps && (pointsToLocalhost || wouldBeMixedContent)) {
      return fallback;
    }

    return cleanTrailingSlash(CONFIGURED_API_BASE_URL);
  } catch {
    return fallback;
  }
}

export const API_BASE_URL = resolveApiBaseUrl();

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
});

// ─── Helpers de token ────────────────────────────────────────────────────────

/** Decodifica o payload do JWT (sem verificar assinatura — só para leitura local) */
function decodeTokenPayload(token: string): { exp?: number; role?: string; sub?: string } | null {
  try {
    // JWT usa base64url — converter para base64 standard + padding para atob()
    let b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return JSON.parse(atob(b64));
  } catch {
    return null;
  }
}

/** Retorna true se o token está genuinamente expirado (sem buffer prematuro) */
function isTokenExpired(token: string): boolean {
  const payload = decodeTokenPayload(token);
  if (!payload?.exp) return false; // Se não conseguiu decodificar, não desloga — deixa o servidor decidir
  return payload.exp * 1000 < Date.now();
}

/** Dispara logout limpo: remove token e notifica o app */
function triggerLogout(reason: 'expired' | 'unauthorized') {
  if (typeof window === 'undefined') return;
  if (_redirectingToLogin) return;
  _redirectingToLogin = true;
  const stack = new Error().stack;
  console.error(`[AUTH-LOGOUT] ❌ triggerLogout chamado: reason=${reason}`, { stack });
  const token = localStorage.getItem('token');
  if (token) {
    const payload = decodeTokenPayload(token);
    console.error(`[AUTH-LOGOUT] Token info:`, {
      exists: true,
      exp: payload?.exp ? new Date(payload.exp * 1000).toISOString() : 'N/A',
      now: new Date().toISOString(),
      isExpired: payload?.exp ? payload.exp * 1000 < Date.now() : 'unknown',
    });
  } else {
    console.error(`[AUTH-LOGOUT] Token NÃO existe no localStorage`);
  }
  localStorage.removeItem('token');
  window.dispatchEvent(new CustomEvent('auth:logout', { detail: { reason } }));
  setTimeout(() => { _redirectingToLogin = false; }, 10_000);
}

let _redirectingToLogin = false;
let _consecutive401Count = 0;
let _last401ResetTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Check periódico de expiração (roda a cada 30min — tokens duram 365d) ────
if (typeof window !== 'undefined') {
  setInterval(() => {
    const token = localStorage.getItem('token');
    if (token && isTokenExpired(token)) {
      triggerLogout('expired');
    }
  }, 30 * 60_000); // 30 minutos — adequado para tokens de 365d
}

// ─── Interceptor de REQUEST ───────────────────────────────────────────────────
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// ─── Interceptor de RESPONSE ─────────────────────────────────────────────────
api.interceptors.response.use(
  (response) => {
    // Reset contador de 401 em caso de sucesso
    _consecutive401Count = 0;
    return response;
  },
  (error) => {
    // Chamadas de background (_silent401: true) nunca causam logout
    const isSilent = (error.config as any)?._silent401 === true;

    if (error.response?.status === 401 && !isSilent) {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      const expired = token ? isTokenExpired(token) : true;

      // Se o token NÃO expirou localmente mas o servidor deu 401,
      // é provável que o servidor está reiniciando — NÃO contar para logout
      if (token && !expired) {
        const url = (error.config as any)?.url || 'unknown';
        console.warn(`[api] 401 transiente em ${url} (token local válido — servidor pode estar reiniciando)`);
        // Não incrementa o contador — retorna o erro normalmente e a página pode tentar de novo
        return Promise.reject(error);
      }

      // Token expirado ou ausente — contar para logout
      _consecutive401Count++;

      const url = (error.config as any)?.url || 'unknown';
      console.warn(`[api] 401 em ${url} (consecutivo: ${_consecutive401Count}, tokenExpirado: ${expired})`);

      // Resetar o contador após 30s sem 401
      if (_last401ResetTimer) clearTimeout(_last401ResetTimer);
      _last401ResetTimer = setTimeout(() => { _consecutive401Count = 0; }, 30_000);

      // Se o token está expirado, deslogar imediatamente
      if (expired) {
        console.error(`[api] Token expirado — logout`);
        triggerLogout('expired');
      }
      // Se acumulou muitos 401 sem token válido — logout
      else if (_consecutive401Count >= 10) {
        console.error(`[api] ${_consecutive401Count} erros 401 consecutivos — logout`);
        triggerLogout('unauthorized');
      }
    }

    return Promise.reject(error);
  }
);

// ─── Helpers de URL ─────────────────────────────────────────────────────────

/** Gera URL completa para o endpoint de mídia */
export function getMediaUrl(messageId: string, download = false): string {
  return `${API_BASE_URL}/media/${messageId}${download ? '?dl=1' : ''}`;
}

export default api;
