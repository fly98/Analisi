var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization"
};
var json = __name((data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { ...CORS, "Content-Type": "application/json" }
}), "json");
var err = __name((msg, status = 400) => json({ error: msg }, status), "err");

function checkAuth(request, env) {
  const auth = request.headers.get("Authorization") || "";
  return auth.replace("Bearer ", "").trim() === env.ICOMPTA_TOKEN;
}
__name(checkAuth, "checkAuth");

function genId() { return crypto.randomUUID().toUpperCase(); }
__name(genId, "genId");

async function getTxYear(env, year) {
  const raw = await env.ICOMPTA_KV.get(`icompta:tx:${year}`);
  return raw ? JSON.parse(raw) : [];
}
__name(getTxYear, "getTxYear");

async function putTxYear(env, year, txs) {
  await env.ICOMPTA_KV.put(`icompta:tx:${year}`, JSON.stringify(txs));
}
__name(putTxYear, "putTxYear");

// ── Sella import log ──────────────────────────────────────────────────────────
const SELLA_LOG_KEY = "icompta:sella_log";

async function getSellaLog(env) {
  const raw = await env.ICOMPTA_KV.get(SELLA_LOG_KEY);
  return raw ? JSON.parse(raw) : [];
}
__name(getSellaLog, "getSellaLog");

async function putSellaLog(env, log) {
  await env.ICOMPTA_KV.put(SELLA_LOG_KEY, JSON.stringify(log));
}
__name(putSellaLog, "putSellaLog");

