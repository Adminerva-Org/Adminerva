# Adminerva desktop public-preview shell (development only)

This directory is a **public-preview Electron experiment**, not an installable release and not the authenticated Adminerva application. The canonical product status and priorities are maintained in `docs/adminerva-school-os-master-plan.md`.

## Local developer run

From the repository root, with Node.js 22 or newer:

```sh
npm install --prefix apps/desktop
npm run check --prefix apps/desktop
npm start --prefix apps/desktop
```

The dependency is pinned to a current supported Electron release; an immutable lockfile, build signing, verified installers and update distribution are required before any release. Do not add an installer link to `downloads.html` from this preview alone.

## What is implemented

- Opens only the current published public Adminerva pages from the canonical HTTPS origin. Hosted public UI changes load on a normal safe navigation/relaunch; the shell does not force-refresh during student work.
- Routes school sign-in and non-public pages to the **system browser**; the browser session does NOT return to the desktop preview. This is intentional until the approved native OAuth session handoff is implemented.
- Sandboxed renderer, context isolation, no Node integration, no accessible OS/file/IPC APIs, and no native permissions. New windows, custom URL schemes and unapproved sites are blocked.
- Exposes a harmless read-only preview descriptor, not credentials or a native API bridge. The `app-compatibility.mjs` browser model treats such descriptors as UI hints, never school authorization.
- Does not monitor devices, run a companion, capture screens, or have a signed installer.

## Native update status — preview only

The application menu now has **Check for updates…**. It reads a small version listing from the canonical Adminerva HTTPS origin, displays the installed version and optionally opens the official downloads page. It **never downloads or installs an unsigned update**, never refreshes a running examination, and never grants privileged native access. The version listing must be updated when a new versioned artifact is actually verified; rebuilding with the same version is not an app update.

For the eventual **official signed desktop application**, implement publisher-verified update metadata and package signatures (Windows NSIS, macOS signed/notarized app plus ZIP update target), secure staged download, and a safe update/restart confirmation after all Studio cloud saves finish and no teacher-controlled examination is active. A signed update must not silently overwrite student work.

## Native-client release gate

Implement authenticated system-browser OAuth/PKCE handoff and validated return through a short-lived server-verified exchange. Never reuse browser cookies, forward Firebase ID tokens through URL parameters, enable Electron Node integration for remote pages, or automatically allow screen capture. Validate exam epoch, school, saved project, idle/unload and close behavior before admitting authenticated examination work. Then add signed/notarized Windows/macOS packaging, explicit native versioning and safe updates.

Android/iOS should use reviewed Capacitor native projects with bundled reviewed web assets, secure native auth/deep links, and app-store-compliant updates. They must reuse canonical school APIs, not replicate school records or create parallel grading or exam services.

## Installable, unsigned development preview artifacts

The GitHub Actions workflow **Native public-preview installation artifacts** builds a Windows NSIS EXE and Intel/Apple Silicon macOS DMGs. Use **GitHub → Actions → Native public-preview installation artifacts → successful run → Artifacts**, download the corresponding ZIP and unpack the installer. GitHub sign-in may be required. Preview artifacts are retained for seven days and include SHA256SUMS.txt checksums. They are not official Adminerva releases.

These packages are **public-only**, have no native account sign-in, device monitoring, teacher-controlled examinations, or privileged file/screen access. Signed, tested official applications are still pending. Windows SmartScreen and macOS Gatekeeper may warn because these are unsigned. Test only on a disposable or authorized development device, respecting organization endpoint policies; do not install these in a production school laboratory or give them to students for exams.

The authenticated desktop implementation in PR #295 is intentionally excluded from this public preview. This installer exists to evaluate the install/uninstall experience, window/navigation, responsive UI and platform compatibility.
