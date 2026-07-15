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
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
      'Content-Type': 'application/json'
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    // Sicurezza: se è impostato il secret HA_API_KEY, ogni richiesta
    // deve presentare l'header X-API-Key corretto. Se il secret non è
    // ancora impostato, il worker resta aperto (nessuna rottura al deploy).
    if (env.HA_API_KEY) {
      const provided = request.headers.get('X-API-Key')
      if (provided !== env.HA_API_KEY) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: corsHeaders })
      }
    }

    // GET /history_family?hours=24 - storico posizioni device_tracker famiglia
    if (path === '/history_family') {
      try {
        const hours = parseInt(url.searchParams.get('hours') || '24')
        const now = new Date()
        const start = new Date(now.getTime() - hours * 3600 * 1000)
        const startIso = start.toISOString()

        // Device tracker della famiglia
        const trackers = [
          'device_tracker.life360_filippo_2',
          'device_tracker.life360_mena_2',
          'device_tracker.life360_vivvi',
          'device_tracker.flypad',
          'device_tracker.life360_alessia_castiglioni'
        ]
        const nameMap = {
          'device_tracker.life360_filippo_2': 'Filippo',
          'device_tracker.life360_mena_2': 'Mena',
          'device_tracker.life360_vivvi': 'Viola',
          'device_tracker.flypad': 'Filippo (iPad)',
          'device_tracker.life360_alessia_castiglioni': 'Alessia'
        }

        const filterIds = trackers.join(',')
        const histUrl = `${HA_URL}/api/history/period/${startIso}?filter_entity_id=${filterIds}&minimal_response`
        const resp = await fetch(histUrl, {
          headers: { 'Authorization': `Bearer ${TOKEN}` }
        })
        const history = await resp.json()

        // history è un array di array (uno per entità)
        const result = {}
        history.forEach(entityHistory => {
          if (!entityHistory.length) return
          const entityId = entityHistory[0].entity_id
          const name = nameMap[entityId] || entityId
          result[name] = entityHistory
            .filter(h => h.attributes && h.attributes.latitude && h.attributes.longitude)
            .map(h => ({
              lat: h.attributes.latitude,
              lon: h.attributes.longitude,
              state: h.state,
              time: h.last_changed || h.last_updated
            }))
        })

        return new Response(JSON.stringify(result), { headers: corsHeaders })
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders })
      }
    }

    // GET /family - posizioni famiglia da device_tracker e person
    if (path === '/family') {
      try {
        const resp = await fetch(`${HA_URL}/api/states`, {
          headers: { 'Authorization': `Bearer ${TOKEN}` }
        })
        const states = await resp.json()

        const persons = states.filter(e => e.entity_id.startsWith('person.'))
        const trackers = states.filter(e => e.entity_id.startsWith('device_tracker.'))

        const family = persons.map(p => {
          const lat = p.attributes.latitude
          const lon = p.attributes.longitude
          const source = p.attributes.source
          // Cerca device_tracker associato per coordinate più precise
          let tracker = null
          if (source) {
            tracker = trackers.find(t => t.entity_id === source)
          }
          const finalLat = (tracker?.attributes?.latitude) || lat
          const finalLon = (tracker?.attributes?.longitude) || lon
          return {
            id: p.entity_id,
            name: p.attributes.friendly_name || p.entity_id,
            state: p.state,
            latitude: finalLat || null,
            longitude: finalLon || null,
            battery: tracker?.attributes?.battery_level || p.attributes.battery_level || null,
            source: source || null,
            gps_accuracy: tracker?.attributes?.gps_accuracy || p.attributes.gps_accuracy || null
          }
        })

        return new Response(JSON.stringify(family), { headers: corsHeaders })
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders })
      }
    }

    // GET /dump - salva tutti gli stati HA su GitHub e ritorna summary
    if (path === '/dump') {
      try {
        const resp = await fetch(`${HA_URL}/api/states`, {
          headers: { 'Authorization': `Bearer ${TOKEN}` }
        })
        const states = await resp.json()
        const summary = {
          timestamp: new Date().toISOString(),
          total: states.length,
          lights: states.filter(e => e.entity_id.startsWith('light.')).map(e => ({
            id: e.entity_id,
            name: e.attributes.friendly_name || e.entity_id,
            state: e.state,
            brightness: e.attributes.brightness || null
          })),
          switches: states.filter(e => e.entity_id.startsWith('switch.')).map(e => ({
            id: e.entity_id,
            name: e.attributes.friendly_name || e.entity_id,
            state: e.state
          })),
          sensors: states.filter(e => e.entity_id.startsWith('sensor.')).map(e => ({
            id: e.entity_id,
            name: e.attributes.friendly_name || e.entity_id,
            state: e.state,
            unit: e.attributes.unit_of_measurement || null
          })),
          climate: states.filter(e => e.entity_id.startsWith('climate.')).map(e => ({
            id: e.entity_id,
            name: e.attributes.friendly_name || e.entity_id,
            state: e.state,
            temp: e.attributes.current_temperature || null,
            target: e.attributes.temperature || null
          })),
          persons: states.filter(e => e.entity_id.startsWith('person.')).map(e => ({
            id: e.entity_id,
            name: e.attributes.friendly_name || e.entity_id,
            state: e.state
          }))
        }

        // Salva su GitHub
        if (GH_PAT) {
          try {
            const ghUrl = 'https://api.github.com/repos/fly98/Analisi/contents/ha_states.json'
            const shaResp = await fetch(ghUrl, { headers: { 'Authorization': `Bearer ${GH_PAT}`, 'User-Agent': 'ha-worker' } })
            let sha = ''
            if (shaResp.ok) { const d = await shaResp.json(); sha = d.sha }
            // Encoding robusto per caratteri unicode
            const jsonStr = JSON.stringify(summary, null, 2)
            const encoder = new TextEncoder()
            const bytes = encoder.encode(jsonStr)
            let binary = ''
            bytes.forEach(b => binary += String.fromCharCode(b))
            const b64content = btoa(binary)
            const putBody = { message: 'ha dump ' + summary.timestamp, content: b64content, branch: 'main' }
            if (sha) putBody.sha = sha
            const pr = await fetch(ghUrl, {
              method: 'PUT',
              headers: { 'Authorization': `Bearer ${GH_PAT}`, 'Content-Type': 'application/json', 'User-Agent': 'ha-worker' },
              body: JSON.stringify(putBody)
            })
            const prText = await pr.text()
            summary.github_save = pr.status
            if (pr.status !== 200 && pr.status !== 201) {
              summary.github_error = prText.substring(0, 200)
            }
          } catch(e) {
            summary.github_save = 'exception: ' + e.message
          }
        }

        return new Response(JSON.stringify(summary, null, 2), { headers: corsHeaders })
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders })
      }
    }

    // GET /ip - scopre IP uscita Cloudflare e testa con httpbin
    if (path === '/ip') {
      try {
        const r = await fetch('https://httpbin.org/ip')
        const data = await r.json()
        // Prova anche una richiesta senza token per vedere cosa risponde HA
        const haR = await fetch(`${HA_URL}/api/`)
        const haT = await haR.text()
        return new Response(JSON.stringify({
          cloudflare_exit_ip: data.origin,
          ha_no_auth_status: haR.status,
          ha_no_auth_body: haT.substring(0, 100),
          ha_url_used: HA_URL
        }), { headers: corsHeaders })
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders })
      }
    }

    // GET /test - prova ogni endpoint HA e salva tutto su GitHub
    if (path === '/test') {
      const results = {}

      // Test 1: GET /api/
      try {
        const r = await fetch(`${HA_URL}/api/`, { headers: haHeaders })
        const t = await r.text()
        results.api_root = { status: r.status, ct: r.headers.get('content-type'), body: t.substring(0, 200) }
      } catch(e) { results.api_root = { error: e.message } }

      // Test 2: GET /api/ senza Content-Type
      try {
        const r = await fetch(`${HA_URL}/api/`, {
          headers: { 'Authorization': `Bearer ${TOKEN}` }
        })
        const t = await r.text()
        results.api_no_ct = { status: r.status, body: t.substring(0, 200) }
      } catch(e) { results.api_no_ct = { error: e.message } }

      // Test 3: GET /api/states senza Content-Type
      try {
        const r = await fetch(`${HA_URL}/api/states`, {
          headers: { 'Authorization': `Bearer ${TOKEN}` }
        })
        const t = await r.text()
        results.states_no_ct = { status: r.status, body: t.substring(0, 200) }
      } catch(e) { results.states_no_ct = { error: e.message } }

      // Salva su GitHub
      if (GH_PAT) {
        try {
          const ghUrl = 'https://api.github.com/repos/fly98/Analisi/contents/ha_debug.json'
          const shaResp = await fetch(ghUrl, { headers: { 'Authorization': `Bearer ${GH_PAT}` } })
          let sha = ''
          if (shaResp.ok) { const d = await shaResp.json(); sha = d.sha }
          const content = btoa(unescape(encodeURIComponent(JSON.stringify(results, null, 2))))
          const putBody = { message: 'ha test ' + new Date().toISOString(), content, branch: 'main' }
          if (sha) putBody.sha = sha
          const pr = await fetch(ghUrl, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${GH_PAT}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(putBody)
          })
          results.github_save = pr.status
        } catch(e) { results.github_save = e.message }
      }

      return new Response(JSON.stringify(results, null, 2), { headers: corsHeaders })
    }

    // GET /raw
    if (path === '/raw') {
      try {
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
        return new Response(JSON.stringify(debugData), { headers: corsHeaders })
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders })
      }
    }

    // GET /lights
    if (path === '/lights') {
      try {
        const resp = await fetch(`${HA_URL}/api/states`, {
          headers: { 'Authorization': `Bearer ${TOKEN}` }
        })
        const text = await resp.text()
        const states = JSON.parse(text.trim().replace(/^\uFEFF/, ''))
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
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders })
      }
    }

    // GET /states
    if (path === '/states') {
      try {
        const domain = url.searchParams.get('domain')
        const resp = await fetch(`${HA_URL}/api/states`, {
          headers: { 'Authorization': `Bearer ${TOKEN}` }
        })
        const states = JSON.parse((await resp.text()).trim())
        const filtered = domain ? states.filter(e => e.entity_id.startsWith(domain + '.')) : states
        return new Response(JSON.stringify(filtered), { headers: corsHeaders })
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders })
      }
    }

    // POST /call
    if (path === '/call' && request.method === 'POST') {
      try {
        const body = await request.json()
        const { domain, service, entity_id, data } = body
        const resp = await fetch(`${HA_URL}/api/services/${domain}/${service}`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ entity_id, ...data })
        })
        return new Response(JSON.stringify({ ok: true, status: resp.status }), { headers: corsHeaders })
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders })
      }
    }

    if (path === '/' || path === '/health') {
      return new Response(JSON.stringify({ ok: true, ha_url: HA_URL, has_token: !!TOKEN }), { headers: corsHeaders })
    }

    return new Response(JSON.stringify({ error: 'endpoint not found' }), { status: 404, headers: corsHeaders })
  }
}
