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
          // estrai booking_id dalla chiave: orario_DATE_BOOKINGID
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

      // ── IN CASA: prenotazioni con checkin in range e checkout > oggi ──
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

      // per prenotazioni con booker null, cerca nome e telefono nell'email di conferma
      if (env.GMAIL_CLIENT_ID) {
        await Promise.all(attivi.map(async b => {
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
        headers: { ...CORS, "Content-Type": "application/json" },
      });

    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
  },
};
