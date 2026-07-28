/**
 * pricelabs-worker
 * Proxy autenticato verso la PriceLabs Customer API + archivio storico giornaliero.
 *
 * Secrets richiesti (Cloudflare dashboard -> Settings -> Variables and Secrets):
 *   PRICELABS_API_KEY : chiave da app.pricelabs.co -> Account Settings -> API Details
 *   API_TOKEN         : token arbitrario per proteggere questo worker
 *
 * Auth verso questo worker: header  X-Auth: {API_TOKEN}   oppure  ?token={API_TOKEN}
 * KV: ICOMPTA_KV, chiavi  pricelabs:snapshot:YYYY-MM-DD  e  pricelabs:snapshot:index
 */

const PL_BASE = 'https://api.pricelabs.co';
const VERSION = '1.0.0';
const SNAPSHOT_DAYS_AHEAD = 180;   // orizzonte prezzi salvato ogni giorno
const SNAPSHOT_RETENTION = 800;    // max chiavi mantenute nell'indice

/* ---------------------------------------------------------------- helpers */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, X-Auth',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    },
  });
}

function authorized(request, url, env) {
  if (!env.API_TOKEN) return false;
  const h = request.headers.get('X-Auth');
  const q = url.searchParams.get('token');
  return h === env.API_TOKEN || q === env.API_TOKEN;
}

