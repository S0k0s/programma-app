// Cloudflare Worker — proxies AI Coach requests to the Anthropic API.
// The API key lives only here, as a Worker secret (env.ANTHROPIC_API_KEY) —
// it is never sent to, or visible in, the browser.
//
// Deploy: paste this file's content into a new Worker in the Cloudflare
// dashboard (Workers & Pages > Create > Create Worker > Edit code), then
// Settings > Variables > add a secret named ANTHROPIC_API_KEY with your key.

export default {
  async fetch(request, env) {
    const cors = {
      // Tighten this to your actual github.io URL once you know it, e.g.
      // 'https://yourusername.github.io', instead of '*' — otherwise any
      // website could use your Worker (and your API credits) from a browser.
      'Access-Control-Allow-Origin': 'https://s0k0s.github.io',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: cors });
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400, headers: cors });
    }

    try {
      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: body.model || 'claude-haiku-4-5-20251001',
          max_tokens: body.max_tokens || 600,
          system: body.system,
          messages: body.messages,
        }),
      });
      const data = await anthropicRes.json();
      return new Response(JSON.stringify(data), {
        status: anthropicRes.status,
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'proxy_error' }), { status: 500, headers: cors });
    }
  },
};
