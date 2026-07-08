const ORIGIN = "https://www.interno1.it";
const DEFAULT_PATH = "/it/booking/room";

export default {
  async fetch(request) {
    const incoming = new URL(request.url);

    // La root del proxy corrisponde alla pagina di prenotazione;
    // qualsiasi altro percorso (chiamate JS, asset, API) viene inoltrato cosi' com'e'
    const path = incoming.pathname === "/" ? DEFAULT_PATH : incoming.pathname;
    const target = new URL(ORIGIN + path + incoming.search);

    // Copia gli header della richiesta originale (inclusi i cookie di sessione)
    const forwardHeaders = new Headers(request.headers);
    forwardHeaders.set("Host", "www.interno1.it");
    forwardHeaders.set("Origin", ORIGIN);
    forwardHeaders.set("Referer", ORIGIN + "/");
    forwardHeaders.delete("cf-connecting-ip");
    forwardHeaders.delete("cf-ipcountry");
    forwardHeaders.delete("cf-ray");
    forwardHeaders.delete("cf-visitor");

    const upstreamResponse = await fetch(target.toString(), {
      method: request.method,
      headers: forwardHeaders,
      body: (request.method === "GET" || request.method === "HEAD") ? undefined : request.body,
      redirect: "manual",
    });

    const newHeaders = new Headers(upstreamResponse.headers);
    newHeaders.delete("X-Frame-Options");
    newHeaders.delete("Content-Security-Policy");
    newHeaders.delete("Content-Security-Policy-Report-Only");

    // Segue eventuali redirect mantenendoli dentro al proxy
    if ([301, 302, 303, 307, 308].includes(upstreamResponse.status)) {
      const loc = newHeaders.get("Location");
      if (loc) {
        const redirectTarget = new URL(loc, ORIGIN);
        if (redirectTarget.origin === ORIGIN) {
          newHeaders.set("Location", redirectTarget.pathname + redirectTarget.search);
        }
      }
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: newHeaders,
    });
  },
};
