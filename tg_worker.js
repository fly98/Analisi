/**
 * tg-worker — Infrastruttura notifiche Telegram InternoUno
 *
 * Endpoint:
 *   POST /webhook   -> ricevuto da Telegram (autenticato con secret_token derivato dal bot token)
 *   GET  /notify    -> invia un messaggio di test con bottoni  (auth: ?key=<bot token>)
 *   POST /send      -> invia un messaggio generico {text, buttons:[{label,action}]}
 *   GET  /state     -> legge l'ultima scelta fatta + contatore
 *
 * KV usate:
 *   tg:chat_id      -> chat ID di Filippo (salvato al primo /start)
 *   tg:last_action  -> {choice, ts, count} ultima azione eseguita
 */

const TG = 'https://api.telegram.org/bot';

const K_CHAT = 'tg:chat_id';
const K_LAST = 'tg:last_action';

const JSON_H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

// ---------- utils ----------

async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Il secret_token del webhook è derivato dal bot token: nessun segreto extra da gestire.
async function webhookSecret(env) {
  return (await sha256hex(env.TELEGRAM_BOT_TOKEN)).slice(0, 32);
}

async function tg(env, method, payload) {
  const r = await fetch(`${TG}${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return r.json();
}

function nowRome() {
  return new Date().toLocaleString('it-IT', {
    timeZone: 'Europe/Rome',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), { status, headers: JSON_H });
}

// ---------- gestione update in arrivo da Telegram ----------

const AIUTO =
  '🤖 *Comandi disponibili*\n\n' +
  '`saldo` — aggiorna Fineco investimenti e manda utile/perdita del giorno\n' +
  '`arrivi` — riepilogo arrivi di domani\n' +
  '`aiuto` — questo messaggio';

// Esegue i comandi. Girata in background (ctx.waitUntil): l'aggiornamento
// Fineco passa dal Mac e può richiedere fino a 2 minuti, mentre Telegram
// pretende una risposta al webhook entro pochi secondi.
async function eseguiComando(cmd, chatId, env) {
  if (cmd === 'saldo') {
    if (!env.ICOMPTA || !env.ICOMPTA_TOKEN) {
      await tg(env, 'sendMessage', { chat_id: chatId, text: '⚠️ Collegamento a iCompta non configurato.' });
      return;
    }
    const H = { Authorization: 'Bearer ' + env.ICOMPTA_TOKEN };
    try {
      // 1. Scarica i dati aggiornati da Fineco (via Mac/Playwright)
      const r1 = await env.ICOMPTA.fetch(new Request('https://icompta-worker/api/fineco-auto-now', { headers: H }));
      if (!r1.ok) {
        await tg(env, 'sendMessage', {
          chat_id: chatId,
          text: '⚠️ *Aggiornamento Fineco fallito*\n\nIl Mac o il server Playwright non rispondono. Controlla che siano accesi.',
          parse_mode: 'Markdown',
        });
        return;
      }
      // 2. Costruisce e invia il report (stesso identico messaggio delle 18:00)
      const r2 = await env.ICOMPTA.fetch(new Request('https://icompta-worker/api/tg-report-now', { headers: H }));
      const d = await r2.json();
      if (!d.sent) {
        await tg(env, 'sendMessage', {
          chat_id: chatId,
          text: '😐 Nessuna variazione rispetto all\'ultimo dato — borsa chiusa o prezzi fermi.',
        });
      }
    } catch (e) {
      await tg(env, 'sendMessage', { chat_id: chatId, text: '⚠️ Errore: ' + String((e && e.message) || e) });
    }
    return;
  }

  if (cmd === 'arrivi') {
    if (!env.LS) {
      await tg(env, 'sendMessage', { chat_id: chatId, text: '⚠️ Collegamento agli arrivi non configurato.' });
      return;
    }
    try {
      const r = await env.LS.fetch(new Request('https://little-shadow/?action=tgArrivi&notrack=1'));
      const d = await r.json();
      if (d.error) await tg(env, 'sendMessage', { chat_id: chatId, text: '⚠️ ' + d.error });
    } catch (e) {
      await tg(env, 'sendMessage', { chat_id: chatId, text: '⚠️ Errore: ' + String((e && e.message) || e) });
    }
    return;
  }

  await tg(env, 'sendMessage', { chat_id: chatId, text: AIUTO, parse_mode: 'Markdown' });
}

async function handleUpdate(update, env, ctx) {
  // A) messaggio testuale
  if (update.message) {
    const chatId = String(update.message.chat.id);
    const text = (update.message.text || '').trim();
    const noto = await env.TG_KV.get(K_CHAT);

    // Il bot è pubblico: chiunque può scrivergli. Registro il chat ID SOLO la
    // prima volta e ignoro tutti gli altri, altrimenti un estraneo potrebbe
    // sovrascriverlo e dirottare le notifiche (saldo, arrivi, portafoglio).
    if (!noto) {
      await env.TG_KV.put(K_CHAT, chatId);
      await tg(env, 'sendMessage', {
        chat_id: chatId,
        text: '🔌 *Bot collegato.*\n\n' + AIUTO,
        parse_mode: 'Markdown',
      });
      return;
    }
    if (chatId !== noto) {
      console.warn('Messaggio da chat non autorizzata:', chatId);
      return;
    }

    const cmd = text.toLowerCase().replace(/^\//, '').split(/\s+/)[0];
    if (cmd === 'start' || cmd === 'aiuto' || cmd === 'help') {
      await tg(env, 'sendMessage', { chat_id: chatId, text: AIUTO, parse_mode: 'Markdown' });
      return;
    }
    if (cmd === 'saldo') {
      await tg(env, 'sendMessage', { chat_id: chatId, text: '⏳ Aggiorno Fineco investimenti…' });
    } else if (cmd !== 'arrivi') {
      await tg(env, 'sendMessage', { chat_id: chatId, text: AIUTO, parse_mode: 'Markdown' });
      return;
    }
    // Lavoro lungo in background: il webhook risponde subito 200 a Telegram.
    ctx.waitUntil(eseguiComando(cmd, chatId, env));
    return;
  }

  // B) click su un bottone
  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message.chat.id;
    const noto = await env.TG_KV.get(K_CHAT);
    if (noto && String(chatId) !== noto) return;
    const msgId = cq.message.message_id;
    const data = cq.data || '';

    // chiude subito lo spinner sul bottone
    await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id });

    if (data === 'test:annulla') {
      await tg(env, 'editMessageText', {
        chat_id: chatId,
        message_id: msgId,
        text: `🚫 Annullato — ${nowRome()}\nNessuna azione eseguita.`,
      });
      return;
    }

    if (data.startsWith('test:')) {
      const choice = data.split(':')[1].toUpperCase();

      // *** AZIONE REALE: scrive stato persistente su KV ***
      const prev = JSON.parse((await env.TG_KV.get(K_LAST)) || '{"count":0}');
      const record = {
        choice,
        ts: new Date().toISOString(),
        ts_rome: nowRome(),
        count: (prev.count || 0) + 1,
      };
      await env.TG_KV.put(K_LAST, JSON.stringify(record));

      await tg(env, 'editMessageText', {
        chat_id: chatId,
        message_id: msgId,
        text:
          `✅ *Opzione ${choice} eseguita*\n\n` +
          `🕐 ${record.ts_rome}\n` +
          `💾 Salvato su KV \`${K_LAST}\`\n` +
          `🔢 Azioni totali eseguite: *${record.count}*`,
        parse_mode: 'Markdown',
      });
      return;
    }
  }
}

