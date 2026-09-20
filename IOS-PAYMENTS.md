# iOS payments (Apple In-App Purchase via RevenueCat)

The iOS app sells the Pro plan with Apple's In-App Purchase (App Store
Guideline 3.1.1). The web keeps using Stripe. Both write the same
`users/{uid}/data/subscription` Firestore doc, so `isPro` works the same
everywhere.

## What is already done in code

- `ios-capacitor`: `@revenuecat/purchases-capacitor` installed and synced.
- `index.html`: Profile → Pro section shows, **only inside the iOS app and only
  once the RevenueCat key below is set**, an "Upgrade to Pro — <price>" button
  (price comes from the App Store), "Restore purchases", the required
  auto-renewal disclosure and a Terms/Privacy link. Apple subscribers get a
  "Manage subscription in the App Store" button instead of the Stripe portal.
- `anthropic-proxy.js` (Cloudflare Worker):
  - action `ios-sync-purchase` — the app calls it after a purchase/restore; the
    Worker re-reads the subscriber from RevenueCat and updates Firestore.
  - `POST /revenuecat-webhook` — RevenueCat calls it on renewals/cancellations.
  - It never overwrites an admin-granted plan or a live Stripe subscription.

Until the steps below are finished, the iOS app behaves as before (no purchase
button, existing Pro users still work).


## Current setup (done in App Store Connect / code)
- App: "AI Coach: Workout & Diet", bundle id `io.github.s0k0s.aicoach`, SKU `aicoach-ios-001`.
- Subscription group **AI Coach Pro** with two auto-renewable subscriptions:
  - `pro_monthly` — 1 month — €4.99 (base: Greece; other storefronts auto-priced)
  - `pro_annual` — 1 year (upfront) — €39.99
- The app shows both plans (RevenueCat packages `$rc_monthly` / `$rc_annual`), the annual one with its
  saving vs 12 × monthly. Limits: 200 messages + 40 photo scans per month (Worker constants).
- RevenueCat project "AI Coach" is configured: App Store app (bundle id above, In-App Purchase key uploaded),
  products `pro_monthly` + `pro_annual`, entitlement **`pro`** with both attached, offering **`default`** with
  packages `$rc_monthly` / `$rc_annual`. The iOS public SDK key is already in `index.html`.
- Still to do: secret API key + webhook (below), Cloudflare secrets + Worker deploy, Xcode build.

### Finish RevenueCat (needs your Apple credentials — do this yourself)
1. App Store Connect → Users and Access → Integrations → **In-App Purchase** → generate a key; download
   `SubscriptionKey_XXXX.p8` (downloadable once!), note the **Key ID** and **Issuer ID**.
2. RevenueCat → Apps → New app → App Store: bundle id `io.github.s0k0s.aicoach`, upload the .p8, enter Key ID
   and Issuer ID, (optionally) Apple Small Business Program = yes once approved, Save.
3. Product catalog → Products: add `pro_monthly` and `pro_annual` (App Store). Entitlements: create identifier
   **`pro`** and attach both. Offerings: **default** (current) with two packages — Monthly → `pro_monthly`,
   Annual → `pro_annual`.
4. Copy the iOS public SDK key (`appl_…`) → `REVENUECAT_IOS_PUBLIC_KEY` in `index.html`; copy the secret key
   (`sk_…`) → Cloudflare secret `REVENUECAT_SECRET_KEY`; set `REVENUECAT_WEBHOOK_AUTH`; add the webhook.

## Do these last (they need the paid Apple account)

1. **Apple Developer Program** — enrol ($99/year) at developer.apple.com.
2. **App Store Connect**
   - Create the app (bundle id `io.github.s0k0s.aicoach`, or change it in Xcode first).
   - Agreements, Tax, and Banking → accept the *Paid Apps Agreement*, add bank + tax info.
   - App → Subscriptions → create a group and an **auto-renewable monthly** subscription
     (product id e.g. `pro_monthly`, price €4.99, localised name/description).
     Consider joining the *App Store Small Business Program* (15% instead of 30%).
3. **RevenueCat** (revenuecat.com, free tier)
   - New project → add the iOS app (bundle id above), upload the App Store Connect
     *In-App Purchase key* / shared secret as RevenueCat instructs.
   - Products → add `pro_monthly`. Entitlements → create one named **`pro`** and attach it.
   - Offerings → make a **Current** offering with a Monthly package pointing at `pro_monthly`.
   - Copy the **iOS public SDK key** (`appl_...`) and the **secret API key** (`sk_...`).
   - Integrations → Webhooks → URL `https://programma-ai.sokratispoun.workers.dev/revenuecat-webhook`,
     Authorization header value = a long random string you choose.
4. **Cloudflare Worker** — add two secrets (Settings → Variables and Secrets) and
   redeploy the current `anthropic-proxy.js`:
   - `REVENUECAT_SECRET_KEY` = the `sk_...` key
   - `REVENUECAT_WEBHOOK_AUTH` = the same random string as the webhook header
5. **App** — in `index.html` set `REVENUECAT_IOS_PUBLIC_KEY` to the `appl_...` key, push.
6. **Xcode** — open `ios-capacitor/ios/App/App.xcodeproj`, choose your Team under
   Signing & Capabilities, add the **In-App Purchase** capability, bump the version,
   Product → Archive → Distribute App → App Store Connect (TestFlight first).
7. **Test** with a Sandbox tester (App Store Connect → Users and Access → Sandbox):
   buy, restore, cancel; check `subscription` in Firestore shows `source: "apple"`.
8. **App Review notes** — mention the subscription is sold via IAP and that the
   Stripe checkout is hidden inside the iOS app.
