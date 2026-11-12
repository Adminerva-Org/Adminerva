# CheerpJ 5 interactive Java terminal — Adminerva Studio experiment

This is an **instructor-only technical proof of concept**, not an enabled Studio execution backend or grading environment. It lives on the feature branch named experiment/cheerpj-interactive-console, separately from the existing student/guest Studio pages, runtime client, personalized assessments, and Judge0.

## Purpose

Determine whether CheerpJ 5 (Java 17) can provide locally executed Java console programs, including **live input after Scanner prompts**, without Oracle Cloud or a school PC running as a server.

The experimental page provides:

- A one-file Main.java textarea, plus Hello World, Scanner (two inputs) and compiler-error examples.
- Compilation with the Java 17 com.sun.tools.javac.Main class and execution of the compiled Main class.
- In-memory source injection with the documented CheerpJ cheerpOSAddStringFile API.
- Interactive input/output through CheerpJ's undocumented `ConInodeOps.readAsync` and `ConInodeOps.writeAsync`, adapted from Leaning Technologies' Apache-2.0 BrowserCode example. The adapter supplies line-based input to Java's `System.in` and streams Java stdout/stderr into our terminal.
- CheerpJ's conventional #console output target and a separate stdin form.
- Stop/Reset through full page reload; draft code is retained in sessionStorage on the same tab.

## How to try without deploying to Adminerva

1. Check out branch experiment/cheerpj-interactive-console on a personal or test device.
2. From the repository root, run the command **npx http-server -p 8080** (or another HTTP server supporting HTTP Range requests).
3. Open **http://localhost:8080/experiments/cheerpj-console/**.
4. Click Compile & Run. If compilation succeeds, type a name and press Send, then an age and Send.
5. Review browser console logs only if the page reports a CheerpJ API error.

CheerpJ files download from https://cjrtnc.leaningtech.com/5.0/. The page needs Internet access on first run. Java code is intended to run on the browser device rather than on a remote backend.

**Do not deploy this page on the authenticated Adminerva origin for student use yet.** A browser Java runtime is not an isolation boundary between student-provided code and the hosting application's credentials, DOM, or same-origin services. A production integration needs a dedicated origin or sandbox unable to access Firebase authentication state or protected data. Run the experiment on localhost with example code and no secrets.

## Manual observations

| Scenario | Desired outcome |
| --- | --- |
| Hello World | Compiles and prints to page console |
| Scanner sample | Receives name and age on separate prompts, prints result |
| Compile error | Shows javac diagnostic, does not run old compiled class |
| Two consecutive runs | No stale stdin or doubled output |
| Stop during input | Reloads without losing current editor draft |
| Page refresh | Main.java draft remains for that tab; no projects/grades changed |
| Browser offline | No promise of offline operation; first run requires CDN assets |
| Unexpected CheerpJ API change | Surface a precise ConInodeOps error; do not claim interactive input works |
| Large output | Cap displayed output at 1 MiB and acknowledge writes so execution does not silently freeze |
| UTF-8 and short stdin reads | Preserve bytes until all of a typed line are consumed |

If Java 17 does not expose com.sun.tools.javac.Main or the current CheerpJ build stops exposing the undocumented ConInodeOps console interface, record the exact error instead of silently falling back to Judge0. These are the central interoperability checks. The prototype **has not been browser-validated** from the authoring environment.

## Focused automated adapter checks

Run `node --test experiments/cheerpj-console/console-bridge.test.mjs` at the repository root. These tests mock CheerpJ console reads/writes and **do not prove that CheerpJ works in a live browser**. GitHub Actions runs only this experiment's tests when its files change.

See the original reference implementation: https://github.com/leaningtech/browsercode/blob/main/src/lib/cheerpj/console.ts (Apache-2.0). Note that `ConInodeOps` is not documented by CheerpJ's public API; upgrading the provider version can break it. Do not enable this path in the authenticated Student Studio until isolated-host deployment, browser interoperability, and licensing are resolved.

## Non-goals

This experiment does not implement multi-file projects, a POSIX terminal, Java desktop GUI, subprocesses, execution quotas, trusted grading evidence, auto-evaluation, queue management, project persistence, or graceful process cancellation beyond a page reload.

Judge0 remains the active default. The js/student/runtime-config.mjs file stays unchanged. Student submissions and assessment availability are unchanged.

## Licensing and references

- https://cheerpj.com/docs/overview
- https://github.com/leaningtech/javafiddle/blob/main/src/lib/CheerpJ.svelte
- https://cheerpj.com/docs/reference/cheerpjRunMain
- https://cheerpj.com/docs/reference/cheerpjRunLibrary
- https://cheerpj.com/docs/reference/CJ3Library
- https://cheerpj.com/docs/reference/cheerpOSAddStringFile
- https://cheerpj.com/docs/licensing

Free technical evaluation is available; school-wide or institutional production use may require a different license. Confirm eligibility with Leaning Technologies before enabling students.
