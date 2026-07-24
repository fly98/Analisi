/**
 * fisco-worker — riconciliazione ricevute AdE <-> prenotazioni Amenitiz
 *
 * Fonti:
 *   - Ricevute (Documenti Commerciali Online): API DataCash/TelnetData
 *     che legge il cassetto fiscale AdE (il login diretto e' bloccato
 *     da Akamai sugli IP datacenter).
 *   - Prenotazioni: API Amenitiz via worker little-shadow-145e.
 *
 * Secrets: DATACASH_KEY, ADE_CRED_ENC, API_TOKEN
 *
 * Endpoint:
 *   GET /health
 *   GET /infouser
 *   GET /dco?dal=&al=            ricevute (chunking automatico 31gg)
 *   GET /prenotazioni?dal=&al=   prenotazioni Amenitiz normalizzate
 *   GET /riconcilia?dal=&al=[&margine=30]   match completo
 */

const DC_BASE = 'https://dwadmin.telnetdata.it/api/dco';
const LS_BASE = 'https://little-shadow-145e.f-castiglioni.workers.dev';

// Tassa di soggiorno Roma: 5 EUR per adulto per notte, max 10 notti
const CITY_TAX_NOTTE = 5;
const CITY_TAX_MAX_NOTTI = 10;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'X-Token, Content-Type',
      // i dati cambiano a ogni abbinamento: il browser non deve riusarli
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });

/* ---------------------------------------------------------------- */
/* Utility date                                                      */
/* ---------------------------------------------------------------- */
const giorno = (d) => d.toISOString().slice(0, 10);
const addGiorni = (iso, n) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return giorno(d);
};
const notti = (ci, co) =>
  Math.max(1, Math.round((new Date(co) - new Date(ci)) / 86400000));

// "23/07/2026 12:37:41" -> Date
function parseItDate(str) {
  const m = String(str).match(
    /(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/
  );
  if (!m) return null;
  const [, d, mo, y, hh = '00', mi = '00', ss = '00'] = m;
  return new Date(`${y}-${mo}-${d}T${hh}:${mi}:${ss}Z`);
}

/* ---------------------------------------------------------------- */
/* DataCash                                                          */
/* ---------------------------------------------------------------- */
function credenziali(env) {
  const raw = (env.ADE_CRED_ENC || '').trim();
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}

// estrae i codici di errore da qualunque forma di risposta
function codiciErrore(data) {
  const cod = [];
  if (!data || typeof data !== 'object') return cod;
  if (Array.isArray(data.errori)) {
    for (const e of data.errori) if (e && e.codice) cod.push(String(e.codice));
  }
  if (data.errore && data.errore.codice) cod.push(String(data.errore.codice));
  if (data.codice) cod.push(String(data.codice));
  return cod;
}

// 01 = credenziali rifiutate, 03 = password scaduta
const ERRORI_CREDENZIALI = ['01', '03', '1', '3'];

async function chiamaDatacash(env, path, payload) {
  const res = await fetch(DC_BASE + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Datacash-Key': env.DATACASH_KEY,
      Accept: 'application/json',
    },
    body: JSON.stringify({ ade_credentials_encrypted: credenziali(env), ...payload }),
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* risposta non JSON */
  }
  return { res, text, data };
}

