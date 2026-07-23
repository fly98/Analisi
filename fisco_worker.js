/**
 * fisco-worker — PASSO 1
 * Login Fisconline su ivaservizi.agenziaentrate.gov.it e lettura
 * dei Documenti Commerciali Online (ricevute emesse).
 *
 * Secrets richiesti (wrangler secret put ...):
 *   FISCO_CF    - codice fiscale utente Fisconline
 *   FISCO_PIN   - PIN (10 cifre)
 *   FISCO_PWD   - password Fisconline
 *   FISCO_PIVA  - partita IVA (09336091005)
 *   API_TOKEN   - token per proteggere questo worker
 *
 * Endpoint:
 *   GET /health
 *   GET /dco?dal=YYYY-MM-DD&al=YYYY-MM-DD   (header: X-Token: <API_TOKEN>)
 *   GET /debug?dal=...&al=...               (come sopra + log dei passaggi)
 */

const BASE = 'https://ivaservizi.agenziaentrate.gov.it';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.0 Safari/605.1.15';

/* ------------------------------------------------------------------ */
/* Cookie jar minimale: i Workers non gestiscono i cookie da soli      */
/* ------------------------------------------------------------------ */
class CookieJar {
  constructor() {
    this.jar = new Map();
  }

  absorb(response) {
    let raw = [];
    if (typeof response.headers.getSetCookie === 'function') {
      raw = response.headers.getSetCookie();
    } else {
      const single = response.headers.get('set-cookie');
      if (single) raw = [single];
    }
    for (const line of raw) {
      const pair = line.split(';')[0];
      const idx = pair.indexOf('=');
      if (idx < 1) continue;
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (!value || value === 'deleted' || value === '""') {
        this.jar.delete(name);
      } else {
        this.jar.set(name, value);
      }
    }
  }

  header() {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  has(name) {
    return this.jar.has(name);
  }

  names() {
    return [...this.jar.keys()];
  }
}

const ts = () => String(Date.now());

/* ------------------------------------------------------------------ */
/* Fetch con cookie jar e redirect manuali                             */
/* ------------------------------------------------------------------ */
async function jarFetch(jar, url, options = {}, log = null) {
  let current = url;
  let response;

  for (let hop = 0; hop < 8; hop++) {
    const headers = {
      'User-Agent': UA,
      Accept: options.accept || 'text/html,application/xhtml+xml,*/*',
      'Accept-Language': 'it-IT,it;q=0.9',
      ...(options.headers || {}),
    };
    const cookie = jar.header();
    if (cookie) headers['Cookie'] = cookie;

    // dopo un redirect il metodo torna a GET (tranne 307/308)
    const method = hop === 0 ? options.method || 'GET' : 'GET';
    const body = hop === 0 ? options.body : undefined;
    if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';

    response = await fetch(current, {
      method,
      headers,
      body,
      redirect: 'manual',
    });

    jar.absorb(response);
    if (log) log.push(`${method} ${current.split('?')[0]} -> ${response.status}`);

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) break;
      current = new URL(location, current).toString();
      continue;
    }
    break;
  }
  return response;
}

/* ------------------------------------------------------------------ */
/* Login: 4 passaggi                                                   */
/* ------------------------------------------------------------------ */
async function login(env, log) {
  const jar = new CookieJar();

  // 1. homepage -> cookie di sessione iniziali
  await jarFetch(jar, `${BASE}/portale/web/guest`, {}, log);

  // 2. POST credenziali (portlet Liferay id 58)
  const loginUrl =
    `${BASE}/portale/home?p_p_id=58&p_p_lifecycle=1&p_p_state=normal` +
    `&p_p_mode=view&p_p_col_id=column-1&p_p_col_pos=3&p_p_col_count=4` +
    `&_58_struts_action=%2Flogin%2Flogin`;

  const loginBody = new URLSearchParams({
    _58_saveLastPath: 'false',
    _58_redirect: '',
    _58_doActionAfterLogin: 'false',
    _58_login: env.FISCO_CF,
    _58_pin: env.FISCO_PIN,
    _58_password: env.FISCO_PWD,
  }).toString();

  const loginRes = await jarFetch(
    jar,
    loginUrl,
    { method: 'POST', body: loginBody },
    log
  );
  const html = await loginRes.text();

  // il token anti-CSRF di Liferay serve al passo successivo
  const match = html.match(/Liferay\.authToken\s*=\s*'([^']+)'/);
  if (!match) {
    const hint = /[Aa]utenticazione|[Cc]redenziali|password/.test(html)
      ? 'credenziali rifiutate o password scaduta (90 giorni)'
      : 'authToken non trovato nella risposta';
    throw new Error(`Login fallito: ${hint}`);
  }
  const pAuth = match[1];
  if (log) log.push(`authToken ok (${pAuth.slice(0, 6)}...)`);

  // 3. scelta utenza di lavoro: opero per la mia P.IVA
  const scegliUrl =
    `${BASE}/portale/scelta-utenza-lavoro?p_auth=${pAuth}` +
    `&p_p_id=SceltaUtenzaLavoro_WAR_SceltaUtenzaLavoroportlet` +
    `&p_p_lifecycle=1&p_p_state=normal&p_p_mode=view` +
    `&p_p_col_id=column-1&p_p_col_count=1` +
    `&_SceltaUtenzaLavoro_WAR_SceltaUtenzaLavoroportlet_javax.portlet.action=incarichiAction`;

  const scegliBody = new URLSearchParams({
    sceltaincarico: `${env.FISCO_PIVA}-FOL`,
    tipoincaricante: 'incDiretto',
  }).toString();

  await jarFetch(jar, scegliUrl, { method: 'POST', body: scegliBody }, log);

  // 4. warm-up dell'area servizi (imposta i cookie applicativi)
  await jarFetch(
    jar,
    `${BASE}/ser/api/messaggistica/v1/ul/me/totale?v=${ts()}`,
    {
      accept: 'application/json, text/plain, */*',
      headers: { Referer: `${BASE}/ser/documenticommercialionline/?v=${ts()}` },
    },
    log
  );

  if (log) log.push(`cookie in sessione: ${jar.names().join(', ')}`);
  return jar;
}

