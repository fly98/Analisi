import * as XLSX from "xlsx";
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

// ── FINECO AUTO (replica server-side del pulsante "Aggiorna Fineco investimenti") ──
// Scarica l'XLS dal server Playwright sul Mac, lo parsa, salva titoli + snapshot.
async function runFinecoAuto(env) {
  const r = await fetch("http://fly98.duckdns.org:3456/fineco-portafoglio", { signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error("Mac/Playwright HTTP " + r.status);
  const buf = await r.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  // Header con ISIN + mappa colonne (identico a _importaRigheFineco lato app)
  let hi = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i] && rows[i].some(c => c && String(c).trim() === "ISIN")) { hi = i; break; }
  }
  if (hi < 0) throw new Error("Formato non riconosciuto (colonna ISIN assente)");
  const h = rows[hi].map(c => c ? String(c).trim() : "");
  const C = {
    nome: h.indexOf("Titolo"), isin: h.indexOf("ISIN"), tipo: h.indexOf("Strumento"),
    vc: h.findIndex(x => x === "Valore di carico"),
    vm: h.findIndex(x => x === "Valore di mercato €")
  };
  const strumenti = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[C.isin] || String(row[C.isin]).trim().length < 5) continue;
    const vc = C.vc >= 0 && row[C.vc] != null ? parseFloat(row[C.vc]) || 0 : 0;
    const vm = C.vm >= 0 && row[C.vm] != null ? parseFloat(row[C.vm]) || 0 : 0;
    if (vc === 0 && vm === 0) continue;
    strumenti.push({
      nome: C.nome >= 0 && row[C.nome] ? String(row[C.nome]).trim() : String(row[C.isin]).trim(),
      isin: String(row[C.isin]).trim(),
      tipo: C.tipo >= 0 && row[C.tipo] ? String(row[C.tipo]).trim() : "—",
      vc, vm
    });
  }
  if (strumenti.length === 0) throw new Error("Nessuno strumento trovato nel file");
  // Salva titoli (stessa chiave del pulsante)
  await env.ICOMPTA_KV.put("icompta:fineco-inv:strumenti", JSON.stringify(strumenti));
  await env.ICOMPTA_KV.put("icompta:fineco-inv:last-update", JSON.stringify({ at: new Date().toISOString(), src: "auto" }));
  // Snapshot giornaliero (identico a trySnapshot: sovrascrive stessa data)
  let vmTot = strumenti.reduce((s, x) => s + (x.vm || 0), 0);
  vmTot = Math.round(vmTot * 100) / 100;
  let snapshot = null;
  if (vmTot > 0) {
    const today = new Date().toISOString().slice(0, 10);
    const breakdown = {};
    for (const s of strumenti) {
      let k = s.ticker || s.nome;
      if (k) k = String(k).replace(/\..*$/, "");
      if (k) breakdown[k] = s.vm || 0;
    }
    snapshot = { date: today, totale: vmTot, breakdown };
    await env.ICOMPTA_KV.put("icompta:snapshot:" + today, JSON.stringify(snapshot));
  }
  // Restituisce anche i dati: chi chiama non deve rileggere la KV appena scritta
  // (le letture KV sono eventually consistent, cache fino a 60s).
  return { count: strumenti.length, strumenti, vmTot, snapshot };
}
__name(runFinecoAuto, "runFinecoAuto");

// ── NOTIFICA TELEGRAM (report chiusura borsa) ─────────────────────────────────
const TG_WORKER = "https://tg-worker.f-castiglioni.workers.dev/send";

function eur(n) {
  return (n || 0).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}
function eurSign(n) {
  return (n >= 0 ? "+" : "−") + eur(Math.abs(n));
}
function pctSign(n) {
  return (n >= 0 ? "+" : "−") + Math.abs(n).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%";
}

// Snapshot più recente con data anteriore a `today`
async function prevSnapshot(env, today) {
  const list = await env.ICOMPTA_KV.list({ prefix: "icompta:snapshot:" });
  const dates = list.keys
    .map(k => k.name.replace("icompta:snapshot:", ""))
    .filter(d => d < today)
    .sort();
  if (!dates.length) return null;
  const raw = await env.ICOMPTA_KV.get("icompta:snapshot:" + dates[dates.length - 1]);
  return raw ? JSON.parse(raw) : null;
}

async function sendTelegram(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN) { console.log("TELEGRAM_BOT_TOKEN assente, notifica saltata"); return false; }
  const r = await fetch(TG_WORKER, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Auth": env.TELEGRAM_BOT_TOKEN },
    body: JSON.stringify({ text, parse_mode: "Markdown" })
  });
  return r.ok;
}