async function datacash(env, path, payload, riprova = true) {
  let { res, text, data } = await chiamaDatacash(env, path, payload);

  const credenzialiKo =
    codiciErrore(data).some((c) => ERRORI_CREDENZIALI.includes(c)) ||
    /password scadut|autenticazione fallita/i.test(text);

  // password scaduta o credenziali rifiutate: la rinnovo e ritento una volta
  if (credenzialiKo && riprova && path !== '/resetPassword/') {
    try {
      await chiamaDatacash(env, '/resetPassword/', {});
    } catch {
      /* se il rinnovo fallisce si prosegue e l'errore originale viene riportato */
    }
    ({ res, text, data } = await chiamaDatacash(env, path, payload));
  }

  if (!data) {
    throw new Error(`DataCash ${path} HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const msg =
      data?.errore?.descrizione ||
      (data.errori || []).map((e) => `${e.codice || ''} ${e.descrizione || ''}`.trim()).join('; ') ||
      data.message ||
      JSON.stringify(data);
    throw new Error(`DataCash ${path} HTTP ${res.status}: ${String(msg).slice(0, 200)}`);
  }
  return data;
}

// l'API accetta al massimo 31 giorni per chiamata: spezzo in blocchi
async function fetchRicevute(env, dal, al) {
  // l'API DataCash accetta al massimo 31 giorni: spezzo in blocchi paralleli
  const blocchi = [];
  let cursore = dal;
  while (cursore <= al) {
    let fine = addGiorni(cursore, 30);
    if (fine > al) fine = al;
    blocchi.push({ start: cursore, end: fine });
    if (fine === al) break;
    cursore = addGiorni(fine, 1);
  }

  const risposte = await Promise.all(
    blocchi.map((b) =>
      datacash(env, '/findDocuments/', b).catch(() => ({ results: [] }))
    )
  );

  const documenti = [];
  for (const data of risposte) {
    const results = Array.isArray(data) ? data : data.results || [];
    for (const r of results) {
      const dt = parseItDate(r.data);
      documenti.push({
        id: r.idtrx,
        numero: r.numeroProgressivo,
        dataRaw: r.data,
        data: dt ? dt.toISOString() : null,
        giorno: dt ? giorno(dt) : null,
        importo: r.ammontareComplessivo,
        centesimi: Math.round(r.ammontareComplessivo * 100),
        tipo: r.tipoOperazione,
      });
    }
  }

  const visti = new Set();
  const unici = documenti.filter((d) => {
    if (visti.has(d.id)) return false;
    visti.add(d.id);
    return true;
  });
  unici.sort((a, b) => (a.data < b.data ? 1 : -1));

  // A = annullo, R = reso: compensano una vendita di pari importo emessa
  // in precedenza. Quella vendita non e' piu' un documento valido.
  const vendite = unici.filter((d) => d.tipo === 'V');
  const rettifiche = unici.filter((d) => d.tipo !== 'V');

  // annulli eseguiti dall'app: so con certezza quale documento hanno colpito
  const registrate = await leggiAnnullate(env);
  let daCompensare = rettifiche.length;
  for (const v of vendite) {
    if (registrate.includes(String(v.id))) {
      v.annullata = true;
      v.annullataDa = 'annullo registrato';
      daCompensare--;
    }
  }

  // dalla piu' vecchia alla piu' recente, per abbinare in ordine
  const venditeCron = [...vendite].sort((a, b) => (a.data > b.data ? 1 : -1));
  const rettCron = [...rettifiche].sort((a, b) => (a.data > b.data ? 1 : -1));

  for (const r of rettCron) {
    if (daCompensare <= 0) break; // gia' coperti dagli annulli registrati
    // la vendita annullata e' quella di pari importo piu' vicina nel tempo
    let scelta = null;
    for (const v of venditeCron) {
      if (v.annullata) continue;
      if (v.centesimi !== r.centesimi) continue;
      if (v.data > r.data) continue;
      scelta = v; // scorrendo in ordine resta l'ultima precedente
    }
    if (scelta) {
      scelta.annullata = true;
      scelta.annullataDa = r.numero;
      r.annulla = scelta.numero;
      daCompensare--;
    }
  }

  const valide = vendite.filter((v) => !v.annullata);

  return {
    count: unici.length,
    countVendite: valide.length,
    countAnnullate: vendite.length - valide.length,
    countRettifiche: rettifiche.length,
    totale: Math.round(valide.reduce((s, x) => s + x.centesimi, 0)) / 100,
    documenti: unici,
  };
}

/* ---------------------------------------------------------------- */
/* Amenitiz                                                          */
/* ---------------------------------------------------------------- */
async function fetchPrenotazioni(env, dal, al) {
  // L'API filtra per data di arrivo, ma il periodo richiesto si riferisce
  // alla partenza: allargo l'inizio per intercettare i soggiorni lunghi
  // gia' in corso, poi tengo solo quelli che terminano nel periodo.
  const dalEsteso = addGiorni(dal, -45);

  // Amenitiz rifiuta intervalli superiori a ~1 mese: spezzo e parallelizzo
  const blocchi = [];
  let cursore = dalEsteso;
  while (cursore <= al) {
    let fine = addGiorni(cursore, 27);
    if (fine > al) fine = al;
    blocchi.push({ from: cursore, to: fine });
    if (fine === al) break;
    cursore = addGiorni(fine, 1);
  }

  const risposte = await Promise.all(
    blocchi.map(async (b) => {
      const target = `${LS_BASE}/?action=debugBooking&from=${b.from}&to=${b.to}`;
      try {
        const res = env.LS
          ? await env.LS.fetch(new Request(target, { headers: { 'User-Agent': 'fisco-worker' } }))
          : await fetch(target, { headers: { 'User-Agent': 'fisco-worker' } });
        if (!res.ok) return [];
        let raw = await res.json();
        if (raw && !Array.isArray(raw)) raw = raw.bookings || raw.results || [];
        if (typeof raw === 'string') raw = JSON.parse(raw);
        return Array.isArray(raw) ? raw : [];
      } catch {
        return [];
      }
    })
  );

  const prenotazioni = [];
  const visti = new Set();

  for (const batch of risposte) {
    for (const b of batch) {
      const stato = String(b.status || '').toLowerCase();
      if (stato === 'cancelled' || stato === 'canceled') continue;
      if (!b.checkin || !b.checkout) continue;
      // tengo solo i soggiorni che si concludono dentro il periodo
      if (b.checkout < dal || b.checkout > al) continue;
      if (visti.has(b.booking_id)) continue;
      visti.add(b.booking_id);

      const n = notti(b.checkin, b.checkout);
      const adulti = b.adults || 1;
      const totale = Math.round((parseFloat(b.total_amount_after_tax) || 0) * 100);
      const nottiTax = Math.min(n, CITY_TAX_MAX_NOTTI);
      const cityTax = adulti * nottiTax * CITY_TAX_NOTTE * 100;
      // Amenitiz a volte conteggia la tassa anche sui bambini
      const cityTaxTutti = (adulti + (b.children || 0)) * nottiTax * CITY_TAX_NOTTE * 100;
      const booker = b.booker || {};
      // Amenitiz a volte non valorizza il prenotante: ricado sull'ospite
      // della prima camera e, per le aziende, sul dominio dell'email
      const primoOspite =
        (b.rooms && b.rooms[0] && b.rooms[0].guests && b.rooms[0].guests[0]) || {};
      const nomeProprio = (booker.first_name || '').trim() || (primoOspite.first_name || '').trim();
      const cognomeProprio = (booker.last_name || '').trim() || (primoOspite.last_name || '').trim();

      const RAGIONI = /^(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?a\.?s\.?|s\.?n\.?c\.?|s\.?s\.?|ltd|llc|inc|gmbh|bv|sa|srl|spa)$/i;
      const eRagione = (x) => RAGIONI.test(String(x || '').replace(/\./g, '').trim());
      const emailBooker = (booker.email || '').trim();

      const nomeDaDominio = (() => {
        if (!emailBooker.includes('@')) return '';
        const dom = emailBooker.split('@')[1] || '';
        // i portali e le caselle personali non identificano un'azienda
        const generici =
          /guest\.booking\.com|expedia|airbnb|amenitiz|gmail|hotmail|outlook|live\.|yahoo|libero|icloud|virgilio|alice\.|tiscali|tin\.it|fastwebnet|me\.com|pec\./i;
        if (!dom || generici.test(dom)) return '';
        const base = dom.split('.')[0] || '';
        return base ? base.charAt(0).toUpperCase() + base.slice(1) : '';
      })();

      const senzaNome = !nomeProprio && !cognomeProprio;
      let nomeFinale;
      if ((eRagione(nomeProprio) || eRagione(cognomeProprio))) {
        // ricompone "BSF Srl" invece di "Srl BSF"
        nomeFinale = [cognomeProprio, nomeProprio].filter(Boolean).join(' ').trim();
      } else if (senzaNome && nomeDaDominio) {
        nomeFinale = nomeDaDominio;
      } else {
        nomeFinale = `${nomeProprio} ${cognomeProprio}`.trim();
      }
      const camere = (b.rooms || [])
        .map((r) => r.individual_room_name)
        .filter(Boolean);

      prenotazioni.push({
        id: String(b.booking_id),
        nome: nomeFinale,
        email: booker.email || '',
        telefono: booker.phone || '',
        lingua: (booker.language || '').toUpperCase(),
        canale: b.source || '',
        checkin: b.checkin,
        checkout: b.checkout,
        notti: n,
        adulti,
        bambini: b.children || 0,
        camere,
        totale: totale / 100,
        cityTax: cityTax / 100,
        attesoCents: totale - cityTax,
        atteso: (totale - cityTax) / 100,
        // varianti usate solo dal motore di abbinamento:
        // la tassa puo' essere stata calcolata su un numero di persone
        // diverso da quello registrato in Amenitiz
        attesoBimbiCents: totale - cityTaxTutti,
        attesoAltCents: totale,
        cityTaxTutti: cityTaxTutti / 100,
        variantiCents: (() => {
          const out = [];
          const camereN = Math.max(1, (b.rooms || []).length);
          // nelle prenotazioni multi-camera la tassa e' contata per camera
          const maxPersone = (adulti + (b.children || 0)) * camereN + 2;
          for (let k = 0; k <= maxPersone; k++) {
            const v = totale - k * nottiTax * CITY_TAX_NOTTE * 100;
            if (v > 0) out.push({ persone: k, cents: v });
          }
          return out;
        })(),
      });
    }
  }

  prenotazioni.sort((a, b) => (a.checkin < b.checkin ? 1 : -1));
  return prenotazioni;
}

/* ---------------------------------------------------------------- */
/* Motore di match                                                   */
/* ---------------------------------------------------------------- */
// Il motore lavora a ondate: prima abbina le ricevute emesse a ridosso
// del soggiorno, poi allarga progressivamente. Cosi' una prenotazione
// lontana non "ruba" la ricevuta a quella giusta.
const ONDATE = [3, 10, 15, 30];

// giorni oltre il periodo entro cui cercare le ricevute: identico
// in tutte le viste, altrimenti il motore vede insiemi diversi
// e produce abbinamenti incoerenti fra una schermata e l'altra
const MARGINE_RICEVUTE = 45;

// Sulle prenotazioni diretse il pagamento puo' arrivare prima dell'arrivo,
// quindi la ricevuta puo' precedere il soggiorno. Sui portali no.
const CANALI_DIRETTI = ['manual', 'amenitiz', ''];
function anticipoConsentito(canale) {
  const c = String(canale || '').toLowerCase();
  // sui canali diretti il pagamento anticipato e' frequente;
  // sui portali capita solo a ridosso dell'arrivo
  return CANALI_DIRETTI.includes(c) ? 10 : 3;
}

function riconcilia(prenotazioni, ricevute) {
  const disponibili = ricevute
    .filter((r) => r.tipo === 'V' && !r.annullata)
    .map((r) => ({ ...r }));
  const perImporto = new Map();
  for (const r of disponibili) {
    if (!perImporto.has(r.centesimi)) perImporto.set(r.centesimi, []);
    perImporto.get(r.centesimi).push(r);
  }

  const abbinamenti = [];
  const usate = new Set();
  const daAbbinare = prenotazioni.map((p) => ({ ...p, ricevuta: null, metodo: null }));

  // distanza in giorni fra emissione e soggiorno: zero se la ricevuta
  // cade fra arrivo e partenza, altrimenti scarto dall'estremo piu' vicino
  const distanza = (ric, pren) => {
    const g = ric.giorno;
    if (!g) return 999;
    // anticipo ammesso solo per le prenotazioni diretse
    if (g < addGiorni(pren.checkin, -anticipoConsentito(pren.canale))) return 999;
    if (g <= pren.checkout) return 0;
    return Math.round((new Date(g) - new Date(pren.checkout)) / 86400000);
  };

  function assegna(pren, ric, metodo) {
    usate.add(ric.id);
    pren.ricevuta = ric;
    pren.metodo = metodo;
    abbinamenti.push({ prenotazione: pren, ricevuta: ric, metodo });
  }

  // abbina su un dato criterio di importo, entro una soglia di giorni
  function passata(campoCents, etichetta, soglia) {
    const gruppi = new Map();
    for (const p of daAbbinare) {
      if (p.ricevuta) continue;
      const c = p[campoCents];
      if (c == null) continue;
      if (!gruppi.has(c)) gruppi.set(c, []);
      gruppi.get(c).push(p);
    }

    for (const [cents, prens] of gruppi) {
      const cand = (perImporto.get(cents) || []).filter((r) => !usate.has(r.id));
      if (!cand.length) continue;

      const coppie = [];
      for (const p of prens)
        for (const r of cand) {
          const d = distanza(r, p);
          if (d > soglia) continue;
          // criterio secondario: quanto dista l'emissione dal giorno di arrivo
          const dArrivo = Math.abs(
            (new Date(r.giorno) - new Date(p.checkin)) / 86400000
          );
          coppie.push({ p, r, d, dArrivo });
        }
      coppie.sort((a, b) => a.d - b.d || a.dArrivo - b.dArrivo);

      for (const { p, r, d } of coppie) {
        if (p.ricevuta || usate.has(r.id)) continue;
        const unico = prens.length === 1 && cand.length === 1;
        assegna(p, r, unico ? `${etichetta}-univoco` : `${etichetta}-data(${d}gg)`);
      }
    }
  }

  // tassa calcolata su un numero di persone diverso da quello registrato
  function passataVarianti(soglia) {
    for (const p of daAbbinare) {
      if (p.ricevuta || !p.variantiCents) continue;
      const trovati = [];
      for (const v of p.variantiCents) {
        for (const r of perImporto.get(v.cents) || []) {
          if (usate.has(r.id)) continue;
          const d = distanza(r, p);
          if (d <= soglia) trovati.push({ r, d, persone: v.persone });
        }
      }
      if (!trovati.length) continue;
      trovati.sort(
        (a, b) =>
          a.d - b.d ||
          Math.abs(new Date(a.r.giorno) - new Date(p.checkin)) -
            Math.abs(new Date(b.r.giorno) - new Date(p.checkin))
      );
      const t = trovati[0];
      assegna(p, t.r, `tassa-${t.persone}-persone${t.d ? `(${t.d}gg)` : ''}`);
    }
  }

  // una prenotazione puo' essere coperta da piu' ricevute:
  // tipico delle prenotazioni multi-camera, dove viene emesso
  // un documento per ogni camera
  function passataSomme(soglia) {
    for (const p of daAbbinare) {
      if (p.ricevuta) continue;

      const vicine = disponibili.filter(
        (r) => !usate.has(r.id) && distanza(r, p) <= soglia
      );
      if (vicine.length < 2) continue;

      // Solo i bersagli "naturali": con piu' ricevute le combinazioni casuali
      // sono frequentissime, quindi non uso tutte le varianti di tassa.
      const camereN = Math.max(1, (p.camere || []).length);
      const nottiTax = Math.min(p.notti, CITY_TAX_MAX_NOTTI);
      const tassaPerCamera =
        (p.adulti + (p.bambini || 0)) * camereN * nottiTax * CITY_TAX_NOTTE * 100;
      const bersagli = new Set([
        p.attesoCents, // tassa sugli adulti
        p.attesoBimbiCents, // tassa su adulti e bambini
        p.attesoAltCents, // nessuno scorporo
        Math.round(p.totale * 100) - tassaPerCamera, // tassa per ogni camera
      ]);

      // tolleranza di pochi centesimi: con piu' ricevute le combinazioni
      // casuali sono frequenti, quindi accetto solo somme quasi esatte
      const combacia = (somma) => {
        for (const b of bersagli) if (Math.abs(somma - b) <= 25) return b;
        return null;
      };

      let scelta = null;

      // coppie, dando la precedenza a importi uguali fra loro
      const ordinate = [...vicine].sort(
        (a, b) => distanza(a, p) - distanza(b, p)
      );
      for (let i = 0; i < ordinate.length && !scelta; i++) {
        for (let j = i + 1; j < ordinate.length && !scelta; j++) {
          const b = combacia(ordinate[i].centesimi + ordinate[j].centesimi);
          if (b !== null) scelta = [ordinate[i], ordinate[j]];
        }
      }
      // terne, solo se le coppie non bastano
      if (!scelta && ordinate.length >= 3) {
        for (let i = 0; i < ordinate.length && !scelta; i++)
          for (let j = i + 1; j < ordinate.length && !scelta; j++)
            for (let k = j + 1; k < ordinate.length && !scelta; k++) {
              const b = combacia(
                ordinate[i].centesimi + ordinate[j].centesimi + ordinate[k].centesimi
              );
              if (b !== null) scelta = [ordinate[i], ordinate[j], ordinate[k]];
            }
      }

      if (scelta) {
        const [prima, ...altre] = scelta;
        for (const r of scelta) usate.add(r.id);
        p.ricevuta = prima;
        p.ricevuteExtra = altre;
        p.metodo = `somma-${scelta.length}-ricevute`;
        abbinamenti.push({
          prenotazione: p,
          ricevuta: prima,
          extra: altre,
          metodo: p.metodo,
        });
      }
    }
  }

  // ondate progressive: prima le corrispondenze piu' vicine nel tempo
  for (const soglia of ONDATE) {
    passata('attesoCents', 'senza-tassa', soglia);
    passata('attesoBimbiCents', 'tassa-con-bambini', soglia);
    passata('attesoAltCents', 'con-tassa', soglia);
    passataVarianti(soglia);
    if (soglia <= 10) passataSomme(soglia);
  }

  const senzaRicevuta = daAbbinare.filter((p) => !p.ricevuta);
  const ricevuteOrfane = disponibili.filter((r) => !usate.has(r.id));

  const somma = (arr, f) => Math.round(arr.reduce((s, x) => s + f(x), 0)) / 100;

  return {
    riepilogo: {
      prenotazioni: prenotazioni.length,
      ricevuteVendita: disponibili.length,
      abbinate: abbinamenti.length,
      prenotazioniSenzaRicevuta: senzaRicevuta.length,
      ricevuteSenzaPrenotazione: ricevuteOrfane.length,
      percentualeMatch: prenotazioni.length
        ? Math.round((abbinamenti.length / prenotazioni.length) * 100)
        : 0,
      totaleAttesoPrenotazioni: somma(prenotazioni, (p) => p.attesoCents),
      totaleRicevute: somma(disponibili, (r) => r.centesimi),
      totaleNonCoperto: somma(senzaRicevuta, (p) => p.attesoCents),
      totaleOrfane: somma(ricevuteOrfane, (r) => r.centesimi),
    },
    abbinamenti: abbinamenti.map((a) => ({
      metodo: a.metodo,
      prenotazione: {
        id: a.prenotazione.id,
        nome: a.prenotazione.nome,
        canale: a.prenotazione.canale,
        checkin: a.prenotazione.checkin,
        checkout: a.prenotazione.checkout,
        totale: a.prenotazione.totale,
        cityTax: a.prenotazione.cityTax,
        atteso: a.prenotazione.atteso,
      },
      ricevuta: {
        numero: a.ricevuta.numero,
        id: a.ricevuta.id,
        data: a.ricevuta.dataRaw,
        importo: a.ricevuta.importo,
      },
      extra: (a.extra || []).map((r) => ({
        numero: r.numero,
        id: r.id,
        data: r.dataRaw,
        importo: r.importo,
      })),
    })),
    senzaRicevuta: senzaRicevuta.map((p) => ({
      id: p.id,
      nome: p.nome,
      canale: p.canale,
      checkin: p.checkin,
      checkout: p.checkout,
      notti: p.notti,
      adulti: p.adulti,
      totale: p.totale,
      cityTax: p.cityTax,
      atteso: p.atteso,
    })),
    ricevuteOrfane: ricevuteOrfane.map((r) => ({
      numero: r.numero,
      id: r.id,
      data: r.dataRaw,
      importo: r.importo,
    })),
  };
}

/* ---------------------------------------------------------------- */
/* Stato prenotazioni (KV)                                           */
/* ---------------------------------------------------------------- */
// stato: 'emessa' | 'fattura' | 'esclusa'
const chiaveStato = (id) => `fisco:st:${id}`;
const CHIAVE_INDICE = 'fisco:indice';

// Gli stati stanno in un unico documento: leggere centinaia di chiavi
// separate supera il limite di operazioni per invocazione e fallisce
// in silenzio. Le chiavi singole restano come copia di sicurezza.
async function leggiIndice(env) {
  if (!env.FISCO_KV) return {};
  try {
    return (await env.FISCO_KV.get(CHIAVE_INDICE, 'json')) || {};
  } catch {
    return {};
  }
}

async function leggiStati(env, ids) {
  const indice = await leggiIndice(env);
  if (!ids) return indice;
  const out = {};
  for (const id of ids) if (indice[id]) out[id] = indice[id];
  return out;
}

async function scriviStato(env, id, dati) {
  if (!env.FISCO_KV) throw new Error('KV non configurato');
  const indice = await leggiIndice(env);

  if (dati === null) {
    delete indice[id];
    await env.FISCO_KV.put(CHIAVE_INDICE, JSON.stringify(indice));
    await env.FISCO_KV.delete(chiaveStato(id));
    return null;
  }

  const record = { ...dati, aggiornato: new Date().toISOString() };
  indice[id] = record;
  await env.FISCO_KV.put(CHIAVE_INDICE, JSON.stringify(indice));
  await env.FISCO_KV.put(chiaveStato(id), JSON.stringify(record));
  return record;
}

// ricostruisce l'indice dalle chiavi singole (una tantum)
async function ricostruisciIndice(env) {
  if (!env.FISCO_KV) throw new Error('KV non configurato');
  const indice = await leggiIndice(env);
  let cursore, letti = 0, aggiunti = 0;
  do {
    const res = await env.FISCO_KV.list({ prefix: 'fisco:st:', cursor: cursore, limit: 1000 });
    for (const k of res.keys) {
      const id = k.name.replace('fisco:st:', '');
      letti++;
      if (indice[id]) continue;
      try {
        const v = await env.FISCO_KV.get(k.name, 'json');
        if (v) { indice[id] = v; aggiunti++; }
      } catch {
        /* chiave illeggibile: la salto */
      }
    }
    cursore = res.list_complete ? null : res.cursor;
  } while (cursore);
  await env.FISCO_KV.put(CHIAVE_INDICE, JSON.stringify(indice));
  return { chiaviTrovate: letti, aggiunte: aggiunti, totaleIndice: Object.keys(indice).length };
}

/* ---------------------------------------------------------------- */
/* Emissione e annullo documento                                     */
/* ---------------------------------------------------------------- */
// pagamento: PC contanti, PE elettronico, NR_EF segue fattura
// "2026-07-22" -> "22/07/2026"
function dataIt(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

function descrizioneStandard(pren) {
  const nome = (pren.nome || '').trim();
  return (
    `Soggiorno dal ${dataIt(pren.checkin)} al ${dataIt(pren.checkout)}` +
    (nome ? ` del Sig./Sig.ra ${nome}` : '')
  );
}

async function emettiDocumento(env, pren, opzioni = {}) {
  const {
    pagamento = 'PE',
    aliquota = '10',
    descrizione: descrizionePers,
    includiTassa = false,
    cityTax = 0,
    naturaTassa = 'N1', // imposta di soggiorno: fuori campo IVA (art. 15)
  } = opzioni;

  const descrizione = (descrizionePers || '').trim() || descrizioneStandard(pren);

  const elementi = [
    {
      aliquotaIVA: String(aliquota),
      percentualeIVA: parseInt(aliquota, 10),
      descrizioneProdotto: descrizione.slice(0, 100),
      prezzoLordo: pren.atteso,
      quantita: 1,
      scontoLordo: 0,
      omaggioElemento: false,
    },
  ];

  // la tassa di soggiorno e' riscossa per conto del Comune: niente IVA
  const tassa = includiTassa ? Math.round(Number(cityTax) * 100) / 100 : 0;
  if (tassa > 0) {
    elementi.push({
      aliquotaIVA: naturaTassa,
      percentualeIVA: 0,
      descrizioneProdotto: 'Imposta di soggiorno',
      prezzoLordo: tassa,
      quantita: 1,
      scontoLordo: 0,
      omaggioElemento: false,
    });
  }

  const totale = Math.round((pren.atteso + tassa) * 100) / 100;

  const documento = {
    elementiContabili: elementi,
    totaleScontiAPagare: 0,
    omaggio: false,
    codiceLotteria: '',
    pagamento,
    pagamenti: [{ tipo: pagamento, importo: totale }],
    ticketRestaurant: [],
    documentoCommercialeCollegato: '',
    multisede: {},
  };

  const res = await datacash(env, '/sendDocument/', { document: documento });
  if (res.esito === false) {
    const err = (res.errori || [])
      .map((e) => `${e.codice || ''} ${e.descrizione || ''}`.trim())
      .join('; ');
    throw new Error(err || 'emissione rifiutata');
  }
  return { ...res, totale };
}

const CHIAVE_ANNULLATE = 'fisco:annullate';

async function leggiAnnullate(env) {
  if (!env.FISCO_KV) return [];
  try {
    return (await env.FISCO_KV.get(CHIAVE_ANNULLATE, 'json')) || [];
  } catch {
    return [];
  }
}

async function annullaDocumento(env, idtrx) {
  let res;
  try {
    res = await datacash(env, `/voidDocument/${idtrx}/`, {});
  } catch (err) {
    // "annullo impossibile" significa che il documento e' gia' annullato:
    // lo registro comunque, altrimenti continuerebbe a comparire fra le orfane
    if (/impossibile|gia.? annullat/i.test(err.message)) {
      if (env.FISCO_KV) {
        const lista = await leggiAnnullate(env);
        if (!lista.includes(String(idtrx))) {
          lista.push(String(idtrx));
          await env.FISCO_KV.put(CHIAVE_ANNULLATE, JSON.stringify(lista));
        }
      }
      return { esito: true, gia_annullato: true };
    }
    throw err;
  }
  // tengo traccia: con piu' ricevute di pari importo non sarebbe
  // possibile capire quale e' stata annullata
  if (env.FISCO_KV) {
    const lista = await leggiAnnullate(env);
    if (!lista.includes(String(idtrx))) {
      lista.push(String(idtrx));
      await env.FISCO_KV.put(CHIAVE_ANNULLATE, JSON.stringify(lista));
    }
  }
  return res;
}

/* ---------------------------------------------------------------- */
/* Elenco operativo: prenotazioni + stato + ricevuta                 */
/* ---------------------------------------------------------------- */
async function elenco(env, dal, al, margine) {
  const ricDal = dal;
  const ricAl = addGiorni(al, margine);

  const [prenotazioni, ricevute] = await Promise.all([
    fetchPrenotazioni(env, dal, al),
    fetchRicevute(env, ricDal, ricAl),
  ]);

  const stati = await leggiStati(env, prenotazioni.map((p) => p.id));

  // match euristico solo per le prenotazioni senza stato registrato
  const senzaStato = prenotazioni.filter((p) => !stati[p.id]);

  // le ricevute gia' collegate a una decisione registrata sono impegnate:
  // se restassero disponibili verrebbero assegnate una seconda volta
  const impegnateDaStati = new Set();
  for (const s of Object.values(stati)) {
    if (!s) continue;
    if (s.idtrx) impegnateDaStati.add(String(s.idtrx));
    for (const e of s.extra || []) impegnateDaStati.add(String(e.idtrx || e.id));
  }
  const esito = riconcilia(
    senzaStato,
    ricevute.documenti.filter((r) => !impegnateDaStati.has(String(r.id)))
  );
  const perId = new Map(esito.abbinamenti.map((a) => [a.prenotazione.id, a]));

  const righe = prenotazioni.map((p) => {
    p = { ...p, descrizioneDefault: descrizioneStandard(p) };
    const st = stati[p.id];
    if (st) {
      return {
        ...p,
        stato: st.stato,
        origine: 'registrato',
        ricevuta:
          st.idtrx
            ? { id: st.idtrx, numero: st.numero, data: st.data, importo: st.importo }
            : null,
        nota: st.nota || '',
      };
    }
    const m = perId.get(p.id);
    if (m) {
      return {
        ...p,
        stato: 'emessa',
        origine: `match:${m.metodo}`,
        ricevuta: {
          id: m.ricevuta.id,
          numero: m.ricevuta.numero,
          data: m.ricevuta.data,
          importo: m.ricevuta.importo,
        },
        ricevuteExtra: m.extra || [],
        nota: '',
      };
    }
    const oggiIso = giorno(new Date());
    if (p.checkin > oggiIso) {
      return { ...p, stato: 'futura', origine: null, ricevuta: null, nota: '' };
    }
    return { ...p, stato: 'da_emettere', origine: null, ricevuta: null, nota: '' };
  });

  righe.sort((a, b) =>
    a.checkout !== b.checkout
      ? (a.checkout < b.checkout ? 1 : -1)
      : (a.checkin < b.checkin ? 1 : -1)
  );

  const impegnateKV = new Set();
  for (const s of Object.values(stati)) {
    if (s && s.idtrx) impegnateKV.add(String(s.idtrx));
    for (const e of (s && s.extra) || []) impegnateKV.add(String(e.idtrx || e.id));
  }

  // una ricevuta emessa in anticipo appartiene a un soggiorno che si conclude
  // dopo la fine del periodo: la confronto anche con quelli, altrimenti
  // risulterebbe senza prenotazione solo per effetto del filtro
  let orfaneReali = esito.ricevuteOrfane.filter((r) => !impegnateKV.has(String(r.id)));
  if (orfaneReali.length) {
    try {
      const dopo = await fetchPrenotazioni(env, addGiorni(al, 1), addGiorni(al, margine));
      const statiDopo = await leggiStati(env, dopo.map((p) => p.id));
      const libereDopo = dopo.filter((p) => !statiDopo[p.id]);
      for (const s of Object.values(statiDopo)) {
        if (s && s.idtrx) impegnateKV.add(String(s.idtrx));
      }
      const esitoDopo = riconcilia(libereDopo, ricevute.documenti);
      for (const a of esitoDopo.abbinamenti) {
        impegnateKV.add(String(a.ricevuta.id));
        for (const e of a.extra || []) impegnateKV.add(String(e.id));
      }
      orfaneReali = orfaneReali.filter((r) => !impegnateKV.has(String(r.id)));
    } catch {
      /* se il controllo aggiuntivo fallisce resta il conteggio precedente */
    }
  }

  const conta = (s) => righe.filter((r) => r.stato === s).length;
  return {
    periodo: { prenotazioni: { dal, al }, ricevute: { dal: ricDal, al: ricAl } },
    riepilogo: {
      totali: righe.length,
      daEmettere: conta('da_emettere'),
      emesse: conta('emessa'),
      fattura: conta('fattura'),
      escluse: conta('esclusa'),
      future: conta('futura'),
      ricevuteOrfane: orfaneReali.length,
    },
    righe,
    orfane: orfaneReali,
  };
}

/* ---------------------------------------------------------------- */
/* Condivisione ricevuta (PDF ufficiale AdE)                         */
/* ---------------------------------------------------------------- */
async function scaricaPdf(env, idtrx, regalo = false) {
  const res = await fetch(`${DC_BASE}/downloadDocument/${idtrx}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Datacash-Key': env.DATACASH_KEY,
    },
    body: JSON.stringify({ ade_credentials_encrypted: credenziali(env), regalo }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`download PDF HTTP ${res.status}: ${t.slice(0, 150)}`);
  }
  return res.arrayBuffer();
}

