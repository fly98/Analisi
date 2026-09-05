// recensioni_worker.js — proxy HTTPS minimo verso il Mac, per il pulsante
// "Aggiorna" di recensioni.html.
//
// Perche' serve: la pagina e' su GitHub Pages (HTTPS), il Mac risponde in
// HTTP su fly98.duckdns.org:3456 (trigger-server.js). Un browser blocca
// come "Mixed Content" una fetch HTTP da una pagina HTTPS: questo worker fa
// da tramite (stesso schema gia' usato da icompta_worker per Fineco).
//
// Non tocca ne' legge i dati delle recensioni: si limita a inoltrare la
// richiesta al Mac e restituire quello che risponde. Il calcolo e la
// pubblicazione su GitHub li fa gia' trigger-server.js lato Mac (scrape.js
// + pubblica.js).
//
// Endpoint:
//   POST /aggiorna?property=deluxe|classica|tutte   (richiede X-Auth: TOKEN)
//     -> inoltra a http://fly98.duckdns.org:3456/recensioni-aggiorna
//
// Secret richiesto (Cloudflare dashboard -> Settings -> Variables and Secrets):
//   RECENSIONI_TOKEN : token arbitrario, deve combaciare con quello atteso
//                       da trigger-server.js e con quello scritto nella pagina

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === '/aggiorna' && request.method === 'POST') {
      if (!env.RECENSIONI_TOKEN || request.headers.get('X-Auth') !== env.RECENSIONI_TOKEN) {
        return json({ error: 'non autorizzato' }, 401);
      }
      const property = url.searchParams.get('property') || 'tutte';
      try {
        const r = await fetch(`http://fly98.duckdns.org:3456/recensioni-aggiorna?property=${encodeURIComponent(property)}`, {
          headers: { 'X-Trigger-Key': env.RECENSIONI_TOKEN },
          signal: AbortSignal.timeout(170000), // lo scraping completo puo' metterci qualche minuto
        });
        const testo = await r.text();
        return new Response(testo, { status: r.status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
      } catch (e) {
        return json({ error: 'Mac non raggiungibile', dettaglio: e.message }, 502);
      }
    }

    return json({ error: 'non trovato' }, 404);
  },
};
