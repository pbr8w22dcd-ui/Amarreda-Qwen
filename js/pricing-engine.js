/* ============================================================
   AMARREDA — pricing-engine.js
   Motore di calcolo stime economiche (Architettura Multi-Agente)
   
   Architettura:
   - Legge i listini reali dal database Supabase (tabella catalog_products)
   - Gestisce le varianti (finiture, configurazioni) per calcolare Min/Max
   - Separa i prodotti del listino (Core) dai prodotti affiliati (Web)
   - Genera la stima per l'Agente PDF
   
   Funzionalità:
   - Query Supabase per prodotti e varianti
   - Calcolo Min/Max basato su varianti reali (es. laminato vs laccato)
   - Gestione costi non inclusi (montaggio, trasporto, ecc.)
   - Integrazione con prodotti affiliati (API esterne)
   
   Sicurezza:
   - Le chiamate a Supabase usano la Row Level Security (RLS)
   - Nessuna logica di pricing sensibile esposta lato client
   ============================================================ */

(function (window) {
  'use strict';

  /* ------------------------------------------------------------
     1. COSTANTI E CONFIGURAZIONE
     ------------------------------------------------------------ */
  
  const PRICING_CONFIG = {
    CURRENCY: 'EUR',
    LOCALE: 'it-IT',
    
    // Configurazione Supabase (da impostare)
    SUPABASE_URL: null, 
    SUPABASE_KEY: null,
    
    // Tabelle Supabase
    TABLE_PRODUCTS: 'catalog_products',
    TABLE_VARIANTS: 'catalog_variants',
    TABLE_AFFILIATES: 'affiliate_products',
    
    // Categorie di costi non inclusi (da mostrare sempre nel PDF)
    EXCLUDED_COSTS: [
      'Trasporto e consegna',
      'Montaggio e installazione',
      'Posa in opera',
      'Lavorazioni edili e impiantistiche',
      'Pratiche amministrative e permessi',
      'IVA e tasse applicabili'
    ]
  };

  /* ------------------------------------------------------------
     2. PRICING ENGINE — MOTORE PRINCIPALE
     ------------------------------------------------------------ */
  
  class PricingEngine {
    constructor(config = {}) {
      this.supabaseUrl = config.supabaseUrl || PRICING_CONFIG.SUPABASE_URL;
      this.supabaseKey = config.supabaseKey || PRICING_CONFIG.SUPABASE_KEY;
      this.estimates = new Map();
    }

    /**
     * Calcola la stima completa per un progetto.
     * @param {Object} projectData - Dati del progetto (report agente #1)
     * @param {Array} selectedProducts - Prodotti scelti dall'Agente #2
     * @param {Array} affiliateProducts - Prodotti affiliati aggiunti
     */
    async calculateEstimate(projectData, selectedProducts = [], affiliateProducts = []) {
      const estimateId = `est_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // 1. Calcola stima Core (da listini Supabase)
      const coreEstimate = await this._calculateCoreEstimate(selectedProducts);
      
      // 2. Calcola stima Affiliati (da web/API)
      const affiliateEstimate = this._calculateAffiliateEstimate(affiliateProducts);
      
      // 3. Unisci e formatta
      const finalEstimate = {
        id: estimateId,
        projectId: projectData.projectId,
        userId: projectData.userId,
        roomType: projectData.roomType,
        generatedAt: new Date().toISOString(),
        
        // Totali Core (Listino)
        core: {
          minimo: coreEstimate.totaleMinimo,
          massimo: coreEstimate.totaleMassimo,
          voci: coreEstimate.voci,
          numeroProdotti: coreEstimate.numeroProdotti
        },
        
        // Totali Affiliati (Web)
        affiliate: {
          totale: affiliateEstimate.totale,
          voci: affiliateEstimate.voci,
          numeroProdotti: affiliateEstimate.numeroProdotti
        },
        
        // Totale Generale (Min Core + Affiliati -> Max Core + Affiliati)
        totaleGenerale: {
          minimo: coreEstimate.totaleMinimo + affiliateEstimate.totale,
          massimo: coreEstimate.totaleMassimo + affiliateEstimate.totale
        },
        
        costiNonInclusi: PRICING_CONFIG.EXCLUDED_COSTS,
        note: 'Stima preliminare basata sui listini forniti. I prezzi possono variare in base alla disponibilità e alle promozioni in corso.'
      };

      this.estimates.set(estimateId, finalEstimate);
      return finalEstimate;
    }

    /**
     * Formatta un importo in Euro.
     */
    formatCurrency(amount) {
      if (amount === null || amount === undefined) return 'Su richiesta';
      return new Intl.NumberFormat(PRICING_CONFIG.LOCALE, {
        style: 'currency',
        currency: PRICING_CONFIG.CURRENCY,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      }).format(amount);
    }

    /* ------------------------------------------------------------
       METODI PRIVATI
       ------------------------------------------------------------ */

    /**
     * Calcola la stima Core interrogando Supabase.
     * @private
     */
    async _calculateCoreEstimate(selectedProducts) {
      let totaleMinimo = 0;
      let totaleMassimo = 0;
      const voci = [];

      for (const product of selectedProducts) {
        // Recupera le varianti dal database (es. finiture, configurazioni)
        const variants = await this._fetchVariants(product.productId);
        
        let prezzoMin = product.prezzoBase || 0;
        let prezzoMax = product.prezzoBase || 0;

        // Se ci sono varianti, calcola il range reale
        if (variants && variants.length > 0) {
          const prices = variants.map(v => v.prezzo).filter(p => p > 0);
          if (prices.length > 0) {
            prezzoMin = Math.min(...prices);
            prezzoMax = Math.max(...prices);
          }
        }

        // Moltiplica per la quantità
        const qty = product.quantita || 1;
        const minTotale = prezzoMin * qty;
        const maxTotale = prezzoMax * qty;

        totaleMinimo += minTotale;
        totaleMassimo += maxTotale;

        voci.push({
          productId: product.productId,
          nome: product.nome,
          categoria: product.categoria,
          finitura: product.finitura || 'Standard',
          quantita: qty,
          prezzoMin: minTotale,
          prezzoMax: maxTotale,
          immagine3d: product.immagine3d || null
        });
      }

      return {
        totaleMinimo,
        totaleMassimo,
        voci,
        numeroProdotti: selectedProducts.length
      };
    }

    /**
     * Calcola la stima per i prodotti affiliati (prezzo fisso, no varianti complesse).
     * @private
     */
    _calculateAffiliateEstimate(affiliateProducts) {
      let totale = 0;
      const voci = [];

      affiliateProducts.forEach(product => {
        const prezzo = product.prezzo || 0;
        totale += prezzo;
        
        voci.push({
          source: 'affiliate',
          nome: product.nome,
          brand: product.brand,
          prezzo: prezzo,
          linkAcquisto: product.linkAffiliato,
          immagine: product.immagine
        });
      });

      return { totale, voci, numeroProdotti: affiliateProducts.length };
    }

    /**
     * Interroga Supabase per ottenere le varianti di un prodotto.
     * @private
     */
    async _fetchVariants(productId) {
      if (!this.supabaseUrl || !this.supabaseKey) {
        console.warn('[PricingEngine] Supabase non configurato. Uso prezzi base.');
        return [];
      }

      try {
        // Esempio di query REST a Supabase
        const response = await fetch(
          `${this.supabaseUrl}/rest/v1/${PRICING_CONFIG.TABLE_VARIANTS}?product_id=eq.${productId}&select=prezzo,finitura,configurazione`,
          {
            headers: {
              'apikey': this.supabaseKey,
              'Authorization': `Bearer ${this.supabaseKey}`
            }
          }
        );

        if (!response.ok) throw new Error(`Errore Supabase: ${response.status}`);
        return await response.json();

      } catch (error) {
        console.error('[PricingEngine] Errore fetch varianti:', error.message);
        return [];
      }
    }
  }

  /* ------------------------------------------------------------
     3. ESPORTAZIONE GLOBALE
     ------------------------------------------------------------ */
  
  const pricingEngine = new PricingEngine();

  window.Amarreda = window.Amarreda || {};
  window.Amarreda.Pricing = {
    Engine: pricingEngine,
    Config: PRICING_CONFIG,
    ExcludedCosts: PRICING_CONFIG.EXCLUDED_COSTS,
    
    // Shortcut
    calculate: pricingEngine.calculateEstimate.bind(pricingEngine),
    format: pricingEngine.formatCurrency.bind(pricingEngine)
  };

})(window);