/* ------------------------------------------------------------------ */
/* Fetch documenti commerciali (paginato)                              */
/* ------------------------------------------------------------------ */
// l'API vuole le date in formato americano MM/DD/YYYY
function toUsDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

// "23/07/2026 12:37:41" -> Date
function parseItDate(str) {
  const m = str.match(/(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}`);
}

async function fetchDco(jar, dal, al, log) {
  const perPage = 100;
  const results = [];
  let page = 1;
  let totalCount = null;

  while (page <= 50) {
    const url =
      `${BASE}/ser/api/documenti/v1/doc/documenti/` +
      `?dataDal=${encodeURIComponent(toUsDate(dal))}` +
      `&dataInvioAl=${encodeURIComponent(toUsDate(al))}` +
      `&page=${page}&perPage=${perPage}&start=${(page - 1) * perPage + 1}` +
      `&v=${ts()}`;

    const res = await jarFetch(
      jar,
      url,
      {
        accept: 'application/json, text/plain, */*',
        headers: {
          Referer: `${BASE}/ser/documenticommercialionline/?v=${ts()}`,
          'X-XSS-Protection': '1; mode=block',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'deny',
        },
      },
      log
    );

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`API documenti HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      // se torna HTML vuol dire che la sessione non è valida
      throw new Error(
        'Risposta non JSON: sessione non autenticata o utenza non selezionata'
      );
    }

    const batch = data.elencoRisultati || [];
    totalCount = data.totalCount ?? batch.length;
    results.push(...batch);

    if (results.length >= totalCount || batch.length === 0) break;
    page++;
  }

  // normalizzo: importo in centesimi per confronti esatti
  const documenti = results.map((r) => {
    const d = parseItDate(r.data);
    return {
      id: r.idtrx,
      numero: r.numeroProgressivo,
      dataRaw: r.data,
      data: d ? d.toISOString() : null,
      giorno: d ? d.toISOString().slice(0, 10) : null,
      importo: r.ammontareComplessivo,
      centesimi: Math.round(r.ammontareComplessivo * 100),
      tipo: r.tipoOperazione, // V = vendita/prestazione
    };
  });

  const totale = documenti.reduce((s, x) => s + x.centesimi, 0) / 100;
  return { totalCount, count: documenti.length, totale, documenti };
}

/* ------------------------------------------------------------------ */
/* Handler                                                             */
/* ------------------------------------------------------------------ */
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'X-Token, Content-Type',
    },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return json({ ok: true });
    }

    if (url.pathname === '/health') {
      return json({
        ok: true,
        worker: 'fisco-worker',
        passo: 1,
        secrets: {
          FISCO_CF: !!env.FISCO_CF,
          FISCO_PIN: !!env.FISCO_PIN,
          FISCO_PWD: !!env.FISCO_PWD,
          FISCO_PIVA: !!env.FISCO_PIVA,
          API_TOKEN: !!env.API_TOKEN,
        },
      });
    }

    if (url.pathname === '/dco' || url.pathname === '/debug') {
      if (env.API_TOKEN && request.headers.get('X-Token') !== env.API_TOKEN) {
        return json({ error: 'non autorizzato' }, 401);
      }

      const oggi = new Date().toISOString().slice(0, 10);
      const dal = url.searchParams.get('dal') || oggi;
      const al = url.searchParams.get('al') || oggi;
      const log = url.pathname === '/debug' ? [] : null;

      try {
        const jar = await login(env, log);
        const data = await fetchDco(jar, dal, al, log);
        return json({ ok: true, periodo: { dal, al }, ...data, log });
      } catch (err) {
        return json({ ok: false, error: err.message, log }, 500);
      }
    }

    return json({ error: 'endpoint sconosciuto', disponibili: ['/health', '/dco', '/debug'] }, 404);
  },
};
