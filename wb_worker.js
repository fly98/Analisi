// wb_worker.js — InternoUno Welcome Book: concierge chat + monitoraggio + dati dinamici
// Endpoints:
//   OPTIONS *                              -> CORS preflight
//   POST /wb/:slug/chat                    -> { messages:[{role,content}], lang } => { reply }
//   POST /wb/:slug/track                   -> { event, section?, lang? }          => { ok:true }
//   GET  /wb/:slug/data?lang=xx            -> { food?, eventi? }  (letti da KV, popolati da cron futuri)
//   GET  /wb/:slug/stats?key=ADMIN_KEY&days=14  -> aggregato visite/sezioni/lingue/domande frequenti

var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400"
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { ...CORS, "Content-Type": "application/json" }
  });
}

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// ---------------- Knowledge base per struttura ----------------
// Contenuto usato come contesto del concierge AI. Editabile in futuro via KV
// (chiave `wb:<slug>:knowledge`); se assente, si usa questo default imbustato nel worker.
const KNOWLEDGE = {
  campaldino: `
STRUTTURA: InternoUno — Via Campaldino 6, Roma (zona Piazza Bologna / San Lorenzo).
CHECK-IN: dalle 14:00. CHECK-OUT: entro le 10:00; se non trovi lo staff lascia la chiave sul bancone reception.
DEPOSITO BAGAGLI: gratuito il giorno della partenza, nell'armadio a specchio a destra della reception; ritiro in giornata, lasciare poi la chiave sul bancone. Non è custodito: evitare oggetti di valore.
PARCHEGGIO: Via Campaldino e Via Cupa sono strade condominiali private, gratuito se c'è posto. Alternativa: Garage Di Nezza sotto la struttura, ingresso da Via Cupa, tel +39 320 8667617, 25€/giorno per vetture standard (tariffa maggiore per auto di grande valore o dimensioni importanti), Lun-Sab 6:30-01:00, Dom 7:00-11:00 e 19:00-23:00.
METRO: Piazza Bologna, Linea B, 400m/10 min a piedi. Termini 3 fermate, Colosseo 5 fermate. Orari dom-gio 5:30-23:30, ven-sab 5:30-01:30.
BIGLIETTI ATAC: 1,50€ (100 min), 7€ (24h), 12,50€ (48h), 18€ (72h). In vendita in metro, tabacchi, edicole, o app TicketAppy.
WIFI: nome rete e password sono affissi in camera su un cartoncino; se l'ospite non lo trova, invitalo a scrivere su WhatsApp.
NETFLIX: gratuito, basta premere il tasto dedicato sul telecomando. Se l'account risulta disconnesso, invita l'ospite a mandare su WhatsApp una foto del QR a schermo.
SILENZIO: 22:00-08:00, ridurre al minimo i rumori.
ARIA CONDIZIONATA: va sempre spenta uscendo dalla camera.
ANIMALI: benvenuti gratuitamente, non devono salire sui letti né restare liberi nelle aree comuni.
FUMO: severamente vietato in tutta la struttura.
EMERGENZE: Polizia/Carabinieri 112, Emergenza medica 118, Taxi Roma 06 3570, Info turistiche Roma 06 0606.
SERVIZI VICINI: Conad City (Viale delle Provincie 156, di fronte), Lidl (Via della Lega Lombarda 32, 5 min), ATM Banco BPM (Viale delle Provincie 148), Lavanderia a gettoni Al.Ba. (Via Giuseppe de Mattheis 11, 5 min), Farmacia Caluori (Piazzale delle Provincie 8).
RISTORANTI CONSIGLIATI: Bar Stendal (colazione, Piazzale delle Provincie 1, 1 min); Strada Romana (cucina romana/pizza, Via Teodorico 34, tel 06 8339 8501); Kimi Sushi Experience (Via della Lega Lombarda 48C); Al Tinello d'Abruzzo (Via Arduino 17); La Pagnottella Gourmet (panini/insalate, Viale Ippocrate 25); Burger King (Viale delle Provincie 136, di fronte, aperto fino a tardi).
CONTATTO DIRETTO: WhatsApp +39 392 2999914 per qualsiasi necessità non coperta da queste informazioni.
`.trim(),

  lorenzo: `
STRUTTURA: InternoUno Deluxe — Via Lorenzo il Magnifico 158, Roma (zona Tiburtina).
A pochi passi dalla Stazione Tiburtina (metro Linea B + treni Alta Velocità e regionali). Camere con bagno privato, angolo cottura, aria condizionata; la tua camera è dotata di vasca idromassaggio (se non parte, controlla l'interruttore vicino alla luce del bagno).
CHECK-IN: dalle 14:00. CHECK-OUT: entro le 10:00; se non trovi lo staff lascia la chiave sul bancone reception.
DEPOSITO BAGAGLI: al check-out chiedi allo staff, ti indicheranno dove lasciarli in sicurezza per la giornata.
PARCHEGGIO: Garage Bologna, Via Lorenzo il Magnifico 83 (a pochi passi), tel +39 06 4424 2664, 25€/giorno per vetture standard (tariffa maggiore per auto di grande valore o dimensioni importanti), Lun-Sab 6:00-01:00, Dom 6:00-10:00 e 19:00-01:00. C'è un garage più vicino a destra dell'entrata ma con tariffe molto più alte.
METRO: Stazione Tiburtina, Linea B, a soli 10 metri (meno di 1 minuto a piedi, davanti al nostro cancello) — anche stazione ferroviaria Alta Velocità e regionali. Termini 4 fermate, Colosseo 6 fermate.
BIGLIETTI ATAC: 1,50€ (100 min), 7€ (24h), 12,50€ (48h), 18€ (72h). In vendita in metro, tabacchi, edicole, o app TicketAppy.
WIFI: nome rete e password affissi in camera; se non trovato, scrivere su WhatsApp.
NETFLIX: gratuito, premi il tasto dedicato sul telecomando oppure seleziona l'ingresso HDMI dedicato sulla TV per accedere al menu e scegliere l'icona Netflix. Se l'account risulta disconnesso, invita l'ospite a mandare su WhatsApp una foto del QR a schermo.
SILENZIO: 22:00-08:00.
ARIA CONDIZIONATA: va sempre spenta uscendo dalla camera.
ANIMALI: benvenuti gratuitamente, non sui letti né liberi nelle aree comuni.
FUMO: vietato in tutta la struttura.
EMERGENZE: Polizia/Carabinieri 112, Emergenza medica 118, Taxi Roma 06 3570, Info turistiche Roma 06 0606. Pronto Soccorso più vicino: Ospedale Sandro Pertini, Via dei Monti Tiburtini 385.
SERVIZI VICINI: Market Magnificio (Via Lorenzo il Magnifico 55), Farmacia Lorenzo il Magnifico (Via Lorenzo il Magnifico 56), Bancomat Mediobanca (Piazza Bologna 12), Lavanderia Onda Blu (Via Giuseppe Marcotti 52), Tabaccheria Magnifico (Via Giovanni da Procida 24), Ufficio Postale (Via Giuseppe Marcotti 45).
RISTORANTI CONSIGLIATI: Da Mamma (trattoria romana, Via Lorenzo il Magnifico 62, tel 06 4424 2613); La Pizzetta Tiburtina (pizzette e fritti, Via Cipriano Facchinetti 5/7); Gelateria Belsito (Via Livorno 39).
CONTATTO DIRETTO: WhatsApp +39 392 2999914 per qualsiasi necessità non coperta da queste informazioni.
`.trim()
};

