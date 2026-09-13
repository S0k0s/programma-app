# AI Coach — deployment guide

Three things need to be set up once, in this order. None of these steps involve giving anyone your API key or password except your own browser — do them yourself.

## 1. Firebase (cross-device sync)

1. Go to https://console.firebase.google.com → **Add project** → give it any name (e.g. `programma-app`).
2. In the left menu: **Build > Authentication** → **Get started** → enable the **Google** sign-in provider AND the **Email/Password** sign-in provider (both are used).
3. In the left menu: **Build > Firestore Database** → **Create database** → start in **production mode**.
4. Still in Firestore: **Rules** tab → replace the contents with the file `firestore.rules` from this repo → **Publish**.
5. Left menu: **Project settings** (gear icon) → scroll to **Your apps** → click the **</>** (web) icon → register an app (any nickname) → copy the `firebaseConfig` object it shows you.
6. Paste those values into `firebase-config.js` in this repo, replacing the `REPLACE_ME` placeholders.

## 2. Cloudflare Worker (AI Coach, keeps your API key private)

1. Go to https://dash.cloudflare.com → sign up free if needed → **Workers & Pages** → **Create** → **Create Worker**.
2. Give it a name (e.g. `programma-ai`) → **Deploy** (deploys a blank starter first).
3. Click **Edit code** → delete the default content → paste in the contents of `anthropic-proxy.js` from this repo → **Deploy**.
4. Go to the Worker's **Settings > Variables and Secrets** → **Add** → name it `ANTHROPIC_API_KEY`, type **Secret**, paste your Anthropic API key as the value → **Save**.
5. Copy the Worker's URL shown at the top (looks like `https://programma-ai.<your-subdomain>.workers.dev`).
6. Paste that URL into `index.html`, replacing `const WORKER_URL = 'https://REPLACE-ME.workers.dev';` near the top of the `<script>` block.
7. Once you know your GitHub Pages URL (step 3 below), go back into `anthropic-proxy.js`'s `Access-Control-Allow-Origin` and change `'*'` to your actual `https://yourusername.github.io` — then re-paste/re-deploy in the Cloudflare dashboard. This stops anyone else's website from riding on your API key.

The AI Coach also needs the Firebase service account described in **Admin: fully deleting another user's account** below (it's what lets the Worker verify who's asking and enforce the daily message quota server-side) — set that up too before the AI Coach will respond.

## 3. GitHub Pages (hosting)

1. Push all files in this folder to a GitHub repository.
2. Repo **Settings > Pages** → Source: **Deploy from a branch** → Branch: `main` / `(root)` → **Save**.
3. Your app will be live at `https://yourusername.github.io/repo-name/` within a minute or two.

## After setup

- Open the site, sign in with Google — the same sign-in on your phone/tablet/laptop shows the same workout and food history everywhere, since it's stored in Firestore under your account, not the browser.
- If the AI Coach shows a connection error, double-check `WORKER_URL` in `index.html` and the `ANTHROPIC_API_KEY` secret in the Worker.

## Multi-user sign-up

The app supports multiple people, each with their own private workout/nutrition/AI-coach data — no one can see anyone else's. Sign-up is **open**, with two sign-in methods:

