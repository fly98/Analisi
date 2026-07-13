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

// Multi-account variant: "account" can be "business" (default, existing InternoUno mailbox)
// or "personal" (Filippo's personal Gmail, uses GMAIL_PERSONAL_REFRESH_TOKEN secret).
// Same OAuth client (GMAIL_CLIENT_ID/SECRET) is reused across accounts; only the refresh
// token differs, since each Google account grants its own consent/token.
async function getGmailAccessTokenFor(env, account) {
  const refreshToken = account === "personal" ? env.GMAIL_PERSONAL_REFRESH_TOKEN : env.GMAIL_REFRESH_TOKEN;
  if (!refreshToken) {
    return { error: `Nessun refresh token configurato per account "${account}"` };
  }
  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });
  return tokenResp.json();
}

// Decodifica base64url Gmail -> stringa UTF-8 corretta (evita mojibake su accenti/€)
function b64UrlToUtf8(data) {
  const std = (data || "").replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(std);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}
function gmailPlainText(part) {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body && part.body.data) return b64UrlToUtf8(part.body.data);
  if (part.parts) { for (const s of part.parts) { const t = gmailPlainText(s); if (t) return t; } }
  return "";
}
const IT_MESI = { gennaio:1, febbraio:2, marzo:3, aprile:4, maggio:5, giugno:6, luglio:7, agosto:8, settembre:9, ottobre:10, novembre:11, dicembre:12 };
function itDateToIso(str) {
  if (!str) return "";
  const m = str.match(/(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})/i);
  if (!m) return "";
  const d = String(m[1]).padStart(2, "0");
  const mm = String(IT_MESI[m[2].toLowerCase()]).padStart(2, "0");
  return `${m[3]}-${mm}-${d}`;
}
function numDaTesto(s) {
  if (!s) return 0;
  const m = s.replace(/\s/g, "").replace(/€|â¬|EUR/gi, "").match(/([\d.]*\d)(,\d+)?/);
  if (!m) return 0;
  const intero = (m[1] || "0").replace(/\./g, "");
  const dec = m[2] ? m[2].replace(",", ".") : "";
  return parseFloat(intero + dec) || 0;
}
// Parsa il corpo testuale di una mail di cancellazione Amenitiz
function parseCancEmail(text) {
  if (!text) return null;
  const val = (label, stop) => {
    // valore sulla/e riga/e dopo l'etichetta, fino alla prossima riga vuota o etichetta nota
    const re = new RegExp(label + "\\s*\\r?\\n+([\\s\\S]*?)(?:\\r?\\n\\r?\\n|$)", "i");
    const m = text.match(re);
    return m ? m[1].replace(/\r/g, "").split("\n").join(" ").trim() : "";
  };
  const idM = text.match(/ID di prenotazione\s*\r?\n+\s*(\d+)/i) || text.match(/prenotazione\s+(\d{6,})/i);
  const bookingId = idM ? idM[1].trim() : "";
  if (!bookingId) return null;
  const perLine = val("Prenotazione per");           // "5 notti, 1 camera"
  const nottiM = perLine.match(/(\d+)\s*nott/i);
  const arrivo = val("Data d'arrivo");
  const partenza = val("Data di partenza");
  const source = val("Provenienza");
  const cancelledBy = val("Annullato da");
  // Nome cliente: riga dopo "Informazioni cliente" (blocco isolato)
  let nome = "";
  const nm = text.match(/Informazioni cliente\s*\r?\n+([^\r\n]+)/i);
  if (nm) nome = nm[1].trim();
  const emailM = text.match(/Email\s+([^\s\r\n]+@[^\s\r\n]+)/i);
  const telM = text.match(/Telefono\s+([+\d][^\r\n]*)/i);
  const indM = text.match(/Indirizzo\s+([^\r\n]+)/i);
  // Riga dettaglio camera (dopo "Dettagli prenotazione")
  const detM = text.match(/Dettagli prenotazione\s*\r?\n+([\s\S]*?)\r?\n\r?\n/i);
  const detRaw = detM ? detM[1].replace(/\r/g, "").split("\n").join(" ").replace(/\s+/g, " ").trim() : "";
  const ospitiM = detRaw.match(/\((\d+)\s*osp/i);
  // Proprietà dalla via / nome nel dettaglio
  let property = "?";
  if (/Lorenzo il Magnifico|InternoUno Deluxe/i.test(detRaw)) property = "lor";
  else if (/Campaldino|InternoUno/i.test(detRaw)) property = "camp";
  // Tipo camera = parte prima di " - InternoUno"
  let roomType = detRaw.split(/\s*-\s*InternoUno/i)[0].trim();
  roomType = roomType.replace(/\s*\(\d+\s*osp.*$/i, "").trim();
  // Prezzi: tariffa camera (importo che precede "Tassa di soggiorno"), tassa, totale
  const taxM = text.match(/Tassa di soggiorno\s*\r?\n+\s*([^\r\n]+)/i);
  const totM = text.match(/Prezzo totale:?\s*\r?\n+\s*([^\r\n]+)/i);
  // la tariffa è l'ultimo importo prima di "Tassa di soggiorno"
  let rate = 0;
  const beforeTax = text.split(/Tassa di soggiorno/i)[0];
  const importi = beforeTax.match(/([\d.]*\d(?:,\d+)?)\s*(?:€|â¬)/g);
  if (importi && importi.length) rate = numDaTesto(importi[importi.length - 1]);
  const cityTax = taxM ? numDaTesto(taxM[1]) : 0;
  const total = totM ? numDaTesto(totM[1]) : (rate + cityTax);
  const parti = nome ? nome.split(/\s+/) : [];
  const first_name = parti.slice(0, -1).join(" ") || parti[0] || "";
  const last_name = parti.length > 1 ? parti[parti.length - 1] : "";
  const country = indM ? (indM[1].replace(/[.,]/g, " ").trim().split(/\s+/).pop() || "") : "";
  return {
    booking_id: bookingId,
    cancelled_by: cancelledBy,
    first_name, last_name, full_name: nome,
    email: emailM ? emailM[1].trim() : "",
    phone: telM ? telM[1].trim() : "",
    country,
    checkin: itDateToIso(arrivo),
    checkout: itDateToIso(partenza),
    nights: nottiM ? parseInt(nottiM[1]) : 0,
    guests: ospitiM ? parseInt(ospitiM[1]) : 0,
    source: source || "",
    property,
    room_type: roomType,
    rate, city_tax: cityTax, total,
  };
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

const REDIRECT_URI = "https://little-shadow-145e.f-castiglioni.workers.dev/oauth2callback";

function htmlPage(inner) {
  return new Response(
    "<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>" +
    "<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;line-height:1.5;color:#111}code{background:#eee;padding:2px 6px;border-radius:4px;font-size:13px}a{color:#007aff}textarea{font-size:13px}</style></head><body>" +
    inner + "</body></html>",
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}


// ====== CONTENUTO MULTILINGUA InternoUno Experience (stesso del frontend arrivi.html) ======
const EXP_COMMON = {
  it: {
    saluto_default:`Gentile ospite`,
    checkin_autonomia:`Per garantirle la massima comodità e rapidità, abbiamo organizzato per lei un <b>CHECK-IN IN AUTONOMIA</b>: potrà gestire il suo arrivo in totale libertà, senza attese, ritirando la chiave della sua camera da una cassetta di sicurezza esterna con codice. Le invierò con anticipo tutte le istruzioni necessarie per raggiungere la struttura e ritirare le chiavi.`,
    orario_arrivo:`Le saremmo comunque grati se volesse comunicarci in anticipo l'orario approssimativo del suo arrivo, così da poterci organizzare al meglio.`,
    pagamento:`Per quanto riguarda il <b>pagamento</b> del soggiorno (importo totale, saldo residuo se ha già versato un acconto, o la sola tassa di soggiorno se il totale è già stato saldato): posso inviarle un link sicuro per il pagamento online con carta di credito, oppure può saldare in contanti il giorno successivo con il mio collega, a partire dalle ore 8:00.`,
    exp_titolo:`📱 InternoUno Experience`,
    exp_intro:`Le consiglio di utilizzare la nostra InternoUno Experience durante tutto il soggiorno: una vera e propria app pensata per rendere la sua permanenza a Roma un'esperienza unica, sempre aggiornata e disponibile nella sua lingua.`,
    exp_trova:`Vi troverà:`,
    exp_li:[`tutte le informazioni sulla casa (check-in, WiFi, parcheggio, regole della struttura)`,`la mappa della zona con servizi utili e ristoranti selezionati da noi`,`eventi e concerti a Roma, aggiornati ogni giorno`,`i nostri tour audio gratuiti per esplorare la città a piedi`,`un assistente virtuale che risponde alle sue domande in qualsiasi momento e in qualsiasi lingua`],
    exp_cta:`Apra qui la sua InternoUno Experience →`,
    exp_tip:`Un consiglio: la salvi sulla schermata Home del telefono (basta un tap su "Aggiungi a Home" dal menu di condivisione del browser) — l'avrà sempre a portata di mano come una vera app, senza bisogno di scaricare nulla dagli store.`,
    raggiungerci_titolo:`🚆 Come raggiungerci`,
    mezzi_titolo:`Mezzi pubblici`,
    parcheggio_titolo:`Parcheggio`,
    taxi_titolo:`Taxi / Transfer aeroportuale`,
    social_titolo:`📸 Ci trovi anche sui social`,
    social_corpo:`Seguici su <a href="https://www.instagram.com/internounoguesthouse" style="color:#FF6628">Instagram @internounoguesthouse</a> e su <a href="https://www.facebook.com/internounobb" style="color:#FF6628">Facebook</a> per un assaggio di Roma, consigli di zona e le novità della struttura.`,
  },
  en: {
    saluto_default:`Dear guest`,
    checkin_autonomia:`To ensure maximum convenience and speed, we have organised a <b>SELF CHECK-IN</b> for you: you can manage your arrival in complete freedom, with no waiting, by collecting your room key from an external key safe with a code. I will send you all the necessary instructions in advance to reach the property and collect the keys.`,
    orario_arrivo:`We would still be grateful if you could let us know your approximate arrival time in advance, so that we can organise ourselves accordingly.`,
    pagamento:`Regarding <b>payment</b> for the stay (total amount, remaining balance if you've already paid a deposit, or just the city tax if the total has already been settled): I can send you a secure link for online payment by credit card, or you can pay in cash the following day with my colleague, from 8:00 AM onwards.`,
    exp_titolo:`📱 InternoUno Experience`,
    exp_intro:`We recommend using our InternoUno Experience throughout your stay: a genuine app designed to make your time in Rome a truly unique experience, always up to date and available in your language.`,
    exp_trova:`Inside you'll find:`,
    exp_li:[`all the information about the property (check-in, WiFi, parking, house rules)`,`a map of the area with useful services and restaurants we've handpicked`,`events and concerts in Rome, updated daily`,`our free audio tours to explore the city on foot`,`a virtual assistant that answers your questions at any time, in any language`],
    exp_cta:`Open your InternoUno Experience here →`,
    exp_tip:`A tip: save it to your phone's Home Screen (just tap "Add to Home Screen" from your browser's share menu) — you'll always have it at hand like a real app, with nothing to download from any app store.`,
    raggiungerci_titolo:`🚆 How to reach us`,
    mezzi_titolo:`By public transport`,
    parcheggio_titolo:`Parking`,
    taxi_titolo:`Taxi / Airport transfer`,
    social_titolo:`📸 Find us on social media too`,
    social_corpo:`Follow us on <a href="https://www.instagram.com/internounoguesthouse" style="color:#FF6628">Instagram @internounoguesthouse</a> and on <a href="https://www.facebook.com/internounobb" style="color:#FF6628">Facebook</a> for a taste of Rome, local tips, and updates from the property.`,
  },
  es: {
    saluto_default:`Estimado/a huésped`,
    checkin_autonomia:`Para garantizarle la máxima comodidad y rapidez, hemos organizado para usted un <b>CHECK-IN AUTÓNOMO</b>: podrá gestionar su llegada con total libertad, sin esperas, recogiendo la llave de su habitación de una caja de seguridad exterior con código. Le enviaré con antelación todas las instrucciones necesarias para llegar al alojamiento y recoger las llaves.`,
    orario_arrivo:`Le agradeceríamos igualmente que nos comunicara con antelación su hora aproximada de llegada, para poder organizarnos mejor.`,
    pagamento:`En cuanto al <b>pago</b> de la estancia (importe total, saldo restante si ya ha abonado un depósito, o solo la tasa turística si el total ya ha sido saldado): puedo enviarle un enlace seguro para el pago online con tarjeta de crédito, o puede pagar en efectivo al día siguiente con mi compañero, a partir de las 8:00.`,
    exp_titolo:`📱 InternoUno Experience`,
    exp_intro:`Le recomendamos utilizar nuestra InternoUno Experience durante toda su estancia: una auténtica aplicación pensada para convertir su paso por Roma en una experiencia única, siempre actualizada y disponible en su idioma.`,
    exp_trova:`En ella encontrará:`,
    exp_li:[`toda la información sobre la casa (check-in, WiFi, aparcamiento, normas del alojamiento)`,`el mapa de la zona con servicios útiles y restaurantes seleccionados por nosotros`,`eventos y conciertos en Roma, actualizados cada día`,`nuestros tours de audio gratuitos para explorar la ciudad a pie`,`un asistente virtual que responde a sus preguntas en cualquier momento y en cualquier idioma`],
    exp_cta:`Abra aquí su InternoUno Experience →`,
    exp_tip:`Un consejo: guárdela en la pantalla de inicio de su teléfono (basta con tocar "Añadir a pantalla de inicio" en el menú para compartir del navegador) — la tendrá siempre a mano como una aplicación real, sin necesidad de descargar nada de ninguna tienda de aplicaciones.`,
    raggiungerci_titolo:`🚆 Cómo llegar`,
    mezzi_titolo:`En transporte público`,
    parcheggio_titolo:`Aparcamiento`,
    taxi_titolo:`Taxi / Traslado al aeropuerto`,
    social_titolo:`📸 También nos encontrará en redes sociales`,
    social_corpo:`Síganos en <a href="https://www.instagram.com/internounoguesthouse" style="color:#FF6628">Instagram @internounoguesthouse</a> y en <a href="https://www.facebook.com/internounobb" style="color:#FF6628">Facebook</a> para descubrir un poco de Roma, consejos de la zona y las novedades del alojamiento.`,
  },
  fr: {
    saluto_default:`Cher/Chère client(e)`,
    checkin_autonomia:`Pour vous garantir un maximum de confort et de rapidité, nous avons organisé pour vous un <b>CHECK-IN EN AUTONOMIE</b> : vous pourrez gérer votre arrivée en toute liberté, sans attente, en récupérant la clé de votre chambre dans une boîte à clés sécurisée avec code, située à l'extérieur. Je vous enverrai à l'avance toutes les instructions nécessaires pour rejoindre l'établissement et récupérer les clés.`,
    orario_arrivo:`Nous vous serions toutefois reconnaissants de bien vouloir nous communiquer à l'avance votre heure d'arrivée approximative, afin que nous puissions nous organiser au mieux.`,
    pagamento:`Concernant le <b>paiement</b> du séjour (montant total, solde restant si vous avez déjà versé un acompte, ou seulement la taxe de séjour si le total a déjà été réglé) : je peux vous envoyer un lien sécurisé pour le paiement en ligne par carte bancaire, ou vous pouvez payer en espèces le lendemain avec mon collègue, à partir de 8h00.`,
    exp_titolo:`📱 InternoUno Experience`,
    exp_intro:`Je vous conseille d'utiliser notre InternoUno Experience pendant tout votre séjour : une véritable application pensée pour faire de votre passage à Rome une expérience unique, toujours à jour et disponible dans votre langue.`,
    exp_trova:`Vous y trouverez :`,
    exp_li:[`toutes les informations sur la maison (check-in, WiFi, parking, règlement intérieur)`,`la carte du quartier avec les services utiles et les restaurants que nous avons sélectionnés`,`les événements et concerts à Rome, mis à jour chaque jour`,`nos visites audio gratuites pour explorer la ville à pied`,`un assistant virtuel qui répond à vos questions à tout moment, dans n'importe quelle langue`],
    exp_cta:`Ouvrez ici votre InternoUno Experience →`,
    exp_tip:`Un conseil : ajoutez-la à l'écran d'accueil de votre téléphone (il suffit d'appuyer sur « Ajouter à l'écran d'accueil » dans le menu de partage de votre navigateur) — vous l'aurez toujours à portée de main comme une vraie application, sans rien à télécharger sur un store.`,
    raggiungerci_titolo:`🚆 Comment nous rejoindre`,
    mezzi_titolo:`En transports en commun`,
    parcheggio_titolo:`Parking`,
    taxi_titolo:`Taxi / Transfert aéroport`,
    social_titolo:`📸 Retrouvez-nous aussi sur les réseaux sociaux`,
    social_corpo:`Suivez-nous sur <a href="https://www.instagram.com/internounoguesthouse" style="color:#FF6628">Instagram @internounoguesthouse</a> et sur <a href="https://www.facebook.com/internounobb" style="color:#FF6628">Facebook</a> pour un avant-goût de Rome, des conseils sur le quartier et les actualités de l'établissement.`,
  },
  de: {
    saluto_default:`Sehr geehrter Gast`,
    checkin_autonomia:`Um Ihnen maximalen Komfort und Schnelligkeit zu garantieren, haben wir für Sie einen <b>SELBSTSTÄNDIGEN CHECK-IN</b> organisiert: Sie können Ihre Ankunft völlig frei und ohne Wartezeit gestalten, indem Sie den Schlüssel Ihres Zimmers aus einem externen Schlüsseltresor mit Code entnehmen. Ich sende Ihnen rechtzeitig alle notwendigen Anweisungen, um die Unterkunft zu erreichen und die Schlüssel abzuholen.`,
    orario_arrivo:`Wir wären Ihnen dennoch dankbar, wenn Sie uns Ihre ungefähre Ankunftszeit im Voraus mitteilen könnten, damit wir uns optimal darauf einstellen können.`,
    pagamento:`Zur <b>Zahlung</b> des Aufenthalts (Gesamtbetrag, Restbetrag falls bereits eine Anzahlung geleistet wurde, oder nur die Kurtaxe falls der Gesamtbetrag bereits beglichen wurde): Ich kann Ihnen einen sicheren Link für die Online-Zahlung per Kreditkarte senden, oder Sie können am nächsten Tag bar bei meinem Kollegen bezahlen, ab 8:00 Uhr.`,
    exp_titolo:`📱 InternoUno Experience`,
    exp_intro:`Wir empfehlen Ihnen, unsere InternoUno Experience während Ihres gesamten Aufenthalts zu nutzen: eine echte App, die Ihren Aufenthalt in Rom zu einem einzigartigen Erlebnis machen soll, stets aktuell und in Ihrer Sprache verfügbar.`,
    exp_trova:`Darin finden Sie:`,
    exp_li:[`alle Informationen zur Unterkunft (Check-in, WLAN, Parken, Hausordnung)`,`die Karte der Umgebung mit nützlichen Diensten und von uns ausgewählten Restaurants`,`Veranstaltungen und Konzerte in Rom, täglich aktualisiert`,`unsere kostenlosen Audio-Touren zur Erkundung der Stadt zu Fuß`,`einen virtuellen Assistenten, der Ihre Fragen jederzeit und in jeder Sprache beantwortet`],
    exp_cta:`Öffnen Sie hier Ihre InternoUno Experience →`,
    exp_tip:`Ein Tipp: Speichern Sie sie auf dem Startbildschirm Ihres Telefons (tippen Sie einfach auf „Zum Home-Bildschirm" im Freigabemenü Ihres Browsers) — Sie haben sie dann immer griffbereit wie eine echte App, ohne etwas aus einem Store herunterladen zu müssen.`,
    raggiungerci_titolo:`🚆 So erreichen Sie uns`,
    mezzi_titolo:`Öffentliche Verkehrsmittel`,
    parcheggio_titolo:`Parken`,
    taxi_titolo:`Taxi / Flughafentransfer`,
    social_titolo:`📸 Folgen Sie uns auch in den sozialen Medien`,
    social_corpo:`Folgen Sie uns auf <a href="https://www.instagram.com/internounoguesthouse" style="color:#FF6628">Instagram @internounoguesthouse</a> und auf <a href="https://www.facebook.com/internounobb" style="color:#FF6628">Facebook</a> für einen Vorgeschmack auf Rom, Tipps zur Umgebung und Neuigkeiten zur Unterkunft.`,
  },
  pt: {
    saluto_default:`Caro(a) hóspede`,
    checkin_autonomia:`Para lhe garantir a máxima comodidade e rapidez, organizámos para si um <b>CHECK-IN AUTÓNOMO</b>: poderá gerir a sua chegada com total liberdade, sem esperas, levantando a chave do seu quarto num cofre exterior com código. Enviar-lhe-ei com antecedência todas as instruções necessárias para chegar ao alojamento e levantar as chaves.`,
    orario_arrivo:`Agradecíamos igualmente que nos comunicasse com antecedência a sua hora aproximada de chegada, para que nos possamos organizar da melhor forma.`,
    pagamento:`Relativamente ao <b>pagamento</b> da estadia (montante total, saldo remanescente se já pagou um depósito, ou apenas a taxa turística se o total já foi liquidado): posso enviar-lhe um link seguro para pagamento online com cartão de crédito, ou pode pagar em dinheiro no dia seguinte com o meu colega, a partir das 8:00.`,
    exp_titolo:`📱 InternoUno Experience`,
    exp_intro:`Recomendamos que utilize a nossa InternoUno Experience durante toda a estadia: uma verdadeira aplicação pensada para tornar a sua passagem por Roma numa experiência única, sempre atualizada e disponível no seu idioma.`,
    exp_trova:`Nela encontrará:`,
    exp_li:[`todas as informações sobre a casa (check-in, WiFi, estacionamento, regras da propriedade)`,`o mapa da zona com serviços úteis e restaurantes selecionados por nós`,`eventos e concertos em Roma, atualizados diariamente`,`os nossos tours áudio gratuitos para explorar a cidade a pé`,`um assistente virtual que responde às suas perguntas a qualquer momento e em qualquer idioma`],
    exp_cta:`Abra aqui a sua InternoUno Experience →`,
    exp_tip:`Uma dica: guarde-a no ecrã principal do seu telemóvel (basta tocar em "Adicionar ao ecrã principal" no menu de partilha do navegador) — tê-la-á sempre à mão como uma verdadeira aplicação, sem necessidade de descarregar nada de qualquer loja de aplicações.`,
    raggiungerci_titolo:`🚆 Como chegar até nós`,
    mezzi_titolo:`Em transportes públicos`,
    parcheggio_titolo:`Estacionamento`,
    taxi_titolo:`Táxi / Transfer para o aeroporto`,
    social_titolo:`📸 Encontre-nos também nas redes sociais`,
    social_corpo:`Siga-nos no <a href="https://www.instagram.com/internounoguesthouse" style="color:#FF6628">Instagram @internounoguesthouse</a> e no <a href="https://www.facebook.com/internounobb" style="color:#FF6628">Facebook</a> para um pouco de Roma, dicas locais e novidades do alojamento.`,
  },
  zh: {
    saluto_default:`尊敬的客人`,
    checkin_autonomia:`为了给您带来最大的便利和效率，我们为您安排了<b>自助入住服务</b>：您可以自由、无需等待地安排到达时间，通过外部密码保险箱领取您房间的钥匙。我会提前发送给您到达民宿及领取钥匙所需的全部说明。`,
    orario_arrivo:`不过，如果您能提前告知我们大致的到达时间，以便我们更好地安排，我们将不胜感激。`,
    pagamento:`关于住宿的<b>付款</b>（全额房费，如已支付订金则为余款，或如全款已结清则仅为城市税）：我可以为您发送安全的在线信用卡支付链接，或您可以选择次日上午8点起与我的同事以现金支付。`,
    exp_titolo:`📱 InternoUno Experience`,
    exp_intro:`我们建议您在整个住宿期间使用我们的 InternoUno Experience：这是一款专为您打造的应用程序，旨在让您的罗马之旅成为一次独特的体验，内容实时更新，并支持您的语言。`,
    exp_trova:`您将在其中找到：`,
    exp_li:[`关于民宿的所有信息（入住、WiFi、停车、住宿规定）`,`周边地图，包含实用服务及我们精心挑选的餐厅`,`罗马的活动与音乐会信息，每日更新`,`我们提供的免费步行语音导览`,`一位虚拟助手，随时以任何语言回答您的问题`],
    exp_cta:`点击这里打开您的 InternoUno Experience →`,
    exp_tip:`小贴士：将它保存到手机主屏幕（只需在浏览器分享菜单中点击"添加到主屏幕"）——这样您就能像使用真正的应用一样随时使用它，无需从应用商店下载任何内容。`,
    raggiungerci_titolo:`🚆 如何抵达我们的民宿`,
    mezzi_titolo:`乘坐公共交通`,
    parcheggio_titolo:`停车`,
    taxi_titolo:`出租车 / 机场接送`,
    social_titolo:`📸 欢迎在社交媒体上关注我们`,
    social_corpo:`在 <a href="https://www.instagram.com/internounoguesthouse" style="color:#FF6628">Instagram 上关注我们：@internounoguesthouse</a>，也欢迎在 <a href="https://www.facebook.com/internounobb" style="color:#FF6628">Facebook</a> 上关注我们，了解罗马风情、当地小贴士及民宿的最新动态。`,
  },
};

const EXP_PROP = {
  camp: {
    it: {
      grazie:`la ringrazio per aver scelto InternoUno e le confermo la sua prenotazione.`,
      checkin_titolo:`IL CHECK-IN È POSSIBILE DALLE ORE 13:00.`,
      checkin_corpo:`Dalle 8:00 potrà comunque passare per effettuare la registrazione, lasciare i bagagli e ritirare le chiavi (la camera sarà accessibile una volta pulita e pronta dopo la partenza dell'ospite precedente).`,
      checkin_online:`Riceverà inoltre un messaggio per effettuare il check-in online: la invitiamo gentilmente a completarlo prima dell'arrivo per semplificare e velocizzare le procedure.`,
      checkout_titolo:`IL CHECK-OUT DOVRÀ AVVENIRE ENTRO LE 10:00.`,
      checkout_corpo:`È comunque possibile lasciare gratuitamente i bagagli in deposito (non custodito) dopo la partenza.`,
      mezzi_li:[`Se arrivate in treno e potete scendere a Stazione Tiburtina, ci troviamo a circa 600 metri (15 minuti a piedi o 5 minuti con gli autobus 490 o 495).`,`Se il vostro treno ferma solo a Stazione Termini, prendete la metro linea B fino a Piazza Bologna: da lì siamo a circa 500 metri (10 minuti a piedi).`,`Siamo inoltre vicini alla stazione degli autobus TIBUS, a circa 400 metri (10 minuti a piedi).`],
      parcheggio_corpo:`Via Campaldino e Via Cupa sono strade condominiali private: se disponibile, il parcheggio è gratuito. In alternativa, disponiamo di una convenzione con il Garage Di Nezza, situato sotto la struttura con ingresso da Via Cupa (tel. <a href="tel:+393208667617" style="color:#FF6628">+39 320 8667617</a>), al costo di 25 € al giorno per vetture standard (tariffa maggiore per auto di grande valore o dimensioni importanti).`,
      taxi_corpo:`Offriamo un servizio transfer privato dagli aeroporti di Roma al costo di 65 € (fino a 4 persone). Se desidera prenotarlo, la prego di rispondere a questa email indicando aeroporto di arrivo, numero del volo e orario esatto.`,
      chiusura:`La ringrazio nuovamente per la fiducia e resto a completa disposizione per qualsiasi informazione o richiesta.`,
      firma:`A presto,<br><b>Filippo</b><br>InternoUno<br>📍 Via Campaldino 6, 00162 Roma<br>📞 Tel. e WhatsApp: +39 392 299 9914<br>✉️ info@interno1.it`,
      url:`https://fly98.github.io/Analisi/campaldino.html`,
    },
    en: {
      grazie:`thank you for choosing InternoUno, and I confirm your booking.`,
      checkin_titolo:`CHECK-IN IS AVAILABLE FROM 1:00 PM.`,
      checkin_corpo:`From 8:00 AM, you may still stop by to register, leave your luggage and collect the keys (the room will be accessible once cleaned and ready after the previous guest's departure).`,
      checkin_online:`You will also receive a message to complete online check-in: we kindly invite you to fill it in before your arrival, to make the process quicker and easier.`,
      checkout_titolo:`CHECK-OUT MUST BE DONE BY 10:00 AM.`,
      checkout_corpo:`You may still leave your luggage in storage free of charge (unsupervised) after departure.`,
      mezzi_li:[`If you're arriving by train and can get off at Tiburtina Station, we're about 600 metres away (15 minutes on foot, or 5 minutes on bus 490 or 495).`,`If your train only stops at Termini Station, take metro Line B to Piazza Bologna: from there we're about 500 metres away (10 minutes on foot).`,`We're also close to the TIBUS bus station, about 400 metres away (10 minutes on foot).`],
      parcheggio_corpo:`Via Campaldino and Via Cupa are private condominium roads: when available, parking is free. Alternatively, we have an arrangement with Garage Di Nezza, located beneath the property with entrance from Via Cupa (tel. <a href="tel:+393208667617" style="color:#FF6628">+39 320 8667617</a>), at a cost of €25 per day for standard cars (higher rate for high-value or oversized vehicles).`,
      taxi_corpo:`We offer a private transfer service from Rome's airports at a cost of €65 (up to 4 people). If you'd like to book it, please reply to this email with your arrival airport, flight number, and exact arrival time.`,
      chiusura:`Thank you again for your trust — I remain fully available for any information or request.`,
      firma:`See you soon,<br><b>Filippo</b><br>InternoUno<br>📍 Via Campaldino 6, 00162 Rome, Italy<br>📞 Phone and WhatsApp: +39 392 299 9914<br>✉️ info@interno1.it`,
      url:`https://fly98.github.io/Analisi/campaldino.html`,
    },
    es: {
      grazie:`le agradezco que haya elegido InternoUno y le confirmo su reserva.`,
      checkin_titolo:`EL CHECK-IN ES POSIBLE A PARTIR DE LAS 13:00.`,
      checkin_corpo:`A partir de las 8:00, podrá igualmente pasar para registrarse, dejar el equipaje y recoger las llaves (la habitación estará disponible una vez limpia y lista tras la salida del huésped anterior).`,
      checkin_online:`Recibirá además un mensaje para realizar el check-in online: le invitamos a completarlo antes de su llegada, para simplificar y agilizar los trámites.`,
      checkout_titolo:`EL CHECK-OUT DEBERÁ REALIZARSE ANTES DE LAS 10:00.`,
      checkout_corpo:`Podrá igualmente dejar gratuitamente el equipaje en depósito (no vigilado) tras la salida.`,
      mezzi_li:[`Si llega en tren y puede bajarse en la Estación de Tiburtina, estamos a unos 600 metros (15 minutos a pie, o 5 minutos en autobús 490 o 495).`,`Si su tren solo para en la Estación de Termini, tome la línea B del metro hasta Piazza Bologna: desde allí estamos a unos 500 metros (10 minutos a pie).`,`Estamos también cerca de la estación de autobuses TIBUS, a unos 400 metros (10 minutos a pie).`],
      parcheggio_corpo:`Via Campaldino y Via Cupa son calles privadas del vecindario: cuando hay sitio, aparcar es gratis. Como alternativa, disponemos de un acuerdo con el Garage Di Nezza, situado bajo el alojamiento con entrada por Via Cupa (tel. <a href="tel:+393208667617" style="color:#FF6628">+39 320 8667617</a>), con un coste de 25 € al día para vehículos estándar (tarifa superior para coches de gran valor o de gran tamaño).`,
      taxi_corpo:`Ofrecemos un servicio de traslado privado desde los aeropuertos de Roma con un coste de 65 € (hasta 4 personas). Si desea reservarlo, le rogamos que responda a este correo indicando el aeropuerto de llegada, el número de vuelo y la hora exacta de llegada.`,
      chiusura:`Le agradezco nuevamente su confianza y quedo a su entera disposición para cualquier información o solicitud.`,
      firma:`Hasta pronto,<br><b>Filippo</b><br>InternoUno<br>📍 Via Campaldino 6, 00162 Roma, Italia<br>📞 Tel. y WhatsApp: +39 392 299 9914<br>✉️ info@interno1.it`,
      url:`https://fly98.github.io/Analisi/campaldino.html`,
    },
    fr: {
      grazie:`je vous remercie d'avoir choisi InternoUno et je vous confirme votre réservation.`,
      checkin_titolo:`LE CHECK-IN EST POSSIBLE À PARTIR DE 13H00.`,
      checkin_corpo:`À partir de 8h00, vous pourrez tout de même passer pour enregistrer votre arrivée, déposer vos bagages et récupérer les clés (la chambre sera accessible une fois nettoyée et prête après le départ du client précédent).`,
      checkin_online:`Vous recevrez également un message pour effectuer le check-in en ligne : nous vous invitons à le compléter avant votre arrivée, afin de simplifier et d'accélérer les démarches.`,
      checkout_titolo:`LE CHECK-OUT DEVRA AVOIR LIEU AVANT 10H00.`,
      checkout_corpo:`Vous pourrez tout de même laisser gratuitement vos bagages en consigne (non surveillée) après votre départ.`,
      mezzi_li:[`Si vous arrivez en train et pouvez descendre à la gare de Tiburtina, nous sommes à environ 600 mètres (15 minutes à pied, ou 5 minutes en bus 490 ou 495).`,`Si votre train ne s'arrête qu'à la gare de Termini, prenez la ligne B du métro jusqu'à Piazza Bologna : de là, nous sommes à environ 500 mètres (10 minutes à pied).`,`Nous sommes également proches de la gare routière TIBUS, à environ 400 mètres (10 minutes à pied).`],
      parcheggio_corpo:`Via Campaldino et Via Cupa sont des rues privées de la copropriété : lorsqu'il y a de la place, le stationnement est gratuit. Nous avons également un accord avec le Garage Di Nezza, situé sous l'établissement avec une entrée par Via Cupa (tél. <a href="tel:+393208667617" style="color:#FF6628">+39 320 8667617</a>), au tarif de 25 € par jour pour les véhicules standards (tarif plus élevé pour les voitures de grande valeur ou de grande taille).`,
      taxi_corpo:`Nous proposons un service de transfert privé depuis les aéroports de Rome au coût de 65 € (jusqu'à 4 personnes). Si vous souhaitez le réserver, merci de répondre à cet email en indiquant l'aéroport d'arrivée, le numéro de vol et l'heure exacte d'arrivée.`,
      chiusura:`Je vous remercie encore pour votre confiance et reste à votre entière disposition pour toute information ou demande.`,
      firma:`À bientôt,<br><b>Filippo</b><br>InternoUno<br>📍 Via Campaldino 6, 00162 Rome, Italie<br>📞 Tél. et WhatsApp : +39 392 299 9914<br>✉️ info@interno1.it`,
      url:`https://fly98.github.io/Analisi/campaldino.html`,
    },
    de: {
      grazie:`vielen Dank, dass Sie sich für InternoUno entschieden haben. Hiermit bestätige ich Ihre Reservierung.`,
      checkin_titolo:`CHECK-IN IST AB 13:00 UHR MÖGLICH.`,
      checkin_corpo:`Ab 8:00 Uhr können Sie dennoch vorbeikommen, um sich zu registrieren, Ihr Gepäck abzugeben und die Schlüssel abzuholen (das Zimmer ist zugänglich, sobald es nach der Abreise des vorherigen Gastes gereinigt und bereit ist).`,
      checkin_online:`Sie erhalten außerdem eine Nachricht zur Durchführung des Online-Check-ins: Wir bitten Sie freundlich, diesen vor Ihrer Ankunft auszufüllen, um den Ablauf einfacher und schneller zu gestalten.`,
      checkout_titolo:`CHECK-OUT MUSS BIS 10:00 UHR ERFOLGEN.`,
      checkout_corpo:`Sie können Ihr Gepäck nach der Abreise weiterhin kostenlos (unbeaufsichtigt) aufbewahren lassen.`,
      mezzi_li:[`Wenn Sie mit dem Zug anreisen und am Bahnhof Tiburtina aussteigen können, sind wir etwa 600 Meter entfernt (15 Minuten zu Fuß oder 5 Minuten mit dem Bus 490 oder 495).`,`Wenn Ihr Zug nur am Bahnhof Termini hält, nehmen Sie die U-Bahn-Linie B bis Piazza Bologna: von dort sind wir etwa 500 Meter entfernt (10 Minuten zu Fuß).`,`Wir sind außerdem in der Nähe des Busbahnhofs TIBUS, etwa 400 Meter entfernt (10 Minuten zu Fuß).`],
      parcheggio_corpo:`Via Campaldino und Via Cupa sind private Anliegerstraßen: Wenn verfügbar, ist das Parken kostenlos. Alternativ haben wir eine Vereinbarung mit der Garage Di Nezza, die sich unter der Unterkunft mit Zufahrt von der Via Cupa befindet (Tel. <a href="tel:+393208667617" style="color:#FF6628">+39 320 8667617</a>), zu einem Preis von 25 € pro Tag für Standardfahrzeuge (höherer Tarif für besonders wertvolle oder große Fahrzeuge).`,
      taxi_corpo:`Wir bieten einen privaten Transferservice von den Flughäfen Roms zum Preis von 65 € (bis zu 4 Personen) an. Falls Sie ihn buchen möchten, antworten Sie bitte auf diese E-Mail mit Ankunftsflughafen, Flugnummer und genauer Ankunftszeit.`,
      chiusura:`Ich danke Ihnen nochmals für Ihr Vertrauen und stehe Ihnen für jegliche Informationen oder Anfragen gerne zur Verfügung.`,
      firma:`Bis bald,<br><b>Filippo</b><br>InternoUno<br>📍 Via Campaldino 6, 00162 Rom, Italien<br>📞 Tel. und WhatsApp: +39 392 299 9914<br>✉️ info@interno1.it`,
      url:`https://fly98.github.io/Analisi/campaldino.html`,
    },
    pt: {
      grazie:`agradeço por ter escolhido a InternoUno e confirmo a sua reserva.`,
      checkin_titolo:`O CHECK-IN É POSSÍVEL A PARTIR DAS 13:00.`,
      checkin_corpo:`A partir das 8:00, poderá igualmente passar para se registar, deixar a bagagem e levantar as chaves (o quarto estará acessível assim que estiver limpo e pronto após a partida do hóspede anterior).`,
      checkin_online:`Receberá também uma mensagem para efetuar o check-in online: convidamo-lo a preenchê-lo antes da chegada, para simplificar e agilizar o processo.`,
      checkout_titolo:`O CHECK-OUT DEVERÁ SER EFETUADO ATÉ ÀS 10:00.`,
      checkout_corpo:`Poderá igualmente deixar a bagagem em depósito gratuitamente (não vigiado) após a partida.`,
      mezzi_li:[`Se chegar de comboio e puder sair na Estação de Tiburtina, estamos a cerca de 600 metros (15 minutos a pé, ou 5 minutos de autocarro 490 ou 495).`,`Se o seu comboio só parar na Estação de Termini, apanhe a linha B do metro até Piazza Bologna: a partir daí estamos a cerca de 500 metros (10 minutos a pé).`,`Estamos também perto da estação de autocarros TIBUS, a cerca de 400 metros (10 minutos a pé).`],
      parcheggio_corpo:`Via Campaldino e Via Cupa são ruas privadas do condomínio: quando disponível, o estacionamento é gratuito. Em alternativa, temos um acordo com a Garage Di Nezza, situada por baixo do alojamento com entrada pela Via Cupa (tel. <a href="tel:+393208667617" style="color:#FF6628">+39 320 8667617</a>), a um custo de 25 € por dia para veículos standard (tarifa mais alta para carros de grande valor ou de grandes dimensões).`,
      taxi_corpo:`Oferecemos um serviço de transfer privado a partir dos aeroportos de Roma, a um custo de 65 € (até 4 pessoas). Se desejar reservá-lo, agradeço que responda a este email indicando o aeroporto de chegada, o número do voo e a hora exata de chegada.`,
      chiusura:`Agradeço novamente a sua confiança e permaneço à sua inteira disposição para qualquer informação ou pedido.`,
      firma:`Até breve,<br><b>Filippo</b><br>InternoUno<br>📍 Via Campaldino 6, 00162 Roma, Itália<br>📞 Tel. e WhatsApp: +39 392 299 9914<br>✉️ info@interno1.it`,
      url:`https://fly98.github.io/Analisi/campaldino.html`,
    },
    zh: {
      grazie:`感谢您选择 InternoUno，现确认您的预订。`,
      checkin_titolo:`入住时间为下午1点起。`,
      checkin_corpo:`从上午8点起，您也可以先到民宿办理登记、寄存行李并领取钥匙，但房间需等待前一位客人退房及打扫完毕后方可入住。`,
      checkin_online:`您还将收到一条用于完成在线入住登记的信息：建议您在到达前完成填写，以便更快捷、更顺利地办理手续。`,
      checkout_titolo:`退房时间为上午10点前。`,
      checkout_corpo:`退房后，您仍可免费寄存行李（无专人看管）。`,
      mezzi_li:[`如果您乘火车抵达并可以在蒂布尔蒂纳车站（Stazione Tiburtina）下车，我们距离约600米（步行15分钟，或乘坐490路或495路公交车5分钟）。`,`如果您的火车只停靠特米尼车站（Stazione Termini），可乘坐地铁B线前往博洛尼亚广场（Piazza Bologna）：从那里步行约10分钟（约500米）即可到达。`,`我们同时也靠近TIBUS长途汽车站，步行约10分钟（约400米）。`],
      parcheggio_corpo:`Via Campaldino 和 Via Cupa 是小区私用道路：如有空位可免费停车。此外，我们与楼下的 Di Nezza 车库有合作，入口在 Via Cupa（电话 <a href="tel:+393208667617" style="color:#FF6628">+39 320 8667617</a>），标准车辆收费为每天25欧元（高价值或超大型车辆费用更高）。`,
      taxi_corpo:`我们提供从罗马各机场出发的私人接送服务，4人以内收费65欧元。如需预订，请回复此邮件并告知抵达机场、航班号及准确到达时间。`,
      chiusura:`再次感谢您的信任，如有任何问题或需求，我随时为您服务。`,
      firma:`期待再见，<br><b>Filippo</b><br>InternoUno<br>📍 地址：Via Campaldino 6, 00162 罗马<br>📞 电话 / WhatsApp：+39 392 299 9914<br>✉️ 邮箱：info@interno1.it`,
      url:`https://fly98.github.io/Analisi/campaldino.html`,
    },
  },
  lor: {
    it: {
      grazie:`la ringrazio per aver scelto InternoUno Deluxe e le confermo la sua prenotazione.`,
      checkin_titolo:`IL CHECK-IN POTRÀ ESSERE EFFETTUATO DALLE ORE 13:00.`,
      checkin_corpo:`A partire dalle 8:00, sarà comunque possibile passare per lasciare i bagagli e ritirare le chiavi, anche se la camera sarà disponibile solo dopo la pulizia e la partenza del cliente precedente.`,
      checkin_online:`Riceverà inoltre un messaggio per effettuare il check-in online: la invito a completarlo prima dell'arrivo, così da rendere più rapido e semplice il suo ingresso in struttura.`,
      checkout_titolo:`IL CHECK-OUT DOVRÀ ESSERE EFFETTUATO ENTRO LE ORE 10:00.`,
      checkout_corpo:`In caso di necessità, potrà lasciare gratuitamente i bagagli in deposito (non custodito).`,
      mezzi_li:[`Se arriva in treno alla Stazione Tiburtina, siamo proprio di fronte: sarà sufficiente attraversare la strada.`,`Se il suo treno ferma solo a Stazione Termini, può prendere la metro linea B fino a Stazione Tiburtina (circa 10 minuti di tragitto).`,`Siamo inoltre molto vicini alla stazione degli autobus TIBUS, a circa 300 metri (5 minuti a piedi).`],
      parcheggio_corpo:`Disponiamo di una convenzione con il Garage Bologna (Via Lorenzo il Magnifico, 83 – Tel. <a href="tel:+390644242664" style="color:#FF6628">06 4424 2664</a>), situato a 200 metri dalla struttura, al costo di 25 € al giorno per vetture standard (tariffa maggiore per auto di grande valore o dimensioni importanti).`,
      taxi_corpo:`È disponibile un servizio di transfer privato da e per l'aeroporto, al costo di 65 € fino a 4 persone. Se desidera prenotarlo, la prego di rispondere a questa email indicando l'aeroporto di arrivo, il numero del volo e l'orario esatto di arrivo.`,
      chiusura:`La ringrazio nuovamente per la fiducia e le porgo i miei più cordiali saluti. Non vedo l'ora di accoglierla a Roma!`,
      firma:`Filippo<br><b>InternoUno Deluxe</b><br>📍 Via Lorenzo il Magnifico 158, 00162 Roma<br>📞 Tel / WhatsApp: +39 392 299 9914<br>✉️ info@interno1.it`,
      url:`https://fly98.github.io/Analisi/lorenzo.html`,
    },
    en: {
      grazie:`thank you for choosing InternoUno Deluxe, and I confirm your booking.`,
      checkin_titolo:`CHECK-IN CAN BE DONE FROM 1:00 PM.`,
      checkin_corpo:`From 8:00 AM, you may still stop by to leave your luggage and collect the keys, although the room will only be available once it has been cleaned and vacated by the previous guest.`,
      checkin_online:`You will also receive a message to complete online check-in: I invite you to fill it in before your arrival, to make your entry to the property quicker and easier.`,
      checkout_titolo:`CHECK-OUT MUST BE DONE BY 10:00 AM.`,
      checkout_corpo:`If needed, you may leave your luggage in storage free of charge (unsupervised).`,
      mezzi_li:[`If you're arriving by train at Tiburtina Station, we're right opposite it: just cross the street.`,`If your train only stops at Termini Station, you can take metro Line B to Tiburtina Station (about 10 minutes).`,`We're also very close to the TIBUS bus station, about 300 metres away (5 minutes on foot).`],
      parcheggio_corpo:`We have an arrangement with Garage Bologna (Via Lorenzo il Magnifico, 83 – Tel. <a href="tel:+390644242664" style="color:#FF6628">+39 06 4424 2664</a>), located 200 metres from the property, at a cost of €25 per day for standard cars (higher rate for high-value or oversized vehicles).`,
      taxi_corpo:`A private airport transfer service is available, at a cost of €65 for up to 4 people. If you'd like to book it, please reply to this email with your arrival airport, flight number, and exact arrival time.`,
      chiusura:`Thank you again for your trust, and best regards. I look forward to welcoming you to Rome!`,
      firma:`Filippo<br><b>InternoUno Deluxe</b><br>📍 Via Lorenzo il Magnifico 158, 00162 Rome, Italy<br>📞 Phone / WhatsApp: +39 392 299 9914<br>✉️ info@interno1.it`,
      url:`https://fly98.github.io/Analisi/lorenzo.html`,
    },
    es: {
      grazie:`le agradezco que haya elegido InternoUno Deluxe y le confirmo su reserva.`,
      checkin_titolo:`EL CHECK-IN PODRÁ REALIZARSE A PARTIR DE LAS 13:00.`,
      checkin_corpo:`A partir de las 8:00, será posible de todos modos pasar a dejar el equipaje y recoger las llaves, aunque la habitación estará disponible solo después de la limpieza y la salida del cliente anterior.`,
      checkin_online:`Recibirá además un mensaje para realizar el check-in online: le invito a completarlo antes de su llegada, para que su entrada al alojamiento sea más rápida y sencilla.`,
      checkout_titolo:`EL CHECK-OUT DEBERÁ REALIZARSE ANTES DE LAS 10:00.`,
      checkout_corpo:`En caso de necesidad, podrá dejar gratuitamente el equipaje en depósito (no vigilado).`,
      mezzi_li:[`Si llega en tren a la Estación de Tiburtina, estamos justo enfrente: solo tendrá que cruzar la calle.`,`Si su tren solo para en la Estación de Termini, puede tomar la línea B del metro hasta la Estación de Tiburtina (unos 10 minutos de trayecto).`,`Estamos también muy cerca de la estación de autobuses TIBUS, a unos 300 metros (5 minutos a pie).`],
      parcheggio_corpo:`Disponemos de un acuerdo con el Garage Bologna (Via Lorenzo il Magnifico, 83 – Tel. <a href="tel:+390644242664" style="color:#FF6628">+39 06 4424 2664</a>), situado a 200 metros del alojamiento, con un coste de 25 € al día para vehículos estándar (tarifa superior para coches de gran valor o de gran tamaño).`,
      taxi_corpo:`Disponemos de un servicio de traslado privado desde/hacia el aeropuerto, con un coste de 65 € para hasta 4 personas. Si desea reservarlo, le rogamos que responda a este correo indicando el aeropuerto de llegada, el número de vuelo y la hora exacta de llegada.`,
      chiusura:`Le agradezco nuevamente su confianza y le envío un cordial saludo. ¡Estoy deseando darle la bienvenida a Roma!`,
      firma:`Filippo<br><b>InternoUno Deluxe</b><br>📍 Via Lorenzo il Magnifico 158, 00162 Roma, Italia<br>📞 Tel / WhatsApp: +39 392 299 9914<br>✉️ info@interno1.it`,
      url:`https://fly98.github.io/Analisi/lorenzo.html`,
    },
    fr: {
      grazie:`je vous remercie d'avoir choisi InternoUno Deluxe et je vous confirme votre réservation.`,
      checkin_titolo:`LE CHECK-IN POURRA ÊTRE EFFECTUÉ À PARTIR DE 13H00.`,
      checkin_corpo:`À partir de 8h00, il sera tout de même possible de passer pour déposer vos bagages et récupérer les clés, bien que la chambre ne soit disponible qu'après le nettoyage et le départ du client précédent.`,
      checkin_online:`Vous recevrez également un message pour effectuer le check-in en ligne : je vous invite à le compléter avant votre arrivée, afin de rendre votre entrée dans l'établissement plus rapide et plus simple.`,
      checkout_titolo:`LE CHECK-OUT DEVRA ÊTRE EFFECTUÉ AVANT 10H00.`,
      checkout_corpo:`En cas de besoin, vous pourrez laisser gratuitement vos bagages en consigne (non surveillée).`,
      mezzi_li:[`Si vous arrivez en train à la gare de Tiburtina, nous sommes juste en face : il vous suffira de traverser la rue.`,`Si votre train ne s'arrête qu'à la gare de Termini, vous pouvez prendre la ligne B du métro jusqu'à la gare de Tiburtina (environ 10 minutes de trajet).`,`Nous sommes également très proches de la gare routière TIBUS, à environ 300 mètres (5 minutes à pied).`],
      parcheggio_corpo:`Nous avons un accord avec le Garage Bologna (Via Lorenzo il Magnifico, 83 – Tél. <a href="tel:+390644242664" style="color:#FF6628">+39 06 4424 2664</a>), situé à 200 mètres de l'établissement, au tarif de 25 € par jour pour les véhicules standards (tarif plus élevé pour les voitures de grande valeur ou de grande taille).`,
      taxi_corpo:`Un service de transfert privé depuis/vers l'aéroport est disponible, au coût de 65 € jusqu'à 4 personnes. Si vous souhaitez le réserver, merci de répondre à cet email en indiquant l'aéroport d'arrivée, le numéro de vol et l'heure exacte d'arrivée.`,
      chiusura:`Je vous remercie encore pour votre confiance et vous prie d'agréer mes salutations les plus cordiales. J'ai hâte de vous accueillir à Rome !`,
      firma:`Filippo<br><b>InternoUno Deluxe</b><br>📍 Via Lorenzo il Magnifico 158, 00162 Rome, Italie<br>📞 Tél / WhatsApp : +39 392 299 9914<br>✉️ info@interno1.it`,
      url:`https://fly98.github.io/Analisi/lorenzo.html`,
    },
    de: {
      grazie:`vielen Dank, dass Sie sich für InternoUno Deluxe entschieden haben. Hiermit bestätige ich Ihre Reservierung.`,
      checkin_titolo:`CHECK-IN KANN AB 13:00 UHR ERFOLGEN.`,
      checkin_corpo:`Ab 8:00 Uhr können Sie dennoch vorbeikommen, um Ihr Gepäck abzugeben und die Schlüssel abzuholen, auch wenn das Zimmer erst nach der Reinigung und dem Auszug des vorherigen Gastes verfügbar ist.`,
      checkin_online:`Sie erhalten außerdem eine Nachricht zur Durchführung des Online-Check-ins: Ich bitte Sie, diesen vor Ihrer Ankunft auszufüllen, um Ihren Check-in schneller und einfacher zu gestalten.`,
      checkout_titolo:`CHECK-OUT MUSS BIS 10:00 UHR ERFOLGEN.`,
      checkout_corpo:`Bei Bedarf können Sie Ihr Gepäck kostenlos (unbeaufsichtigt) aufbewahren lassen.`,
      mezzi_li:[`Wenn Sie mit dem Zug am Bahnhof Tiburtina ankommen, sind wir genau gegenüber: Sie müssen nur die Straße überqueren.`,`Wenn Ihr Zug nur am Bahnhof Termini hält, können Sie die U-Bahn-Linie B bis zum Bahnhof Tiburtina nehmen (etwa 10 Minuten).`,`Wir sind außerdem sehr nah am Busbahnhof TIBUS, etwa 300 Meter entfernt (5 Minuten zu Fuß).`],
      parcheggio_corpo:`Wir haben eine Vereinbarung mit der Garage Bologna (Via Lorenzo il Magnifico, 83 – Tel. <a href="tel:+390644242664" style="color:#FF6628">+39 06 4424 2664</a>), 200 Meter von der Unterkunft entfernt, zu einem Preis von 25 € pro Tag für Standardfahrzeuge (höherer Tarif für besonders wertvolle oder große Fahrzeuge).`,
      taxi_corpo:`Ein privater Flughafentransferservice ist verfügbar, zum Preis von 65 € für bis zu 4 Personen. Falls Sie ihn buchen möchten, antworten Sie bitte auf diese E-Mail mit Ankunftsflughafen, Flugnummer und genauer Ankunftszeit.`,
      chiusura:`Ich danke Ihnen nochmals für Ihr Vertrauen und verbleibe mit freundlichen Grüßen. Ich freue mich darauf, Sie in Rom willkommen zu heißen!`,
      firma:`Filippo<br><b>InternoUno Deluxe</b><br>📍 Via Lorenzo il Magnifico 158, 00162 Rom, Italien<br>📞 Tel / WhatsApp: +39 392 299 9914<br>✉️ info@interno1.it`,
      url:`https://fly98.github.io/Analisi/lorenzo.html`,
    },
    pt: {
      grazie:`agradeço por ter escolhido a InternoUno Deluxe e confirmo a sua reserva.`,
      checkin_titolo:`O CHECK-IN PODERÁ SER EFETUADO A PARTIR DAS 13:00.`,
      checkin_corpo:`A partir das 8:00, será possível na mesma passar para deixar a bagagem e levantar as chaves, embora o quarto só esteja disponível depois da limpeza e da saída do cliente anterior.`,
      checkin_online:`Receberá também uma mensagem para efetuar o check-in online: convido-o a preenchê-lo antes da sua chegada, para tornar a sua entrada no alojamento mais rápida e simples.`,
      checkout_titolo:`O CHECK-OUT DEVERÁ SER EFETUADO ATÉ ÀS 10:00.`,
      checkout_corpo:`Caso necessário, poderá deixar a bagagem em depósito gratuitamente (não vigiado).`,
      mezzi_li:[`Se chegar de comboio à Estação de Tiburtina, estamos mesmo em frente: basta atravessar a rua.`,`Se o seu comboio só parar na Estação de Termini, pode apanhar a linha B do metro até à Estação de Tiburtina (cerca de 10 minutos de percurso).`,`Estamos também muito perto da estação de autocarros TIBUS, a cerca de 300 metros (5 minutos a pé).`],
      parcheggio_corpo:`Temos um acordo com a Garage Bologna (Via Lorenzo il Magnifico, 83 – Tel. <a href="tel:+390644242664" style="color:#FF6628">+39 06 4424 2664</a>), situada a 200 metros do alojamento, a um custo de 25 € por dia para veículos standard (tarifa mais alta para carros de grande valor ou de grandes dimensões).`,
      taxi_corpo:`Está disponível um serviço de transfer privado de/para o aeroporto, a um custo de 65 € até 4 pessoas. Se desejar reservá-lo, agradeço que responda a este email indicando o aeroporto de chegada, o número do voo e a hora exata de chegada.`,
      chiusura:`Agradeço novamente a sua confiança e envio os meus melhores cumprimentos. Estou ansioso por recebê-lo em Roma!`,
      firma:`Filippo<br><b>InternoUno Deluxe</b><br>📍 Via Lorenzo il Magnifico 158, 00162 Roma, Itália<br>📞 Tel / WhatsApp: +39 392 299 9914<br>✉️ info@interno1.it`,
      url:`https://fly98.github.io/Analisi/lorenzo.html`,
    },
    zh: {
      grazie:`感谢您选择 InternoUno Deluxe，现确认您的预订。`,
      checkin_titolo:`入住时间为下午1点起。`,
      checkin_corpo:`从上午8点起，您也可以先到民宿寄存行李并领取钥匙，但房间要等前一位客人退房并完成清洁后才能入住。`,
      checkin_online:`您还将收到一条用于完成在线入住登记的信息：建议您在到达前完成填写，以便更快捷、更顺利地办理入住手续。`,
      checkout_titolo:`退房时间为上午10点前。`,
      checkout_corpo:`如有需要，您可以免费寄存行李（无专人看管）。`,
      mezzi_li:[`如果您乘火车抵达蒂布尔蒂纳车站（Stazione Tiburtina），我们就在车站正对面，只需过马路即可到达。`,`如果您的火车只停靠特米尼车站（Stazione Termini），可乘坐地铁B线前往蒂布尔蒂纳车站（约10分钟车程）。`,`我们同时也非常靠近TIBUS长途汽车站，步行约5分钟（约300米）。`],
      parcheggio_corpo:`我们与 Garage Bologna 车库有合作，距离约200米，每天25欧元（标准车辆；高价值或超大型车辆费用更高）：Via Lorenzo il Magnifico 83，电话 <a href="tel:+390644242664" style="color:#FF6628">+39 06 4424 2664</a>。`,
      taxi_corpo:`我们提供私人机场接送服务，4人以内收费65欧元。如需预订，请回复此邮件并告知抵达机场、航班号及准确到达时间。`,
      chiusura:`再次感谢您的信任，致以最诚挚的问候。期待在罗马迎接您的到来！`,
      firma:`Filippo<br><b>InternoUno Deluxe</b><br>📍 地址：Via Lorenzo il Magnifico 158, 00162 罗马<br>📞 电话 / WhatsApp：+39 392 299 9914<br>✉️ 邮箱：info@interno1.it`,
      url:`https://fly98.github.io/Analisi/lorenzo.html`,
    },
  },
};
function buildExpHtml(propKey, lng, nome){
  const L = EXP_COMMON[lng] || EXP_COMMON.en;
  const P = (EXP_PROP[propKey] && EXP_PROP[propKey][lng]) || EXP_PROP[propKey].en;
  const saluto = nome ? nome : L.saluto_default;
  const virgola = (lng==="zh") ? "，" : ",";
  const liHtml = L.exp_li.map(x=>`  <li>${x}</li>`).join("\n");
  const mezziHtml = P.mezzi_li.map(x=>`  <li>${x}</li>`).join("\n");
  const url = P.url;
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#222">
<p>${saluto}${virgola}</p>
<p>${P.grazie}</p>
<p>${L.checkin_autonomia}</p>
<p>${L.orario_arrivo}</p>
<p>${L.pagamento}</p>
<h3 style="color:#2a2622;font-size:15px;margin:20px 0 6px">${P.checkin_titolo}</h3>
<p>${P.checkin_corpo}</p>
<p>${P.checkin_online}</p>
<h3 style="color:#2a2622;font-size:15px;margin:20px 0 6px">${P.checkout_titolo}</h3>
<p>${P.checkout_corpo}</p>
<h2 style="color:#FF6628;font-size:18px;margin:26px 0 10px">${L.exp_titolo}</h2>
<p>${L.exp_intro}</p>
<p>${L.exp_trova}</p>
<ul style="margin:6px 0 6px 18px;padding:0">
${liHtml}
</ul>
<p style="text-align:center"><a href="${url}" style="display:inline-block;background:#FF6628;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:bold;margin:6px 0">${L.exp_cta}</a></p>
<p>${L.exp_tip}</p>
<hr style="border:none;border-top:1px solid #e5e3df;margin:24px 0">
<h2 style="color:#FF6628;font-size:18px;margin:26px 0 10px">${L.raggiungerci_titolo}</h2>
<h3 style="color:#2a2622;font-size:15px;margin:20px 0 6px">${L.mezzi_titolo}</h3>
<ul style="margin:6px 0 6px 18px;padding:0">
${mezziHtml}
</ul>
<h3 style="color:#2a2622;font-size:15px;margin:20px 0 6px">${L.parcheggio_titolo}</h3>
<p>${P.parcheggio_corpo}</p>
<h3 style="color:#2a2622;font-size:15px;margin:20px 0 6px">${L.taxi_titolo}</h3>
<p>${P.taxi_corpo}</p>
<h2 style="color:#FF6628;font-size:18px;margin:26px 0 10px">${L.social_titolo}</h2>
<p>${L.social_corpo}</p>
<hr style="border:none;border-top:1px solid #e5e3df;margin:24px 0">
<p>${P.chiusura}</p>
<p>${P.firma}</p>
</div>`;
}

// Versione "essenziale": solo le info pratiche (check-in/check-out, pagamento, come raggiungerci),
// SENZA il blocco promozionale InternoUno Experience/App e SENZA il blocco social.
// Pensata per l'invio automatico pre-arrivo su TUTTI i canali (incluso Booking.com), a differenza
// di buildExpHtml/runAutoSend che è solo per prenotazioni dirette non-Booking.
function buildEssentialsHtml(propKey, lng, nome){
  const L = EXP_COMMON[lng] || EXP_COMMON.en;
  const P = (EXP_PROP[propKey] && EXP_PROP[propKey][lng]) || EXP_PROP[propKey].en;
  const saluto = nome ? nome : L.saluto_default;
  const virgola = (lng==="zh") ? "，" : ",";
  const mezziHtml = P.mezzi_li.map(x=>`  <li>${x}</li>`).join("\n");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#222">
<p>${saluto}${virgola}</p>
<p>${P.grazie}</p>
<p>${L.checkin_autonomia}</p>
<p>${L.orario_arrivo}</p>
<p>${L.pagamento}</p>
<h3 style="color:#2a2622;font-size:15px;margin:20px 0 6px">${P.checkin_titolo}</h3>
<p>${P.checkin_corpo}</p>
<p>${P.checkin_online}</p>
<h3 style="color:#2a2622;font-size:15px;margin:20px 0 6px">${P.checkout_titolo}</h3>
<p>${P.checkout_corpo}</p>
<hr style="border:none;border-top:1px solid #e5e3df;margin:24px 0">
<h2 style="color:#FF6628;font-size:18px;margin:26px 0 10px">${L.raggiungerci_titolo}</h2>
<h3 style="color:#2a2622;font-size:15px;margin:20px 0 6px">${L.mezzi_titolo}</h3>
<ul style="margin:6px 0 6px 18px;padding:0">
${mezziHtml}
</ul>
<h3 style="color:#2a2622;font-size:15px;margin:20px 0 6px">${L.parcheggio_titolo}</h3>
<p>${P.parcheggio_corpo}</p>
<h3 style="color:#2a2622;font-size:15px;margin:20px 0 6px">${L.taxi_titolo}</h3>
<p>${P.taxi_corpo}</p>
<hr style="border:none;border-top:1px solid #e5e3df;margin:24px 0">
<p>${P.chiusura}</p>
<p>${P.firma}</p>
</div>`;
}

// ====== MAPPATURE CAMERE (per riconoscere la struttura dal nome camera) ======
const CAMPALDINO_ROOMS = new Set(["Gialla","Marrone","Rossa","Verde","Azzurra"]);
const LORENZO_ROOMS = new Set(["Uno","Due","Tre","Quattro","Cinque"]);

function proprietaDiCamera(roomName){
  if (CAMPALDINO_ROOMS.has(roomName)) return "camp";
  if (LORENZO_ROOMS.has(roomName)) return "lor";
  return null;
}

// ====== RILEVAMENTO LINGUA (stessa logica del frontend arrivi.html) ======
function lingua(language, phone) {
  const p = (phone || "").replace(/[\s-]/g, "");
  if (p.startsWith("+39")) return "it";
  if (p.startsWith("+34")) return "es";
  if (p.startsWith("+52") || p.startsWith("+54") || p.startsWith("+57") || p.startsWith("+56") || p.startsWith("+51")) return "es";
  if (p.startsWith("+33")) return "fr";
  if (p.startsWith("+351")) return "pt";
  if (p.startsWith("+55")) return "pt";
  if (p.startsWith("+49") || p.startsWith("+43") || p.startsWith("+41")) return "de";
  if (p.startsWith("+86") || p.startsWith("+852") || p.startsWith("+853") || p.startsWith("+886")) return "zh";
  const l = (language || "").toUpperCase();
  const map = { IT: "it", EN: "en", ES: "es", FR: "fr", PT: "pt", DE: "de", ZH: "zh", CN: "zh" };
  if (map[l]) return map[l];
  return "en";
}

const SUBJ_TABLE = { it:"Il suo arrivo", en:"Your arrival", es:"Su llegada", fr:"Votre arrivée", de:"Ihre Anreise", pt:"A sua chegada", zh:"您的入住信息" };

// ====== EMAIL DI RINGRAZIAMENTO POST CHECK-OUT (recensione + buono sconto) ======
const PROP_NAME = { camp: "InternoUno", lor: "InternoUno Deluxe" };
const GOOGLE_REVIEW = {
  camp: { url: "https://search.google.com/local/writereview?placeid=ChIJqe0T1nthLxMRsDSYXZihjYs", rating: "4.2", bookingRating: "8.6" },
  lor:  { url: "https://search.google.com/local/writereview?placeid=ChIJbwrMEn1hLxMRPJp7LAxumLU", rating: "4.2", bookingRating: "8.6" }
};
const THANKYOU_SUBJ = {
  it: "Grazie per il tuo soggiorno! 🎁 Un regalo per te",
  en: "Thank you for your stay! 🎁 A gift for you",
  es: "¡Gracias por tu estancia! 🎁 Un regalo para ti",
  fr: "Merci pour ton séjour ! 🎁 Un cadeau pour toi",
  de: "Danke für deinen Aufenthalt! 🎁 Ein Geschenk für dich",
  pt: "Obrigado pela tua estadia! 🎁 Um presente para ti",
  zh: "感谢入住！🎁 送你一份礼物"
};
const THANKYOU_COMMON = {
  it: {
    review_intro: `Se hai trascorso un bel soggiorno, ti sarei molto grato se potessi lasciare una recensione sulla piattaforma dove hai prenotato e/o su Google.`,
    review_cta: `Lascia una recensione su Google →`,
    review_ratings: (b, g) => `Attualmente il nostro punteggio medio è ${b} su Booking e ${g} su Google: ogni giudizio positivo ci aiuta a crescere e a far conoscere meglio il nostro impegno.`,
    feedback_negative: `Se invece qualcosa non ti ha soddisfatto, ti prego di contattarmi direttamente. Sarò felice di ascoltarti e, se possibile, rimediare immediatamente: la tua soddisfazione è la nostra priorità, e ogni feedback ci aiuta a migliorare.`,
    gift_intro: `Per ringraziarti della fiducia, ti lascio un piccolo omaggio:`,
    gift_line: `🎁 un buono sconto di 10&nbsp;€, valido per due anni, per il tuo prossimo soggiorno.`,
    gift_howto: `Per utilizzarlo, prenota direttamente sul nostro sito <a href="https://www.interno1.it" style="color:#FF6628">www.interno1.it</a> e inserisci il codice <b>GIFT10GUEST</b> nel campo "Codice promozionale" subito sotto la scelta delle date.`,
    gift_note: `Ti ricordiamo che sul nostro sito trovi sempre la tariffa più bassa garantita rispetto a tutti gli altri canali di prenotazione.`,
    social_intro: `Restiamo in contatto anche sui social 📸 Seguici per consigli sulla zona, eventi a Roma in arrivo e promozioni riservate a chi ci segue online.`,
    closing: `Spero di rivederti presto!<br>Buon viaggio e grazie ancora,`
  },
  en: {
    review_intro: `If you enjoyed your stay, I would really appreciate it if you could leave a review on the platform where you booked or on Google.`,
    review_cta: `Leave a review on Google →`,
    review_ratings: (b, g) => `Our current average rating is ${b} on Booking.com and ${g} on Google — every positive review helps us grow and show new guests the quality of our service.`,
    feedback_negative: `If for any reason you were not completely satisfied, please contact me directly. I'll be happy to listen and, whenever possible, make things right. Your satisfaction is our top priority, and your feedback helps us improve every day.`,
    gift_intro: `As a small token of appreciation for your trust, here's a little gift:`,
    gift_line: `🎁 a €10 discount voucher, valid for two years, for your next stay with us.`,
    gift_howto: `To redeem it, simply book directly on our website <a href="https://www.interno1.it" style="color:#FF6628">www.interno1.it</a> and enter the code <b>GIFT10GUEST</b> in the "Promotional code" box, under the date selection.`,
    gift_note: `Booking directly also guarantees you the lowest available rate compared to any other platform.`,
    social_intro: `Let's stay in touch on social media too 📸 Follow us for local tips, upcoming events in Rome, and promotions reserved for our online followers.`,
    closing: `I hope to welcome you again soon!<br>Safe travels and thank you once more,`
  },
  es: {
    review_intro: `Si has disfrutado de tu estancia, te agradecería mucho que dejaras una reseña en la plataforma donde reservaste y/o en Google.`,
    review_cta: `Deja una reseña en Google →`,
    review_ratings: (b, g) => `Nuestra puntuación media actual es de ${b} en Booking y de ${g} en Google: cada valoración positiva nos ayuda a crecer y a dar a conocer mejor nuestro compromiso.`,
    feedback_negative: `Si por el contrario algo no te ha satisfecho, por favor contáctame directamente. Estaré encantado de escucharte y, si es posible, solucionarlo de inmediato: tu satisfacción es nuestra prioridad, y cada comentario nos ayuda a mejorar.`,
    gift_intro: `Para agradecerte tu confianza, te dejo un pequeño regalo:`,
    gift_line: `🎁 un vale de descuento de 10&nbsp;€, válido durante dos años, para tu próxima estancia.`,
    gift_howto: `Para utilizarlo, reserva directamente en nuestra web <a href="https://www.interno1.it" style="color:#FF6628">www.interno1.it</a> e introduce el código <b>GIFT10GUEST</b> en el campo "Código promocional", justo debajo de la selección de fechas.`,
    gift_note: `Recuerda que en nuestra web siempre encontrarás la tarifa más baja garantizada frente a cualquier otro canal de reserva.`,
    social_intro: `Sigamos en contacto también en redes sociales 📸 Síguenos para consejos sobre la zona, próximos eventos en Roma y promociones exclusivas para nuestros seguidores.`,
    closing: `¡Espero volver a recibirte pronto!<br>Buen viaje y gracias de nuevo,`
  },
  fr: {
    review_intro: `Si tu as passé un bon séjour, je te serais très reconnaissant de laisser un avis sur la plateforme où tu as réservé et/ou sur Google.`,
    review_cta: `Laisser un avis sur Google →`,
    review_ratings: (b, g) => `Notre note moyenne actuelle est de ${b} sur Booking et de ${g} sur Google : chaque avis positif nous aide à grandir et à mieux faire connaître notre engagement.`,
    feedback_negative: `Si en revanche quelque chose ne t'a pas satisfait, merci de me contacter directement. Je serai heureux de t'écouter et, si possible, d'y remédier immédiatement : ta satisfaction est notre priorité, et chaque retour nous aide à nous améliorer.`,
    gift_intro: `Pour te remercier de ta confiance, voici un petit cadeau :`,
    gift_line: `🎁 un bon de réduction de 10&nbsp;€, valable deux ans, pour ton prochain séjour.`,
    gift_howto: `Pour l'utiliser, réserve directement sur notre site <a href="https://www.interno1.it" style="color:#FF6628">www.interno1.it</a> et saisis le code <b>GIFT10GUEST</b> dans le champ « Code promo », juste sous le choix des dates.`,
    gift_note: `Pour rappel, notre site propose toujours le tarif le plus bas garanti par rapport à tous les autres canaux de réservation.`,
    social_intro: `Restons en contact aussi sur les réseaux sociaux 📸 Suis-nous pour des conseils sur le quartier, les événements à venir à Rome et des promotions réservées à nos abonnés.`,
    closing: `J'espère te revoir bientôt !<br>Bon voyage et encore merci,`
  },
  de: {
    review_intro: `Wenn dir dein Aufenthalt gefallen hat, würde ich mich sehr über eine Bewertung auf der Plattform freuen, über die du gebucht hast, oder auf Google.`,
    review_cta: `Bewertung auf Google hinterlassen →`,
    review_ratings: (b, g) => `Unsere aktuelle Durchschnittsbewertung liegt bei ${b} auf Booking und bei ${g} auf Google: Jede positive Bewertung hilft uns zu wachsen und unser Engagement bekannter zu machen.`,
    feedback_negative: `Falls dich hingegen etwas nicht zufriedengestellt hat, kontaktiere mich bitte direkt. Ich höre dir gerne zu und behebe das Problem, wenn möglich, sofort: Deine Zufriedenheit hat für uns Priorität, und jedes Feedback hilft uns, uns zu verbessern.`,
    gift_intro: `Als kleines Dankeschön für dein Vertrauen möchte ich dir Folgendes schenken:`,
    gift_line: `🎁 einen Rabattgutschein über 10&nbsp;€, gültig für zwei Jahre, für deinen nächsten Aufenthalt.`,
    gift_howto: `Um ihn einzulösen, buche einfach direkt auf unserer Website <a href="https://www.interno1.it" style="color:#FF6628">www.interno1.it</a> und gib den Code <b>GIFT10GUEST</b> im Feld „Rabattcode" ein, direkt unter der Datumsauswahl.`,
    gift_note: `Denk daran, dass du auf unserer Website immer den garantiert niedrigsten Preis im Vergleich zu allen anderen Buchungskanälen findest.`,
    social_intro: `Bleiben wir auch in den sozialen Medien in Kontakt 📸 Folge uns für Tipps zur Umgebung, kommende Veranstaltungen in Rom und exklusive Aktionen für unsere Follower.`,
    closing: `Ich hoffe, dich bald wieder begrüßen zu dürfen!<br>Gute Reise und nochmals danke,`
  },
  pt: {
    review_intro: `Se gostaste da tua estadia, ficaria muito grato se deixasses uma avaliação na plataforma onde reservaste e/ou no Google.`,
    review_cta: `Deixar uma avaliação no Google →`,
    review_ratings: (b, g) => `A nossa pontuação média atual é de ${b} no Booking e de ${g} no Google: cada avaliação positiva ajuda-nos a crescer e a dar a conhecer melhor o nosso empenho.`,
    feedback_negative: `Se, pelo contrário, algo não te agradou, por favor contacta-me diretamente. Terei todo o gosto em ouvir-te e, se possível, resolver de imediato: a tua satisfação é a nossa prioridade, e cada comentário ajuda-nos a melhorar.`,
    gift_intro: `Para te agradecer a confiança, deixo-te uma pequena prenda:`,
    gift_line: `🎁 um vale de desconto de 10&nbsp;€, válido durante dois anos, para a tua próxima estadia.`,
    gift_howto: `Para o utilizar, reserva diretamente no nosso site <a href="https://www.interno1.it" style="color:#FF6628">www.interno1.it</a> e insere o código <b>GIFT10GUEST</b> no campo "Código promocional", logo abaixo da seleção de datas.`,
    gift_note: `Lembramos que no nosso site encontras sempre a tarifa mais baixa garantida em relação a qualquer outro canal de reserva.`,
    social_intro: `Vamos manter-nos em contacto também nas redes sociais 📸 Segue-nos para dicas sobre a zona, próximos eventos em Roma e promoções exclusivas para quem nos segue.`,
    closing: `Espero receber-te novamente em breve!<br>Boa viagem e mais uma vez obrigado,`
  },
  zh: {
    review_intro: `如果你度过了愉快的住宿，我会非常感激你能在预订平台和/或谷歌上留下评价。`,
    review_cta: `在谷歌上留下评价 →`,
    review_ratings: (b, g) => `目前我们在Booking上的平均评分为${b}分，在谷歌上为${g}分——每一个好评都帮助我们成长，让更多人了解我们的用心。`,
    feedback_negative: `如果有任何不满意的地方，请直接联系我。我很乐意倾听，并尽可能立即解决问题——你的满意是我们的首要任务，每一条反馈都帮助我们不断进步。`,
    gift_intro: `为了感谢你的信任，送你一个小礼物：`,
    gift_line: `🎁 一张10欧元优惠券，有效期两年，用于你的下次入住。`,
    gift_howto: `使用方法：请直接在我们的官网 <a href="https://www.interno1.it" style="color:#FF6628">www.interno1.it</a> 预订，并在日期选择下方的"优惠码"栏中输入代码 <b>GIFT10GUEST</b>。`,
    gift_note: `请注意，在我们官网预订，价格始终保证低于其他任何预订渠道。`,
    social_intro: `也欢迎在社交媒体上与我们保持联系 📸 关注我们获取周边攻略、罗马近期活动和专属粉丝优惠。`,
    closing: `期待很快能再次接待你！<br>一路顺风，再次感谢，`
  }
};

function thankYouGreeting(lng, nome, propName) {
  switch (lng) {
    case "it": return `Ciao${nome ? " " + nome : ""}, sono Filippo di ${propName}.`;
    case "es": return `Hola${nome ? " " + nome : ""}, soy Filippo de ${propName}.`;
    case "fr": return `Bonjour${nome ? " " + nome : ""}, je suis Filippo de ${propName}.`;
    case "de": return `Hallo${nome ? " " + nome : ""}, hier ist Filippo von ${propName}.`;
    case "pt": return `Olá${nome ? " " + nome : ""}, aqui é o Filippo da ${propName}.`;
    case "zh": return `你好${nome ? "，" + nome : ""}，我是${propName}的Filippo。`;
    default: return `Hi${nome ? " " + nome : ""}, this is Filippo from ${propName}.`;
  }
}
function thankYouThanks(lng) {
  switch (lng) {
    case "it": return `Desidero ringraziarti di cuore per aver scelto la mia struttura per il tuo soggiorno a Roma.<br>Spero davvero di essere riuscito a ripagare la tua fiducia: cerco sempre di fare del mio meglio per offrire la miglior esperienza possibile ai miei ospiti.`;
    case "es": return `Quiero agradecerte de todo corazón por haber elegido mi alojamiento para tu estancia en Roma.<br>Espero de verdad haber estado a la altura de tu confianza: siempre intento dar lo mejor de mí para ofrecer la mejor experiencia posible a mis huéspedes.`;
    case "fr": return `Je tiens à te remercier sincèrement d'avoir choisi mon établissement pour ton séjour à Rome.<br>J'espère vraiment avoir été à la hauteur de ta confiance : je fais toujours de mon mieux pour offrir la meilleure expérience possible à mes hôtes.`;
    case "de": return `Ich möchte dir von Herzen danken, dass du für deinen Aufenthalt in Rom meine Unterkunft gewählt hast.<br>Ich hoffe wirklich, dein Vertrauen verdient zu haben: Ich gebe immer mein Bestes, um meinen Gästen das bestmögliche Erlebnis zu bieten.`;
    case "pt": return `Quero agradecer-te de coração por teres escolhido o meu alojamento para a tua estadia em Roma.<br>Espero mesmo ter correspondido à tua confiança: procuro sempre dar o meu melhor para oferecer a melhor experiência possível aos meus hóspedes.`;
    case "zh": return `非常感谢你选择我的民宿作为在罗马的住宿。<br>我真心希望没有辜负你的信任——我一直尽力为每一位客人提供最好的体验。`;
    default: return `I'd like to sincerely thank you for choosing my place for your stay in Rome.<br>I truly hope I've managed to live up to your expectations — I always do my best to make every guest feel comfortable and well taken care of.`;
  }
}
function buildThankYouHtml(propKey, lng, nome) {
  const L = THANKYOU_COMMON[lng] || THANKYOU_COMMON.en;
  const propName = PROP_NAME[propKey] || "InternoUno";
  const gr = GOOGLE_REVIEW[propKey] || GOOGLE_REVIEW.camp;
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#222">
<p>${thankYouGreeting(lng, nome, propName)}</p>
<p>${thankYouThanks(lng)}</p>
<p>${L.review_intro} <a href="${gr.url}" style="display:inline-block;background:#FF6628;color:#fff;text-decoration:none;padding:4px 10px;border-radius:6px;font-weight:bold;font-size:13px;white-space:nowrap;margin-left:4px">${L.review_cta}</a></p>
<p>${L.review_ratings(gr.bookingRating, gr.rating)}</p>
<p>${L.feedback_negative}</p>
<hr style="border:none;border-top:1px solid #e5e3df;margin:24px 0">
<p>${L.gift_intro}</p>
<p style="font-size:16px">${L.gift_line}</p>
<p>${L.gift_howto}</p>
<p style="font-size:13px;color:#555">${L.gift_note}</p>
<hr style="border:none;border-top:1px solid #e5e3df;margin:24px 0">
<p>${L.social_intro}</p>
<p>👉 Instagram: <a href="https://instagram.com/internounoguesthouse" style="color:#FF6628">@internounoguesthouse</a><br>
👉 Facebook: <a href="https://facebook.com/internounobb" style="color:#FF6628">InternoUno</a></p>
<hr style="border:none;border-top:1px solid #e5e3df;margin:24px 0">
<p>${L.closing}<br><b>Filippo</b><br>InternoUno<br>Tel. +39 392 299 9914<br>www.interno1.it</p>
</div>`;
}

// Versione testo semplice: usata per le prenotazioni Booking.com, la cui messaggistica
// interna non renderizza l'HTML. Niente tag, link scritti per esteso.
function buildThankYouPlainText(propKey, lng, nome) {
  const L = THANKYOU_COMMON[lng] || THANKYOU_COMMON.en;
  const propName = PROP_NAME[propKey] || "InternoUno";
  const gr = GOOGLE_REVIEW[propKey] || GOOGLE_REVIEW.camp;
  const strip = (s) => (s || "")
    .replace(/&nbsp;/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<b>(.*?)<\/b>/gi, "$1")
    .replace(/<a\s+href="([^"]+)"[^>]*>(.*?)<\/a>/gi, (m, url, text) => {
      const t = text.replace(/^https?:\/\//i, "").toLowerCase();
      const u = url.replace(/^https?:\/\//i, "").toLowerCase();
      return (u.startsWith(t)) ? text : `${text}: ${url}`;
    });
  const parts = [
    strip(thankYouGreeting(lng, nome, propName)),
    strip(thankYouThanks(lng)),
    strip(L.review_intro),
    `${strip(L.review_cta)}\n${gr.url}`,
    strip(L.review_ratings(gr.bookingRating, gr.rating)),
    strip(L.feedback_negative),
    "----------",
    strip(L.gift_intro),
    strip(L.gift_line),
    strip(L.gift_howto),
    strip(L.gift_note),
    "----------",
    strip(L.social_intro),
    "Instagram: @internounoguesthouse - https://instagram.com/internounoguesthouse\nFacebook: InternoUno - https://facebook.com/internounobb",
    "----------",
    `${strip(L.closing)}\nFilippo\nInternoUno\nTel. +39 392 299 9914\nwww.interno1.it`
  ];
  return parts.join("\n\n");
}

async function sendGmailHtml(env, to, subject, html) {
  const tokenData = await getGmailAccessToken(env);
  if (!tokenData.access_token) {
    return { ok: false, error: "Token Gmail non ottenuto", detail: tokenData };
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
    return { ok: false, error: "Invio Gmail fallito", status: sendResp.status, detail: errText.slice(0, 500) };
  }
  const sendData = await sendResp.json();
  return { ok: true, messageId: sendData.id };
}

// Multi-account send: account = "business" (InternoUno, default) or "personal" (Filippo's Gmail).
// For "personal" we don't force a From header, so Gmail fills it in automatically with the
// authenticated account's own address (Gmail API rejects/ignores a spoofed From anyway).
// fromOverride (business only): lets the caller pick any verified Gmail "send as" alias
// (e.g. "InternoUno <info@interno1.it>", already configured to relay via smtps.aruba.it in
// Gmail settings) instead of the default interno1bbroma@gmail.com. Gmail API honors this
// only if the address is a verified alias on the authenticated account; otherwise it's ignored
// or the send fails.
async function sendGmailHtmlMulti(env, account, to, subject, html, fromOverride, contentType) {
  const tokenData = await getGmailAccessTokenFor(env, account);
  if (!tokenData.access_token) {
    return { ok: false, error: "Token Gmail non ottenuto", detail: tokenData };
  }
  const subjectEnc = "=?UTF-8?B?" + btoa(unescape(encodeURIComponent(subject))) + "?=";
  const ctype = contentType === "text/plain" ? "text/plain" : "text/html";
  const headers = [];
  if (account !== "personal") {
    headers.push(`From: ${fromOverride || "InternoUno <info@interno1.it>"}`);
  }
  headers.push(
    `To: ${to}`,
    `Subject: ${subjectEnc}`,
    "MIME-Version: 1.0",
    `Content-Type: ${ctype}; charset=UTF-8`,
    "Content-Transfer-Encoding: 8bit",
    "",
    html
  );
  const mime = headers.join("\r\n");
  const raw = b64urlEncode(mime);
  const sendResp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenData.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw })
  });
  if (!sendResp.ok) {
    const errText = await sendResp.text();
    return { ok: false, error: "Invio Gmail fallito", status: sendResp.status, detail: errText.slice(0, 500) };
  }
  const sendData = await sendResp.json();
  return { ok: true, messageId: sendData.id };
}

// ====== AUTOMAZIONE NOTTURNA: nuove prenotazioni non-Booking con email ======
// ====== AUTOMAZIONE: email di ringraziamento la mattina del check-out (TUTTI i canali) ======
async function runThankYou(env, testMode) {
  const oggi = new Date();
  const to = oggi.toISOString().slice(0, 10);
  const daData = new Date(oggi);
  daData.setDate(daData.getDate() - 30);
  const from = daData.toISOString().slice(0, 10);
  const resp = await amenitizGet(`/bookings/checkin?from=${from}&to=${to}&hotel_id=${HOTEL_UUID}`, env);
  if (!resp.ok) {
    return { error: "Errore API Amenitiz", status: resp.status };
  }
  const bookings = await resp.json();
  const dettagli = [];
  const scarti = { cancellata: 0, non_oggi: 0, senza_email: 0, gia_inviata: 0, camera_sconosciuta: 0 };
  let inviate = 0, saltate = 0;
  for (const b of Array.isArray(bookings) ? bookings : []) {
    const stato = (b.status || "").toLowerCase();
    if (stato === "cancelled" || stato === "canceled") { saltate++; scarti.cancellata++; continue; }
    if (b.checkout !== to) { saltate++; scarti.non_oggi++; continue; }
    const booker = b.booker || {};
    const email = booker.email || "";
    if (!email || email.indexOf("@") < 0) { saltate++; scarti.senza_email++; continue; }
    const bookingId = b.booking_id;
    const kvKey = `thankyou_sent_${bookingId}`;
    const giaInviata = await env.ARRIVI_KV.get(kvKey);
    if (giaInviata) { saltate++; scarti.gia_inviata++; continue; }
    const roomName = (b.rooms && b.rooms[0] && b.rooms[0].individual_room_name) || "";
    const propKey = proprietaDiCamera(roomName);
    if (!propKey) { saltate++; scarti.camera_sconosciuta++; continue; }
    const phone = booker.phone || "";
    const lng = lingua(booker.language, phone);
    const nome = (booker.first_name || "").trim();
    const isBookingCom = (b.source || "").toLowerCase().includes("booking");
    const body = isBookingCom ? buildThankYouPlainText(propKey, lng, nome) : buildThankYouHtml(propKey, lng, nome);
    const formato = isBookingCom ? "text/plain" : "text/html";
    const subject = THANKYOU_SUBJ[lng] || THANKYOU_SUBJ.en;
    if (testMode) {
      dettagli.push({ bookingId, email, propKey, lng, nome, roomName, source: b.source || "", formato, wouldSend: true });
      continue;
    }
    const result = await sendGmailHtmlMulti(env, "business", email, subject, body, null, formato);
    if (result.ok) {
      const sentAt = new Date().toISOString();
      await env.ARRIVI_KV.put(kvKey, sentAt);
      await env.ARRIVI_KV.put(`thankyou_log_${to}_${bookingId}`, JSON.stringify({
        bookingId, nome, cognome: (booker.last_name || "").trim(), email, propKey,
        propName: PROP_NAME[propKey] || propKey, lng, source: b.source || "", roomName, formato, sentAt
      }));
      inviate++;
      dettagli.push({ bookingId, email, propKey, lng, sent: true });
    } else {
      dettagli.push({ bookingId, email, sent: false, error: result.error });
    }
  }
  return { data: to, totaleControllate: (bookings || []).length, inviate, saltate, scarti, dettagli };
}

async function runAutoSend(env, testMode) {
  const oggi = new Date();
  const to = oggi.toISOString().slice(0, 10);
  const daData = new Date(oggi);
  daData.setDate(daData.getDate() - 2); // finestra di sicurezza: ultime 48h, per non perdere nulla per ritardi/fusi orari
  const from = daData.toISOString().slice(0, 10);

  const resp = await amenitizGet(`/bookings/created?from=${from}&to=${to}&hotel_id=${HOTEL_UUID}`, env);
  if (!resp.ok) {
    return { error: "Errore API Amenitiz", status: resp.status };
  }
  const bookings = await resp.json();
  const dettagli = [];
  const scartiPerMotivo = { cancellata: 0, booking_com: 0, senza_email: 0, gia_inviata: 0, camera_sconosciuta: 0 };
  let inviate = 0, saltate = 0;

  for (const b of (Array.isArray(bookings) ? bookings : [])) {
    // /bookings/created filtra già per data di creazione: chi compare qui è per definizione una prenotazione nuova.
    // Escludiamo solo quelle già cancellate nel frattempo (nessun senso inviare a chi ha disdetto).
    const stato = (b.status || "").toLowerCase();
    if (stato === "cancelled" || stato === "canceled") { saltate++; scartiPerMotivo.cancellata++; continue; }
    const source = (b.source || "").toLowerCase();
    if (source.includes("booking")) { saltate++; scartiPerMotivo.booking_com++; continue; }
    const booker = b.booker || {};
    const email = booker.email || "";
    if (!email || email.indexOf("@") < 0) { saltate++; scartiPerMotivo.senza_email++; continue; }
    const bookingId = b.booking_id;
    const kvKey = `expauto_${bookingId}`;
    const giaInviata = await env.ARRIVI_KV.get(kvKey);
    if (giaInviata) { saltate++; scartiPerMotivo.gia_inviata++; continue; }

    const roomName = (b.rooms && b.rooms[0] && b.rooms[0].individual_room_name) || "";
    const propKey = proprietaDiCamera(roomName);
    if (!propKey) { saltate++; scartiPerMotivo.camera_sconosciuta++; continue; }

    const phone = booker.phone || "";
    const lng = lingua(booker.language, phone);
    const nome = (booker.first_name || "").trim();
    const html = buildExpHtml(propKey, lng, nome);
    const propName = propKey === "lor" ? "InternoUno Deluxe" : "InternoUno";
    const subject = `${propName} — ${SUBJ_TABLE[lng] || SUBJ_TABLE.en}`;

    if (testMode) {
      dettagli.push({ bookingId, email, propKey, lng, nome, roomName, wouldSend: true });
      continue;
    }

    const result = await sendGmailHtml(env, email, subject, html);
    if (result.ok) {
      await env.ARRIVI_KV.put(kvKey, new Date().toISOString());
      inviate++;
      dettagli.push({ bookingId, email, propKey, lng, sent: true });
    } else {
      dettagli.push({ bookingId, email, sent: false, error: result.error });
    }
  }

  return { finestra: { from, to }, totaleControllate: (bookings || []).length, inviate, saltate, scartiPerMotivo, dettagli };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    try {
      const url = new URL(request.url);
      const action = url.searchParams.get("action");


      // Avvio re-autorizzazione Gmail: apri questo URL nel browser una sola volta
      // account=business (default, mailbox InternoUno) oppure account=personal (Gmail personale)
      if (action === "authStart") {
        const account = url.searchParams.get("account") === "personal" ? "personal" : "business";
        const p = new URLSearchParams({
          client_id: env.GMAIL_CLIENT_ID,
          redirect_uri: REDIRECT_URI,
          response_type: "code",
          scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
          access_type: "offline",
          prompt: "consent",
          state: account
        });
        return Response.redirect("https://accounts.google.com/o/oauth2/v2/auth?" + p.toString(), 302);
      }

      // Callback OAuth: Google torna qui con ?code=...
      if (url.pathname.endsWith("/oauth2callback")) {
        const code = url.searchParams.get("code");
        const oauthErr = url.searchParams.get("error");
        const account = url.searchParams.get("state") === "personal" ? "personal" : "business";
        if (oauthErr) return htmlPage("Errore da Google: " + oauthErr);
        if (!code) return htmlPage("Nessun codice ricevuto da Google.");
        const tokResp = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: env.GMAIL_CLIENT_ID,
            client_secret: env.GMAIL_CLIENT_SECRET,
            code,
            redirect_uri: REDIRECT_URI,
            grant_type: "authorization_code"
          })
        });
        const td = await tokResp.json();
        if (!td.refresh_token) {
          return htmlPage("Scambio completato ma Google NON ha restituito un refresh_token.<br><br>" +
            "Di solito succede se l'app era gia autorizzata: vai su <a href='https://myaccount.google.com/permissions'>myaccount.google.com/permissions</a>, rimuovi l'accesso a questa app e riprova.<br><br>Risposta: <code>" + JSON.stringify(td) + "</code>");
        }
        const secretName = account === "personal" ? "GMAIL_PERSONAL_REFRESH_TOKEN" : "GMAIL_REFRESH_TOKEN";
        return htmlPage("<b>Nuovo refresh token generato (lettura + invio) per account: " + account + ".</b><br><br>" +
          "Copialo e incollalo nel secret <code>" + secretName + "</code> del worker:<br>" +
          "Cloudflare dashboard &rarr; Workers &amp; Pages &rarr; <b>little-shadow-145e</b> &rarr; Settings &rarr; Variables and Secrets &rarr; " +
          (account === "personal" ? "aggiungi nuovo secret <code>" + secretName + "</code>" : "modifica <code>" + secretName + "</code>") + ".<br><br>" +
          "<textarea readonly style='width:100%;height:90px' onclick='this.select()'>" + td.refresh_token + "</textarea>");
      }

      if (action === "runAutoSend") {
        const testMode = url.searchParams.get("test") === "true";
        const result = await runAutoSend(env, testMode);
        return new Response(JSON.stringify(result), {
          headers: { ...CORS, "Content-Type": "application/json" }
        });
      }

      if (action === "runThankYou") {
        const testMode = url.searchParams.get("test") === "true";
        const result = await runThankYou(env, testMode);
        return new Response(JSON.stringify(result), {
          headers: { ...CORS, "Content-Type": "application/json" }
        });
      }

      if (action === "testThankYou") {
        const to2 = url.searchParams.get("to");
        const propKey = url.searchParams.get("propKey") === "lor" ? "lor" : "camp";
        const lng = url.searchParams.get("lng") || "it";
        const nome = url.searchParams.get("nome") || "Filippo";
        const wantPlain = url.searchParams.get("plain") === "true";
        if (!to2) {
          return new Response(JSON.stringify({ error: "Parametro to mancante" }), {
            status: 400, headers: { ...CORS, "Content-Type": "application/json" }
          });
        }
        const body = wantPlain ? buildThankYouPlainText(propKey, lng, nome) : buildThankYouHtml(propKey, lng, nome);
        const formato = wantPlain ? "text/plain" : "text/html";
        const subject = "[TEST] " + (THANKYOU_SUBJ[lng] || THANKYOU_SUBJ.en);
        const result = await sendGmailHtmlMulti(env, "business", to2, subject, body, null, formato);
        if (result.ok) {
          const oggiStr = new Date().toISOString().slice(0, 10);
          const testId = "TEST-" + Date.now();
          await env.ARRIVI_KV.put(`thankyou_log_${oggiStr}_${testId}`, JSON.stringify({
            bookingId: testId, nome, cognome: "(test)", email: to2, propKey,
            propName: PROP_NAME[propKey] || propKey, lng, source: "test-manuale", roomName: "-", formato,
            sentAt: new Date().toISOString()
          }));
        }
        return new Response(JSON.stringify(result), {
          status: result.ok ? 200 : (result.status || 502), headers: { ...CORS, "Content-Type": "application/json" }
        });
      }

      if (action === "getThankYouLog") {
        const date2 = url.searchParams.get("date");
        if (!date2) {
          return new Response(JSON.stringify({ error: "Parametro date mancante" }), {
            status: 400, headers: { ...CORS, "Content-Type": "application/json" }
          });
        }
        const prefix = `thankyou_log_${date2}_`;
        const list = await env.ARRIVI_KV.list({ prefix });
        const voci = [];
        for (const key of list.keys) {
          const val = await env.ARRIVI_KV.get(key.name);
          if (val) { try { voci.push(JSON.parse(val)); } catch (e) {} }
        }
        voci.sort((a, b) => (a.sentAt || "").localeCompare(b.sentAt || ""));
        return new Response(JSON.stringify({ date: date2, count: voci.length, voci }), {
          headers: { ...CORS, "Content-Type": "application/json" }
        });
      }

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
        const result = await sendGmailHtml(env, to, subject, html);
        if (!result.ok) {
          return new Response(JSON.stringify(result), {
            status: result.status || 502, headers: { ...CORS, "Content-Type": "application/json" }
          });
        }
        return new Response(JSON.stringify(result), {
          headers: { ...CORS, "Content-Type": "application/json" }
        });
      }

      // Invio generico multi-account: account="business" (default, InternoUno) o "personal" (Gmail personale Filippo)
      if (action === "send") {
        let body;
        try { body = await request.json(); } catch (e) {
          return new Response(JSON.stringify({ error: "Corpo JSON non valido" }), {
            status: 400, headers: { ...CORS, "Content-Type": "application/json" }
          });
        }
        const { to, subject, html, account, from } = body || {};
        if (!to || !subject || !html) {
          return new Response(JSON.stringify({ error: "Parametri mancanti (to, subject, html)" }), {
            status: 400, headers: { ...CORS, "Content-Type": "application/json" }
          });
        }
        const acc = account === "personal" ? "personal" : "business";
        const result = await sendGmailHtmlMulti(env, acc, to, subject, html, from);
        if (!result.ok) {
          return new Response(JSON.stringify(result), {
            status: result.status || 502, headers: { ...CORS, "Content-Type": "application/json" }
          });
        }
        return new Response(JSON.stringify(result), {
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

      // ===== CANCELLAZIONI: lette dalle mail di notifica Amenitiz =====
      // La mail contiene la DATA REALE di disdetta (timestamp) + tutti i dati.
      // from/to = finestra sulla DATA DI CANCELLAZIONE (ISO YYYY-MM-DD).
      if (action === "cancellations") {
        const from = url.searchParams.get("from");
        const to   = url.searchParams.get("to");
        if (!from || !to) {
          return new Response(JSON.stringify({ error: "Parametri from/to mancanti" }), {
            status: 400, headers: { ...CORS, "Content-Type": "application/json" }
          });
        }
        const td = await getGmailAccessToken(env);
        if (!td.access_token) {
          return new Response(JSON.stringify({ error: "Gmail non autorizzato" }), {
            status: 502, headers: { ...CORS, "Content-Type": "application/json" }
          });
        }
        const gd = (iso) => iso.replace(/-/g, "/"); // YYYY/MM/DD per Gmail
        const beforeD = new Date(to + "T00:00:00Z"); beforeD.setUTCDate(beforeD.getUTCDate() + 1);
        const beforeIso = beforeD.toISOString().slice(0, 10);
        const q = encodeURIComponent(`subject:(annullata OR annullamento) after:${gd(from)} before:${gd(beforeIso)}`);

        // Raccogli gli ID messaggio (con paginazione, cap di sicurezza)
        const msgIds = [];
        let pageToken = "";
        for (let p = 0; p < 5; p++) {
          const listResp = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=100${pageToken ? "&pageToken=" + pageToken : ""}`,
            { headers: { Authorization: `Bearer ${td.access_token}` } }
          );
          const ld = await listResp.json();
          (ld.messages || []).forEach((m) => msgIds.push(m.id));
          if (!ld.nextPageToken) break;
          pageToken = ld.nextPageToken;
        }

        // Scarica e parsa (in parallelo a blocchi)
        const results = [];
        const chunk = 12;
        for (let i = 0; i < msgIds.length; i += chunk) {
          const slice = msgIds.slice(i, i + chunk);
          const parts = await Promise.all(slice.map(async (id) => {
            try {
              const mr = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, { headers: { Authorization: `Bearer ${td.access_token}` } });
              const md = await mr.json();
              let body = gmailPlainText(md.payload);
              if (!body && md.payload && md.payload.body && md.payload.body.data) body = b64UrlToUtf8(md.payload.body.data);
              const parsed = parseCancEmail(body);
              if (!parsed) return null;
              const ts = parseInt(md.internalDate) || 0;
              parsed.cancel_ts = ts;
              parsed.cancel_date = new Date(ts).toISOString().slice(0, 10);
              return parsed;
            } catch (e) { return null; }
          }));
          parts.forEach((p) => { if (p) results.push(p); });
        }

        // Dedup per booking_id tenendo la disdetta più recente
        results.sort((a, b) => b.cancel_ts - a.cancel_ts);
        const seen = new Set();
        const out = [];
        for (const r of results) {
          if (seen.has(r.booking_id)) continue;
          seen.add(r.booking_id);
          const sentRaw = await env.ARRIVI_KV.get(`cancel_sent_${r.booking_id}`);
          r.sent = !!sentRaw;
          r.sent_at = sentRaw || null;
          out.push(r);
        }
        return new Response(JSON.stringify({ from, to, count: out.length, cancellations: out }), {
          headers: { ...CORS, "Content-Type": "application/json" }
        });
      }

      // ===== SEGNA cancellazione come contattata / non contattata =====
      if (action === "setCancelSent") {
        const bid  = url.searchParams.get("booking_id");
        const sent = url.searchParams.get("sent") === "true";
        if (!bid) {
          return new Response(JSON.stringify({ error: "booking_id mancante" }), {
            status: 400, headers: { ...CORS, "Content-Type": "application/json" }
          });
        }
        const key = `cancel_sent_${bid}`;
        if (sent) await env.ARRIVI_KV.put(key, new Date().toISOString());
        else await env.ARRIVI_KV.delete(key);
        return new Response(JSON.stringify({ ok: true, booking_id: bid, sent }), {
          headers: { ...CORS, "Content-Type": "application/json" }
        });
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
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAutoSend(env, false));
  }
};
