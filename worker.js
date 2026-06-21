// ============================================================
// Cloudflare Worker - Intermediario API Amenitiz per InternoUno
// ============================================================

const HOTEL_UUID = "8aec6938-18cb-43fd-b85f-fc00b8ef3bc9";
const BASE = "https://api.amenitiz.io/vendor_api/v1";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

async function amenitizGet(path, env) {
  const resp = await fetch(`${BASE}${path}`, {
    headers: {
      "User-Agent": UA,
      "Accept": "application/json",
      "Authorization": "Bearer " + env.AMENITIZ_TOKEN,
    },
  });
  return resp;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    try {
      const url = new URL(request.url);
      const action = url.searchParams.get("action");

      // ── DELETE ORARIO ARRIVO ──
      if (action === "deleteOrario") {
        const bookingId = url.searchParams.get("booking_id");
        const date = url.searchParams.get("date");
        if (!bookingId || !date) {
          return new Response(JSON.stringify({ error: "Parametri mancanti" }), {
            status: 400, headers: { ...CORS, "Content-Type": "application/json" },
          });
        }
        const key = `orario_${date}_${bookingId}`;
        await env.ARRIVI_KV.delete(key);
        return new Response(JSON.stringify({ ok: true, key }), {
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      // ── SET ORARIO ARRIVO ──
      if (action === "setOrario") {
        const bookingId = url.searchParams.get("booking_id");
        const date = url.searchParams.get("date");
        const orario = url.searchParams.get("orario");
        if (!bookingId || !date || !orario) {
          return new Response(JSON.stringify({ error: "Parametri mancanti" }), {
            status: 400, headers: { ...CORS, "Content-Type": "application/json" },
          });
        }
        const key = `orario_${date}_${bookingId}`;
        await env.ARRIVI_KV.put(key, orario);
        return new Response(JSON.stringify({ ok: true, key, orario }), {
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      // ── GET NOTE per una data ──
      if (action === "getNote") {
        const date = url.searchParams.get("date");
        if (!date) return new Response(JSON.stringify({ error: "date mancante" }), {
          status: 400, headers: { ...CORS, "Content-Type": "application/json" },
        });
        const prefix = `nota_${date}_`;
        const list = await env.ARRIVI_KV.list({ prefix });
        const note = {};
        for (const key of list.keys) {
          const val = await env.ARRIVI_KV.get(key.name);
          note[key.name.replace(prefix, "")] = val;
        }
        return new Response(JSON.stringify({ date, note }), {
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      // ── SET NOTA ──
      if (action === "setNota") {
        const bookingId = url.searchParams.get("booking_id");
        const date = url.searchParams.get("date");
        const nota = url.searchParams.get("nota") || "";
        if (!bookingId || !date) return new Response(JSON.stringify({ error: "Parametri mancanti" }), {
          status: 400, headers: { ...CORS, "Content-Type": "application/json" },
        });
        await env.ARRIVI_KV.put(`nota_${date}_${bookingId}`, nota);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      // ── DELETE NOTA ──
      if (action === "deleteNota") {
        const bookingId = url.searchParams.get("booking_id");
        const date = url.searchParams.get("date");
        if (!bookingId || !date) return new Response(JSON.stringify({ error: "Parametri mancanti" }), {
          status: 400, headers: { ...CORS, "Content-Type": "application/json" },
        });
        await env.ARRIVI_KV.delete(`nota_${date}_${bookingId}`);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      // ── GET ORARI per una data ──
      if (action === "getOrari") {
        const date = url.searchParams.get("date");
        if (!date) {
          return new Response(JSON.stringify({ error: "Parametro date mancante" }), {
            status: 400, headers: { ...CORS, "Content-Type": "application/json" },
          });
        }
        const prefix = `orario_${date}_`;
        const list = await env.ARRIVI_KV.list({ prefix });
        const orari = {};
        for (const key of list.keys) {
          const val = await env.ARRIVI_KV.get(key.name);
          const bookingId = key.name.replace(prefix, "");
          orari[bookingId] = val;
        }
        return new Response(JSON.stringify({ date, orari }), {
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      // ── ROOMS ──
      if (action === "rooms") {
        const resp = await amenitizGet(`/content?hotel_id=${HOTEL_UUID}`, env);
        if (!resp.ok) return new Response(JSON.stringify({ error: "API Amenitiz", status: resp.status }), {
          status: resp.status, headers: { ...CORS, "Content-Type": "application/json" },
        });
        const data = await resp.json();
        const rooms = (data.rooms || []).map(r => ({
          room_id: r.room_id, name: r.name,
          individual_rooms: (r.individual_rooms || []).map(ir => ({
            individual_room_id: ir.individual_room_id, name: ir.name, number: ir.number,
          }))
        }));
        return new Response(JSON.stringify({ rooms }), {
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      // ── AVAILABILITIES ──
      if (action === "availabilities") {
        const from = url.searchParams.get("from");
        const to = url.searchParams.get("to");
        if (!from || !to) return new Response(JSON.stringify({ error: "Parametri from e to obbligatori" }), {
          status: 400, headers: { ...CORS, "Content-Type": "application/json" },
        });
        const resp = await amenitizGet(`/availabilities?hotel_id=${HOTEL_UUID}&from=${from}&to=${to}`, env);
        if (!resp.ok) return new Response(JSON.stringify({ error: "API Amenitiz", status: resp.status }), {
          status: resp.status, headers: { ...CORS, "Content-Type": "application/json" },
        });
        return new Response(await resp.text(), { headers: { ...CORS, "Content-Type": "application/json" } });
      }

      // ── PRICES ──
      if (action === "prices") {
        const from = url.searchParams.get("from");
        const to = url.searchParams.get("to");
        if (!from || !to) return new Response(JSON.stringify({ error: "Parametri from e to obbligatori" }), {
          status: 400, headers: { ...CORS, "Content-Type": "application/json" },
        });
        const resp = await amenitizGet(`/prices?hotel_id=${HOTEL_UUID}&from=${from}&to=${to}`, env);
        if (!resp.ok) return new Response(JSON.stringify({ error: "API Amenitiz", status: resp.status }), {
          status: resp.status, headers: { ...CORS, "Content-Type": "application/json" },
        });
        return new Response(await resp.text(), { headers: { ...CORS, "Content-Type": "application/json" } });
      }

      // ── IN CASA ──
      if (action === "incasa") {
        const oggi = new Date().toISOString().slice(0,10);
        const da = new Date();
        da.setDate(da.getDate()-30);
        const isoDa = da.toISOString().slice(0,10);
        const resp = await amenitizGet(
          `/bookings/checkin?from=${isoDa}&to=${oggi}&hotel_id=${HOTEL_UUID}`, env
        );
        if (!resp.ok) return new Response(JSON.stringify({ error: "API Amenitiz", status: resp.status }), {
          status: resp.status, headers: { ...CORS, "Content-Type": "application/json" },
        });
        const bookings = await resp.json();
        const attivi = bookings.filter(b => {
          const s = (b.status || "").toLowerCase();
          return s !== "cancelled" && s !== "canceled" && b.checkout > oggi;
        });
        attivi.sort((a,b)=>{
          const order={"Gialla":0,"Marrone":1,"Rossa":2,"Verde":3,"Azzurra":4,"Uno":5,"Due":6,"Tre":7,"Quattro":8,"Cinque":9};
          const ra=(a.rooms&&a.rooms[0]&&a.rooms[0].individual_room_name)||"";
          const rb=(b.rooms&&b.rooms[0]&&b.rooms[0].individual_room_name)||"";
          return (order[ra]??99)-(order[rb]??99);
        });
        return new Response(JSON.stringify({ oggi, count: attivi.length, bookings: attivi }), {
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }


      // ── DEBUG: testa chiamata Amenitiz e ritorna errore raw ──
      if (action === "debug422") {
        const from = url.searchParams.get("from") || "2025-01-01";
        const to = url.searchParams.get("to") || "2025-01-07";
        const resp = await amenitizGet(
          `/bookings/checkin?from=${from}&to=${to}&hotel_id=${HOTEL_UUID}`, env
        );
        const body = await resp.text();
        return new Response(JSON.stringify({ 
          status: resp.status, 
          ok: resp.ok,
          headers: Object.fromEntries(resp.headers),
          body: body.slice(0, 2000)
        }), { headers: { ...CORS, "Content-Type": "application/json" } });
      }

            // ── REPORT RICAVI: fetch mese per mese per evitare il limite 422 dell'API ──
      // ?action=reportRicavi&from=YYYY-MM-DD&to=YYYY-MM-DD
      if (action === "reportRicavi") {
        const from = url.searchParams.get("from");
        const to = url.searchParams.get("to");
        if (!from || !to) return new Response(JSON.stringify({ error: "Parametri from e to obbligatori" }), {
          status: 400, headers: { ...CORS, "Content-Type": "application/json" },
        });

        // Genera lista di chunk settimanali tra from e to (7 giorni per evitare 422)
        function monthChunks(fromStr, toStr) {
          const chunks = [];
          const end = new Date(toStr);
          let cur = new Date(fromStr);
          while (cur <= end) {
            const chunkEnd = new Date(cur);
            chunkEnd.setDate(chunkEnd.getDate() + 6);
            if (chunkEnd > end) chunkEnd.setTime(end.getTime());
            const fmt = d => d.toISOString().slice(0, 10);
            chunks.push({ from: fmt(cur), to: fmt(chunkEnd) });
            cur = new Date(chunkEnd);
            cur.setDate(cur.getDate() + 1);
          }
          return chunks;
        }

        const chunks = monthChunks(from, to);
        const allBookings = [];
        for (const chunk of chunks) {
          const resp = await amenitizGet(
            `/bookings/checkin?from=${chunk.from}&to=${chunk.to}&hotel_id=${HOTEL_UUID}`, env
          );
          if (!resp.ok) {
            const errBody = await resp.text();
            return new Response(JSON.stringify({ error: `checkin ${chunk.from}/${chunk.to}`, status: resp.status, detail: errBody }), {
              status: 422, headers: { ...CORS, "Content-Type": "application/json" },
            });
          }
          const data = await resp.json();
          if (Array.isArray(data)) allBookings.push(...data);
        }

        const mensile = {};
        let totalBookings = 0;
        let totalNotti = 0;
        for (const b of allBookings) {
          const s = (b.status || "").toLowerCase();
          if (s === "cancelled" || s === "canceled") continue;
          totalBookings++;
          const checkin = b.checkin || "";
          if (!checkin) continue;
          const mese = checkin.slice(0, 7);
          const importo = parseFloat(b.total_amount_after_tax) || 0;
          const cin = new Date(b.checkin);
          const cout = new Date(b.checkout);
          const notti = Math.max(0, Math.round((cout - cin) / 86400000));
          if (!mensile[mese]) mensile[mese] = { ricavi: 0, prenotazioni: 0, notti: 0 };
          mensile[mese].ricavi += importo;
          mensile[mese].prenotazioni++;
          mensile[mese].notti += notti;
          totalNotti += notti;
        }
        for (const k of Object.keys(mensile)) {
          mensile[k].ricavi = Math.round(mensile[k].ricavi * 100) / 100;
        }
        return new Response(JSON.stringify({ from, to, totalBookings, totalNotti, mensile }), {
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      // ── REPORT WINDOW: prenotazioni create entro cutoff con checkin futuro ──
      // ?action=reportWindow&created_from=YYYY-MM-DD&created_to=YYYY-MM-DD&future_from=YYYY-MM-DD
      if (action === "reportWindow") {
        const createdFrom = url.searchParams.get("created_from");
        const createdTo   = url.searchParams.get("created_to");
        const futureFrom  = url.searchParams.get("future_from");
        if (!createdFrom || !createdTo || !futureFrom) {
          return new Response(JSON.stringify({ error: "Parametri created_from, created_to, future_from obbligatori" }), {
            status: 400, headers: { ...CORS, "Content-Type": "application/json" },
          });
        }

        // Singola chiamata per range
        const resp = await amenitizGet(
          `/bookings/created?from=${createdFrom}&to=${createdTo}&hotel_id=${HOTEL_UUID}`, env
        );
        if (!resp.ok) {
          const errBody = await resp.text();
          return new Response(JSON.stringify({ error: `created ${createdFrom}/${createdTo}`, status: resp.status, detail: errBody }), {
            status: resp.status, headers: { ...CORS, "Content-Type": "application/json" },
          });
        }
        const raw = await resp.json();
        const allBookings = Array.isArray(raw) ? raw : [];

        const futuri = allBookings.filter(b => {
          const s = (b.status || "").toLowerCase();
          if (s === "cancelled" || s === "canceled") return false;
          return (b.checkin || "") > futureFrom;
        });
        const perMese = {};
        let totalRicavi = 0;
        let totalNotti = 0;
        for (const b of futuri) {
          const mese = (b.checkin || "").slice(0, 7);
          const importo = parseFloat(b.total_amount_after_tax) || 0;
          const cin = new Date(b.checkin);
          const cout = new Date(b.checkout);
          const notti = Math.max(0, Math.round((cout - cin) / 86400000));
          if (!perMese[mese]) perMese[mese] = { prenotazioni: 0, ricavi: 0, notti: 0 };
          perMese[mese].prenotazioni++;
          perMese[mese].ricavi += importo;
          perMese[mese].notti += notti;
          totalRicavi += importo;
          totalNotti += notti;
        }
        for (const k of Object.keys(perMese)) {
          perMese[k].ricavi = Math.round(perMese[k].ricavi * 100) / 100;
        }
        return new Response(JSON.stringify({
          createdFrom, createdTo, futureFrom,
          totalPrenotazioni: futuri.length,
          totalRicavi: Math.round(totalRicavi * 100) / 100,
          totalNotti,
          perMese
        }), {
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      // ── ARRIVI (comportamento originale) ──
      let date = url.searchParams.get("date");
      if (!date) {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        date = d.toISOString().slice(0, 10);
      }
      const resp = await amenitizGet(`/bookings/checkin?from=${date}&to=${date}&hotel_id=${HOTEL_UUID}`, env);
      if (!resp.ok) return new Response(JSON.stringify({ error: "API Amenitiz", status: resp.status }), {
        status: resp.status, headers: { ...CORS, "Content-Type": "application/json" },
      });
      const bookings = await resp.json();
      const attivi = bookings.filter(b => {
        const s = (b.status || "").toLowerCase();
        return s !== "cancelled" && s !== "canceled";
      });
      return new Response(JSON.stringify({ date, count: attivi.length, bookings: attivi }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });

    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
  },
};
