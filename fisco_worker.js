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

async function datacash(env, path, payload) {
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
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`DataCash ${path} HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const msg = data?.errore?.descrizione || data.message || JSON.stringify(data);
    throw new Error(`DataCash ${path} HTTP ${res.status}: ${String(msg).slice(0, 200)}`);
  }
  return data;
}

// l'API accetta al massimo 31 giorni per chiamata: spezzo in blocchi
async function fetchRicevute(env, dal, al) {
  const documenti = [];
  let cursore = dal;

  while (cursore <= al) {
    let fine = addGiorni(cursore, 30);
    if (fine > al) fine = al;

    const data = await datacash(env, '/findDocuments/', { start: cursore, end: fine });
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
        tipo: r.tipoOperazione, // V = vendita, altri = annullo/reso
      });
    }
    if (fine === al) break;
    cursore = addGiorni(fine, 1);
  }

  // dedup (i blocchi possono sovrapporsi sui bordi)
  const visti = new Set();
  const unici = documenti.filter((d) => {
    if (visti.has(d.id)) return false;
    visti.add(d.id);
    return true;
  });
  unici.sort((a, b) => (a.data < b.data ? 1 : -1));

  const vendite = unici.filter((d) => d.tipo === 'V');
  const altri = unici.filter((d) => d.tipo !== 'V');

  return {
    count: unici.length,
    countVendite: vendite.length,
    countAltri: altri.length,
    totale: Math.round(vendite.reduce((s, x) => s + x.centesimi, 0)) / 100,
    documenti: unici,
  };
}

/* ---------------------------------------------------------------- */
/* Amenitiz                                                          */
/* ---------------------------------------------------------------- */
async function fetchPrenotazioni(env, dal, al) {
  const target = `${LS_BASE}/?action=debugBooking&from=${dal}&to=${al}`;
  // service binding se disponibile (worker-to-worker sullo stesso account),
  // altrimenti fetch pubblico
  const res = env.LS
    ? await env.LS.fetch(new Request(target, { headers: { 'User-Agent': 'fisco-worker' } }))
    : await fetch(target, { headers: { 'User-Agent': 'fisco-worker' } });
  if (!res.ok) throw new Error(`Amenitiz HTTP ${res.status}`);

  let raw = await res.json();
  if (raw && !Array.isArray(raw)) raw = raw.bookings || raw.results || [];
  if (typeof raw === 'string') raw = JSON.parse(raw);

  const prenotazioni = [];
  const visti = new Set();

  for (const b of raw || []) {
    const stato = String(b.status || '').toLowerCase();
    if (stato === 'cancelled' || stato === 'canceled') continue;
    if (!b.checkin || !b.checkout) continue;
    if (visti.has(b.booking_id)) continue;
    visti.add(b.booking_id);

    const n = notti(b.checkin, b.checkout);
    const adulti = b.adults || 1;
    const totale = Math.round((parseFloat(b.total_amount_after_tax) || 0) * 100);
    const cityTax = adulti * Math.min(n, CITY_TAX_MAX_NOTTI) * CITY_TAX_NOTTE * 100;
    const booker = b.booker || {};

    prenotazioni.push({
      id: String(b.booking_id),
      nome: `${booker.first_name || ''} ${booker.last_name || ''}`.trim(),
      email: booker.email || '',
      canale: b.source || '',
      checkin: b.checkin,
      checkout: b.checkout,
      notti: n,
      adulti,
      bambini: b.children || 0,
      totale: totale / 100,
      cityTax: cityTax / 100,
      // importo atteso in ricevuta: totale meno tassa di soggiorno
      attesoCents: totale - cityTax,
      atteso: (totale - cityTax) / 100,
      // fallback: totale pieno
      attesoAltCents: totale,
    });
  }
  prenotazioni.sort((a, b) => (a.checkout < b.checkout ? 1 : -1));
  return prenotazioni;
}

/* ---------------------------------------------------------------- */
/* Motore di match                                                   */
/* ---------------------------------------------------------------- */
function riconcilia(prenotazioni, ricevute) {
  const disponibili = ricevute.filter((r) => r.tipo === 'V').map((r) => ({ ...r }));
  const perImporto = new Map();
  for (const r of disponibili) {
    if (!perImporto.has(r.centesimi)) perImporto.set(r.centesimi, []);
    perImporto.get(r.centesimi).push(r);
  }

  const abbinamenti = [];
  const usate = new Set();
  const daAbbinare = prenotazioni.map((p) => ({ ...p, ricevuta: null, metodo: null }));

  // distanza in giorni tra emissione ricevuta e checkout
  const distanza = (ric, pren) =>
    Math.abs(
      (new Date(ric.giorno + 'T12:00:00Z') - new Date(pren.checkout + 'T12:00:00Z')) /
        86400000
    );

  function assegna(pren, ric, metodo) {
    usate.add(ric.id);
    pren.ricevuta = ric;
    pren.metodo = metodo;
    abbinamenti.push({ prenotazione: pren, ricevuta: ric, metodo });
  }

  // Passata generica: per un dato campo importo, prima gli univoci poi i multipli
  function passata(campoCents, etichetta) {
    // raggruppo le prenotazioni ancora libere per importo atteso
    const gruppi = new Map();
    for (const p of daAbbinare) {
      if (p.ricevuta) continue;
      const c = p[campoCents];
      if (!gruppi.has(c)) gruppi.set(c, []);
      gruppi.get(c).push(p);
    }

    for (const [cents, prens] of gruppi) {
      const cand = (perImporto.get(cents) || []).filter((r) => !usate.has(r.id));
      if (!cand.length) continue;

      // caso semplice: una prenotazione, una sola ricevuta con quell'importo
      if (prens.length === 1 && cand.length === 1) {
        assegna(prens[0], cand[0], `${etichetta}-univoco`);
        continue;
      }

      // caso ambiguo: assegno per prossimita' temporale al checkout
      const coppie = [];
      for (const p of prens)
        for (const r of cand) coppie.push({ p, r, d: distanza(r, p) });
      coppie.sort((a, b) => a.d - b.d);

      for (const { p, r, d } of coppie) {
        if (p.ricevuta || usate.has(r.id)) continue;
        assegna(p, r, `${etichetta}-data(${d}gg)`);
      }
    }
  }

  passata('attesoCents', 'senza-tassa');
  passata('attesoAltCents', 'con-tassa');

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

async function leggiStati(env, ids) {
  if (!env.FISCO_KV) return {};
  const coppie = await Promise.all(
    ids.map(async (id) => {
      try {
        const v = await env.FISCO_KV.get(chiaveStato(id), 'json');
        return [id, v];
      } catch {
        return [id, null];
      }
    })
  );
  return Object.fromEntries(coppie.filter(([, v]) => v));
}

async function scriviStato(env, id, dati) {
  if (!env.FISCO_KV) throw new Error('KV non configurato');
  if (dati === null) {
    await env.FISCO_KV.delete(chiaveStato(id));
    return null;
  }
  const record = { ...dati, aggiornato: new Date().toISOString() };
  await env.FISCO_KV.put(chiaveStato(id), JSON.stringify(record));
  return record;
}

/* ---------------------------------------------------------------- */
/* Emissione e annullo documento                                     */
/* ---------------------------------------------------------------- */
// pagamento: PC contanti, PE elettronico, NR_EF segue fattura
async function emettiDocumento(env, pren, pagamento = 'PE', aliquota = '10') {
  const descrizione =
    `Pernottamento ${pren.checkin} / ${pren.checkout}` +
    (pren.nome ? ` - ${pren.nome}` : '');

  const documento = {
    elementiContabili: [
      {
        aliquotaIVA: String(aliquota),
        percentualeIVA: parseInt(aliquota, 10),
        descrizioneProdotto: descrizione.slice(0, 100),
        prezzoLordo: pren.atteso,
        quantita: 1,
        scontoLordo: 0,
        omaggioElemento: false,
      },
    ],
    totaleScontiAPagare: 0,
    omaggio: false,
    codiceLotteria: '',
    pagamento,
    pagamenti: [],
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
  return res;
}

async function annullaDocumento(env, idtrx) {
  return datacash(env, `/voidDocument/${idtrx}/`, {});
}

/* ---------------------------------------------------------------- */
/* Elenco operativo: prenotazioni + stato + ricevuta                 */
/* ---------------------------------------------------------------- */
async function elenco(env, dal, al, margine) {
  const ricDal = addGiorni(dal, -7);
  const ricAl = addGiorni(al, margine);

  const [prenotazioni, ricevute] = await Promise.all([
    fetchPrenotazioni(env, dal, al),
    fetchRicevute(env, ricDal, ricAl),
  ]);

  const stati = await leggiStati(env, prenotazioni.map((p) => p.id));

  // match euristico solo per le prenotazioni senza stato registrato
  const senzaStato = prenotazioni.filter((p) => !stati[p.id]);
  const esito = riconcilia(senzaStato, ricevute.documenti);
  const perId = new Map(esito.abbinamenti.map((a) => [a.prenotazione.id, a]));

  const righe = prenotazioni.map((p) => {
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
        nota: '',
      };
    }
    return { ...p, stato: 'da_emettere', origine: null, ricevuta: null, nota: '' };
  });

  righe.sort((a, b) => (a.checkout < b.checkout ? 1 : -1));

  const conta = (s) => righe.filter((r) => r.stato === s).length;
  return {
    periodo: { prenotazioni: { dal, al }, ricevute: { dal: ricDal, al: ricAl } },
    riepilogo: {
      totali: righe.length,
      daEmettere: conta('da_emettere'),
      emesse: conta('emessa'),
      fattura: conta('fattura'),
      escluse: conta('esclusa'),
      ricevuteOrfane: esito.riepilogo.ricevuteSenzaPrenotazione,
    },
    righe,
    orfane: esito.ricevuteOrfane,
  };
}

/* ---------------------------------------------------------------- */
/* Handler                                                           */
/* ---------------------------------------------------------------- */
export default {
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
        },
      });
    }

    if (env.API_TOKEN && request.headers.get('X-Token') !== env.API_TOKEN) {
      return json({ error: 'non autorizzato' }, 401);
    }

    const oggi = giorno(new Date());
    const dal = url.searchParams.get('dal') || oggi;
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

        // recupero la prenotazione per avere importo e dati ospite
        const pren = (await fetchPrenotazioni(env, body.dal || dal, body.al || al)).find(
          (p) => p.id === String(body.id)
        );
        if (!pren) return json({ ok: false, error: 'prenotazione non trovata' }, 404);

        const importo = body.importo != null ? Number(body.importo) : pren.atteso;
        const res = await emettiDocumento(
          env,
          { ...pren, atteso: importo },
          body.pagamento || 'PE',
          body.aliquota || '10'
        );

        const rec = await scriviStato(env, pren.id, {
          stato: 'emessa',
          idtrx: res.idtrx,
          numero: res.progressivo,
          data: new Date().toISOString(),
          importo,
          nota: body.nota || '',
        });
        return json({ ok: true, prenotazione: pren.id, documento: res, stato: rec });
      }

      if (url.pathname === '/annulla' && request.method === 'POST') {
        const body = await request.json();
        if (!body.idtrx) return json({ ok: false, error: 'idtrx mancante' }, 400);
        const res = await annullaDocumento(env, body.idtrx);
        if (body.id) await scriviStato(env, body.id, null);
        return json({ ok: true, annullato: body.idtrx, risposta: res });
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
        const margine = parseInt(url.searchParams.get('margine') || '30', 10);
        const ricDal = addGiorni(dal, -7);
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
        disponibili: ['/health', '/infouser', '/dco', '/prenotazioni', '/riconcilia', '/elenco', '/stato', '/emetti', '/annulla'],
      },
      404
    );
  },
};