// Costruisce il messaggio di chiusura confrontando snapshot di oggi vs precedente
function buildReport(snapshot, prev, strumenti) {
  const d = new Date(snapshot.date + "T12:00:00Z").toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
  const L = [];

  if (!prev) {
    L.push(`📊 *Fineco — chiusura ${d}*`);
    L.push("");
    L.push(`Portafoglio: *${eur(snapshot.totale)}*`);
    L.push("_(primo snapshot: nessun giorno precedente da confrontare)_");
    return L.join("\n");
  }

  const delta = snapshot.totale - prev.totale;
  const pct = prev.totale ? (delta / prev.totale) * 100 : 0;
  const flat = Math.abs(delta) < 0.01;
  const icon = flat ? "😐" : (delta >= 0 ? "📈" : "📉");

  L.push(`${icon} *Fineco — chiusura ${d}*`);
  L.push("");
  if (flat) {
    L.push("Nessuna variazione — _borsa probabilmente chiusa._");
  } else {
    L.push(`Oggi: *${eurSign(delta)}*  (${pctSign(pct)})`);
  }
  L.push(`Portafoglio: *${eur(snapshot.totale)}*`);

  // Utile/perdita latente complessivo (valore di mercato vs valore di carico)
  if (Array.isArray(strumenti) && strumenti.length) {
    const vcTot = strumenti.reduce((s, x) => s + (x.vc || 0), 0);
    if (vcTot > 0) {
      const pl = snapshot.totale - vcTot;
      L.push(`Utile latente: *${eurSign(pl)}*  (${pctSign((pl / vcTot) * 100)})`);
    }
  }

  // Top 3 movimenti del giorno
  if (!flat && prev.breakdown && snapshot.breakdown) {
    const movers = Object.keys(snapshot.breakdown)
      .filter(k => prev.breakdown[k] != null)
      .map(k => ({ k, v: snapshot.breakdown[k] - prev.breakdown[k] }))
      .filter(m => Math.abs(m.v) >= 0.5)
      .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
      .slice(0, 3);
    if (movers.length) {
      L.push("");
      for (const m of movers) {
        const name = m.k.length > 26 ? m.k.slice(0, 25) + "…" : m.k;
        L.push(`${m.v >= 0 ? "🟢" : "🔴"} ${name}  ${eurSign(m.v)}`);
      }
    }
  }
  return L.join("\n");
}
__name(buildReport, "buildReport");

