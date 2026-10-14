# Adminerva notifications, reports and submissions — deployment plan

## Deployment state

The GitHub Pages frontend is committed on `main`. It includes a bell in the shared navigation, live report and submission previews, report improvements, and a **Submit for Review** panel.

**Not yet active until deployed separately:** Firestore Security Rules changes, server-originated durable notifications, and the rules permitting student submission receipts.

The Firebase project is `reporeview-e7ca4`. Do not paste Firebase secrets or GitHub credentials into issues or reports. The frontend uses the existing public Firebase configuration.

## Firestore rule regression tests

GitHub Actions runs the JavaScript suite and a Firebase Firestore emulator test suite (see `.github/workflows/adminerva-quality.yml` and `tests/firestore-rules.test.mjs`). The emulator tests validate legitimate and forged issue submissions, comment authorization, recipient-only inbox access, immutable student submission receipts, published-grade visibility, and UID-based upvote permissions. CI green does not mean the rules have been deployed to the live Firebase project.

## Backend deployment (authorized Firebase project owner)

Prerequisites: Firebase CLI, Node 20, the appropriate Firebase project role, and a Firebase plan capable of running Cloud Functions. Set up Firebase billing only with appropriate organizational authorization. Back up the currently deployed Firestore rules before replacement.

From the repository root:

```powershell
npm --prefix functions install
npx firebase-tools login
npx firebase-tools deploy --project reporeview-e7ca4 --only firestore:rules,functions
```

Review the proposed `firestore.rules` **in the emulator before production**. The rules continue to use two temporary staff allowlist emails; replace them with verified teacher claims when teacher accounts are introduced.

Functions source: `functions/index.js`. Functions v2 uses Cloud Firestore triggers. Official notification documents are stored at `notifications/{uid}/items/{id}`, and only a recipient may update their own `readAt`. Students cannot create them. Functions use the Firebase Admin SDK to create authenticated notifications.

### Core event sources

| Event | Producer | Recipient | Notes |
|---|---|---|---|
| New bug report | `issues/{id}` created | Staff | Staff bell also previews new issues while logged in, even without Functions |
| Report changed / comment | Issues and comments triggers | Reporter and relevant staff | Excludes comment author |
| Submission for review | `student_submissions/{id}` created | Staff | Student creates an immutable receipt pinned to a Git commit SHA |
| Published grade | `student_grades/{id}` created or updated | Student | First publication, including initially published records; draft grades never notify students |
| New deployment | `assessments/{id}` created or updated | Students in newly deployed sections | Deployment at creation and newly added sections are covered |
| Grading check error | `grading_alerts/{id}` created | Staff | Auto-Checker records one alert per student/assessment/hour |
| Published grade correction | `student_grades/{id}` updated | Student | Notifies only when a published score or feedback changes |

### Smoke tests in a test Firebase project first

1. Sign in as a student. Report a small reproducible bug and verify the confirmation reference. Log in as staff and verify the bell shows the report; open it and comment.
2. Verify students **cannot** edit report status, priority, locked flag, or a different student's notifications via SDK writes.
3. Update report status as staff; verify reporter's notification opens the same issue.
4. In Student Assessments, choose a public repository and select **Submit current GitHub revision**. Verify Firestore contains `revisionSha`, `studentId`, `assessmentId`, `submittedAt`, and the chosen source path. The same SHA must not create a duplicate receipt.
5. Confirm staff receives the submission alert. Check the identified revision in GitHub before grading.
6. Publish one reviewed grade and verify only that student's notification appears. Test a draft/unpublished grade to confirm it does not create a student alert.
7. Trigger an Auto-Checker failure and verify a teacher-only grading warning appears. Retry in the same hour and confirm no duplicate new alert.
8. Test on a narrow mobile viewport (320px wide): navigation bell, inbox scroll, issue forms, the full-height assessment modal, and Submit for Review.
9. Confirm new and old issue comments remain visible and role spoofing through `Adminerva_Role` in localStorage does not grant triage permissions.

## Known boundaries

* GitHub Pages does **not** deploy Cloud Functions or Firestore rules. Do not mistake a frontend commit for a complete Firebase release.
* The student submission client currently resolves **public GitHub repositories** without reading browser-stored GitHub tokens. Private repositories need a secure backend.
* In-app notification previews work only while a browser tab is open. Reliable event history requires deployed Functions. Category mutes and search are available locally; preferences do not sync across devices. Email and background browser push are not enabled.
* New report screenshots are size-capped but remain inline data in Firestore, rather than Firebase Storage. Avoid uploading sensitive student data. A future migration should move attachments into secured Storage with access controls.
* New reports and student comments use authenticated Firebase UIDs and omit student emails from new public records. New votes also use Firebase UIDs, not emails. **Historical issues, votes and comments may still contain email addresses** readable to signed-in users until a controlled database migration runs. New reports still expose their UID to signed-in readers, so do not place sensitive personal information in public tickets. A separate private support schema is recommended.
* The report duplicate detector is a keyword-based hint, not automatic merging.
* Use a short incident window for initial production monitoring: examine Firestore permission-denied errors and Cloud Functions execution logs.

## Live collaborative coding — planned, not deployed

Google Docs-like collaborative coding is feasible with **Monaco + Yjs (CRDT) + y-monaco awareness** and an authenticated WebSocket synchronization service (e.g. Cloud Run, not public demo signaling). A room must have explicit members from verified Firebase identities, an owner/invitation workflow, rate limits, revision history, and presence/cursor expiration. Keep autosaved snapshots independent of GitHub. GitHub commits should require a deliberate named-student action and must not imply that every live collaborator authored the entire shared file.

Recommended implementation steps:

1. Secure group membership and project/repository linking, including student invitations.
2. Private room backend with token verification and Yjs document updates.
3. Presence, named cursors/selections, reconnect and conflict-free offline resynchronization.
4. Automatic snapshots, rollback, mobile read-only mode, and explicit GitHub export.
5. Concurrent-device and failure-injection tests before enabling the feature for student accounts.

Do **not** implement collaborative text syncing by writing the whole Monaco buffer to one Firestore document on every keypress; that would create lost-update races, high write costs, and attribution ambiguity.
