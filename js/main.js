/* ============================================================
   AMARREDA — main.js
   Interazioni, accessibilità, validazione e utilità
   Vanilla JS — nessuna dipendenza esterna
   ============================================================ */

(function () {
  'use strict';

  /* ------------------------------------------------------------
     1. UTILITÀ
     ------------------------------------------------------------ */
  const utils = {
    // Debounce per eventi frequenti (scroll, resize)
    debounce(fn, delay = 150) {
      let timer;
      return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
      };
    },

    // Verifica se l'utente preferisce ridurre le animazioni
    prefersReducedMotion() {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    },

    // Scroll fluido con rispetto delle preferenze utente
    smoothScrollTo(target, offset = 80) {
      const element = typeof target === 'string' ? document.querySelector(target) : target;
      if (!element) return;
      const top = element.getBoundingClientRect().top + window.pageYOffset - offset;
      window.scrollTo({ top, behavior: utils.prefersReducedMotion() ? 'auto' : 'smooth' });
    },

    // Blocca lo scroll del body (per menu mobile aperto)
    lockBodyScroll(lock) {
      document.body.style.overflow = lock ? 'hidden' : '';
    },

    // Preserva il parametro ?tipologia= nei link di registrazione
    preserveTipologiaInLinks() {
      const params = new URLSearchParams(window.location.search);
      const tipologia = params.get('tipologia');
      if (!tipologia) return;
      const validTypes = ['privato', 'professionista', 'rivenditore'];
      if (!validTypes.includes(tipologia)) return;

      document.querySelectorAll('a[href*="registrazione.html"]').forEach(link => {
        const href = link.getAttribute('href');
        if (href.includes('?')) {
          if (!href.includes('tipologia=')) {
            link.setAttribute('href', `${href}&tipologia=${tipologia}`);
          }
        } else {
          link.setAttribute('href', `${href}?tipologia=${tipologia}`);
        }
      });
    }
  };

  /* ------------------------------------------------------------
     2. MENU MOBILE (HAMBURGER)
     ------------------------------------------------------------ */
  const MobileMenu = {
    init() {
      const toggle = document.getElementById('nav-toggle');
      const nav = document.getElementById('main-nav');
      if (!toggle || !nav
