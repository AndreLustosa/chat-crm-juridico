/**
 * Configuração centralizada do Socket.IO — fonte única para URL e path.
 * Substitui as 8+ cópias de getWsUrl()/getSocketPath() espalhadas pelo frontend.
 */

export function getWsUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005';
  if (apiUrl.startsWith('http')) {
    try { return new URL(apiUrl).origin; } catch { /* fall through */ }
  }
  return typeof window !== 'undefined' ? window.location.origin : '';
}

export function getSocketPath(): string {
  if (process.env.NEXT_PUBLIC_SOCKET_PATH) return process.env.NEXT_PUBLIC_SOCKET_PATH;
  // Sempre /socket.io/ — o Traefik crm-ws router já roteia sem /api prefix
  return '/socket.io/';
}

export function getAuthToken(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('token') || '';
}

export function decodeUserId(): string | null {
  const token = getAuthToken();
  if (!token) return null;
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub || null;
  } catch { return null; }
}
