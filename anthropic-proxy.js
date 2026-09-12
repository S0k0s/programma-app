// Cloudflare Worker — proxies AI Coach requests to the Anthropic API, and
// also handles one privileged admin action: permanently deleting another
// user's Firebase Auth account. The Anthropic API key and the Firebase
// service account key both live only here, as Worker secrets — neither is
// ever sent to, or visible in, the browser.
//
// Deploy: paste this file's content into the Worker in the Cloudflare
// dashboard (Workers & Pages > your worker > Edit code), then:
//   Settings > Variables and Secrets > add a secret named ANTHROPIC_API_KEY
//   with your Anthropic API key (already set up if AI Coach chat works).
//   Settings > Variables and Secrets > add a secret named
//   FIREBASE_SERVICE_ACCOUNT_KEY with the full contents of a Firebase
//   service account JSON key file (see README.md for how to create one) —
//   this is what lets this Worker delete a Firebase Auth user on the
//   admin's behalf, something no client-side code can ever do for anyone
//   but their own account.

const FIREBASE_PROJECT_ID = 'gym-app-f99d6';
const FIREBASE_API_KEY = 'AIzaSyDMXY7bYlH7Nm2SCi0CFJj-7qAWPW4hTzI'; // public identifier, same as firebase-config.js
const ADMIN_EMAIL = 'sokratispoun@gmail.com';

function base64url(bytes) {
  let str = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) str += String.fromCharCode(arr[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlFromString(str) {
  return base64url(new TextEncoder().encode(str));
}

function pemToArrayBuffer(pem) {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s+/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// Exchanges the Firebase service account's private key for a short-lived
// Google OAuth2 access token, via the standard JWT-bearer flow — this is
// the same mechanism the Firebase Admin SDK uses internally, just done by
// hand since Cloudflare Workers can't run that Node-only SDK.
async function getServiceAccountAccessToken(env) {
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/identitytoolkit',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const unsigned = base64urlFromString(JSON.stringify(header)) + '.' + base64urlFromString(JSON.stringify(claims));
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = unsigned + '.' + base64url(signature);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + jwt,
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error('token_exchange_failed: ' + JSON.stringify(data));
  return data.access_token;
}

// Confirms the caller's Firebase ID token really belongs to the admin
// account, using Google's own token-verification endpoint — this avoids
// needing to implement JWT/JWKS signature verification by hand for every
// request; Google's servers do that check and hand back the decoded claims.
async function isVerifiedAdminToken(idToken) {
  if (!idToken) return false;
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  if (!res.ok) return false;
  const data = await res.json();
  const user = data.users && data.users[0];
  return !!(user && user.email === ADMIN_EMAIL && user.emailVerified);
}

async function handleAdminDeleteUser(body, cors, env) {
  const { idToken, targetUid } = body;
  if (!targetUid || typeof targetUid !== 'string') {
    return new Response(JSON.stringify({ error: 'missing_target_uid' }), { status: 400, headers: cors });
  }
  const okAdmin = await isVerifiedAdminToken(idToken).catch(() => false);
  if (!okAdmin) {
    return new Response(JSON.stringify({ error: 'forbidden_not_admin' }), { status: 403, headers: cors });
  }
  try {
    const accessToken = await getServiceAccountAccessToken(env);
    const delRes = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/accounts:delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ localId: targetUid }),
    });
    if (!delRes.ok) {
      const errData = await delRes.json().catch(() => ({}));
      return new Response(JSON.stringify({ error: 'delete_failed', detail: errData }), { status: 502, headers: cors });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json', ...cors } });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'admin_delete_error', message: String(e && e.message || e) }), { status: 500, headers: cors });
  }
}

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

    // CORS above only stops browsers from letting other *websites* call this
    // — it does nothing against a direct curl/script hit, since CORS is a
    // browser-enforced convention, not a server-side check. This origin
    // check closes that gap for casual abuse. It's not real authentication
    // (a deliberate attacker can fake the Origin header), just a free,
    // no-billing-required floor — Firebase App Check is the real fix, and
    // needs upgrading the Firebase project off the free Spark plan first.
    // (The admin-delete-user action below has its own, real authentication
    // on top of this, via isVerifiedAdminToken.)
    const origin = request.headers.get('Origin') || '';
    if (origin !== 'https://s0k0s.github.io') {
      return new Response(JSON.stringify({ error: 'forbidden_origin' }), { status: 403, headers: cors });
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400, headers: cors });
    }

    if (body.action === 'admin-delete-user') {
      return handleAdminDeleteUser(body, cors, env);
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