function todayISO(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

/** Chiamata generica alla Customer API di PriceLabs. */
async function pl(env, method, path, { query, body } = {}) {
  if (!env.PRICELABS_API_KEY) {
    return { ok: false, status: 500, data: { error: 'PRICELABS_API_KEY non configurata' } };
  }
  const u = new URL(PL_BASE + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
    }
  }
  const init = {
    method,
    headers: {
      'X-API-Key': env.PRICELABS_API_KEY,
      'Accept': 'application/json',
    },
  };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(u.toString(), init);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

/* ------------------------------------------------------------- snapshot */

/** Riduce la risposta prezzi al minimo indispensabile per lo storico. */
function compactPrices(item) {
  const rows = Array.isArray(item?.data) ? item.data : [];
  return rows.map((r) => ({
    d: r.date,
    p: r.price,
    m: r.min_stay ?? r.minimum_stay ?? null,
  }));
}

async function buildSnapshot(env) {
  const date = todayISO();
  const started = new Date().toISOString();

  const listingsRes = await pl(env, 'GET', '/v1/listings', {
    query: { only_syncing_listings: 'true' },
  });
  if (!listingsRes.ok) {
    return { ok: false, date, step: 'listings', status: listingsRes.status, data: listingsRes.data };
  }

  const raw = listingsRes.data;
  const listings = Array.isArray(raw) ? raw : (raw?.listings || raw?.data || []);

  const meta = listings.map((l) => ({
    id: String(l.id ?? l.listing_id ?? ''),
    pms: l.pms ?? l.pms_name ?? '',
    name: l.name ?? l.listing_name ?? '',
    base: l.base ?? l.base_price ?? null,
    min: l.min ?? l.min_price ?? null,
    max: l.max ?? l.max_price ?? null,
    currency: l.currency ?? null,
    isHidden: l.isHidden ?? l.is_hidden ?? null,
    push_enabled: l.push_enabled ?? null,
  })).filter((l) => l.id && l.pms);

  const prices = {};
  const errors = [];

  // Batch da 10 listing per chiamata: resta ampiamente sotto i 60 req/min.
  for (let i = 0; i < meta.length; i += 10) {
    const chunk = meta.slice(i, i + 10).map((l) => ({
      id: l.id,
      pms: l.pms,
      dateFrom: date,
      dateTo: todayISO(SNAPSHOT_DAYS_AHEAD),
    }));
    const r = await pl(env, 'POST', '/v1/listing_prices', { body: { listings: chunk } });
    if (!r.ok) {
      errors.push({ chunk: chunk.map((c) => c.id), status: r.status, data: r.data });
      continue;
    }
    const items = Array.isArray(r.data) ? r.data : (r.data?.data || []);
    for (const it of items) {
      if (it?.error) {
        errors.push({ id: it.id, error: it.error, error_status: it.error_status });
        continue;
      }
      prices[String(it.id)] = {
        currency: it.currency ?? null,
        last_refreshed_at: it.last_refreshed_at ?? null,
        rows: compactPrices(it),
      };
    }
  }

  const snapshot = {
    date,
    created_at: started,
    version: VERSION,
    listings: meta,
    prices,
    errors,
  };

  await env.ICOMPTA_KV.put(`pricelabs:snapshot:${date}`, JSON.stringify(snapshot));

  // aggiorna indice
  let index = [];
  try {
    const cur = await env.ICOMPTA_KV.get('pricelabs:snapshot:index');
    if (cur) index = JSON.parse(cur);
  } catch { index = []; }
  if (!index.includes(date)) index.push(date);
  index.sort();
  if (index.length > SNAPSHOT_RETENTION) index = index.slice(-SNAPSHOT_RETENTION);
  await env.ICOMPTA_KV.put('pricelabs:snapshot:index', JSON.stringify(index));

  return {
    ok: true,
    date,
    listings: meta.length,
    priced: Object.keys(prices).length,
    errors: errors.length,
  };
}

/* ---------------------------------------------------------------- router */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') return json({ ok: true });

    if (path === '/' || path === '/health') {
      return json({
        ok: true,
        worker: 'pricelabs-worker',
        version: VERSION,
        hasApiKey: Boolean(env.PRICELABS_API_KEY),
        hasToken: Boolean(env.API_TOKEN),
        hasKV: Boolean(env.ICOMPTA_KV),
      });
    }

    if (!authorized(request, url, env)) {
      return json({ error: 'unauthorized' }, 401);
    }

    const q = Object.fromEntries(url.searchParams);
    delete q.token;

    try {
      /* --- lettura --- */
      if (path === '/listings' && request.method === 'GET') {
        const r = await pl(env, 'GET', '/v1/listings', { query: q });
        return json(r.data, r.ok ? 200 : r.status);
      }

      if (path === '/listings-minimal' && request.method === 'GET') {
        const r = await pl(env, 'GET', '/v1/listings_minimal', { query: q });
        return json(r.data, r.ok ? 200 : r.status);
      }

      if (path === '/metrics' && request.method === 'GET') {
        const r = await pl(env, 'GET', '/v1/listing_metrics', { query: q });
        return json(r.data, r.ok ? 200 : r.status);
      }

      if (path === '/prices' && request.method === 'POST') {
        const body = await request.json();
        const r = await pl(env, 'POST', '/v1/listing_prices', { body });
        return json(r.data, r.ok ? 200 : r.status);
      }

      if (path === '/neighborhood' && request.method === 'GET') {
        const r = await pl(env, 'GET', '/v1/neighborhood_data', { query: q });
        return json(r.data, r.ok ? 200 : r.status);
      }

      if (path === '/reservations' && request.method === 'GET') {
        const r = await pl(env, 'GET', '/v1/reservation_data', { query: q });
        return json(r.data, r.ok ? 200 : r.status);
      }

      if (path === '/bookings-report' && request.method === 'POST') {
        const body = await request.json();
        const r = await pl(env, 'POST', '/v1/bookings_report', { body });
        return json(r.data, r.ok ? 200 : r.status);
      }

      if (path === '/nudges' && request.method === 'GET') {
        const r = await pl(env, 'GET', '/v1/nudges/available', { query: q });
        return json(r.data, r.ok ? 200 : r.status);
      }

      /* --- scrittura (override per data) --- */
      if (path.startsWith('/overrides/')) {
        const listingId = path.split('/')[2];
        if (request.method === 'GET') {
          const r = await pl(env, 'GET', `/v1/listings/${listingId}/overrides`, { query: q });
          return json(r.data, r.ok ? 200 : r.status);
        }
        if (request.method === 'POST') {
          const body = await request.json();
          const r = await pl(env, 'POST', `/v1/listings/${listingId}/overrides`, { body });
          return json(r.data, r.ok ? 200 : r.status);
        }
        if (request.method === 'DELETE') {
          const body = await request.json().catch(() => undefined);
          const r = await pl(env, 'DELETE', `/v1/listings/${listingId}/overrides`, { body });
          return json(r.data, r.ok ? 200 : r.status);
        }
      }

      /* --- passthrough generico, per endpoint non ancora mappati --- */
      if (path === '/raw') {
        const target = url.searchParams.get('path');
        if (!target || !target.startsWith('/v1/')) {
          return json({ error: 'parametro path mancante o non valido (deve iniziare con /v1/)' }, 400);
        }
        delete q.path;
        const body = request.method === 'POST' ? await request.json().catch(() => undefined) : undefined;
        const r = await pl(env, request.method, target, { query: q, body });
        return json(r.data, r.ok ? 200 : r.status);
      }

      /* --- snapshot storici --- */
      if (path === '/snapshot/run') {
        const r = await buildSnapshot(env);
        return json(r, r.ok ? 200 : 500);
      }

      if (path === '/snapshot/list') {
        const cur = await env.ICOMPTA_KV.get('pricelabs:snapshot:index');
        return json({ dates: cur ? JSON.parse(cur) : [] });
      }

      if (path === '/snapshot/get') {
        const date = url.searchParams.get('date') || todayISO();
        const cur = await env.ICOMPTA_KV.get(`pricelabs:snapshot:${date}`);
        if (!cur) return json({ error: 'snapshot non trovato', date }, 404);
        return new Response(cur, {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }

      return json({ error: 'endpoint non trovato', path }, 404);
    } catch (err) {
      return json({ error: String(err && err.message ? err.message : err) }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(buildSnapshot(env));
  },
};