function tokenCasuale() {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(36).padStart(2, '0')).join('').slice(0, 18);
}

// link pubblico valido 180 giorni
async function creaLink(env, idtrx, nome) {
  if (!env.FISCO_KV) throw new Error('KV non configurato');
  const token = tokenCasuale();
  await env.FISCO_KV.put(
    `fisco:pub:${token}`,
    JSON.stringify({ idtrx, nome: nome || '', creato: new Date().toISOString() }),
    { expirationTtl: 60 * 60 * 24 * 180 }
  );
  return token;
}

// Lingua dedotta dal prefisso telefonico: il campo language di Amenitiz
// non e' affidabile (stessa logica usata in arrivi.html)
function linguaDa(telefono, dichiarata) {
  const t = String(telefono || '').replace(/[^0-9+]/g, '');
  const p = [
    ['IT', ['+39']],
    ['ES', ['+34', '+52', '+54', '+56', '+57', '+58', '+51', '+591', '+593', '+595', '+598']],
    ['FR', ['+33', '+32', '+352']],
    ['PT', ['+351', '+55']],
    ['DE', ['+49', '+43', '+41']],
    ['ZH', ['+86', '+852', '+853', '+886']],
  ];
  for (const [lang, prefissi] of p) {
    if (prefissi.some((x) => t.startsWith(x))) return lang;
  }
  const d = String(dichiarata || '').toUpperCase();
  if (['IT', 'EN', 'ES', 'FR', 'DE', 'PT', 'ZH'].includes(d)) return d;
  return 'EN';
}

