# CheerpJ teacher technical evaluation — Cloudflare connection

## Hosting

The instructor-provided Cloudflare Pages site is https://adminerva.pages.dev.
It serves an inert landing page at the root; this is expected.
The embedded Java execution endpoint is https://adminerva.pages.dev/embedded-runner.html, served from a different HTTPS origin than Adminerva Studio.

## Activation

This release connects the runner URL in js/student/cheerpj-studio-client.mjs and switches the rollout policy to developer_evaluation for the previously designated Adminerva teacher test account only. The rollout is a client-side UI feature gate; it is not server-side authorization.

The following remain disabled: student and guest rollout, classroom assessments, personalized assessment execution, practical exams, institutional production activation. The licensing flag institutionalUseApproved remains false. The Java console defaults to Standard (batch) on each page load.

## Instructor smoke test

1. Sign in to the approved teacher account in normal Student Studio. Open a regular Java project (do not open it through an assessment link).
2. Under Java Console mode, select Execution > Browser Java · live (beta).
3. Run Hello World. It should compile and print to the Studio Terminal.
4. Run a Scanner example asking for name and age. Submit both answers separately, and confirm Java stays in the same process.
5. Stop a waiting program, run again, and check that source files and editor remain intact.
6. If CheerpJ fails, switch Execution back to Standard · batch. Record the exact terminal error.

A direct visit to embedded-runner.html without a session will intentionally show a short inactive message. A successful Pages landing page is NOT proof that Java compilation or Scanner input works; the CheerpJ console bridge depends on an undocumented provider API.

## Safeguards

The rollout includes only the approved teacher account, uses an independent HTTPS origin, and sends only Java source snapshots and an entry filename. It does not transmit Firebase credentials, assessments, rubrics, school records or grades. Existing Judge0 execution is not removed or replaced. School-wide use still requires licensing confirmation and explicit activation.

If the Cloudflare deployment changes to a new origin, update both the runner URL and its embed allowlist, then recheck the domain/asset paths before pilot use.
