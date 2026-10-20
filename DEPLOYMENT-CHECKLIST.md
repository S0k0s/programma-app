# Rollout for the 2026-10-20 major update

Nothing in this branch has been deployed. Do not merge until you are ready for
the Android app to pick up the new web immediately (the live TWA loads GitHub
Pages from `main`).

## Safe order

1. Deploy the Worker from the repo: `npx wrangler login`, then `npx wrangler deploy`. Confirm the existing secrets are still set (`ANTHROPIC_API_KEY`, `FIREBASE_SERVICE_ACCOUNT_KEY`, `STRIPE_*`, `RESEND_API_KEY`, `CONTACT_DESTINATION_EMAIL`, `REVENUECAT_SECRET_KEY`, `REVENUECAT_WEBHOOK_AUTH`). Do not paste the file into the dashboard editor.
2. Do **not** publish `firestore.rules` yet. The strict file blocks client deletion of server-only docs. Older iOS builds still delete those docs themselves. If rules must be published before the new iOS build is what users have, publish `firestore.rules.transition` instead. It still blocks clients from creating or editing quota and subscription docs, and it still lets the owner delete their own data.
3. Merge this PR only when you want Android to update. GitHub Pages from `main` is what the live TWA loads. There is no separate Android web release.
4. iOS: `./ios-capacitor/sync-web.sh`, then archive marketing version 1.1, build 8 (already set in the Xcode project). Upload. Sign in with Apple will fail the archive until the capability is enabled on the App ID if you added the entitlement; this branch does not add the entitlement to the plist, it only shows the button. Enable the capability before you rely on the button.
5. Android: `cd android-twa && bubblewrap build`. Upload the AAB as versionCode **3** / versionName 1.1.0. The manifest declares `com.android.vending.BILLING`. Create `pro_annual` in Play if it is missing. Add license testers.
6. RevenueCat: add the Android app to the same project, Play service account, both `pro_monthly` and `pro_annual` on entitlement `pro`, offering `default`. Webhook URL `https://programma-ai.sokratispoun.workers.dev/revenuecat-webhook`. Authorization header value must match `REVENUECAT_WEBHOOK_AUTH` (raw secret or `Bearer <secret>`).
7. Optional analytics: set `measurementId` in `firebase-config.js` (Firebase console → project settings). Optional crashes: set `SENTRY_DSN` in `index.html`. Both stay off until those values exist. Then update the Play Data safety form and the App Store privacy label to match the drafts.
8. Digital Asset Links: add the Play App Signing SHA-256 next to the upload-key fingerprint in `S0k0s/s0k0s.github.io` `assetlinks.json`. See `docs/ANDROID-ASSETLINKS.md`.
9. Back up `android-twa/android.keystore` (alias `aicoach`) offline. It is not in git. There is no backup today.
10. Run `docs/PAYMENTS-TEST-PLAN.md` on sandbox / license testers for purchase, restore, and cancel on both platforms.
11. Only after the new iOS build is the one users have, and Android has been on this web client, publish the strict `firestore.rules`.

## What this update changes for billing

Card checkout buttons are hidden everywhere (`WEB_STRIPE_CHECKOUT_ENABLED` is false), including the public site. Worker Stripe routes are still there so an existing web subscriber's webhook can update Firestore. There is no in-app link to Stripe inside iOS or Android. People who already pay with Stripe on the web lose the in-app "manage" button until that flag is turned back on for the web only.

## Local checks already run

`node --test tests/regression.test.cjs` (30 checks) and `git diff --check`.

---

# Maintenance changes — 2026-10-06

Prepared locally; no production deployment or App Store upload has been performed.

## Changes

- Protect daily/monthly/photo counters and subscriptions from client writes and
  deletion. Denied access records cannot be deleted/recreated by their owner.
- Worker checks approved access for AI, billing and contact requests. Webhooks
  retain their existing independent authentication.
- Self-service deletion uses `delete-account`: verify the Firebase token and
  recent authentication, remove user data in paginated batches, delete the Auth
  account, then remove the access record. Admin deletion also cleans up server-side.
- Client reauthenticates before deleting data and stops its access listener
  during deletion. Cancellation before cleanup leaves data intact.
- Async reads/renders/writes stop when the signed-in account changes. Photo and
  purchase completions cannot be attributed to the next signed-in account.
- Monthly quota messages, Greek fallback strings, weekly dashboard target and
  store data descriptions now reflect the code. Exercise text is escaped on
  the dashboard as well as in the exercise list.

No product IDs, prices, quota amounts, AI model or training/nutrition formulas
were changed. Existing Stripe routes remain available pending the store-only
cleanup decision.

## Required rollout order