const MESSAGGI = {
  IT: {
    oggetto: 'La sua ricevuta - InternoUno',
    corpo: (n, d1, d2, l) =>
      `Gentile ${n},\n\ndi seguito la ricevuta del suo soggiorno dal ${d1} al ${d2}:\n${l}\n\nGrazie per aver scelto InternoUno.`,
  },
  EN: {
    oggetto: 'Your receipt - InternoUno',
    corpo: (n, d1, d2, l) =>
      `Dear ${n},\n\nhere is the receipt for your stay from ${d1} to ${d2}:\n${l}\n\nThank you for choosing InternoUno.`,
  },
  ES: {
    oggetto: 'Su recibo - InternoUno',
    corpo: (n, d1, d2, l) =>
      `Estimado/a ${n},\n\na continuación el recibo de su estancia del ${d1} al ${d2}:\n${l}\n\nGracias por elegir InternoUno.`,
  },
  FR: {
    oggetto: 'Votre reçu - InternoUno',
    corpo: (n, d1, d2, l) =>
      `Cher/Chère ${n},\n\nvoici le reçu de votre séjour du ${d1} au ${d2} :\n${l}\n\nMerci d'avoir choisi InternoUno.`,
  },
  DE: {
    oggetto: 'Ihre Quittung - InternoUno',
    corpo: (n, d1, d2, l) =>
      `Sehr geehrte/r ${n},\n\nhier ist die Quittung für Ihren Aufenthalt vom ${d1} bis ${d2}:\n${l}\n\nVielen Dank, dass Sie sich für InternoUno entschieden haben.`,
  },
  PT: {
    oggetto: 'O seu recibo - InternoUno',
    corpo: (n, d1, d2, l) =>
      `Caro/a ${n},\n\nsegue o recibo da sua estadia de ${d1} a ${d2}:\n${l}\n\nObrigado por escolher InternoUno.`,
  },
  ZH: {
    oggetto: '您的收据 - InternoUno',
    corpo: (n, d1, d2, l) =>
      `尊敬的 ${n}：\n\n以下是您 ${d1} 至 ${d2} 住宿的收据：\n${l}\n\n感谢您选择 InternoUno。`,
  },
};

function testoInvio(pren, link, lingua) {
  const lang = linguaDa(pren.telefono, lingua || pren.lingua);
  const m = MESSAGGI[lang] || MESSAGGI.EN;
  return {
    lingua: lang,
    oggetto: m.oggetto,
    testo: m.corpo(pren.nome || '', dataIt(pren.checkin), dataIt(pren.checkout), link),
  };
}

async function inviaEmail(env, destinatario, oggetto, testo) {
  const html = testo
    .split('\n')
    .map((r) => (r ? `<p style="margin:0 0 10px">${r}</p>` : ''))
    .join('');
  const target =
    `${LS_BASE}/?action=send`;
  const req = new Request(target, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'fisco-worker' },
    body: JSON.stringify({ to: destinatario, subject: oggetto, html, account: 'business' }),
  });
  const res = env.LS ? await env.LS.fetch(req) : await fetch(req);
  const t = await res.text();
  if (!res.ok) throw new Error(`invio email HTTP ${res.status}: ${t.slice(0, 150)}`);
  return t.slice(0, 200);
}

/* ---------------------------------------------------------------- */
/* Proposte di abbinamento (match approssimato da validare)          */
/* ---------------------------------------------------------------- */
async function proposte(env, dal, al, opzioni = {}) {
  const margine = opzioni.margine ?? MARGINE_RICEVUTE;
  const maxGiorni = opzioni.giorni ?? 45;     // distanza max dall'arrivo
  const maxScarto = opzioni.scarto ?? 0.25;   // scarto max sull'importo (25%)
  const maxCand = opzioni.candidati ?? 5;

  const ricDal = dal;
  const ricAl = addGiorni(al, margine);

  const [prenotazioni, ricevute] = await Promise.all([
    fetchPrenotazioni(env, dal, al),
    fetchRicevute(env, ricDal, ricAl),
  ]);

  const stati = await leggiStati(env, prenotazioni.map((p) => p.id));

  // ricevute gia' impegnate da una decisione registrata
  const impegnate = new Set();
  for (const s of Object.values(stati)) {
    if (!s) continue;
    if (s.idtrx) impegnate.add(String(s.idtrx));
    for (const e of s.extra || []) impegnate.add(String(e.idtrx || e.id));
  }

  // il match esatto viene applicato prima: resta da proporre solo il resto
  const libere = prenotazioni.filter((p) => !stati[p.id]);

  // le ricevute gia' collegate a una decisione registrata sono impegnate:
  // se restassero disponibili il motore potrebbe assegnarle una seconda volta
  const giaUsate = new Set();
  for (const s of Object.values(stati)) {
    if (!s) continue;
    if (s.idtrx) giaUsate.add(String(s.idtrx));
    for (const e of s.extra || []) giaUsate.add(String(e.idtrx || e.id));
  }
  const disponibiliPerMotore = ricevute.documenti.filter((r) => !giaUsate.has(String(r.id)));

  const esito = riconcilia(libere, disponibiliPerMotore);
  const abbinateOk = new Set(esito.abbinamenti.map((a) => a.prenotazione.id));
  for (const a of esito.abbinamenti) {
    impegnate.add(String(a.ricevuta.id));
    for (const e of a.extra || []) impegnate.add(String(e.id));
  }

  const scoperte = libere.filter((p) => !abbinateOk.has(p.id));
  const orfane = ricevute.documenti.filter(
    (r) => r.tipo === 'V' && !r.annullata && !impegnate.has(String(r.id))
  );

  // la ricevuta non precede mai l'arrivo: zero durante il soggiorno,
  // altrimenti giorni trascorsi dalla partenza
  const distanzaSoggiorno = (giornoRic, p) => {
    if (giornoRic < addGiorni(p.checkin, -anticipoConsentito(p.canale))) return 999;
    if (giornoRic <= p.checkout) return 0;
    return Math.round((new Date(giornoRic) - new Date(p.checkout)) / 86400000);
  };

  const lista = [];
  for (const p of scoperte) {
    const cand = [];
    for (const r of orfane) {
      const dGiorni = distanzaSoggiorno(r.giorno, p);
      if (Math.abs(dGiorni) > maxGiorni) continue; // ricevuta troppo lontana

      // confronto con la variante di tassa piu' vicina
      let base = p.attesoCents;
      let personeTassa = null;
      for (const v of p.variantiCents || []) {
        if (Math.abs(r.centesimi - v.cents) < Math.abs(r.centesimi - base)) {
          base = v.cents;
          personeTassa = v.persone;
        }
      }
      const dImporto = (r.centesimi - base) / 100;
      const scarto = Math.abs(r.centesimi - base) / Math.max(base, 1);
      if (scarto > maxScarto) continue;

      // punteggio: 100 = perfetto. Pesa piu' l'importo della data.
      const dArrivo = Math.abs(
        (new Date(r.giorno) - new Date(p.checkin)) / 86400000
      );
      const punti = Math.round(
        100 - scarto * 200 - Math.min(Math.abs(dGiorni), maxGiorni) * 0.8 -
          Math.min(dArrivo, 20) * 0.1
      );

      cand.push({
        idtrx: r.id,
        numero: r.numero,
        data: r.dataRaw,
        giorno: r.giorno,
        importo: r.importo,
        deltaImporto: Math.round(dImporto * 100) / 100,
        deltaGiorni: dGiorni,
        scartoPerc: Math.round(scarto * 1000) / 10,
        punti,
        // se lo scarto coincide con la tassa di soggiorno e' un indizio forte
        base: base / 100,
        personeTassa,
        indizio:
          Math.abs(dImporto) < 0.02 && personeTassa != null && personeTassa !== p.adulti
            ? `tassa per ${personeTassa} person${personeTassa === 1 ? 'a' : 'e'}`
            : Math.abs(dImporto) < 0.02
            ? 'importo esatto'
            : Math.abs(r.centesimi - p.attesoAltCents) < 2
            ? 'tassa inclusa'
            : Math.abs(dImporto) <= 50
            ? 'scarto di pochi centesimi'
            : '',
      });
    }
    if (!cand.length) continue;
    cand.sort((a, b) => b.punti - a.punti);
    lista.push({
      prenotazione: {
        id: p.id,
        nome: p.nome,
        canale: p.canale,
        checkin: p.checkin,
        checkout: p.checkout,
        notti: p.notti,
        camere: p.camere,
        totale: p.totale,
        cityTax: p.cityTax,
        atteso: p.atteso,
      },
      candidati: cand.slice(0, maxCand),
      migliore: cand[0].punti,
    });
  }

  lista.sort((a, b) => b.migliore - a.migliore);

  return {
    parametri: { giorni: maxGiorni, scarto: maxScarto },
    riepilogo: {
      scoperte: scoperte.length,
      conProposta: lista.length,
      senzaProposta: scoperte.length - lista.length,
      orfaneDisponibili: orfane.length,
    },
    proposte: lista,
  };
}

/* ---------------------------------------------------------------- */
/* Vista inversa: dalla ricevuta orfana alle prenotazioni candidate  */
/* ---------------------------------------------------------------- */
async function orfaneConCandidati(env, dal, al, opzioni = {}) {
  const margine = opzioni.margine ?? MARGINE_RICEVUTE;
  const maxGiorni = opzioni.giorni ?? 30;
  const maxScarto = opzioni.scarto ?? 0.3;
  const maxCand = opzioni.candidati ?? 8;

  const ricDal = dal;
  const ricAl = addGiorni(al, margine);

  const [prenotazioni, ricevute] = await Promise.all([
    fetchPrenotazioni(env, dal, al),
    fetchRicevute(env, ricDal, ricAl),
  ]);

  const stati = await leggiStati(env, prenotazioni.map((p) => p.id));
  const impegnate = new Set();
  for (const s of Object.values(stati)) {
    if (!s) continue;
    if (s.idtrx) impegnate.add(String(s.idtrx));
    for (const e of s.extra || []) impegnate.add(String(e.idtrx || e.id));
  }

  const libere = prenotazioni.filter((p) => !stati[p.id]);

  // le ricevute gia' collegate a una decisione registrata sono impegnate:
  // se restassero disponibili il motore potrebbe assegnarle una seconda volta
  const giaUsate = new Set();
  for (const s of Object.values(stati)) {
    if (!s) continue;
    if (s.idtrx) giaUsate.add(String(s.idtrx));
    for (const e of s.extra || []) giaUsate.add(String(e.idtrx || e.id));
  }
  const disponibiliPerMotore = ricevute.documenti.filter((r) => !giaUsate.has(String(r.id)));

  const esito = riconcilia(libere, disponibiliPerMotore);
  const abbinate = new Set(esito.abbinamenti.map((a) => a.prenotazione.id));
  for (const a of esito.abbinamenti) {
    impegnate.add(String(a.ricevuta.id));
    for (const e of a.extra || []) impegnate.add(String(e.id));
  }

  const scoperte = libere.filter((p) => !abbinate.has(p.id));

  // le ricevute emesse in anticipo appartengono a soggiorni che finiscono
  // dopo il periodo: le confronto anche con quelli
  try {
    const dopo = await fetchPrenotazioni(env, addGiorni(al, 1), addGiorni(al, margine));
    const statiDopo = await leggiStati(env, dopo.map((p) => p.id));
    for (const s of Object.values(statiDopo)) if (s && s.idtrx) impegnate.add(String(s.idtrx));
    const esitoDopo = riconcilia(
      dopo.filter((p) => !statiDopo[p.id]),
      ricevute.documenti
    );
    for (const a of esitoDopo.abbinamenti) {
      impegnate.add(String(a.ricevuta.id));
      for (const e of a.extra || []) impegnate.add(String(e.id));
    }
  } catch {
    /* controllo aggiuntivo non riuscito: proseguo con i dati del periodo */
  }

  const orfane = ricevute.documenti.filter(
    (r) => r.tipo === 'V' && !r.annullata && !impegnate.has(String(r.id))
  );

  const distanza = (giornoRic, p) => {
    if (giornoRic < addGiorni(p.checkin, -anticipoConsentito(p.canale))) return 999;
    if (giornoRic <= p.checkout) return 0;
    return Math.round((new Date(giornoRic) - new Date(p.checkout)) / 86400000);
  };

  const lista = orfane.map((r) => {
    const cand = [];
    for (const p of scoperte) {
      const d = distanza(r.giorno, p);
      if (Math.abs(d) > maxGiorni) continue;

      // cerco la variante di tassa che meglio spiega l'importo
      let base = p.attesoCents;
      let personeTassa = null;
      for (const v of p.variantiCents || []) {
        if (Math.abs(r.centesimi - v.cents) < Math.abs(r.centesimi - base)) {
          base = v.cents;
          personeTassa = v.persone;
        }
      }
      const dImporto = (r.centesimi - base) / 100;
      const scarto = Math.abs(r.centesimi - base) / Math.max(base, 1);
      if (scarto > maxScarto) continue;

      const dArrivo = Math.abs(
        (new Date(r.giorno) - new Date(p.checkin)) / 86400000
      );
      const punti = Math.round(
        100 - scarto * 200 - Math.min(Math.abs(d), maxGiorni) * 0.9 -
          Math.min(dArrivo, 20) * 0.1
      );

      cand.push({
        id: p.id,
        nome: p.nome,
        canale: p.canale,
        checkin: p.checkin,
        checkout: p.checkout,
        notti: p.notti,
        adulti: p.adulti,
        bambini: p.bambini,
        camere: p.camere,
        totale: p.totale,
        atteso: p.atteso,
        base: base / 100,
        personeTassa,
        deltaImporto: Math.round(dImporto * 100) / 100,
        deltaGiorni: d,
        scartoPerc: Math.round(scarto * 1000) / 10,
        punti,
        indizio:
          Math.abs(dImporto) < 0.02 && personeTassa != null && personeTassa !== p.adulti
            ? `tassa per ${personeTassa} person${personeTassa === 1 ? 'a' : 'e'}`
            : Math.abs(dImporto) < 0.02
            ? 'importo esatto'
            : Math.abs(dImporto) <= 0.5
            ? 'scarto di centesimi'
            : '',
      });
    }
    cand.sort((a, b) => b.punti - a.punti);
    return {
      ricevuta: {
        idtrx: r.id,
        numero: r.numero,
        data: r.dataRaw,
        giorno: r.giorno,
        importo: r.importo,
      },
      candidati: cand.slice(0, maxCand),
      migliore: cand.length ? cand[0].punti : 0,
    };
  });

  lista.sort((a, b) => b.migliore - a.migliore);

  return {
    riepilogo: {
      orfane: orfane.length,
      conCandidati: lista.filter((x) => x.candidati.length).length,
      senzaCandidati: lista.filter((x) => !x.candidati.length).length,
      scoperteDisponibili: scoperte.length,
      totaleOrfane:
        Math.round(orfane.reduce((s, r) => s + r.centesimi, 0)) / 100,
    },
    orfane: lista,
    // elenco completo, per la ricerca manuale quando gli importi non tornano
    scoperte: scoperte.map((p) => ({
      id: p.id,
      nome: p.nome,
      canale: p.canale,
      checkin: p.checkin,
      checkout: p.checkout,
      notti: p.notti,
      camere: p.camere,
      totale: p.totale,
      atteso: p.atteso,
    })),
  };
}

