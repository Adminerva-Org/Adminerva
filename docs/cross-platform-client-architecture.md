# Cross-platform client technical architecture

> Product direction, progress, priorities and release status are exclusively in `docs/adminerva-school-os-master-plan.md`. This document is an engineering contract, not a competing roadmap.

## One product, more than one delivery mechanism

The existing hosted Adminerva frontend, tenant-verified Firebase APIs, identity/roles, school operations, assessment/grade paths, and Studio cloud-save semantics remain canonical. Do not fork the School OS into platform-specific business logic. Platform-specific code may implement **only** native window/chrome, OS-authenticated device access, system-browser sign-in handoffs, secure local storage, notifications, and reviewed native file/capture features.

| Client | Web code delivery | Native code delivery | Current position |
| --- | --- | --- | --- |
| Web/PWA | Hosted from canonical site | Not applicable | Operational web; PWA install depends on browser support |
| Windows/macOS | Approved HTTPS web content in sandboxed Electron renderer, after auth integration | Signed installer + independently versioned native bridge | Public-only preview scaffold; no installer, no native auth |
| Android/iOS | Reviewed web assets bundled with Capacitor native app, with allowed shared web/API content | Signed store-delivered native application | Public-only asset staging in `apps/mobile`; native Android/iOS projects and store builds absent |

**Website updates are not universally native updates.** Hosted desktop public pages load current site changes on normal navigation or relaunch; never force refresh a Studio editor during a practical exam. Bundled mobile UI requires an app-store release to update bundled code, unless a narrowly reviewed category of remote content is allowed. Native bridge changes, new OS privileges and security-sensitive flows require signed native updates. All clients share the same live authorized backend changes only when their API contracts remain compatible.

## Client contract

`js/core/app-compatibility.mjs` defines the shared *UI-only* client descriptor: platform kind, release channel, bridge protocol, shell version and enumerated native feature names. The desktop preview exposes no capabilities and cannot masquerade as release. This descriptor is not a security credential. School authorization, enrollment, student identity, teacher assignment, session epoch, OS permissions and storage access are enforced separately by trusted platform and backend components.

## Native system-browser sign-in handoff (in development; disabled)

The new server-only `nativeClientHandoff` callable follows a four-step device-authorization exchange: an unauthenticated native client creates a five-minute pairing challenge with an eight-digit confirmation code (the browser link carries only a random flow ID); an explicitly reauthenticated, verified Firebase user approves in the system browser by entering that code; the original native client proves possession of the 256-bit PKCE verifier; and the backend atomically consumes the pairing before issuing a Firebase custom token for that exact existing UID. All Firestore pairing and throttling records are denied to clients and have TTL. The quota limiter stores HMAC pseudonyms, not raw account UIDs or IP addresses; it requires a deployment secret and a validated raw-request source IP, with an additional Cloud Armor/edge rate limit still required. Neither browser cookies, ID tokens nor private verifier are put in a URL.

**This is not operational:** callable issuance is off unless `ADMINERVA_NATIVE_AUTH_HANDOFF_ENABLED` is deliberately configured; the desktop UI is separately off unless `ADMINERVA_ENABLE_DESKTOP_SIGNIN_UI=true`. The client now has a narrowly scoped one-time token IPC and official-origin `desktop-session.html` Firebase completion page, but production activation still requires edge-level abuse limits and proxy-IP integrity validation in addition to the implemented server-side transactional quotas, real-browser provider verification, existing school/role acceptance, safe sign-out/reauthorization, signed native distribution, and physical-device acceptance. Do not enable or advertise sign-in from this implementation slice. This bridge is not school authority: existing school/role services must independently validate every protected request.


The native process refuses a second pairing while a private school workspace is open, preventing an account switch during unsynchronized Studio work. The browser approval page never signs out the shared Firebase browser session; switching providers or accounts requires a separate browser profile to protect active Studio work. Token IPC is consumable only once, confirmation requires a previously consumed token, and canceled/reloaded bootstrap pages lose their confirmation state. A server-verified school role is required before routing into private Adminerva. This remains a source-level safeguard, not proof of physical-device acceptance.

## Desktop security boundary

`apps/desktop/` intentionally starts only in approved public pages on `https://adminerva-org.github.io/Adminerva/`. Authentication and non-public routes open in the system browser; credentials are not handed back. All renderers are sandboxed and isolated, arbitrary window opening and unapproved top-level navigation are blocked, and permission requests are denied. There is no OS bridge beyond a read-only descriptor. The preview is **not ready for classroom/student accounts**. Review remote scripts and create an authenticated native session bridge before allowing private use.

## Mobile security boundary

Use native Android and iOS shells with reviewed bundled web assets and one authorized school backend. Do not ship Capacitor production apps pointing `server.url` at an arbitrary remote website. Native access must be capability-scoped, consented, and subject to OS authorization; do not promise unrestricted iOS app or browser inspection. Native sign-in uses approved system-browser or native provider flows and verified redirect/deep-link bindings. Protect device-only drafts, ownership and source evidence across app updates, OS eviction and account switches.

## Exam, offline and release invariants

- Studio exams continue to use canonical class offering, enrollment, teacher-controlled epoch, cloud autosave, final-save grace, immutable close receipt, teacher review and frozen grade evidence. No native shell may bypass them.
- Do not auto-reload active editor sessions when a hosted web release appears; show an update-after-save state where appropriate.
- Device caches and local drafts are NOT cross-device synced until school cloud confirms storage. Preserve older drafts on application update/close.
- Monitoring must be session-bound, visible, permitted, tenant/role scoped, retained for an approved duration and independently authorized; browser/desktop/mobile coverage varies. Do not auto-penalize application switches or start stealth capture.
- Never publish native download/store links without signed/tested official artifacts, platform security review, verified publisher identity and appropriate install/update channel.
- Focused release validation must include login, school isolation, native permissions, 320px layout, Studio execution, lost connection/forced quit, exam close and cloud-save integrity.

## This foundation's scope

Implementation in this branch: a secure **public-only** Electron preview shell; a shared browser/native compatibility model; public-only Capacitor mobile web-asset staging from canonical site files (no remote server URL); focused tests; technical documentation; status and future work consolidated into the master plan. Not implemented: native authenticated workflows, installer signing, desktop auto-update service, desktop Companion, Android/iOS native projects, signing, store packaging or release.
