/**
 * fisco-worker — riconciliazione ricevute AdE vs prenotazioni Amenitiz
 *
 * PASSO 1: lettura Documenti Commerciali Online dal cassetto fiscale
 *          tramite API DataCash/TelnetData (evita il blocco Akamai
 *          sul login diretto da IP datacenter).
 *
 * Secrets:
 *   DATACASH_KEY - api key TelnetData (header Datacash-Key)
 *   ADE_CRED_ENC - credenziali Fisconline cifrate PGP (dal pannello DataCash)
 *   API_TOKEN    - protegge questo worker (header X-Token)
 *
 * Endpoint:
 *   GET /health
 *   GET /infouser                        - verifica credenziali
 *   GET /dco?dal=YYYY-MM-DD&al=YYYY-MM-DD - ricevute del periodo
 */

const DC_BASE = 'https://dwadmin.telnetdata.it/api/dco';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'X-Token, Content-Type',
    },
  });

// le credenziali possono essere salvate col "\n" letterale: lo normalizzo
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
    throw new Error(
      `DataCash ${path} HTTP ${res.status}: ${data.message || JSON.stringify(data).slice(0, 200)}`
    );
  }
  return data;
}

// "23/07/2026 12:37:41" -> Date
function parseItDate(str) {
  const m = String(str).match(/(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/);
  if (!m) return null;
  const [, d, mo, y, hh = '00', mi = '00', ss = '00'] = m;
  return new Date(`${y}-${mo}-${d}T${hh}:${mi}:${ss}`);
}

async function fetchRicevute(env, dal, al) {
  const data = await datacash(env, '/findDocuments/', { start: dal, end: al });
  const results = Array.isArray(data) ? data : data.results || [];

  const documenti = results.map((r) => {
    const dt = parseItDate(r.data);
    return {
      id: r.idtrx,
      numero: r.numeroProgressivo,
      dataRaw: r.data,
      data: dt ? dt.toISOString() : null,
      giorno: dt ? dt.toISOString().slice(0, 10) : null,
      importo: r.ammontareComplessivo,
      centesimi: Math.round(r.ammontareComplessivo * 100),
      tipo: r.tipoOperazione, // V = vendita/prestazione
    };
  });

  // ordino dal piu recente
  documenti.sort((a, b) => (a.data < b.data ? 1 : -1));

  const vendite = documenti.filter((d) => d.tipo === 'V');
  const totale = vendite.reduce((s, x) => s + x.centesimi, 0) / 100;

  return {
    count: documenti.length,
    countVendite: vendite.length,
    totale: Math.round(totale * 100) / 100,
    documenti,
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return json({ ok: true });

    if (url.pathname === '/health') {
      return json({
        ok: true,
        worker: 'fisco-worker',
        passo: 1,
        fonte: 'DataCash / TelnetData API',
        secrets: {
          DATACASH_KEY: !!env.DATACASH_KEY,
          ADE_CRED_ENC: !!env.ADE_CRED_ENC,
          API_TOKEN: !!env.API_TOKEN,
        },
      });
    }

    if (env.API_TOKEN && request.headers.get('X-Token') !== env.API_TOKEN) {
      return json({ error: 'non autorizzato' }, 401);
    }

    try {
      if (url.pathname === '/infouser') {
        const d = await datacash(env, '/infoUser/', {});
        return json({ ok: true, ...d });
      }

      if (url.pathname === '/dco') {
        const oggi = new Date().toISOString().slice(0, 10);
        const dal = url.searchParams.get('dal') || oggi;
        const al = url.searchParams.get('al') || oggi;
        const data = await fetchRicevute(env, dal, al);
        return json({ ok: true, periodo: { dal, al }, ...data });
      }
    } catch (err) {
      return json({ ok: false, error: err.message }, 500);
    }

    return json(
      { error: 'endpoint sconosciuto', disponibili: ['/health', '/infouser', '/dco'] },
      404
    );
  },
};
