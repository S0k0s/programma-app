# PROGRAMMA — deployment guide

Three things need to be set up once, in this order. None of these steps involve giving anyone your API key or password except your own browser — do them yourself.

## 1. Firebase (cross-device sync)

1. Go to https://console.firebase.google.com → **Add project** → give it any name (e.g. `programma-app`).
2. In the left menu: **Build > Authentication** → **Get started** → enable the **Google** sign-in provider.
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