var icompta_worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === "OPTIONS") return new Response(null, { headers: CORS });
    if (!checkAuth(request, env)) return err("Unauthorized", 401);

    // ── META ────────────────────────────────────────────────────────────────
    if (path === "/api/meta" && method === "GET") {
      const meta = await env.ICOMPTA_KV.get("icompta:meta");
      if (!meta) return err("Meta non trovato — importa prima il DB", 404);
      return json(JSON.parse(meta));
    }

    // ── META PUT (aggiorna accounts/groups) ──────────────────────────────────
    if (path === "/api/meta" && method === "PUT") {
      const body = await request.json();
      const { accounts, groups } = body;
      if (!accounts || !groups) return err("accounts e groups richiesti");
      const raw = await env.ICOMPTA_KV.get("icompta:meta");
      if (!raw) return err("Meta non trovato", 404);
      const meta = JSON.parse(raw);
      meta.accounts = accounts;
      meta.groups = groups;
      await env.ICOMPTA_KV.put("icompta:meta", JSON.stringify(meta));
      return json({ ok: true });
    }

    // ── TX GET per anno ─────────────────────────────────────────────────────
    const txYearMatch = path.match(/^\/api\/tx\/(\d{4})$/);
    if (txYearMatch && method === "GET") {
      return json(await getTxYear(env, txYearMatch[1]));
    }

    // ── BALANCE ─────────────────────────────────────────────────────────────
    if (path === "/api/balance" && method === "GET") {
      const metaRaw = await env.ICOMPTA_KV.get("icompta:meta");
      if (!metaRaw) return err("Meta mancante", 404);
      const meta = JSON.parse(metaRaw);
      const balances = {};
      for (const acc of meta.accounts) balances[acc.id] = 0;
      for (const year of meta.years) {
        const txs = await getTxYear(env, year);
        for (const tx of txs) {
          if (!balances.hasOwnProperty(tx.accountId)) continue;
          const splits = tx.splits || [];
          if (tx.useSumOfSplits && splits.length > 0) {
            for (const s of splits) { if (s.amount != null) balances[tx.accountId] += s.amount; }
          } else if (tx.amount != null) {
            balances[tx.accountId] += tx.amount;
          }
        }
      }
      for (const k in balances) balances[k] = Math.round(balances[k] * 100) / 100;
      const groupBalances = {};
      for (const g of meta.groups) groupBalances[g.id] = 0;
      for (const acc of meta.accounts) {
        if (acc.groupId && groupBalances.hasOwnProperty(acc.groupId))
          groupBalances[acc.groupId] += balances[acc.id] || 0;
      }
      return json({ accounts: balances, groups: groupBalances });
    }

    // ── TX POST (crea/aggiorna) ──────────────────────────────────────────────
    if (path === "/api/tx" && method === "POST") {
      const body = await request.json();
      const { tx } = body;
      if (!tx || !tx.date || !tx.accountId) return err("TX mancante o incompleta");
      const year = tx.date.substring(0, 4);
      const txs = await getTxYear(env, year);
      if (tx.id) {
        const idx = txs.findIndex(t => t.id === tx.id);
        if (idx === -1) return err("TX non trovata", 404);
        txs[idx] = tx;
      } else {
        tx.id = genId();
        tx.status = tx.status || "created";
        txs.push(tx);
      }
      txs.sort((a, b) => a.date.localeCompare(b.date));
      await putTxYear(env, year, txs);
      const metaRaw = await env.ICOMPTA_KV.get("icompta:meta");
      if (metaRaw) {
        const meta = JSON.parse(metaRaw);
        if (!meta.years.includes(year)) {
          meta.years.push(year); meta.years.sort();
          await env.ICOMPTA_KV.put("icompta:meta", JSON.stringify(meta));
        }
      }
      return json({ ok: true, id: tx.id });
    }

    // ── TX DELETE ────────────────────────────────────────────────────────────
    const delMatch = path.match(/^\/api\/tx\/([A-F0-9\-]{36})$/i);
    if (delMatch && method === "DELETE") {
      const id = delMatch[1];
      const yearHint = url.searchParams.get("year");
      const yearsToCheck = yearHint ? [yearHint] : [];
      if (!yearHint) {
        const metaRaw = await env.ICOMPTA_KV.get("icompta:meta");
        if (metaRaw) yearsToCheck.push(...JSON.parse(metaRaw).years);
      }
      for (const year of yearsToCheck) {
        const txs = await getTxYear(env, year);
        const idx = txs.findIndex(t => t.id === id);
        if (idx !== -1) {
          txs.splice(idx, 1);
          await putTxYear(env, year, txs);
          return json({ ok: true });
        }
      }
      return err("TX non trovata", 404);
    }

    // ── IMPORT KV generico ───────────────────────────────────────────────────
    if (path === "/api/import" && method === "POST") {
      const body = await request.json();
      const { key, data } = body;
      if (!key || !data) return err("key e data richiesti");
      if (!key.startsWith("icompta:")) return err("Key non valida");
      await env.ICOMPTA_KV.put(key, typeof data === "string" ? data : JSON.stringify(data));
      return json({ ok: true, key });
    }

    // ── SELLA LOG GET ────────────────────────────────────────────────────────
    if (path === "/api/sella-log" && method === "GET") {
      return json(await getSellaLog(env));
    }

    // ── SELLA LOG POST (salva sessione) ──────────────────────────────────────
    if (path === "/api/sella-log" && method === "POST") {
      const body = await request.json();
      const { session } = body;
      if (!session || !session.id) return err("session mancante");
      const log = await getSellaLog(env);
      log.unshift(session); // più recente prima
      await putSellaLog(env, log);
      return json({ ok: true });
    }

    // ── SELLA LOG DELETE (rollback sessione) ─────────────────────────────────
    if (path.match(/^\/api\/sella-log\/(.+)$/) && method === "DELETE") {
      const sessionId = path.match(/^\/api\/sella-log\/(.+)$/)[1];
      const log = await getSellaLog(env);
      const session = log.find(s => s.id === sessionId);
      if (!session) return err("Sessione non trovata", 404);

      // Elimina tutte le TX della sessione
      const allIds = [...(session.txBanca || []), ...(session.txEco || [])];
      const metaRaw = await env.ICOMPTA_KV.get("icompta:meta");
      const meta = metaRaw ? JSON.parse(metaRaw) : { years: [] };
      let deleted = 0;

      // Carica tutti gli anni in memoria, rimuovi, riscrivi
      for (const year of meta.years) {
        const txs = await getTxYear(env, year);
        const before = txs.length;
        const filtered = txs.filter(t => !allIds.includes(t.id));
        if (filtered.length < before) {
          await putTxYear(env, year, filtered);
          deleted += before - filtered.length;
        }
      }

      // Rimuovi sessione dal log
      const newLog = log.filter(s => s.id !== sessionId);
      await putSellaLog(env, newLog);

      return json({ ok: true, deleted });
    }

    // ── EXPORT OFX ───────────────────────────────────────────────────────────
    if (path === "/api/export/ofx" && method === "GET") {
      const accountId = url.searchParams.get("accountId");
      const fromDate = url.searchParams.get("from") || "2024-01-01";
      const toDate = url.searchParams.get("to") || (new Date()).toISOString().slice(0, 10);
      const metaRaw = await env.ICOMPTA_KV.get("icompta:meta");
      if (!metaRaw) return err("Meta mancante", 404);
      const meta = JSON.parse(metaRaw);
      const account = meta.accounts.find(a => a.id === accountId);
      if (!account) return err("Account non trovato", 404);
      const fromYear = parseInt(fromDate.slice(0, 4));
      const toYear = parseInt(toDate.slice(0, 4));
      const allTxs = [];
      for (let y = fromYear; y <= toYear; y++) {
        const txs = await getTxYear(env, String(y));
        allTxs.push(...txs.filter(t => t.accountId === accountId && t.date >= fromDate && t.date <= toDate));
      }
      const ofxDate = __name(d => d.replace(/-/g, "") + "000000", "ofxDate");
      let stmtTrn = "";
      for (const tx of allTxs) {
        const amount = tx.useSumOfSplits
          ? (tx.splits || []).reduce((s, sp) => s + (sp.amount || 0), 0)
          : tx.amount || 0;
        stmtTrn += `\n<STMTTRN>\n<TRNTYPE>${amount >= 0 ? "CREDIT" : "DEBIT"}</TRNTYPE>\n<DTPOSTED>${ofxDate(tx.date)}</DTPOSTED>\n<TRNAMT>${amount.toFixed(2)}</TRNAMT>\n<FITID>${tx.id}</FITID>\n<NAME>${(tx.name || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</NAME>\n<MEMO>${(tx.comment || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</MEMO>\n</STMTTRN>`;
      }
      const ofx = `OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nSECURITY:NONE\nENCODING:UTF-8\nCHARSET:1252\nCOMPRESSION:NONE\nOLDFILEUID:NONE\nNEWFILEUID:NONE\n\n<OFX>\n<BANKMSGSRSV1>\n<STMTTRNRS>\n<TRNUID>1</TRNUID>\n<STMTRS>\n<CURDEF>EUR</CURDEF>\n<BANKACCTFROM>\n<BANKID>ICOMPTA</BANKID>\n<ACCTID>${account.number || accountId.slice(0, 8)}</ACCTID>\n<ACCTTYPE>CHECKING</ACCTTYPE>\n</BANKACCTFROM>\n<BANKTRANLIST>\n<DTSTART>${ofxDate(fromDate)}</DTSTART>\n<DTEND>${ofxDate(toDate)}</DTEND>\n${stmtTrn}\n</BANKTRANLIST>\n</STMTRS>\n</STMTTRNRS>\n</BANKMSGSRSV1>\n</OFX>`;
      return new Response(ofx, {
        headers: {
          ...CORS,
          "Content-Type": "application/x-ofx",
          "Content-Disposition": `attachment; filename="icompta_${account.name}_${fromDate}_${toDate}.ofx"`
        }
      });
    }

    // ── RESTORE ──────────────────────────────────────────────────────────────
    if (path === "/api/restore" && method === "POST") {
      const ghPAT = env.GITHUB_PAT;
      if (!ghPAT) return err("GITHUB_PAT non configurato", 500);
      const triggerResp = await fetch(
        "https://api.github.com/repos/fly98/Analisi/actions/workflows/restore-icompta-kv.yml/dispatches",
        {
          method: "POST",
          headers: { "Authorization": `Bearer ${ghPAT}`, "Content-Type": "application/json" },
          body: JSON.stringify({ ref: "main" })
        }
      );
      if (triggerResp.status === 204) {
        return json({ ok: true, message: "Ripristino avviato — ci vorranno circa 2 minuti" });
      } else {
        const errText = await triggerResp.text();
        return err(`GitHub Actions error: ${triggerResp.status} ${errText}`, 500);
      }
    }

    // ── SELLA REGOLE GET ─────────────────────────────────────────────────────
    if (path === "/api/sella-regole" && method === "GET") {
      const ghPAT = env.GITHUB_PAT;
      if (!ghPAT) return err("GITHUB_PAT non configurato", 500);
      const r = await fetch("https://api.github.com/repos/fly98/Analisi/contents/sella_regole.json", {
        headers: { Authorization: `Bearer ${ghPAT}`, Accept: "application/vnd.github.v3+json" }
      });
      if (r.status === 404) return json({});
      if (!r.ok) return err("GitHub error " + r.status, 502);
      const d = await r.json();
      const raw = atob(d.content.replace(/\n/g, ""));
      try { return json(JSON.parse(raw)); }
      catch(e) { return json({}); }
    }

    // ── SELLA REGOLE PUT ─────────────────────────────────────────────────────
    if (path === "/api/sella-regole" && method === "PUT") {
      const ghPAT = env.GITHUB_PAT;
      if (!ghPAT) return err("GITHUB_PAT non configurato", 500);
      const body = await request.json();
      const { regole } = body;
      if (!regole) return err("regole mancanti");
      // Legge sha attuale
      const getR = await fetch("https://api.github.com/repos/fly98/Analisi/contents/sella_regole.json", {
        headers: { Authorization: `Bearer ${ghPAT}`, Accept: "application/vnd.github.v3+json" }
      });
      let sha = null;
      if (getR.ok) { const gd = await getR.json(); sha = gd.sha; }
      const content = btoa(unescape(encodeURIComponent(JSON.stringify(regole, null, 2))));
      const putBody = { message: "iCompta: aggiorna sella_regole.json", content };
      if (sha) putBody.sha = sha;
      const putR = await fetch("https://api.github.com/repos/fly98/Analisi/contents/sella_regole.json", {
        method: "PUT",
        headers: { Authorization: `Bearer ${ghPAT}`, "Content-Type": "application/json" },
        body: JSON.stringify(putBody)
      });
      if (!putR.ok) return err("GitHub PUT error " + putR.status, 502);
      return json({ ok: true });
    }

    // ── SELLA REGOLE ─────────────────────────────────────────────────────────
    if (path === "/api/sella-regole" && method === "GET") {
      const raw = await env.ICOMPTA_KV.get("icompta:sella_regole");
      return json(raw ? JSON.parse(raw) : {});
    }

    // ── RICORRENZE GET ───────────────────────────────────────────────────────
    // ── IMPORT LOG GET (log generici: Leo, ecc.) ─────────────────────────────
    if (path === "/api/import-log" && method === "GET") {
      const key = url.searchParams.get("key");
      if (!key || !key.startsWith("icompta:")) return err("Key non valida");
      const raw = await env.ICOMPTA_KV.get(key);
      return json(raw ? JSON.parse(raw) : []);
    }

    if (path === "/api/ricorrenze" && method === "GET") {
      const raw = await env.ICOMPTA_KV.get("icompta:ricorrenze");
      return json(raw ? JSON.parse(raw) : []);
    }

    // ── RICORRENZE PUT (salva lista completa) ────────────────────────────────
    if (path === "/api/ricorrenze" && method === "PUT") {
      const body = await request.json();
      const { ricorrenze } = body;
      if (!Array.isArray(ricorrenze)) return err("ricorrenze deve essere array");
      await env.ICOMPTA_KV.put("icompta:ricorrenze", JSON.stringify(ricorrenze));
      return json({ ok: true });
    }

    return err("Endpoint non trovato", 404);
  }
};
export { icompta_worker_default as default };
