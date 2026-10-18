/* ============================================================
   AMARREDA — automation-adapter.js
   Modulo di automazione predisposto per n8n (non attivo in fase 1)
   
   Implementa:
   - AutomationAdapter: interfaccia base per adapter di automazione
   - NoOpAutomationAdapter: implementazione vuota (usata di default)
   - N8nAutomationAdapter: predisposizione per n8n (da attivare in futuro)
   
   Eventi applicativi:
   - user.registered
   - project.created
   - room.created
   - brief.completed
   - rendering.requested
   - rendering.completed
   - estimate.created
   - products.matched
   - lead.qualified
   - contact.requested
   
   Configurazione:
   - Imposta N8N_ENABLED=true e N8N_WEBHOOK_URL nel file .env
   - Per ora, il sistema usa NoOpAutomationAdapter (nessuna chiamata esterna)
   ============================================================ */

(function (window) {
  'use strict';

  /* ------------------------------------------------------------
     1. INTERFACCIA AUTOMATION ADAPTER
     ------------------------------------------------------------ */
  
  /**
   * AutomationAdapter
   * Interfaccia base per adapter di automazione.
   * Tutti gli adapter devono implementare questi metodi.
   */
  class AutomationAdapter {
    /**
     * Invia un evento al sistema di automazione.
     * @param {string} eventName - Nome dell'evento (es: 'user.registered')
     * @param {Object} payload - Dati dell'evento
     * @param {Object} options - Opzioni aggiuntive (timeout, retry, etc.)
     * @returns {Promise<Object>} - Risultato dell'operazione
     */
    async emit(eventName, payload, options = {}) {
      throw new Error('Metodo emit() non implementato');
    }

    /**
     * Verifica se l'adapter è configurato e pronto all'uso.
     * @returns {boolean}
     */
    isConfigured() {
      return false;
    }

    /**
     * Restituisce il nome dell'adapter.
     * @returns {string}
     */
    getName() {
      return 'base';
    }
  }

  /* ------------------------------------------------------------
     2. NOOP AUTOMATION ADAPTER (DEFAULT)
     ------------------------------------------------------------ */
  
  /**
   * NoOpAutomationAdapter
   * Implementazione vuota che non esegue alcuna azione.
   * Usata di default quando n8n non è configurato.
   * 
   * Registra gli eventi in console (solo in sviluppo) ma non invia webhook.
   */
  class NoOpAutomationAdapter extends AutomationAdapter {
    constructor() {
      super();
      this.eventLog = [];
      this.maxLogSize = 100; // Mantiene solo gli ultimi 100 eventi in memoria
    }

    /**
     * Registra l'evento in memoria (solo per debug in sviluppo).
     */
    async emit(eventName, payload, options = {}) {
      const event = {
        id: this._generateEventId(),
        eventName,
        payload: this._sanitizePayload(payload),
        timestamp: new Date().toISOString(),
        adapter: 'noop',
        status: 'logged'
      };

      // Salva in memoria (solo per debug)
      this.eventLog.push(event);
      if (this.eventLog.length > this.maxLogSize) {
        this.eventLog.shift(); // Rimuove il più vecchio
      }

      // Log in console solo in sviluppo
      if (this._isDevelopment()) {
        console.log('[AutomationAdapter:NoOp] Evento registrato:', {
          eventName,
          payloadKeys: Object.keys(payload || {}),
          eventId: event.id
        });
      }

      return {
        success: true,
        eventId: event.id,
        message: 'Evento registrato (nessuna azione esterna)'
      };
    }

    isConfigured() {
      return true; // Sempre configurato (non fa nulla)
    }

    getName() {
      return 'noop';
    }

    /**
     * Restituisce gli eventi registrati (solo per debug).
     * @returns {Array}
     */
    getEventLog() {
      return [...this.eventLog];
    }

    /**
     * Genera un ID univoco per l'evento.
     * @private
     */
    _generateEventId() {
      return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Rimuove dati sensibili dal payload prima del log.
     * @private
     */
    _sanitizePayload(payload) {
      if (!payload) return {};
      
      const sanitized = { ...payload };
      
      // Rimuovi campi sensibili
      const sensitiveFields = [
        'password',
        'token',
        'apiKey',
        'secret',
        'creditCard',
        'ssn'
      ];
      
      sensitiveFields.forEach(field => {
        if (sanitized[field]) {
          sanitized[field] = '[REDACTED]';
        }
      });
      
      return sanitized;
    }

    /**
     * Verifica se siamo in ambiente di sviluppo.
     * @private
     */
    _isDevelopment() {
      return window.location.hostname === 'localhost' || 
             window.location.hostname === '127.0.0.1';
    }
  }

  /* ------------------------------------------------------------
     3. N8N AUTOMATION ADAPTER (PREDISPOSTO, NON ATTIVO)
     ------------------------------------------------------------ */
  
  /**
   * N8nAutomationAdapter
   * Adapter per n8n (da attivare in futuro).
   * 
   * Per attivare:
   * 1. Imposta N8N_ENABLED=true nel file .env
   * 2. Imposta N8N_WEBHOOK_URL con l'URL del webhook n8n
   * 3. Configura i workflow n8n per gestire gli eventi
   * 
   * Per ora, questa classe esiste ma non viene istanziata.
   */
  class N8nAutomationAdapter extends AutomationAdapter {
    constructor(webhookUrl, options = {}) {
      super();
      this.webhookUrl = webhookUrl;
      this.timeout = options.timeout || 5000; // 5 secondi di default
      this.maxRetries = options.maxRetries || 3;
      this.retryDelay = options.retryDelay || 1000; // 1 secondo tra i retry
    }

    /**
     * Invia l'evento al webhook n8n.
     */
    async emit(eventName, payload, options = {}) {
      if (!this.isConfigured()) {
        throw new Error('N8nAutomationAdapter non configurato: manca webhookUrl');
      }

      const event = {
        id: this._generateEventId(),
        eventName,
        payload: this._sanitizePayload(payload),
        timestamp: new Date().toISOString(),
        adapter: 'n8n',
        source: 'amarreda-web'
      };

      let attempts = 0;
      let lastError = null;

      while (attempts < this.maxRetries) {
        try {
          const response = await fetch(this.webhookUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(event),
            signal: AbortSignal.timeout(this.timeout)
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const result = await response.json();

          // Log in console solo in sviluppo
          if (this._isDevelopment()) {
            console.log('[AutomationAdapter:N8n] Evento inviato:', {
              eventName,
              eventId: event.id,
              response: result
            });
          }

          return {
            success: true,
            eventId: event.id,
            message: 'Evento inviato a n8n',
            response: result
          };

        } catch (error) {
          lastError = error;
          attempts++;

          // Log errore (senza dati sensibili)
          console.error(`[AutomationAdapter:N8n] Tentativo ${attempts}/${this.maxRetries} fallito:`, {
            eventName,
            eventId: event.id,
            error: error.message
          });

          // Attendi prima del retry (con backoff esponenziale)
          if (attempts < this.maxRetries) {
            const delay = this.retryDelay * Math.pow(2, attempts - 1);
            await this._sleep(delay);
          }
        }
      }

      // Tutti i tentativi falliti
      throw new Error(`Impossibile inviare evento a n8n dopo ${this.maxRetries} tentativi: ${lastError.message}`);
    }

    isConfigured() {
      return Boolean(this.webhookUrl);
    }

    getName() {
      return 'n8n';
    }

    /**
     * Genera un ID univoco per l'evento.
     * @private
     */
    _generateEventId() {
      return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Rimuove dati sensibili dal payload.
     * @private
     */
    _sanitizePayload(payload) {
      if (!payload) return {};
      
      const sanitized = { ...payload };
      
      const sensitiveFields = [
        'password',
        'token',
        'apiKey',
        'secret',
        'creditCard',
        'ssn'
      ];
      
      sensitiveFields.forEach(field => {
        if (sanitized[field]) {
          sanitized[field] = '[REDACTED]';
        }
      });
      
      return sanitized;
    }

    /**
     * Verifica se siamo in ambiente di sviluppo.
     * @private
     */
    _isDevelopment() {
      return window.location.hostname === 'localhost' || 
             window.location.hostname === '127.0.0.1';
    }

    /**
     * Utility per attendere un certo numero di millisecondi.
     * @private
     */
    _sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }
  }

  /* ------------------------------------------------------------
     4. AUTOMATION MANAGER
     ------------------------------------------------------------ */
  
  /**
   * AutomationManager
   * Gestisce l'adapter di automazione attivo e fornisce un'interfaccia unificata.
   */
  class AutomationManager {
    constructor() {
      this.adapter = null;
      this.initialized = false;
    }

    /**
     * Inizializza l'adapter in base alla configurazione.
     * Per ora usa sempre NoOpAutomationAdapter.
     */
    initialize() {
      if (this.initialized) {
        console.warn('[AutomationManager] Già inizializzato');
        return;
      }

      // Per ora, usa sempre NoOp (n8n non ancora attivo)
      // In futuro, qui si leggerà la configurazione e si sceglierà l'adapter
      this.adapter = new NoOpAutomationAdapter();
      this.initialized = true;

      console.log('[AutomationManager] Inizializzato con adapter:', this.adapter.getName());
    }

    /**
     * Invia un evento attraverso l'adapter attivo.
     */
    async emit(eventName, payload, options = {}) {
      if (!this.initialized) {
        this.initialize();
      }

      try {
        const result = await this.adapter.emit(eventName, payload, options);
        return result;
      } catch (error) {
        console.error('[AutomationManager] Errore durante l\'invio dell\'evento:', {
          eventName,
          error: error.message
        });
        
        // Non bloccare l'applicazione se l'automazione fallisce
        // Ritorna un risultato di fallback
        return {
          success: false,
          error: error.message,
          message: 'Evento non inviato (automazione non disponibile)'
        };
      }
    }

    /**
     * Restituisce l'adapter attivo.
     */
    getAdapter() {
      if (!this.initialized) {
        this.initialize();
      }
      return this.adapter;
    }

    /**
     * Verifica se l'adapter è configurato.
     */
    isConfigured() {
      if (!this.initialized) {
        return false;
      }
      return this.adapter.isConfigured();
    }
  }

  /* ------------------------------------------------------------
     5. EVENTI APPLICATIVI (COSTANTI)
     ------------------------------------------------------------ */
  
  const AutomationEvents = {
    USER_REGISTERED: 'user.registered',
    PROJECT_CREATED: 'project.created',
    ROOM_CREATED: 'room.created',
    BRIEF_COMPLETED: 'brief.completed',
    RENDERING_REQUESTED: 'rendering.requested',
    RENDERING_COMPLETED: 'rendering.completed',
    ESTIMATE_CREATED: 'estimate.created',
    PRODUCTS_MATCHED: 'products.matched',
    LEAD_QUALIFIED: 'lead.qualified',
    CONTACT_REQUESTED: 'contact.requested'
  };

  /* ------------------------------------------------------------
     6. ESPORTAZIONE GLOBALE
     ------------------------------------------------------------ */
  
  // Crea l'istanza globale del manager
  const automationManager = new AutomationManager();

  // Esporta tutto nell'oggetto globale window.Amarreda
  window.Amarreda = window.Amarreda || {};
  window.Amarreda.Automation = {
    Manager: automationManager,
    Adapter: {
      Base: AutomationAdapter,
      NoOp: NoOpAutomationAdapter,
      N8n: N8nAutomationAdapter
    },
    Events: AutomationEvents,
    
    // Shortcut per emettere eventi
    emit: automationManager.emit.bind(automationManager)
  };

  // Inizializza automaticamente
  automationManager.initialize();

})(window);
