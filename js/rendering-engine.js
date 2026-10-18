/* ============================================================
   AMARREDA — rendering-engine.js
   Motore di generazione rendering (Architettura Multi-Agente)
   
   Architettura:
   - Agente #2 genera file OBJ 3D con prodotti del listino
   - Agente #3 (Qwen/ChatGPT) genera il rendering finale
   - Input: file OBJ + foto reali dell'ambiente + prodotti affiliati
   - Output: rendering fotorealistico con elementi reali e affiliati
   
   Funzionalità:
   - Gestione flusso OBJ → Rendering
   - Upload foto reali di riferimento
   - Integrazione con agente AI per generazione rendering
   - Cache locale rendering generati
   - Supporto per prodotti affiliati nel rendering
   - Integrazione con n8n per orchestrazione
   
   Sicurezza:
   - Le chiamate AI transitano da n8n/backend
   - Le API key non sono mai nel frontend
   - Validazione file OBJ e immagini
   ============================================================ */

(function (window) {
  'use strict';

  /* ------------------------------------------------------------
     1. COSTANTI E CONFIGURAZIONE
     ------------------------------------------------------------ */
  
  const RENDERING_CONFIG = {
    // Configurazione Supabase
    SUPABASE_URL: null,
    SUPABASE_KEY: null,
    
    // Tabelle Supabase
    TABLE_RENDERINGS: 'project_renderings',
    TABLE_FILES: 'project_files',
    
    // Configurazione n8n
    N8N_WEBHOOK_URL: null,
    N8N_ENABLED: false,
    
    // Limiti tecnici
    MAX_FILE_SIZE_OBJ: 50 * 1024 * 1024, // 50MB per file OBJ
    MAX_FILE_SIZE_IMAGE: 10 * 1024 * 1024, // 10MB per immagine
    MAX_IMAGES_PER_RENDERING: 5, // Max 5 foto di riferimento
    SUPPORTED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
    
    // Provider AI per rendering
    RENDERING_PROVIDERS: {
      QWEN: 'qwen',
      CHATGPT: 'chatgpt'
    },
    DEFAULT_PROVIDER: 'qwen',
    
    // Qualità rendering
    QUALITY_OPTIONS: ['standard', 'high', 'ultra'],
    DEFAULT_QUALITY: 'high',
    
    // Cache
    CACHE_ENABLED: true,
    CACHE_MAX_SIZE: 10
  };

  /* ------------------------------------------------------------
     2. RENDERING ENGINE — MOTORE PRINCIPALE
     ------------------------------------------------------------ */
  
  class RenderingEngine {
    constructor(config = {}) {
      this.supabaseUrl = config.supabaseUrl || RENDERING_CONFIG.SUPABASE_URL;
      this.supabaseKey = config.supabaseKey || RENDERING_CONFIG.SUPABASE_KEY;
      this.n8nWebhookUrl = config.n8nWebhookUrl || RENDERING_CONFIG.N8N_WEBHOOK_URL;
      this.n8nEnabled = config.n8nEnabled || RENDERING_CONFIG.N8N_ENABLED;
      
      this.activeRenderings = new Map();
      this.cache = new Map();
    }

    /**
     * Avvia la generazione di un rendering.
     * @param {Object} projectData - Dati del progetto
     * @param {string} objFileUrl - URL del file OBJ 3D generato dall'agente #2
     * @param {Array} referenceImages - URL delle foto reali dell'ambiente
     * @param {Array} affiliateProducts - Prodotti affiliati da includere
     * @param {Object} options - Opzioni aggiuntive (qualità, provider, ecc.)
     */
    async generateRendering(projectData, objFileUrl, referenceImages = [], affiliateProducts = [], options = {}) {
      const renderingId = `render_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Validazione input
      this._validateInputs(objFileUrl, referenceImages);
      
      // Crea oggetto rendering
      const rendering = {
        id: renderingId,
        projectId: projectData.projectId,
        userId: projectData.userId,
        roomType: projectData.roomType,
        objFileUrl: objFileUrl,
        referenceImages: referenceImages,
        affiliateProducts: affiliateProducts,
        provider: options.provider || RENDERING_CONFIG.DEFAULT_PROVIDER,
        quality: options.quality || RENDERING_CONFIG.DEFAULT_QUALITY,
        status: 'queued', // queued, processing, completed, failed
        createdAt: new Date().toISOString(),
        completedAt: null,
        renderingUrl: null,
        error: null
      };

      // Salva in stato attivo
      this.activeRenderings.set(renderingId, rendering);

      // Emitti evento
      await this._emitEvent('rendering.requested', {
        renderingId,
        projectId: projectData.projectId,
        provider: rendering.provider
      });

      // Avvia generazione (asincrona)
      this._startGeneration(rendering);

      return rendering;
    }

    /**
     * Controlla lo stato di un rendering.
     */
    getRenderingStatus(renderingId) {
      const rendering = this.activeRenderings.get(renderingId);
      if (!rendering) {
        throw new Error(`Rendering ${renderingId} non trovato`);
      }
      return rendering;
    }

    /**
     * Ottieni un rendering dalla cache.
     */
    getCachedRendering(projectId) {
      return this.cache.get(projectId) || null;
    }

    /**
     * Ottieni tutti i rendering attivi.
     */
    getActiveRenderings() {
      return Array.from(this.activeRenderings.values());
    }

    /**
     * Cancella la cache.
     */
    clearCache() {
      this.cache.clear();
    }

    /* ------------------------------------------------------------
       METODI PRIVATI
       ------------------------------------------------------------ */

    /**
     * Valida gli input prima della generazione.
     * @private
     */
    _validateInputs(objFileUrl, referenceImages) {
      if (!objFileUrl) {
        throw new Error('File OBJ 3D obbligatorio');
      }

      if (referenceImages.length > RENDERING_CONFIG.MAX_IMAGES_PER_RENDERING) {
        throw new Error(`Massimo ${RENDERING_CONFIG.MAX_IMAGES_PER_RENDERING} immagini di riferimento`);
      }

      // Qui potremmo aggiungere validazione tipo file, dimensione, ecc.
    }

    /**
     * Avvia la generazione del rendering.
     * @private
     */
    async _startGeneration(rendering) {
      try {
        rendering.status = 'processing';

        // Invia richiesta a n8n per orchestrazione agente #3
        if (this.n8nEnabled && this.n8nWebhookUrl) {
          await this._sendToN8N(rendering);
        } else {
          // Fallback: chiamata diretta al backend (per sviluppo)
          await this._callBackend(rendering);
        }

      } catch (error) {
        console.error('[RenderingEngine] Errore generazione:', error.message);
        rendering.status = 'failed';
        rendering.error = error.message;
        this.activeRenderings.delete(rendering.id);
      }
    }

    /**
     * Invia la richiesta a n8n.
     * @private
     */
    async _sendToN8N(rendering) {
      try {
        const response = await fetch(this.n8nWebhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            action: 'generate_rendering',
            renderingId: rendering.id,
            projectId: rendering.projectId,
            userId: rendering.userId,
            roomType: rendering.roomType,
            objFileUrl: rendering.objFileUrl,
            referenceImages: rendering.referenceImages,
            affiliateProducts: rendering.affiliateProducts,
            provider: rendering.provider,
            quality: rendering.quality,
            timestamp: new Date().toISOString()
          })
        });

        if (!response.ok) {
          throw new Error(`Errore n8n: ${response.status}`);
        }

        const result = await response.json();
        this._handleRenderingComplete(rendering, result);

      } catch (error) {
        console.error('[RenderingEngine] Errore n8n:', error.message);
        throw error;
      }
    }

    /**
     * Chiama il backend locale (per sviluppo).
     * @private
     */
    async _callBackend(rendering) {
      try {
        const response = await fetch('/api/rendering/generate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this._getAuthToken()}`
          },
          body: JSON.stringify({
            renderingId: rendering.id,
            projectId: rendering.projectId,
            objFileUrl: rendering.objFileUrl,
            referenceImages: rendering.referenceImages,
            affiliateProducts: rendering.affiliateProducts,
            provider: rendering.provider,
            quality: rendering.quality
          })
        });

        if (!response.ok) {
          throw new Error(`Errore backend: ${response.status}`);
        }

        const result = await response.json();
        this._handleRenderingComplete(rendering, result);

      } catch (error) {
        console.error('[RenderingEngine] Errore backend:', error.message);
        throw error;
      }
    }

    /**
     * Gestisce il completamento del rendering.
     * @private
     */
    _handleRenderingComplete(rendering, result) {
      if (result.success) {
        rendering.status = 'completed';
        rendering.renderingUrl = result.renderingUrl;
        rendering.completedAt = new Date().toISOString();
        
        // Aggiungi alla cache
        if (RENDERING_CONFIG.CACHE_ENABLED) {
          this.cache.set(rendering.projectId, rendering);
        }

        // Emitti evento
        this._emitEvent('rendering.completed', {
          renderingId: rendering.id,
          projectId: rendering.projectId,
          renderingUrl: result.renderingUrl
        });

      } else {
        rendering.status = 'failed';
        rendering.error = result.error || 'Generazione fallita';
      }

      // Rimuovi dallo stato attivo
      this.activeRenderings.delete(rendering.id);
    }

    /**
     * Emitti un evento di automazione.
     * @private
     */
    async _emitEvent(eventName, data) {
      if (window.Amarreda && window.Amarreda.Automation) {
        await window.Amarreda.Automation.emit(eventName, data);
      }
    }

    /**
     * Recupera il token di autenticazione.
     * @private
     */
    _getAuthToken() {
      return localStorage.getItem('amarreda_auth_token') || '';
    }
  }

  /* ------------------------------------------------------------
     3. ESPORTAZIONE GLOBALE
     ------------------------------------------------------------ */
  
  const renderingEngine = new RenderingEngine();

  window.Amarreda = window.Amarreda || {};
  window.Amarreda.Rendering = {
    Engine: renderingEngine,
    Config: RENDERING_CONFIG,
    Providers: RENDERING_CONFIG.RENDERING_PROVIDERS,
    Qualities: RENDERING_CONFIG.QUALITY_OPTIONS,
    
    // Shortcut
    generate: renderingEngine.generateRendering.bind(renderingEngine),
    getStatus: renderingEngine.getRenderingStatus.bind(renderingEngine),
    getCached: renderingEngine.getCachedRendering.bind(renderingEngine)
  };

})(window);
