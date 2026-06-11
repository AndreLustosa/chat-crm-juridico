/**
 * Service Worker para Web Push Notifications.
 * Recebe pushes do servidor mesmo com a aba do navegador fechada.
 */

// eslint-disable-next-line no-restricted-globals
self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const title = data.title || 'Nova notificação';
    const options = {
      body: data.body || '',
      icon: '/landing/LOGO SEM FUNDO 01.png',
      badge: '/favicon.ico',
      tag: data.tag || 'crm-notification',
      data: {
        url: data.url || '/atendimento',
        ...data.data,
      },
      // Não toca som nativo — o frontend cuida (evita som duplo)
      silent: true,
    };

    event.waitUntil(
      // eslint-disable-next-line no-restricted-globals
      self.registration.showNotification(title, options),
    );
  } catch {
    // Payload inválido — ignora silenciosamente
  }
});

// Click na notificação → foca/abre a aba do CRM
// eslint-disable-next-line no-restricted-globals
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/atendimento';

  event.waitUntil(
    // eslint-disable-next-line no-restricted-globals
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Se já tem uma aba aberta no CRM, foca nela
      for (const client of windowClients) {
        if (client.url.includes('/atendimento') && 'focus' in client) {
          return client.focus();
        }
      }
      // Senão, abre uma nova aba
      // eslint-disable-next-line no-restricted-globals
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    }),
  );
});
