/**
 * Web Push subscription management.
 * Registra o Service Worker e gerencia a subscription com o backend.
 */
import api from '@/lib/api';

const SW_PATH = '/sw.js';

/** Verifica se o navegador suporta Web Push */
export function isPushSupported(): boolean {
  return typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;
}

/** Registra o Service Worker (idempotente) */
async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null;
  try {
    return await navigator.serviceWorker.register(SW_PATH);
  } catch (e) {
    console.warn('[Push] Falha ao registrar Service Worker:', e);
    return null;
  }
}

/** Busca a VAPID public key do servidor */
async function getVapidKey(): Promise<string | null> {
  try {
    const { data } = await api.get('/push/vapid-key');
    return data?.publicKey || null;
  } catch {
    return null;
  }
}

/** Converte URL-safe base64 para Uint8Array (para PushManager) */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/** Solicita permissão e cria a subscription */
export async function subscribeToPush(): Promise<boolean> {
  if (!isPushSupported()) return false;

  // Solicita permissão de notificação
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  const registration = await registerServiceWorker();
  if (!registration) return false;

  const vapidKey = await getVapidKey();
  if (!vapidKey) {
    console.warn('[Push] VAPID key não disponível no servidor');
    return false;
  }

  try {
    // Verifica se já existe uma subscription
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
      });
    }

    // Envia subscription para o backend
    const subJson = subscription.toJSON();
    await api.post('/push/subscribe', {
      endpoint: subJson.endpoint,
      keys: {
        p256dh: subJson.keys?.p256dh || '',
        auth: subJson.keys?.auth || '',
      },
    });

    console.log('[Push] Subscription registrada com sucesso');
    return true;
  } catch (e) {
    console.warn('[Push] Falha ao criar subscription:', e);
    return false;
  }
}

/** Remove a subscription atual */
export async function unsubscribeFromPush(): Promise<boolean> {
  if (!isPushSupported()) return false;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      await api.delete('/push/subscribe', { data: { endpoint } });
      console.log('[Push] Subscription removida');
    }
    return true;
  } catch (e) {
    console.warn('[Push] Falha ao remover subscription:', e);
    return false;
  }
}

/** Verifica se o usuário já tem uma subscription ativa */
export async function isPushSubscribed(): Promise<boolean> {
  if (!isPushSupported()) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return !!subscription;
  } catch {
    return false;
  }
}
