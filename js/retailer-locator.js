/* ============================================================
   AMARREDA — retailer-locator.js
   Geolocalizzazione e abbinamento Rivenditori (per CAP)
   
   Architettura:
   - I rivenditori sono archiviati in Supabase (tabella 'retailers')
   - Campi chiave: cap, provincia, indirizzo, contatti, zona_copertura
   - La località dell'utente (CAP) viene usata SOLO per questo abbinamento
   - L'abbinamento avviene alla fine del flusso (dopo la generazione del PDF)
   
   Funzionalità:
   - Ricerca rivenditore per CAP esatto
   - Fallback su ricerca per provincia (prime 2 cifre del CAP)
   - Formattazione contatti per UI e PDF
   - Generazione link per prenotazione appuntamento
   
   Sicurezza:
   - Lettura dati da Supabase con Row Level Security (RLS)
   - Nessun dato sensibile esposto
   ============================================================ */

(function (window) {
  'use strict';

  /* ------------------------------------------------------------
     1. COSTANTI E CONFIGURAZIONE
     ------------------------------------------------------------ */
  
  const RETAILER_CONFIG = {
    // Configurazione Supabase
    SUPABASE_URL: null,
    SUPABASE_KEY: null,
    
    // Tabella rivenditori
    TABLE_RETAILERS: 'retailers',
    
    // Messaggi UI
    MESSAGES: {
      NO_RETAILER_FOUND: "Al momento non abbiamo un rivenditore partner nella tua zona. Ti contatteremo a breve per proporti una soluzione alternativa.",
      APPOINTMENT_SUBJECT: "Richiesta appuntamento - Progetto Amarreda",
      APPOINTMENT_BODY: "Buongiorno, ho completato il mio progetto di interior design su Amarreda e vorrei fissare un appuntamento per discuterne."
    }
  };

  /* ------------------------------------------------------------
     2. RETAILER LOCATOR — GESTORE PRINCIPALE
     ------------------------------------------------------------ */
  
  class RetailerLocator {
    constructor(config = {}) {
      this.supabaseUrl = config.supabaseUrl || RETAILER_CONFIG.SUPABASE_URL;
      this.supabaseKey = config.supabaseKey || RETAILER_CONFIG.SUPABASE_KEY;
    }

    /**
     * Trova il rivenditore migliore per un dato CAP.
     * Logica:
     * 1. Cerca corrispondenza esatta del CAP.
     * 2. Se non trova, cerca nella stessa provincia (prime 2 cifre del CAP).
     * 3. Se non trova, restituisce null.
     * 
     * @param {string} userCap - CAP dell'utente (es. "20121")
     * @returns {Promise<Object|null>} Oggetto rivenditore o null
     */
    async findRetailer(userCap) {
      if (!userCap || userCap.length !== 5) {
        console.warn('[RetailerLocator] CAP non valido:', userCap);
        return null;
      }

      if (!this.supabaseUrl || !this.supabaseKey) {
        console.warn('[RetailerLocator] Supabase non configurato');
        return null;
      }

      try {
        // 1. Tentativo: CAP esatto
        let retailer = await this._queryRetailer('cap', 'eq', userCap);
        
        if (retailer) {
          retailer.matchType = 'exact_cap';
          return this._formatRetailer(retailer);
        }

        // 2. Tentativo: Provincia (prime 2 cifre del CAP italiano)
        const provincePrefix = userCap.substring(0, 2);
        retailer = await this._queryRetailer('cap', 'like', `${provincePrefix}%`);
        
        if (retailer) {
          retailer.matchType = 'province_fallback';
          return this._formatRetailer(retailer);
        }

        // Nessun rivenditore trovato
        return null;

      } catch (error) {
        console.error('[RetailerLocator] Errore ricerca rivenditore:', error.message);
        return null;
      }
    }

    /**
     * Genera un link mailto per prenotare un appuntamento.
     * @param {Object} retailer - Oggetto rivenditore formattato
     * @param {string} projectId - ID del progetto (per riferimento)
     */
    generateAppointmentLink(retailer, projectId) {
      if (!retailer || !retailer.email) return null;

      const subject = encodeURIComponent(`${RETAILER_CONFIG.MESSAGES.APPOINTMENT_SUBJECT} [${projectId}]`);
      const body = encodeURIComponent(
        `${RETAILER_CONFIG.MESSAGES.APPOINTMENT_BODY}\n\n` +
        `ID Progetto: ${projectId}\n` +
        `Rivenditore: ${retailer.name}\n` +
        `Zona: ${retailer.city} (${retailer.cap})\n\n` +
        `Attendo un vostro gentile riscontro per concordare data e ora.`
      );

      return `mailto:${retailer.email}?subject=${subject}&body=${body}`;
    }

    /**
     * Genera un link tel: per chiamata diretta.
     */
    generatePhoneLink(retailer) {
      if (!retailer || !retailer.phone) return null;
      // Rimuove spazi e caratteri speciali per il link tel:
      const cleanPhone = retailer.phone.replace(/[\s\-\(\)]/g, '');
      return `tel:${cleanPhone}`;
    }

    /* ------------------------------------------------------------
       METODI PRIVATI
       ------------------------------------------------------------ */

    /**
     * Esegue la query su Supabase.
     * @private
     */
    async _queryRetailer(column, operator, value) {
      const url = `${this.supabaseUrl}/rest/v1/${RETAILER_CONFIG.TABLE_RETAILERS}?${column}=${operator}.${value}&select=*&limit=1`;
      
      const response = await fetch(url, {
        headers: {
          'apikey': this.supabaseKey,
          'Authorization': `Bearer ${this.supabaseKey}`
        }
      });

      if (!response.ok) {
        throw new Error(`Errore Supabase: ${response.status}`);
      }

      const data = await response.json();
      return data.length > 0 ? data[0] : null;
    }

    /**
     * Formatta l'oggetto rivenditore per l'uso nell'UI e nel PDF.
     * @private
     */
    _formatRetailer(rawData) {
      return {
        id: rawData.id,
        name: rawData.name || 'Rivenditore Partner',
        brand: rawData.brand || null,
        address: rawData.address || '',
        city: rawData.city || '',
        cap: rawData.cap || '',
        phone: rawData.phone || null,
        email: rawData.email || null,
        website: rawData.website || null,
        matchType: rawData.matchType || 'unknown',
        matchLabel: rawData.matchType === 'exact_cap' 
          ? 'Rivenditore nella tua zona' 
          : 'Rivenditore nella tua provincia'
      };
    }
  }

  /* ------------------------------------------------------------
     3. ESPORTAZIONE GLOBALE
     ------------------------------------------------------------ */
  
  const retailerLocator = new RetailerLocator();

  window.Amarreda = window.Amarreda || {};
  window.Amarreda.Retailer = {
    Locator: retailerLocator,
    Config: RETAILER_CONFIG,
    
    // Shortcut
    find: retailerLocator.findRetailer.bind(retailerLocator),
    appointmentLink: retailerLocator.generateAppointmentLink.bind(retailerLocator),
    phoneLink: retailerLocator.generatePhoneLink.bind(retailerLocator)
  };

})(window);
