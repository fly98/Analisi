const ORIGIN = "https://www.interno1.it";
const DEFAULT_PATH = "/it/booking/room";

export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    const path = incoming.pathname === "/" ? DEFAULT_PATH : incoming.pathname;
    const target = new URL(ORIGIN + path + incoming.search);

    // Header minimi, "normali", che imitano una richiesta browser reale
    const forwardHeaders = new Headers();
    const cookie = request.headers.get("cookie");
    if (cookie) forwardHeaders.set("cookie", cookie);
    forwardHeaders.set("User-Agent", request.headers.get("User-Agent") ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36");
    forwardHeaders.set("Accept", request.headers.get("Accept") || "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
    forwardHeaders.set("Accept-Language", "it-IT,it;q=0.9");
    forwardHeaders.set("Referer", "https://www.google.com/");
    const contentType = request.headers.get("content-type");
    if (contentType) forwardHeaders.set("content-type", contentType);

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
