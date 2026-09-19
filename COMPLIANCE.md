# Compliance checklist (GDPR, stores, payments)

Not legal or tax advice — have a lawyer/accountant confirm the open items.

## Done in the app
- Terms & Privacy (EN/EL): data controller line, legal bases (Art. 6(1)(b), Art. 9(2)(a)),
  health-data consent section, processors (Firebase, Anthropic, Apple/Google billing,
  RevenueCat, Resend), camera/photo use, retention, data-subject rights, DPA complaint
  (Hellenic DPA, dpa.gr).
- Explicit health-data consent: separate checkbox required at registration (email and Google);
  accounts created earlier get a one-time consent prompt before the app opens; the consent
  (`users/{uid}/data/consent` = {health, at, version}) is stored per user.
- Data access/portability: Profile → "Download my data" (JSON of everything under `users/{uid}/data`).
- Erasure: Profile → Delete account (already existed).
- 18+ gate, medical disclaimer, AI-content notice (already existed).
- Store paperwork drafts in `store-assets/` (privacy label, listing, review notes).

## Still needs YOU
1. **Controller identity:** the policy names "the operator of AI Coach" + email only. As a sole
   trader/individual, add your full name and a contact address (postal or business) in
   `LEGAL_BODY_EN/EL` ("Data controller"). Apple also shows the seller name publicly.
2. **Business registration & tax (Greece):** register the activity (e.g. sole proprietorship),
   get the accountant to handle VAT/income tax on Apple/Google payouts and invoicing.
3. **Processor agreements:** accept the DPAs of Google (Firebase), Anthropic, RevenueCat,
   Resend, Cloudflare in each dashboard (usually a checkbox/click-through).
4. **Record of processing & risk check:** keep a short internal record of processing
   (what/why/where/who) and decide with a lawyer whether a DPIA is advisable (health data + AI).
5. **Anthropic data use:** confirm in Anthropic's terms/console that API inputs aren't used for
   training and set the retention option you want; align the policy wording.
6. **Stores:** App Store Connect privacy label + Play Data safety must match the policy;
   Apple export-compliance answer (standard HTTPS only); age rating 17+ (see notes).
7. **Support URL & Privacy URL:** `https://s0k0s.github.io/programma-app/?legal=1` — keep the
   site hosted while the apps are live.
