/* ============================================================
   AMARREDA — affiliate-products.js
   Gestione Prodotti Affiliati (Web/API)
   
   Architettura:
   - I prodotti affiliati sono SEPARATI dal listino core (Supabase)
   - Vengono recuperati da API esterne (es. Amazon, Wayfair, network affiliati)
   - Hanno un prezzo FISSO (non range Min/Max) e un link tracciato
   - Vengono inseriti nel Rendering (Agente #3) e nel PDF (Agente #4)
   
   Funzionalità:
   - Ricerca e filtro prodotti per categoria, stile, prezzo
   - Generazione link affiliati con tracking ID
   - Integrazione con il progetto corrente
   - Cache locale per evitare chiamate API ripetute
   
   Sicurezza:
   - Le API key dei network affiliati restano nel backend/n8n
   - Il frontend riceve solo i dati già processati
   ============================================================ */

(function (window) {
  'use strict';

  /* ------------------------------------------------------------
     1. COSTANTI E CONFIGURAZIONE
     ------------------------------------------------------------ */
  
  const AFFILIATE_CONFIG = {
    // Configurazione Backend/n8n
    BACKEND_URL: '/api/affiliates',
    N8N_WEBHOOK_URL: null,
    N8N_ENABLED: false,
    
    // ID Tracking (da impostare con i tuoi ID reali)
    TRACKING_ID: 'amarreda_2026',
    
    // Categorie supportate
    CATEGORIES: [
      'tavoli',
      'sedie',
      'illuminazione',
      'complementi',
      'tessili',
      'decorazioni',
      'piante',
      'specchi'
    ],
    
    // Cache
    CACHE_ENABLED: true,
    CACHE_MAX_SIZE: 50,
    CACHE_TTL: 3600000 // 1 ora in millisecondi
  };

  /* ------------------------------------------------------------
     2. AFFILIATE MANAGER — GESTORE PRINCIPALE
     ------------------------------------------------------------ */
  
  class AffiliateManager {
    constructor(config = {}) {
      this.backendUrl = config.backendUrl || AFFILIATE_CONFIG.BACKEND_URL;
      this.n8nWebhookUrl = config.n8nWebhookUrl || AFFILIATE_CONFIG.N8N_WEBHOOK_URL;
      this.n8nEnabled = config.n8nEnabled || AFFILIATE_CONFIG.N8N_ENABLED;
      this.trackingId = config.trackingId || AFFILIATE_CONFIG.TRACKING_ID;
      
      this.cache = new Map();
      this.projectAffiliates = new Map(); // Prodotti affiliati per progetto
    }

    /**
     * Cerca prodotti affiliati.
     * @param {Object} filters - { category, style, maxPrice, minPrice, keyword }
     * @returns {Promise<Array>} Lista prodotti
     */
    async searchProducts(filters = {}) {
      const cacheKey = JSON.stringify(filters);
      
      // Controllo cache
      if (AFFILIATE_CONFIG.CACHE_ENABLED && this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey);
        if (Date.now() - cached.timestamp < AFFILIATE_CONFIG.CACHE_TTL) {
          return cached.data;
        }
      }

      try {
        let response;
        
        if (this.n8nEnabled && this.n8nWebhookUrl) {
          response = await fetch(this.n8nWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'search_affiliates', filters })
          });
        } else {
          const queryParams = new URLSearchParams(filters).toString();
          response = await fetch(`${this.backendUrl}/search?${queryParams}`, {
            headers: { 'Authorization': `Bearer ${this._getAuthToken()}` }
          });
        }

        if (!response.ok) throw new Error(`Errore API: ${response.status}`);
        
        const products = await response.json();
        
        // Aggiungi alla cache
        if (AFFILIATE_CONFIG.CACHE_ENABLED) {
          this.cache.set(cacheKey, { data: products, timestamp: Date.now() });
        }

        return products;

      } catch (error) {
        console.error('[AffiliateManager] Errore ricerca:', error.message);
        return [];
      }
    }

    /**
     * Aggiunge un prodotto affiliato a un progetto.
     * @param {string} projectId - ID del progetto
     * @param {Object} product - Prodotto affiliato
     */
    addToProject(projectId, product) {
      if (!this.projectAffiliates.has(projectId)) {
        this.projectAffiliates.set(projectId, []);
      }

      const affiliates = this.projectAffiliates.get(projectId);
      
      // Evita duplicati
      if (affiliates.some(p => p.id === product.id)) {
        return false;
      }

      // Aggiungi link tracciato
      const trackedProduct = {
        ...product,
        affiliateLink: this._generateAffiliateLink(product.originalLink),
        addedAt: new Date().toISOString()
      };

      affiliates.push(trackedProduct);
      return trackedProduct;
    }

    /**
     * Ottieni i prodotti affiliati di un progetto.
     */
    getProjectAffiliates(projectId) {
      return this.projectAffiliates.get(projectId) || [];
    }

    /**
     * Rimuovi un prodotto affiliato da un progetto.
     */
    removeFromProject(projectId, productId) {
      const affiliates = this.projectAffiliates.get(projectId) || [];
      const filtered = affiliates.filter(p => p.id !== productId);
      this.projectAffiliates.set(projectId, filtered);
      return filtered;
    }

    /**
     * Calcola il totale dei prodotti affiliati per un progetto.
     */
    calculateTotal(projectId) {
      const affiliates = this.getProjectAffiliates(projectId);
      return affiliates.reduce((sum, p) => sum + (p.price || 0), 0);
    }

    /**
     * Formatta i dati per il PDF (Agente #4).
     */
    formatForPDF(projectId) {
      const affiliates = this.getProjectAffiliates(projectId);
      return affiliates.map(p => ({
        name: p.name,
        brand: p.brand,
        category: p.category,
        price: p.price,
        formattedPrice: this._formatCurrency(p.price),
        affiliateLink: p.affiliateLink,
        imageUrl: p.imageUrl,
        description: p.description
      }));
    }

    /**
     * Svuota la cache.
     */
    clearCache() {
      this.cache.clear();
    }

    /* ------------------------------------------------------------
       METODI PRIVATI
       ------------------------------------------------------------ */

    /**
     * Genera un link affiliato con tracking.
     * @private
     */
    _generateAffiliateLink(originalLink) {
      if (!originalLink) return '#';
      
      try {
        const url = new URL(originalLink);
        url.searchParams.set('ref', this.trackingId);
        url.searchParams.set('utm_source', 'amarreda');
        url.searchParams.set('utm_medium', 'affiliate');
        url.searchParams.set('utm_campaign', 'project_recommendation');
        return url.toString();
      } catch (e) {
        return originalLink;
      }
    }

    /**
     * Formatta un prezzo in Euro.
     * @private
     */
    _formatCurrency(amount) {
      if (amount === null || amount === undefined) return 'N/D';
      return new Intl.NumberFormat('it-IT', {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      }).format(amount);
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
  
  const affiliateManager = new AffiliateManager();

  window.Amarreda = window.Amarreda || {};
  window.Amarreda.Affiliates = {
    Manager: affiliateManager,
    Config: AFFILIATE_CONFIG,
    Categories: AFFILIATE_CONFIG.CATEGORIES,
    
    // Shortcut
    search: affiliateManager.searchProducts.bind(affiliateManager),
    add: affiliateManager.addToProject.bind(affiliateManager),
    get: affiliateManager.getProjectAffiliates.bind(affiliateManager),
    remove: affiliateManager.removeFromProject.bind(affiliateManager),
    total: affiliateManager.calculateTotal.bind(affiliateManager),
    forPdf: affiliateManager.formatForPDF.bind(affiliateManager)
  };

})(window);
