#!/bin/sh
# Bundles the web app into the native project so the store build ships the
# files itself (App Store Guideline 4.2 rejects apps that only load a
# website) — instead of loading the live site via server.url. Run this
# before every iOS/Android store build; then build/archive in Xcode.
set -e
cd "$(dirname "$0")"
rm -rf www && mkdir www
cp ../index.html ../firebase-config.js ../favicon.svg ../manifest.json www/
cp -R ../icons www/icons
npx cap sync ios
