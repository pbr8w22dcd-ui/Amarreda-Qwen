/* ============================================================
   AMARREDA — project-export.js
   Gestione Export, Download e Salvataggio PDF Finale
   
   Architettura:
   - Il PDF viene generato lato server dall'Agente #4 (n8n/backend)
   - Questo modulo riceve l'URL del PDF generato
   - Salva il link nel database Supabase (tabella 'projects' o 'project_files')
   - Fornisce metodi per visualizzare, scaricare e condividere il documento
   
   Funzionalità:
   - Salvataggio automatico del PDF nel progetto utente (CRM)
   - Download diretto del file
   - Visualizzazione in nuova scheda
   - Controllo stato generazione (polling)
   
   Sicurezza:
   - I PDF sono salvati in storage sicuro (es. Supabase Storage)
   - L'accesso è protetto da Row Level Security (RLS)
   ============================================================ */

(function (window) {
  'use strict';

  /* ------------------------------------------------------------
     1. COSTANTI E CONFIGURAZIONE
     ------------------------------------------------------------ */
  
  const EXPORT_CONFIG = {
    // Configurazione Supabase
    SUPABASE_URL: null,
    SUPABASE_KEY: null,
    
    // Tabelle Supabase
    TABLE_PROJECTS: 'projects',
    TABLE_FILES: 'project_files',
    
    // Configurazione Storage (Supabase Storage)
    STORAGE_BUCKET: 'project-pdfs',
    
    // Polling per controllare se il PDF è pronto
    POLLING_INTERVAL: 3000, // 3 secondi
    MAX_POLLING_ATTEMPTS: 20 // Max 1 minuto di attesa
  };

  /* ------------------------------------------------------------
     2. PROJECT EXPORT MANAGER — GESTORE PRINCIPALE
     ------------------------------------------------------------ */
  
  class ProjectExportManager {
    constructor(config = {}) {
      this.supabaseUrl = config.supabaseUrl || EXPORT_CONFIG.SUPABASE_URL;
      this.supabaseKey = config.supabaseKey || EXPORT_CONFIG.SUPABASE_KEY;
    }

    /**
     * Salva il link del PDF generato nel progetto utente (CRM).
     * @param {string} projectId - ID del progetto
     * @param {string} pdfUrl - URL del PDF generato dall'Agente #4
     */
    async savePdfToProject(projectId, pdfUrl) {
      if (!this.supabaseUrl || !this.supabaseKey) {
        console.warn('[ProjectExport] Supabase non configurato');
        return false;
      }

      try {
        const response = await fetch(
          `${this.supabaseUrl}/rest/v1/${EXPORT_CONFIG.TABLE_PROJECTS}?id=eq.${projectId}`,
          {
            method: 'PATCH',
            headers: {
              'apikey': this.supabaseKey,
              'Authorization': `Bearer ${this.supabaseKey}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
              pdf_url: pdfUrl,
              pdf_generated_at: new Date().toISOString(),
              status: 'completed'
            })
          }
        );

        if (!response.ok) throw new Error(`Errore Supabase: ${response.status}`);
        
        console.log('[ProjectExport] PDF salvato nel progetto:', projectId);
        return true;

      } catch (error) {
        console.error('[ProjectExport] Errore salvataggio PDF:', error.message);
        return false;
      }
    }

    /**
     * Registra il file nella tabella 'project_files' per archivio completo.
     * @param {string} projectId - ID del progetto
     * @param {string} pdfUrl - URL del PDF
     * @param {string} fileName - Nome del file (es. "Progetto_Cucina_Mario.pdf")
     */
    async archiveFile(projectId, pdfUrl, fileName) {
      if (!this.supabaseUrl || !this.supabaseKey) {
        return false;
      }

      try {
        const response = await fetch(
          `${this.supabaseUrl}/rest/v1/${EXPORT_CONFIG.TABLE_FILES}`,
          {
            method: 'POST',
            headers: {
              'apikey': this.supabaseKey,
              'Authorization': `Bearer ${this.supabaseKey}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
              project_id: projectId,
              file_type: 'pdf_final',
              file_name: fileName,
              file_url: pdfUrl,
              created_at: new Date().toISOString()
            })
          }
        );

        if (!response.ok) throw new Error(`Errore Supabase: ${response.status}`);
        return true;

      } catch (error) {
        console.error('[ProjectExport] Errore archiviazione file:', error.message);
        return false;
      }
    }

    /**
     * Scarica il PDF direttamente nel dispositivo dell'utente.
     * @param {string} pdfUrl - URL del PDF
     * @param {string} fileName - Nome del file per il download
     */
    downloadPdf(pdfUrl, fileName = 'Progetto_Amarreda.pdf') {
      if (!pdfUrl) {
        console.error('[ProjectExport] URL PDF non valido');
        return;
      }

      // Crea un link temporaneo per forzare il download
      const link = document.createElement('a');
      link.href = pdfUrl;
      link.download = fileName;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    /**
     * Apre il PDF in una nuova scheda del browser.
     * @param {string} pdfUrl - URL del PDF
     */
    viewPdf(pdfUrl) {
      if (!pdfUrl) {
        console.error('[ProjectExport] URL PDF non valido');
        return;
      }
      window.open(pdfUrl, '_blank', 'noopener,noreferrer');
    }

    /**
     * Controlla se il PDF è stato generato (Polling).
     * Utile se la generazione è asincrona e l'utente è in attesa.
     * @param {string} projectId - ID del progetto
     * @param {function} onReady - Callback chiamata quando il PDF è pronto
     * @param {function} onProgress - Callback chiamata durante l'attesa
     */
    async waitForPdf(projectId, onReady, onProgress) {
      let attempts = 0;

      while (attempts < EXPORT_CONFIG.MAX_POLLING_ATTEMPTS) {
        const pdfUrl = await this.checkPdfStatus(projectId);

        if (pdfUrl) {
          if (onReady) onReady(pdfUrl);
          return pdfUrl;
        }

        if (onProgress) onProgress(attempts);
        
        await this._sleep(EXPORT_CONFIG.POLLING_INTERVAL);
        attempts++;
      }

      throw new Error('Timeout: generazione PDF troppo lunga');
    }

    /**
     * Controlla lo stato attuale del PDF per un progetto.
     * @param {string} projectId - ID del progetto
     * @returns {Promise<string|null>} URL del PDF o null se non pronto
     */
    async checkPdfStatus(projectId) {
      if (!this.supabaseUrl || !this.supabaseKey) return null;

      try {
        const response = await fetch(
          `${this.supabaseUrl}/rest/v1/${EXPORT_CONFIG.TABLE_PROJECTS}?id=eq.${projectId}&select=pdf_url,status`,
          {
            headers: {
              'apikey': this.supabaseKey,
              'Authorization': `Bearer ${this.supabaseKey}`
            }
          }
        );

        if (!response.ok) return null;

        const data = await response.json();
        if (data.length > 0 && data[0].pdf_url) {
          return data[0].pdf_url;
        }

        return null;

      } catch (error) {
        console.error('[ProjectExport] Errore controllo stato:', error.message);
        return null;
      }
    }

    /* ------------------------------------------------------------
       METODI PRIVATI
       ------------------------------------------------------------ */

    /**
     * Utility per attendere.
     * @private
     */
    _sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }
  }

  /* ------------------------------------------------------------
     3. ESPORTAZIONE GLOBALE
     ------------------------------------------------------------ */
  
  const exportManager = new ProjectExportManager();

  window.Amarreda = window.Amarreda || {};
  window.Amarreda.Export = {
    Manager: exportManager,
    Config: EXPORT_CONFIG,
    
    // Shortcut
    save: exportManager.savePdfToProject.bind(exportManager),
    archive: exportManager.archiveFile.bind(exportManager),
    download: exportManager.downloadPdf.bind(exportManager),
    view: exportManager.viewPdf.bind(exportManager),
    waitFor: exportManager.waitForPdf.bind(exportManager),
    checkStatus: exportManager.checkPdfStatus.bind(exportManager)
  };

})(window);
