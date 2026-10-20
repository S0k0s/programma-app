# Manual payments test plan

Do this on real store sandbox / license-tester accounts after the Worker is
deployed and the new builds are installed. The automated tests cover the
Worker allowlist, webhook auth, and the paywall HTML. They do not charge a store.

## Before you start

- Worker deployed from `wrangler.toml`. `REVENUECAT_SECRET_KEY` and `REVENUECAT_WEBHOOK_AUTH` set.
- RevenueCat webhook points at `https://programma-ai.sokratispoun.workers.dev/revenuecat-webhook`.
- iOS: Sandbox Apple ID. Products `pro_monthly` and `pro_annual` approved, both on entitlement `pro`.
- Android: license tester, installed from a Play track that contains versionCode 3 (not the live versionCode 1 build). Both products active.
- A fresh Firebase user for each platform, plus one user who already has Pro.

## iOS

1. Sign in. Kill the app. Open it again. The same account is still signed in.
2. Profile → Pro. Confirm monthly and annual prices from Apple. No card checkout, no "buy messages" button.
3. If App Store Connect has an introductory offer, the button shows the trial text RevenueCat returns. If it does not, no trial line is invented.
4. Buy monthly in Sandbox. The sheet is Apple's. After it finishes, Profile says Pro without reinstalling. Firestore `users/{uid}/data/subscription` is `status: active`, `source: apple`, `currentPeriodEnd` in the future.
5. Delete the app, reinstall, sign in, tap Restore purchases. Pro returns.
6. Buy annual on a second sandbox user. Same Firestore shape.
7. Cancel in Settings → Apple ID → Subscriptions. Wait for the sandbox expiry (minutes, not a month). Open the app. Pro ends. The doc becomes `canceled` and keeps `source: apple`. An admin-granted or live Stripe subscription on another user is not overwritten (check one if you have one).
8. Start a purchase and cancel the Apple sheet. The app stays on the free plan and does not show a raw error page.

## Android

1. Install the versionCode 3 build from Play. Open it once (the first launch has the `android-app://` referrer). Force-stop, open again. Profile must still not show a card checkout or a "buy messages" button. A note about buying Pro in the apps is fine when Play Billing is unavailable.
2. On a license tester, Profile shows monthly and annual buttons with Play prices, plus Restore.
3. Buy `pro_monthly`. Firestore `source` is `google`.
4. Restore on a reinstall. Pro returns.
5. Buy `pro_annual` on a second tester. The Worker must send `product_id: pro_annual` to RevenueCat (visible in RevenueCat customer history). An unknown product id is ignored.
6. Cancel in Google Play subscriptions. After expiry, Pro ends and `source` stays `google`.
7. Open a normal Chrome tab to the GitHub Pages URL (not the TWA). It also hides new card checkout. That is intentional.

## Webhook

1. In RevenueCat, send a test event with the Authorization header equal to `REVENUECAT_WEBHOOK_AUTH`, and once as `Bearer <that secret>`. Both should be accepted.
2. A request with no secret returns 401.
3. An event whose app user id starts with `$RCAnonymousID:` returns 200 and does not write Firestore.

## What "pass" means

The store is the only way to pay inside either app. Pro in the app matches the RevenueCat entitlement, not a client-side flag. Cancel removes Pro after the period ends. Restore works after reinstall.
