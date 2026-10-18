# V2 release-preparation validation

## Tested scope

The full browser workflow runs the actual application modules and Firebase browser SDK **10.13.0** against real local **Authentication and Firestore emulators**, using the proposed Firestore rules. The isolated Firebase project is `demo-adminerva-browser`; fixture accounts represent the instructor and two students. This goes beyond the earlier browser check that replaced Firebase with in-memory stubs.

GitHub repository history/source and Gemini responses are deterministic fixtures. The first evaluation request deliberately returns HTTP 503; the second returns a partial draft with an unresolved visual-quality criterion. No real provider key, production sign-in, production database, or real student source is used. Unexpected browser requests to external services fail the test.

## Passed browser checks

| Scenario | Verified result |
| --- | --- |
| Student submission, resubmission, withdrawal and resubmission | Real authorized writes succeed, new server timestamps and immutable before/after history are stored, and assignment status updates immediately |
| Approval inside RepoFetch | Selected changes and the pinned project load in the embedded panel; grading stays disabled until instructor approval |
| Individual evidence versus shared project | Alice's verified welcome-screen diff is the only attribution source; the teammate's home file appears as shared context, and missing group features are separate observations |
| Provider outage and incomplete draft | HTTP 503 writes no grade; an unscored criterion leaves the suggested total empty; evaluation alone saves nothing |
| Explicit teacher save | The entered 18/20 fixture score, edited/reviewed feedback, checkpoint SHA, evidence revision and assistance provenance are saved privately |
| Student privacy | Private grades, private assessment instructions and other students' evidence/grades are denied by Firestore using actual emulator-issued identity tokens |
| Publication and reopening | Individual Gradebook publication reveals the fixture grade; reopening is blocked while published; explicit unpublish then reopen succeeds |
| Reapproval at the same SHA | The old grade draft cannot publish; a fresh teacher review/save against the new evidence revision is required |
| No verified contribution | Bob's shared checkpoint approval does not enable automated evaluation or create a grade |
| Published feedback disclosure | Students can expand how instructor-reviewed feedback was prepared when the saved grade used automated assistance |
| Browser behavior | No application runtime errors or unexpected external requests; student mobile layout has no horizontal overflow |

The fixture 18/20 is test data, not an assessment of any real student or a replacement for the reported 4/20.

## Reproducibility and CI

The browser test is `tests/browser/review-lifecycle.smoke.mjs`; fixtures are in `tests/browser/review-fixtures.mjs`. Its separate `review-lifecycle` CI job runs the same workflow with disposable Chromium, real emulator identities, and the proposed rules, and uploads synthetic screenshots plus `result.json` as `isolated-review-browser-results`.

The existing 178 JavaScript regressions, 29 Firestore permission regressions, syntax checks, and CodeQL remain part of PR #20 validation. The current checks for each final commit are linked from the PR; a passing earlier commit is not a substitute for a passing release candidate.

## Production boundary

No production rules/functions deployment, PR merge, grade publication, migration or live-account test is performed during preparation. Before release, obtain explicit owner approval, preserve the actual deployed rules and website baseline, and follow [the coordinated release checklist](v2-release-checklist.md).

Real instructor/student account configuration, live GitHub access, the configured provider's output quality, independent authorship evidence, and Android runtime/visual checks still require an approved controlled production smoke test. Emulator and fixture results do not establish those outcomes.
