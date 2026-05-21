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

/**
 * Codigo de referencia curto e DETERMINISTICO derivado do visitor_id
 * (feature Enhanced Conversions for Leads, 2026-05-21). Formato: AL-XXXXXX.
 *
 * Como o codigo eh determinístico, todos os eventos do mesmo visitante
 * (view + whatsapp_click) carregam o MESMO ref_code, e o texto do wa.me
 * usa o mesmo. No backend (webhook), a 1a mensagem do lead traz esse
 * codigo → buscamos o LpEvent com aquele ref_code → copiamos o gclid
 * pro Lead → fechamos o loop de atribuicao offline pro Google Ads.
 *
 * SSR-safe: retorna '' no servidor (sem localStorage).
 */
export function getRefCode(): string {
  if (typeof window === 'undefined') return '';
  const vid = getVisitorId();
  let hash = 0;
  for (let i = 0; i < vid.length; i++) {
    hash = ((hash << 5) - hash + vid.charCodeAt(i)) | 0;
  }
  const code = Math.abs(hash).toString(36).toUpperCase().padStart(6, '0').slice(0, 6);
  return `AL-${code}`;
}

/**
 * Injeta a linha de referencia (_Ref: AL-XXXXXX_) no parametro `text` de
 * um link wa.me JA MONTADO. Mudanca minima nos templates: basta envolver
 * o link no window.open. NAO altera a copy-base (so appenda o ref).
 *
 * Deve ser chamada no momento do CLIQUE (client-side) — o getRefCode
 * depende de localStorage. Se nao houver ref (SSR/sem janela) ou o link
 * nao for wa.me, retorna o link original intacto.
 */
export function appendRefToWaLink(waLink: string): string {
  const ref = getRefCode();
  if (!ref || !waLink || !waLink.includes('wa.me')) return waLink;
  try {
    const url = new URL(waLink);
    const text = url.searchParams.get('text') || '';
    if (text.includes('_Ref:')) return waLink; // ja tem ref
    url.searchParams.set('text', `${text}\n\n_Ref: ${ref}_`);
    return url.toString();
  } catch {
    return waLink;
  }
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
        ref_code: getRefCode(), // EC for Leads — chave de matching gclid→lead
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
