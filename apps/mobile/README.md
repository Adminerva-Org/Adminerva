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
