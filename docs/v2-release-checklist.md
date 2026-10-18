# V2 review release preparation

This is an operator runbook, not authorization to merge or deploy. PR #20 remains a draft until the owner explicitly approves the production release.

## Targets and boundaries

- Repository: `Adminerva-Org/Adminerva`, PR #20, feature branch `feature/unified-teacher-evaluation`.
- Production Firebase project configured in `js/core/firebase-core.js`: **`reporeview-e7ca4`**. Confirm the selected account can administer this exact project before deployment; do not rely on a CLI default project.
- Website: `https://adminerva-org.github.io/Adminerva/`. Confirm the GitHub Pages deployment source and latest deployed revision in repository settings before merging. Repository configuration alone does not prove the active Pages deployment source.
- The last successful Pages build inspected during preparation is [run 39130806186](https://github.com/Adminerva-Org/Adminerva/actions/runs/39130806186), from `main` at `a36479866eb47c1f265d1f0ff33bad126c02924b`. Recheck that baseline at release time; settings can change independently of repository files.
- Only Firestore rules and the website are in the release. **No Functions deployment, data migration, assessment creation, grade publication, or student-data cleanup is included.**
- Isolated validation uses `demo-adminerva-security` and `demo-adminerva-browser`; neither contains production student records. The browser test refuses non-local emulator hosts, authenticates fixture accounts through the Auth emulator, and uses the actual application Firebase SDK version 10.13.0. GitHub and Gemini responses are controlled fixtures; all unexpected browser requests to external services are blocked.

## Before asking for release approval

1. Confirm the current PR head and base have not changed since validation. All JavaScript, Firestore permission, browser lifecycle, and CodeQL checks must pass on that head.
2. Read the browser artifact report. Check student submit/resubmit/withdraw, inline approval, verified contribution scope, provider failure, unresolved criterion handling, private save, individual publication, protected reopening, same-SHA reapproval, stale publication rejection, and student privacy.
3. Preserve the exact currently deployed Firestore rules from the Firebase console or authorized API, not merely the repository copy. Record their deployed ruleset/release identifier and deployment time. Preserve the currently published website revision too.
4. Confirm how GitHub Pages publishes this repository and arrange a short controlled release window with no active student resubmissions. The operator should explain that existing browser tabs must reload afterward. Do not send announcements without the owner's authorization.
5. Present the configured Firebase project, PR head, intended website release, rule changes, temporary compatibility window, and rollback approach to the owner. Obtain explicit approval to deploy the rules and merge/release the website. Request account sign-in only if needed; never request passwords or provider keys in chat.

## Approved coordinated release

Old website code cannot create the new evidence audit records. New website code cannot resubmit against old deployed rules. The rules and static website cannot be switched atomically, so keep the release window controlled.

1. From an authorized Firebase session and the validated checkout, deploy **only** rules with an explicit project:

   `firebase deploy --only firestore:rules --project reporeview-e7ca4`

   Do not use an unrestricted `firebase deploy`, and do not use `firebase.browser.json` for deployment.
2. Confirm the deployed rules release is the expected version. Immediately merge the validated PR and follow the configured GitHub Pages deployment to completion. Do not enable automatic grade publication.
3. Confirm the public website serves the released assets, then reload teacher and student test sessions. Cached old tabs may fail evidence updates until refreshed; do not repeatedly retry writes from an old tab.
   The prepared release manifest is `2026.10.18.4`; review, Gradebook, evidence and student entry modules carry refreshed asset URLs.
4. Use an owner-approved test roster/repository to check the actual teacher/student sign-ins and live GitHub access. Start with unpublished grades. Exercise submit, resubmit, withdraw, approve, evaluate, save, publish, unpublish and reopen; use only designated test grades for publication checks.
5. Confirm that a changed or reopened checkpoint blocks the old draft from publication, that student queries exclude private drafts and other students' evidence, and that audit records preserve actor and submission history.
6. Test the configured provider only after the instructor's source-sharing consent. Real provider behavior and actual Android runtime/visual quality remain separate teacher verification steps. Emulator success does not establish those results.

## Stop and rollback conditions

Stop the release if deployment selects another project, approved evidence changes unexpectedly, private drafts become visible, audit writes fail, or the released page cannot load its matching modules.

- Preserve evidence and grade records. Do not delete histories or revert student data as a code rollback.
- Keep submissions paused while diagnosing. A frontend-only rollback can make older clients incompatible with audited evidence; reverting to old rules can remove the protections this change adds. Do not perform either silently.
- Present the captured website revision and deployed rules backup, current data schema/revisions, and the compatibility impact to the owner. Obtain explicit approval for a coordinated rollback or a forward repair.
- Recheck read permissions and protected grades after recovery, then resume the workflow only after the owner accepts the result.

## Reproduce the isolated browser test

Install the test-only dependencies from `.github/workflows/review-browser.yml`, install Playwright Chromium, then run:

`firebase emulators:exec --config firebase.browser.json --project demo-adminerva-browser --only auth,firestore "node --test tests/browser/review-lifecycle.smoke.mjs"`

The test configuration does not change normal `firebase.json` or production endpoints. `ADMINERVA_TEST_OUTPUT` optionally selects an artifact directory; `ADMINERVA_TEST_BROWSER_PATH` optionally selects a local Chrome executable for the disposable test browser. CI artifacts contain only synthetic fixture identities and data.
