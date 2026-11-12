# CheerpJ Studio — Phases 3 & 4: lifecycle + isolated hosting

Status: PRE-ACTIVATION CODE. Interactive Java remains disabled in Student/Guest Studio. Judge0 is still the default. Live CheerpJ browser execution is not yet verified against an independent HTTPS host.

## Phase 3 — execution lifecycle

- Every run has a fresh cross-origin sandboxed iframe and a random session identifier.
- The parent accepts messages only from that frame and configured HTTPS origin, with matching channel/session.
- Java compiler and application output streams to the existing terminal; stdin lines reach the same Java process.
- Stop Java removes the iframe and preserves Studio files. A subsequent Run starts a clean Java process.
- Runner heartbeat every 10 seconds; 45-second no-response watchdog; 45-second connection deadline; total 8-minute session deadline. These are UX protections, not hard CPU or memory quotas.
- Browser Java input is unavailable until a live process starts. Sending input must never silently trigger Judge0 replay.
- Runner uses a unique per-run writable directory for Java source/classes, supports package and nested source paths, and attempts cleanup at completion.
- Abruptly stopped frames can leave temporary IndexedDB files. Reload cannot rejoin a browser-local process.
- This implementation does not automatically grade, score or verify student source. Assessment submissions remain unchanged.

## Phase 4 — independent HTTPS static host

IMPORTANT: Never run student Java from the authenticated Adminerva origin. The copy of the runner script on GitHub Pages intentionally refuses that host.

Host the runner on a separate HTTPS origin, for example a separate Cloudflare Pages project. Static hosting is sufficient; no Oracle VM or school computer is required. The build produces ONLY:

- embedded-runner.html
- embedded-runner.mjs
- console-bridge.mjs
- _headers (Cloudflare response-header configuration)
- index.html (non-executing landing page)

The build excludes Firebase modules, student projects, assessment data, Studio pages, tests, and the earlier standalone experiment.

### Cloudflare Pages settings

1. Open Workers & Pages > Create > Pages > Connect to Git, then authorize Adminerva-Org/Adminerva in your Cloudflare account.
2. Project name suggestion: adminerva-java-isolated (actual pages.dev name is assigned by Cloudflare).
3. Production branch: main.
4. Framework preset: None.
5. Root directory: repository root.
6. Build command: node scripts/build-cheerpj-pages.mjs
7. Build output directory: dist/cheerpj-runner
8. Choose Node.js 22 if your project asks for a Node runtime.
9. Deploy. Confirm the final origin is different from https://adminerva-org.github.io.

The _headers file supplies frame-ancestors restrictions, a Content-Security-Policy, no-store, no-index, and disables microphone, camera, geolocation and payment capabilities. Network fetches are restricted to the runner origin and CheerpJ CDN. CheerpJ may evolve its asset-host requirements; verify before changing this policy.

Direct visits to embedded-runner.html without a valid session show an inactive message. It executes only when the authorized Studio parent sends the validated session handshake.

### Controlled activation once the host exists

1. In js/student/cheerpj-studio-client.mjs set CHEERPJ_STUDIO_RUNNER_URL to the independently hosted HTTPS embedded-runner.html URL. Keep the value empty until that host actually exists.
2. The client rejects same-origin, insecure, credentialed, query-string or fragment runner URLs.
3. If Adminerva changes origin, update the exact PARENTS allowlist in embedded-runner.mjs and frame-ancestors in _headers before activation.
4. Bump the client import version in js/student/playground.js and its script query in student-playground.html and guest-playground.html.
5. Test with an instructor: Hello World, two Scanner input prompts, multi-file Java, package-qualified entry class, compiler failure, stop while waiting, stop an infinite loop, and recover by switching back to Standard (batch).
6. Verify student Java cannot read the Adminerva site DOM, localStorage, IndexedDB, Firebase credentials or privileged services.
7. Confirm CheerpJ licensing eligibility for institutional/school-wide use.

### Remaining limitations

- Live browser input/output has not been browser-validated; the ConInodeOps console adapter is undocumented and may change.
- Java source only (up to 40 .java files and 250 KB), no non-Java resources/CSV/data file transfer yet.
- No trusted execution evidence, centralized execution queue, server-side sandbox or reliable memory/CPU quota.
- Cloudflare account authorization, deployment of the separate origin and runtime URL activation are NOT complete.

Official references:
- https://developers.cloudflare.com/pages/framework-guides/deploy-anything/
- https://developers.cloudflare.com/pages/configuration/headers/
- https://cheerpj.com/docs/overview
- https://cheerpj.com/docs/licensing