// ---------- worker ----------

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type,X-Auth',
        },
      });
    }

    if (!env.TELEGRAM_BOT_TOKEN) {
      return json({ error: 'TELEGRAM_BOT_TOKEN non configurato (aggiungilo nei Secrets del worker)' }, 500);
    }

    // --- 1. Webhook da Telegram ---
    if (path === '/webhook') {
      if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

      const expected = await webhookSecret(env);
      const got = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
      if (got !== expected) return new Response('forbidden', { status: 403 });

      try {
        const update = await request.json();
        await handleUpdate(update, env, ctx);
      } catch (e) {
        console.error('handleUpdate error', e);
      }
      // A Telegram va sempre risposto 200, altrimenti ritenta all'infinito.
      return new Response('ok');
    }

    // --- da qui in poi serve autenticazione ---
    const key = url.searchParams.get('key') || request.headers.get('X-Auth');
    if (key !== env.TELEGRAM_BOT_TOKEN) {
      return json({ error: 'unauthorized' }, 401);
    }

    const chatId = await env.TG_KV.get(K_CHAT);

    // --- 2. Notifica di test con bottoni ---
    if (path === '/notify') {
      if (!chatId) return json({ error: 'chat_id sconosciuto: manda /start al bot' }, 400);

      const res = await tg(env, 'sendMessage', {
        chat_id: chatId,
        text:
          '🔔 *Test infrastruttura InternoUno*\n\n' +
          `Notifica inviata da Claude alle ${nowRome()}.\n` +
          'Premi un bottone: il worker eseguirà un\'azione reale e la salverà su KV.',
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🅰️ Opzione A', callback_data: 'test:a' },
              { text: '🅱️ Opzione B', callback_data: 'test:b' },
            ],
            [{ text: '🚫 Annulla', callback_data: 'test:annulla' }],
          ],
        },
      });
      return json({ sent: res.ok, chat_id: chatId, telegram: res });
    }

    // --- 3. Messaggio generico ---
    if (path === '/send' && request.method === 'POST') {
      if (!chatId) return json({ error: 'chat_id sconosciuto: manda /start al bot' }, 400);

      const body = await request.json();
      const payload = {
        chat_id: body.chat_id || chatId,
        text: body.text || '(vuoto)',
        parse_mode: body.parse_mode || 'Markdown',
        disable_web_page_preview: true,
      };

      // buttons: array piatto (una riga) oppure array di righe.
      // Ogni bottone: {label, url} -> apre un link | {label, action} -> callback
      if (Array.isArray(body.buttons) && body.buttons.length) {
        const rows = Array.isArray(body.buttons[0]) ? body.buttons : [body.buttons];
        payload.reply_markup = {
          inline_keyboard: rows.map((row) =>
            row.map((b) => (b.url ? { text: b.label, url: b.url } : { text: b.label, callback_data: b.action }))
          ),
        };
      }
      const res = await tg(env, 'sendMessage', payload);
      return json({ sent: res.ok, telegram: res });
    }

    // --- 4. Stato: cosa ha scelto Filippo ---
    if (path === '/state') {
      const last = await env.TG_KV.get(K_LAST);
      return json({
        chat_id: chatId || null,
        last_action: last ? JSON.parse(last) : null,
        binding_ICOMPTA: !!env.ICOMPTA,
        binding_LS: !!env.LS,
        secret_ICOMPTA_TOKEN: !!env.ICOMPTA_TOKEN,
      });
    }

    // --- 5. Info ---
    return json({
      worker: 'tg-worker',
      chat_id_registrato: !!chatId,
      endpoints: ['/webhook (POST, Telegram)', '/notify', '/send (POST)', '/state'],
    });
  },
};
