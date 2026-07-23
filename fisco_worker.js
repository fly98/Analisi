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

  const vendite = unici.filter((d) => d.tipo === 'V');
  return {
    count: unici.length,
    countVendite: vendite.length,
    countAltri: unici.length - vendite.length,
    totale: Math.round(vendite.reduce((s, x) => s + x.centesimi, 0)) / 100,
    documenti: unici,
  };
}

/* ---------------------------------------------------------------- */
/* Amenitiz                                                          */
/* ---------------------------------------------------------------- */
async function fetchPrenotazioni(env, dal, al) {
  // Amenitiz rifiuta intervalli superiori a ~1 mese: spezzo e parallelizzo
  const blocchi = [];
  let cursore = dal;
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
      if (visti.has(b.booking_id)) continue;
      visti.add(b.booking_id);

      const n = notti(b.checkin, b.checkout);
      const adulti = b.adults || 1;
      const totale = Math.round((parseFloat(b.total_amount_after_tax) || 0) * 100);
      const cityTax = adulti * Math.min(n, CITY_TAX_MAX_NOTTI) * CITY_TAX_NOTTE * 100;
      const booker = b.booker || {};
      const camere = (b.rooms || [])
        .map((r) => r.individual_room_name)
        .filter(Boolean);

      prenotazioni.push({
        id: String(b.booking_id),
        nome: `${booker.first_name || ''} ${booker.last_name || ''}`.trim(),
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
        attesoAltCents: totale,
      });
    }
  }

  prenotazioni.sort((a, b) => (a.checkin < b.checkin ? 1 : -1));
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
      (new Date(ric.giorno + 'T12:00:00Z') - new Date(pren.checkin + 'T12:00:00Z')) /
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
        nota: '',
      };
    }
    const oggiIso = giorno(new Date());
    if (p.checkin > oggiIso) {
      return { ...p, stato: 'futura', origine: null, ricevuta: null, nota: '' };
    }
    return { ...p, stato: 'da_emettere', origine: null, ricevuta: null, nota: '' };
  });

  righe.sort((a, b) => (a.checkin < b.checkin ? 1 : -1));

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
      ricevuteOrfane: esito.riepilogo.ricevuteSenzaPrenotazione,
    },
    righe,
    orfane: esito.ricevuteOrfane,
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
  const margine = opzioni.margine ?? 60;
  const maxGiorni = opzioni.giorni ?? 45;     // distanza max dall'arrivo
  const maxScarto = opzioni.scarto ?? 0.25;   // scarto max sull'importo (25%)
  const maxCand = opzioni.candidati ?? 5;

  const ricDal = addGiorni(dal, -30);
  const ricAl = addGiorni(al, margine);

  const [prenotazioni, ricevute] = await Promise.all([
    fetchPrenotazioni(env, dal, al),
    fetchRicevute(env, ricDal, ricAl),
  ]);

  const stati = await leggiStati(env, prenotazioni.map((p) => p.id));

  // ricevute gia' impegnate da una decisione registrata
  const impegnate = new Set();
  for (const s of Object.values(stati)) if (s && s.idtrx) impegnate.add(String(s.idtrx));

  // il match esatto viene applicato prima: resta da proporre solo il resto
  const libere = prenotazioni.filter((p) => !stati[p.id]);
  const esito = riconcilia(libere, ricevute.documenti);
  const abbinateOk = new Set(esito.abbinamenti.map((a) => a.prenotazione.id));
  for (const a of esito.abbinamenti) impegnate.add(String(a.ricevuta.id));

  const scoperte = libere.filter((p) => !abbinateOk.has(p.id));
  const orfane = ricevute.documenti.filter(
    (r) => r.tipo === 'V' && !impegnate.has(String(r.id))
  );

  const giorniTra = (isoA, isoB) =>
    Math.round((new Date(isoA + 'T12:00:00Z') - new Date(isoB + 'T12:00:00Z')) / 86400000);

  const lista = [];
  for (const p of scoperte) {
    const cand = [];
    for (const r of orfane) {
      const dGiorni = giorniTra(r.giorno, p.checkin);
      if (dGiorni < -7 || dGiorni > maxGiorni) continue; // ricevuta troppo lontana

      const dImporto = (r.centesimi - p.attesoCents) / 100;
      const scarto = Math.abs(r.centesimi - p.attesoCents) / Math.max(p.attesoCents, 1);
      if (scarto > maxScarto) continue;

      // punteggio: 100 = perfetto. Pesa piu' l'importo della data.
      const punti = Math.round(
        100 - scarto * 200 - Math.min(Math.abs(dGiorni), maxGiorni) * 0.8
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
        indizio:
          Math.abs(r.centesimi - (p.attesoCents + p.cityTax * 100)) < 2
            ? 'tassa inclusa'
            : Math.abs(dImporto) < 0.02
            ? 'importo esatto'
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

        // recupero la prenotazione per avere importo e dati ospite
        const pren = (await fetchPrenotazioni(env, body.dal || dal, body.al || al)).find(
          (p) => p.id === String(body.id)
        );
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

      if (url.pathname === '/annulla' && request.method === 'POST') {
        const body = await request.json();
        if (!body.idtrx) return json({ ok: false, error: 'idtrx mancante' }, 400);
        const res = await annullaDocumento(env, body.idtrx);
        if (body.id) await scriviStato(env, body.id, null);
        return json({ ok: true, annullato: body.idtrx, risposta: res });
      }

      if (url.pathname === '/proposte') {
        const opz = {
          margine: parseInt(url.searchParams.get('margine') || '60', 10),
          giorni: parseInt(url.searchParams.get('giorni') || '45', 10),
          scarto: parseFloat(url.searchParams.get('scarto') || '0.25'),
        };
        return json({ ok: true, periodo: { dal, al }, ...(await proposte(env, dal, al, opz)) });
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
        disponibili: ['/health', '/infouser', '/dco', '/prenotazioni', '/riconcilia', '/elenco', '/stato', '/emetti', '/annulla', '/condividi', '/invia', '/rinnova', '/proposte', '/r/{token}'],
      },
      404
    );
  },
};
