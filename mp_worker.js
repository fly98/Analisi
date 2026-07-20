// FlyGames MP — worker multiplayer 1v1
// Durable Object "Room": una stanza per partita, WebSocket relay host<->guest,
// ultimo stato persistito per la riconnessione (iOS sospende i socket in background).

export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sockets = {}; // role -> WebSocket
  }

  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === '/setmeta' && req.method === 'POST') {
      const meta = await req.json();
      await this.state.storage.put('meta', meta);
      // nuova stanza: azzera lo stato precedente (i codici possono riciclarsi)
      await this.state.storage.delete('lastState');
      return Response.json({ ok: true });
    }

    if (url.pathname.endsWith('/info')) {
      const meta = await this.state.storage.get('meta');
      const presenti = Object.keys(this.sockets);
      return Response.json({ meta: meta || null, presenti });
    }

    if (url.pathname.endsWith('/ws')) {
      if (req.headers.get('Upgrade') !== 'websocket')
        return new Response('expected websocket', { status: 426 });
      const role = url.searchParams.get('role') === 'guest' ? 'guest' : 'host';
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.handle(server, role);
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('not found', { status: 404 });
  }

  async rimuoviDaLobby() {
    try {
      const meta = await this.state.storage.get('meta');
      if (!meta || !meta.code) return;
      const lobby = this.env.LOBBY.get(this.env.LOBBY.idFromName('lobby'));
      await lobby.fetch('https://do/remove', { method: 'POST', body: JSON.stringify({ code: meta.code }) });
    } catch (e) {}
  }

  handle(ws, role) {
    ws.accept();
    if (role === 'guest') this.rimuoviDaLobby();
    // un solo socket per ruolo: il nuovo sostituisce il vecchio (riconnessione)
    const old = this.sockets[role];
    if (old) { try { old.close(1000, 'replaced'); } catch (e) {} }
    this.sockets[role] = ws;

    this.broadcast({ t: 'presence', who: role, on: true });

    // sync immediato al nuovo arrivato
    this.state.storage.get('meta').then(meta => {
      if (meta) this.safeSend(ws, { t: 'meta', meta });
      this.state.storage.get('lastState').then(last => {
        if (last) this.safeSend(ws, { t: 'state', state: last, resync: true });
        // dice all'arrivato chi altro c'è
        const altro = role === 'host' ? 'guest' : 'host';
        this.safeSend(ws, { t: 'presence', who: altro, on: !!this.sockets[altro] });
      });
    });

    ws.addEventListener('message', async ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.t === 'ping') { this.safeSend(ws, { t: 'pong' }); return; }
      if (msg.t === 'state' && role === 'host') {
        // solo l'host è autoritativo sullo stato
        await this.state.storage.put('lastState', msg.state);
      }
      this.relay(role, msg);
    });

    const close = () => {
      if (this.sockets[role] === ws) {
        delete this.sockets[role];
        this.broadcast({ t: 'presence', who: role, on: false });
      }
    };
    ws.addEventListener('close', close);
    ws.addEventListener('error', close);
  }

  relay(from, msg) {
    const to = from === 'host' ? 'guest' : 'host';
    const s = this.sockets[to];
    if (s) this.safeSend(s, msg);
  }

  broadcast(msg) {
    for (const r of ['host', 'guest']) {
      const s = this.sockets[r];
      if (s) this.safeSend(s, msg);
    }
  }

  safeSend(ws, obj) {
    try { ws.send(JSON.stringify(obj)); } catch (e) {}
  }
}

export class Lobby {
  constructor(state) { this.state = state; }

  async fetch(req) {
    const url = new URL(req.url);
    const TTL = 30 * 60 * 1000; // le stanze aperte scadono dopo 30 minuti

    if (url.pathname === '/add' && req.method === 'POST') {
      const { code, game, name } = await req.json();
      const rooms = (await this.state.storage.get('rooms')) || {};
      rooms[code] = { game, name: (name || 'Giocatore').slice(0, 20), created: Date.now() };
      await this.state.storage.put('rooms', rooms);
      return Response.json({ ok: true });
    }

    if (url.pathname === '/remove' && req.method === 'POST') {
      const { code } = await req.json();
      const rooms = (await this.state.storage.get('rooms')) || {};
      delete rooms[code];
      await this.state.storage.put('rooms', rooms);
      return Response.json({ ok: true });
    }

    if (url.pathname === '/list') {
      const rooms = (await this.state.storage.get('rooms')) || {};
      const now = Date.now();
      const out = [];
      let dirty = false;
      for (const [code, r] of Object.entries(rooms)) {
        if (now - r.created > TTL) { delete rooms[code]; dirty = true; continue; }
        out.push({ code, game: r.game, name: r.name, created: r.created });
      }
      if (dirty) await this.state.storage.put('rooms', rooms);
      out.sort((a, b) => b.created - a.created);
      return Response.json({ rooms: out });
    }

    return new Response('not found', { status: 404 });
  }
}

function nuovoCodice() {
  // niente 0/O/1/I per dettatura facile a voce
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 4; i++) c += chars[(Math.random() * chars.length) | 0];
  return c;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

    // POST/GET /create?game=briscola -> {code}
    if (url.pathname === '/create') {
      const game = url.searchParams.get('game') || 'briscola';
      const name = (url.searchParams.get('name') || 'Giocatore').slice(0, 20);
      const code = nuovoCodice();
      const id = env.ROOM.idFromName(code);
      const stub = env.ROOM.get(id);
      await stub.fetch('https://do/setmeta', {
        method: 'POST',
        body: JSON.stringify({ game, name, code, created: Date.now() })
      });
      const lobby = env.LOBBY.get(env.LOBBY.idFromName('lobby'));
      await lobby.fetch('https://do/add', { method: 'POST', body: JSON.stringify({ code, game, name }) });
      return Response.json({ code, game }, { headers: CORS });
    }

    // GET /rooms -> elenco delle partite aperte (in attesa di avversario)
    if (url.pathname === '/rooms') {
      const lobby = env.LOBBY.get(env.LOBBY.idFromName('lobby'));
      const res = await lobby.fetch('https://do/list');
      const nr = new Response(res.body, res);
      for (const [k, v] of Object.entries(CORS)) nr.headers.set(k, v);
      return nr;
    }

    // /room/CODE/ws | /room/CODE/info
    const m = url.pathname.match(/^\/room\/([A-Z0-9]{4,8})\/(ws|info)$/);
    if (m) {
      const id = env.ROOM.idFromName(m[1].toUpperCase());
      const stub = env.ROOM.get(id);
      const res = await stub.fetch(req);
      if (m[2] === 'info') {
        const nr = new Response(res.body, res);
        for (const [k, v] of Object.entries(CORS)) nr.headers.set(k, v);
        return nr;
      }
      return res;
    }

    return new Response('FlyGames MP worker · ok', { headers: CORS });
  }
};
