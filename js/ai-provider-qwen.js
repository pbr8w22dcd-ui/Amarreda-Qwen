/* ============================================================
   AMARREDA — ai-provider-qwen.js
   Provider AI per architettura Multi-Agente (Qwen / ChatGPT)
   
   Architettura:
   - Gestisce la comunicazione con i 4 Agenti AI tramite n8n/backend
   - Agente #1 (Intervistatore): Empatico, valuta importanza info
   - Agente #2 (Progettista): Interior designer, usa listini Supabase
   - Agente #3 (Renderista): Visione spaziale, OBJ + Foto reali
   - Agente #4 (Editor PDF): Formattazione documento finale
   
   Funzionalità:
   - Routing delle chiamate verso il provider corretto (Qwen/ChatGPT)
   - Gestione System Prompts specifici per ogni agente
   - Supporto output strutturato (JSON) per passaggio dati tra agenti
   - Analisi immagini (Vision) per Agente #3
   - Fallback e gestione errori robusta
   
   Sicurezza:
   - Le API key NON sono mai nel frontend
   - Tutte le chiamate passano da n8n o backend sicuro
   ============================================================ */

(function (window) {
  'use strict';

  /* ------------------------------------------------------------
     1. COSTANTI E CONFIGURAZIONE
     ------------------------------------------------------------ */
  
  const AI_CONFIG = {
    // Endpoint di comunicazione (n8n o backend)
    BACKEND_URL: '/api/ai',
    N8N_WEBHOOK_URL: null,
    N8N_ENABLED: false,
    
    // Provider supportati
    PROVIDERS: {
      QWEN: 'qwen',
      CHATGPT: 'chatgpt'
    },
    
    // Assegnazione provider per agente
    AGENT_PROVIDERS: {
      INTERVIEWER: 'qwen',      // Ottimo per conversazione e italiano
      DESIGNER: 'qwen',         // Ottimo per logica e JSON
      RENDERER: 'chatgpt',      // DALL-E / GPT-4 Vision per rendering
      PDF_EDITOR: 'qwen'        // Ottimo per formattazione testo
    },

    // System Prompts (Saranno inviati al backend per ogni agente)
    PROMPTS: {
      INTERVIEWER: `Sei l'Agente Intervistatore di Amarreda. Il tuo obiettivo è raccogliere informazioni per arredare UN SOLO ambiente. 
      Regole:
      1. Fai UNA SOLA domanda alla volta.
      2. Valuta se l'informazione è 'required' (fondamentale) o 'optional'.
      3. Se l'utente dà informazioni extra, registrale ma non cambiare argomento.
      4. Sii empatico, professionale e conciso.
      5. Rispondi SEMPRE in formato JSON: {"content": "tua risposta", "collectedInfo": {...}, "importance": "required|optional", "isQuestion": true|false}`,
      
      DESIGNER: `Sei un Interior Designer esperto. Ricevi un report JSON dall'Intervistatore.
      Il tuo compito è selezionare i prodotti DAL DATABASE (Supabase) che corrispondono alle esigenze.
      Devi considerare le varianti (es. laminato vs laccato) per calcolare un prezzo MIN e MAX.
      Rispondi SOLO in formato JSON valido con la lista dei prodotti, le coordinate 3D per il file OBJ, e la stima economica.`,
      
      RENDERER: `Sei un esperto di rendering 3D e visione artificiale. 
      Analizza le foto reali dell'ambiente e il file OBJ fornito.
      Il tuo compito è generare un prompt dettagliato per il motore di rendering (DALL-E/Qwen-VL) che includa illuminazione, materiali e posizionamento dei prodotti affiliati.`,
      
      PDF_EDITOR: `Sei un editor di documenti tecnici. Ricevi i dati del progetto, la lista prodotti, la stima e il link al rendering.
      Genera la struttura JSON per il PDF finale, assicurandoti che i costi non inclusi siano ben visibili e che i link agli affiliati siano cliccabili.`
    }
  };

  /* ------------------------------------------------------------
     2. AI PROVIDER — GESTORE PRINCIPALE
     ------------------------------------------------------------ */
  
  class AIProvider {
    constructor(config = {}) {
      this.backendUrl = config.backendUrl || AI_CONFIG.BACKEND_URL;
      this.n8nWebhookUrl = config.n8nWebhookUrl || AI_CONFIG.N8N_WEBHOOK_URL;
      this.n8nEnabled = config.n8nEnabled || AI_CONFIG.N8N_ENABLED;
    }

    /**
     * Invia un messaggio a un Agente specifico.
     * @param {string} agentName - 'INTERVIEWER', 'DESIGNER', 'RENDERER', 'PDF_EDITOR'
     * @param {string} userMessage - Messaggio dell'utente o input di sistema
     * @param {Array} history - Storico conversazione
     * @param {Object} context - Contesto aggiuntivo (es. report precedente)
     */
    async chatWithAgent(agentName, userMessage, history = [], context = {}) {
      const provider = AI_CONFIG.AGENT_PROVIDERS[agentName] || AI_CONFIG.PROVIDERS.QWEN;
      const systemPrompt = AI_CONFIG.PROMPTS[agentName];

      const payload = {
        agent: agentName,
        provider: provider,
        systemPrompt: systemPrompt,
        userMessage: userMessage,
        history: history,
        context: context,
        timestamp: new Date().toISOString()
      };

      try {
        let response;
        
        // Routing: n8n o Backend locale
        if (this.n8nEnabled && this.n8nWebhookUrl) {
          response = await fetch(this.n8nWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'agent_chat', payload })
          });
        } else {
          response = await fetch(`${this.backendUrl}/chat`, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this._getAuthToken()}`
            },
            body: JSON.stringify(payload)
          });
        }

        if (!response.ok) throw new Error(`Errore API: ${response.status}`);
        
        const result = await response.json();
        return this._parseAgentResponse(result, agentName);

      } catch (error) {
        console.error(`[AIProvider] Errore agente ${agentName}:`, error.message);
        return this._getFallbackResponse(agentName, error.message);
      }
    }

    /**
     * Analizza un'immagine (usato dall'Agente #3 Renderista).
     * @param {string} imageUrl - URL della foto reale o OBJ renderizzato
     * @param {string} prompt - Istruzioni per l'analisi
     */
    async analyzeImage(imageUrl, prompt) {
      const payload = {
        agent: 'RENDERER',
        provider: AI_CONFIG.AGENT_PROVIDERS.RENDERER,
        imageUrl: imageUrl,
        prompt: prompt,
        timestamp: new Date().toISOString()
      };

      try {
        const response = await fetch(`${this.backendUrl}/vision`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this._getAuthToken()}`
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error(`Errore Vision API: ${response.status}`);
        return await response.json();

      } catch (error) {
        console.error('[AIProvider] Errore analisi immagine:', error.message);
        return { success: false, error: error.message };
      }
    }

    /**
     * Genera dati strutturati (JSON) da un testo (usato per passaggio tra agenti).
     */
    async generateStructuredData(agentName, rawText) {
      const response = await this.chatWithAgent(agentName, `Estrai i dati strutturati da: ${rawText}`, [], {});
      return response.structuredData || response;
    }

    /* ------------------------------------------------------------
       METODI PRIVATI
       ------------------------------------------------------------ */

    /**
     * Parsa la risposta dell'agente, cercando JSON valido.
     * @private
     */
    _parseAgentResponse(result, agentName) {
      // Se l'agente ha risposto con un JSON stringa, parsalo
      if (typeof result.content === 'string' && result.content.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(result.content);
          result.structuredData = parsed;
          result.content = parsed.content || result.content; // Estrai il testo leggibile
        } catch (e) {
          console.warn(`[AIProvider] JSON non valido dall'agente ${agentName}`);
        }
      }
      return result;
    }

    /**
     * Risposta di fallback in caso di errore.
     * @private
     */
    _getFallbackResponse(agentName, errorMessage) {
      const fallbacks = {
        INTERVIEWER: { content: "Mi dispiace, ho avuto un problema di connessione. Potresti ripetere l'ultima informazione?", isQuestion: true },
        DESIGNER: { content: "Sto incontrando difficoltà a leggere il listino in questo momento. Riprovo tra un istante.", structuredData: null },
        RENDERER: { content: "Il motore di rendering è temporaneamente occupato.", structuredData: null },
        PDF_EDITOR: { content: "Errore nella generazione del documento.", structuredData: null }
      };

      return {
        ...fallbacks[agentName],
        error: errorMessage,
        success: false
      };
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
  
  const aiProvider = new AIProvider();

  window.Amarreda = window.Amarreda || {};
  window.Amarreda.AI = {
    Provider: aiProvider,
    Config: AI_CONFIG,
    Agents: AI_CONFIG.AGENT_PROVIDERS,
    
    // Shortcut per chiamare gli agenti direttamente
    interview: (msg, history, ctx) => aiProvider.chatWithAgent('INTERVIEWER', msg, history, ctx),
    design: (msg, history, ctx) => aiProvider.chatWithAgent('DESIGNER', msg, history, ctx),
    render: (msg, history, ctx) => aiProvider.chatWithAgent('RENDERER', msg, history, ctx),
    formatPdf: (msg, history, ctx) => aiProvider.chatWithAgent('PDF_EDITOR', msg, history, ctx),
    vision: (url, prompt) => aiProvider.analyzeImage(url, prompt)
  };

})(window);