function systemPrompt(slug, lang) {
  const kb = KNOWLEDGE[slug] || KNOWLEDGE.campaldino;
  return `Sei il concierge digitale di InternoUno, un affittacamere a Roma. Rispondi SEMPRE nella lingua dell'ospite (rilevala dal messaggio; se incerto usa "${lang}"). Sii breve, cordiale, concreto: 2-4 frasi, no premesse.
Usa SOLO le informazioni qui sotto per rispondere su casa, orari, trasporti, servizi e ristoranti. Se la domanda esula da questi temi o non trovi la risposta nelle informazioni fornite, invita gentilmente a scrivere su WhatsApp al numero indicato, senza inventare nulla.
Non dare mai consigli medici, legali o di sicurezza oltre ai numeri di emergenza forniti.

INFORMAZIONI STRUTTURA:
${kb}`;
}

// ---------------- Chat ----------------
async function handleChat(request, env, slug) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "JSON non valido" }, 400); }
  const messages = Array.isArray(body.messages) ? body.messages.slice(-10) : [];
  const lang = (body.lang || "it").slice(0, 2);
  if (!messages.length) return json({ error: "messages mancante" }, 400);

  // rate limit soft: max 300 domande/giorno per struttura, protegge il budget
  const limitKey = `wb:${slug}:chatcount:${todayStr()}`;
  const count = parseInt((await env.WB_KV.get(limitKey)) || "0", 10);
  if (count > 300) {
    return json({ reply: "Il concierge ha raggiunto il limite giornaliero di richieste. Scrivici su WhatsApp, rispondiamo subito!" });
  }

  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: "Concierge non configurato" }, 503);
  }

  const apiMessages = messages
    .filter(m => m && m.role && m.content)
    .map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content).slice(0, 2000) }));

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 400,
        system: systemPrompt(slug, lang),
        messages: apiMessages
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return json({ error: "Errore concierge", detail: errText.slice(0, 300) }, 502);
    }
    const data = await resp.json();
    const reply = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n").trim()
      || "Non sono riuscito a formulare una risposta. Scrivici su WhatsApp!";

    // contatori: uso globale + log domanda per l'analisi "domande frequenti"
    // avvolti in try/catch separato: se KV fallisce (es. limite giornaliero raggiunto),
    // l'ospite riceve comunque la risposta corretta invece di un errore
    try {
      await env.WB_KV.put(limitKey, String(count + 1), { expirationTtl: 60 * 60 * 24 * 3 });
      const lastQ = apiMessages.filter(m => m.role === "user").pop();
      if (lastQ) {
        const qKey = `wb:${slug}:q:${todayStr()}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
        await env.WB_KV.put(qKey, JSON.stringify({ q: lastQ.content.slice(0, 300), lang }), { expirationTtl: 60 * 60 * 24 * 90 });
      }
    } catch (logErr) { /* logging non riuscito: non deve mai far perdere la risposta all'ospite */ }

    return json({ reply });
  } catch (e) {
    return json({ error: "Errore di rete verso il concierge" }, 502);
  }
}

// ---------------- Tracking ----------------
async function handleTrack(request, env, slug) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "JSON non valido" }, 400); }
  const event = (body.event || "").slice(0, 40);
  const section = (body.section || "").slice(0, 40);
  const lang = (body.lang || "").slice(0, 5);
  if (!event) return json({ error: "event mancante" }, 400);

  const day = todayStr();
  const incr = async (key) => {
    const cur = parseInt((await env.WB_KV.get(key)) || "0", 10);
    await env.WB_KV.put(key, String(cur + 1), { expirationTtl: 60 * 60 * 24 * 120 });
  };

  try {
    await incr(`wb:${slug}:day:${day}:total`);
    await incr(`wb:${slug}:day:${day}:evt:${event}`);
    if (section) await incr(`wb:${slug}:day:${day}:sec:${section}`);
    if (lang) await incr(`wb:${slug}:day:${day}:lang:${lang}`);
  } catch (e) { /* limite KV giornaliero o altro errore: non deve mai rompere la pagina dell'ospite */ }

  return json({ ok: true });
}

// ---------------- Dati dinamici (food/eventi/concerti) ----------------
async function handleData(request, env, slug, url) {
  const lang = (url.searchParams.get("lang") || "en").slice(0, 2);
  const food = await env.WB_KV.get(`wb:${slug}:food`);
  // eventi/concerti sono contenuti "città" (Roma), condivisi tra tutte le strutture
  const eventiRaw = await env.WB_KV.get(`wb:roma:eventi`);
  const concerti = await env.WB_KV.get(`wb:roma:concerti`);

  let eventi = null;
  if (eventiRaw) {
    const parsed = JSON.parse(eventiRaw);
    eventi = Array.isArray(parsed) ? parsed : (parsed[lang] || parsed.it || null);
  }

  return json({
    food: food ? JSON.parse(food) : null,
    eventi,
    concerti: concerti ? JSON.parse(concerti) : null
  });
}

const MESI = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ---------------- Concerti: refresh da Ticketmaster Discovery API ----------------
const SEGMENT_EMOJI = {
  "Music": "🎵", "Sports": "⚽", "Arts & Theatre": "🎭", "Film": "🎬", "Miscellaneous": "🎪"
};

function fmtEventDate(localDate, localTime) {
  if (!localDate) return "";
  const [y, m, d] = localDate.split("-").map(Number);
  const giorno = `${d} ${MESI[m - 1]}`;
  if (localTime) return `${giorno} · ${localTime.slice(0, 5)}`;
  return giorno;
}

async function refreshConcerti(env, slug, city) {
  if (!env.TM_API_KEY) return { ok: false, error: "TM_API_KEY non configurata" };
  const apiUrl = `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${env.TM_API_KEY}&city=${encodeURIComponent(city)}&countryCode=IT&size=20&sort=date,asc`;
  const resp = await fetch(apiUrl);
  if (!resp.ok) return { ok: false, error: `Ticketmaster ${resp.status}` };
  const data = await resp.json();
  const rawEvents = data._embedded?.events || [];

  const oggi = new Date().toISOString().slice(0, 10);
  const limite = new Date();
  limite.setUTCDate(limite.getUTCDate() + 90);
  const dataLimite = limite.toISOString().slice(0, 10);

  const concerti = rawEvents
    .filter(e => {
      const d = e.dates?.start?.localDate;
      return d && d >= oggi && d <= dataLimite;
    })
    .slice(0, 10)
    .map(e => {
      const cls = e.classifications?.[0] || {};
      const segment = cls.segment?.name || "";
      const genre = cls.genre?.name;
      const venue = e._embedded?.venues?.[0];
      return {
        emoji: SEGMENT_EMOJI[segment] || "🎫",
        titolo: e.name,
        quando: fmtEventDate(e.dates?.start?.localDate, e.dates?.start?.localTime),
        dove: venue?.name || "",
        descr: (genre && genre !== "Undefined" && genre !== "Other") ? `${segment} · ${genre}` : segment,
        link: e.url
      };
    });

  await env.WB_KV.put(`wb:roma:concerti`, JSON.stringify(concerti), { expirationTtl: 60 * 60 * 24 * 7 });
  return { ok: true, count: concerti.length };
}

// ---------------- Eventi: refresh da RomaToday (categorie ampie: sagre, mercatini, mostre, manifestazioni...) ----------------
const TITLE_EMOJI = [
  [/mostra|esposizion|museo|galleria/i, "🖼️"],
  [/sagra|street food|mercatino|degustazion|vino|food/i, "🍕"],
  [/festival/i, "🎪"],
  [/opera|balletto|danza/i, "🎭"],
  [/concerto|live|musica|jazz|orchestra/i, "🎵"],
  [/pride|parata/i, "🏳️‍🌈"],
  [/film|cinema/i, "🎬"],
  [/sport|rally|gara|corsa/i, "🏁"]
];
function guessEmoji(titolo) {
  for (const [re, emoji] of TITLE_EMOJI) if (re.test(titolo)) return emoji;
  return "📌";
}
function decodeEntities(s) {
  if (!s) return s;
  return s
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/&rdquo;|&ldquo;/g, '"')
    .replace(/&ndash;/g, "–").replace(/&mdash;/g, "—")
    .replace(/&agrave;/g, "à").replace(/&egrave;/g, "è").replace(/&igrave;/g, "ì")
    .replace(/&ograve;/g, "ò").replace(/&ugrave;/g, "ù")
    .replace(/&Agrave;/g, "À").replace(/&Egrave;/g, "È")
    .replace(/&eacute;/g, "é").replace(/&ograve;/g, "ó")
    .replace(/&amp;/g, "&").replace(/&#039;/g, "'").replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ");
}
async function fetchMeta(html, prop) {
  const re = new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`, "i");
  const m = html.match(re);
  return m ? decodeEntities(m[1]) : "";
}

