# Android Digital Asset Links

`assetlinks.json` is not in this repo. It is served from the site the TWA
verifies, in the other repository `S0k0s/s0k0s.github.io`, at:

`https://s0k0s.github.io/.well-known/assetlinks.json`

The statement must include package `io.github.s0k0s.aicoach` and every
certificate Play will use.

## What to add

Play App Signing uses two certificates:

1. **Upload key** — the keystore in `android-twa/android.keystore` (alias `aicoach`). This signs the AAB you upload. If the file only has this SHA-256, that is not enough once Play re-signs the app.
2. **App signing key** — the certificate Play uses on the APK users install. Play Console → Setup → App signing → App signing key certificate → SHA-256.

Put both fingerprints in the same `sha256_cert_fingerprints` array. Example shape (replace the fingerprints with the ones from Play Console; do not invent them):

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "io.github.s0k0s.aicoach",
    "sha256_cert_fingerprints": [
      "UPLOAD_KEY_SHA256",
      "PLAY_APP_SIGNING_SHA256"
    ]
  }
}]
```

After you edit the github.io repo, check:

`https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://s0k0s.github.io&relation=delegate_permission/common.handle_all_urls`

The TWA will fail to verify, and Play Billing inside the app will not be reliable, if the App signing key fingerprint is missing.

Back up `android.keystore` offline. It is gitignored. There is no copy in this repo. If you lose it you cannot upload updates.
