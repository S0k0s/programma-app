# Android payments (Google Play Billing via RevenueCat)

The Android app is a Trusted Web Activity, so the Pro plan is bought with Play
Billing through the browser's Digital Goods API. The web keeps using Stripe and
the iOS app uses Apple IAP; all three write the same
`users/{uid}/data/subscription` doc (`source: "google"` for Play).

## Already done in code

- `android-twa/twa-manifest.json`: `playBilling` enabled (needs
  `enableNotifications: true`), version 1.0.1 / code 2. Project regenerated.
- `index.html`: in the Android app, once Play returns the product `pro_monthly`,
  Profile → Pro shows "Upgrade to Pro — <price>", "Restore purchases", the
  renewal disclosure and a "Manage subscription in Google Play" button.
  If the product isn't set up yet, nothing changes.
- `anthropic-proxy.js`: action `android-sync-purchase` posts the purchase token to
  RevenueCat (validated + acknowledged there), then mirrors the entitlement. The
  existing `/revenuecat-webhook` also handles Play renewals/cancellations.

## Steps for you

1. **Build the new AAB** (asks for your keystore password):
   `cd android-twa && bubblewrap build` → upload `app-release-bundle.aab` to the
   closed testing track. (Play needs a build with the billing permission before
   you can create subscriptions.)
2. **Play Console** → Monetize with Play: complete the payments profile, then
   Subscriptions → create `pro_monthly` (base plan monthly, €2.99). Activate it.
   Add yourself under Setup → License testing.
3. **RevenueCat** (same project as iOS): add an Android app (package
   `io.github.s0k0s.aicoach`), upload a Google Play service-account JSON (Play
   Console → Setup → API access, grant it financial + app-info permissions).
   Add product `pro_monthly` and attach it to the existing `pro` entitlement.
4. **Cloudflare Worker**: redeploy the current `anthropic-proxy.js`
   (`REVENUECAT_SECRET_KEY` / `REVENUECAT_WEBHOOK_AUTH` already exist from iOS).
5. **Test** on a phone installed from the closed-test link with a license tester
   account: buy, restore, cancel; check `source: "google"` in Firestore.