/* ---------------------------------------------------------------- */
/* Ricevute duplicate (stesso importo a breve distanza)              */
/* ---------------------------------------------------------------- */
function oraDi(dataRaw) {
  const m = String(dataRaw).match(
    /(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2}):(\d{2})/
  );
  if (!m) return null;
  return new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}Z`).getTime();
}

async function duplicati(env, dal, al, opzioni = {}) {
  const margine = opzioni.margine ?? MARGINE_RICEVUTE;
  const ricevute = await fetchRicevute(env, dal, addGiorni(al, margine));
  const valide = ricevute.documenti.filter((r) => r.tipo === 'V' && !r.annullata);

  // per sapere quali sono gia' abbinate
  const prenotazioni = await fetchPrenotazioni(env, dal, al);
  const stati = await leggiStati(env, prenotazioni.map((p) => p.id));
  const usate = new Map();
  for (const [id, s] of Object.entries(stati)) {
    if (!s) continue;
    if (s.idtrx) usate.set(String(s.idtrx), id);
    for (const e of s.extra || []) usate.set(String(e.idtrx || e.id), id);
  }
  const libere = prenotazioni.filter((p) => !stati[p.id]);

  // le ricevute gia' collegate a una decisione registrata sono impegnate:
  // se restassero disponibili il motore potrebbe assegnarle una seconda volta
  const giaUsate = new Set();
  for (const s of Object.values(stati)) {
    if (!s) continue;
    if (s.idtrx) giaUsate.add(String(s.idtrx));
    for (const e of s.extra || []) giaUsate.add(String(e.idtrx || e.id));
  }
  const disponibiliPerMotore = ricevute.documenti.filter((r) => !giaUsate.has(String(r.id)));

  const esito = riconcilia(libere, disponibiliPerMotore);
  for (const a of esito.abbinamenti) {
    usate.set(String(a.ricevuta.id), a.prenotazione.id);
    for (const e of a.extra || []) usate.set(String(e.id), a.prenotazione.id);
  }

  const nomi = new Map(prenotazioni.map((p) => [p.id, p]));

  const perImporto = new Map();
  for (const r of valide) {
    if (!perImporto.has(r.centesimi)) perImporto.set(r.centesimi, []);
    perImporto.get(r.centesimi).push(r);
  }

  const gruppi = [];
  for (const [cents, lista] of perImporto) {
    if (lista.length < 2) continue;
    const ord = [...lista].sort((a, b) => (oraDi(a.dataRaw) || 0) - (oraDi(b.dataRaw) || 0));

    // spezzo in blocchi di documenti ravvicinati (max 36 ore fra uno e l'altro)
    let blocco = [ord[0]];
    const chiudi = () => {
      if (blocco.length < 2) return;
      const t0 = oraDi(blocco[0].dataRaw);
      const t1 = oraDi(blocco[blocco.length - 1].dataRaw);
      const secondi = (t1 - t0) / 1000;
      const livello = secondi <= 300 ? 'certo' : secondi <= 90000 ? 'probabile' : 'dubbio';
      const abbinateN = blocco.filter((r) => usate.has(String(r.id))).length;
      gruppi.push({
        importo: cents / 100,
        conteggio: blocco.length,
        abbinate: abbinateN,
        // se ogni documento ha la sua prenotazione non e' un duplicato:
        // tipicamente sono emissioni separate per camera
        legittimo: abbinateN === blocco.length,
        eccedenza: Math.round(((blocco.length - 1) * cents) / 100 * 100) / 100,
        distanzaSecondi: Math.round(secondi),
        livello,
        ricevute: blocco.map((r) => {
          const idPren = usate.get(String(r.id));
          const p = idPren ? nomi.get(idPren) : null;
          return {
            idtrx: r.id,
            numero: r.numero,
            data: r.dataRaw,
            importo: r.importo,
            abbinata: !!idPren,
            prenotazione: p
              ? { id: p.id, nome: p.nome, checkin: p.checkin, checkout: p.checkout }
              : null,
          };
        }),
      });
      blocco = [];
    };
    for (let i = 1; i < ord.length; i++) {
      const gap = (oraDi(ord[i].dataRaw) - oraDi(ord[i - 1].dataRaw)) / 1000;
      if (gap <= 129600) blocco.push(ord[i]);
      else {
        chiudi();
        blocco = [ord[i]];
      }
    }
    chiudi();
  }

  gruppi.sort((a, b) => b.eccedenza - a.eccedenza);

  const sospetti = gruppi.filter((g) => !g.legittimo);
  const perLivello = (l) => sospetti.filter((g) => g.livello === l);
  return {
    riepilogo: {
      gruppi: sospetti.length,
      certi: perLivello('certo').length,
      probabili: perLivello('probabile').length,
      dubbi: perLivello('dubbio').length,
      legittimi: gruppi.length - sospetti.length,
      eccedenzaTotale:
        Math.round(sospetti.reduce((s, g) => s + g.eccedenza, 0) * 100) / 100,
      eccedenzaCerti:
        Math.round(perLivello('certo').reduce((s, g) => s + g.eccedenza, 0) * 100) / 100,
    },
    gruppi: sospetti,
    legittimi: gruppi.filter((g) => g.legittimo),
  };
}

/* ---------------------------------------------------------------- */
/* Emissione automatica giornaliera                                   */
/* ---------------------------------------------------------------- */

// Clienti ricorrenti con trattamento fisso, riconosciuti dall'indirizzo
// email o dal nome quando l'email manca.
const REGOLE_CLIENTI = [
  { email: 'associativo@fic.it', stato: 'fattura', nota: 'Federazione Italiana Cuochi: segue fattura' },
  { email: 'mzuccarelli@cafitalia.net', stato: 'fattura', nota: 'CAF Italia: segue fattura' },
  { email: 'cladio@gimail.com', stato: 'esclusa', nota: 'Ballatore: nessuna ricevuta' },
  { nome: 'felici', stato: 'esclusa', nota: 'Felici: nessuna ricevuta' },
];

function regolaCliente(p) {
  const em = String(p.email || '').toLowerCase().trim();
  const nm = String(p.nome || '').toLowerCase();
  for (const r of REGOLE_CLIENTI) {
    if (r.email && em === r.email) return r;
    if (r.nome && nm.includes(r.nome)) return r;
  }
  return null;
}

// Canali dove il pagamento è garantito dal portale
const CANALI_GARANTITI = ['booking.com', 'airbnb', 'expedia', 'expedia affiliate network', 'hotels.com'];

// Somma i pagamenti registrati per una prenotazione leggendo le notifiche
// di Amenitiz nella casella di posta (acconti e saldi possono essere piu' d'uno)
async function pagamentiRegistrati(env, bookingId) {
  if (!env.LS) return null;
  const q = `subject:"Nuovo pagamento AmenitizPay" "${bookingId}"`;
  const target = `${LS_BASE}/?action=gmailCerca&q=${encodeURIComponent(q)}&max=20`;
  try {
    const res = await env.LS.fetch(new Request(target, { headers: { 'User-Agent': 'fisco-worker' } }));
    if (!res.ok) return null;
    const d = await res.json();
    if (!d.ok) return null;

    let totale = 0;
    const voci = [];
    for (const m of d.messaggi || []) {
      // la notifica riguarda questa prenotazione?
      const rif = m.testo.match(/ID pagamento:\s*(\d+)/);
      if (!rif || rif[1] !== String(bookingId)) continue;
      const imp = m.testo.match(/Importo pagamento:\s*([\d.,]+)/);
      if (!imp) continue;
      const val = parseFloat(imp[1].replace(/\./g, '').replace(',', '.'));
      if (!isFinite(val)) continue;
      totale += val;
      voci.push({ importo: val, data: m.data });
    }
    return { totale: Math.round(totale * 100) / 100, voci };
  } catch {
    return null;
  }
}

// Verifica che non esista gia' un documento per quella prenotazione:
// controlla sia le decisioni registrate sia le ricevute del cassetto fiscale
function haGiaDocumento(riga) {
  return riga.stato !== 'da_emettere' && riga.stato !== 'futura';
}

const TG_BASE = 'https://tg-worker.f-castiglioni.workers.dev';

// avviso su Telegram per le ricevute che restano da fare a mano
async function avvisaTelegram(env, testo) {
  if (!env.TELEGRAM_BOT_TOKEN) return false;
  try {
    const req = new Request(`${TG_BASE}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Auth': env.TELEGRAM_BOT_TOKEN },
      body: JSON.stringify({
        text: testo,
        parse_mode: 'Markdown',
        buttons: [{ label: 'Apri Cassa', url: 'https://fly98.github.io/Analisi/fisco.html' }],
      }),
    });
    const res = env.TG ? await env.TG.fetch(req) : await fetch(req);
    const d = await res.json();
    return !!d.sent;
  } catch {
    return false;
  }
}

