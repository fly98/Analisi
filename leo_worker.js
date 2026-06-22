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
  return data.access_token || null;
}

async function getAmenitizReport(env) {
  const accessToken = await getGmailToken(env);
  if (!accessToken) return { error: "Gmail auth fallita" };

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

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    try {
      const url = new URL(request.url);
      const action = url.searchParams.get("action");

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
