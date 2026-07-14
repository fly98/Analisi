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

async function handleUpdate(update, env) {
  // A) messaggio testuale (tipicamente /start)
  if (update.message) {
    const chatId = update.message.chat.id;
    const text = (update.message.text || '').trim();

    await env.TG_KV.put(K_CHAT, String(chatId));

    if (text === '/start') {
      await tg(env, 'sendMessage', {
        chat_id: chatId,
        text:
          '🔌 *Bot collegato.*\n\n' +
          `Chat ID salvato: \`${chatId}\`\n` +
          'Da ora posso mandarti notifiche e tu puoi rispondere con i bottoni.',
        parse_mode: 'Markdown',
      });
    } else {
      await tg(env, 'sendMessage', {
        chat_id: chatId,
        text: `Ricevuto: "${text}"\n(chat ID: ${chatId})`,
      });
    }
    return;
  }

  // B) click su un bottone
  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message.chat.id;
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
  async fetch(request, env) {
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
        await handleUpdate(update, env);
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
        chat_id: chatId,
        text: body.text || '(vuoto)',
        parse_mode: body.parse_mode || 'Markdown',
      };
      if (Array.isArray(body.buttons) && body.buttons.length) {
        payload.reply_markup = {
          inline_keyboard: [body.buttons.map((b) => ({ text: b.label, callback_data: b.action }))],
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
