---
name: catalyst-android-app
description: Build, sign and install the catalyst Android app (a Bubblewrap Trusted Web Activity in catalyst/android-app), its icons, signing key, Digital Asset Links and iOS plan. Use when changing or rebuilding the Android app.
---

(Moved from catalyst/CLAUDE.md on 2026-09-29.)

### Android app: a Trusted Web Activity (2026-09-29, in progress: waiting for the logo)
- **What it is:** `android-app/` wraps the live portal as an Android app (package `com.catalystit.portal`) with Bubblewrap. It is a Trusted Web Activity: Chrome's engine, full screen, no address bar.
  - Web Push, the service worker and the login cookie work unchanged, delegated so notifications show under "Catalyst".
  - Every portal deploy reaches the app at once, so no new APK is needed. Rebuild only when `twa-manifest.json` changes (name, icons, colours, shortcuts), and bump `appVersionCode`/`appVersionName` when you do.
- **Why not Capacitor:** the site is SSR on Workers and can't be static-exported, and a WebView gets no Web Push.
- **Build:** `powershell -File android-app\build.ps1` gives `android-app/dist/catalyst-<version>.apk` (sideload) and `.aab` (Play).
  - It writes `~/.bubblewrap/config.json` (JDK 21 from `C:\Program Files\Microsoft\jdk-21…`, since Android Studio's JDK 25 is too new; SDK from `%LOCALAPPDATA%\Android\Sdk`).
  - It runs `bubblewrap update` + `build`, which downloads the icons from the **live** site, so deploy the icons first.
- **Signing key:** `android-app/catalyst-release.keystore` (alias `catalyst`), passwords in `android-app/.keystore.env`. Both are gitignored and backed up in `~/.catalyst-android/`. **Losing the key means the app can never be updated in place.**
  - SHA-256: `89:6A:1E:8C:FF:22:F3:37:CC:F3:D2:78:8C:1D:19:8E:76:3E:CF:65:17:76:21:D5:ED:7A:8B:AC:CE:30:00:45`.
- **Digital Asset Links:** `public/.well-known/assetlinks.json` carries that fingerprint. `/.well-known` is exempt from the login redirect (`PUBLIC_PATHS`) and from the middleware matcher. If the app goes on Play with Play App Signing, add Google's app-signing fingerprint as a second entry, or the address bar comes back.
- **Icons:** `node scripts/make-icons.mjs <logo>` writes `public/icons/{icon-192,icon-512,icon-maskable-512,badge-72,apple-touch-icon}.png` from one square logo. Waiting for the real logo: don't invent one.
- **Phone-only behaviour:** the "📱 Take phone screenshot" / "📍 Capture where it happens" buttons and the new-bug "📍 Attach where this happens" checkbox show only when the aktrade Control Center answers at `PHONE_HELPER_URL` (`lib/phone-helper-available.ts`, 1.5 s check per page). So they're hidden on phones and in the app.
- **iOS later:** on a Mac, wrap the same site (PWABuilder iOS package or Capacitor) with APNs for push. That needs an Apple Developer account.

### Download page and install button (2026-09-29, deployed `0f33cfb1-fa83-41ba-9a73-35cfa05b1a48`)
- **Public page `/download`** (`app/download/`, no sign-in: `/download` is in `PUBLIC_PATHS`). It has the "Download for Android" button, three install steps (allow installs from Chrome once), version, size and SHA-256.
  - The APK is served at `/downloads/catalyst-android.apk` as `application/vnd.android.package-archive`, from `public/downloads/`.
  - Its metadata comes from `lib/android-app.json`.
  - **`build.ps1` refreshes both** after every build. Deploy catalyst afterwards to put a new APK live.
- **Entry points** (`components/AndroidAppButton.tsx`):
  - "Get app" in the phone top bar (Android only).
  - "Install Android app" above Sign out in the side menu (any device).
  - "Get the Android app" on the login page.
  - On Android, `InstallButton`'s generic Chrome prompt is suppressed so there's one install path.
- **When it's hidden:** only inside the APK or once it's installed, never merely because the page is full screen (Chrome's own installed copy is full screen too).
  - The APK is recognised by its launch referrer `android-app://com.catalystit.portal`, remembered in sessionStorage.
  - An installed APK is found through `navigator.getInstalledRelatedApps()`: the manifest's `related_applications` has `{platform: "play", id: "com.catalystit.portal"}`.

