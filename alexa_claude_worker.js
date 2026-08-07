// Alexa <-> Claude bridge — Cloudflare Worker
// Secrets: ANTHROPIC_API_KEY, SKILL_ID (amzn1.ask.skill.xxxx), TEST_KEY (opzionale)

const FAST = "claude-haiku-4-5-20251001";
const SMART = "claude-sonnet-5";
const MAX_TOKENS = 300;

const SYSTEM = `Sei l'assistente vocale di Filippo. Parli da un altoparlante Alexa in casa sua, a Roma.
Regole assolute:
- Rispondi SEMPRE in italiano.
- Massimo tre frasi, meglio una. Vieni ascoltato, non letto.
- Niente markdown, niente elenchi, niente link, niente simboli: solo parlato naturale.
- Se la domanda e' ambigua, scegli la lettura piu' probabile e rispondi, invece di chiedere chiarimenti.
- Se non sai una cosa dillo in mezza riga, senza scusarti a lungo.
- Tono confidenziale, un filo ironico. Niente preamboli tipo "certamente".`;

function clean(s) {
  return String(s)
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/[*_`#>|]/g, "")
    .replace(/&/g, " e ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 3000);
}

function speak(text, { end = true, attrs = null } = {}) {
  const r = {
    version: "1.0",
    response: {
      outputSpeech: { type: "PlainText", text },
      shouldEndSession: end,
    },
  };
  if (!end) r.response.reprompt = { outputSpeech: { type: "PlainText", text: "Dimmi pure." } };
  if (attrs) r.sessionAttributes = attrs;
  return new Response(JSON.stringify(r), {
    headers: { "content-type": "application/json" },
  });
}

function pickModel(q) {
  const words = q.trim().split(/\s+/).length;
  const hard = /(perch|spiega|calcola|confronta|differenza|conviene|analizza|riassum|scrivi|traduci|come si fa|secondo te)/i.test(q);
  return words > 12 || hard ? SMART : FAST;
}

// Riempie il silenzio mentre il modello pensa (non blocca la risposta finale)
function thinking(body) {
  const ep = body?.context?.System?.apiEndpoint;
  const tok = body?.context?.System?.apiAccessToken;
  if (!ep || !tok) return;
  fetch(ep + "/v1/directives", {
    method: "POST",
    headers: { authorization: "Bearer " + tok, "content-type": "application/json" },
    body: JSON.stringify({
      header: { requestId: body.request.requestId },
      directive: { type: "VoicePlayer.Speak", speech: "Un attimo." },
    }),
  }).catch(() => {});
}

async function ask(env, messages, model) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6500); // Alexa stacca a ~8s
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctl.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        system: SYSTEM,
        messages,
      }),
    });
    if (!r.ok) {
      const txt = await r.text();
      console.log("anthropic error", r.status, txt.slice(0, 300));
      return "Errore dal modello, codice " + r.status + ".";
    }
    const d = await r.json();
    const out = (d.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join(" ");
    return out || "Non ho una risposta a questa.";
  } catch (e) {
    return "Ci sto mettendo troppo. Riprova tra un attimo.";
  } finally {
    clearTimeout(t);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Test rapido dal browser: /?k=TEST_KEY&q=domanda
    if (request.method === "GET") {
      const q = url.searchParams.get("q");
      if (q && env.TEST_KEY && url.searchParams.get("k") === env.TEST_KEY) {
        const a = await ask(env, [{ role: "user", content: q }], pickModel(q));
        return new Response(clean(a), { headers: { "content-type": "text/plain; charset=utf-8" } });
      }
      return new Response("alexa-claude ok");
    }

    if (request.method !== "POST") return new Response("method not allowed", { status: 405 });

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response("bad request", { status: 400 });
    }

    // Guardia: accetta solo richieste della TUA skill
    const appId =
      body?.session?.application?.applicationId ||
      body?.context?.System?.application?.applicationId;
    if (env.SKILL_ID && appId !== env.SKILL_ID) {
      return new Response("forbidden", { status: 403 });
    }

    const type = body?.request?.type;

    if (type === "SessionEndedRequest") {
      return new Response(JSON.stringify({ version: "1.0", response: {} }), {
        headers: { "content-type": "application/json" },
      });
    }

    if (type === "LaunchRequest") {
      return speak("Ciao Filippo, dimmi.", { end: false, attrs: { h: [] } });
    }

    if (type === "IntentRequest") {
      const name = body.request.intent?.name;

      if (name === "AMAZON.StopIntent" || name === "AMAZON.CancelIntent") {
        return speak("A dopo.", { end: true });
      }
      if (name === "AMAZON.HelpIntent") {
        return speak("Chiedimi quello che vuoi, ti rispondo io invece di Alexa.", { end: false });
      }

      const q = body.request.intent?.slots?.query?.value;
      if (!q) return speak("Non ho capito la domanda, ripeti.", { end: false });

      thinking(body);

      const hist = Array.isArray(body?.session?.attributes?.h) ? body.session.attributes.h : [];
      const messages = [...hist, { role: "user", content: q }];
      const answer = await ask(env, messages, pickModel(q));
      const spoken = clean(answer);

      const newHist = [...messages, { role: "assistant", content: spoken }].slice(-6);
      return speak(spoken, { end: false, attrs: { h: newHist } });
    }

    return speak("Non ho capito.", { end: true });
  },
};
