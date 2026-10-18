/* ============================================================
   AMARREDA — ai-provider-qwen.js
   Adattatore per provider AI Qwen (Alibaba Cloud DashScope)
   
   Implementa:
   - AIProvider: interfaccia base per provider AI
   - QwenProvider: implementazione per Qwen (chat + visione)
   - AIManager: gestisce il provider attivo
   
   Modelli supportati:
   - qwen-max: il più potente (chat complessa)
   - qwen-plus: bilanciato (consigliato per Amarreda)
   - qwen-turbo: veloce ed economico
   - qwen-vl-max: analisi immagini (visione)
   
   Configurazione:
   - Imposta QWEN_API_KEY nel file .env (lato server)
   - Imposta QWEN_MODEL nel file .env (default: qwen-plus)
   - Le API key NON devono mai essere nel codice frontend
   - Le chiamate AI devono transitare dal backend
   
   Sicurezza:
   - Questo modulo è un ADAPTER che chiama il backend
   - Il backend gestisce le API key e le chiamate reali a Qwen
   - Il frontend non ha mai accesso alle chiavi API
   ============================================================ */

(function (window) {
  'use strict';

  /* ------------------------------------------------------------
     1. INTERFACCIA AI PROVIDER
     ------------------------------------------------------------ */
  
  /**
   * AIProvider
   * Interfaccia base per provider AI.
   * Tutti i provider devono implementare questi metodi.
   */
  class AIProvider {
    /**
     * Invia un messaggio e riceve una risposta.
     * @param {string} message - Messaggio dell'utente
     * @param {Array} conversationHistory - Storico della conversazione
     * @param {Object} context - Contesto aggiuntivo (progetto, ambiente, etc.)
     * @returns {Promise<Object>} - Risposta strutturata
     */
    async chat(message, conversationHistory = [], context = {}) {
      throw new Error('Metodo chat() non implementato');
    }

    /**
     * Analizza un'immagine e restituisce informazioni strutturate.
     * @param {string} imageUrl - URL dell'immagine (temporaneo)
     * @param {string} prompt - Prompt per l'analisi
     * @returns {Promise<Object>} - Risultato dell'analisi
     */
    async analyzeImage(imageUrl, prompt) {
      throw new Error('Metodo analyzeImage() non implementato');
    }

    /**
     * Verifica se il provider è configurato e pronto all'uso.
     * @returns {boolean}
     */
    isConfigured() {
      return false;
    }

    /**
     * Restituisce il nome del provider.
     * @returns {string}
     */
    getName() {
      return 'base';
    }

    /**
     * Restituisce i modelli disponibili.
     * @returns {Array<string>}
     */
    getAvailableModels() {
      return [];
    }
  }

  /* ------------------------------------------------------------
     2. QWEN PROVIDER (DASHSCOPE)
     ------------------------------------------------------------ */
  
  /**
   * QwenProvider
   * Adattatore per Qwen (Alibaba Cloud DashScope).
   * 
   * IMPORTANTE: Questo adapter chiama il BACKEND, non direttamente Qwen.
   * Il backend gestisce le API key e le chiamate reali.
   * 
   * Endpoint backend previsto:
   * POST /api/ai/chat
   * POST /api/ai/analyze-image
   */
  class QwenProvider extends AIProvider {
    constructor(config = {}) {
      super();
      this.backendUrl = config.backendUrl || '/api/ai';
      this.timeout = config.timeout || 30000; // 30 secondi
      this.maxRetries = config.maxRetries || 2;
      this.retryDelay = config.retryDelay || 1000;
      this.model = config.model || 'qwen-plus';
    }

    /**
     * Invia un messaggio alla chat AI tramite il backend.
     */
    async chat(message, conversationHistory = [], context = {}) {
      if (!this.isConfigured()) {
        throw new Error('Provider AI non configurato. Verifica la configurazione del backend.');
      }

      const payload = {
        message,
        history: this._sanitizeHistory(conversationHistory),
        context: this._sanitizeContext(context),
        model: this.model,
        timestamp: new Date().toISOString()
      };

      let attempts = 0;
      let lastError = null;

      while (attempts < this.maxRetries) {
        try {
          const response = await fetch(`${this.backendUrl}/chat`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this._getAuthToken()}`
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(this.timeout)
          });

          if (response.status === 401) {
            throw new Error('Autenticazione scaduta. Effettua nuovamente il login.');
          }

          if (response.status === 429) {
            throw new Error('Limite di richieste raggiunto. Riprova tra qualche istante.');
          }

          if (!response.ok) {
            throw new Error(`Errore del server: ${response.status} ${response.statusText}`);
          }

          const result = await response.json();

          // Valida la risposta
          if (!this._validateResponse(result)) {
            throw new Error('Risposta AI non valida. Formato inatteso.');
          }

          // Log in console solo in sviluppo
          if (this._isDevelopment()) {
            console.log('[AIProvider:Qwen] Chat completata:', {
              model: this.model,
              messageLength: message.length,
              responseLength: result.response?.length || 0,
              hasStructuredData: Boolean(result.structuredData)
            });
          }

          return {
            success: true,
            response: result.response,
            structuredData: result.structuredData || null,
            model: result.model || this.model,
            timestamp: result.timestamp || new Date().toISOString(),
            usage: result.usage || null
          };

        } catch (error) {
          lastError = error;
          attempts++;

          console.error(`[AIProvider:Qwen] Tentativo ${attempts}/${this.maxRetries} fallito:`, {
            error: error.message,
            model: this.model
          });

          if (attempts < this.maxRetries) {
            const delay = this.retryDelay * Math.pow(2, attempts - 1);
            await this._sleep(delay);
          }
        }
      }

      throw new Error(`Impossibile completare la richiesta AI dopo ${this.maxRetries} tentativi: ${lastError.message}`);
    }

    /**
     * Analizza un'immagine tramite il backend.
     */
    async analyzeImage(imageUrl, prompt) {
      if (!this.isConfigured()) {
        throw new Error('Provider AI non configurato. Verifica la configurazione del backend.');
      }

      const payload = {
        imageUrl,
        prompt,
        model: 'qwen-vl-max', // Modello specifico per visione
        timestamp: new Date().toISOString()
      };

      try {
        const response = await fetch(`${this.backendUrl}/analyze-image`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this._getAuthToken()}`
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.timeout)
        });

        if (!response.ok) {
          throw new Error(`Errore del server: ${response.status}`);
        }

        const result = await response.json();

        if (this._isDevelopment()) {
          console.log('[AIProvider:Qwen] Analisi immagine completata:', {
            model: 'qwen-vl-max',
            hasResult: Boolean(result.analysis)
          });
        }

        return {
          success: true,
          analysis: result.analysis,
          structuredData: result.structuredData || null,
          timestamp: result.timestamp || new Date().toISOString()
        };

      } catch (error) {
        console.error('[AIProvider:Qwen] Errore analisi immagine:', error.message);
        throw error;
      }
    }

    isConfigured() {
      // Verifica se il backend è raggiungibile
      // (la configurazione reale è lato server)
      return Boolean(this.backendUrl);
    }

    getName() {
      return 'qwen';
    }

    getAvailableModels() {
      return ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-vl-max'];
    }

    /**
     * Valida la risposta del provider.
     * @private
     */
    _validateResponse(result) {
      if (!result || typeof result !== 'object') return false;
      if (!result.response || typeof result.response !== 'string') return false;
      return true;
    }

    /**
     * Rimuove dati sensibili dallo storico conversazione.
     * @private
     */
    _sanitizeHistory(history) {
      if (!Array.isArray(history)) return [];
      
      return history.map(msg => ({
        role: msg.role || 'user',
        content: msg.content || '',
        timestamp: msg.timestamp || null
      }));
    }

    /**
     * Rimuove dati sensibili dal contesto.
     * @private
     */
    _sanitizeContext(context) {
      if (!context || typeof context !== 'object') return {};
      
      const sanitized = { ...context };
      
      // Rimuovi campi sensibili
      delete sanitized.password;
      delete sanitized.token;
      delete sanitized.apiKey;
      
      return sanitized;
    }

    /**
     * Recupera il token di autenticazione dal localStorage.
     * @private
     */
    _getAuthToken() {
      return localStorage.getItem('amarreda_auth_token') || '';
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
     3. AI MANAGER
     ------------------------------------------------------------ */
  
  /**
   * AIManager
   * Gestisce il provider AI attivo e fornisce un'interfaccia unificata.
   */
  class AIManager {
    constructor() {
      this.provider = null;
      this.initialized = false;
    }

    /**
     * Inizializza il provider in base alla configurazione.
     * Per ora usa sempre QwenProvider.
     */
    initialize(config = {}) {
      if (this.initialized) {
        console.warn('[AIManager] Già inizializzato');
        return;
      }

      // Per ora, usa sempre Qwen
      // In futuro, qui si leggerà la configurazione e si sceglierà il provider
      this.provider = new QwenProvider(config);
      this.initialized = true;

      console.log('[AIManager] Inizializzato con provider:', this.provider.getName());
    }

    /**
     * Invia un messaggio alla chat AI.
     */
    async chat(message, conversationHistory = [], context = {}) {
      if (!this.initialized) {
        this.initialize();
      }

      try {
        const result = await this.provider.chat(message, conversationHistory, context);
        return result;
      } catch (error) {
        console.error('[AIManager] Errore durante la chat:', {
          error: error.message
        });
        
        // Ritorna un risultato di fallback
        return {
          success: false,
          error: error.message,
          response: 'Mi dispiace, al momento non riesco a elaborare la tua richiesta. Riprova tra qualche istante o contatta l\'assistenza se il problema persiste.',
          structuredData: null
        };
      }
    }

    /**
     * Analizza un'immagine.
     */
    async analyzeImage(imageUrl, prompt) {
      if (!this.initialized) {
        this.initialize();
      }

      try {
        const result = await this.provider.analyzeImage(imageUrl, prompt);
        return result;
      } catch (error) {
        console.error('[AIManager] Errore durante l\'analisi immagine:', {
          error: error.message
        });
        
        return {
          success: false,
          error: error.message,
          analysis: null,
          structuredData: null
        };
      }
    }

    /**
     * Restituisce il provider attivo.
     */
    getProvider() {
      if (!this.initialized) {
        this.initialize();
      }
      return this.provider;
    }

    /**
     * Verifica se il provider è configurato.
     */
    isConfigured() {
      if (!this.initialized) {
        return false;
      }
      return this.provider.isConfigured();
    }
  }

  /* ------------------------------------------------------------
     4. ESPORTAZIONE GLOBALE
     ------------------------------------------------------------ */
  
  // Crea l'istanza globale del manager
  const aiManager = new AIManager();

  // Esporta tutto nell'oggetto globale window.Amarreda
  window.Amarreda = window.Amarreda || {};
  window.Amarreda.AI = {
    Manager: aiManager,
    Provider: {
      Base: AIProvider,
      Qwen: QwenProvider
    },
    
    // Shortcut per chat e analisi immagini
    chat: aiManager.chat.bind(aiManager),
    analyzeImage: aiManager.analyzeImage.bind(aiManager)
  };

  // Inizializza automaticamente con configurazione di default
  aiManager.initialize({
    backendUrl: '/api/ai',
    model: 'qwen-plus'
  });

})(window);
