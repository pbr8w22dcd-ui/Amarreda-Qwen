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
      if (!toggle || !nav) return;

      toggle.addEventListener('click', () => {
        const isOpen = toggle.getAttribute('aria-expanded') === 'true';
        this.toggle(!isOpen, toggle, nav);
      });

      // Chiudi con ESC
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
          this.toggle(false, toggle, nav);
          toggle.focus();
        }
      });

      // Chiudi cliccando su un link del menu
      nav.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
          if (window.innerWidth <= 640) {
            this.toggle(false, toggle, nav);
          }
        });
      });

      // Chiudi se la finestra si allarga oltre il breakpoint mobile
      window.addEventListener('resize', utils.debounce(() => {
        if (window.innerWidth > 640 && toggle.getAttribute('aria-expanded') === 'true') {
          this.toggle(false, toggle, nav);
        }
      }, 150));
    },

    toggle(open, toggle, nav) {
      toggle.setAttribute('aria-expanded', open);
      nav.classList.toggle('is-open', open);
      utils.lockBodyScroll(open && window.innerWidth <= 640);
    }
  };

  /* ------------------------------------------------------------
     3. TENDINE TARGET (Homepage — Privati / Professionisti / Rivenditori)
     Comportamento: una tendina aperta alla volta.
     Accessibilità: aria-expanded, hidden, focus management.
     ------------------------------------------------------------ */
  const TargetAccordion = {
    init() {
      const triggers = document.querySelectorAll('.target-trigger');
      if (!triggers.length) return;

      triggers.forEach(trigger => {
        trigger.addEventListener('click', (e) => {
          e.preventDefault();
          this.toggle(trigger);
        });

        // Supporto tastiera (Enter e Space)
        trigger.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.toggle(trigger);
          }
        });
      });
    },

    toggle(trigger) {
      const card = trigger.closest('.target-card');
      const panelId = trigger.getAttribute('aria-controls');
      const panel = document.getElementById(panelId);
      if (!card || !panel) return;

      const isOpen = trigger.getAttribute('aria-expanded') === 'true';

      // Chiudi tutte le altre tendine
      document.querySelectorAll('.target-trigger').forEach(otherTrigger => {
        if (otherTrigger !== trigger) {
          const otherCard = otherTrigger.closest('.target-card');
          const otherPanelId = otherTrigger.getAttribute('aria-controls');
          const otherPanel = document.getElementById(otherPanelId);
          if (otherCard) otherCard.classList.remove('is-open');
          if (otherPanel) otherPanel.setAttribute('hidden', '');
          otherTrigger.setAttribute('aria-expanded', 'false');
        }
      });

      // Toggle della tendina cliccata
      if (isOpen) {
        card.classList.remove('is-open');
        panel.setAttribute('hidden', '');
        trigger.setAttribute('aria-expanded', 'false');
      } else {
        card.classList.add('is-open');
        panel.removeAttribute('hidden');
        trigger.setAttribute('aria-expanded', 'true');

        // Scroll morbido alla tendina aperta (se non già in vista)
        if (!utils.prefersReducedMotion()) {
          setTimeout(() => {
            utils.smoothScrollTo(card, 100);
          }, 100);
        }
      }
    }
  };

  /* ------------------------------------------------------------
     4. FAQ ACCORDION
     ------------------------------------------------------------ */
  const FaqAccordion = {
    init() {
      const questions = document.querySelectorAll('.faq-question');
      if (!questions.length) return;

      questions.forEach(question => {
        question.addEventListener('click', () => {
          const answerId = question.getAttribute('aria-controls');
          const answer = document.getElementById(answerId);
          if (!answer) return;

          const isOpen = question.getAttribute('aria-expanded') === 'true';
          question.setAttribute('aria-expanded', !isOpen);
          answer.toggleAttribute('hidden', isOpen);
        });
      });
    }
  };

  /* ------------------------------------------------------------
     5. HEADER — EFFETTO SCROLL
     Aggiunge una classe .is-scrolled per cambiare lo sfondo
     quando l'utente scorre la pagina.
     ------------------------------------------------------------ */
  const HeaderScroll = {
    init() {
      const header = document.getElementById('site-header');
      if (!header) return;

      const onScroll = () => {
        header.classList.toggle('is-scrolled', window.scrollY > 20);
      };

      window.addEventListener('scroll', utils.debounce(onScroll, 10), { passive: true });
      onScroll();
    }
  };

  /* ------------------------------------------------------------
     6. VALIDAZIONE FORM BASE
     Gestisce:
     - Campi required
     - Email valida
     - Password minima 8 caratteri
     - Checkbox obbligatorie
     - Messaggi di errore accessibili
     ------------------------------------------------------------ */
  const FormValidation = {
    init() {
      const forms = document.querySelectorAll('form[data-validate]');
      forms.forEach(form => {
        form.setAttribute('novalidate', '');
        form.addEventListener('submit', (e) => {
          if (!this.validate(form)) {
            e.preventDefault();
            this.focusFirstError(form);
          }
        });

        // Validazione al blur per feedback immediato
        form.querySelectorAll('input, select, textarea').forEach(field => {
          field.addEventListener('blur', () => this.validateField(field));
          field.addEventListener('input', () => {
            if (field.classList.contains('is-invalid')) {
              this.validateField(field);
            }
          });
        });
      });
    },

    validate(form) {
      let isValid = true;
      form.querySelectorAll('input, select, textarea').forEach(field => {
        if (!this.validateField(field)) isValid = false;
      });
      return isValid;
    },

    validateField(field) {
      this.clearError(field);
      const value = field.value.trim();

      // Required
      if (field.hasAttribute('required') && !value) {
        this.showError(field, 'Questo campo è obbligatorio.');
        return false;
      }

      // Email
      if (field.type === 'email' && value) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(value)) {
          this.showError(field, 'Inserisci un indirizzo email valido.');
          return false;
        }
      }

      // Password minima
      if (field.type === 'password' && field.hasAttribute('required') && value.length < 8) {
        this.showError(field, 'La password deve contenere almeno 8 caratteri.');
        return false;
      }

      // Checkbox obbligatoria
      if (field.type === 'checkbox' && field.hasAttribute('required') && !field.checked) {
        this.showError(field, 'Devi accettare per procedere.');
        return false;
      }

      return true;
    },

    showError(field, message) {
      field.classList.add('is-invalid');
      const errorId = `${field.id || field.name}-error`;
      let errorEl = document.getElementById(errorId);

      if (!errorEl) {
        errorEl = document.createElement('div');
        errorEl.id = errorId;
        errorEl.className = 'form-error';
        errorEl.setAttribute('role', 'alert');
        field.parentNode.appendChild(errorEl);
      }

      errorEl.textContent = message;
      errorEl.removeAttribute('hidden');
      field.setAttribute('aria-describedby', errorId);
      field.setAttribute('aria-invalid', 'true');
    },

    clearError(field) {
      field.classList.remove('is-invalid');
      field.removeAttribute('aria-invalid');
      const errorId = `${field.id || field.name}-error`;
      const errorEl = document.getElementById(errorId);
      if (errorEl) {
        errorEl.setAttribute('hidden', '');
        errorEl.textContent = '';
      }
      field.removeAttribute('aria-describedby');
    },

    focusFirstError(form) {
      const firstError = form.querySelector('.is-invalid');
      if (firstError) {
        firstError.focus();
        utils.smoothScrollTo(firstError, 120);
      }
    }
  };

  /* ------------------------------------------------------------
     7. COOKIE BANNER (GDPR)
     Mostra un banner se l'utente non ha ancora espresso preferenze.
     Salva la scelta in localStorage.
     ------------------------------------------------------------ */
  const CookieBanner = {
    STORAGE_KEY: 'amarreda_cookie_consent',

    init() {
      if (localStorage.getItem(this.STORAGE_KEY)) return;
      this.render();
    },

    render() {
      const banner = document.createElement('aside');
      banner.className = 'cookie-banner';
      banner.setAttribute('role', 'dialog');
      banner.setAttribute('aria-label', 'Gestione cookie');
      banner.innerHTML = `
        <div class="cookie-banner-inner">
          <p class="cookie-banner-text">
            Questo sito utilizza cookie tecnici per il funzionamento. I cookie analitici e di marketing sono
            disattivati di default. Puoi gestire le tue preferenze in qualsiasi momento.
            <a href="pages/cookie-policy.html">Cookie Policy</a>
          </p>
          <div class="cookie-banner-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-cookie-action="reject">Rifiuta</button>
            <button type="button" class="btn btn-primary btn-sm" data-cookie-action="accept">Accetta</button>
          </div>
        </div>
      `;
      document.body.appendChild(banner);

      // Stili inline per il banner (così funziona anche senza CSS dedicato)
      const style = document.createElement('style');
      style.textContent = `
        .cookie-banner {
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          background: var(--color-carbone, #262522);
          color: var(--color-bianco-caldo, #FCFAF6);
          padding: 1.25rem 1.5rem;
          z-index: 9999;
          box-shadow: 0 -4px 16px rgba(0,0,0,.15);
        }
        .cookie-banner-inner {
          max-width: 1200px;
          margin: 0 auto;
          display: flex;
          flex-wrap: wrap;
          gap: 1rem;
          align-items: center;
          justify-content: space-between;
        }
        .cookie-banner-text {
          flex: 1 1 400px;
          font-size: 0.875rem;
          line-height: 1.5;
          margin: 0;
        }
        .cookie-banner-text a {
          color: var(--color-tortora-soft, #D8CFC3);
          text-decoration: underline;
        }
        .cookie-banner-actions {
          display: flex;
          gap: 0.5rem;
          flex-shrink: 0;
        }
        @media (max-width: 640px) {
          .cookie-banner-inner { flex-direction: column; align-items: stretch; }
          .cookie-banner-actions { justify-content: stretch; }
          .cookie-banner-actions .btn { flex: 1; }
        }
      `;
      document.head.appendChild(style);

      banner.querySelectorAll('[data-cookie-action]').forEach(btn => {
        btn.addEventListener('click', () => {
          const action = btn.getAttribute('data-cookie-action');
          this.saveConsent(action);
          banner.remove();
          style.remove();
        });
      });
    },

    saveConsent(choice) {
      const consent = {
        choice,
        timestamp: new Date().toISOString(),
        version: '1.0'
      };
      try {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(consent));
      } catch (e) {
        // localStorage non disponibile: silenzioso
      }
    }
  };

  /* ------------------------------------------------------------
     8. NOTIFICHE TOAST
     ------------------------------------------------------------ */
  const Toast = {
    show(message, type = 'info', duration = 4000) {
      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      toast.textContent = message;

      const style = document.createElement('style');
      if (!document.getElementById('toast-styles')) {
        style.id = 'toast-styles';
        style.textContent = `
          .toast {
            position: fixed;
            top: 1.5rem;
            right: 1.5rem;
            max-width: 22rem;
            padding: 0.875rem 1.25rem;
            background: var(--color-bianco-caldo, #FCFAF6);
            color: var(--color-carbone, #262522);
            border-left: 3px solid var(--color-verde-salvia, #89917D);
            border-radius: 0.5rem;
            box-shadow: 0 8px 24px rgba(0,0,0,.12);
            font-size: 0.875rem;
            z-index: 10000;
            animation: toast-in 0.3s ease;
          }
          .toast-error { border-left-color: var(--color-errore, #A94F3D); }
          .toast-success { border-left-color: var(--color-successo, #6E7663); }
          @keyframes toast-in {
            from { opacity: 0; transform: translateY(-10px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `;
        document.head.appendChild(style);
      }

      document.body.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
      }, duration);
    }
  };

  /* ------------------------------------------------------------
     9. SMOOTH SCROLL PER LINK INTERNI (#ancora)
     ------------------------------------------------------------ */
  const SmoothScroll = {
    init() {
      document.querySelectorAll('a[href^="#"]').forEach(link => {
        link.addEventListener('click', (e) => {
          const href = link.getAttribute('href');
          if (href === '#' || href.length < 2) return;
          const target = document.querySelector(href);
          if (!target) return;
          e.preventDefault();
          utils.smoothScrollTo(target, 80);
          // Aggiorna URL senza scroll
          history.pushState(null, '', href);
        });
      });
    }
  };

  /* ------------------------------------------------------------
     10. SKIP LINK (accessibilità)
     Permette agli utenti da tastiera di saltare al contenuto.
     ------------------------------------------------------------ */
  const SkipLink = {
    init() {
      const skipLink = document.querySelector('.skip-link');
      if (!skipLink) return;
      skipLink.addEventListener('click', (e) => {
        e.preventDefault();
        const main = document.querySelector('main') || document.querySelector(skipLink.getAttribute('href'));
        if (main) {
          main.setAttribute('tabindex', '-1');
          main.focus();
        }
      });
    }
  };

  /* ------------------------------------------------------------
     11. INIZIALIZZAZIONE
     ------------------------------------------------------------ */
  document.addEventListener('DOMContentLoaded', () => {
    MobileMenu.init();
    TargetAccordion.init();
    FaqAccordion.init();
    HeaderScroll.init();
    FormValidation.init();
    CookieBanner.init();
    SmoothScroll.init();
    SkipLink.init();
    utils.preserveTipologiaInLinks();

    // Esponi Toast globalmente per uso nei form futuri
    window.Amarreda = { Toast };
  });

})();
