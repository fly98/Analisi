# App Arrivi — come funziona

Mappa del sistema che prepara ogni notte gli arrivi del giorno dopo per InternoUno.
Scritta il 4 settembre 2026. **Se qualcosa non torna, questo file va aggiornato insieme al codice.**

---

## 1. Le tre macchine

Il sistema vive su tre pezzi con mestieri diversi. Confonderli è la prima causa di ricerche a vuoto.

| Pezzo | Dove | Cosa fa |
|---|---|---|
| **Worker Cloudflare** | `worker.js` (questo deposito) | La testa. Sempre acceso, gratis. Tiene la sveglia notturna, l'archivio, parla con l'interfaccia programmi di Amenitiz, chiama l'intelligenza artificiale, serve l'app. |
| **App** | `arrivi.html` (questo deposito) | Quello che apri su iPad/iPhone. Pubblicata su `fly98.github.io/Analisi/arrivi.html`. |
| **Mac** | `~/automazioni/` | Le mani. Tutto ciò che richiede un browser vero: Amenitiz (link, riga tassa, messaggi) e WhatsApp Web. |

**Conseguenza pratica: se il Mac è spento o addormentato alle 3 e alle 4, la parte browser non si fa.**
Il worker se ne accorge e l'app lo segnala col campanello in cima.

### I programmi sul Mac
- `amenitiz-tassa.js` — legge la prenotazione, crea il link della tassa, aggiunge la riga Expedia, legge i messaggi Amenitiz, risponde all'ospite
- `whatsapp-leggi.js` — legge le chat WhatsApp; **sa anche inviare**, ma solo se glielo si chiede esplicitamente
- `trigger-server.js` — il portone: sta in ascolto sulla porta 3456 e lancia i due programmi sopra. Protetto da chiave.

Il worker raggiunge il Mac su `http://fly98.duckdns.org:3456`.

---

## 2. La notte, passo per passo

Cloudflare ragiona **solo in ora di Greenwich**, quindi il cron elenca più ore e parte solo quella
che cade all'ora italiana giusta. Senza questo, col cambio dell'ora tutto slitterebbe di un'ora.

| Ora italiana | Cosa succede | Funzione |
|---|---|---|
| **03:00** | Legge **tutti i messaggi** degli arrivi di domani: Booking/Airbnb su Amenitiz **e** chat WhatsApp. Ne ricava orario e note. | `runWhatsappPrepara` |
| **04:00** | Prepara i **pagamenti**: riga tassa per Expedia e link di pagamento. Salta chi ha scritto che paga in contanti. | `runTassaPrepara` |
| 10:00 | Messaggi di ringraziamento | `runThankYou` |
| 17:00 | Riepilogo arrivi | `runArriviTg` |

I messaggi vanno letti **prima** dei pagamenti: se l'ospite dice che paga in contanti, il link non
va nemmeno creato.

---

## 3. L'archivio

Tutto sta in Cloudflare KV, spazio `ARRIVI_KV`. Le chiavi che contano:

| Chiave | Contenuto |
|---|---|
| `tassa_<id>` | esito, link di pagamento, importo |
| `msg_<id>` | messaggi dell'ospite (agenzia + WhatsApp), interpretazione, risposte inviate, valori precedenti |
| `orario_<data>_<id>` | orario di arrivo mostrato nella scheda |
| `nota_<data>_<id>` | nota mostrata nella scheda |
| `giro_ultimo` | firma del passaggio delle 4 — la usa il campanello |
| `giro_whatsapp` | firma del passaggio delle 3 |

---

## 4. Le chiavi (dove stanno, non quali sono)

- **Anthropic, Amenitiz, chiave del Mac** → segreti del worker su Cloudflare
- **Chiave del trigger server** → `~/automazioni/config.js` sul Mac
- **Chiave d'accesso all'app** → nel browser di Filippo, sotto `arrivi_key`
- **Sessione Amenitiz** → profilo browser `~/automazioni/profilo-sella2`
- **Sessione WhatsApp** → profilo browser `~/automazioni/profilo-whatsapp`

**WhatsApp occupa uno dei 4 dispositivi collegati consentiti.** Se salta:
`node whatsapp-leggi.js --collega`, che salva il codice QR in `~/automazioni/diagnostica/whatsapp-qr.png`.

---

## 5. Le regole decise da Filippo

Non sono dettagli tecnici: sono scelte sue, e vanno rispettate.

1. **Orario e note si aggiornano sempre**, integrando quello che c'è già. I piani cambiano
   all'ultimo momento. Ma non si cancella mai un valore per metterci il vuoto, e il valore
   precedente resta nello storico dentro `msg_<id>`.