1. Deploy the complete updated `anthropic-proxy.js` in Cloudflare first.
   Existing secrets are reused; no new credentials are required. Confirm the
   existing service account can list/delete Firestore docs and delete Auth users.
2. Publish the updated web files/admin page, and ship the updated bundled iOS
   app (run `./ios-capacitor/sync-web.sh`, bump the Xcode build number, archive).
3. Publish `firestore.rules` only after the new account-deletion flow is available.

**Compatibility:** already-installed older iOS builds delete data directly from
Firestore. Strict deletion rules will reject that older deletion flow. Do not
roll out those rules blindly while old builds are still in use; coordinate the
store release/update and support affected users through admin deletion until
users upgrade. Deploying the Worker alone is backwards compatible. Deploying
new client files before the Worker makes the new deletion endpoint unavailable.

## Validation

Run `node --test tests/regression.test.cjs` and `git diff --check`.
Tests mock remote services: onboarding/Pro quotas, revoked access, paginated
cleanup, deletion identity/failure cases, account-switch races, dashboard target
and escaping, iOS offerings, and delayed purchase completion.

Browser smoke checks: Welcome, Register, Back, Sign in, EN/EL selection,
standalone legal page. No test account was created and no real data was deleted.

Remaining live checks: deployed Firebase rules (no Java runtime/Firebase emulator
on this machine), actual Firebase account deletion with a disposable account,
physical-device camera, Sandbox purchase/restore, and App Store review status.
Account cleanup consists of multiple remote operations; failures can leave
partial cleanup and must be surfaced/retried. Subscription cancellation remains
managed by the store separately from account deletion.

## Apple review 1.4.1 — build 7

The September 28 rejection repeats the September 23 missing-citation issue.
The general Sources page in build 6 was insufficient. The new Worker adds a
reviewed citation policy to coach/onboarding prompts; photo JSON is unchanged.
The client turns catalog citation IDs into safe inline publication links and
lists only cited references. It flags older/uncited replies, links calculated
Nutrition targets, corrects overclaims about defaults, and explains limitations
in EN/EL. No clinical validation or guaranteed Apple approval is claimed.

Build number is now 7; web assets must be synced before archive. A physical
iPhone/iPad test of real cited AI output and source opening is still required.
The model can cite incorrectly or omit references: tests verify routing and
rendering, not factual correctness of every generated reply. Deploy Worker
first and verify real output before uploading the build. Updated review notes
are in store-assets/app-review-notes.md. No Apple message, upload, resubmission
or production deployment was performed by these local changes.

Local verification completed: 20 Node regression checks pass; English/Greek
Sources page smoke checks show no browser JavaScript errors; Xcode simulator
Debug build 7 succeeds. The built app's bundled index.html hash matches the
root source. This is not a signed distribution archive or a physical-device test.
Draft Apple reply: store-assets/app-review-response-build7.md (not sent).

### Live rollout status — October 8, 2026

The updated `programma-ai` Worker was deployed through Cloudflare on October 6.
The signed Release archive 1.0 (7) succeeded, and the Debug build launched on
the physical iPhone 14. This verifies launch, not real cited AI replies or IAP.
On October 8, Xcode Organizer confirmed "App 1.0 (7) uploaded" and App Store
Connect displayed build 7 as Processing. The earlier upload attempt had not
completed. App Review notes were updated to describe citations and EN/EL and
refer to the existing Sign-In Information credentials, removing contradictory
credentials and an unverified recording claim. No new recording is attached.
Build 7 completed processing and is Ready to Submit in TestFlight. It is now
selected and saved for version 1.0; review notes are saved. Promotional text
now calls the product an AI fitness assistant rather than a dietitian.
No resubmission has been made yet; real cited-reply/source-link and Sandbox
checks remain open. Device Hub currently cannot pair with the iPhone, reporting
`kAMDUserDeniedPairingError`; the user must accept Trust on the device.

### Resubmission completed — October 8, 2026, 11:24 Athens

Pairing was restored. A real coach request on the iPhone initially returned no
citations. The Worker prompt was strengthened to require relevant visible
citations for nutrition/exercise recommendations and ignore uncited historical
style; all 20 regression tests passed. Cloudflare version `806b79fe` is Active.
A subsequent real post-workout food reply displayed inline [4] and the ISSN
reference footer. Tapping [4] opened the ISSN protein/exercise publication in
PubMed Central on the physical iPhone. This sample verifies routing and source
opening; it does not establish factual correctness of every generated claim.
No new screen recording or iPad/Sandbox test was completed.

Resubmit to App Review succeeded. App Store Connect confirms Waiting for Review
for version 1.0 (7), AI Coach Pro group, Monthly and Annual. Submission ID:
`31e8e502-6a5b-48c4-897d-45c7cd8257de`. Updated review notes are included.
