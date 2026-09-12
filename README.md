# PROGRAMMA — deployment guide

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

**Moderation, not gatekeeping**: since anyone can sign up, and the AI Coach calls your own paid Anthropic API key through the Cloudflare Worker, two safety nets are built in — a per-user daily cap on AI Coach messages (`AI_DAILY_LIMIT` in `index.html`, default 40/day), and an admin panel to revoke a specific account after the fact if needed. Open the app signed in as the admin account, go to the profile icon (top-right) → **Προφίλ** tab → **Χρήστες**, and click "Αφαίρεση πρόσβασης" on anyone who needs to be cut off (their session updates automatically, no refresh needed) — "Επαναφορά πρόσβασης" undoes it.

**The admin account is hardcoded** as `sokratispoun@gmail.com` in both `index.html` (`ADMIN_EMAIL`) and `firestore.rules` (`isAdmin()`) — that account is the only one that can revoke/restore other users' access. If you ever need to change the admin email, update it in both places.

**Important — you must republish the updated `firestore.rules`** for any of this to work: Firestore Console → your project → **Firestore Database → Rules** → paste in the contents of `firestore.rules` from this repo → **Publish**. Without this, the new sign-up flow and per-user data isolation won't be enforced correctly.
