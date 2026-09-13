// Cloudflare Worker — proxies AI Coach requests to the Anthropic API, handles
// Stripe subscription checkout/billing/webhooks for the AI Coach Pro tier,
// sends contact-form/bug-report messages via Resend, and handles one
// privileged admin action: permanently deleting another user's Firebase Auth
// account. The Anthropic API key, the Stripe secret key, the Resend API key,
// the destination inbox for contact messages, and the Firebase service
// account key all live only here, as Worker secrets — none of them is ever
// sent to, or visible in, the browser (the destination inbox in particular
// is why this goes through the Worker at all, rather than a client-side
// mailto: link or a form pointed straight at an email API).
//
// Deploy: paste this file's content into the Worker in the Cloudflare
// dashboard (Workers & Pages > your worker > Edit code), then:
//   Settings > Variables and Secrets > add secrets named ANTHROPIC_API_KEY,
//   FIREBASE_SERVICE_ACCOUNT_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
//   STRIPE_PRICE_ID, STRIPE_CREDIT_PRICE_ID, RESEND_API_KEY and
//   CONTACT_DESTINATION_EMAIL (see README.md for how to get each one).

const FIREBASE_PROJECT_ID = 'gym-app-f99d6';
const FIREBASE_API_KEY = 'AIzaSyDMXY7bYlH7Nm2SCi0CFJj-7qAWPW4hTzI'; // public identifier, same as firebase-config.js
const ADMIN_EMAIL = 'sokratispoun@gmail.com';
const APP_URL = 'https://s0k0s.github.io/programma-app/';

// AI Coach model/limits are decided server-side only — the request body is
// client-controlled, so trusting a client-supplied model or max_tokens would
// let anyone inflate the API bill far beyond what their message quota implies.
const AI_MODEL = 'claude-haiku-4-5-20251001';
const AI_MAX_TOKENS_CAP = 700;
// Free tier gets zero ongoing daily messages — the only free AI use is the
// bounded onboarding allowance below. Every regular AI Coach message needs
// an active Pro subscription or a purchased credit; see checkAndConsumeQuota.
const FREE_DAILY_LIMIT = 0;
const PRO_DAILY_LIMIT = 150;
// One-time top-up so someone who doesn't want a subscription can still pay
// per use: once the (zero) free allowance is exhausted, a purchased credit
// is spent instead of blocking. Pro users never need these.
const CREDIT_PACK_SIZE = 50;
// The initial onboarding conversation (building the program) stays free,
// bounded to this many lifetime messages so a client can't just keep
// claiming phase:'onboarding' to get unlimited free chat — a real onboarding
// (plus an occasional redo) comfortably fits in this budget; past it,
// onboarding messages fall through to the same paid gate as regular chat.
const ONBOARDING_FREE_MESSAGE_LIMIT = 25;

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

