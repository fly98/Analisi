export default {
  async fetch(request, env) {
    const HA_URL = env.HA_BASE_URL
    const TOKEN = env.HA_TOKEN
    const GH_PAT = env.GITHUB_PAT

    const url = new URL(request.url)
    const path = url.pathname

    const haHeaders = {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    }

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Content-Type': 'application/json'
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    try {
      if (!HA_URL || !TOKEN) {
        return new Response(JSON.stringify({ error: 'Secrets mancanti', has_url: !!HA_URL, has_token: !!TOKEN }), {
          status: 500, headers: corsHeaders
        })
      }

      // GET /raw - risposta raw di HA /api/states (primi 1000 char) salvata su GitHub
      if (path === '/raw') {
        const resp = await fetch(`${HA_URL}/api/states`, { headers: haHeaders })
        const text = await resp.text()
        const debugData = {
          timestamp: new Date().toISOString(),
          http_status: resp.status,
          content_type: resp.headers.get('content-type'),
          body_length: text.length,
          body_first_100: text.substring(0, 100),
          body_char_codes: Array.from(text.substring(0, 10)).map(c => c.charCodeAt(0))
        }

        // Salva su GitHub
        if (GH_PAT) {
          const ghUrl = 'https://api.github.com/repos/fly98/Analisi/contents/ha_debug.json'
          const shaResp = await fetch(ghUrl, { headers: { 'Authorization': `Bearer ${GH_PAT}` } })
          let sha = ''
          if (shaResp.ok) { const shaData = await shaResp.json(); sha = shaData.sha }
          const content = btoa(unescape(encodeURIComponent(JSON.stringify(debugData, null, 2))))
          const putBody = { message: 'ha raw debug ' + debugData.timestamp, content, branch: 'main' }
          if (sha) putBody.sha = sha
          await fetch(ghUrl, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${GH_PAT}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(putBody)
          })
        }

        return new Response(JSON.stringify(debugData), { headers: corsHeaders })
      }

      // GET /debug
      if (path === '/debug') {
        const resp = await fetch(`${HA_URL}/api/`, { headers: haHeaders })
        const text = await resp.text()
        const debugData = {
          timestamp: new Date().toISOString(),
          ha_url: HA_URL,
          http_status: resp.status,
          content_type: resp.headers.get('content-type'),
          body_preview: text.substring(0, 500)
        }
        return new Response(JSON.stringify(debugData), { headers: corsHeaders })
      }

      // GET /lights
      if (path === '/lights' && request.method === 'GET') {
        const resp = await fetch(`${HA_URL}/api/states`, { headers: haHeaders })
        const text = await resp.text()
        // Pulizia BOM o caratteri spuri prima del JSON
        const cleaned = text.trim().replace(/^\uFEFF/, '')
        const states = JSON.parse(cleaned)
        const lights = states
          .filter(e => e.entity_id.startsWith('light.'))
          .map(e => ({
            id: e.entity_id,
            name: e.attributes.friendly_name || e.entity_id,
            state: e.state,
            brightness: e.attributes.brightness || null,
            color: e.attributes.rgb_color || null
          }))
        return new Response(JSON.stringify(lights), { headers: corsHeaders })
      }

      // GET /states
      if (path === '/states' && request.method === 'GET') {
        const domain = url.searchParams.get('domain')
        const resp = await fetch(`${HA_URL}/api/states`, { headers: haHeaders })
        const text = await resp.text()
        const cleaned = text.trim().replace(/^\uFEFF/, '')
        const states = JSON.parse(cleaned)
        const filtered = domain
          ? states.filter(e => e.entity_id.startsWith(domain + '.'))
          : states
        return new Response(JSON.stringify(filtered), { headers: corsHeaders })
      }

      // POST /call
      if (path === '/call' && request.method === 'POST') {
        const body = await request.json()
        const { domain, service, entity_id, data } = body
        const payload = { entity_id, ...data }
        const resp = await fetch(`${HA_URL}/api/services/${domain}/${service}`, {
          method: 'POST', headers: haHeaders, body: JSON.stringify(payload)
        })
        const result = await resp.json()
        return new Response(JSON.stringify({ ok: true, result }), { headers: corsHeaders })
      }

      // GET /health
      if (path === '/' || path === '/health') {
        const resp = await fetch(`${HA_URL}/api/`, { headers: haHeaders })
        const text = await resp.text()
        return new Response(JSON.stringify({ ok: true, preview: text.substring(0, 200) }), { headers: corsHeaders })
      }

      return new Response(JSON.stringify({ error: 'endpoint not found' }), {
        status: 404, headers: corsHeaders
      })

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message, stack: err.stack }), {
        status: 500, headers: corsHeaders
      })
    }
  }
}
