import axios from 'axios';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005',
});

// ─── Helpers de token ────────────────────────────────────────────────────────

/** Decodifica o payload do JWT (sem verificar assinatura — só para leitura local) */
function decodeTokenPayload(token: string): { exp?: number } | null {
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch {
    return null;
  }
}

/** Retorna true se o token já expirou (com folga de 30s para evitar race conditions) */
function isTokenExpired(token: string): boolean {
  const payload = decodeTokenPayload(token);
  if (!payload?.exp) return true;
  return payload.exp * 1000 < Date.now() + 30_000;
}

/** Dispara logout limpo: remove token e notifica o app */
function triggerLogout(reason: 'expired' | 'unauthorized') {
  if (typeof window === 'undefined') return;
  if (_redirectingToLogin) return;
  _redirectingToLogin = true;
  localStorage.removeItem('token');
  window.dispatchEvent(new CustomEvent('auth:logout', { detail: { reason } }));
  setTimeout(() => { _redirectingToLogin = false; }, 10_000);
}

let _redirectingToLogin = false;

// ─── Check periódico de expiração (roda a cada 60s enquanto o app está aberto) ─
if (typeof window !== 'undefined') {
  setInterval(() => {
    const token = localStorage.getItem('token');
    if (token && isTokenExpired(token)) {
      triggerLogout('expired');
    }
  }, 60_000);
}

// ─── Interceptor de REQUEST ───────────────────────────────────────────────────
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('token');
    if (token) {
      // Verifica expiração ANTES de enviar — evita gerar 401 desnecessário
      if (isTokenExpired(token)) {
        triggerLogout('expired');
        // Cancela a request antes de enviar
        const controller = new AbortController();
        controller.abort();
        config.signal = controller.signal;
        return config;
      }
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// ─── Interceptor de RESPONSE ─────────────────────────────────────────────────
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Chamadas de background (_silent401: true) nunca causam logout
    const isSilent = (error.config as any)?._silent401 === true;

    if (error.response?.status === 401 && !isSilent) {
      // Se chegou aqui com 401, o token foi rejeitado pelo servidor
      // (ex: secret trocado, token adulterado). Desloga imediatamente.
      triggerLogout('unauthorized');
    }

    return Promise.reject(error);
  }
);

// ─── Helpers de URL ─────────────────────────────────────────────────────────

/** URL base da API — centralizado para evitar hardcode em cada componente */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005';

/** Gera URL completa para o endpoint de mídia */
export function getMediaUrl(messageId: string, download = false): string {
  return `${API_BASE_URL}/media/${messageId}${download ? '?dl=1' : ''}`;
}

export default api;