async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Exchanges the Firebase service account's private key for a short-lived
// Google OAuth2 access token, via the standard JWT-bearer flow — this is
// the same mechanism the Firebase Admin SDK uses internally, just done by
// hand since Cloudflare Workers can't run that Node-only SDK. Scoped for
// both Identity Toolkit (admin user deletion) and Firestore (subscription /
// quota reads+writes), since both use the same service account.
async function getServiceAccountAccessToken(env) {
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/datastore',
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

// Confirms an ID token really belongs to a signed-in Firebase user, using
// Google's own token-verification endpoint — this avoids needing to
// implement JWT/JWKS signature verification by hand for every request;
// Google's servers do that check and hand back the decoded claims.
async function verifyIdToken(idToken) {
  if (!idToken) return null;
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const user = data.users && data.users[0];
  if (!user) return null;
  return { uid: user.localId, email: user.email, emailVerified: !!user.emailVerified };
}

async function isVerifiedAdminToken(idToken) {
  const user = await verifyIdToken(idToken).catch(() => null);
  return !!(user && user.email === ADMIN_EMAIL && user.emailVerified);
}

// ---------- Firestore REST helpers (users/{uid}/data/{docId} docs only) ----------

function firestoreDocUrl(uid, docId) {
  return `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${uid}/data/${encodeURIComponent(docId)}`;
}

// Mirrors the client's own storage shim (index.html's `storage.get/set`):
// each users/{uid}/data/{docId} document has a single 'value' field holding
// a JSON string. Writing the same shape here means the client can keep
// reading e.g. the subscription doc with its existing storage.get('subscription')
// — it just can no longer write it (see firestore.rules).
async function firestoreGetUserDoc(accessToken, uid, docId) {
  const res = await fetch(firestoreDocUrl(uid, docId), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('firestore_get_failed: ' + res.status);
  const doc = await res.json();
  const raw = doc.fields && doc.fields.value && doc.fields.value.stringValue;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

async function firestoreSetUserDoc(accessToken, uid, docId, obj) {
  const res = await fetch(firestoreDocUrl(uid, docId), {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { value: { stringValue: JSON.stringify(obj) } } }),
  });
  if (!res.ok) throw new Error('firestore_set_failed: ' + res.status);
}

// Maps a Stripe customer id to the uid that owns it, so subscription-update
// webhooks (which only carry the customer id, not the uid) can find the
// right user doc. Lives outside users/{uid}/data — no client Firestore rule
// grants access to it, so it's unreachable from the browser either way.
function stripeCustomerDocUrl(customerId) {
  return `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/stripeCustomers/${encodeURIComponent(customerId)}`;
}

async function setStripeCustomerUid(accessToken, customerId, uid) {
  const res = await fetch(stripeCustomerDocUrl(customerId), {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { uid: { stringValue: uid } } }),
  });
  if (!res.ok) throw new Error('firestore_set_failed: ' + res.status);
}

async function getStripeCustomerUid(accessToken, customerId) {
  const res = await fetch(stripeCustomerDocUrl(customerId), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('firestore_get_failed: ' + res.status);
  const doc = await res.json();
  return (doc.fields && doc.fields.uid && doc.fields.uid.stringValue) || null;
}

// ---------- AI Coach: subscription tier + daily quota ----------

function utcDateKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function tierFromSubscription(sub) {
  if (sub && sub.status === 'active' && sub.currentPeriodEnd && sub.currentPeriodEnd * 1000 > Date.now()) return 'pro';
  return 'free';
}

// Not atomic (read-then-write) — acceptable here since this is a low-stakes,
// low-concurrency-per-user counter (a user isn't sending two AI messages in
// the same instant), not a payments ledger. Free-tier users who've used up
// the day's free messages spend a purchased credit instead of being blocked,
// if they have any (see CREDIT_PACK_SIZE) — Pro users never touch credits,
// their daily limit is already high.
async function checkAndConsumeQuota(accessToken, uid, tier) {
  const limit = tier === 'pro' ? PRO_DAILY_LIMIT : FREE_DAILY_LIMIT;
  const docId = 'ai-usage:' + utcDateKey();
  const existing = await firestoreGetUserDoc(accessToken, uid, docId);
  const count = (existing && existing.count) || 0;
  if (count < limit) {
    await firestoreSetUserDoc(accessToken, uid, docId, { count: count + 1 });
    return { ok: true, limit, remaining: limit - (count + 1) };
  }
  if (tier === 'free') {
    const credits = await firestoreGetUserDoc(accessToken, uid, 'credits');
    const balance = (credits && credits.balance) || 0;
    if (balance > 0) {
      await firestoreSetUserDoc(accessToken, uid, 'credits', { balance: balance - 1, updatedAt: Math.floor(Date.now() / 1000) });
      return { ok: true, limit, remaining: 0, creditsRemaining: balance - 1, viaCredit: true };
    }
  }
  return { ok: false, limit };
}

// Bounded free allowance for the onboarding conversation only — reads and
// increments a single lifetime counter doc (not a daily one), capped at
// ONBOARDING_FREE_MESSAGE_LIMIT. Returns true (and consumes one) only while
// under the cap; false once it's used up, so the caller falls through to the
// normal paid gate instead of trusting a client-asserted phase forever.
async function consumeOnboardingFreeAllowance(accessToken, uid) {
  const existing = await firestoreGetUserDoc(accessToken, uid, 'onboarding-usage');
  const count = (existing && existing.count) || 0;
  if (count >= ONBOARDING_FREE_MESSAGE_LIMIT) return false;
  await firestoreSetUserDoc(accessToken, uid, 'onboarding-usage', { count: count + 1 });
  return true;
}

async function handleAiProxy(body, cors, env) {
  const user = await verifyIdToken(body.idToken).catch(() => null);
  if (!user) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: cors });
  }
  let accessToken;
  try {
    accessToken = await getServiceAccountAccessToken(env);
  } catch (e) {
    return new Response(JSON.stringify({ error: 'server_error' }), { status: 500, headers: cors });
  }
  const sub = await firestoreGetUserDoc(accessToken, user.uid, 'subscription').catch(() => null);
  const tier = tierFromSubscription(sub);

  let quota;
  const isOnboarding = body.phase === 'onboarding';
  const gotFreeOnboardingMessage = isOnboarding && await consumeOnboardingFreeAllowance(accessToken, user.uid).catch(() => false);
  if (gotFreeOnboardingMessage) {
    quota = { ok: true, limit: null, remaining: null };
  } else {
    quota = await checkAndConsumeQuota(accessToken, user.uid, tier).catch(() => null);
  }
  if (!quota) {
    return new Response(JSON.stringify({ error: 'server_error' }), { status: 500, headers: cors });
  }
  if (!quota.ok) {
    return new Response(JSON.stringify({ error: 'quota_exceeded', tier, limit: quota.limit, onboarding: isOnboarding }), { status: 403, headers: cors });
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
        model: AI_MODEL,
        max_tokens: Math.min(Number(body.max_tokens) || 600, AI_MAX_TOKENS_CAP),
        system: body.system,
        messages: body.messages,
      }),
    });
    const data = await anthropicRes.json();
    if (!anthropicRes.ok) {
      return new Response(JSON.stringify(data), { status: anthropicRes.status, headers: { 'Content-Type': 'application/json', ...cors } });
    }
    return new Response(JSON.stringify({ ...data, tier, limit: quota.limit, remaining: quota.remaining, viaCredit: !!quota.viaCredit, creditsRemaining: quota.creditsRemaining }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'proxy_error' }), { status: 500, headers: cors });
  }
}

