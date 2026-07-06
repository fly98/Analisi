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
PARCHEGGIO: Via Campaldino e Via Cupa sono strade condominiali private, gratuito se c'è posto. Alternativa: Garage Di Nezza sotto la struttura, ingresso da Via Cupa, tel +39 320 8667617, Lun-Sab 6:30-01:00, Dom 7:00-11:00 e 19:00-23:00.
METRO: Piazza Bologna, Linea B, 400m/10 min a piedi. Termini 3 fermate, Colosseo 5 fermate. Orari dom-gio 5:30-23:30, ven-sab 5:30-01:30.
BIGLIETTI ATAC: 1,50€ (100 min), 7€ (24h), 12,50€ (48h), 18€ (72h). In vendita in metro, tabacchi, edicole, o app TicketAppy.
WIFI: nome rete e password sono affissi in camera su un cartoncino; se l'ospite non lo trova, invitalo a scrivere su WhatsApp.
NETFLIX: gratuito su smart TV, tasto dedicato sul telecomando. Se chiede un codice, invitalo a mandare foto del QR via WhatsApp.
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
Di fronte alla stazione Tiburtina e alla stazione bus TIBUS. Camere con bagno privato, angolo cottura, aria condizionata, terrazza.
CHECK-IN: dalle 14:00. CHECK-OUT: entro le 10:00; se non trovi lo staff lascia la chiave sul bancone reception.
PARCHEGGIO: Garage Bologna nelle vicinanze (indicazioni in loco).
METRO: Stazione Tiburtina (Linea B) a pochi minuti a piedi.
WIFI: nome rete e password affissi in camera; se non trovato, scrivere su WhatsApp.
NETFLIX: gratuito su smart TV, tasto dedicato sul telecomando.
SILENZIO: 22:00-08:00.
ARIA CONDIZIONATA: va sempre spenta uscendo dalla camera.
ANIMALI: benvenuti gratuitamente, non sui letti né liberi nelle aree comuni.
FUMO: vietato in tutta la struttura.
EMERGENZE: Polizia/Carabinieri 112, Emergenza medica 118, Taxi Roma 06 3570, Info turistiche Roma 06 0606.
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
    await env.WB_KV.put(limitKey, String(count + 1), { expirationTtl: 60 * 60 * 24 * 3 });
    const lastQ = apiMessages.filter(m => m.role === "user").pop();
    if (lastQ) {
      const qKey = `wb:${slug}:q:${todayStr()}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
      await env.WB_KV.put(qKey, JSON.stringify({ q: lastQ.content.slice(0, 300), lang }), { expirationTtl: 60 * 60 * 24 * 90 });
    }

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

  await incr(`wb:${slug}:day:${day}:total`);
  await incr(`wb:${slug}:day:${day}:evt:${event}`);
  if (section) await incr(`wb:${slug}:day:${day}:sec:${section}`);
  if (lang) await incr(`wb:${slug}:day:${day}:lang:${lang}`);

  return json({ ok: true });
}

// ---------------- Dati dinamici (food/eventi) ----------------
async function handleData(request, env, slug, url) {
  const food = await env.WB_KV.get(`wb:${slug}:food`);
  const eventi = await env.WB_KV.get(`wb:${slug}:eventi`);
  return json({
    food: food ? JSON.parse(food) : null,
    eventi: eventi ? JSON.parse(eventi) : null
  });
}

// ---------------- Eventi: refresh da Ticketmaster Discovery API ----------------
const SEGMENT_EMOJI = {
  "Music": "🎵", "Sports": "⚽", "Arts & Theatre": "🎭", "Film": "🎬", "Miscellaneous": "🎪"
};
const MESI = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtEventDate(localDate, localTime) {
  if (!localDate) return "";
  const [y, m, d] = localDate.split("-").map(Number);
  const giorno = `${d} ${MESI[m - 1]}`;
  if (localTime) return `${giorno} · ${localTime.slice(0, 5)}`;
  return giorno;
}

async function refreshEventi(env, slug, city) {
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

  const eventi = rawEvents
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

  await env.WB_KV.put(`wb:${slug}:eventi`, JSON.stringify(eventi), { expirationTtl: 60 * 60 * 24 * 7 });
  return { ok: true, count: eventi.length };
}

async function handleRefreshEventi(request, env, slug, url) {
  const key = url.searchParams.get("key");
  if (!env.WB_ADMIN_KEY || key !== env.WB_ADMIN_KEY) return json({ error: "non autorizzato" }, 401);
  const city = url.searchParams.get("city") || "Roma";
  const result = await refreshEventi(env, slug, city);
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

      return json({ error: "Rotta non trovata" }, 404);
    } catch (e) {
      return json({ error: "Errore interno", detail: String(e).slice(0, 200) }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    // Aggiornamento giornaliero eventi Roma per tutte le strutture attive
    ctx.waitUntil(refreshEventi(env, "campaldino", "Roma"));
  }
};