function parseItDate(s) {
  const [d, m, y] = s.split("/").map(Number);
  return { y, m, d };
}
function fmtItDate(dateStr) {
  const { m, d } = parseItDate(dateStr);
  return `${d} ${MESI[m - 1]}`;
}
function extractQuandoDove(html) {
  let quando = "";
  const qm = html.match(/>Quando<\/span>[\s\S]{0,220}Dal <span[^>]*>(\d{2}\/\d{2}\/\d{4})<\/span>[\s\S]{0,220}al <span[^>]*>(\d{2}\/\d{2}\/\d{4})<\/span>/);
  if (qm) {
    quando = qm[1] === qm[2] ? fmtItDate(qm[1]) : `${fmtItDate(qm[1])} - ${fmtItDate(qm[2])}`;
  } else {
    const single = html.match(/>Quando<\/span>[\s\S]{0,220}<span[^>]*>(\d{2}\/\d{2}\/\d{4})<\/span>/);
    if (single) quando = fmtItDate(single[1]);
  }

  let dove = "";
  const dm = html.match(/>Dove<\/span>[\s\S]{0,220}o-link-primary[^>]*>\s*([^<]+?)\s*</);
  if (dm) dove = decodeEntities(dm[1].trim());

  // ultima data valida per il filtro di scadenza (fine evento, o data singola)
  let endDate = null;
  if (qm) endDate = parseItDate(qm[2]);
  else {
    const single = html.match(/>Quando<\/span>[\s\S]{0,220}<span[^>]*>(\d{2}\/\d{2}\/\d{4})<\/span>/);
    if (single) endDate = parseItDate(single[1]);
  }
  return { quando, dove, endDate };
}
function dateStillValid(endDate) {
  if (!endDate) return true; // nessuna data trovata: includi comunque
  const oggi = new Date(); oggi.setUTCHours(0, 0, 0, 0);
  const end = new Date(Date.UTC(endDate.y, endDate.m - 1, endDate.d));
  return end >= oggi;
}

