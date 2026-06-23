/**
 * iCompta Worker — Cloudflare Worker
 * KV namespace: ICOMPTA_KV (binding)
 * 
 * Endpoints:
 *   GET  /api/meta           → accounts, categories, years
 *   GET  /api/tx/:year       → transactions for year
 *   POST /api/tx             → add/update transaction
 *   DELETE /api/tx/:id       → delete transaction
 *   GET  /api/balance        → saldi calcolati per conto
 *   POST /api/import         → bulk import (admin)
 *   GET  /api/export/ofx     → export OFX per iCompta
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });

const err = (msg, status = 400) => json({ error: msg }, status);

// Auth: token semplice
function checkAuth(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  return token === env.ICOMPTA_TOKEN;
}

// Genera ID univoco
function genId() {
  return crypto.randomUUID().toUpperCase();
}

// Leggi TX di un anno dal KV
async function getTxYear(env, year) {
  const raw = await env.ICOMPTA_KV.get(`icompta:tx:${year}`);
  return raw ? JSON.parse(raw) : [];
}

// Scrivi TX di un anno nel KV
async function putTxYear(env, year, txs) {
  await env.ICOMPTA_KV.put(`icompta:tx:${year}`, JSON.stringify(txs));
}

// Calcola saldi per conto (da tutte le TX caricate)
function calcBalances(txList, accounts) {
  const balances = {};
  for (const acc of accounts) balances[acc.id] = 0;

  for (const tx of txList) {
    if (!balances.hasOwnProperty(tx.accountId)) continue;
    if (tx.useSumOfSplits) {
      // importo = somma splits
      for (const s of tx.splits || []) {
        if (s.amount != null) balances[tx.accountId] += s.amount;
      }
    } else {
      if (tx.amount != null) balances[tx.accountId] += tx.amount;
    }
  }
  return balances;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') return new Response(null, { headers: CORS });

    // Auth check (tranne OPTIONS)
    if (!checkAuth(request, env)) return err('Unauthorized', 401);

    // ── GET /api/meta ──────────────────────────────────────────────
    if (path === '/api/meta' && method === 'GET') {
      const meta = await env.ICOMPTA_KV.get('icompta:meta');
      if (!meta) return err('Meta non trovato — importa prima il DB', 404);
      return json(JSON.parse(meta));
    }

    // ── GET /api/tx/:year ──────────────────────────────────────────
    const txYearMatch = path.match(/^\/api\/tx\/(\d{4})$/);
    if (txYearMatch && method === 'GET') {
      const year = txYearMatch[1];
      const txs = await getTxYear(env, year);
      return json(txs);
    }

    // ── GET /api/balance ───────────────────────────────────────────
    if (path === '/api/balance' && method === 'GET') {
      const metaRaw = await env.ICOMPTA_KV.get('icompta:meta');
      if (!metaRaw) return err('Meta mancante', 404);
      const meta = JSON.parse(metaRaw);

      // Carica tutti gli anni e calcola saldi cumulativi
      const balances = {};
      for (const acc of meta.accounts) balances[acc.id] = 0;

      for (const year of meta.years) {
        const txs = await getTxYear(env, year);
        for (const tx of txs) {
          if (!balances.hasOwnProperty(tx.accountId)) continue;
          const splits = tx.splits || [];
          if (tx.useSumOfSplits && splits.length > 0) {
            for (const s of splits) {
              if (s.amount != null) balances[tx.accountId] += s.amount;
            }
          } else if (tx.amount != null) {
            balances[tx.accountId] += tx.amount;
          }
        }
      }

      // Arrotonda a 2 decimali
      for (const k in balances) balances[k] = Math.round(balances[k] * 100) / 100;

      // Aggiungi saldi gruppo
      const groupBalances = {};
      for (const g of meta.groups) groupBalances[g.id] = 0;
      for (const acc of meta.accounts) {
        if (acc.groupId && groupBalances.hasOwnProperty(acc.groupId)) {
          groupBalances[acc.groupId] += balances[acc.id] || 0;
        }
      }

      return json({ accounts: balances, groups: groupBalances });
    }

    // ── POST /api/tx ───────────────────────────────────────────────
    if (path === '/api/tx' && method === 'POST') {
      const body = await request.json();
      const { tx } = body;
      if (!tx || !tx.date || !tx.accountId) return err('TX mancante o incompleta');

      const year = tx.date.substring(0, 4);
      const txs = await getTxYear(env, year);

      if (tx.id) {
        // Update
        const idx = txs.findIndex(t => t.id === tx.id);
        if (idx === -1) return err('TX non trovata', 404);
        txs[idx] = tx;
      } else {
        // Insert
        tx.id = genId();
        tx.status = tx.status || 'created';
        txs.push(tx);
      }

      // Ordina per data
      txs.sort((a, b) => a.date.localeCompare(b.date));
      await putTxYear(env, year, txs);

      // Se anno non è in meta.years, aggiungilo
      const metaRaw = await env.ICOMPTA_KV.get('icompta:meta');
      if (metaRaw) {
        const meta = JSON.parse(metaRaw);
        if (!meta.years.includes(year)) {
          meta.years.push(year);
          meta.years.sort();
          await env.ICOMPTA_KV.put('icompta:meta', JSON.stringify(meta));
        }
      }

      return json({ ok: true, id: tx.id });
    }

    // ── DELETE /api/tx/:id ─────────────────────────────────────────
    const delMatch = path.match(/^\/api\/tx\/([A-F0-9\-]{36})$/i);
    if (delMatch && method === 'DELETE') {
      const id = delMatch[1];
      // Cerca in tutti gli anni (potremmo avere hint nella query)
      const yearHint = url.searchParams.get('year');
      const yearsToCheck = yearHint ? [yearHint] : [];

      if (!yearHint) {
        const metaRaw = await env.ICOMPTA_KV.get('icompta:meta');
        if (metaRaw) {
          const meta = JSON.parse(metaRaw);
          yearsToCheck.push(...meta.years);
        }
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
      return err('TX non trovata', 404);
    }

    // ── POST /api/import ───────────────────────────────────────────
    if (path === '/api/import' && method === 'POST') {
      const body = await request.json();
      const { key, data } = body;
      if (!key || !data) return err('key e data richiesti');
      if (!key.startsWith('icompta:')) return err('Key non valida');

      await env.ICOMPTA_KV.put(key, typeof data === 'string' ? data : JSON.stringify(data));
      return json({ ok: true, key });
    }

    // ── GET /api/export/ofx ────────────────────────────────────────
    if (path === '/api/export/ofx' && method === 'GET') {
      const accountId = url.searchParams.get('accountId');
      const fromDate = url.searchParams.get('from') || '2024-01-01';
      const toDate = url.searchParams.get('to') || new Date().toISOString().slice(0,10);

      const metaRaw = await env.ICOMPTA_KV.get('icompta:meta');
      if (!metaRaw) return err('Meta mancante', 404);
      const meta = JSON.parse(metaRaw);
      const account = meta.accounts.find(a => a.id === accountId);
      if (!account) return err('Account non trovato', 404);

      const fromYear = parseInt(fromDate.slice(0,4));
      const toYear = parseInt(toDate.slice(0,4));
      const allTxs = [];

      for (let y = fromYear; y <= toYear; y++) {
        const txs = await getTxYear(env, String(y));
        allTxs.push(...txs.filter(t =>
          t.accountId === accountId &&
          t.date >= fromDate &&
          t.date <= toDate
        ));
      }

      // Genera OFX
      const ofxDate = d => d.replace(/-/g,'') + '000000';
      let stmtTrn = '';
      for (const tx of allTxs) {
        const amount = tx.useSumOfSplits
          ? (tx.splits || []).reduce((s, sp) => s + (sp.amount || 0), 0)
          : (tx.amount || 0);
        stmtTrn += `
<STMTTRN>
<TRNTYPE>${amount >= 0 ? 'CREDIT' : 'DEBIT'}</TRNTYPE>
<DTPOSTED>${ofxDate(tx.date)}</DTPOSTED>
<TRNAMT>${amount.toFixed(2)}</TRNAMT>
<FITID>${tx.id}</FITID>
<NAME>${(tx.name || '').replace(/&/g,'&amp;').replace(/</g,'&lt;')}</NAME>
<MEMO>${(tx.comment || '').replace(/&/g,'&amp;').replace(/</g,'&lt;')}</MEMO>
</STMTTRN>`;
      }

      const ofx = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:UTF-8
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>1</TRNUID>
<STMTRS>
<CURDEF>EUR</CURDEF>
<BANKACCTFROM>
<BANKID>ICOMPTA</BANKID>
<ACCTID>${account.number || accountId.slice(0,8)}</ACCTID>
<ACCTTYPE>CHECKING</ACCTTYPE>
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>${ofxDate(fromDate)}</DTSTART>
<DTEND>${ofxDate(toDate)}</DTEND>
${stmtTrn}
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;

      return new Response(ofx, {
        headers: {
          ...CORS,
          'Content-Type': 'application/x-ofx',
          'Content-Disposition': `attachment; filename="icompta_${account.name}_${fromDate}_${toDate}.ofx"`
        }
      });
    }

    return err('Endpoint non trovato', 404);
  }
};