async function emissioneAutomatica(env, giornoRif, soloProva = false) {
  const oggi = giornoRif || giorno(new Date());
  // guardo i checkout degli ultimi giorni, per recuperare eventuali salti
  const dal = addGiorni(oggi, -3);
  const dati = await elenco(env, addGiorni(dal, -20), oggi, MARGINE_RICEVUTE);

  const daTrattare = dati.righe.filter(
    (p) => p.checkout >= dal && p.checkout <= oggi && !haGiaDocumento(p)
  );

  const esito = { data: oggi, esaminate: daTrattare.length, emesse: [], segnate: [], sospese: [], errori: [] };

  for (const p of daTrattare) {
    try {
      // 1. clienti con trattamento fisso
      const reg = regolaCliente(p);
      if (reg) {
        if (!soloProva) await scriviStato(env, p.id, { stato: reg.stato, nota: reg.nota + ' (automatico)' });
        esito.segnate.push({ id: p.id, nome: p.nome, stato: reg.stato, motivo: reg.nota });
        continue;
      }

      const canale = String(p.canale || '').toLowerCase();
      let procedi = false;
      let motivo = '';

      // 2. portali: pagamento garantito
      if (CANALI_GARANTITI.includes(canale)) {
        procedi = true;
        motivo = 'canale con pagamento garantito';
      } else {
        // 3. dirette: emetto solo se risulta saldata
        const pag = await pagamentiRegistrati(env, p.id);
        if (pag && pag.totale > 0) {
          const scarto = Math.abs(pag.totale - p.totale);
          if (scarto <= 0.5) {
            procedi = true;
            motivo = `saldata (${pag.voci.length} pagament${pag.voci.length === 1 ? 'o' : 'i'} per ${pag.totale.toFixed(2)} €)`;
          } else {
            esito.sospese.push({
              id: p.id, nome: p.nome, canale: p.canale,
              motivo: `pagamento parziale: ${pag.totale.toFixed(2)} su ${p.totale.toFixed(2)} €`,
            });
            continue;
          }
        } else {
          esito.sospese.push({
            id: p.id, nome: p.nome, canale: p.canale,
            motivo: 'nessun pagamento registrato nelle notifiche',
          });
          continue;
        }
      }

      if (!procedi) continue;

      if (soloProva) {
        esito.emesse.push({ id: p.id, nome: p.nome, importo: p.atteso, motivo, prova: true });
        continue;
      }

      const res = await emettiDocumento(env, p, { pagamento: 'PE' });
      await scriviStato(env, p.id, {
        stato: 'emessa',
        idtrx: res.idtrx,
        numero: res.progressivo,
        data: oggi,
        importo: res.totale,
        nota: `emessa automaticamente: ${motivo}`,
      });

      // invio al cliente se ho un recapito
      let inviata = false;
      if (p.email) {
        try {
          const token = await creaLink(env, res.idtrx, p.nome);
          const link = `https://fisco-worker.f-castiglioni.workers.dev/r/${token}`;
          const msg = testoInvio(p, link, p.lingua);
          await inviaEmail(env, p.email, msg.oggetto, msg.testo);
          inviata = true;
        } catch {
          /* la ricevuta resta emessa anche se l'invio fallisce */
        }
      }

      esito.emesse.push({
        id: p.id, nome: p.nome, numero: res.progressivo,
        importo: res.totale, motivo, emailInviata: inviata,
      });
    } catch (err) {
      esito.errori.push({ id: p.id, nome: p.nome, errore: err.message });
    }
  }

  // riepilogo giornaliero a me stesso
  if (!soloProva && (esito.emesse.length || esito.sospese.length || esito.errori.length)) {
    const righe = [];
    righe.push(`Emissione automatica del ${dataIt(oggi)}`);
    righe.push('');
    if (esito.emesse.length) {
      righe.push(`RICEVUTE EMESSE: ${esito.emesse.length}`);
      for (const e of esito.emesse) {
        righe.push(`· ${e.numero} — ${e.nome || 'senza nome'} — ${e.importo.toFixed(2)} €${e.emailInviata ? ' (inviata al cliente)' : ''}`);
      }
      righe.push('');
    }
    if (esito.segnate.length) {
      righe.push(`CHIUSE SENZA RICEVUTA: ${esito.segnate.length}`);
      for (const s of esito.segnate) righe.push(`· ${s.nome || 'senza nome'} — ${s.motivo}`);
      righe.push('');
    }
    if (esito.sospese.length) {
      righe.push(`IN ATTESA, DA VALUTARE: ${esito.sospese.length}`);
      for (const s of esito.sospese) righe.push(`· ${s.nome || 'senza nome'} (${s.canale}) — ${s.motivo}`);
      righe.push('');
    }
    if (esito.errori.length) {
      righe.push(`ERRORI: ${esito.errori.length}`);
      for (const e of esito.errori) righe.push(`· ${e.nome || e.id} — ${e.errore}`);
    }
    try {
      await inviaEmail(env, 'info@interno1.it', `Cassa · ${esito.emesse.length} ricevute emesse`, righe.join('\n'));
    } catch {
      /* il riepilogo è secondario rispetto all'emissione */
    }

    // gli errori li segnalo subito, il resto confluisce nel promemoria delle 13
    if (esito.errori.length) {
      const m = [`🧾 *Cassa · ${dataIt(oggi)}*`, ''];
      m.push(`❌ *${esito.errori.length} emissioni non riuscite:*`);
      for (const e of esito.errori.slice(0, 5)) m.push(`· ${e.nome || e.id} — ${e.errore}`);
      await avvisaTelegram(env, m.join('\n'));
    }
  }

  return esito;
}

/* ---------------------------------------------------------------- */
/* Fatture elettroniche                                              */
/* ---------------------------------------------------------------- */
const FE_BASE = 'https://dwadmin.telnetdata.it/api/invoiceApi';
const FE_SERIE = 'FE';          // serie separata da quella di Aruba (FPR)
const FE_REGIME = 'RF11';       // agenzie viaggi e turismo, art. 74-ter

async function datacashFE(env, path, payload) {
  const res = await fetch(FE_BASE + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Datacash-Key': env.DATACASH_KEY,
      Accept: 'application/json',
    },
    body: JSON.stringify({ ade_credentials_encrypted: credenziali(env), ...payload }),
  });
  const testo = await res.text();
  let dati = null;
  try {
    dati = JSON.parse(testo);
  } catch {
    /* alcune risposte non sono JSON */
  }
  if (!dati) throw new Error(`Fatture ${path} HTTP ${res.status}: ${testo.slice(0, 200)}`);
  if (dati.errore) {
    throw new Error(`${dati.errore.codice || ''} ${dati.errore.descrizione || ''}`.trim());
  }
  return dati;
}

// numerazione della serie FE, indipendente da quella usata su Aruba
async function prossimoNumeroFE(env, anno) {
  const chiave = `fisco:numeroFE:${anno}`;
  const attuale = parseInt((await env.FISCO_KV.get(chiave)) || '0', 10);
  return { chiave, numero: attuale + 1 };
}

async function confermaNumeroFE(env, chiave, numero) {
  await env.FISCO_KV.put(chiave, String(numero));
}

async function emettiFattura(env, dati) {
  const cliente = dati.cliente || {};
  if (!cliente.denominazione && !(cliente.nome && cliente.cognome)) {
    throw new Error('dati del cliente incompleti');
  }
  if (!cliente.codiceDestinatario && !cliente.pec) {
    throw new Error('serve il codice destinatario oppure la PEC');
  }

  const righe = (dati.righe || []).filter((r) => Number(r.prezzo) > 0);
  if (!righe.length) throw new Error('nessuna riga da fatturare');

  const anno = String(new Date().getFullYear()).slice(2);
  const { chiave, numero } = await prossimoNumeroFE(env, anno);
  const numeroDoc = dati.numero || `${FE_SERIE} ${numero}/${anno}`;

  // Nel tracciato della fattura il prezzo unitario e' l'IMPONIBILE:
  // gli importi inseriti sono comprensivi di IVA, quindi la scorporo.
  const elementiContabili = righe.map((r) => {
    const al = String(r.aliquota || '10');
    const esente = /^N/.test(al);
    const perc = esente ? 0 : parseInt(al, 10);
    const lordo = Number(r.prezzo);
    const imponibile = esente ? lordo : Math.round((lordo / (1 + perc / 100)) * 100) / 100;
    return {
      aliquotaIVA: al,
      percentualeIva: perc,
      descrizione: String(r.descrizione || 'Soggiorno').slice(0, 200),
      prezzoUnitario: imponibile,
      quantita: Number(r.quantita || 1),
    };
  });

  // il totale che il cliente paga resta quello inserito
  const totale =
    Math.round(righe.reduce((s, r) => s + Number(r.prezzo) * Number(r.quantita || 1), 0) * 100) / 100;

  const corpo = {
    test: !!dati.prova,
    customer: {
      denominazione: cliente.denominazione || '',
      ...(cliente.nome ? { nome: cliente.nome } : {}),
      ...(cliente.cognome ? { cognome: cliente.cognome } : {}),
      codiceFiscale: cliente.cf || cliente.piva || '',
      // i due recapiti si escludono: un campo vuoto fa scartare il file
      ...(cliente.codiceDestinatario
        ? { codiceDestinatario: cliente.codiceDestinatario }
        : { pec: cliente.pec }),
      indirizzoCompleto: {
        indirizzo: cliente.indirizzo || '',
        cap: cliente.cap || '',
        comune: cliente.comune || '',
        provincia: cliente.provincia || '',
        nazione: cliente.nazione || 'IT',
      },
    },
    fiscalRegime: FE_REGIME,
    elementsInvoice: [
      {
        datiGenerali: {
          valuta: 'EUR',
          numero: numeroDoc,
          tipoDocumento: dati.tipoDocumento || 'TD01',
          causale: dati.causale ? [String(dati.causale).slice(0, 200)] : [],
        },
        elementiContabili,
        datiPagamento: [
          {
            condizioniPagamento: 'TP02',
            dettaglioPagamento: [
              {
                importoPagamento: totale,
                modalitaPagamento: dati.modalitaPagamento || 'MP08',
                ...(dati.iban ? { iban: dati.iban } : {}),
              },
            ],
          },
        ],
      },
    ],
  };

  const res = await datacashFE(env, '/sendInvoice/', corpo);

  // il numero si consuma solo se la fattura è stata davvero trasmessa
  if (!dati.prova && !dati.numero) await confermaNumeroFE(env, chiave, numero);

  // conservo i dati per la copia di cortesia da inviare al cliente:
  // rileggerli dall'XML firmato non e' affidabile
  if (!dati.prova && env.FISCO_KV) {
    const copia = {
      numero: numeroDoc,
      data: giorno(new Date()),
      tipoDocumento: dati.tipoDocumento || 'TD01',
      cliente,
      righe: righe.map((r) => ({
        descrizione: r.descrizione,
        quantita: Number(r.quantita || 1),
        prezzo: Number(r.prezzo),
        aliquota: String(r.aliquota || '10'),
      })),
      riepilogo: elementiContabili.map((e) => ({
        aliquota: e.aliquotaIVA,
        imponibile: Math.round(e.prezzoUnitario * e.quantita * 100) / 100,
        imposta: Math.round(e.prezzoUnitario * e.quantita * (e.percentualeIva / 100) * 100) / 100,
      })),
      totale,
      modalitaPagamento: dati.modalitaPagamento || 'MP08',
      iban: dati.iban || '',
    };
    await env.FISCO_KV.put(`fisco:fatt:${numeroDoc}`, JSON.stringify(copia));
  }

  // memorizzo il cliente per le volte successive
  if (cliente.piva && env.FISCO_KV) {
    const ana = (await env.FISCO_KV.get('fisco:clienti', 'json')) || {};
    ana[cliente.piva] = { ...(ana[cliente.piva] || {}), ...cliente };
    await env.FISCO_KV.put('fisco:clienti', JSON.stringify(ana));
  }

  return { ...res, numero: numeroDoc, totale, prova: !!dati.prova };
}

/* ---------------------------------------------------------------- */
/* Copia leggibile della fattura                                     */
/* ---------------------------------------------------------------- */

// nell'XML firmato il contenuto è racchiuso nella busta PKCS#7:
// estraggo la parte testuale e la leggo con espressioni regolari
function testoXml(buf) {
  const t = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  const i = t.indexOf('<?xml');
  if (i < 0) return t;
  // la busta firmata contiene byte binari dopo il documento:
  // taglio esattamente alla chiusura della fattura
  const chiusure = ['</FatturaElettronica>', '</ns2:FatturaElettronica>', '</p:FatturaElettronica>'];
  let x = t.slice(i);
  for (const c of chiusure) {
    const j = t.indexOf(c, i);
    if (j > 0) { x = t.slice(i, j + c.length); break; }
  }
  // la busta spezza il contenuto in segmenti e vi intercala byte di controllo,
  // che finiscono anche dentro i tag: li tolgo prima di leggere
  return x.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]/g, '');
}