const EVENTI_LANGS = ["it", "en", "es", "fr", "de", "pt", "zh"];

async function translateEventi(env, eventiSrc, sourceLang) {
  if (!env.ANTHROPIC_API_KEY || !eventiSrc.length) return null;
  const targets = EVENTI_LANGS.filter(l => l !== sourceLang);
  const input = eventiSrc.map((e, i) => ({ id: i, titolo: e.titolo, descr: e.descr }));
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 8000,
        system: `Sei un traduttore professionista per un'app di ospitalità turistica a Roma. Ricevi un array JSON di oggetti {id,titolo,descr} nella lingua sorgente "${sourceLang}". Restituisci SOLO un oggetto JSON valido (nessun testo extra, nessun blocco markdown) con questa struttura esatta: {${targets.map(l => `"${l}":[{"titolo":"","descr":""}]`).join(",")}}. Ogni array deve avere esattamente lo stesso numero di elementi, nello stesso ordine dell'input. Traduci in modo naturale e scorrevole, non letterale, mantenendo nomi propri di luoghi/eventi quando appropriato.`,
        messages: [{ role: "user", content: JSON.stringify(input) }]
      })
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    for (const lang of targets) {
      if (!Array.isArray(parsed[lang]) || parsed[lang].length !== eventiSrc.length) return null;
    }
    return parsed;
  } catch (e) { return null; }
}

