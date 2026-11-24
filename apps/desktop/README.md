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

## Pending browser-to-device sign-in

`native-auth-protocol.cjs` generates an unpredictable flow ID, 256-bit PKCE verifier/challenge and eight-digit confirmation code. The system browser authorization page is `native-connect.html` and only receives the flow ID. A gated, TTL-backed callable approves the pairing only after a verified recent login and manually entered confirmation code. It releases a one-time Firebase custom token only to the original verifier. The current desktop preview is intentionally **not wired to redeem or consume** a token; this needs a separate safe completion flow and security review.


## Native-client release gate

Implement authenticated system-browser OAuth/PKCE handoff and validated return through a short-lived server-verified exchange. Never reuse browser cookies, forward Firebase ID tokens through URL parameters, enable Electron Node integration for remote pages, or automatically allow screen capture. Validate exam epoch, school, saved project, idle/unload and close behavior before admitting authenticated examination work. Then add signed/notarized Windows/macOS packaging, explicit native versioning and safe updates.

Android/iOS should use reviewed Capacitor native projects with bundled reviewed web assets, secure native auth/deep links, and app-store-compliant updates. They must reuse canonical school APIs, not replicate school records or create parallel grading or exam services.
