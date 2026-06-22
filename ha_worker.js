export default {
  async fetch(request, env) {
    const HA_URL = env.HA_BASE_URL
    const TOKEN = env.HA_TOKEN

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
        return new Response(JSON.stringify({ error: 'Secrets HA_BASE_URL o HA_TOKEN mancanti' }), {
          status: 500, headers: corsHeaders
        })
      }

      if (path === '/lights' && request.method === 'GET') {
        const resp = await fetch(`${HA_URL}/api/states`, { headers: haHeaders })
        const states = await resp.json()
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

      if (path === '/states' && request.method === 'GET') {
        const domain = url.searchParams.get('domain')
        const resp = await fetch(`${HA_URL}/api/states`, { headers: haHeaders })
        const states = await resp.json()
        const filtered = domain
          ? states.filter(e => e.entity_id.startsWith(domain + '.'))
          : states
        return new Response(JSON.stringify(filtered), { headers: corsHeaders })
      }

      if (path === '/call' && request.method === 'POST') {
        const body = await request.json()
        const { domain, service, entity_id, data } = body
        const payload = { entity_id, ...data }
        const resp = await fetch(`${HA_URL}/api/services/${domain}/${service}`, {
          method: 'POST',
          headers: haHeaders,
          body: JSON.stringify(payload)
        })
        const result = await resp.json()
        return new Response(JSON.stringify({ ok: true, result }), { headers: corsHeaders })
      }

      if (path === '/' || path === '/health') {
        const resp = await fetch(`${HA_URL}/api/`, { headers: haHeaders })
        const result = await resp.json()
        return new Response(JSON.stringify({ ok: true, ha: result }), { headers: corsHeaders })
      }

      return new Response(JSON.stringify({ error: 'endpoint not found' }), {
        status: 404, headers: corsHeaders
      })

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500, headers: corsHeaders
      })
    }
  }
}
