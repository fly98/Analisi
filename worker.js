// worker.js
const HOTEL_UUID = "8aec6938-18cb-43fd-b85f-fc00b8ef3bc9";
const BASE = "https://api.amenitiz.io/vendor_api/v1";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400"
};

async function getGmailAccessToken(env) {
  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: "refresh_token"
    })
  });
  return tokenResp.json();
}

async function cercaEmailBooking(bookingId, env) {
  try {
    function trovaTestoPlain(part) {
      if (!part) return "";
      if (part.mimeType === "text/plain" && part.body && part.body.data) {
        return atob(part.body.data.replace(/-/g, "+").replace(/_/g, "/"));
      }
      if (part.parts && part.parts.length) {
        for (const sub of part.parts) {
          const t = trovaTestoPlain(sub);
          if (t) return t;
        }
      }
      return "";
    }
    const tokenData = await getGmailAccessToken(env);
    if (!tokenData.access_token) return null;
    const accessToken = tokenData.access_token;
    const query = encodeURIComponent(`subject:[${bookingId}] Nuova prenotazione`);
    const searchResp = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=1`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const searchData = await searchResp.json();
    if (!searchData.messages || !searchData.messages[0]) return null;
    const msgId = searchData.messages[0].id;
    const msgResp = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const msgData = await msgResp.json();
    let testo = trovaTestoPlain(msgData.payload);
    if (!testo && msgData.payload && msgData.payload.body && msgData.payload.body.data) {
      testo = atob(msgData.payload.body.data.replace(/-/g, "+").replace(/_/g, "/"));
    }
    const nomeMatch = testo.match(new RegExp("Nome:\\s*\\r?\\n([^\\r\\n]+)"));
    const telMatch = testo.match(new RegExp("Telefono\\s*\\r?\\n([^\\r\\n]+)"));
    const nome = nomeMatch ? nomeMatch[1].trim() : null;
    const telefono = telMatch ? telMatch[1].trim() : null;
    if (!nome && !telefono) return null;
    const parti = nome ? nome.trim().split(" ") : [];
    const lastName = parti[0] || "";
    const firstName = parti.slice(1).join(" ") || "";
    return { first_name: firstName, last_name: lastName, phone: telefono };
  } catch (e) {
    return null;
  }
}

async function amenitizGet(path, env) {
  const resp = await fetch(`${BASE}${path}`, {
    headers: {
      "User-Agent": UA,
      "Accept": "application/json",
      "Authorization": "Bearer " + env.AMENITIZ_TOKEN
    }
  });
  return resp;
}

function b64urlEncode(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    try {
      const url = new URL(request.url);
      const action = url.searchParams.get("action");

      if (action === "sendExperience") {
        let body;
        try { body = await request.json(); } catch (e) {
          return new Response(JSON.stringify({ error: "Corpo JSON non valido" }), {
            status: 400, headers: { ...CORS, "Content-Type": "application/json" }
          });
        }
        const { to, subject, html } = body || {};
        if (!to || !subject || !html) {
          return new Response(JSON.stringify({ error: "Parametri mancanti (to, subject, html)" }), {
            status: 400, headers: { ...CORS, "Content-Type": "application/json" }
          });
        }
        const tokenData = await getGmailAccessToken(env);
        if (!tokenData.access_token) {
          return new Response(JSON.stringify({ error: "Token Gmail non ottenuto", detail: tokenData }), {
            status: 502, headers: { ...CORS, "Content-Type": "application/json" }
          });
        }
        const subjectEnc = "=?UTF-8?B?" + btoa(unescape(encodeURIComponent(subject))) + "?=";
        const mime = [
          "From: InternoUno <interno1bbroma@gmail.com>",
          `To: ${to}`,
          `Subject: ${subjectEnc}`,
          "MIME-Version: 1.0",
          "Content-Type: text/html; charset=UTF-8",
          "Content-Transfer-Encoding: 8bit",
          "",
          html
        ].join("\r\n");
        const raw = b64urlEncode(mime);
        const sendResp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
          method: "POST",
          headers: { Authorization: `Bearer ${tokenData.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ raw })
        });
        if (!sendResp.ok) {
          const errText = await sendResp.text();
          return new Response(JSON.stringify({ error: "Invio Gmail fallito", status: sendResp.status, detail: errText.slice(0, 500) }), {
            status: sendResp.status, headers: { ...CORS, "Content-Type": "application/json" }
          });
        }
        const sendData = await sendResp.json();
        return new Response(JSON.stringify({ ok: true, messageId: sendData.id }), {
          headers: { ...CORS, "Content-Type": "application/json" }
        });
      }

      if (action === "deleteOrario") {
        const bookingId = url.searchParams.get("booking_id");
        const date2 = url.searchParams.get("date");
        if (!bookingId || !date2) {
          return new Response(JSON.stringify({ error: "Parametri mancanti" }), {
            status: 400,
            headers: { ...CORS, "Content-Type": "application/json" }
          });
        }
        const key = `orario_${date2}_${bookingId}`;
        await env.ARRIVI_KV.delete(key);
        return new Response(JSON.stringify({ ok: true, key }), {
          headers: { ...CORS, "Content-Type": "application/json" }
        });
      }
      if (action === "setOrario") {
        const bookingId = url.searchParams.get("booking_id");
        const date2 = url.searchParams.get("date");
        const orario = url.searchParams.get("orario");
        if (!bookingId || !date2 || !orario) {
          return new Response(JSON.stringify({ error: "Parametri mancanti" }), {
            status: 400,
            headers: { ...CORS, "Content-Type": "application/json" }
          });
        }
        const key = `orario_${date2}_${bookingId}`;
        await env.ARRIVI_KV.put(key, orario);
        return new Response(JSON.stringify({ ok: true, key, orario }), {
          headers: { ...CORS, "Content-Type": "application/json" }
        });
      }
      if (action === "getNote") {
        const date2 = url.searchParams.get("date");
        if (!date2)
          return new Response(JSON.stringify({ error: "date mancante" }), {
            status: 400,
            headers: { ...CORS, "Content-Type": "application/json" }
          });
        const prefix = `nota_${date2}_`;
        const list = await env.ARRIVI_KV.list({ prefix });
        const note = {};
        for (const key of list.keys) {
          const val = await env.ARRIVI_KV.get(key.name);
          note[key.name.replace(prefix, "")] = val;
        }
        return new Response(JSON.stringify({ date: date2, note }), {
          headers: { ...CORS, "Content-Type": "application/json" }
        });
      }
      if (action === "setNota") {
        const bookingId = url.searchParams.get("booking_id");
        const date2 = url.searchParams.get("date");
        const nota = url.searchParams.get("nota") || "";
        if (!bookingId || !date2)
          return new Response(JSON.stringify({ error: "Parametri mancanti" }), {
            status: 400,
            headers: { ...CORS, "Content-Type": "application/json" }
          });
        await env.ARRIVI_KV.put(`nota_${date2}_${bookingId}`, nota);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...CORS, "Content-Type": "application/json" }
        });
      }
      if (action === "deleteNota") {
        const bookingId = url.searchParams.get("booking_id");
        const date2 = url.searchParams.get("date");
        if (!bookingId || !date2)
          return new Response(JSON.stringify({ error: "Parametri mancanti" }), {
            status: 400,
            headers: { ...CORS, "Content-Type": "application/json" }
          });
        await env.ARRIVI_KV.delete(`nota_${date2}_${bookingId}`);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...CORS, "Content-Type": "application/json" }
        });
      }
      if (action === "getOrari") {
        const date2 = url.searchParams.get("date");
        if (!date2) {
          return new Response(JSON.stringify({ error: "Parametro date mancante" }), {
            status: 400,
            headers: { ...CORS, "Content-Type": "application/json" }
          });
        }
        const prefix = `orario_${date2}_`;
        const list = await env.ARRIVI_KV.list({ prefix });
        const orari = {};
        for (const key of list.keys) {
          const val = await env.ARRIVI_KV.get(key.name);
          const bookingId = key.name.replace(prefix, "");
          orari[bookingId] = val;
        }
        return new Response(JSON.stringify({ date: date2, orari }), {
          headers: { ...CORS, "Content-Type": "application/json" }
        });
      }
      if (action === "rooms") {
        const resp2 = await amenitizGet(`/content?hotel_id=${HOTEL_UUID}`, env);
        if (!resp2.ok)
          return new Response(JSON.stringify({ error: "API Amenitiz", status: resp2.status }), {
            status: resp2.status,
            headers: { ...CORS, "Content-Type": "application/json" }
          });
        const data = await resp2.json();
        const rooms = (data.rooms || []).map((r) => ({
          room_id: r.room_id,
          name: r.name,
          individual_rooms: (r.individual_rooms || []).map((ir) => ({
            individual_room_id: ir.individual_room_id,
            name: ir.name,
            number: ir.number
          }))
        }));
        return new Response(JSON.stringify({ rooms }), {
          headers: { ...CORS, "Content-Type": "application/json" }
        });
      }
      if (action === "availabilities") {
        const from = url.searchParams.get("from");
        const to = url.searchParams.get("to");
        if (!from || !to)
          return new Response(JSON.stringify({ error: "Parametri from e to obbligatori" }), {
            status: 400,
            headers: { ...CORS, "Content-Type": "application/json" }
          });
        const resp2 = await amenitizGet(`/availabilities?hotel_id=${HOTEL_UUID}&from=${from}&to=${to}`, env);
        if (!resp2.ok)
          return new Response(JSON.stringify({ error: "API Amenitiz", status: resp2.status }), {
            status: resp2.status,
            headers: { ...CORS, "Content-Type": "application/json" }
          });
        return new Response(await resp2.text(), { headers: { ...CORS, "Content-Type": "application/json" } });
      }
      if (action === "prices") {
        const from = url.searchParams.get("from");
        const to = url.searchParams.get("to");
        if (!from || !to)
          return new Response(JSON.stringify({ error: "Parametri from e to obbligatori" }), {
            status: 400,
            headers: { ...CORS, "Content-Type": "application/json" }
          });
        const resp2 = await amenitizGet(`/prices?hotel_id=${HOTEL_UUID}&from=${from}&to=${to}`, env);
        if (!resp2.ok)
          return new Response(JSON.stringify({ error: "API Amenitiz", status: resp2.status }), {
            status: resp2.status,
            headers: { ...CORS, "Content-Type": "application/json" }
          });
        return new Response(await resp2.text(), { headers: { ...CORS, "Content-Type": "application/json" } });
      }
      if (action === "incasa") {
        const oggi = (new Date()).toISOString().slice(0, 10);
        const da = new Date();
        da.setDate(da.getDate() - 30);
        const isoDa = da.toISOString().slice(0, 10);
        const resp2 = await amenitizGet(
          `/bookings/checkin?from=${isoDa}&to=${oggi}&hotel_id=${HOTEL_UUID}`,
          env
        );
        if (!resp2.ok)
          return new Response(JSON.stringify({ error: "API Amenitiz", status: resp2.status }), {
            status: resp2.status,
            headers: { ...CORS, "Content-Type": "application/json" }
          });
        const bookings2 = await resp2.json();
        const attivi2 = bookings2.filter((b) => {
          const s = (b.status || "").toLowerCase();
          return s !== "cancelled" && s !== "canceled" && b.checkout > oggi;
        });
        attivi2.sort((a, b) => {
          const order = { "Gialla": 0, "Marrone": 1, "Rossa": 2, "Verde": 3, "Azzurra": 4, "Uno": 5, "Due": 6, "Tre": 7, "Quattro": 8, "Cinque": 9 };
          const ra = a.rooms && a.rooms[0] && a.rooms[0].individual_room_name || "";
          const rb = b.rooms && b.rooms[0] && b.rooms[0].individual_room_name || "";
          return (order[ra] ?? 99) - (order[rb] ?? 99);
        });
        if (env.GMAIL_CLIENT_ID) {
          await Promise.all(attivi2.map(async (b) => {
            const bk = b.booker || {};
            if (!bk.first_name && !bk.last_name) {
              const datiEmail = await cercaEmailBooking(b.booking_id, env);
              if (datiEmail) {
                b.booker = { ...bk, ...datiEmail };
                b._from_email = true;
              }
            }
          }));
        }
        return new Response(JSON.stringify({ oggi, count: attivi2.length, bookings: attivi2 }), {
          headers: { ...CORS, "Content-Type": "application/json" }
        });
      }
      if (action === "reportRicavi") {
        function getMonthChunks(f, t) {
          const res = [], end = new Date(t);
          let cur = new Date(f);
          while (cur <= end) {
            const y = cur.getFullYear(), m = cur.getMonth();
            const s = new Date(y, m, 1);
            const e = new Date(y, m + 1, 0);
            const fmt = (d) => d.toISOString().slice(0, 10);
            res.push({ from: fmt(s < new Date(f) ? new Date(f) : s), to: fmt(e > end ? end : e) });
            cur = new Date(y, m + 1, 1);
          }
          return res;
        }
        const from = url.searchParams.get("from");
        const to = url.searchParams.get("to");
        const year = url.searchParams.get("year");
        const month = url.searchParams.get("month");
        if (!from || !to)
          return new Response(JSON.stringify({ error: "Parametri from e to obbligatori" }), {
            status: 400,
            headers: { ...CORS, "Content-Type": "application/json" }
          });
        const chunks = getMonthChunks(from, to);
        const fetched = await Promise.all(chunks.map(
          (c) => amenitizGet(`/bookings/checkin?from=${c.from}&to=${c.to}&hotel_id=${HOTEL_UUID}`, env).then(async (r) => {
            const d = await r.json();
            return Array.isArray(d) ? d : [];
          }).catch(() => [])
        ));
        const seenIds = new Set();
        const allBookings = [];
        for (const batch of fetched) {
          for (const b of batch) {
            if (!seenIds.has(b.booking_id)) {
              seenIds.add(b.booking_id);
              allBookings.push(b);
            }
          }
        }
        const mensile = {};
        let totalBookings = 0, totalNotti = 0;
        const seen = new Set();
        for (const b of allBookings) {
          const s = (b.status || "").toLowerCase();
          if (s === "cancelled" || s === "canceled")
            continue;
          if (seen.has(b.booking_id))
            continue;
          seen.add(b.booking_id);
          totalBookings++;
          if (!b.checkin || !b.checkout)
            continue;
          const cin = new Date(b.checkin);
          const cout = new Date(b.checkout);
          const totNotti = Math.max(1, Math.round((cout - cin) / 864e5));
          const importoTot = parseFloat(b.total_amount_after_tax) || 0;
          const adults = b.adults || 1;
          const cityTaxNotti = Math.min(totNotti, 10);
          const cityTaxTot = adults * cityTaxNotti * 5;
          totalNotti += totNotti;
          for (let d = new Date(cin); d < cout; d.setDate(d.getDate() + 1)) {
            const mese = d.toISOString().slice(0, 7);
            const annoMese = parseInt(mese.slice(0, 4));
            const numMese = parseInt(mese.slice(5, 7));
            if (year && annoMese !== parseInt(year))
              continue;
            if (month && numMese !== parseInt(month))
              continue;
            if (!mensile[mese])
              mensile[mese] = { ricavi: 0, prenotazioni: 0, notti: 0, cityTax: 0 };
            mensile[mese].ricavi += importoTot / totNotti;
            mensile[mese].notti++;
            const notteIdx = Math.round((new Date(d) - cin) / 864e5);
            if (notteIdx < 10)
              mensile[mese].cityTax += cityTaxTot / cityTaxNotti;
          }
          const meseCin = b.checkin.slice(0, 7);
          const annoMeseCin = parseInt(meseCin.slice(0, 4));
          const numMeseCin = parseInt(meseCin.slice(5, 7));
          if ((!year || annoMeseCin === parseInt(year)) && (!month || numMeseCin === parseInt(month))) {
            if (!mensile[meseCin])
              mensile[meseCin] = { ricavi: 0, prenotazioni: 0, notti: 0, cityTax: 0 };
            mensile[meseCin].prenotazioni++;
          }
        }
        for (const k of Object.keys(mensile)) {
          mensile[k].ricavi = Math.round(mensile[k].ricavi * 100) / 100;
          mensile[k].cityTax = Math.round((mensile[k].cityTax || 0) * 100) / 100;
        }
        return new Response(JSON.stringify({ from, to, totalBookings, totalNotti, mensile }), {
          headers: { ...CORS, "Content-Type": "application/json" }
        });
      }
      if (action === "reportWindow") {
        function getMonthChunks(f, t) {
          const res = [], end = new Date(t);
          let cur = new Date(f);
          while (cur <= end) {
            const y = cur.getFullYear(), m = cur.getMonth();
            const s = new Date(y, m, 1);
            const e = new Date(y, m + 1, 0);
            const fmt = (d) => d.toISOString().slice(0, 10);
            res.push({ from: fmt(s < new Date(f) ? new Date(f) : s), to: fmt(e > end ? end : e) });
            cur = new Date(y, m + 1, 1);
          }
          return res;
        }
        const createdFrom = url.searchParams.get("created_from");
        const createdTo = url.searchParams.get("created_to");
        const futureFrom = url.searchParams.get("future_from");
        const includeCancelled = url.searchParams.get("include_cancelled") === "true";
        if (!createdFrom || !createdTo || !futureFrom) {
          return new Response(JSON.stringify({ error: "Parametri mancanti" }), {
            status: 400,
            headers: { ...CORS, "Content-Type": "application/json" }
          });
        }
        const chunks = getMonthChunks(createdFrom, createdTo);
        const fetched = await Promise.all(chunks.map(
          (c) => amenitizGet(`/bookings/created?from=${c.from}&to=${c.to}&hotel_id=${HOTEL_UUID}`, env).then(async (r) => {
            const d = await r.json();
            return Array.isArray(d) ? d : [];
          }).catch(() => [])
        ));
        const seenIds = new Set();
        const allBookings = [];
        for (const batch of fetched) {
          for (const b of batch) {
            if (!seenIds.has(b.booking_id)) {
              seenIds.add(b.booking_id);
              allBookings.push(b);
            }
          }
        }
        const futuri = allBookings.filter((b) => {
          const s = (b.status || "").toLowerCase();
          if (!includeCancelled && (s === "cancelled" || s === "canceled"))
            return false;
          return (b.checkin || "") > futureFrom;
        });
        const perMese = {};
        let totalRicavi = 0, totalNotti = 0;
        for (const b of futuri) {
          const cin = new Date(b.checkin);
          const cout = new Date(b.checkout);
          const totNotti = Math.max(1, Math.round((cout - cin) / 864e5));
          const importoTot = parseFloat(b.total_amount_after_tax) || 0;
          const adults = b.adults || 1;
          const cityTaxTot = adults * Math.min(totNotti, 10) * 5;
          const meseCheckin = (b.checkin || "").slice(0, 7);
          if (!perMese[meseCheckin])
            perMese[meseCheckin] = { prenotazioni: 0, ricavi: 0, notti: 0 };
          perMese[meseCheckin].prenotazioni++;
          perMese[meseCheckin].notti += totNotti;
          for (let d = new Date(cin); d < cout; d.setDate(d.getDate() + 1)) {
            const mese = d.toISOString().slice(0, 7);
            if (!perMese[mese])
              perMese[mese] = { prenotazioni: 0, ricavi: 0, notti: 0 };
            perMese[mese].ricavi += importoTot / totNotti;
          }
          totalRicavi += importoTot;
          totalNotti += totNotti;
        }
        for (const k of Object.keys(perMese)) {
          perMese[k].ricavi = Math.round(perMese[k].ricavi * 100) / 100;
        }
        return new Response(JSON.stringify({
          createdFrom,
          createdTo,
          futureFrom,
          totalPrenotazioni: futuri.length,
          totalRicavi: Math.round(totalRicavi * 100) / 100,
          totalNotti,
          perMese
        }), { headers: { ...CORS, "Content-Type": "application/json" } });
      }
      let date = url.searchParams.get("date");
      if (!date) {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        date = d.toISOString().slice(0, 10);
      }
      const resp = await amenitizGet(`/bookings/checkin?from=${date}&to=${date}&hotel_id=${HOTEL_UUID}`, env);
      if (!resp.ok)
        return new Response(JSON.stringify({ error: "API Amenitiz", status: resp.status }), {
          status: resp.status,
          headers: { ...CORS, "Content-Type": "application/json" }
        });
      const bookings = await resp.json();
      const attivi = bookings.filter((b) => {
        const s = (b.status || "").toLowerCase();
        return s !== "cancelled" && s !== "canceled";
      });
      if (env.GMAIL_CLIENT_ID) {
        await Promise.all(attivi.map(async (b) => {
          const bk = b.booker || {};
          if (!bk.first_name && !bk.last_name) {
            const datiEmail = await cercaEmailBooking(b.booking_id, env);
            if (datiEmail) {
              b.booker = { ...bk, ...datiEmail };
              b._from_email = true;
            }
          }
        }));
      }
      return new Response(JSON.stringify({ date, count: attivi.length, bookings: attivi }), {
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
