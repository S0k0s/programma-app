# Apple App Store Connect — Privacy Nutrition Label (draft answers)

Fill this in under App Store Connect → App Privacy. Same underlying facts as
the Play Data Safety form (see google-play-data-safety.md) — Apple just
categorizes them differently.

## Data Used to Track You
**None.** This app does not track users across other companies' apps/websites
for advertising. No ad SDKs, no analytics-for-ads.

## Data Linked to You
(Collected data tied to the user's identity — their Firebase account)

- **Contact Info** → Name — used for App Functionality (account and greeting).
- **Contact Info** → Email Address — used for App Functionality, Account
  creation/sign-in.
- **Health & Fitness** → Health (weight, height, age, sex, activity level,
  injuries/dietary notes, workout & nutrition history) — used for App
  Functionality only.
- **User Content** → Other User Content (AI Coach chat messages, food/workout
  logs) — used for App Functionality only.
- **Purchases** → Purchase History — subscription status (active/expired) and
  the App Store purchase record, mirrored via RevenueCat — App Functionality.
- **Identifiers** → User ID — the account id also used as RevenueCat's app
  user id — App Functionality.
- **User Content** → **Photos or Videos** — a meal photo the user chooses to
  scan is sent to the AI provider (Anthropic) to estimate nutrition. It is
  not stored in the app or in Firestore. Decide with Apple's definitions
  whether transmission for real-time processing counts as "collected"; being
  conservative, declare it (App Functionality, linked to the user).
- **Financial Info** → NOT collected (the App Store handles the payment; the
  app never sees card details).

## Data Not Linked to You
**Product Interaction** and **Crash Data**, only if you turn the optional tools on:

- Firebase Analytics, after `measurementId` is added to `firebase-config.js`. Events: sign_up, onboarding_complete, first_workout_logged, paywall_view, purchase_start, purchase_success, restore, app_exception. The app does not set Analytics userId, so declare this as not linked to identity if that matches Apple's definition for your setup. Purpose: Analytics. It is off until the measurement id exists.
- Sentry, after `SENTRY_DSN` is set in `index.html`. Purpose: App Functionality (diagnostics). It is off while the DSN is empty. Do not enable sendDefaultPii.

Until those ids are set, do not declare an analytics or crash SDK. The code does not load either script without them.

## Purposes (for each data type above)
- App Functionality ✓ (all of the above)
- Analytics ✓ only after Firebase Analytics is configured. Leave it unchecked until then.
- Product Personalization ✓ (health/fitness data — used to personalize the
  training/nutrition plan; this is arguably also "App Functionality" since
  it's the core purpose, but Apple's reviewers sometimes want this flagged
  separately for anything AI-personalized — worth checking Apple's current
  guidance when actually filling this in, since their category definitions
  have shifted before)
- Third-Party Advertising ✗
- Developer's Advertising or Marketing ✗

## Third parties data is shared with (for the purposes above)
- Anthropic (AI Coach reply generation) — App Functionality only.
- Google Firebase — infrastructure/hosting.
- Apple — In-App Purchase is the only way to buy Pro inside the iOS app.
- RevenueCat — receives the App Store purchase status and the account id, to
  validate subscriptions — App Functionality.
- (Stripe is not used in the store apps; if a web version launches later it
  may be added there.)
- Resend — only for users who submit the contact form.

## Notes
- No location, contacts, browsing history, or search history collected. The
  camera is used only when the user taps the meal-scan button (permission
  prompt shows the NSCameraUsageDescription text); photos are not saved.
- No data used for tracking (no IDFA, no cross-app/cross-site tracking) — App
  Tracking Transparency (ATT) prompt is NOT needed.

## Age rating (App Store Connect's Age Rating questionnaire)
Apple's brackets are 4+ / 9+ / 12+ / 17+ — there's no direct "18+" option
like Google Play's. **Suggested: 17+**, the closest match to the in-app
18+ requirement (same reasoning as the Play Store submission: the app
sells a recurring subscription, and minors generally lack full contractual
capacity for that in the EU — see google-play-data-safety.md). The actual
age gate stays enforced in-app at sign-up (self-attestation checkbox,
client-side) regardless of what the store rating says; the store rating is
a content descriptor, not the enforcement mechanism.
- Medical/Treatment Information: **Yes** (fitness/nutrition guidance
  counts under Apple's broad definition) — pick "Infrequent/Mild" unless
  the questionnaire offers a more specific fitness-app option.
- Unrestricted Web Access: **No** (no in-app browser to arbitrary sites).
- All other categories (violence, sexual content, gambling, alcohol/drugs,
  horror, mature/suggestive themes): **None**.