// ---------- Stripe: checkout, billing portal, webhook ----------

async function stripeApi(env, path, form) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(form)) body.append(k, v);
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error('stripe_error: ' + JSON.stringify(data));
  return data;
}

async function handleCreateCheckoutSession(body, cors, env) {
  const user = await verifyIdToken(body.idToken).catch(() => null);
  if (!user) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: cors });
  try {
    const session = await stripeApi(env, 'checkout/sessions', {
      mode: 'subscription',
      'line_items[0][price]': env.STRIPE_PRICE_ID,
      'line_items[0][quantity]': '1',
      client_reference_id: user.uid,
      customer_email: user.email || '',
      success_url: `${APP_URL}?upgrade=success`,
      cancel_url: `${APP_URL}?upgrade=cancel`,
      // EU consumers get a 14-day right of withdrawal on distance purchases
      // of digital services by default — since the subscription activates
      // immediately, this checkbox is their express consent to that
      // immediate performance and their acknowledgment that the right of
      // withdrawal is lost once the service has been delivered.
      'consent_collection[terms_of_service]': 'required',
      'custom_text[terms_of_service_acceptance][message]': 'I agree to immediate activation of the subscription and understand I lose my 14-day right of withdrawal once it starts.',
    });
    return new Response(JSON.stringify({ url: session.url }), { status: 200, headers: { 'Content-Type': 'application/json', ...cors } });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'stripe_error' }), { status: 500, headers: cors });
  }
}