2. **Le note descrivono, non comandano.** Dicono cosa ha chiesto l'ospite, mai cosa deve fare
   la struttura. Niente "bloccare", "annullare", "non emettere".
3. **I dati concreti non si buttano mai**: partita IVA, numeri di volo, cifre, orari, indirizzi
   vanno riportati tali e quali.
4. **La giornata cambia alle 3 di notte**, non a mezzanotte: se lavora all'una, per lui "oggi"
   è ancora il giorno che sta finendo.
5. **Niente invii automatici verso gli ospiti**, salvo decisione esplicita. Il giro notturno
   legge e prepara; l'ultimo gesto è suo.

---

## 6. Le trappole già pagate

Ognuna è costata almeno un'ora. Non ripagarle.

**Amenitiz**
- Il browser **senza finestra non funziona**: Cloudflare blocca. La finestra va aperta davvero e
  spostata fuori dallo schermo (`--window-position=-3000,-3000`).
- Nel pannello "Crea un pagamento", **le caselle sulle singole voci esistono solo se c'è ancora
  tutta la camera da pagare.** Se resta la sola tassa non ci sono, e si spunta il conto: l'importo
  residuo è già la tassa. Il programma sceglie da solo la strada; il controllo che l'importo
  proposto sia uguale alla tassa è ciò che impedisce di creare un link per l'intera prenotazione.
- Il metodo "Link di pagamento" **non si clicca sul testo**: un pannello sovrapposto intercetta
  il clic. Va cliccato il pulsante che lo contiene.
- Gli importi si scrivono in due modi (`320,43 €` e `€15.00`): il lettore gestisce entrambi.

**WhatsApp Web**
- Aprendo una chat dalla ricerca resta ferma sulla **parte vecchia** e non disegna i messaggi
  recenti. Bisogna scendere in fondo prima di leggere qualsiasi cosa.
- **"In attesa del messaggio. Controlla il telefono."** significa che il messaggio è cifrato e il
  browser non ha la chiave: solo il telefono può darla. Ricaricare la pagina non serve.
  Il programma lo riconosce e lo segnala invece di restituire in silenzio una conversazione
  incompleta.
- Se il contatto è **in rubrica**, l'intestazione mostra il nome e non il numero: si apre la sua
  scheda cliccando **sul nome** (non sulla barra) e lì si legge il numero vero.
- L'intestazione contiene anche stati come "ultimo accesso ieri alle 19:51": se non si tagliano,
  il confronto col mittente fallisce e **tutti** i messaggi risultano nostri.
- Chrome rifiuta due finestre sullo stesso profilo: c'è un lucchetto nel programma
  (`.lucchetto-whatsapp`), non solo nel server.

---

## 7. Quando qualcosa non va

**Guarda per primo il campanello in cima all'app.** Dice il motivo a parole, non il codice interno.
La ✕ archivia quel problema specifico; un guaio nuovo torna a comparire.

| Sintomo | Dove guardare |
|---|---|
| L'app non carica ("Load failed") | Rete o DNS di casa, non il worker. Il campanello riprova due volte da solo. |
| Link della tassa mancanti | Campanello → dettagli. Poi rilanciare a mano dal Mac con `node amenitiz-tassa.js <id> --crea` |
| WhatsApp non legge i messaggi nuovi | Aprire WhatsApp sul telefono qualche secondo, poi premere di nuovo |
| Niente si è mosso di notte | Il Mac era spento? Sessione Amenitiz scaduta? |

**Tempi misurati il 04/09/2026:** messaggi Amenitiz 9-13 secondi, chat WhatsApp 17-18.
Con 10 arrivi il passaggio delle 3 impiega circa 5 minuti, contro un limite di 15.

**Limiti Cloudflare (piano gratuito):** 50 chiamate esterne e 10 ms di calcolo *per esecuzione*
(non si sommano fra progetti); 100.000 accessi, 100.000 letture e **1.000 scritture al giorno**
per account — questi sì condivisi con gli altri progetti.

---

## 8. Le memorie

Oltre a questo file, esistono note in `~/.claude/projects/-Users-filippo/memory/`, che vengono
rilette automaticamente all'inizio di ogni sessione di lavoro. Le più legate a questo sistema:
`arrivi-tassa-automazione`, `arrivi-whatsapp-lettura`, `arrivi-note-confine`,
`giornata-cambia-alle-tre`, `arrivi-diagnosi-prima-di-concludere`.

**Quelle note vivono sul Mac di Filippo e non sono nel deposito.** Questo file sì: se un giorno
mancassero, qui c'è comunque tutto il necessario per rimettere le mani sul sistema.
