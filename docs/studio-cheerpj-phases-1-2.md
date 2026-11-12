# Adminerva Studio — CheerpJ Phases 1 and 2

**Status:** The isolated Java runner protocol and optional Studio UI integration are implemented on a feature branch. **The browser runtime is not active by default.** Live CheerpJ execution has not been verified against the CDN in a real browser. Judge0 remains the default and assessment/grade workflows are unchanged.

## Goal

Give Student and Guest Studio a real interactive Java 17 process using Scanner, System.in and System.out in the existing terminal instead of restarting Judge0 on each line.

## Implemented

- An optional **Execution** selector in the Studio Java console view, with Standard (Judge0 batch) and Browser Java (live beta) modes.
- Browser mode appears **only after a valid HTTPS runner URL is configured**, on a different origin from the authenticated Adminerva site.
- The existing Run button sends a frozen snapshot of up to 40 .java files and 250 KB; the existing input field sends one line to the same process. Compiler errors and output stream into the existing terminal.
- Stop Java destroys the execution iframe without reloading the Studio project. Opening a different project also terminates the earlier session. Judge0 is unchanged.
- Cross-origin protocol checks exact parent/child origins and a random session identifier. No Firebase authentication or student identity is transmitted to the execution page.
- Standalone runner in experiments/cheerpj-console/embedded-runner.html loads CheerpJ 5 and Java 17, compiles via built-in javac, executes the selected entry class and uses the experimental ConInodeOps console adapter.
- Unique compilation directory per execution, best-effort cleanup and bounded input/output.
- Focused JavaScript syntax and protocol tests.

## Blocking activation requirement — a separate HTTPS origin

CheerpJ's writable /files/ uses IndexedDB. A same-origin iframe sandbox without allow-same-origin has an opaque origin that may prevent storage access. A same-origin iframe with allow-scripts and allow-same-origin would not isolate student Java from the signed-in Adminerva origin. **Do not point the runner URL to the existing Adminerva GitHub Pages origin.**

Host these three files on an independent HTTPS static origin:

- embedded-runner.html
- embedded-runner.mjs
- console-bridge.mjs

A distinct Cloudflare Pages *.pages.dev static project is one possible free-tier host. With Git-integrated Pages, publish only the experiments/cheerpj-console folder as the output directory. No VM is needed.

Then set the exact public URL in js/student/cheerpj-studio-client.mjs (CHEERPJ_STUDIO_RUNNER_URL) to the independently hosted embedded-runner.html page. Bump the Studio script cache versions in both HTML pages. The runner currently accepts the canonical Adminerva parent origin https://adminerva-org.github.io, plus http://localhost:8080 for development.

The separate origin protects Adminerva app-origin storage, but CheerpJ follows ordinary browser networking rules. This is not a formal sandbox security certification. Do not place Firebase credentials, grading data or administrative secrets on the runner origin.

## Required pilot observations

1. Independently hosted runner loads CheerpJ 5 assets.
2. From a staging Student Studio, select Browser Java and run a Hello World Main.java example. No Judge0 request should be sent.
3. Run a two-input Scanner program. Enter name, then age: confirm the Java process remains alive between responses.
4. Run two Java classes in one project, plus a package-qualified main class.
5. Check compiler errors display and stale bytecode does not execute.
6. Stop a waiting input loop. Confirm Studio remains open, the code is unchanged, and a new run has no previous input.
7. Confirm the fallback Standard compiler remains selectable when the browser runner is unavailable.
8. Check origin boundary and untrusted message handling in a browser.
9. Confirm licensing terms for school-wide institutional use with the CheerpJ provider.

Focused Node tests mock the message and console APIs and do **not** certify the live browser runtime.

## Known limitations

- No execution queue, shared Java server, trusted grading evidence or secure CPU quota.
- CheerpJ ConInodeOps is undocumented and may change in a new build.
- Current input project accepts .java files only; CSV/text and other resource-copy behavior is future work.
- Page refresh does not preserve a live Java process.
- Compiler errors are streamed as terminal text; per-file Monaco compiler markers are not yet connected.
- Browser Java remains unavailable until a separate hosting origin and licensing are ready.

## Sources

- https://cheerpj.com/docs/explanation/architecture
- https://cheerpj.com/docs/getting-started/Java-app
- https://cheerpj.com/docs/guides/filesystem
- https://github.com/leaningtech/browsercode/blob/main/src/lib/cheerpj/console.ts
- https://cheerpj.com/docs/licensing
