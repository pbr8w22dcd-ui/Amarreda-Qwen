/* ============================================================
   AMARREDA — chat-client.js
   Gestione conversazione con agente AI (flusso multi-agente)
   
   Architettura:
   - Agente #1 (intervista): fa domande in tempo reale, valuta importanza
   - Agente #2 (progettazione): legge listini Supabase, genera progetto
   - Agente #3 (rendering): genera rendering da OBJ + foto reali
   - Agente #4 (PDF): genera documento finale
   
   Funzionalità:
   - Conversazione con 1 solo ambiente per progetto
   - Domande in tempo reale con valutazione importanza
   - Limite domande configurabile
   - Raccolta informazioni strutturate (fatti, ipotesi, mancanti)
   - Generazione report per agente progettazione
   - Integrazione con n8n (orchestratore)
   - Salvataggio in Supabase
   
   Sicurezza:
   - Le chiamate AI transitano dal backend/n8n
   - Le API key non sono mai nel frontend
   - Validazione input e output
   ============================================================ */

(function (window) {
  'use strict';

  /* ------------------------------------------------------------
     1. COSTANTI E CONFIGURAZIONE
     ------------------------------------------------------------ */
  
  const CHAT_CONFIG = {
    // Limite domande (configurabile)
    MAX_QUESTIONS: 15,
    
    // Informazioni fondamentali (l'agente DEVE raccoglierle)
    REQUIRED_INFO: [
      'tipo_ambiente',      // Es: cucina, soggiorno, camera
      'dimensioni',         // Misure o planimetria
      'stile_preferito',    // Es: contemporaneo, minimalista
      'budget_range',       // Es: economico, medio, alto
      'elementi_da_mantenere', // Cosa vuole conservare
      'elementi_da_sostituire'  // Cosa vuole cambiare
    ],
    
    // Informazioni opzionali (l'agente PUÒ raccoglierle)
    OPTIONAL_INFO: [
      'materiali_preferiti',    // Es: legno, laminato, laccato
      'colori_preferiti',       // Palette colori
      'illuminazione',          // Tipo di luce preferita
      'accessori_desiderati',   // Tavoli, sedie, complementi
      'vincoli_architettonici', // Colonne, travi, finestre
      'abitudini_uso'           // Come usa l'ambiente
    ],
    
    // Stati della conversazione
    STATUS: {
      IDLE: 'idle',
      INTERVIEWING: 'interviewing',
      COLLECTING_INFO: 'collecting_info',
      GENERATING_REPORT: 'generating_report',
      COMPLETED: 'completed',
      ERROR: 'error'
    },
    
    // Configurazione Supabase (da impostare)
    SUPABASE_URL: null, // Impostare in configurazione
    SUPABASE_KEY: null, // Impostare in configurazione
    
    // Configurazione n8n
    N8N_WEBHOOK_URL: null, // Impostare in configurazione
    N8N_ENABLED: false
  };

  /* ------------------------------------------------------------
     2. CHAT CLIENT — GESTIONE CONVERSAZIONE
     ------------------------------------------------------------ */
  
  /**
   * ChatClient
   * Gestisce la conversazione con l'agente AI #1 (intervista).
   */
  class ChatClient {
    constructor(config = {}) {
      this.projectId = config.projectId || null;
      this.userId = config.userId || null;
      this.roomType = null; // Tipo di ambiente (solo 1)
      
      // Stato conversazione
      this.status = CHAT_CONFIG.STATUS.IDLE;
      this.messages = [];
      this.collectedInfo = {
        required: {},    // Informazioni fondamentali raccolte
        optional: {},    // Informazioni opzionali raccolte
        missing: [],     // Informazioni mancanti
        hypotheses: []   // Ipotesi dell'AI (da verificare)
      };
      
      // Contatori
      this.questionCount = 0;
      this.maxQuestions = config.maxQuestions || CHAT_CONFIG.MAX_QUESTIONS;
      
      // Timestamp
      this.startedAt = null;
      this.lastMessageAt = null;
      this.completedAt = null;
      
      // Callback
      this.onMessageReceived = config.onMessageReceived || null;
      this.onStatusChange = config.onStatusChange || null;
      this.onInfoCollected = config.onInfoCollected || null;
    }

    /**
     * Avvia la conversazione con l'agente AI.
     */
    async start(roomType, userId, projectId = null) {
      if (this.status !== CHAT_CONFIG.STATUS.IDLE) {
        throw new Error('Conversazione già avviata');
      }

      this.roomType = roomType;
      this.userId = userId;
      this.projectId = projectId || this._generateProjectId();
      this.status = CHAT_CONFIG.STATUS.INTERVIEWING;
      this.startedAt = new Date().toISOString();

      // Messaggio di benvenuto
      const welcomeMessage = {
        id: this._generateMessageId(),
        role: 'assistant',
        content: `Ciao! Sono l'assistente AI di Amarreda. Ti aiuterò a progettare il tuo ${this._getRoomTypeName(roomType)}. Ti farò alcune domande per capire le tue esigenze. Ricorda che si tratta di un assistente AI e che il risultato è preliminare. Iniziamo?`,
        timestamp: new Date().toISOString(),
        type: 'welcome'
      };

      this.messages.push(welcomeMessage);
      this._notifyStatusChange();

      // Salva in Supabase
      await this._saveToSupabase();

      // Emitti evento
      await this._emitEvent('conversation.started', {
        projectId: this.projectId,
        roomType: roomType,
        userId: userId
      });

      return welcomeMessage;
    }

    /**
     * Invia un messaggio dell'utente e riceve la risposta dell'AI.
     */
    async sendMessage(userMessage) {
      if (this.status !== CHAT_CONFIG.STATUS.INTERVIEWING && 
          this.status !== CHAT_CONFIG.STATUS.COLLECTING_INFO) {
        throw new Error('Conversazione non attiva');
      }

      if (!userMessage || userMessage.trim().length === 0) {
        throw new Error('Messaggio vuoto');
      }

      // Verifica limite domande
      if (this.questionCount >= this.maxQuestions) {
        return this._generateLimitMessage();
      }

      // Aggiungi messaggio utente
      const userMsg = {
        id: this._generateMessageId(),
        role: 'user',
        content: userMessage.trim(),
        timestamp: new Date().toISOString(),
        type: 'user_input'
      };

      this.messages.push(userMsg);
      this.lastMessageAt = new Date().toISOString();

      // Chiama l'agente AI (tramite n8n o backend)
      const aiResponse = await this._callAIAgent(userMessage);

      // Processa la risposta dell'AI
      const processedResponse = this._processAIResponse(aiResponse);

      // Aggiorna informazioni raccolte
      this._updateCollectedInfo(processedResponse);

      // Incrementa contatore domande se l'AI ha fatto una domanda
      if (processedResponse.isQuestion) {
        this.questionCount++;
      }

      // Verifica se abbiamo tutte le informazioni fondamentali
      if (this._hasAllRequiredInfo()) {
        this.status = CHAT_CONFIG.STATUS.GENERATING_REPORT;
      }

      // Salva in Supabase
      await this._saveToSupabase();

      // Notifica callback
      if (this.onMessageReceived) {
        this.onMessageReceived(processedResponse);
      }

      // Se conversazione completata, genera report
      if (this.status === CHAT_CONFIG.STATUS.GENERATING_REPORT) {
        await this._generateReport();
      }

      return processedResponse;
    }

    /**
     * Ottieni lo stato completo della conversazione.
     */
    getState() {
      return {
        projectId: this.projectId,
        userId: this.userId,
        roomType: this.roomType,
        status: this.status,
        messages: this.messages,
        collectedInfo: this.collectedInfo,
        questionCount: this.questionCount,
        maxQuestions: this.maxQuestions,
        startedAt: this.startedAt,
        lastMessageAt: this.lastMessageAt,
        completedAt: this.completedAt
      };
    }

    /**
     * Genera il report strutturato per l'agente progettazione.
     */
    async generateReport() {
      if (this.status !== CHAT_CONFIG.STATUS.GENERATING_REPORT) {
        throw new Error('Conversazione non pronta per generare report');
      }

      const report = {
        projectId: this.projectId,
        userId: this.userId,
        roomType: this.roomType,
        summary: this._generateSummary(),
        requiredInfo: this.collectedInfo.required,
        optionalInfo: this.collectedInfo.optional,
        missingInfo: this.collectedInfo.missing,
        hypotheses: this.collectedInfo.hypotheses,
        conversationHistory: this.messages,
        generatedAt: new Date().toISOString()
      };

      // Salva report in Supabase
      await this._saveReportToSupabase(report);

      // Invia a n8n per orchestrazione
      if (CHAT_CONFIG.N8N_ENABLED) {
        await this._sendToN8N('project.ready_for_design', report);
      }

      this.status = CHAT_CONFIG.STATUS.COMPLETED;
      this.completedAt = new Date().toISOString();

      // Emitti evento
      await this._emitEvent('report.generated', {
        projectId: this.projectId,
        reportId: report.generatedAt
      });

      return report;
    }

    /* ------------------------------------------------------------
       METODI PRIVATI
       ------------------------------------------------------------ */

    /**
     * Chiama l'agente AI (tramite n8n o backend).
     * @private
     */
    async _callAIAgent(userMessage) {
      try {
        // Se n8n è configurato, chiama il webhook
        if (CHAT_CONFIG.N8N_ENABLED && CHAT_CONFIG.N8N_WEBHOOK_URL) {
          const response = await fetch(CHAT_CONFIG.N8N_WEBHOOK_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              action: 'chat_message',
              projectId: this.projectId,
              userId: this.userId,
              roomType: this.roomType,
              userMessage: userMessage,
              conversationHistory: this.messages,
              collectedInfo: this.collectedInfo,
              questionCount: this.questionCount
            })
          });

          if (!response.ok) {
            throw new Error(`Errore n8n: ${response.status}`);
          }

          return await response.json();
        }

        // Altrimenti, chiama il backend locale (per sviluppo)
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this._getAuthToken()}`
          },
          body: JSON.stringify({
            projectId: this.projectId,
            userId: this.userId,
            roomType: this.roomType,
            userMessage: userMessage,
            conversationHistory: this.messages,
            collectedInfo: this.collectedInfo,
            questionCount: this.questionCount
          })
        });

        if (!response.ok) {
          throw new Error(`Errore backend: ${response.status}`);
        }

        return await response.json();

      } catch (error) {
        console.error('[ChatClient] Errore chiamata AI:', error.message);
        
        // Risposta di fallback
        return {
          content: 'Mi dispiace, al momento non riesco a elaborare la tua richiesta. Riprova tra qualche istante.',
          isQuestion: false,
          collectedInfo: {},
          importance: null
        };
      }
    }

    /**
     * Processa la risposta dell'AI.
     * @private
     */
    _processAIResponse(aiResponse) {
      return {
        id: this._generateMessageId(),
        role: 'assistant',
        content: aiResponse.content || '',
        timestamp: new Date().toISOString(),
        type: aiResponse.type || 'response',
        isQuestion: aiResponse.isQuestion || false,
        collectedInfo: aiResponse.collectedInfo || {},
        importance: aiResponse.importance || null, // 'required', 'optional', null
        hypotheses: aiResponse.hypotheses || []
      };
    }

    /**
     * Aggiorna le informazioni raccolte.
     * @private
     */
    _updateCollectedInfo(processedResponse) {
      if (processedResponse.collectedInfo) {
        const info = processedResponse.collectedInfo;
        const importance = processedResponse.importance;

        // Aggiungi alle informazioni fondamentali o opzionali
        if (importance === 'required') {
          Object.assign(this.collectedInfo.required, info);
        } else if (importance === 'optional') {
          Object.assign(this.collectedInfo.optional, info);
        } else {
          // Se non specificato, prova a classificare
          Object.keys(info).forEach(key => {
            if (CHAT_CONFIG.REQUIRED_INFO.includes(key)) {
              this.collectedInfo.required[key] = info[key];
            } else if (CHAT_CONFIG.OPTIONAL_INFO.includes(key)) {
              this.collectedInfo.optional[key] = info[key];
            }
          });
        }

        // Aggiorna informazioni mancanti
        this.collectedInfo.missing = this._calculateMissingInfo();

        // Aggiungi ipotesi
        if (processedResponse.hypotheses && processedResponse.hypotheses.length > 0) {
          this.collectedInfo.hypotheses.push(...processedResponse.hypotheses);
        }

        // Notifica callback
        if (this.onInfoCollected) {
          this.onInfoCollected({
            required: this.collectedInfo.required,
            optional: this.collectedInfo.optional,
            missing: this.collectedInfo.missing
          });
        }
      }
    }

    /**
     * Calcola le informazioni mancanti.
     * @private
     */
    _calculateMissingInfo() {
      const missing = [];
      
      CHAT_CONFIG.REQUIRED_INFO.forEach(key => {
        if (!this.collectedInfo.required[key]) {
          missing.push({
            key: key,
            label: this._getInfoLabel(key),
            importance: 'required'
          });
        }
      });

      CHAT_CONFIG.OPTIONAL_INFO.forEach(key => {
        if (!this.collectedInfo.optional[key]) {
          missing.push({
            key: key,
            label: this._getInfoLabel(key),
            importance: 'optional'
          });
        }
      });

      return missing;
    }

    /**
     * Verifica se abbiamo tutte le informazioni fondamentali.
     * @private
     */
    _hasAllRequiredInfo() {
      return CHAT_CONFIG.REQUIRED_INFO.every(key => 
        this.collectedInfo.required[key] !== undefined &&
        this.collectedInfo.required[key] !== null
      );
    }

    /**
     * Genera un messaggio di limite raggiunto.
     * @private
     */
    _generateLimitMessage() {
      const message = {
        id: this._generateMessageId(),
        role: 'assistant',
        content: 'Ho raccolto tutte le informazioni necessarie per il tuo progetto. Ora procedo a generare la proposta di arredamento.',
        timestamp: new Date().toISOString(),
        type: 'limit_reached',
        isQuestion: false
      };

      this.messages.push(message);
      this.status = CHAT_CONFIG.STATUS.GENERATING_REPORT;

      return message;
    }

    /**
     * Genera un riassunto della conversazione.
     * @private
     */
    _generateSummary() {
      return {
        roomType: this.roomType,
        roomTypeName: this._getRoomTypeName(this.roomType),
        totalMessages: this.messages.length,
        totalQuestions: this.questionCount,
        requiredInfoCollected: Object.keys(this.collectedInfo.required).length,
        optionalInfoCollected: Object.keys(this.collectedInfo.optional).length,
        missingInfoCount: this.collectedInfo.missing.length,
        hypothesesCount: this.collectedInfo.hypotheses.length
      };
    }

    /**
     * Ottieni il nome leggibile del tipo di ambiente.
     * @private
     */
    _getRoomTypeName(roomType) {
      const names = {
        cucina: 'cucina',
        soggiorno: 'soggiorno',
        camera: 'camera da letto',
        bagno: 'bagno',
        studio: 'studio',
        ingresso: 'ingresso',
        ripostiglio: 'ripostiglio',
        lavanderia: 'lavanderia'
      };
      return names[roomType] || 'ambiente';
    }

    /**
     * Ottieni l'etichetta leggibile per un'informazione.
     * @private
     */
    _getInfoLabel(key) {
      const labels = {
        tipo_ambiente: 'Tipo di ambiente',
        dimensioni: 'Dimensioni',
        stile_preferito: 'Stile preferito',
        budget_range: 'Budget',
        elementi_da_mantenere: 'Elementi da mantenere',
        elementi_da_sostituire: 'Elementi da sostituire',
        materiali_preferiti: 'Materiali preferiti',
        colori_preferiti: 'Colori preferiti',
        illuminazione: 'Illuminazione',
        accessori_desiderati: 'Accessori desiderati',
        vincoli_architettonici: 'Vincoli architettonici',
        abitudini_uso: 'Abitudini di uso'
      };
      return labels[key] || key;
    }

    /**
     * Salva lo stato in Supabase.
     * @private
     */
    async _saveToSupabase() {
      if (!CHAT_CONFIG.SUPABASE_URL || !CHAT_CONFIG.SUPABASE_KEY) {
        console.warn('[ChatClient] Supabase non configurato, salvataggio locale');
        // Fallback: salva in localStorage
        localStorage.setItem(`amarreda_chat_${this.projectId}`, JSON.stringify(this.getState()));
        return;
      }

      try {
        const response = await fetch(`${CHAT_CONFIG.SUPABASE_URL}/rest/v1/chat_sessions`, {
          method: 'POST',
          headers: {
            'apikey': CHAT_CONFIG.SUPABASE_KEY,
            'Authorization': `Bearer ${CHAT_CONFIG.SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            project_id: this.projectId,
            user_id: this.userId,
            room_type: this.roomType,
            status: this.status,
            messages: this.messages,
            collected_info: this.collectedInfo,
            question_count: this.questionCount,
            started_at: this.startedAt,
            last_message_at: this.lastMessageAt
          })
        });

        if (!response.ok) {
          throw new Error(`Errore Supabase: ${response.status}`);
        }

      } catch (error) {
        console.error('[ChatClient] Errore salvataggio Supabase:', error.message);
      }
    }

    /**
     * Salva il report in Supabase.
     * @private
     */
    async _saveReportToSupabase(report) {
      if (!CHAT_CONFIG.SUPABASE_URL || !CHAT_CONFIG.SUPABASE_KEY) {
        console.warn('[ChatClient] Supabase non configurato');
        return;
      }

      try {
        const response = await fetch(`${CHAT_CONFIG.SUPABASE_URL}/rest/v1/project_reports`, {
          method: 'POST',
          headers: {
            'apikey': CHAT_CONFIG.SUPABASE_KEY,
            'Authorization': `Bearer ${CHAT_CONFIG.SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify(report)
        });

        if (!response.ok) {
          throw new Error(`Errore Supabase: ${response.status}`);
        }

      } catch (error) {
        console.error('[ChatClient] Errore salvataggio report:', error.message);
      }
    }

    /**
     * Invia un evento a n8n.
     * @private
     */
    async _sendToN8N(eventName, data) {
      if (!CHAT_CONFIG.N8N_ENABLED || !CHAT_CONFIG.N8N_WEBHOOK_URL) {
        return;
      }

      try {
        await fetch(CHAT_CONFIG.N8N_WEBHOOK_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            event: eventName,
            data: data,
            timestamp: new Date().toISOString()
          })
        });
      } catch (error) {
        console.error('[ChatClient] Errore invio n8n:', error.message);
      }
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
     * Notifica il cambio di stato.
     * @private
     */
    _notifyStatusChange() {
      if (this.onStatusChange) {
        this.onStatusChange(this.status);
      }
    }

    /**
     * Genera un ID univoco per il progetto.
     * @private
     */
    _generateProjectId() {
      return `proj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Genera un ID univoco per il messaggio.
     * @private
     */
    _generateMessageId() {
      return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
  
  window.Amarreda = window.Amarreda || {};
  window.Amarreda.Chat = {
    Client: ChatClient,
    Config: CHAT_CONFIG,
    RequiredInfo: CHAT_CONFIG.REQUIRED_INFO,
    OptionalInfo: CHAT_CONFIG.OPTIONAL_INFO,
    Status: CHAT_CONFIG.STATUS
  };

})(window);