// One-time credit pack purchase, free-tier users only — a Pro subscriber
// already has a much higher daily limit, so credits aren't offered to them
// (enforced here, not just hidden client-side, since the client can't be
// trusted to gate its own purchases).
async function handleCreateCreditCheckoutSession(body, cors, env) {
  const user = await verifyIdToken(body.idToken).catch(() => null);
  if (!user) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: cors });
  try {
    const accessToken = await getServiceAccountAccessToken(env);
    const sub = await firestoreGetUserDoc(accessToken, user.uid, 'subscription').catch(() => null);
    if (tierFromSubscription(sub) === 'pro') {
      return new Response(JSON.stringify({ error: 'not_eligible' }), { status: 400, headers: cors });
    }
    const session = await stripeApi(env, 'checkout/sessions', {
      mode: 'payment',
      'line_items[0][price]': env.STRIPE_CREDIT_PRICE_ID,
      'line_items[0][quantity]': '1',
      client_reference_id: user.uid,
      customer_email: user.email || '',
      success_url: `${APP_URL}?credits=success`,
      cancel_url: `${APP_URL}?credits=cancel`,
      // See the matching comment in handleCreateCheckoutSession above — same
      // EU withdrawal-right consent, for the one-time message pack.
      'consent_collection[terms_of_service]': 'required',
      'custom_text[terms_of_service_acceptance][message]': 'I agree to immediate delivery of these messages and understand I lose my 14-day right of withdrawal once they are credited.',
    });
    return new Response(JSON.stringify({ url: session.url }), { status: 200, headers: { 'Content-Type': 'application/json', ...cors } });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'stripe_error' }), { status: 500, headers: cors });
  }
}

async function handleCreatePortalSession(body, cors, env) {
  const user = await verifyIdToken(body.idToken).catch(() => null);
  if (!user) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: cors });
  try {
    const accessToken = await getServiceAccountAccessToken(env);
    const sub = await firestoreGetUserDoc(accessToken, user.uid, 'subscription');
    if (!sub || !sub.stripeCustomerId) {
      return new Response(JSON.stringify({ error: 'no_subscription' }), { status: 404, headers: cors });
    }
    const portal = await stripeApi(env, 'billing_portal/sessions', {
      customer: sub.stripeCustomerId,
      return_url: APP_URL,
    });
    return new Response(JSON.stringify({ url: portal.url }), { status: 200, headers: { 'Content-Type': 'application/json', ...cors } });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'stripe_error' }), { status: 500, headers: cors });
  }
}

function mapStripeStatus(stripeStatus) {
  return (stripeStatus === 'active' || stripeStatus === 'trialing') ? 'active' : 'canceled';
}

// Newer Stripe API versions dropped current_period_end/start from the
// top-level Subscription object (flexible billing mode moved them onto each
// subscription item instead) — read whichever location the active API
// version actually populates, so this keeps working across the migration.
function subscriptionCurrentPeriodEnd(stripeSub) {
  if (stripeSub.current_period_end) return stripeSub.current_period_end;
  const item = stripeSub.items && stripeSub.items.data && stripeSub.items.data[0];
  return item ? item.current_period_end : undefined;
}

async function upsertSubscriptionFromStripeSubscription(accessToken, uid, stripeSub) {
  await firestoreSetUserDoc(accessToken, uid, 'subscription', {
    status: mapStripeStatus(stripeSub.status),
    stripeCustomerId: stripeSub.customer,
    stripeSubscriptionId: stripeSub.id,
    currentPeriodEnd: subscriptionCurrentPeriodEnd(stripeSub),
    updatedAt: Math.floor(Date.now() / 1000),
  });
  await setStripeCustomerUid(accessToken, stripeSub.customer, uid);
}

async function grantCreditPack(accessToken, uid, amount) {
  const existing = await firestoreGetUserDoc(accessToken, uid, 'credits');
  const balance = (existing && existing.balance) || 0;
  await firestoreSetUserDoc(accessToken, uid, 'credits', { balance: balance + amount, updatedAt: Math.floor(Date.now() / 1000) });
}

