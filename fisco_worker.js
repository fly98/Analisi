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
 *   FISCO_PIN_INIZIALE - PIN iniziale rilasciato dall'AdE, serve per la
 *                        procedura di reset quando la password scade (90 gg).
 *                        NB: contiene la PASSWORD iniziale, non un pin.
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

  set(name, value) {
    this.jar.set(name, value);
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

  for (let hop = 0; hop < 14; hop++) {
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
/* Login: SSO ForgeRock (iampe) + selezione utenza di lavoro           */
/* ------------------------------------------------------------------ */
const IAM = 'https://iampe.agenziaentrate.gov.it';
const AUTH_URL =
  IAM + '/sam/json/realms/root/realms/agenziaentrate/authenticate';

async function login(env, log) {
  const jar = new CookieJar();

  // --- METODO A: POST form classico su /sam/UI/Login (OpenAM server-rendered)
  const gotoUrl = 'https://portale.agenziaentrate.gov.it:443/PortaleWeb/home?to=FATBTB';
  const loginPage = `${IAM}/sam/UI/Login?realm=/agenziaentrate&goto=${encodeURIComponent(gotoUrl)}`;

  // apro la pagina per raccogliere i cookie iniziali (incluso il load balancer)
  await jarFetch(jar, loginPage, {}, log);

  const formBody = new URLSearchParams({
    IDToken1: env.FISCO_CF,
    IDToken2: env.FISCO_PWD,
    IDToken3: env.FISCO_PIN,
    IDButton: 'Invia',
    goto: gotoUrl,
    realm: '/agenziaentrate',
    gx_charset: 'UTF-8',
  }).toString();

  const formRes = await jarFetch(
    jar,
    loginPage,
    {
      method: 'POST',
      body: formBody,
      headers: { Origin: IAM, Referer: loginPage },
    },
    log
  );

  if (log) {
    const bodyA = (await formRes.clone().text())
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 220);
    log.push(`metodo A -> HTTP ${formRes.status} | ${bodyA}`);
  }

  // --- METODO B (fallback): API JSON callbacks
  if (!jar.has('SIAMPE')) {
    if (log) log.push('metodo A non ha prodotto SIAMPE, provo metodo B (API JSON)');

    const apiHeaders = {
      'User-Agent': UA,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-API-Version': 'resource=2.0, protocol=1.0',
      'Accept-Language': 'it-IT,it;q=0.9',
      Origin: IAM,
      Referer: loginPage,
    };

    const initRes = await fetch(AUTH_URL, {
      method: 'POST',
      headers: { ...apiHeaders, Cookie: jar.header() },
      body: '{}',
    });
    jar.absorb(initRes);
    const challenge = await initRes.json();

    if (Array.isArray(challenge.callbacks)) {
      for (const cb of challenge.callbacks) {
        const pe = (cb.output || []).find((o) => o.name === 'prompt');
        const prompt = (pe ? pe.value : '').toLowerCase();
        if (!cb.input || !cb.input.length) continue;
        if (cb.type === 'NameCallback' || prompt.includes('user')) {
          cb.input[0].value = env.FISCO_CF;
        } else if (prompt.includes('pin')) {
          cb.input[0].value = env.FISCO_PIN;
        } else {
          cb.input[0].value = env.FISCO_PWD;
        }
      }

      const authRes = await fetch(AUTH_URL, {
        method: 'POST',
        headers: { ...apiHeaders, Cookie: jar.header() },
        body: JSON.stringify(challenge),
      });
      jar.absorb(authRes);
      const txt = await authRes.text();
      if (log) {
        log.push(
          `metodo B -> HTTP ${authRes.status} | ` +
            txt.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220)
        );
      }

      try {
        const d = JSON.parse(txt);
        if (d.tokenId) jar.set('SIAMPE', d.tokenId);
      } catch {
        /* HTML: fallito anche il metodo B */
      }
    }
  }

  if (!jar.has('SIAMPE')) {
    throw new Error(
      'Autenticazione fallita con entrambi i metodi. Cookie ottenuti: ' +
        (jar.names().join(', ') || 'nessuno')
    );
  }
  if (log) log.push('SSO ottenuto (SIAMPE presente)');

  // --- entro nel portale Fatture e Corrispettivi
  const portRes = await jarFetch(jar, `${BASE}/portale/`, {}, log);
  const portHtml = await portRes.text();

  // --- selezione utenza di lavoro
  const m = portHtml.match(/Liferay\.authToken\s*=\s*'([^']+)'/);
  if (m) {
    const pAuth = m[1];
    if (log) log.push('authToken Liferay trovato');
    const scegliUrl =
      `${BASE}/portale/scelta-utenza-lavoro?p_auth=${pAuth}` +
      `&p_p_id=SceltaUtenzaLavoro_WAR_SceltaUtenzaLavoroportlet` +
      `&p_p_lifecycle=1&p_p_state=normal&p_p_mode=view` +
      `&p_p_col_id=column-1&p_p_col_count=1` +
      `&_SceltaUtenzaLavoro_WAR_SceltaUtenzaLavoroportlet_javax.portlet.action=incarichiAction`;
    const body = new URLSearchParams({
      sceltaincarico: `${env.FISCO_PIVA}-FOL`,
      tipoincaricante: 'incDiretto',
    }).toString();
    await jarFetch(jar, scegliUrl, { method: 'POST', body }, log);
  } else if (log) {
    log.push('authToken Liferay non trovato');
  }

  // --- warm-up
  await jarFetch(
    jar,
    `${BASE}/ser/api/messaggistica/v1/ul/me/totale?v=${ts()}`,
    {
      accept: 'application/json, text/plain, */*',
      headers: { Referer: `${BASE}/ser/documenticommercialionline/?v=${ts()}` },
    },
    log
  );

  if (log) log.push(`cookie finali: ${jar.names().join(', ')}`);
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
          FISCO_PIN_INIZIALE: !!env.FISCO_PIN_INIZIALE,
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
