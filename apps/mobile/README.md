# Adminerva mobile public-preview staging (not released)

The canonical **Adminerva School OS** remains the hosted website and Firebase services. This directory packages a public-only local copy of existing web assets for future Capacitor Android/iOS shells. It is **not** an authenticated mobile client or production store package. All product direction and status belong in `docs/adminerva-school-os-master-plan.md`.

## Development setup

With Node.js 22 or newer:

```sh
npm install --prefix apps/mobile
npm run prepare --prefix apps/mobile
```

The generated `apps/mobile/www/` is deliberately untracked. It contains approved public preview pages and their shared CSS/JS/images; the native project sources (`android/`, `ios/`) are not created on this branch. Native developers can later run the Capacitor platform-generation commands on approved machines after verifying the final package ID, mobile auth and privacy requirements.

Capacitor is configured with no remote `server.url`: production distribution must not silently load arbitrary remote JavaScript into a privileged native context. Website changes are picked up by regenerating the web bundle for a **reviewed native release**, not automatically installed in already-shipped iOS/Android binaries.

## Limitations

- The preview entry links only to publicly available Adminerva tools. Google/GitHub/Firebase native auth, teacher-controlled exams, cloud-save handoff and native Companion features have not been validated for mobile; no private or graded work should be attempted.
- The existing web pages depend on hosted CDN resources and may require network access; this is not offline exam functionality.
- Before release: implement system-browser/native OAuth, verified deep links and school-scoped session continuity, reliable Studio cloud synchronization, mobile keyboard/safe areas, protected storage, native permission gates and 320px acceptance on physical devices.
- Package ID `io.adminerva.preview` is temporary and must be replaced with the verified publisher's production identifier before creating or signing store builds.
- Do not publish Apple App Store, Google Play or APK links until authorized builds, store review and tested distribution exist.

## Preview update status and production mobile updates

The Android public-only start page now offers **Check for updates**. It reads first-party version metadata and links testers to the official download center, but **cannot self-install an APK**. A CI debug APK can have a different signing certificate from the previous build; installing it over an older one may fail. Do not uninstall a student's device app with unsynced projects as a workaround.

For official Android updates, use stable application identity, Play App Signing, approved Play in-app updates, and keep local project recovery data intact. For iPhone/iPad use Apple-signed TestFlight/App Store updates. The in-app update action should show availability and hand off to the platform store, not download or execute arbitrary app packages. Defer any install prompt/restart while an assessment or cloud-save checkpoint is unfinished.

## Android debug APK for preview testing

The same GitHub Actions workflow creates an Android debug APK from canonical public-only website assets. Open its successful run, download the Android artifact ZIP and extract app-debug.apk (with its SHA256SUMS.txt). The APK is signed with a disposable development debug key, not the school's production publishing key. This is **not** a Play Store release and must not be used for logged-in student work or practical exams.

An iPhone/iPad installation file is not available: shipping a device-installable iOS app requires approved Apple signing and distribution via an authorized testing channel (e.g. TestFlight). The public web app remains available in Safari.

## iOS Simulator and public-device diagnostics

The public-only iOS Simulator CI job runs on GitHub macOS, regenerates a temporary Capacitor 8 Swift Package Manager project, and compiles an **unsigned Simulator-only** `App.app` ZIP. On a Mac with Xcode, extract the nested ZIP and install it in a simulator with `xcrun simctl install booted App.app` (after booting a compatible simulator). This artifact is **not an IPA** and cannot be installed on a physical iPhone/iPad. Apple Developer Program signing, a verified app identity, TestFlight and physical-device acceptance remain separate release gates. The build does not include private accounts or examination monitoring.

Android and iOS public previews also include **Check connection**, which tests only the first-party public version listing with a short timeout. This is not a Firebase login or Studio cloud-save check; it sends no account identifier, project code or monitoring data.
