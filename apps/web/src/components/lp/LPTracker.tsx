'use client';

import { useEffect } from 'react';

declare global {
  interface Window {
    dataLayer: Record<string, unknown>[];
    gtag?: (...args: unknown[]) => void;
  }
}

import { API_BASE_URL } from '@/lib/api';
const API_URL = API_BASE_URL;

function getVisitorId(): string {
  let id = localStorage.getItem('lp_visitor_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('lp_visitor_id', id);
  }
  return id;
}

function getUtmParams() {
  if (typeof window === 'undefined') return {};
  const p = new URLSearchParams(window.location.search);
  return {
    utm_source: p.get('utm_source') || undefined,
    utm_medium: p.get('utm_medium') || undefined,
    utm_campaign: p.get('utm_campaign') || undefined,
    utm_term: p.get('utm_term') || undefined,
    utm_content: p.get('utm_content') || undefined,
    gclid: p.get('gclid') || undefined,
  };
}

async function sendEvent(event_type: 'view' | 'whatsapp_click') {
  try {
    const utms = getUtmParams();
    await fetch(`${API_URL}/analytics/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        page_path: window.location.pathname,
        event_type,
        visitor_id: getVisitorId(),
        referrer: document.referrer || undefined,
        ...utms,
      }),
    });
    if (typeof window !== 'undefined') {
      const eventName = event_type === 'view' ? 'lp_page_view' : 'lp_whatsapp_click';

      // 1. GTM dataLayer — GTM processa e dispara tags configuradas
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({
        event: eventName,
        page_path: window.location.pathname,
        ...utms,
      });

      // 2. gtag direto — fallback caso GTM não tenha carregado (ex.: CSP residual)
      //    Garante que Google Analytics e Google Ads recebam o evento
      if (typeof window.gtag === 'function') {
        window.gtag('event', eventName, {
          event_category: 'engagement',
          event_label: window.location.pathname,
          page_path: window.location.pathname,
          ...utms,
        });
      }
    }
  } catch {
    // silencioso — não quebra a página
  }
}

/** Coloque nas páginas de LP para rastrear views automaticamente */
export function LPTracker() {
  useEffect(() => {
    const sessionKey = `lp_viewed_${window.location.pathname}`;
    if (sessionStorage.getItem(sessionKey)) return;
    sessionStorage.setItem(sessionKey, '1');
    sendEvent('view');
  }, []);

  return null;
}

/** Chame ao clicar no botão de WhatsApp */
export function trackWhatsappClick() {
  sendEvent('whatsapp_click');
}
