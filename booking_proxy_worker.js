export default {
  async fetch(request) {
    const targetUrl = "https://www.interno1.it/it/booking/room";

    // Passa eventuali parametri di query (date, ospiti, ecc.) al motore reale
    const incoming = new URL(request.url);
    const target = new URL(targetUrl);
    incoming.searchParams.forEach((value, key) => {
      target.searchParams.set(key, value);
    });

    const upstreamResponse = await fetch(target.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "it-IT,it;q=0.9",
        "Referer": "https://www.google.com/",
      },
    });

    // Copia la risposta e rimuove gli header che impediscono l'iframe
    const newHeaders = new Headers(upstreamResponse.headers);
    newHeaders.delete("X-Frame-Options");
    newHeaders.delete("Content-Security-Policy");
    newHeaders.delete("Content-Security-Policy-Report-Only");

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: newHeaders,
    });
  },
};