async function refreshEventi(env, slug) {
  const UA = "Mozilla/5.0 (compatible; wb-worker/1.0)";
  const resp = await fetch("https://www.romatoday.it/eventi/", { headers: { "User-Agent": UA } });
  if (!resp.ok) return { ok: false, error: `RomaToday ${resp.status}` };
  const html = await resp.text();

  const urls = [...new Set(
    [...html.matchAll(/href="(\/eventi\/[a-zA-Z0-9\-]+\.html)"/g)].map(m => `https://www.romatoday.it${m[1]}`)
  )].slice(0, 20);

  const eventiSrc = [];
  for (const link of urls) {
    if (eventiSrc.length >= 12) break;
    try {
      const dResp = await fetch(link, { headers: { "User-Agent": UA } });
      if (!dResp.ok) continue;
      const dHtml = await dResp.text();
      const titolo = await fetchMeta(dHtml, "og:title");
      if (!titolo) continue;
      const descr = await fetchMeta(dHtml, "description");
      const { quando, dove, endDate } = extractQuandoDove(dHtml);
      if (!dateStillValid(endDate)) continue;
      eventiSrc.push({ emoji: guessEmoji(titolo), titolo, quando, dove, descr, link });
    } catch (e) { /* salta questo link, continua con gli altri */ }
  }

  const translations = await translateEventi(env, eventiSrc, "it");
  const multiLang = { it: eventiSrc };
  for (const lang of EVENTI_LANGS) {
    if (lang === "it") continue;
    multiLang[lang] = translations
      ? eventiSrc.map((e, i) => ({ ...e, titolo: translations[lang][i].titolo, descr: translations[lang][i].descr }))
      : eventiSrc;
  }

  await env.WB_KV.put(`wb:roma:eventi`, JSON.stringify(multiLang), { expirationTtl: 60 * 60 * 24 * 7 });
  return { ok: true, count: eventiSrc.length, translated: !!translations };
}

