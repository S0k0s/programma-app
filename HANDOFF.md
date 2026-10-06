# Handoff — AI Coach (read this first)

Written by the previous Claude session on 2026-10-06, for whichever agent picks
this up next, so there's no back-and-forth to re-establish context. Everything
below was gathered straight from this repo and this machine (git log, live
files, Xcode project settings) — nothing is guessed. Where something is
genuinely unknown, it's marked as such rather than assumed.

**Do not treat anything in this file as more authoritative than the repo
itself** — if code and this file disagree, the code is current; re-read the
relevant file before acting.

---

## 1. What this is

**AI Coach** ("AI Coach: Workout & Diet" on the App Store) — a personal
trainer/dietitian app. A short AI conversation builds a training program
(gym or home/bodyweight) and daily calorie/macro targets; the user logs
workouts and meals (including an AI photo-scan of a meal), tracks progress,
and can keep talking to the AI Coach, which can edit the live program/targets
directly, not just reply with advice.

**Distribution decision (made explicitly by the user mid-project):** the app
is going **store-only** — iOS App Store + Google Play, paid via each store's
own in-app purchase, **no public web version**. The Stripe/web checkout code
is still present in `index.html` / `anthropic-proxy.js` (it predates that
decision and hasn't been removed yet) — see §7 "Known loose ends."

**One person runs this**: Sokratis Pouneridis (admin email
`sokratispoun@gmail.com`, hardcoded as the sole admin in three places — see
§3). Apple Developer Team: `HZH2JTSTTN`.

---

## 2. Architecture / file map

| Piece | What | Where |
|---|---|---|
| Web app (also the source the apps bundle) | Single-file app: auth, workout/nutrition logging, AI Coach chat, Pro paywall UI | `index.html` (347 KB, one big file) |
| Firebase config | Public identifiers (not secret) | `firebase-config.js` |
| Firestore security rules | Per-user data isolation, admin override, Worker-only docs (subscription/credits/quota) | `firestore.rules` |
| Backend (AI proxy + payments + admin) | Cloudflare Worker — proxies Anthropic, handles Stripe + RevenueCat webhooks, admin user-delete, contact form | `anthropic-proxy.js` — **deploy by pasting into the Cloudflare dashboard editor**, no CLI/CI deploy exists |
| Admin panel | Standalone page, no link from the app, `noindex` | `admin.html` |
| iOS app | Capacitor wrapper that **bundles** `index.html` etc. locally (not a remote URL — required for App Store review, see commit `7860e8f`) | `ios-capacitor/` — run `ios-capacitor/sync-web.sh` before every build to refresh the bundled copy from the repo root files |
| Android app | Trusted Web Activity (Bubblewrap) wrapping the **live site** `https://s0k0s.github.io/programma-app/` (not bundled like iOS) | `android-twa/` — **not in git** (see §6) |
| GitHub Pages hosting | Serves `index.html` etc. for Android (TWA) and for the Privacy Policy URL Apple/Google require | repo root → `https://s0k0s.github.io/programma-app/` |
| Store assets / listing text | Screenshots, privacy labels, review notes, compliance checklist | `store-assets/`, `COMPLIANCE.md`, `README.md`, `IOS-PAYMENTS.md`, `ANDROID-PAYMENTS.md` |

**Deploy model — important, easy to get wrong:**
- Push to `main` → GitHub Pages updates in ~1–2 min → **Android (TWA) and the web page pick it up immediately**, no rebuild.
- **iOS does NOT** — it bundles a snapshot. A code change only reaches the iOS app after: `./ios-capacitor/sync-web.sh` → open in Xcode → bump build number → Archive → upload. Already-installed iOS users (TestFlight/App Store) never get a web-only fix.
- The **Cloudflare Worker has no auto-deploy at all** — every change to `anthropic-proxy.js` requires manually pasting the file into the Cloudflare dashboard's editor and clicking Deploy. **This has bitten us before**: the dashboard editor's syntax highlighting once silently corrupted a literal (the Firebase API key) on paste — see the comment at `anthropic-proxy.js:23` (`'AIzaSyDMXY7bYlH7' + 'Nm2SCi0CFJj-7qAWPW4hTzI'`, split in two on purpose so the editor can't mangle it again). When pasting Worker code, replace the whole file with `Cmd+A`/`Delete` first, not a partial edit.
- **Unverified right now:** whether the Worker currently deployed on Cloudflare matches the `anthropic-proxy.js` in this repo at HEAD. It matched as of commit `c1d0dde` (confirmed in a past session by reading the Cloudflare editor + logs), but several commits have touched it since (RevenueCat/Android support, pricing). **Check the Cloudflare dashboard before assuming any recent Worker-side change is live.**

---

## 3. Identifiers that are safe to reuse (already public / already committed)

These are not secrets — they're already in the repo or are meant to be public:

- Firebase project: `gym-app-f99d6`, API key `AIzaSyDMXY7bYlH7Nm2SCi0CFJj-7qAWPW4hTzI` (`firebase-config.js`)
- Cloudflare Worker URL: `https://programma-ai.sokratispoun.workers.dev`
- Admin email (hardcoded in `admin.html`, `anthropic-proxy.js` `ADMIN_EMAIL`, `firestore.rules` `isAdmin()`): `sokratispoun@gmail.com`
- GitHub Pages / canonical app URL: `https://s0k0s.github.io/programma-app/` (also the Privacy Policy URL: append `?legal=1`)
- iOS bundle id: `io.github.s0k0s.aicoach` · Apple Developer Team: `HZH2JTSTTN` · current build: **6** (marketing version 1.0)
- Android package id: `io.github.s0k0s.aicoach` · `versionCode: 2` · `versionName: 1.0.1`
- RevenueCat iOS public SDK key (safe to ship client-side): `appl_xBIrMsbkEVuxnVZHYtdNPbpFwPd` (already in `index.html` as `REVENUECAT_IOS_PUBLIC_KEY`)
- RevenueCat entitlement id: `pro` · products: `pro_monthly` (€4.99/mo), `pro_annual` (€39.99/yr, base price set for the Greek storefront, other storefronts auto-converted — e.g. Apple shows ≈$3.99/mo, ≈$34.99/yr on the US storefront, that's expected, not a bug)
- Pro limits (server-enforced, `anthropic-proxy.js`): 200 AI messages/month + 40 photo scans/month; free tier gets 0 ongoing daily messages, only `ONBOARDING_FREE_MESSAGE_LIMIT = 25` lifetime onboarding messages
- AI model used: `claude-haiku-4-5-20251001`
- Worker's allowed origins (CORS): `https://s0k0s.github.io`, `capacitor://localhost` (iOS), `https://localhost` (Android TWA)

## 4. Secrets — names only, values unknown to any agent

**No session has ever had or stored the actual values of these.** They exist
only inside the Cloudflare Worker's **Settings → Variables and Secrets**
dashboard (`programma-ai` worker), which only the user can open/edit. If a
new agent needs one of these, it has to come from the user, live, in the
browser — never ask them to paste a secret value into chat; walk them through
pasting it directly into the Cloudflare field.

Required secret names (see `README.md` / `IOS-PAYMENTS.md` / `ANDROID-PAYMENTS.md`
for what each is for and how to obtain it):
`ANTHROPIC_API_KEY`, `FIREBASE_SERVICE_ACCOUNT_KEY`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, `STRIPE_CREDIT_PRICE_ID`,
`RESEND_API_KEY`, `CONTACT_DESTINATION_EMAIL`, `REVENUECAT_SECRET_KEY`,
`REVENUECAT_WEBHOOK_AUTH`.

**Status of the RevenueCat two (`REVENUECAT_SECRET_KEY`,
`REVENUECAT_WEBHOOK_AUTH`) is the one open question** — `IOS-PAYMENTS.md`
still lists them under "still to do" from 20/9, but that file may not have
been updated after the user actually did it. **Ask the user, or check the
Cloudflare dashboard, before assuming either way.**

Also sensitive, **not a Cloudflare secret but a local file** — never read its
bytes out or move it anywhere: `android-twa/android.keystore` (Android app
signing key, password-protected, gitignored). `android-twa/` as a whole is
intentionally **not in git** (see §6).

---

## 5. Current status — where things actually stand

### iOS
- **Apple Developer Program**: enrolled, paid (~$99, charged ~90€), account
  active since ~20/9.
- **App Store Connect**: app created, bundle id and subscription group/products
  set up (see §3 for the exact product ids/prices).
- **Build 6** is the current Xcode project state. Commit history shows the app
  has already been through **at least one App Store review round** and the
  rejections were fixed in code:
  - Guideline 3.1.1 (build 4, commit `fc0b9a3`): a dead "Upgrade" button when
    no IAP offering loaded — fixed.
  - Guideline 1.4.1 (build 6, commits `1c07591`, `ffa64ac`): health/AI-content
    claims needed sourcing — added a Sources & health-information page and a
    "not medical advice · Sources" footer under every AI reply.
- **⚠️ Open and unresolved**: the user said **a new email arrived from Apple**
  at `sokratispouneridis96@icloud.com` (iCloud Mail — no agent has ever had
  access to this inbox; a previous session searched Gmail for it and found
  nothing, because it wasn't in Gmail). **The content of that email was never
  shared in chat.** This is almost certainly the next App Review decision
  (approval, rejection, or a metadata/binary rejection) for build 6, or
  possibly for a build after it if one was submitted since. **First thing to
  do: ask the user to read or forward that email**, then act on whatever it
  says (likely either "ship it" or another round of fixes).
- RevenueCat project "AI Coach" is configured (App Store app, both products,
  `pro` entitlement, `default` offering) per `IOS-PAYMENTS.md` — but see §4 for
  the open question on whether the Worker secrets/webhook side is finished.
- A real purchase/restore/cancel flow has **never been tested end-to-end** in
  any session (needs a Sandbox tester in App Store Connect).

### Android
- The app is a **Trusted Web Activity** (Bubblewrap-generated, in
  `android-twa/`, not bundled like iOS — it loads the live site).
- Google Play Billing wired up via RevenueCat (`android-sync-purchase` Worker
  action, commit `6e25212` + `ANDROID-PAYMENTS.md`'s later additions) — **not
  verified working**, written but untested.
- Google Play Console: the user said earlier they'd started enrollment (25€
  one-time fee). Play requires a **closed testing track with ≥12 testers for
  14 continuous days** before a personal/individual developer account can
  publish — **status of that testing period is unknown to this file;
  ask the user.**
- `android-twa/app-release-bundle.aab` and `android.keystore` exist locally
  (never committed — see §6).

### Web
- Still live at `https://s0k0s.github.io/programma-app/`, still has the
  Stripe checkout UI even though the product decision is store-only now (see
  §7). Needed regardless, as the Android TWA's source and the Privacy Policy
  host.

### Legal / compliance (`COMPLIANCE.md` has the full list)
Done: bilingual EN/EL Terms/Privacy, explicit health-data consent flow, data
export ("Download my data"), account deletion, 18+ gate, medical/AI-content
disclaimers.
**Still needs the user** (not code — business/legal steps): a postal/business
contact address in the privacy policy, business registration + VAT handling
in Greece for Apple/Google payouts, signing each processor's DPA (Google,
Anthropic, RevenueCat, Resend, Cloudflare), confirming Anthropic's data-use/
retention terms match the policy wording, and matching the App Store Privacy
Label / Play Data Safety form answers to `store-assets/apple-privacy-nutrition-label.md`
/ `store-assets/google-play-data-safety.md` inside each console (these are
drafts to copy from, not already submitted).

---

## 6. Repo hygiene — what's tracked, what isn't, and why

Git remote: `origin` → GitHub, branch `main`, pushed up to commit `ffa64ac`
as of this writing. These are **untracked on purpose** (not an oversight):
`android-twa/` (contains the keystore + built `.aab`/`.apk` — deliberately
kept out of git), `well-known-staging/` (has its own nested git repo — leave
it alone), `store-assets/screenshots-ios/*.png`, `store-assets/google-play-data-safety.md`,
`store-assets/play-*.{md,png}`, and the `AI Coach App Overview.pptx` this
session exported. If you want any of these preserved remotely rather than
only on this machine, that's a decision for the user (several past sessions
deliberately left `android-twa/` out when asked to "push everything").

**⚠️ Do not touch:** there's a sibling directory one level up,
`/Users/sokratispouneridis/Desktop/Sokratis All/Gym App/programma-app/`
— this is an **unrelated project** (contains a "Dental solution" folder, its
own `firebase-config.js`, its own git repo). It is not part of this app
despite the similar name; it just happens to sit on disk nearby. Never read,
edit, or export anything from it as part of this project.

---

## 7. Known loose ends / things to flag to the user early

1. **The unread Apple email** (§5) — resolve this first, it may block or
   unblock everything else iOS-related.
2. **Stripe/web-checkout code is still live** in `index.html` /
   `anthropic-proxy.js` despite the store-only decision. Nobody has removed
   it yet. Ask the user whether to keep it (e.g. for a future web relaunch)
   or strip it now.
3. **RevenueCat Worker secrets** — confirm set vs. not (§4).
4. **No end-to-end purchase test** has been run on either platform.
5. **Google Play testing-track progress** is unknown to this file.
6. **Cloudflare Worker drift** — confirm the dashboard matches `anthropic-proxy.js`
   at HEAD before relying on any recent Worker-side change being live.

---

## 8. This session's own deliverable

A 10-slide English overview deck (cover → what it does → 6 feature screenshots
→ pricing → closing), built as a Claude "Slides" Artifact, matching the app's
own dark/lime visual identity. Link:
https://claude.ai/artifact/38Q1Xxyt6G3AsUhh6SAvb3 (private — the user needs to
use the page's own Share menu to let anyone else open it). Also exported to
`AI Coach App Overview.pptx` in the repo root (untracked, local only).

---

## 9. House style notes for whoever continues this

- The user communicates in Greek; code comments are in English. The app's own
  UI **is** user-switchable EN/EL right now (an EN/EL dropdown, `index.html`
  line ~457/834, `let lang = 'en'` default) — ignore the "English only, no
  switcher" section near the bottom of `README.md`, that's stale: it describes
  a state from before commit `47e8101` re-added the switcher, and nobody has
  updated the prose since.
- The user has repeatedly asked for changes to be made directly (edit, test,
  commit) rather than just advised — and to be told plainly when something
  was *not* verified (e.g. "I edited this but couldn't test the camera/IAP
  flow because it needs a real device"). Keep doing that: be concrete about
  what was actually run/confirmed vs. what's untested.
- Every past Cloudflare Worker deploy in this project has been done by the
  user pasting code into the dashboard by hand, often walked through live in
  a browser tool. There is no `wrangler`/CLI deploy set up.