1. **Google, or email + password** → either way, the account is created and immediately usable — no waiting for approval. Firebase Auth's built-in email/password flow handles password storage and "forgot password" reset emails itself; nothing custom to build or maintain there.
2. **First-time AI onboarding** → a first-time user is greeted by an AI chat whose very first question is always **gym or home/outdoor training** (some people simply can't afford a gym membership) — everything else follows from that: goal, stats, training days/week, experience, and any dietary/injury notes. It then computes personalized calorie/macro targets and picks a location-appropriate training split (Full Body 3x, Upper/Lower 4x, or Push/Pull/Legs 6x depending on days available) — gym users get barbell/machine exercises, home/outdoor users get a bodyweight + resistance-band + park-bar program with its own icon set. They can skip this for a sensible default, and can always redo it later from the Προφίλ tab.
3. **The AI Coach can also adjust the live program during a normal chat**, not just during onboarding — e.g. if someone tells it they don't go to a gym anymore, or asks it to swap out a specific exercise they don't like, the change is applied to their actual profile/Προπόνηση tab immediately, not just described in the chat reply.

**Moderation, not gatekeeping**: since anyone can sign up, and the AI Coach calls your own paid Anthropic API key through the Cloudflare Worker, safety nets are built in — a per-user message cap on the AI Coach (see "AI Coach Pro subscription + credit packs" below for the exact model), enforced **server-side** by the Worker itself (it checks who's asking via their Firebase sign-in, so it can't be bypassed by skipping client-side code) — and a separate admin page to revoke a specific account after the fact if needed.

**The admin panel lives at `admin.html`**, a standalone page with no link anywhere in the main app (`index.html`) — nothing about it ships to regular users at all, not even hidden/dead code, and it isn't listed anywhere for search engines (`<meta name="robots" content="noindex, nofollow">`). Open `https://yourusername.github.io/repo-name/admin.html` directly (bookmark it), sign in with the admin's Google account, and you'll see the user list with **Revoke access** / **Restore access** per user (their session updates automatically, no refresh needed). This is a convenience layer only — the real access control is Firestore's own rules (`isAdmin()`), which check the signed-in account's email server-side regardless of which page is asking, so a non-admin who somehow finds the URL still can't read the user list or act on it.

**The admin account is hardcoded** as `sokratispoun@gmail.com` in `admin.html`, `anthropic-proxy.js` (`ADMIN_EMAIL`), and `firestore.rules` (`isAdmin()`) — that account is the only one that can revoke/restore other users' access or reach the admin page. If you ever need to change the admin email, update it in all three places.

**Important — you must republish the updated `firestore.rules`** for any of this to work: Firestore Console → your project → **Firestore Database → Rules** → paste in the contents of `firestore.rules` from this repo → **Publish**. Without this, the new sign-up flow and per-user data isolation won't be enforced correctly.

## Admin: fully deleting another user's account, and the AI Coach's own server-side checks

"Revoke access" (above) only blocks a user — it doesn't delete their Firebase Auth account or data. There's also a **"Delete account"** button per user on `admin.html`, which does actually delete everything (their Firestore data, and their sign-in account itself). Deleting the Firebase *sign-in* record for someone other than yourself isn't something any client app can do directly — Firebase only allows a signed-in user to delete their *own* account — so this goes through the Cloudflare Worker with a Google Cloud **service account** that has permission to do it.

The same service account is also what lets the Worker verify a caller's identity and read/write their `subscription`/quota docs in Firestore for the AI Coach (see `firestore.rules` — those docs are deliberately not writable by the client itself). One-time setup, on the free Spark plan (no billing needed):

1. Go to https://console.cloud.google.com/iam-admin/serviceaccounts, select your Firebase project, **Create Service Account** (any name, e.g. `admin-delete-worker`).
2. Grant it **two** roles: **Firebase Authentication Admin** (for account deletion/verification) and **Cloud Datastore User** (for the Firestore reads/writes the AI Coach quota and subscription checks need).
3. Open the new service account → **Keys** tab → **Add Key → Create new key → JSON** → this downloads a `.json` file. Treat it like a password — it grants real admin power over your users and their data.
4. Go to your Cloudflare Worker (the same one used for the AI Coach) → **Settings → Variables and Secrets → Add** → name it `FIREBASE_SERVICE_ACCOUNT_KEY`, type **Secret**, paste in the *entire contents* of that downloaded `.json` file → **Save**.
5. Paste the updated `anthropic-proxy.js` from this repo into the Worker's **Edit code** view → **Deploy** (same manual copy-paste step as any other Worker update — see above).
6. Publish the updated `firestore.rules` from this repo too (see above) — it now lets the admin account read/write/delete *any* user's data, not just their own, which the "delete account" button relies on, and it stops any signed-in user from writing their own `subscription`/`credits`/`ai-usage:*` docs (those are Worker-only, see below).

Once that's done, deleting an account from the admin panel removes both their data and their ability to sign in again — permanently, with no undo.

## AI Coach Pro subscription + credit packs (Stripe)

**The paywall model**: the initial AI onboarding conversation (building someone's program) is free — bounded to `ONBOARDING_FREE_MESSAGE_LIMIT` messages in `anthropic-proxy.js` (default 25, comfortably enough for a real onboarding plus an occasional redo). Every message in the regular AI Coach tab after that needs payment: either a **Pro** subscription (a generous daily limit, `PRO_DAILY_LIMIT` in `anthropic-proxy.js`, default 150/day) or a one-time **credit pack** (`CREDIT_PACK_SIZE` messages, default 50, spent one at a time, no subscription needed). `FREE_DAILY_LIMIT` is deliberately `0` — there is no ongoing free daily allowance for regular chat, only the bounded onboarding one. All of this is enforced **server-side** by the Worker (it checks who's asking via their Firebase sign-in and reads/writes their quota in Firestore itself), so it can't be bypassed by editing the page or skipping client-side code — a client claiming `phase:'onboarding'` past the lifetime cap just falls through to the same paid gate as regular messages. Pro accounts don't see the credit-pack option — their daily limit is already high. Both payment paths need a Stripe account and a few Worker secrets — the Worker's service account from the section above (Cloud Datastore User role) is what lets it write the subscription/credit status after a successful payment.

1. Create a Stripe account at https://dashboard.stripe.com if you don't have one, and switch to **Test mode** first (toggle top-right) to try the whole flow before going live.
2. **Product catalog** → **Add product** → name it (e.g. "AI Coach Pro"), set a recurring **Price** (e.g. €2.99/month) → **Save**. Copy the Price's ID (starts `price_...`).
3. **Product catalog** → **Add product** again → name it (e.g. "AI Coach — 50 message pack"), this time set a **one-time Price** (e.g. €1.99) → **Save**. Copy this Price's ID too.
4. **Developers → API keys** → copy the **Secret key** (starts `sk_...`, or `sk_test_...` in test mode).
5. In the Cloudflare Worker → **Settings → Variables and Secrets** → add `STRIPE_SECRET_KEY` (step 4), `STRIPE_PRICE_ID` (the subscription Price from step 2), and `STRIPE_CREDIT_PRICE_ID` (the one-time Price from step 3), all type **Secret**.
6. **Developers → Webhooks → Add endpoint** → URL: `https://<your-worker-subdomain>.workers.dev/stripe-webhook` → select events **checkout.session.completed**, **customer.subscription.updated**, **customer.subscription.deleted** → **Add endpoint**. Open it and copy the **Signing secret** (starts `whsec_...`).
7. Add that as a Worker secret named `STRIPE_WEBHOOK_SECRET`.
8. Re-paste `anthropic-proxy.js` into the Worker's **Edit code** view → **Deploy** (needed once after adding these secrets, same as any other Worker update).
9. Test with a real Checkout run using [Stripe's test card](https://docs.stripe.com/testing) `4242 4242 4242 4242`, any future expiry/CVC — sign in to the app, Profile tab → try both "Upgrade to Pro" and "Buy 50 extra messages" → complete checkout → sign back in (checkout leaves and returns to the app, which signs you out — see "Password reset" note below on why) → Profile tab should reflect the new plan/credit balance.
10. If `CREDIT_PACK_SIZE` in `anthropic-proxy.js` (default `50`) doesn't match the pack size you're actually selling, update it there — it's the number of messages granted per successful one-time payment, and isn't read from Stripe.
11. When ready for real payments, switch Stripe out of Test mode, repeat steps 2–7 with live values (live Price IDs, a live secret key, and a live-mode webhook endpoint all differ from their test-mode counterparts), and update the four Worker secrets.

## Password reset now happens inside the app

Clicking "Forgot your password?" sends a reset email whose link opens back inside this app (instead of Firebase's plain generic page), so the new password goes through the same strength rules as sign-up and a stale/reused link shows a clear message instead of a confusing rejection. Nothing to configure — this works as soon as `index.html` is deployed, since `PASSWORD_RESET_CONTINUE_URL` in the file already points at `https://s0k0s.github.io/programma-app/`. If you ever move the app to a different URL, update that constant to match.

## Contact form / bug reports (Resend)

The Profile tab has a "Report a problem" box that emails you directly — the destination inbox is a Worker secret, never shipped to the browser, so it doesn't show up in the page source or network requests the way a `mailto:` link or a client-side email API call would.

1. Create a free account at https://resend.com.
2. **API Keys** → **Create API Key** → copy it.
3. In the Cloudflare Worker → **Settings → Variables and Secrets** → add `RESEND_API_KEY` (the key from step 2) and `CONTACT_DESTINATION_EMAIL` (the inbox you want messages sent to), both type **Secret**.
4. Re-paste `anthropic-proxy.js` into the Worker's **Edit code** view → **Deploy**.
5. That's it — messages send from Resend's shared address (`onboarding@resend.dev`), which works immediately with no domain setup. If you'd rather send from your own domain (e.g. `noreply@yourdomain.com`), verify a domain under **Domains** in Resend and change the `from` address in `handleContactMessage` in `anthropic-proxy.js` to match.

## English only

The app UI is English-only (no language switcher) — it used to also ship Greek, but for a broad, non-Greek-specific audience the language is fixed. `lang` in `index.html` is a hardcoded constant now rather than something the user can switch; the old Greek strings are still present in the file as unused data (harmless, just not shown to anyone) rather than hand-deleted from every call site.
