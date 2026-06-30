const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400"
};

const GITHUB_REPO = "fly98/Analisi";
const GITHUB_FILE = "leo_storico.json";
const GITHUB_BRANCH = "main";

async function getGmailToken(env) {
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: "refresh_token"
    })
  });
  const data = await resp.json();
  if (!data.access_token) {
    return { token: null, error: data.error || "unknown", desc: data.error_description || "" };
  }
  return { token: data.access_token };
}

async function getAmenitizReport(env) {
  const auth = await getGmailToken(env);
  if (!auth.token) return { error: "Gmail auth fallita", google_error: auth.error, google_desc: auth.desc };
  const accessToken = auth.token;

  const query = encodeURIComponent('subject:"Rapporto pagamenti registrati" has:attachment from:hotel-booking@amenitiz.io');
  const searchResp = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=5`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const searchData = await searchResp.json();
  if (!searchData.messages || !searchData.messages[0]) {
    return { error: "Nessuna mail trovata" };
  }

  // Prendi la più recente
  const msgId = searchData.messages[0].id;
  const msgResp = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const msgData = await msgResp.json();

  // Cerca allegato xlsx nelle parti
  const parts = msgData.payload?.parts || [];
  let attachmentId = null;
  let filename = null;

  function cercaAllegato(parts) {
    for (const part of parts) {
      if (part.mimeType && part.mimeType.includes("spreadsheet") ||
          (part.filename && part.filename.endsWith(".xlsx"))) {
        attachmentId = part.body?.attachmentId;
        filename = part.filename;
        return true;
      }
      if (part.parts) cercaAllegato(part.parts);
    }
    return false;
  }
  cercaAllegato(parts);

  if (!attachmentId) return { error: "Allegato xlsx non trovato nella mail" };

  const attResp = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}/attachments/${attachmentId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const attData = await attResp.json();
  if (!attData.data) return { error: "Download allegato fallito" };

  // Gmail usa base64url — restituisci direttamente, il frontend lo converte
  const msgDate = msgData.internalDate
    ? new Date(parseInt(msgData.internalDate)).toISOString()
    : new Date().toISOString();

  return {
    ok: true,
    filename: filename || "rapporto-pagamenti.xlsx",
    data: attData.data, // base64url
    msgDate,
    msgId
  };
}

async function getStorico(env) {
  const resp = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}?ref=${GITHUB_BRANCH}`,
    {
      headers: {
        Authorization: `Bearer ${env.GITHUB_PAT}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "leo-worker"
      }
    }
  );
  if (resp.status === 404) return { sessioni: [], sha: null };
  if (!resp.ok) return { error: "GitHub read error", status: resp.status };
  const data = await resp.json();
  const content = atob(data.content.replace(/\n/g, ""));
  return { ...JSON.parse(content), sha: data.sha };
}

async function saveStorico(body, env) {
  const existing = await getStorico(env);
  const sha = existing.sha;

  const content = btoa(unescape(encodeURIComponent(JSON.stringify(body, null, 2))));

  const payload = {
    message: `Leo: aggiorna storico ${new Date().toISOString().slice(0,10)}`,
    content,
    branch: GITHUB_BRANCH
  };
  if (sha) payload.sha = sha;

  const resp = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${env.GITHUB_PAT}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "leo-worker"
      },
      body: JSON.stringify(payload)
    }
  );
  if (!resp.ok) {
    const err = await resp.text();
    return { error: "GitHub write error", detail: err };
  }
  return { ok: true };
}

function htmlPage(inner) {
  return new Response(
    "<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>" +
    "<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;line-height:1.5;color:#111}code{background:#eee;padding:2px 6px;border-radius:4px;font-size:13px}a{color:#007aff}textarea{font-size:13px}</style></head><body>" +
    inner + "</body></html>",
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    try {
      const url = new URL(request.url);
      const action = url.searchParams.get("action");

      const REDIRECT_URI = "https://leo-worker.f-castiglioni.workers.dev/oauth2callback";

      // Avvio re-autorizzazione Gmail: apri questo URL nel browser
      if (action === "authStart") {
        const p = new URLSearchParams({
          client_id: env.GMAIL_CLIENT_ID,
          redirect_uri: REDIRECT_URI,
          response_type: "code",
          scope: "https://www.googleapis.com/auth/gmail.readonly",
          access_type: "offline",
          prompt: "consent"
        });
        return Response.redirect("https://accounts.google.com/o/oauth2/v2/auth?" + p.toString(), 302);
      }

      // Callback OAuth: Google torna qui con ?code=...
      if (url.pathname.endsWith("/oauth2callback")) {
        const code = url.searchParams.get("code");
        const oauthErr = url.searchParams.get("error");
        if (oauthErr) return htmlPage("Errore da Google: " + oauthErr);
        if (!code) return htmlPage("Nessun codice ricevuto da Google.");
        const tokResp = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: env.GMAIL_CLIENT_ID,
            client_secret: env.GMAIL_CLIENT_SECRET,
            code,
            redirect_uri: REDIRECT_URI,
            grant_type: "authorization_code"
          })
        });
        const td = await tokResp.json();
        if (!td.refresh_token) {
          return htmlPage("Scambio completato ma Google NON ha restituito un refresh_token.<br><br>" +
            "Di solito succede se l'app era gia autorizzata: vai su <a href='https://myaccount.google.com/permissions'>myaccount.google.com/permissions</a>, rimuovi l'accesso a questa app e riprova.<br><br>Risposta: <code>" + JSON.stringify(td) + "</code>");
        }
        return htmlPage("<b>Nuovo refresh token generato.</b><br><br>" +
          "Copialo e incollalo nel secret <code>GMAIL_REFRESH_TOKEN</code> del worker:<br>" +
          "Cloudflare dashboard &rarr; Workers &amp; Pages &rarr; <b>leo-worker</b> &rarr; Settings &rarr; Variables and Secrets &rarr; modifica <code>GMAIL_REFRESH_TOKEN</code>.<br><br>" +
          "<textarea readonly style='width:100%;height:90px' onclick='this.select()'>" + td.refresh_token + "</textarea>");
      }

      if (action === "getReport") {
        const result = await getAmenitizReport(env);
        return new Response(JSON.stringify(result), {
          status: result.error ? 400 : 200,
          headers: { ...CORS, "Content-Type": "application/json" }
        });
      }

      if (action === "getStorico") {
        const result = await getStorico(env);
        return new Response(JSON.stringify(result), {
          headers: { ...CORS, "Content-Type": "application/json" }
        });
      }

      if (action === "saveStorico") {
        if (request.method !== "POST") {
          return new Response(JSON.stringify({ error: "POST richiesto" }), {
            status: 405,
            headers: { ...CORS, "Content-Type": "application/json" }
          });
        }
        const body = await request.json();
        const result = await saveStorico(body, env);
        return new Response(JSON.stringify(result), {
          status: result.error ? 500 : 200,
          headers: { ...CORS, "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({ error: "Azione non riconosciuta", actions: ["getReport", "getStorico", "saveStorico"] }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" }
      });

    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), {
        status: 500,
        headers: { ...CORS, "Content-Type": "application/json" }
      });
    }
  }
};