const tagUno = (x, tag) => {
  const m = x.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`));
  return m ? m[1] : '';
};
const tagTutti = (x, tag) => {
  const out = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, 'g');
  let m;
  while ((m = re.exec(x))) out.push(m[1]);
  return out;
};
const blocchi = (x, tag) => {
  const out = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  let m;
  while ((m = re.exec(x))) out.push(m[1]);
  return out;
};

const eur = (n) =>
  Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const dataIso = (s) => (s && s.length >= 10 ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : s || '');

const NATURE = {
  N1: 'Escluse ex art. 15',
  'N2.1': 'Non soggette artt. 7-7septies',
  'N2.2': 'Non soggette - altri casi',
  'N3.1': 'Non imponibili - esportazioni',
  'N3.2': 'Non imponibili - cessioni intracomunitarie',
  N4: 'Esenti',
  N5: 'Regime del margine',
};

function fatturaDaDati(f) {
  const MOD = { MP01: 'Contanti', MP05: 'Bonifico', MP08: 'Carta di pagamento' };
  const cl = f.cliente || {};
  const totImponibile = (f.riepilogo || []).reduce((s, r) => s + r.imponibile, 0);
  const totImposta = (f.riepilogo || []).reduce((s, r) => s + r.imposta, 0);

  const perAliquota = {};
  for (const r of f.riepilogo || []) {
    const k = r.aliquota;
    if (!perAliquota[k]) perAliquota[k] = { aliquota: k, imponibile: 0, imposta: 0 };
    perAliquota[k].imponibile += r.imponibile;
    perAliquota[k].imposta += r.imposta;
  }

  return paginaFattura({
    numero: f.numero,
    data: dataIso(f.data),
    tipoDocumento: f.tipoDocumento,
    cliente: cl,
    righe: (f.righe || []).map((r) => ({
      descrizione: r.descrizione,
      quantita: r.quantita,
      prezzo: r.prezzo,
      totale: Math.round(r.prezzo * r.quantita * 100) / 100,
      aliquota: r.aliquota,
    })),
    riepilogo: Object.values(perAliquota),
    totale: f.totale,
    pagamento: MOD[f.modalitaPagamento] || f.modalitaPagamento,
    iban: f.iban,
  });
}

function paginaFattura(f) {
  const cl = f.cliente || {};
  const em = {
    denominazione: "Azienda Castiglioni di C.F. S.a.s.",
    piva: '09336091005',
    indirizzo: 'Via Campaldino 6',
    cap: '00162',
    comune: 'Roma',
    provincia: 'RM',
  };
  const recapito = cl.codiceDestinatario
    ? 'Codice destinatario ' + cl.codiceDestinatario
    : cl.pec
    ? 'PEC ' + cl.pec
    : '';
  const etichetta = (al) => (/^N/.test(String(al)) ? NATURE[al] || al : parseInt(al, 10) + '%');

  return `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fattura ${f.numero}</title>
<style>
  body{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
    color:#12283f;margin:0;padding:24px;background:#f4f6f9}
  .foglio{max-width:760px;margin:0 auto;background:#fff;padding:34px;border-radius:10px;
    box-shadow:0 2px 14px rgba(18,40,63,.08)}
  h1{font-size:19px;margin:0 0 2px;text-align:center;letter-spacing:.6px}
  .sotto{text-align:center;color:#657896;font-size:13px;margin-bottom:26px}
  .parti{display:flex;gap:24px;margin-bottom:22px;flex-wrap:wrap}
  .parte{flex:1;min-width:210px}
  .et{font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;color:#657896;font-weight:700;margin-bottom:5px}
  .parte b{display:block;font-size:14.5px;margin-bottom:3px}
  .parte div{font-size:13px;color:#3d4f66}
  table{width:100%;border-collapse:collapse;margin:16px 0}
  th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:#657896;
    padding:8px 6px;border-bottom:2px solid #dde3ec}
  td{padding:9px 6px;border-bottom:1px solid #eef1f5;font-size:13.5px;vertical-align:top}
  .num{text-align:right;white-space:nowrap}
  .tot{margin-left:auto;width:100%;max-width:330px}
  .tot tr td{border:0;padding:5px 6px}
  .tot .finale td{border-top:2px solid #12283f;font-weight:700;font-size:17px;padding-top:11px}
  .piede{margin-top:26px;padding-top:14px;border-top:1px solid #dde3ec;
    font-size:11.5px;color:#657896;text-align:center;line-height:1.6}
  @media print{body{background:#fff;padding:0}.foglio{box-shadow:none;border-radius:0;max-width:none}}
</style></head><body><div class="foglio">

<h1>${f.tipoDocumento === 'TD04' ? 'NOTA DI CREDITO' : 'FATTURA'}</h1>
<div class="sotto">n. ${f.numero} del ${f.data}</div>

<div class="parti">
  <div class="parte">
    <div class="et">Fornitore</div>
    <b>${em.denominazione}</b>
    <div>P.IVA ${em.piva}</div>
    <div>${em.indirizzo}</div>
    <div>${em.cap} ${em.comune} ${em.provincia}</div>
  </div>
  <div class="parte">
    <div class="et">Cliente</div>
    <b>${cl.denominazione || `${cl.cognome || ''} ${cl.nome || ''}`.trim()}</b>
    <div>P.IVA ${cl.piva || cl.cf || ''}</div>
    <div>${cl.indirizzo || ''}</div>
    <div>${[cl.cap, cl.comune, cl.provincia].filter(Boolean).join(' ')}</div>
    ${recapito ? `<div style="margin-top:4px;font-size:12px">${recapito}</div>` : ''}
  </div>
</div>

<table>
  <tr><th>Descrizione</th><th class="num">Q.tà</th><th class="num">Importo</th><th class="num">Aliquota</th></tr>
  ${(f.righe || [])
    .map(
      (r) => `<tr>
      <td>${r.descrizione}</td>
      <td class="num">${Number(r.quantita).toLocaleString('it-IT')}</td>
      <td class="num">${eur(r.totale)}</td>
      <td class="num">${etichetta(r.aliquota)}</td>
    </tr>`
    )
    .join('')}
</table>

<table class="tot">
  ${(f.riepilogo || [])
    .map(
      (r) => `<tr><td>Imponibile ${etichetta(r.aliquota)}</td><td class="num">${eur(r.imponibile)}</td></tr>
      ${r.imposta > 0 ? `<tr><td>IVA ${parseInt(r.aliquota, 10)}%</td><td class="num">${eur(r.imposta)}</td></tr>` : ''}`
    )
    .join('')}
  <tr class="finale"><td>Totale documento</td><td class="num">${eur(f.totale)}</td></tr>
</table>

${f.pagamento
    ? `<div style="font-size:13px;color:#3d4f66;margin-top:18px">
        <span class="et" style="display:inline">Pagamento</span> ${f.pagamento}
        ${f.iban ? '<br>IBAN ' + f.iban : ''}
       </div>`
    : ''}

<div class="piede">
  Copia di cortesia della fattura elettronica trasmessa al Sistema di Interscambio.<br>
  Il documento originale in formato XML è disponibile nel portale Fatture e Corrispettivi dell'Agenzia delle Entrate.
</div>
</div></body></html>`;
}

async function scaricaFatturaXml(env, idFattura) {
  const res = await fetch(`${FE_BASE}/downloadInvoices/${idFattura}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Datacash-Key': env.DATACASH_KEY,
    },
    body: JSON.stringify({ ade_credentials_encrypted: credenziali(env) }),
  });
  if (!res.ok) throw new Error(`download fattura HTTP ${res.status}`);
  return res.arrayBuffer();
}

/* ---------------------------------------------------------------- */
/* Handler                                                           */
/* ---------------------------------------------------------------- */
// Controllo di metà giornata: se restano partenze senza documento
// manda un promemoria, senza emettere nulla.
async function promemoriaSospese(env, giornoRif) {
  const oggi = giornoRif || giorno(new Date());
  const dal = addGiorni(oggi, -3);
  const dati = await elenco(env, addGiorni(dal, -45), oggi, MARGINE_RICEVUTE);
  const restano = dati.righe.filter(
    (p) => p.checkout >= dal && p.checkout <= oggi && p.stato === 'da_emettere'
  );
  if (!restano.length) return { sospese: 0, avvisato: false };

  const tot = restano.reduce((s, p) => s + p.atteso, 0);
  const m = [];
  m.push(`🧾 *Cassa · ${dataIt(oggi)}*`);
  m.push('');
  m.push(`⚠️ *${restano.length} ricevute da emettere a mano* — ${tot.toFixed(2)} €`);
  m.push('');
  for (const p of restano.slice(0, 15)) {
    const cam = (p.camere || []).join('+');
    m.push(`· ${dataIt(p.checkout)} ${cam} — ${p.nome || 'senza nome'} — ${p.atteso.toFixed(2)} € (${p.canale})`);
  }
  if (restano.length > 15) m.push(`…e altre ${restano.length - 15}`);
  const avvisato = await avvisaTelegram(env, m.join('\n'));
  return { sospese: restano.length, totale: Math.round(tot * 100) / 100, avvisato };
}

export default {
  // 08:00 UTC (10:00) emissione · 11:00 UTC (13:00) promemoria
  async scheduled(event, env, ctx) {
    const ora = new Date(event.scheduledTime).getUTCHours();
    ctx.waitUntil(ora >= 10 ? promemoriaSospese(env) : emissioneAutomatica(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return json({ ok: true });

    if (url.pathname === '/health') {
      return json({
        ok: true,
        worker: 'fisco-worker',
        versione: '2.0',
        fonti: { ricevute: 'DataCash/TelnetData', prenotazioni: 'Amenitiz via little-shadow' },
        secrets: {
          DATACASH_KEY: !!env.DATACASH_KEY,
          ADE_CRED_ENC: !!env.ADE_CRED_ENC,
          API_TOKEN: !!env.API_TOKEN,
          LS_binding: !!env.LS,
          KV: !!env.FISCO_KV,
          TELEGRAM: !!env.TELEGRAM_BOT_TOKEN,
        },
      });
    }

    // copia di cortesia della fattura, indirizzo riservato
    if (url.pathname.startsWith('/f/')) {
      const token = url.pathname.slice(3).replace(/[^a-z0-9]/gi, '');
      if (!token || !env.FISCO_KV) return new Response('Link non valido', { status: 404 });
      const rec = await env.FISCO_KV.get(`fisco:pubf:${token}`, 'json');
      if (!rec) return new Response('Fattura non disponibile o link scaduto', { status: 404 });
      const salvata = await env.FISCO_KV.get(`fisco:fatt:${rec.numero}`, 'json');
      if (!salvata) return new Response('Copia non disponibile per questa fattura', { status: 404 });
      return new Response(fatturaDaDati(salvata), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'private, max-age=3600',
        },
      });
    }

    // link pubblico alla ricevuta: nessun token, l'indirizzo stesso e' il segreto
    if (url.pathname.startsWith('/r/')) {
      const token = url.pathname.slice(3).replace(/[^a-z0-9]/gi, '');
      if (!token || !env.FISCO_KV) return new Response('Link non valido', { status: 404 });
      const rec = await env.FISCO_KV.get(`fisco:pub:${token}`, 'json');
      if (!rec) return new Response('Ricevuta non disponibile o link scaduto', { status: 404 });
      try {
        const pdf = await scaricaPdf(env, rec.idtrx);
        return new Response(pdf, {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="ricevuta-${rec.idtrx}.pdf"`,
            'Cache-Control': 'private, max-age=3600',
          },
        });
      } catch (e) {
        return new Response('Ricevuta non recuperabile: ' + e.message, { status: 502 });
      }
    }

    if (env.API_TOKEN && request.headers.get('X-Token') !== env.API_TOKEN) {
      return json({ error: 'non autorizzato' }, 401);
    }

    const adesso = new Date();
    const oggi = giorno(adesso);
    // esercizio in corso: si parte sempre dal 1 gennaio dell'anno corrente
    const inizioAnno = `${adesso.getUTCFullYear()}-01-01`;
    const dal = url.searchParams.get('dal') || inizioAnno;
    const al = url.searchParams.get('al') || oggi;

    try {
      if (url.pathname === '/debugls') {
        const target = `${LS_BASE}/?action=debugBooking&from=${dal}&to=${al}`;
        const viaBinding = env.LS
          ? await env.LS.fetch(new Request(target, { headers: { 'User-Agent': 'fisco-worker' } }))
          : null;
        const viaPubblico = await fetch(target, { headers: { 'User-Agent': 'fisco-worker' } });
        return json({
          target,
          binding: viaBinding
            ? { status: viaBinding.status, body: (await viaBinding.text()).slice(0, 300) }
            : 'assente',
          pubblico: { status: viaPubblico.status, body: (await viaPubblico.text()).slice(0, 300) },
        });
      }

      if (url.pathname === '/condividi' && request.method === 'POST') {
        const body = await request.json();
        if (!body.idtrx) return json({ ok: false, error: 'idtrx mancante' }, 400);
        const token = await creaLink(env, body.idtrx, body.nome);
        const link = `${url.origin}/r/${token}`;
        return json({ ok: true, link });
      }

      // invio libero, usato per la copia di cortesia della fattura
      if (url.pathname === '/inviaMail' && request.method === 'POST') {
        const body = await request.json();
        if (!body.a || !body.oggetto) return json({ ok: false, error: 'destinatario o oggetto mancanti' }, 400);
        const esito = await inviaEmail(env, body.a, body.oggetto, body.testo || '');
        return json({ ok: true, esito });
      }

      if (url.pathname === '/invia' && request.method === 'POST') {
        const body = await request.json();
        if (!body.idtrx || !body.email)
          return json({ ok: false, error: 'idtrx o email mancanti' }, 400);
        const token = await creaLink(env, body.idtrx, body.nome);
        const link = `${url.origin}/r/${token}`;
        const msg = testoInvio(body, link, body.lingua);
        const esito = await inviaEmail(env, body.email, msg.oggetto, msg.testo);
        return json({ ok: true, link, lingua: msg.lingua, esito });
      }

      if (url.pathname === '/elenco') {
        const margine = parseInt(url.searchParams.get('margine') || '45', 10);
        return json({ ok: true, ...(await elenco(env, dal, al, margine)) });
      }

      if (url.pathname === '/stato' && request.method === 'POST') {
        const body = await request.json();
        if (!body.id) return json({ ok: false, error: 'id mancante' }, 400);
        const rec = await scriviStato(
          env,
          body.id,
          body.stato
            ? {
                stato: body.stato,
                nota: body.nota || '',
                idtrx: body.idtrx || null,
                numero: body.numero || null,
                data: body.data || null,
                importo: body.importo ?? null,
              }
            : null
        );
        return json({ ok: true, id: body.id, stato: rec });
      }

      if (url.pathname === '/emetti' && request.method === 'POST') {
        const body = await request.json();
        if (!body.id) return json({ ok: false, error: 'id prenotazione mancante' }, 400);

        // recupero la prenotazione: se conosco l'arrivo cerco in una
        // finestra stretta, altrimenti ricado sull'intero periodo
        let pren = null;
        if (body.checkin) {
          const da = addGiorni(body.checkin, -2);
          const a = addGiorni(body.checkin, 2);
          pren = (await fetchPrenotazioni(env, da, a)).find((p) => p.id === String(body.id));
        }
        if (!pren) {
          pren = (await fetchPrenotazioni(env, body.dal || dal, body.al || al)).find(
            (p) => p.id === String(body.id)
          );
        }
        if (!pren) return json({ ok: false, error: 'prenotazione non trovata' }, 404);

        const importo = body.importo != null ? Number(body.importo) : pren.atteso;
        const res = await emettiDocumento(env, { ...pren, atteso: importo }, {
          pagamento: body.pagamento || 'PE',
          aliquota: body.aliquota || '10',
          descrizione: body.descrizione,
          includiTassa: !!body.includiTassa,
          cityTax: body.cityTax != null ? Number(body.cityTax) : pren.cityTax,
          naturaTassa: body.naturaTassa || 'N1',
        });

        const rec = await scriviStato(env, pren.id, {
          stato: 'emessa',
          idtrx: res.idtrx,
          numero: res.progressivo,
          data: new Date().toISOString(),
          importo: res.totale,
          tassaInclusa: !!body.includiTassa,
          nota: body.nota || '',
        });
        return json({ ok: true, prenotazione: pren.id, documento: res, stato: rec });
      }

      if (url.pathname === '/emettiLibera' && request.method === 'POST') {
        const body = await request.json();
        const importo = Number(body.importo);
        if (!importo || importo <= 0) return json({ ok: false, error: 'importo mancante' }, 400);

        const finto = {
          nome: body.nome || '',
          checkin: body.checkin || '',
          checkout: body.checkout || '',
          atteso: importo,
          cityTax: Number(body.cityTax || 0),
        };
        const descr =
          (body.descrizione || '').trim() ||
          (body.checkin && body.checkout ? descrizioneStandard(finto) : 'Soggiorno');

        const res = await emettiDocumento(env, finto, {
          pagamento: body.pagamento || 'PE',
          aliquota: body.aliquota || '10',
          descrizione: descr,
          includiTassa: !!body.includiTassa,
          cityTax: Number(body.cityTax || 0),
        });
        return json({ ok: true, documento: res, descrizione: descr });
      }

      if (url.pathname === '/annulla' && request.method === 'POST') {
        const body = await request.json();
        if (!body.idtrx) return json({ ok: false, error: 'idtrx mancante' }, 400);
        const res = await annullaDocumento(env, body.idtrx);
        if (body.id) await scriviStato(env, body.id, null);
        return json({ ok: true, annullato: body.idtrx, risposta: res });
      }

      if (url.pathname === '/duplicati') {
        return json({ ok: true, periodo: { dal, al }, ...(await duplicati(env, dal, al)) });
      }

      if (url.pathname === '/orfane') {
        const opz = {
          margine: parseInt(url.searchParams.get('margine') || '45', 10),
          giorni: parseInt(url.searchParams.get('giorni') || '30', 10),
          scarto: parseFloat(url.searchParams.get('scarto') || '0.3'),
        };
        return json({ ok: true, periodo: { dal, al }, ...(await orfaneConCandidati(env, dal, al, opz)) });
      }

      if (url.pathname === '/proposte') {
        const opz = {
          margine: parseInt(url.searchParams.get('margine') || '45', 10),
          giorni: parseInt(url.searchParams.get('giorni') || '45', 10),
          scarto: parseFloat(url.searchParams.get('scarto') || '0.25'),
        };
        return json({ ok: true, periodo: { dal, al }, ...(await proposte(env, dal, al, opz)) });
      }

      if (url.pathname === '/promemoria') {
        return json({ ok: true, ...(await promemoriaSospese(env, url.searchParams.get('giorno'))) });
      }

      if (url.pathname === '/automatico') {
        const prova = url.searchParams.get('prova') === '1';
        const g = url.searchParams.get('giorno') || null;
        return json({ ok: true, ...(await emissioneAutomatica(env, g, prova)) });
      }

      // mappa dei pagamenti registrati, caricata dal rapporto Amenitiz
      // anagrafica clienti per la fatturazione
      // prenotazioni escluse manualmente dall'analisi per il commercialista
      if (url.pathname === '/fattura' && request.method === 'POST') {
        const body = await request.json();
        const res = await emettiFattura(env, body);
        // se collegata a una prenotazione, la segno come fatturata
        if (body.prenotazione && !body.prova) {
          await scriviStato(env, body.prenotazione, {
            stato: 'fattura',
            numero: res.numero,
            data: giorno(new Date()),
            importo: res.totale,
            nota: `fattura ${res.numero}`,
          });
        }
        return json({ ok: true, ...res });
      }

      // prossimo numero disponibile della serie
      if (url.pathname === '/condividiFattura' && request.method === 'POST') {
        const body = await request.json();
        if (!body.numero) return json({ ok: false, error: 'numero fattura mancante' }, 400);
        const token = tokenCasuale();
        await env.FISCO_KV.put(
          `fisco:pubf:${token}`,
          JSON.stringify({ numero: body.numero }),
          { expirationTtl: 60 * 60 * 24 * 365 }
        );
        return json({ ok: true, link: `${url.origin}/f/${token}` });
      }

      if (url.pathname === '/numeroFattura') {
        const anno = String(new Date().getFullYear()).slice(2);
        const { numero } = await prossimoNumeroFE(env, anno);
        return json({ ok: true, numero: `${FE_SERIE} ${numero}/${anno}`, serie: FE_SERIE });
      }

      if (url.pathname === '/esclusioni') {
        if (request.method === 'POST') {
          const body = await request.json();
          const lista = Array.isArray(body) ? body : body.esclusi || [];
          await env.FISCO_KV.put('fisco:esclusioni', JSON.stringify(lista));
          return json({ ok: true, esclusi: lista.length });
        }
        const lista = (await env.FISCO_KV.get('fisco:esclusioni', 'json')) || [];
        return json({ ok: true, count: lista.length, esclusi: lista });
      }

      if (url.pathname === '/clienti') {
        if (request.method === 'POST') {
          const body = await request.json();
          let ana = (await env.FISCO_KV.get('fisco:clienti', 'json')) || {};
          if (body && body.__sostituisci) {
            // l'elenco inviato diventa l'archivio: serve per le eliminazioni
            const { __sostituisci, ...resto } = body;
            ana = resto;
          } else if (Array.isArray(body)) {
            for (const c of body) if (c && c.piva) ana[c.piva] = c;
          } else if (body && body.piva) {
            ana[body.piva] = body;
          } else if (body && typeof body === 'object') {
            Object.assign(ana, body);
          }
          await env.FISCO_KV.put('fisco:clienti', JSON.stringify(ana));
          return json({ ok: true, clienti: Object.keys(ana).length });
        }
        const ana = (await env.FISCO_KV.get('fisco:clienti', 'json')) || {};
        return json({ ok: true, count: Object.keys(ana).length, clienti: ana });
      }

      // dati anagrafici da partita IVA (servizio VIES della Commissione Europea)
      if (url.pathname === '/cercaPiva') {
        const piva = (url.searchParams.get('piva') || '').replace(/[^0-9]/g, '');
        if (piva.length !== 11) return json({ ok: false, error: 'partita IVA non valida' }, 400);
        try {
          const r = await fetch(
            `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/IT/vat/${piva}`,
            { headers: { Accept: 'application/json' } }
          );
          const d = await r.json();
          if (!d.isValid) return json({ ok: false, error: 'partita IVA non trovata' }, 404);
          // l'indirizzo arriva su piu' righe: "VIA X 1 \n00100 ROMA RM"
          const righe = String(d.address || '').split('\n').map((s) => s.trim()).filter(Boolean);
          const via = righe[0] || '';
          const loc = righe[1] || '';
          const m = loc.match(/^(\d{5})\s+(.*?)\s*([A-Z]{2})?$/);
          return json({
            ok: true,
            piva,
            denominazione: (d.name || '').trim(),
            indirizzo: via,
            cap: m ? m[1] : '',
            comune: m ? m[2].trim() : loc,
            provincia: m && m[3] ? m[3] : '',
            nazione: 'IT',
          });
        } catch (e) {
          return json({ ok: false, error: 'servizio non raggiungibile' }, 502);
        }
      }

      if (url.pathname === '/pagamenti') {
        if (request.method === 'POST') {
          const body = await request.json();
          if (!body || typeof body !== 'object') return json({ ok: false, error: 'dati mancanti' }, 400);
          await env.FISCO_KV.put('fisco:pagamenti', JSON.stringify(body));
          return json({ ok: true, salvati: Object.keys(body).length });
        }
        const m = (await env.FISCO_KV.get('fisco:pagamenti', 'json')) || {};
        return json({ ok: true, count: Object.keys(m).length, pagamenti: m });
      }

      if (url.pathname === '/ricostruisci' && request.method === 'POST') {
        return json({ ok: true, ...(await ricostruisciIndice(env)) });
      }

      if (url.pathname === '/rinnova' && request.method === 'POST') {
        // rinnova la scadenza della password Fisconline mantenendola invariata
        const res = await datacash(env, '/resetPassword/', {});
        return json({ ok: true, ...res });
      }

      if (url.pathname === '/infouser') {
        return json({ ok: true, ...(await datacash(env, '/infoUser/', {})) });
      }

      if (url.pathname === '/dco') {
        return json({ ok: true, periodo: { dal, al }, ...(await fetchRicevute(env, dal, al)) });
      }

      if (url.pathname === '/prenotazioni') {
        const p = await fetchPrenotazioni(env, dal, al);
        return json({ ok: true, periodo: { dal, al }, count: p.length, prenotazioni: p });
      }

      if (url.pathname === '/riconcilia') {
        // margine: giorni di ricerca ricevute oltre il periodo delle prenotazioni,
        // perche' le ricevute vengono emesse anche molto dopo il checkout
        const margine = MARGINE_RICEVUTE;
        const ricDal = dal;
        const ricAl = addGiorni(al, margine);

        const [prenotazioni, ricevute] = await Promise.all([
          fetchPrenotazioni(env, dal, al),
          fetchRicevute(env, ricDal, ricAl),
        ]);

        const esito = riconcilia(prenotazioni, ricevute.documenti);
        return json({
          ok: true,
          periodo: { prenotazioni: { dal, al }, ricevute: { dal: ricDal, al: ricAl } },
          ...esito,
        });
      }
    } catch (err) {
      return json({ ok: false, error: err.message }, 500);
    }

    return json(
      {
        error: 'endpoint sconosciuto',
        disponibili: ['/health', '/infouser', '/dco', '/prenotazioni', '/riconcilia', '/elenco', '/stato', '/emetti', '/annulla', '/condividi', '/invia', '/rinnova', '/proposte', '/orfane', '/duplicati', '/automatico', '/promemoria', '/pagamenti', '/clienti', '/cercaPiva', '/esclusioni', '/fattura', '/numeroFattura', '/condividiFattura', '/f/{token}', '/inviaMail', '/emettiLibera', '/r/{token}'],
      },
      404
    );
  },
};
