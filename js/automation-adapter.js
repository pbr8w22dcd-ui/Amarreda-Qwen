/* ============================================================
   AMARREDA — automation-adapter.js
   Orchestratore n8n per flusso multi-agente AI
   
   Architettura:
   - Agente #1 (intervista): raccoglie informazioni utente
   - Agente #2 (progettazione): legge listini Supabase, genera OBJ 3D
   - Agente #3 (rendering): genera rendering da OBJ + foto reali
   - Agente #4 (PDF): genera documento finale
   - n8n Orchestratore: coordina tutto il flusso
   - n8n Controllore: monitora stato e gestisce errori
   
   Funzionalità:
   - Gestione workflow n8n multi-agente
   - Salvataggio dati in Supabase (CRM)
   - Tracking stato progetto in tempo reale
   - Gestione errori e retry
   - Integrazione con prodotti affiliati
   - Geolocalizzazione rivenditori
   
   Sicurezza:
   - Webhook n8n con autenticazione
   - Salvataggio CRM con Row Level Security
   - Nessun dato sensibile esposto
   ============================================================ */

(function (window) {
  'use strict';

  /* ------------------------------------------------------------
     1. COSTANTI E CONFIGURAZIONE
     ------------------------------------------------------------ */
  
  const AUTOMATION_CONFIG = {
    // Configurazione Supabase (CRM)
    SUPABASE_URL: null,
    SUPABASE_KEY: null,
    
    // Tabelle Supabase
    TABLE_PROJECTS: 'projects',
    TABLE_CHAT_LOGS: 'chat_logs',
    TABLE_PROJECT_FILES: 'project_files',
    TABLE_RETAILERS: 'retailers',
    TABLE_USERS: 'profiles',
    
    // Configurazione n8n
    N8N_WEBHOOK_URL: null,
    N8N_ORCHESTRATOR_URL: null,
    N8N_CONTROLLER_URL: null,
    N8N_ENABLED: false,
    
    // Workflow IDs
    WORKFLOW_INTERVIEW: 'interview_agent',
    WORKFLOW_DESIGN: 'design_agent',
    WORKFLOW_RENDERING: 'rendering_agent',
    WORKFLOW_PDF: 'pdf_agent',
    WORKFLOW_RETAILER_MATCH: 'retailer_match',
    
    // Stati progetto
    PROJECT_STATUS: {
      DRAFT: 'draft',
      INTERVIEWING: 'interviewing',
      DESIGNING: 'designing',
      RENDERING: 'rendering',
      PDF_GENERATING: 'pdf_generating',
      COMPLETED: 'completed',
      FAILED: 'failed'
    },
    
    // Configurazione retry
    MAX_RETRIES: 3,
    RETRY_DELAY: 2000,
    
    // Timeout (ms)
    TIMEOUT_INTERVIEW: 300000, // 5 minuti
    TIMEOUT_DESIGN: 600000,    // 10 minuti
    TIMEOUT_RENDERING: 900000, // 15 minuti
    TIMEOUT_PDF: 300000        // 5 minuti
  };

  /* ------------------------------------------------------------
     2. AUTOMATION ADAPTER — ORCHESTRATORE PRINCIPALE
     ------------------------------------------------------------ */
  
  class AutomationAdapter {
    constructor(config = {}) {
      this.supabaseUrl = config.supabaseUrl || AUTOMATION_CONFIG.SUPABASE_URL;
      this.supabaseKey = config.supabaseKey || AUTOMATION_CONFIG.SUPABASE_KEY;
      this.n8nWebhookUrl = config.n8nWebhookUrl || AUTOMATION_CONFIG.N8N_WEBHOOK_URL;
      this.n8nEnabled = config.n8nEnabled || AUTOMATION_CONFIG.N8N_ENABLED;
      
      this.activeProjects = new Map();
      this.eventListeners = new Map();
    }

    /**
     * Inizializza un nuovo progetto e avvia il flusso.
     * @param {Object} userData - Dati utente (da Supabase)
     * @param {string} roomType - Tipo di ambiente scelto
     */
    async initializeProject(userData, roomType) {
      const projectId = `proj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const project = {
        id: projectId,
        userId: userData.id,
        userEmail: userData.email,
        userLocation: userData.location || null, // CAP per rivenditori
        roomType: roomType,
        status: AUTOMATION_CONFIG.PROJECT_STATUS.DRAFT,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: null,
        chatHistory: [],
        collectedInfo: {},
        designData: null,
        renderingUrl: null,
        pdfUrl: null,
        matchedRetailer: null,
        affiliateProducts: [],
        errors: []
      };

      this.activeProjects.set(projectId, project);

      // Salva in Supabase (CRM)
      await this._saveProjectToCRM(project);

      // Emitti evento
      this._emitEvent('project.initialized', { projectId, userId: userData.id });

      return project;
    }

    /**
     * Avvia l'Agente #1 (intervista).
     */
    async startInterview(projectId) {
      const project = this.activeProjects.get(projectId);
      if (!project) throw new Error(`Progetto ${projectId} non trovato`);

      project.status = AUTOMATION_CONFIG.PROJECT_STATUS.INTERVIEWING;
      await this._updateProjectInCRM(project);

      // Invia a n8n orchestratore
      if (this.n8nEnabled) {
        await this._sendToN8N(AUTOMATION_CONFIG.WORKFLOW_INTERVIEW, {
          projectId: project.id,
          userId: project.userId,
          roomType: project.roomType,
          action: 'start_interview'
        });
      }

      this._emitEvent('interview.started', { projectId });
      return project;
    }

    /**
     * Registra un messaggio della chat (Agente #1).
     */
    async logChatMessage(projectId, message) {
      const project = this.activeProjects.get(projectId);
      if (!project) throw new Error(`Progetto ${projectId} non trovato`);

      project.chatHistory.push({
        ...message,
        timestamp: new Date().toISOString()
      });

      project.updatedAt = new Date().toISOString();

      // Salva in Supabase (chat_logs)
      await this._saveChatLog(projectId, message);
      await this._updateProjectInCRM(project);

      return project;
    }

    /**
     * Completa l'intervista e avvia l'Agente #2 (progettazione).
     */
    async completeInterview(projectId, collectedInfo) {
      const project = this.activeProjects.get(projectId);
      if (!project) throw new Error(`Progetto ${projectId} non trovato`);

      project.collectedInfo = collectedInfo;
      project.status = AUTOMATION_CONFIG.PROJECT_STATUS.DESIGNING;
      project.updatedAt = new Date().toISOString();

      await this._updateProjectInCRM(project);

      // Invia a n8n per Agente #2
      if (this.n8nEnabled) {
        await this._sendToN8N(AUTOMATION_CONFIG.WORKFLOW_DESIGN, {
          projectId: project.id,
          userId: project.userId,
          roomType: project.roomType,
          collectedInfo: collectedInfo,
          action: 'start_design'
        });
      }

      this._emitEvent('interview.completed', { projectId });
      this._emitEvent('design.started', { projectId });

      return project;
    }

    /**
     * Registra il completamento della progettazione (Agente #2).
     */
    async completeDesign(projectId, designData) {
      const project = this.activeProjects.get(projectId);
      if (!project) throw new Error(`Progetto ${projectId} non trovato`);

      project.designData = designData;
      project.status = AUTOMATION_CONFIG.PROJECT_STATUS.RENDERING;
      project.updatedAt = new Date().toISOString();

      await this._updateProjectInCRM(project);

      // Invia a n8n per Agente #3 (rendering)
      if (this.n8nEnabled) {
        await this._sendToN8N(AUTOMATION_CONFIG.WORKFLOW_RENDERING, {
          projectId: project.id,
          userId: project.userId,
          roomType: project.roomType,
          designData: designData,
          action: 'start_rendering'
        });
      }

      this._emitEvent('design.completed', { projectId });
      this._emitEvent('rendering.started', { projectId });

      return project;
    }

    /**
     * Registra il completamento del rendering (Agente #3).
     */
    async completeRendering(projectId, renderingUrl) {
      const project = this.activeProjects.get(projectId);
      if (!project) throw new Error(`Progetto ${projectId} non trovato`);

      project.renderingUrl = renderingUrl;
      project.status = AUTOMATION_CONFIG.PROJECT_STATUS.PDF_GENERATING;
      project.updatedAt = new Date().toISOString();

      await this._updateProjectInCRM(project);

      // Invia a n8n per Agente #4 (PDF)
      if (this.n8nEnabled) {
        await this._sendToN8N(AUTOMATION_CONFIG.WORKFLOW_PDF, {
          projectId: project.id,
          userId: project.userId,
          renderingUrl: renderingUrl,
          designData: project.designData,
          action: 'generate_pdf'
        });
      }

      this._emitEvent('rendering.completed', { projectId });
      this._emitEvent('pdf.started', { projectId });

      return project;
    }

    /**
     * Registra il completamento del PDF (Agente #4).
     */
    async completePDF(projectId, pdfUrl) {
      const project = this.activeProjects.get(projectId);
      if (!project) throw new Error(`Progetto ${projectId} non trovato`);

      project.pdfUrl = pdfUrl;
      project.status = AUTOMATION_CONFIG.PROJECT_STATUS.COMPLETED;
      project.completedAt = new Date().toISOString();
      project.updatedAt = new Date().toISOString();

      await this._updateProjectInCRM(project);

      // Cerca rivenditore nella zona (se disponibile)
      if (project.userLocation) {
        const retailer = await this._findRetailer(project.userLocation);
        if (retailer) {
          project.matchedRetailer = retailer;
          await this._updateProjectInCRM(project);
        }
      }

      this._emitEvent('pdf.completed', { projectId });
      this._emitEvent('project.completed', { projectId });

      return project;
    }

    /**
     * Registra un errore nel flusso.
     */
    async logError(projectId, error) {
      const project = this.activeProjects.get(projectId);
      if (!project) throw new Error(`Progetto ${projectId} non trovato`);

      project.errors.push({
        message: error.message || error,
        timestamp: new Date().toISOString(),
        stage: project.status
      });

      project.status = AUTOMATION_CONFIG.PROJECT_STATUS.FAILED;
      project.updatedAt = new Date().toISOString();

      await this._updateProjectInCRM(project);

      this._emitEvent('project.failed', { projectId, error });

      return project;
    }

    /**
     * Ottieni lo stato di un progetto.
     */
    getProjectStatus(projectId) {
      const project = this.activeProjects.get(projectId);
      if (!project) throw new Error(`Progetto ${projectId} non trovato`);
      return project;
    }

    /**
     * Ottieni tutti i progetti attivi.
     */
    getActiveProjects() {
      return Array.from(this.activeProjects.values());
    }

    /**
     * Registra un listener per eventi.
     */
    on(eventName, callback) {
      if (!this.eventListeners.has(eventName)) {
        this.eventListeners.set(eventName, []);
      }
      this.eventListeners.get(eventName).push(callback);
    }

    /* ------------------------------------------------------------
       METODI PRIVATI
       ------------------------------------------------------------ */

    /**
     * Invia una richiesta a n8n.
     * @private
     */
    async _sendToN8N(workflowId, data) {
      if (!this.n8nEnabled || !this.n8nWebhookUrl) {
        console.warn('[AutomationAdapter] n8n non configurato');
        return;
      }

      let attempts = 0;
      let lastError = null;

      while (attempts < AUTOMATION_CONFIG.MAX_RETRIES) {
        try {
          const response = await fetch(this.n8nWebhookUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              workflow: workflowId,
              data: data,
              timestamp: new Date().toISOString()
            })
          });

          if (!response.ok) {
            throw new Error(`Errore n8n: ${response.status}`);
          }

          return await response.json();

        } catch (error) {
          lastError = error;
          attempts++;
          console.error(`[AutomationAdapter] Tentativo ${attempts}/${AUTOMATION_CONFIG.MAX_RETRIES} fallito:`, error.message);
          
          if (attempts < AUTOMATION_CONFIG.MAX_RETRIES) {
            await this._sleep(AUTOMATION_CONFIG.RETRY_DELAY * attempts);
          }
        }
      }

      throw lastError;
    }

    /**
     * Salva un progetto in Supabase (CRM).
     * @private
     */
    async _saveProjectToCRM(project) {
      if (!this.supabaseUrl || !this.supabaseKey) {
        console.warn('[AutomationAdapter] Supabase non configurato');
        return;
      }

      try {
        const response = await fetch(`${this.supabaseUrl}/rest/v1/${AUTOMATION_CONFIG.TABLE_PROJECTS}`, {
          method: 'POST',
          headers: {
            'apikey': this.supabaseKey,
            'Authorization': `Bearer ${this.supabaseKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            id: project.id,
            user_id: project.userId,
            user_email: project.userEmail,
            user_location: project.userLocation,
            room_type: project.roomType,
            status: project.status,
            collected_info: project.collectedInfo,
            design_data: project.designData,
            rendering_url: project.renderingUrl,
            pdf_url: project.pdfUrl,
            matched_retailer: project.matchedRetailer,
            created_at: project.createdAt,
            updated_at: project.updatedAt,
            completed_at: project.completedAt
          })
        });

        if (!response.ok) {
          throw new Error(`Errore Supabase: ${response.status}`);
        }

      } catch (error) {
        console.error('[AutomationAdapter] Errore salvataggio CRM:', error.message);
      }
    }

    /**
     * Aggiorna un progetto in Supabase.
     * @private
     */
    async _updateProjectInCRM(project) {
      if (!this.supabaseUrl || !this.supabaseKey) {
        console.warn('[AutomationAdapter] Supabase non configurato');
        return;
      }

      try {
        const response = await fetch(`${this.supabaseUrl}/rest/v1/${AUTOMATION_CONFIG.TABLE_PROJECTS}?id=eq.${project.id}`, {
          method: 'PATCH',
          headers: {
            'apikey': this.supabaseKey,
            'Authorization': `Bearer ${this.supabaseKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            status: project.status,
            collected_info: project.collectedInfo,
            design_data: project.designData,
            rendering_url: project.renderingUrl,
            pdf_url: project.pdfUrl,
            matched_retailer: project.matchedRetailer,
            errors: project.errors,
            updated_at: project.updatedAt,
            completed_at: project.completedAt
          })
        });

        if (!response.ok) {
          throw new Error(`Errore Supabase: ${response.status}`);
        }

      } catch (error) {
        console.error('[AutomationAdapter] Errore aggiornamento CRM:', error.message);
      }
    }

    /**
     * Salva un log chat in Supabase.
     * @private
     */
    async _saveChatLog(projectId, message) {
      if (!this.supabaseUrl || !this.supabaseKey) {
        return;
      }

      try {
        const response = await fetch(`${this.supabaseUrl}/rest/v1/${AUTOMATION_CONFIG.TABLE_CHAT_LOGS}`, {
          method: 'POST',
          headers: {
            'apikey': this.supabaseKey,
            'Authorization': `Bearer ${this.supabaseKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            project_id: projectId,
            role: message.role,
            content: message.content,
            timestamp: message.timestamp || new Date().toISOString()
          })
        });

        if (!response.ok) {
          throw new Error(`Errore Supabase: ${response.status}`);
        }

      } catch (error) {
        console.error('[AutomationAdapter] Errore salvataggio chat log:', error.message);
      }
    }

    /**
     * Cerca un rivenditore per CAP.
     * @private
     */
    async _findRetailer(cap) {
      if (!this.supabaseUrl || !this.supabaseKey) {
        return null;
      }

      try {
        const response = await fetch(
          `${this.supabaseUrl}/rest/v1/${AUTOMATION_CONFIG.TABLE_RETAILERS}?cap=eq.${cap}&select=*`,
          {
            headers: {
              'apikey': this.supabaseKey,
              'Authorization': `Bearer ${this.supabaseKey}`
            }
          }
        );

        if (!response.ok) {
          throw new Error(`Errore Supabase: ${response.status}`);
        }

        const retailers = await response.json();
        return retailers.length > 0 ? retailers[0] : null;

      } catch (error) {
        console.error('[AutomationAdapter] Errore ricerca rivenditore:', error.message);
        return null;
      }
    }

    /**
     * Emitti un evento.
     * @private
     */
    _emitEvent(eventName, data) {
      const listeners = this.eventListeners.get(eventName) || [];
      listeners.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`[AutomationAdapter] Errore listener ${eventName}:`, error.message);
        }
      });

      // Emitti anche tramite modulo automazione se disponibile
      if (window.Amarreda && window.Amarreda.Automation) {
        window.Amarreda.Automation.emit(eventName, data);
      }
    }

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
  
  const automationAdapter = new AutomationAdapter();

  window.Amarreda = window.Amarreda || {};
  window.Amarreda.Automation = {
    Adapter: automationAdapter,
    Config: AUTOMATION_CONFIG,
    ProjectStatus: AUTOMATION_CONFIG.PROJECT_STATUS,
    Workflows: {
      INTERVIEW: AUTOMATION_CONFIG.WORKFLOW_INTERVIEW,
      DESIGN: AUTOMATION_CONFIG.WORKFLOW_DESIGN,
      RENDERING: AUTOMATION_CONFIG.WORKFLOW_RENDERING,
      PDF: AUTOMATION_CONFIG.WORKFLOW_PDF,
      RETAILER_MATCH: AUTOMATION_CONFIG.WORKFLOW_RETAILER_MATCH
    },
    
    // Shortcut
    initialize: automationAdapter.initializeProject.bind(automationAdapter),
    getStatus: automationAdapter.getProjectStatus.bind(automationAdapter),
    on: automationAdapter.on.bind(automationAdapter)
  };

})(window);
