# Handoff — AI Coach (read this first)

Written by the previous Claude session on 2026-10-06, **last updated 2026-10-09**,
for whichever agent picks this up next, so there's no back-and-forth to
re-establish context. Everything below was gathered straight from this repo,
this machine, Gmail, Google Play Console and App Store Connect (live, in a
browser tool, logged in as the user) — nothing is guessed. Where something is
genuinely unknown, it's marked as such rather than assumed.

**Headline as of 2026-10-09: Android is live on Google Play. iOS is not —
build 7 is queued for Apple review.** Also as of 2026-10-09: a Play Store
listing update (app name → "AI Coach: Workout & Diet", matching Apple; plus a
corrected AI-content declaration) was submitted for Google review same day.
See §5 for the full detail.

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
- iOS bundle id: `io.github.s0k0s.aicoach` · Apple Developer Team: `HZH2JTSTTN` · App Store Connect app id `6814126007` · build submitted for review: **7** (marketing version 1.0) — the local `ios-capacitor/ios/App/App.xcodeproj/project.pbxproj` is currently a committed `CURRENT_PROJECT_VERSION = 6` plus an **uncommitted** bump to 7 sitting on disk (see §6); the actual uploaded/submitted build is 7
- Android package id: `io.github.s0k0s.aicoach` · App Store Connect-equivalent: Play Console app id `4973693056515804123`, developer account id `6487696998666308799` · live release: version code 1 (1.0.0)
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

### Android — ✅ LIVE on Google Play (since 2026-10-09)
Full timeline, confirmed by reading Google Play Console and Gmail directly:
- Closed testing (alpha) ran 2026-09-16 → 2026-10-08, reached 178 opted-in
  testers (well over the 12 required), satisfying all three production-access
  criteria (12+ testers opted in, run for 14+ days).
- 2026-10-08: requested production access via the Play Console dashboard
  (answered Google's required questionnaire about the testing process,
  target audience, expected installs — "don't know" was chosen honestly for
  installs rather than guessing).
- 2026-10-09 (next day): **production access granted** (email from
  `no-reply-googleplay-developer@google.com`, subject "Congratulations! Your
  app has been granted Google Play production access").
- Same session, same day: selected all countries/regions, created a
  production release reusing the existing closed-testing app bundle (version
  code 1 / 1.0.0 — Android doesn't need a new build for web-content changes,
  since the TWA loads the live site rather than bundling it, unlike iOS),
  wrote release notes, and submitted for review at 100% rollout.
- Google's automated checks passed quickly; the app **published the same
  day**. Confirmed two ways: Play Console's dashboard notification ("Η
  ενημέρωση της εφαρμογής δημοσιεύτηκε…") and by loading the live public
  listing: https://play.google.com/store/apps/details?id=io.github.s0k0s.aicoach
  (shows "1+ Λήψεις" / installs already).
- **Not yet verified in any session**: an actual Google Play Billing
  purchase (`android-sync-purchase` Worker action, written per
  `ANDROID-PAYMENTS.md`, never exercised end-to-end).
- `android-twa/app-release-bundle.aab` and `android.keystore` exist locally
  (never committed — see §6). The currently-live release uses an app bundle
  that was already uploaded to Play's library before this session — not a
  fresh upload from this `.aab` file, so don't assume the local file is what's
  live without checking Play Console's "Πακέτα εφαρμογών" library.
- **2026-10-09 (same day, later): Play Store listing update submitted for
  review** — the user asked for the Play Store app name to match Apple's
  ("AI Coach: Workout & Diet" instead of the old "AI Coach", confirmed
  24/30 chars in the Play Console editor). While in the Main Store Listing
  editor, also found and fixed a wrong **AI-generated-content declaration**:
  the app icon, feature graphic, and one phone screenshot were incorrectly
  flagged as AI-created/edited (via Play's per-asset tagging popup under
  "Δήλωση στοιχείου AI"); corrected to unflagged on all 7 assets (icon,
  feature graphic, 5 screenshots) since none of them actually are
  AI-generated. Both changes (name + declaration) were bundled as a single
  pending change and submitted together via "Επισκόπηση δημοσίευσης" →
  "Υποβολή 1 αλλαγής για έλεγχο" → confirmed. Page now shows "Αλλαγές που
  υποβάλλονται σε έλεγχο" (under review) — **not yet approved/live**, check
  Play Console's publishing-overview page for the outcome.

### iOS — ⏳ build 7 queued for review, not yet decided
Full review history, read directly from App Store Connect → the app
(`6814126007`) → App Review → Submissions:

| Date | From | What |
|---|---|---|
| 2026-09-20 22:53 | Apple | **Guideline 2.1** (Information Needed) — standard for a first-time developer account; asked for a screen recording, app description/audience, setup instructions, list of external services, regional differences, IAP purchase flow overview |
| 2026-09-21 03:06 | Sokratis | Replied with the requested info + attachment |
| 2026-09-23 16:56 | Apple | Follow-up (attachment; content not read in detail — re-check if picking this up) |
| 2026-09-28 21:45 | Apple | **Rejected — Guideline 1.4.1** (Safety/Physical Harm): build **1.0 (6)** gave health/nutrition recommendations with no citations/sources |
| 2026-10-08 11:24 | Sokratis | **Resubmitted as build 1.0 (7)** — presumably includes the fix for 1.4.1 already in this repo's history (commits `1c07591` Sources page, `ffa64ac` "not medical advice · Sources" footer under every AI reply) |

- **Current status (checked live 2026-10-09): "Waiting for Review"** — queued,
  not yet actively being reviewed, no decision yet, for all 4 submitted items
  (the app version itself, the subscription group, and both subscriptions).
- Build 7 was archived/uploaded via Xcode directly — **not reflected in a git
  commit**. The repo's committed `project.pbxproj` still says
  `CURRENT_PROJECT_VERSION = 6`; there's an uncommitted bump to 7 sitting
  locally (§6). If you need to reproduce or re-archive build 7, check the
  local uncommitted file state before trusting git alone.
- The user's Apple-related email (both the 2.1 and 1.4.1 messages above, and
  presumably any future ones) goes through **App Store Connect's own
  Resolution Center**, readable directly in the browser once signed in — this
  is more reliable than searching Gmail/iCloud Mail, since Apple's
  review-decision emails are easy to miss in an inbox. **Prefer checking
  App Store Connect directly** (Apple ID sign-in + 2FA needed from the user;
  no session has a stored Apple session) over waiting for an email forward.
