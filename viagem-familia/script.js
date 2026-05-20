/**
 * script.js — Lógica de render da landing page
 * Lê window.VIAGEM (definido em data.js) e renderiza tudo.
 */

(function () {
  'use strict';

  const data = window.VIAGEM;
  if (!data) {
    console.error('window.VIAGEM não encontrado. data.js carregou?');
    return;
  }

  // ============ HELPERS ============
  const $ = (sel) => document.querySelector(sel);

  function fmtData(iso) {
    if (!iso) return '--';
    const d = new Date(iso.includes('T') ? iso : iso + 'T12:00:00');
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  }

  function fmtDataLonga(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T12:00:00');
    const fmt = d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
    return fmt.charAt(0).toUpperCase() + fmt.slice(1);
  }

  function fmtPeriodo(isoIn, isoOut) {
    const d1 = new Date(isoIn);
    const d2 = new Date(isoOut);
    const opts = { day: 'numeric', month: 'short' };
    return `${d1.toLocaleDateString('pt-BR', opts)} – ${d2.toLocaleDateString('pt-BR', { ...opts, year: 'numeric' })}`;
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ============ HERO ============
  function renderHero() {
    const meta = data.meta;
    const total = meta.adultos + meta.criancas;
    $('#hero-eyebrow').textContent =
      `${fmtPeriodo(meta.chegadaISO, meta.retornoISO)} • ${total} viajantes`;
    $('#hero-title').textContent = meta.titulo;
    $('#hero-subtitle').textContent = meta.subtitulo;
    $('#footer-data').textContent = fmtData(meta.atualizadoEm);
  }

  // ============ CONTADOR REGRESSIVO ============
  function startCountdown() {
    const target = new Date(data.meta.chegadaISO).getTime();
    const elDays = $('#cd-days');
    const elHours = $('#cd-hours');
    const elMin = $('#cd-min');
    const elSec = $('#cd-sec');

    function tick() {
      const diff = target - Date.now();

      if (diff <= 0) {
        elDays.textContent = '00';
        elHours.textContent = '00';
        elMin.textContent = '00';
        elSec.textContent = '00';
        $('#countdown').setAttribute('aria-label', 'A viagem começou!');
        return;
      }

      elDays.textContent = pad2(Math.floor(diff / 86400000));
      elHours.textContent = pad2(Math.floor((diff % 86400000) / 3600000));
      elMin.textContent = pad2(Math.floor((diff % 3600000) / 60000));
      elSec.textContent = pad2(Math.floor((diff % 60000) / 1000));
    }
    tick();
    setInterval(tick, 1000);
  }

  // ============ RESUMO RÁPIDO ============
  function renderResumo() {
    const meta = data.meta;
    const total = meta.adultos + meta.criancas;
    const cards = [
      {
        icon: '👨‍👩‍👧‍👦',
        value: total,
        label: `${meta.adultos} adultos + ${meta.criancas} crianças`,
      },
      {
        icon: '🌅',
        value: 6,
        label: `Dias · ${meta.noites} noites`,
      },
      {
        icon: '🏙️',
        value: meta.cidades.length,
        label: 'Cidades',
      },
      {
        icon: '🎢',
        value: '100+',
        label: 'Atrações no Beto Carrero',
      },
    ];

    $('#resumo-grid').innerHTML = cards.map((c) => `
      <div class="resumo__card">
        <span class="resumo__icon" aria-hidden="true">${c.icon}</span>
        <div class="resumo__value">${esc(c.value)}</div>
        <div class="resumo__label">${esc(c.label)}</div>
      </div>
    `).join('');
  }

  // ============ DIAS ============
  function renderDias() {
    const dias = data.dias || [];
    $('#dias').innerHTML = dias.map(renderDia).join('');

    // Click pra expandir/recolher
    document.querySelectorAll('.dia__header').forEach((header) => {
      header.addEventListener('click', () => toggleDia(header));
      header.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleDia(header);
        }
      });
    });

    // Abre o primeiro dia automaticamente (pra mostrar o conteúdo populado)
    const primeiroAtivo = document.querySelector('.dia:not(.dia--placeholder)');
    if (primeiroAtivo) primeiroAtivo.classList.add('dia--open');
  }

  function toggleDia(header) {
    const dia = header.closest('.dia');
    const isOpen = dia.classList.toggle('dia--open');
    header.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  }

  function renderDia(dia) {
    const isPlaceholder = dia.placeholder === true;
    const corAcento = dia.corAcento || '#E30613';
    const dataLonga = fmtDataLonga(dia.dataISO);

    const numeroStyle = `background: linear-gradient(135deg, ${corAcento}, rgba(0,0,0,0.55));`;

    const badge = isPlaceholder
      ? '<span class="badge badge--em-breve">Em breve</span>'
      : '';

    const body = isPlaceholder
      ? `<div class="dia__placeholder-msg">Detalhes deste dia ainda em elaboração — em breve aparecem aqui.</div>`
      : `
        ${dia.resumo ? `<p class="dia__resumo">${esc(dia.resumo)}</p>` : ''}
        <ol class="timeline" aria-label="Atividades do dia ${dia.numero}">
          ${(dia.atividades || []).map(renderAtividade).join('')}
        </ol>
      `;

    return `
      <article class="dia ${isPlaceholder ? 'dia--placeholder' : ''}" data-dia="${dia.numero}">
        <div class="dia__header" tabindex="0" role="button" aria-expanded="false">
          <div class="dia__numero" style="${numeroStyle}">${dia.numero}</div>
          <div class="dia__info">
            <p class="dia__data">${esc(dataLonga)} ${badge}</p>
            <h3 class="dia__titulo">${esc(dia.titulo || '')}</h3>
            <p class="dia__cidade">${esc(dia.cidade || '')}</p>
          </div>
          <div class="dia__icone" aria-hidden="true">${dia.icone || ''}</div>
          <div class="dia__toggle" aria-hidden="true">▼</div>
        </div>
        <div class="dia__body">
          ${body}
        </div>
      </article>
    `;
  }

  function renderAtividade(at) {
    const confirmarBadge = at.confirmar
      ? '<span class="badge badge--confirmar">A confirmar</span>'
      : '';
    const dica = at.dica
      ? `<div class="atividade__dica">${esc(at.dica)}</div>`
      : '';
    const mapsUrl = at.coords
      ? `https://www.google.com/maps?q=${at.coords.lat},${at.coords.lng}`
      : null;
    const icone = at.icone
      ? `<span class="atividade__icone" aria-hidden="true">${at.icone}</span>`
      : '';

    const acoes = mapsUrl
      ? `<div class="atividade__actions">
           <a class="atividade__action" href="${mapsUrl}" target="_blank" rel="noopener">Ver no Maps</a>
         </div>`
      : '';

    return `
      <li class="atividade">
        <span class="atividade__dot" aria-hidden="true"></span>
        <div class="atividade__hora">${esc(at.hora || '')}</div>
        <h4 class="atividade__titulo">${icone}${esc(at.titulo || '')}${confirmarBadge}</h4>
        ${at.local ? `<p class="atividade__local">${esc(at.local)}</p>` : ''}
        ${dica}
        ${acoes}
      </li>
    `;
  }

  // ============ ANIMAÇÕES ON SCROLL ============
  function setupAnimations() {
    if (!('IntersectionObserver' in window)) {
      // Fallback: mostra tudo direto
      document.querySelectorAll('.dia').forEach((el) => el.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });

    document.querySelectorAll('.dia').forEach((el) => observer.observe(el));
  }

  // ============ INIT ============
  function init() {
    renderHero();
    renderResumo();
    renderDias();
    startCountdown();
    setupAnimations();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
