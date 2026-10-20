# Android payments (Google Play Billing via RevenueCat)

The Android app is a Trusted Web Activity. Pro is bought with Play Billing
through the Digital Goods API. iOS uses Apple IAP. New card checkout is hidden
in the apps and on the public site. All store purchases still write
`users/{uid}/data/subscription` (`source: "google"` for Play).

The live Play build is still version code 1 and was uploaded before this
billing setup. This repo is ready for versionCode **3** / 1.1.0. It has not
been built or uploaded.

## Already done in the repo

- `twa-manifest.json` and `app/build.gradle`: versionName 1.1.0, versionCode 3, `playBilling` enabled.
- `AndroidManifest.xml`: `com.android.vending.BILLING` plus the existing PaymentActivity.
- Client product ids: `pro_monthly` and `pro_annual`. Profile shows one button per product Play returns, plus Restore. A store free-trial period is shown when Play sends `freeTrialPeriod`. The app does not invent a trial.
- The Worker posts each allowlisted token with its own `product_id`. Legacy `purchaseTokens` are still treated as `pro_monthly`. Unknown product ids are dropped.
- The native shell is remembered in `localStorage` (`aicoach-native-shell`) so a later navigation does not reveal card checkout.
- Manual script: `docs/PAYMENTS-TEST-PLAN.md`. Asset links: `docs/ANDROID-ASSETLINKS.md`.

## Steps only you can do

1. Back up `android-twa/android.keystore` (alias `aicoach`) somewhere offline. It is not in git.
2. `cd android-twa && bubblewrap build`. Upload `app-release-bundle.aab` to a test track as versionCode 3. Play will reject it if code 2 or 3 was already used; bump again if so.
3. Play Console → Monetize: payments profile, then subscriptions `pro_monthly` (€4.99 / month) and `pro_annual` (€39.99 / year). Activate both. Optional introductory trial (for example 7 days) is configured here, not in the app. Add license testers.
4. RevenueCat, same project as iOS: Android app `io.github.s0k0s.aicoach`, Play service account with financial access, both products on entitlement `pro`, offering `default`. No Android public SDK key is required for the Digital Goods path.
5. Deploy the Worker with wrangler. Webhook: `https://programma-ai.sokratispoun.workers.dev/revenuecat-webhook`.
6. Run the Android section of `docs/PAYMENTS-TEST-PLAN.md` on the versionCode 3 build. The version-code-1 production build cannot complete this test.