var icompta_worker_default = {
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      const today = new Date().toISOString().slice(0, 10);
      const flagKey = "icompta:tg-notified:" + today;
      try {
        const res = await runFinecoAuto(env);
        await env.ICOMPTA_KV.put("icompta:fineco-inv:last-auto", JSON.stringify({ at: new Date().toISOString(), ok: true, count: res.count }));
        console.log("Fineco auto OK:", res.count, "strumenti");

        // Notifica Telegram: una sola volta al giorno, al primo run riuscito.
        // (i due cron 16/17 UTC coprono ora legale e solare ma partono entrambi)
        const already = await env.ICOMPTA_KV.get(flagKey);
        if (!already && res.snapshot) {
          const prev = await prevSnapshot(env, res.snapshot.date);
          const ok = await sendTelegram(env, buildReport(res.snapshot, prev, res.strumenti));
          if (ok) await env.ICOMPTA_KV.put(flagKey, "1", { expirationTtl: 172800 });
        }
      } catch (e) {
        const msg = String((e && e.message) || e);
        await env.ICOMPTA_KV.put("icompta:fineco-inv:last-auto", JSON.stringify({ at: new Date().toISOString(), ok: false, error: msg }));
        console.error("Fineco auto FAIL:", msg);

        // Avvisa solo al secondo fallimento della giornata: se il Mac non risponde
        // alle 18 ma risponde alle 19, non ha senso allarmare.
        const already = await env.ICOMPTA_KV.get(flagKey);
        if (!already) {
          const failKey = "icompta:tg-fail:" + today;
          const fails = parseInt((await env.ICOMPTA_KV.get(failKey)) || "0", 10) + 1;
          await env.ICOMPTA_KV.put(failKey, String(fails), { expirationTtl: 172800 });
          if (fails >= 2) {
            await sendTelegram(env, `⚠️ *Fineco — aggiornamento fallito*\n\nDue tentativi a vuoto oggi.\nUltimo errore: \`${msg}\`\n\n_Controlla che il Mac e il server Playwright siano accesi._`);
            await env.ICOMPTA_KV.put(flagKey, "1", { expirationTtl: 172800 });
          }
        }
      }
    })());
  },
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
      const { accounts, groups, categories } = body;
      if (!accounts || !groups) return err("accounts e groups richiesti");
      const raw = await env.ICOMPTA_KV.get("icompta:meta");
      if (!raw) return err("Meta non trovato", 404);
      const meta = JSON.parse(raw);
      meta.accounts = accounts;
      meta.groups = groups;
      if (categories) meta.categories = categories;
      await env.ICOMPTA_KV.put("icompta:meta", JSON.stringify(meta));
      return json({ ok: true });
    }

    // ── CATEGORIES MERGE ─────────────────────────────────────────────────────
    // POST /api/categories/merge { fromId, toId } → sposta TX fromId→toId
    if (path === "/api/categories/merge" && method === "POST") {
      const { fromId, toId } = await request.json();
      if (!fromId || !toId) return err("fromId e toId richiesti");
      const metaRaw = await env.ICOMPTA_KV.get("icompta:meta");
      if (!metaRaw) return err("Meta non trovato", 404);
      const meta = JSON.parse(metaRaw);
      let updated = 0;
      for (const year of meta.years) {
        const txs = await getTxYear(env, year);
        let changed = false;
        for (const tx of txs) {
          if (tx.splits) {
            for (const s of tx.splits) {
              if (s.categoryId === fromId) { s.categoryId = toId; changed = true; updated++; }
            }
          } else if (tx.categoryId === fromId) {
            tx.categoryId = toId; changed = true; updated++;
          }
        }
        if (changed) await putTxYear(env, year, txs);
      }
      // Rimuovi categoria fromId dal meta
      meta.categories = meta.categories.filter(c => c.id !== fromId);
      await env.ICOMPTA_KV.put("icompta:meta", JSON.stringify(meta));
      return json({ ok: true, updated });
    }

    // ── CATEGORIES COUNT ─────────────────────────────────────────────────────
    // GET /api/categories/count → conta TX per categoria
    if (path === "/api/categories/count" && method === "GET") {
      const metaRaw = await env.ICOMPTA_KV.get("icompta:meta");
      if (!metaRaw) return err("Meta non trovato", 404);
      const meta = JSON.parse(metaRaw);
      const counts = {};
      for (const year of meta.years) {
        const txs = await getTxYear(env, year);
        for (const tx of txs) {
          if (tx.splits) {
            for (const s of tx.splits) {
              if (s.categoryId) counts[s.categoryId] = (counts[s.categoryId]||0) + 1;
            }
          } else if (tx.categoryId) {
            counts[tx.categoryId] = (counts[tx.categoryId]||0) + 1;
          }
        }
      }
      return json(counts);
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

    // ── FINECO STATUS (ultima riga di avanzamento della procedura Mac) ────────
    if (path === "/api/fineco-status" && method === "GET") {
      const raw = await env.ICOMPTA_KV.get("icompta:fineco:status");
      return json(raw ? JSON.parse(raw) : { step: "", stato: "idle", ts: 0 });
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

    // ── SELLA REGOLE GET (merge: base GitHub + apprese KV) ───────────────────
    if (path === "/api/sella-regole" && method === "GET") {
      let ghRegole = {};
      const ghPAT = env.GITHUB_PAT;
      if (ghPAT) {
        try {
          const r = await fetch("https://api.github.com/repos/fly98/Analisi/contents/sella_regole.json", {
            headers: { Authorization: `Bearer ${ghPAT}`, Accept: "application/vnd.github.v3+json", "User-Agent": "icompta-worker" }
          });
          if (r.ok) {
            const d = await r.json();
            try { ghRegole = JSON.parse(atob(d.content.replace(/\n/g, ""))) || {}; } catch(e) {}
          }
        } catch(e) {}
      }
      let kvRegole = {};
      try {
        const kvRaw = await env.ICOMPTA_KV.get("icompta:sella_regole");
        if (kvRaw) kvRegole = JSON.parse(kvRaw) || {};
      } catch(e) {}
      return json({ ...ghRegole, ...kvRegole });
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
        headers: { Authorization: `Bearer ${ghPAT}`, Accept: "application/vnd.github.v3+json", "User-Agent": "icompta-worker" }
      });
      let sha = null;
      if (getR.ok) { const gd = await getR.json(); sha = gd.sha; }
      const content = btoa(unescape(encodeURIComponent(JSON.stringify(regole, null, 2))));
      const putBody = { message: "iCompta: aggiorna sella_regole.json", content };
      if (sha) putBody.sha = sha;
      const putR = await fetch("https://api.github.com/repos/fly98/Analisi/contents/sella_regole.json", {
        method: "PUT",
        headers: { Authorization: `Bearer ${ghPAT}`, "Content-Type": "application/json", "User-Agent": "icompta-worker" },
        body: JSON.stringify(putBody)
      });
      if (!putR.ok) return err("GitHub PUT error " + putR.status, 502);
      return json({ ok: true });
    }

    // ── RICORRENZE GET ───────────────────────────────────────────────────────
    // ── IMPORT LOG GET (log generici: Leo, ecc.) ─────────────────────────────
    // ── AMEX AUTO: proxy verso Mac locale ────────────────────────────────────
    // NB: l'xlsx e' BINARIO -> si passa arrayBuffer(), non text()
    if (path === "/api/amex-auto" && method === "GET") {
      const MAC_URL = "http://fly98.duckdns.org:3456/amex-xlsx";
      try {
        const r = await fetch(MAC_URL, { signal: AbortSignal.timeout(180000) });
        if (!r.ok) return err("Mac error: " + r.status, 502);
        const buf = await r.arrayBuffer();
        const filename = r.headers.get("X-Filename") || "Amex_auto.xlsx";
        return new Response(buf, {
          headers: {
            ...CORS,
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Access-Control-Expose-Headers": "X-Filename",
            "X-Filename": filename
          }
        });
      } catch(e) {
        return err("Mac non raggiungibile: " + e.message, 502);
      }
    }

    // ── SELLA AUTO: proxy verso Mac locale ───────────────────────────────────
    if (path === "/api/sella-personale-auto" && method === "GET") {
      const MAC_URL = "http://fly98.duckdns.org:3456/sella-personale-csv";
      try {
        const r = await fetch(MAC_URL, { signal: AbortSignal.timeout(120000) });
        if (!r.ok) return err("Mac error: " + r.status, 502);
        const csv = await r.text();
        const filename = r.headers.get("X-Filename") || "SellaPersonale_auto.csv";
        return new Response(csv, {
          headers: { ...CORS, "Content-Type": "text/csv; charset=utf-8", "X-Filename": filename }
        });
      } catch(e) {
        return err("Mac non raggiungibile: " + e.message, 502);
      }
    }

    if (path === "/api/fineco-portafoglio-auto" && method === "GET") {
      const MAC_URL = "http://fly98.duckdns.org:3456/fineco-portafoglio";
      try {
        const r = await fetch(MAC_URL, { signal: AbortSignal.timeout(120000) });
        if (!r.ok) return err("Mac error: " + r.status, 502);
        const buf = await r.arrayBuffer();
        const filename = r.headers.get("X-Filename") || "Fineco_auto.xlsx";
        return new Response(buf, {
          headers: { ...CORS, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "X-Filename": filename }
        });
      } catch(e) { return err("Mac non raggiungibile: " + e.message, 502); }
    }

    // ── FINECO AUTO ORA (test manuale dello stesso flusso del cron) ───────────
    if (path === "/api/fineco-auto-now" && method === "GET") {
      try {
        const res = await runFinecoAuto(env);
        await env.ICOMPTA_KV.put("icompta:fineco-inv:last-auto", JSON.stringify({ at: new Date().toISOString(), ok: true, count: res.count, manual: true }));
        return json({ ok: true, count: res.count });
      } catch(e) {
        await env.ICOMPTA_KV.put("icompta:fineco-inv:last-auto", JSON.stringify({ at: new Date().toISOString(), ok: false, error: String((e && e.message) || e), manual: true }));
        return err("Fineco auto fallito: " + ((e && e.message) || e), 502);
      }
    }

    // ── TEST REPORT TELEGRAM (usa gli snapshot già in KV, non tocca il Mac) ────
    if (path === "/api/tg-report-now" && method === "GET") {
      const list = await env.ICOMPTA_KV.list({ prefix: "icompta:snapshot:" });
      const dates = list.keys.map(k => k.name.replace("icompta:snapshot:", "")).sort();
      if (!dates.length) return err("Nessuno snapshot in KV", 404);
      const last = JSON.parse(await env.ICOMPTA_KV.get("icompta:snapshot:" + dates[dates.length - 1]));
      const prev = await prevSnapshot(env, last.date);
      const strumenti = JSON.parse((await env.ICOMPTA_KV.get("icompta:fineco-inv:strumenti")) || "[]");
      const text = buildReport(last, prev, strumenti);
      const sent = await sendTelegram(env, text);
      return json({ sent, date: last.date, prev_date: prev ? prev.date : null, preview: text });
    }

    if (path === "/api/fineco-conto-auto" && method === "GET") {
      const MAC_URL = "http://fly98.duckdns.org:3456/fineco-conto";
      try {
        const r = await fetch(MAC_URL, { signal: AbortSignal.timeout(120000) });
        if (!r.ok) return err("Mac error: " + r.status, 502);
        const buf = await r.arrayBuffer();
        const filename = r.headers.get("X-Filename") || "FinecoConto_auto.xlsx";
        return new Response(buf, {
          headers: { ...CORS, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "X-Filename": filename }
        });
      } catch(e) { return err("Mac non raggiungibile: " + e.message, 502); }
    }

    if (path === "/api/sella-auto" && method === "GET") {
      const MAC_URL = "http://fly98.duckdns.org:3456/sella-csv";
      try {
        const r = await fetch(MAC_URL, { signal: AbortSignal.timeout(120000) });
        if (!r.ok) return err("Mac error: " + r.status, 502);
        const csv = await r.text();
        const filename = r.headers.get("X-Filename") || "Sella_auto.csv";
        return new Response(csv, {
          headers: { ...CORS, "Content-Type": "text/csv; charset=utf-8", "X-Filename": filename }
        });
      } catch(e) {
        return err("Mac non raggiungibile: " + e.message, 502);
      }
    }

    // ── BACKUP ────────────────────────────────────────────────────────────────
    // GET  /api/backup/list        → lista backup esistenti
    // POST /api/backup/create      → crea backup anno corrente
    // POST /api/backup/restore     → ripristina backup { key }
    // DELETE /api/backup/delete    → elimina backup { key }

    if (path === "/api/backup/list" && method === "GET") {
      const list = await env.ICOMPTA_KV.list({ prefix: "backup:" });
      const backups = await Promise.all(list.keys.map(async k => {
        const raw = await env.ICOMPTA_KV.get(k.name);
        if (!raw) return null;
        const d = JSON.parse(raw);
        return { key: k.name, date: d.date, year: d.year, txCount: d.txCount, metaSize: d.metaSize, auto: d.auto || k.name.startsWith("backup:auto:"), preRestore: d.preRestore || false };
      }));
      return json(backups.filter(Boolean).sort((a,b) => b.date.localeCompare(a.date)));
    }

    if (path === "/api/backup/create" && method === "POST") {
      const isAuto = url.searchParams.get("auto") === "1";
      const now = new Date();
      const year = now.getFullYear();
      const iso = now.toISOString();
      const dateStr = iso.slice(0,16).replace('T',' ');
      const stamp = isAuto ? iso.slice(0,19) : (iso.slice(0,10) + 'T' + iso.slice(11,16));
      const key = (isAuto ? "backup:auto:" : "backup:") + `${stamp}:${year}`;
      const metaRaw = await env.ICOMPTA_KV.get(`icompta:meta`);
      const txRaw   = await env.ICOMPTA_KV.get(`icompta:tx:${year}`);
      const txData  = txRaw ? JSON.parse(txRaw) : [];
      const payload = JSON.stringify({
        date: dateStr, year, txCount: txData.length,
        metaSize: metaRaw ? metaRaw.length : 0,
        auto: isAuto,
        meta: metaRaw, tx: txRaw
      });
      await env.ICOMPTA_KV.put(key, payload);
      // Retention: conserva solo gli auto-backup degli ultimi 7 giorni (i manuali restano)
      let pruned = 0;
      if (isAuto) {
        try {
          const cutoff = new Date(now.getTime() - 7 * 864e5).toISOString().slice(0,10);
          const lst = await env.ICOMPTA_KV.list({ prefix: "backup:auto:" });
          for (const k of lst.keys) {
            const m = k.name.match(/^backup:auto:(\d{4}-\d{2}-\d{2})/);
            if (m && m[1] < cutoff) { await env.ICOMPTA_KV.delete(k.name); pruned++; }
          }
        } catch(e) {}
      }
      return json({ ok: true, key, txCount: txData.length, date: dateStr, auto: isAuto, pruned });
    }

    if (path === "/api/backup/restore" && method === "POST") {
      const body = await request.json();
      const raw = await env.ICOMPTA_KV.get(body.key);
      if (!raw) return err("Backup non trovato", 404);
      const d = JSON.parse(raw);
      // Sicurezza: salva lo stato ATTUALE prima di sovrascrivere (ripristino annullabile)
      try {
        const now = new Date();
        const yr = d.year;
        const curMeta = await env.ICOMPTA_KV.get("icompta:meta");
        const curTx   = await env.ICOMPTA_KV.get(`icompta:tx:${yr}`);
        const curTxData = curTx ? JSON.parse(curTx) : [];
        const safeKey = "backup:auto:" + now.toISOString().slice(0,19) + ":" + yr;
        await env.ICOMPTA_KV.put(safeKey, JSON.stringify({
          date: now.toISOString().slice(0,16).replace('T',' '), year: yr,
          txCount: curTxData.length, metaSize: curMeta ? curMeta.length : 0,
          auto: true, preRestore: true, meta: curMeta, tx: curTx
        }));
      } catch(e) {}
      if (d.meta) await env.ICOMPTA_KV.put("icompta:meta", d.meta);
      if (d.tx)   await env.ICOMPTA_KV.put(`icompta:tx:${d.year}`, d.tx);
      return json({ ok: true, year: d.year, txCount: d.txCount });
    }

    if (path === "/api/backup/delete" && method === "DELETE") {
      const body = await request.json();
      if (!body.key || !body.key.startsWith("backup:")) return err("Key non valida");
      await env.ICOMPTA_KV.delete(body.key);
      return json({ ok: true });
    }

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

    // ── CONTI TITOLI ─────────────────────────────────────────────────────────
    // Struttura KV separata, non tocca meta/accounts/groups esistenti
    // icompta:investimenti:carico      → { valore: number }
    // icompta:conti_titoli:meta        → { conti: [{id, nome, tipo}] }
    // icompta:fineco:strumenti         → [{id, nome, isin, tipo, quantita, pmc, prezzoAttuale, fontePrezzo, tassazione, cedolaLorda, valoreScadenza, scadenza}]
    // icompta:fineco:cc:saldo          → { saldo: number, aggiornato: string }

    // POST /api/parse-xls-fineco — riceve file XLS in base64, restituisce righe JSON
    if (path === "/api/parse-xls-fineco" && method === "POST") {
      try {
        const body = await request.json();
        if (!body.base64) return err("base64 richiesto");
        const b64 = body.base64;
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const wb = XLSX.read(bytes, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
        return json({ ok: true, rows: rows });
      } catch(e) {
        return err("Errore parsing XLS: " + e.message);
      }
    }

    // GET /api/titoli/carico — legge valore di carico investimenti
    if (path === "/api/titoli/carico" && method === "GET") {
      const raw = await env.ICOMPTA_KV.get("icompta:investimenti:carico");
      return json(raw ? JSON.parse(raw) : { valore: 0 });
    }

    // PUT /api/titoli/carico — salva valore di carico investimenti
    if (path === "/api/titoli/carico" && method === "PUT") {
      const body = await request.json();
      if (body.valore == null) return err("valore richiesto");
      await env.ICOMPTA_KV.put("icompta:investimenti:carico", JSON.stringify({ valore: Number(body.valore) }));
      return json({ ok: true });
    }

    // GET /api/titoli/strumenti/:contoId — legge strumenti di un conto
    if (path.match(/^\/api\/titoli\/strumenti\/(.+)$/) && method === "GET") {
      const contoId = path.match(/^\/api\/titoli\/strumenti\/(.+)$/)[1];
      const raw = await env.ICOMPTA_KV.get(`icompta:${contoId}:strumenti`);
      return json(raw ? JSON.parse(raw) : []);
    }

    // PUT /api/titoli/strumenti/:contoId — salva lista strumenti
    if (path.match(/^\/api\/titoli\/strumenti\/(.+)$/) && method === "PUT") {
      const contoId = path.match(/^\/api\/titoli\/strumenti\/(.+)$/)[1];
      const body = await request.json();
      if (!Array.isArray(body.strumenti)) return err("strumenti deve essere array");
      await env.ICOMPTA_KV.put(`icompta:${contoId}:strumenti`, JSON.stringify(body.strumenti));
      if (contoId === "fineco-inv") {
        await env.ICOMPTA_KV.put("icompta:fineco-inv:last-update", JSON.stringify({ at: new Date().toISOString(), src: "app" }));
      }
      return json({ ok: true });
    }

    // GET /api/titoli/cc/:contoId — legge saldo conto corrente broker
    if (path.match(/^\/api\/titoli\/cc\/(.+)$/) && method === "GET") {
      const contoId = path.match(/^\/api\/titoli\/cc\/(.+)$/)[1];
      const raw = await env.ICOMPTA_KV.get(`icompta:${contoId}:cc`);
      return json(raw ? JSON.parse(raw) : { saldo: 0, aggiornato: null });
    }

    // PUT /api/titoli/cc/:contoId — salva saldo conto corrente broker
    if (path.match(/^\/api\/titoli\/cc\/(.+)$/) && method === "PUT") {
      const contoId = path.match(/^\/api\/titoli\/cc\/(.+)$/)[1];
      const body = await request.json();
      if (body.saldo == null) return err("saldo richiesto");
      await env.ICOMPTA_KV.put(`icompta:${contoId}:cc`, JSON.stringify({
        saldo: Number(body.saldo),
        aggiornato: new Date().toISOString().slice(0, 10)
      }));
      return json({ ok: true });
    }

    // GET /api/titoli/meta — legge configurazione conti titoli
    if (path === "/api/titoli/meta" && method === "GET") {
      const raw = await env.ICOMPTA_KV.get("icompta:conti_titoli:meta");
      return json(raw ? JSON.parse(raw) : { conti: [] });
    }

    // PUT /api/titoli/meta — salva configurazione conti titoli
    if (path === "/api/titoli/meta" && method === "PUT") {
      const body = await request.json();
      if (!body.conti) return err("conti richiesto");
      await env.ICOMPTA_KV.put("icompta:conti_titoli:meta", JSON.stringify({ conti: body.conti }));
      return json({ ok: true });
    }

    // GET /api/titoli/prezzi/:contoId — aggiorna prezzi di mercato via Yahoo/Borsa Italiana
    if (path.match(/^\/api\/titoli\/prezzi\/(.+)$/) && method === "GET") {
      const contoId = path.match(/^\/api\/titoli\/prezzi\/(.+)$/)[1];
      const raw = await env.ICOMPTA_KV.get(`icompta:${contoId}:strumenti`);
      if (!raw) return json({ ok: true, aggiornati: 0 });
      const strumenti = JSON.parse(raw);
      let aggiornati = 0;
      for (const s of strumenti) {
        if (!s.fontePrezzo || s.fontePrezzo === "manuale") continue;
        try {
          const [tipo, codice] = s.fontePrezzo.split(":");
          let prezzo = null;
          if (tipo === "yahoo") {
            const r = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(codice), { headers: { "User-Agent": "Mozilla/5.0" } });
            const d = await r.json();
            prezzo = d?.chart?.result?.[0]?.meta?.regularMarketPrice;
          } else if (tipo === "borsa") {
            const r = await fetch("https://www.borsaitaliana.it/borsa/obbligazioni/mot/btp/scheda/" + codice + ".html?lang=it", { headers: { "User-Agent": "Mozilla/5.0" } });
            const html = await r.text();
            const m = html.match(/Prezzo di riferimento[\s\S]*?([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2})/i);
            if (m) prezzo = Number(m[1].replace(/\./g, "").replace(",", "."));
          } else if (tipo === "eurotlx") {
            const r = await fetch("https://www.borsaitaliana.it/borsa/obbligazioni/eurotlx/scheda/" + codice + "-ETLX.html?lang=it", { headers: { "User-Agent": "Mozilla/5.0" } });
            const html = await r.text();
            const m = html.match(/Prezzo di riferimento[\s\S]*?([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2})/i);
            if (m) prezzo = Number(m[1].replace(/\./g, "").replace(",", "."));
          } else if (tipo === "sedex") {
            const r = await fetch("https://www.borsaitaliana.it/borsa/cw-e-certificates/scheda/" + codice + "-SEDX.html?lang=it", { headers: { "User-Agent": "Mozilla/5.0" } });
            const html = await r.text();
            const m = html.match(/Prezzo di riferimento[\s\S]*?([0-9]{1,4}(?:\.[0-9]{3})*,[0-9]{2})/i);
            if (m) prezzo = Number(m[1].replace(/\./g, "").replace(",", "."));
          }
          if (prezzo && prezzo > 0) { s.prezzoAttuale = Number(prezzo); aggiornati++; }
        } catch(e) { /* ignora errori singolo strumento */ }
      }
      await env.ICOMPTA_KV.put(`icompta:${contoId}:strumenti`, JSON.stringify(strumenti));
      return json({ ok: true, aggiornati, totale: strumenti.length });
    }

    // --- Snapshot portafoglio giornaliero ---
    if (path === '/api/snapshot' && method === 'GET') {
      const list = await env.ICOMPTA_KV.list({ prefix: 'icompta:snapshot:' });
      const snapshots = [];
      for (const k of list.keys) {
        const raw = await env.ICOMPTA_KV.get(k.name);
        if (raw) snapshots.push(JSON.parse(raw));
      }
      snapshots.sort((a,b) => a.date.localeCompare(b.date));
      return json(snapshots);
    }
    if (path === '/api/snapshot' && method === 'PUT') {
      const body = await request.json();
      if (!body.date || body.totale == null) return err('date e totale richiesti');
      const key = 'icompta:snapshot:' + body.date;
      await env.ICOMPTA_KV.put(key, JSON.stringify(body));
      return json({ ok: true, key });
    }
    if (path === '/api/snapshot/last' && method === 'GET') {
      const list = await env.ICOMPTA_KV.list({ prefix: 'icompta:snapshot:' });
      if (!list.keys.length) return json(null);
      list.keys.sort((a,b) => b.name.localeCompare(a.name));
      const raw = await env.ICOMPTA_KV.get(list.keys[0].name);
      return json(raw ? JSON.parse(raw) : null);
    }

    // ── Enable Banking ──────────────────────────────────────
    async function makeEBJwt(env) {
      const appId = env.ENABLE_BANKING_APP_ID;
      const pemKey = env.ENABLE_BANKING_PRIVATE_KEY;
      if (!appId || !pemKey) throw new Error('ENABLE_BANKING_APP_ID o ENABLE_BANKING_PRIVATE_KEY mancanti');
      const pemBody = pemKey.split('\n').filter(l => !l.includes('-----')).join('');
      const der = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));
      const key = await crypto.subtle.importKey(
        'pkcs8', der.buffer,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false, ['sign']
      );
      const now = Math.floor(Date.now() / 1000);
      const b64url = s => btoa(s).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
      const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: appId }));
      const payload = b64url(JSON.stringify({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp: now + 3600 }));
      const sigInput = new TextEncoder().encode(header + '.' + payload);
      const sigBuf = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, sigInput);
      const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuf))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
      return header + '.' + payload + '.' + sig;
    }

    if (path === '/api/enable-banking/auth' && method === 'GET') {
      try {
        const bank = url.searchParams.get('bank') || 'Banca Sella';
        const psuType = url.searchParams.get('psu_type') || 'personal';
        const jwt = await makeEBJwt(env);
        const validUntil = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString();
        const state = crypto.randomUUID();
        await env.ICOMPTA_KV.put('icompta:eb:state:' + state, JSON.stringify({ bank, psuType, ts: Date.now() }), { expirationTtl: 600 });
        const authBody = {
          access: { valid_until: validUntil, balances: true, transactions: true },
          aspsp: { name: bank, country: 'IT' },
          state,
          redirect_url: 'https://fly98.github.io/Analisi/enable-banking-callback.html',
          psu_type: psuType
        };
        const resp = await fetch('https://api.enablebanking.com/auth', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + jwt, 'Content-Type': 'application/json' },
          body: JSON.stringify(authBody)
        });
        const data = await resp.json();
        if (!resp.ok) return err('EB auth error: ' + JSON.stringify(data), resp.status);
        return json({ ok: true, url: data.url, state });
      } catch(e) {
        return err('Errore auth EB: ' + e.message, 500);
      }
    }

    if (path === '/api/enable-banking/session' && method === 'POST') {
      try {
        const body = await request.json();
        const { code, state } = body;
        if (!code) return err('code mancante');
        const jwt = await makeEBJwt(env);
        const resp = await fetch('https://api.enablebanking.com/sessions', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + jwt, 'Content-Type': 'application/json' },
          body: JSON.stringify({ code })
        });
        const data = await resp.json();
        if (!resp.ok) return err('EB session error: ' + JSON.stringify(data), resp.status);
        const stateRaw = await env.ICOMPTA_KV.get('icompta:eb:state:' + state);
        const sd = stateRaw ? JSON.parse(stateRaw) : {};
        const sessionKey = 'icompta:eb:session:' + (sd.bank || data.aspsp && data.aspsp.name || 'unknown').replace(/\s+/g, '-') + ':' + (sd.psuType || data.psu_type || 'personal');
        const sessionData = {
          session_id: data.session_id,
          accounts: data.accounts,
          aspsp: data.aspsp,
          psu_type: data.psu_type,
          valid_until: data.access && data.access.valid_until,
          created: new Date().toISOString()
        };
        await env.ICOMPTA_KV.put(sessionKey, JSON.stringify(sessionData));
        return json({ ok: true, session_id: data.session_id, accounts: data.accounts, aspsp: data.aspsp });
      } catch(e) {
        return err('Errore sessione EB: ' + e.message, 500);
      }
    }

    if (path === '/api/enable-banking/sessions' && method === 'GET') {
      try {
        const list = await env.ICOMPTA_KV.list({ prefix: 'icompta:eb:session:' });
        const sessions = [];
        for (const k of list.keys) {
          const raw = await env.ICOMPTA_KV.get(k.name);
          if (raw) sessions.push({ key: k.name, ...JSON.parse(raw) });
        }
        return json(sessions);
      } catch(e) {
        return err('Errore sessioni EB: ' + e.message, 500);
      }
    }

    if (path === '/api/enable-banking/transactions' && method === 'GET') {
      try {
        const sessionKey = url.searchParams.get('session_key');
        const accountId = url.searchParams.get('account_id');
        const dateFrom = url.searchParams.get('date_from') || new Date(Date.now() - 30*24*3600*1000).toISOString().slice(0,10);
        if (!sessionKey || !accountId) return err('session_key e account_id richiesti');
        const raw = await env.ICOMPTA_KV.get(sessionKey);
        if (!raw) return err('Sessione non trovata', 404);
        const jwt = await makeEBJwt(env);
        const txUrl = 'https://api.enablebanking.com/accounts/' + accountId + '/transactions?date_from=' + dateFrom;
        const resp = await fetch(txUrl, { headers: { 'Authorization': 'Bearer ' + jwt } });
        const data = await resp.json();
        if (!resp.ok) return err('EB transactions error: ' + JSON.stringify(data), resp.status);
        return json({ ok: true, transactions: data.transactions || [], continuation_key: data.continuation_key });
      } catch(e) {
        return err('Errore transazioni EB: ' + e.message, 500);
      }
    }

    return err("Endpoint non trovato", 404);
  }
};
export { icompta_worker_default as default };
