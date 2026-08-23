# Hallnect Android

A security-hardened WebView shell around **https://www.hallnect.com**. The web
app is the product; this module contributes what a browser tab cannot:

- Native **camera/gallery multi-photo selection** for hall listings
- **UPI app hand-off** (`upi://`, `intent://`, PhonePe/GPay/Paytm schemes) so
  Cashfree payments complete in the payer's UPI app and return to Hallnect
- **Google sign-in via Chrome Custom Tab** — Google blocks OAuth inside
  WebViews (`403 disallowed_useragent`); the Custom Tab is the supported
  path, and the PKCE callback re-enters the app through an App Link so the
  session lands in the app's own cookie jar
- Branded **splash** and **offline** screens, download handling, pull-to-
  refresh, correct back navigation, edge-to-edge system bars in brand colours

| | |
|---|---|
| Application ID | `com.hallnect.app` |
| compile/target SDK | 36 |
| minSdk | 26 (Android 8.0) |
| Toolchain | Kotlin 2.0.21 · AGP 8.9.2 · Gradle 8.11.1 · JDK 17 |
| Permissions | `INTERNET`, `ACCESS_NETWORK_STATE` — nothing else |

`CAMERA` is deliberately **not** declared: photo capture uses
`ACTION_IMAGE_CAPTURE`, which delegates to the device camera app and needs no
permission — but only as long as the manifest does not declare `CAMERA`.
Do not "helpfully" add it.

## Build

```bash
cd android
./gradlew assembleDebug          # debug APK  → app/build/outputs/apk/debug/
./gradlew testDebugUnitTest      # URL-policy unit tests
./gradlew bundleRelease          # Play AAB   → app/build/outputs/bundle/release/
```

Requires JDK 17 and the Android SDK (`ANDROID_HOME`, platform 36,
build-tools). First build downloads Gradle 8.11.1 via the wrapper.

## Release signing

`bundleRelease` expects `android/keystore.properties` (gitignored):

```properties
storeFile=upload-keystore.jks
storePassword=…
keyAlias=hallnect-upload
keyPassword=…
```

Generate the upload keystore once:

```bash
keytool -genkeypair -v -keystore android/upload-keystore.jks \
  -alias hallnect-upload -keyalg RSA -keysize 2048 -validity 10000
```

**Back the keystore up somewhere safe and never commit it.** With Play App
Signing (recommended, default) Google holds the true app-signing key and a
lost upload key can be reset; without it, a lost keystore means losing the
Play listing's update ability.

## App Links (Google-login round trip)

1. Get the **upload key** fingerprint:
   `keytool -list -v -keystore android/upload-keystore.jks -alias hallnect-upload | grep SHA256`
2. Set `ANDROID_ASSETLINKS_SHA256` in Vercel to that value (colon-separated
   hex, e.g. `AA:BB:…`). The site serves it at
   `https://hallnect.com/.well-known/assetlinks.json`.
3. After the first Play upload, Play Console → Setup → App signing shows the
   **app-signing key** SHA-256. Append it (comma-separated) to the same env
   var — release installs are signed with that key, not the upload key.
4. Redeploy the site; Android verifies on install/update.

Until verified, hallnect.com links open in the browser and email/password
login still works fully inside the app — nothing hard-breaks.

## Architecture notes

- `UrlPolicy.kt` — the security boundary. Every main-frame navigation gets a
  verdict: IN_WEBVIEW (hallnect.com, Cashfree checkout, Supabase verify
  links), CUSTOM_TAB (Google OAuth), EXTERNAL (tel/mailto/UPI/WhatsApp/other
  sites), BLOCK (file:, javascript:, …). Unit-tested on the JVM.
- `HallnectWebViewClient` — carries out verdicts; SSL errors **always**
  cancel (never `handler.proceed()`); renderer crashes rebuild the activity.
- `HallnectChromeClient` — progress + file chooser; denies geolocation and
  in-page camera/mic (the site uses neither).
- `MainActivity` — splash, edge-to-edge insets (incl. keyboard), offline
  screen, downloads with session cookie, file-chooser/camera plumbing,
  Custom Tabs, App-Link `onNewIntent`, state save/restore.
- No `addJavascriptInterface` anywhere. No cleartext. Mixed content blocked.