- RevenueCat project "AI Coach" is configured (App Store app, both products,
  `pro` entitlement, `default` offering) per `IOS-PAYMENTS.md` — but see §4 for
  the open question on whether the Worker secrets/webhook side is finished.
- A real purchase/restore/cancel flow has **never been tested end-to-end** in
  any session (needs a Sandbox tester in App Store Connect).
- **Next step once Apple decides**: if approved, the app still needs a
  manual "Release this version" action in App Store Connect (unless automatic
  release was chosen) — don't assume approval = live, the way it (almost)
  was for Android. If rejected again, read the specific guideline citation
  in Resolution Center before changing anything.

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

Git remote: `origin` → GitHub, branch `main`, pushed up to commit `0da30b6`
(this file's first version) as of 2026-10-09. These are **untracked on
purpose** (not an oversight): `android-twa/` (contains the keystore + built
`.aab`/`.apk` — deliberately kept out of git), `well-known-staging/` (has its
own nested git repo — leave it alone), `store-assets/screenshots-ios/*.png`,
`store-assets/google-play-data-safety.md`, `store-assets/play-*.{md,png}`,
and the `AI Coach App Overview.pptx` this session exported. If you want any
of these preserved remotely rather than only on this machine, that's a
decision for the user (several past sessions deliberately left `android-twa/`
out when asked to "push everything").

**⚠️ As of 2026-10-09 there are also substantial *modified-but-uncommitted*
changes** sitting locally in a repo this session otherwise treats as clean —
confirmed via `git status` to include at least: `README.md`, `admin.html`,
`anthropic-proxy.js`, `firestore.rules`, `index.html`,
`ios-capacitor/ios/App/App.xcodeproj/project.pbxproj` (almost certainly the
build-7 version bump, §5), and three `store-assets/*.md` files. **This
session did not make these changes and did not read their diffs** — some
other session/agent (or the user, directly in an editor) is actively working
in this same checkout in parallel. Don't blindly commit or discard them:
`git diff` each file first, and if it's unclear whether a change is finished
work or a mid-edit draft, ask the user before touching it.

**⚠️ Do not touch:** there's a sibling directory one level up,
`/Users/sokratispouneridis/Desktop/Sokratis All/Gym App/programma-app/`
— this is an **unrelated project** (contains a "Dental solution" folder, its
own `firebase-config.js`, its own git repo). It is not part of this app
despite the similar name; it just happens to sit on disk nearby. Never read,
edit, or export anything from it as part of this project.

---

## 7. Known loose ends / things to flag to the user early

1. **iOS build 7 is "Waiting for Review"** (§5) — nothing to do but check
   back (App Store Connect, not email — see §5's note on why).
2. **Stripe/web-checkout code is still live** in `index.html` /
   `anthropic-proxy.js` despite the store-only decision, and Android is now
   publicly live with it still present. Nobody has removed it yet. Ask the
   user whether to keep it (e.g. for a future web relaunch) or strip it now.
3. **RevenueCat Worker secrets** — confirm set vs. not (§4). This matters more
   now: Android is live and could theoretically get a real purchase attempt
   at any time.
4. **No end-to-end purchase test** has been run on either platform, and
   Android is now live to the public without one.
5. **Cloudflare Worker drift** — confirm the dashboard matches `anthropic-proxy.js`
   at HEAD before relying on any recent Worker-side change being live.
6. **Uncommitted local changes** (§6) — figure out what they are and whether
   they should be committed, before they're lost or conflict with new work.

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
- Store-side actions (requesting Play production access, filling its
  honesty-required questionnaire, selecting countries, creating a release,
  submitting for review) were done live in the browser tool with the user's
  explicit go-ahead at each major step ("Ναι, προχώρα", "Ορατό σε όλους
  σήμερα"). The questionnaire answers were written truthfully from what was
  actually known — never fabricated metrics — and "don't know" was used for
  the installs-forecast question rather than guessing a number. Keep that
  standard: Play/Apple hold the developer accountable for what's submitted.