async function handleRefreshEventi(request, env, slug, url) {
  const key = url.searchParams.get("key");
  if (!env.WB_ADMIN_KEY || key !== env.WB_ADMIN_KEY) return json({ error: "non autorizzato" }, 401);
  const result = await refreshEventi(env, slug);
  return json(result, result.ok ? 200 : 502);
}

async function handleRefreshConcerti(request, env, slug, url) {
  const key = url.searchParams.get("key");
  if (!env.WB_ADMIN_KEY || key !== env.WB_ADMIN_KEY) return json({ error: "non autorizzato" }, 401);
  const city = url.searchParams.get("city") || "Roma";
  const result = await refreshConcerti(env, slug, city);
  return json(result, result.ok ? 200 : 502);
}

// ---------------- Stats (admin) ----------------
async function handleStats(request, env, slug, url) {
  const key = url.searchParams.get("key");
  if (!env.WB_ADMIN_KEY || key !== env.WB_ADMIN_KEY) return json({ error: "non autorizzato" }, 401);

  const days = Math.min(parseInt(url.searchParams.get("days") || "14", 10), 90);
  const out = { slug, days, byDay: {}, sections: {}, langs: {}, events: {} };

  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const day = d.toISOString().slice(0, 10);
    const prefix = `wb:${slug}:day:${day}:`;
    const list = await env.WB_KV.list({ prefix });
    let total = 0;
    for (const k of list.keys) {
      const val = parseInt((await env.WB_KV.get(k.name)) || "0", 10);
      const rest = k.name.slice(prefix.length);
      if (rest === "total") { total = val; continue; }
      if (rest.startsWith("sec:")) out.sections[rest.slice(4)] = (out.sections[rest.slice(4)] || 0) + val;
      else if (rest.startsWith("lang:")) out.langs[rest.slice(5)] = (out.langs[rest.slice(5)] || 0) + val;
      else if (rest.startsWith("evt:")) out.events[rest.slice(4)] = (out.events[rest.slice(4)] || 0) + val;
    }
    out.byDay[day] = total;
  }

  // domande recenti al concierge (ultime 40)
  const qList = await env.WB_KV.list({ prefix: `wb:${slug}:q:`, limit: 1000 });
  const sorted = qList.keys.sort((a, b) => (a.name < b.name ? 1 : -1)).slice(0, 40);
  out.recentQuestions = [];
  for (const k of sorted) {
    const val = await env.WB_KV.get(k.name);
    if (val) { try { out.recentQuestions.push(JSON.parse(val)); } catch (e) {} }
  }

  return json(out);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    try {
      const url = new URL(request.url);
      const parts = url.pathname.split("/").filter(Boolean); // ["wb", slug, action]
      if (parts[0] !== "wb" || !parts[1]) return json({ error: "Percorso non valido" }, 404);
      const slug = parts[1];
      const action = parts[2];

      if (action === "chat" && request.method === "POST") return await handleChat(request, env, slug);
      if (action === "track" && request.method === "POST") return await handleTrack(request, env, slug);
      if (action === "data" && request.method === "GET") return await handleData(request, env, slug, url);
      if (action === "stats" && request.method === "GET") return await handleStats(request, env, slug, url);
      if (action === "refresh-eventi" && request.method === "GET") return await handleRefreshEventi(request, env, slug, url);
      if (action === "refresh-concerti" && request.method === "GET") return await handleRefreshConcerti(request, env, slug, url);

      return json({ error: "Rotta non trovata" }, 404);
    } catch (e) {
      return json({ error: "Errore interno", detail: String(e).slice(0, 200) }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    // Aggiornamento giornaliero eventi + concerti Roma per tutte le strutture attive
    ctx.waitUntil(refreshEventi(env, "campaldino"));
    ctx.waitUntil(refreshConcerti(env, "campaldino", "Roma"));
  }
};
