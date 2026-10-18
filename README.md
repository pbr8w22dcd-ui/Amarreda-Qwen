# AMARREDA — Progettazione d'interni assistita da AI

**Amarreda** è una piattaforma digitale che aiuta privati, professionisti e rivenditori a progettare ambienti d'interni in modo rapido, consapevole e ispirato. Attraverso un assistente AI, il servizio trasforma planimetrie, foto e preferenze in proposte d'arredo complete di rendering, stime economiche e prodotti verificati.

---

##  Design System: Dark Luxury Edition

Il progetto utilizza un'identità visiva elegante e sofisticata, ispirata ai brand di interior design di fascia alta.

*   **Sfondo principale:** Carbone profondo (`#1A1916` / `#12110F`)
*   **Accenti e Titoli:** Gradienti Rame e Oro (`#B8996A` → `#E8D5B7` → `#8B7355`)
*   **Testi:** Grigio chiaro e Avorio (`#FCFAF6`, `#E8E4DD`) per massima leggibilità.
*   **Tipografia:** 
    *   *Display:* **Cormorant Garamond** (Serif, per titoli ed eleganza).
    *   *Body:* **Manrope** (Sans-serif, per leggibilità e UI).
*   **Dettagli:** Effetti *glow* sui cerchi numerici, transizioni fluide, micro-interazioni raffinate.

---

## 📁 Struttura del Progetto

```text
Amarreda-Qwen/
│
├── index.html                  # Homepage principale
├── README.md                   # Documentazione del progetto
│
├── assets/
│   └── logo.svg                # Logo vettoriale Amarreda
│
├── css/
│   ├── main.css                # Design System, variabili, layout globale
│   ── pages.css               # Stili specifici per le pagine interne
│
├── js/
│   ├── main.js                 # Interazioni UI (menu, tendine, cookie banner)
│   ├── automation-adapter.js   # Modulo automazione (predisposto per n8n)
│   ├── ai-provider-qwen.js     # Adattatore per AI Qwen (Alibaba Cloud)
│   ├── chat-client.js          # Gestione conversazioni e contesto multi-ambiente
│   ── rendering-engine.js     # Motore di generazione e cache rendering AI
│
└── pages/                      # 25 pagine HTML interne
    ├── come-funziona.html
    ├── servizio-privati.html
    ├── servizio-professionisti.html
    ├── servizio-rivenditori.html
    ├── progettazione-ai.html
    ├── risultati.html
    ├── prodotti.html
    ├── prezzi.html
    ├── chi-siamo.html
    ├── contatti.html
    ├── marchi.html             # (Da creare) Elenco cataloghi
    ├── marchi-arredo3.html     # (Da creare) Pagina marchio esempio
    ├── progetto-chat.html      # (Da creare) Interfaccia conversazione AI
    ├── registrazione.html
    ├── login.html
    ├── recupero-password.html
    ├── verifica-email.html
    ├── dashboard.html
    ├── progetti.html
    ├── progetto-dettaglio.html
    ├── progetto-nuovo.html
    ├── account.html
    ├── logout.html
    ├── privacy-policy.html
    ├── cookie-policy.html
    ├── termini-condizioni.html
    ├── informazioni-stime.html
    └── 404.html
