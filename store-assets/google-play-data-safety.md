# Google Play Console — Data safety form (draft answers)

Fill this in under Play Console → App content → Data safety. Based on what
the app actually collects/sends (see anthropic-proxy.js and firestore.rules).

## Does your app collect or share any of the required user data types?
Yes

## Data types collected

### Personal info
- **Email address** — collected. Purpose: Account management, App functionality.
  Required (can't sign in without it). Not shared with third parties.
- **Name** — collected at registration. Purpose: Account management, App functionality (personalized greeting).

### Health and fitness
- **Health info** (weight, height, age, sex, activity level, injuries/dietary
  restrictions, workout history) — collected. Purpose: App functionality
  (this is the app's entire purpose — building a training/nutrition plan).
  Required for the feature to work. Not shared with third parties for
  advertising. **Shared with Anthropic** (see below) only as part of
  generating an AI Coach reply.

### App activity
- **App interactions** (AI Coach chat messages, food/workout logs) —
  collected. Purpose: App functionality. Required.

## Is any of this data shared with third parties?
Yes — limited, purpose-specific sharing:
- **Anthropic (the Claude AI model)**: your question plus a short summary of
  your profile/history is sent to Anthropic through our backend, solely to
  generate the AI Coach's reply. Not used to train third-party models
  (per Anthropic's own API terms). This is a **service provider** relationship
  (data processor), not a sale or ad-sharing arrangement.
- **Google Firebase/Firestore**: hosting/infrastructure only (data processor).
- **Google Play and RevenueCat**: purchase status and account identifier, for validating and managing the Android Pro subscription.
- **Resend**: email address + message text, only when a user submits the
  "Report a problem" contact form.

No data is sold. No data is shared for advertising or marketing purposes.

## Is data encrypted in transit?
Yes (HTTPS/TLS everywhere — GitHub Pages, Cloudflare Worker, Firebase, Stripe).

## Can users request data deletion?
Yes — self-service, in-app (Profile tab → Delete account), permanent and
immediate. Also via email (sokratispoun@gmail.com), see Privacy Policy.

## Privacy policy URL
https://s0k0s.github.io/programma-app/?legal=1

## Target audience / Content rating
Suggested: **18+** (matches the in-app age requirement in the Terms — this
is a self-attestation checkbox at sign-up, client-side only, not backend
age-verified). Raised from an earlier 16+ draft because the app sells a
recurring store subscription, and minors generally lack full contractual
capacity for that in the EU — 18+ avoids the question entirely. Do NOT mark
this app as "designed for children" — it collects health data and offers
paid subscriptions.

## Data safety — additional notes for whoever fills this in
- No location data collected.
- No contacts access. Meal photo scanning uses the camera or a photo selected by the user; the image is sent to Anthropic for analysis and is not stored in Firestore.
- No advertising ID / analytics SDK in the app (no third-party trackers).
- No financial info stored by the app itself (Google Play handles payment data directly; we store subscription status, not card numbers).