// Stripe delivers webhooks at-least-once, so the same checkout.session.completed
// event can arrive more than once. Upserting a subscription from it is
// naturally idempotent (same status written twice is harmless), but *adding*
// credits isn't — a duplicate delivery would double-grant. This claims the
// session id exactly once via a create-only Firestore write (fails if the
// doc already exists), so a redelivery is a no-op.
async function tryClaimCheckoutSession(accessToken, sessionId) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/processedCheckoutSessions/${encodeURIComponent(sessionId)}?currentDocument.exists=false`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { processedAt: { integerValue: String(Math.floor(Date.now() / 1000)) } } }),
  });
  return res.ok; // true = claimed just now (first delivery); false = already processed
}

// Verifies the Stripe-Signature header by hand (HMAC-SHA256 over
// "{timestamp}.{rawBody}"), since this Worker has no npm dependencies and
// can't install the Stripe SDK — same hand-rolled-crypto approach already
// used above for the Firebase service-account JWT.
async function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader) return false;
  const parts = Object.fromEntries(sigHeader.split(',').map(kv => kv.split('=')));
  const timestamp = parts.t;
  const v1 = parts.v1;
  if (!timestamp || !v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false; // 5 min replay tolerance
  const expected = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
  return expected === v1;
}

async function handleStripeWebhook(request, env) {
  const rawBody = await request.text();
  const sig = request.headers.get('Stripe-Signature');
  const valid = await verifyStripeSignature(rawBody, sig, env.STRIPE_WEBHOOK_SECRET).catch(() => false);
  if (!valid) return new Response('invalid signature', { status: 400 });

  const event = JSON.parse(rawBody);
  try {
    const accessToken = await getServiceAccountAccessToken(env);
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const uid = session.client_reference_id;
      if (uid && session.mode === 'subscription' && session.subscription) {
        const subRes = await fetch(`https://api.stripe.com/v1/subscriptions/${session.subscription}`, {
          headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
        });
        const stripeSub = await subRes.json();
        if (subRes.ok) await upsertSubscriptionFromStripeSubscription(accessToken, uid, stripeSub);
      } else if (uid && session.mode === 'payment') {
        const firstDelivery = await tryClaimCheckoutSession(accessToken, session.id);
        if (firstDelivery) await grantCreditPack(accessToken, uid, CREDIT_PACK_SIZE);
      }
    } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const stripeSub = event.data.object;
      const uid = await getStripeCustomerUid(accessToken, stripeSub.customer);
      if (uid) await upsertSubscriptionFromStripeSubscription(accessToken, uid, stripeSub);
    }
  } catch (e) {
    // Stripe retries on non-2xx, so surface failures instead of swallowing them.
    return new Response('webhook processing failed', { status: 500 });
  }
  return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

// ---------- Contact form / bug reports (Resend) ----------

const CONTACT_MESSAGE_MAX_LEN = 4000;

// Requires a signed-in user (same idToken check as everything else here) —
// not because the message content is sensitive, but so this endpoint can't
// be used as an anonymous open mail relay by a script hitting the Worker
// directly (CORS/Origin only stops browsers, not curl — see the Origin
// check note in fetch() below).
async function handleContactMessage(body, cors, env) {
  const user = await verifyIdToken(body.idToken).catch(() => null);
  if (!user) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: cors });

  const message = String(body.message || '').trim().slice(0, CONTACT_MESSAGE_MAX_LEN);
  if (!message) return new Response(JSON.stringify({ error: 'empty_message' }), { status: 400, headers: cors });

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // Resend's shared sandbox sender — works with no domain setup. Swap
        // for an address on a verified domain once one is set up in Resend.
        from: 'AI Coach <onboarding@resend.dev>',
        to: [env.CONTACT_DESTINATION_EMAIL],
        reply_to: user.email || undefined,
        subject: 'AI Coach — contact form message',
        text: `From: ${user.email || 'unknown'} (uid: ${user.uid})\n\n${message}`,
      }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return new Response(JSON.stringify({ error: 'send_failed', detail: errData }), { status: 502, headers: cors });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json', ...cors } });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'send_error' }), { status: 500, headers: cors });
  }
}

// ---------- Admin: delete a user's Firebase Auth account ----------

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
    const url = new URL(request.url);

    // Stripe calls this directly (server-to-server) — no Origin header to
    // check, and authenticity comes from the signature, not CORS.
    if (url.pathname === '/stripe-webhook' && request.method === 'POST') {
      return handleStripeWebhook(request, env);
    }

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
    // Real authentication for the AI Coach and Stripe actions below comes
    // from verifyIdToken, not from this Origin check.
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
    if (body.action === 'create-checkout-session') {
      return handleCreateCheckoutSession(body, cors, env);
    }
    if (body.action === 'create-credit-checkout-session') {
      return handleCreateCreditCheckoutSession(body, cors, env);
    }
    if (body.action === 'create-portal-session') {
      return handleCreatePortalSession(body, cors, env);
    }
    if (body.action === 'send-contact-message') {
      return handleContactMessage(body, cors, env);
    }

    return handleAiProxy(body, cors, env);
  },
};
