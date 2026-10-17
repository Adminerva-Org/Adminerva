# Adminerva Firebase Cloud Functions — controlled deployment

> This is the **production deployment runbook**, not evidence of a completed deployment. Merging code into GitHub Pages does **not** deploy Firebase Cloud Functions or Firestore Security Rules. Do not deploy Mini PETA 1 before completing the verification checklist in [assessment-v2-rollout.md](assessment-v2-rollout.md).

## Configuration already in the repository

| Setting | Value |
|---|---|
| Firebase project expected by the web app | `reporeview-e7ca4` (`js/core/firebase-core.js`) |
| Firebase CLI deployment manifest | `firebase.json` |
| Source directory | `functions` |
| Node runtime | `nodejs22` |
| Functions entry point | `functions/index.js` |
| Functions SDK | `firebase-functions` v6 |
| Admin SDK | `firebase-admin` v13 |
| Firestore Security Rules | `firestore.rules` |
| Deployment target | Firebase project above; **GitHub Pages is separate** |

This repository deliberately has no checked-in `.firebaserc` default project. Explicit `--project reporeview-e7ca4` on each production command helps avoid accidentally deploying to the wrong Firebase project.

The 13 exported functions are Firestore-triggered, second-generation functions; no HTTP endpoint or API key is needed. Function code uses Admin SDK service identity within Firebase and resolves authorized staff recipients through Firebase Authentication. Do not commit a service-account JSON key.

## 1. Confirm console ownership and prerequisites

In [Firebase Console](https://console.firebase.google.com/), choose **reporeview-e7ca4** and check:

- **Project settings → General**: the project ID is exactly `reporeview-e7ca4`.
- **Usage and billing**: project owner has enabled the **Blaze** plan needed for deployment; set budget alerts and spending controls appropriate to the project. Budget alerts alone are not hard spending limits.
- **Build → Functions**: inspect any already deployed functions, their region/generation and project. Record existing names before changing anything.
- **Build → Firestore Database → Rules**: back up the current published rules before replacing them with the version in GitHub.
- **Authentication → Users**: ensure authorized staff accounts exist. The functions resolve staff recipients through Firebase Auth; if those accounts do not exist in this project, staff notifications will not be delivered.
- If prompted to enable Google Cloud APIs (Cloud Run, Cloud Build, Eventarc, Artifact Registry, Pub/Sub), review those prompts and proceed only with project-owner authorization.

Avoid changing functions' region or deleting existing functions until you have inspected production.

## 2. Prepare your computer

Install Node.js **22** and Git. In a terminal:

```bash
git clone https://github.com/Adminerva-Org/Adminerva.git
cd Adminerva
git checkout main
git pull --ff-only

node --version
npm --version
npm install --global firebase-tools
firebase --version
firebase login
firebase projects:list
```

Verify that `reporeview-e7ca4` appears in `firebase projects:list`. **Do not share login tokens, credential files, or billing information.** Run all subsequent Firebase commands from the repository root (the folder containing `firebase.json`).

Before deploying:

```bash
npm --prefix functions install
npm --prefix functions run check
firebase functions:list --project reporeview-e7ca4
```

`functions:check` is a syntax-only safeguard, not a replacement for permission or trigger tests. The deploy manifest also invokes `npm --prefix "$RESOURCE_DIR" run check` automatically before a Functions deployment.

## 3. Test safely with emulators

The existing GitHub Actions workflow already runs syntax checks and Firebase Rules emulator tests. You can additionally start local Functions and database emulators without writing to production:

```bash
firebase emulators:start --only auth,firestore,functions --project demo-adminerva-local
```

Use **demo-adminerva-local** for testing, not the live project ID. You may need Java to run the Firestore emulator. Testing with a demo project avoids contacting live services. Do not test production triggers by inserting fabricated students' grades or assessment evidence.

## 4. Production deployment — only after authorization

**This step modifies production Firebase services.** Check the project ID twice, ensure that the test suite passes, and schedule the update when students are not submitting work. The Firebase CLI may ask for approval to delete or replace existing functions; do not approve deletions without reviewing the list.

Security Rules: publish the version in this repository, after comparing the console's existing rules and taking a backup.

```bash
firebase deploy --only firestore:rules --project reporeview-e7ca4
```

Cloud Functions: deploy in two small batches to reduce Cloud Build quota failures. Each batch uses the same `functions/index.js` source, but only updates the named functions:

```bash
firebase deploy --only functions:issueOpened,functions:issueStatusUpdated,functions:issueCommentAdded,functions:submissionReceived,functions:assessmentAssigned,functions:assessmentCreated --project reporeview-e7ca4
```

```bash
firebase deploy --only functions:commitReclaimRequested,functions:assessmentEvidenceSubmitted,functions:assessmentEvidenceUpdated,functions:gradingNeedsReview,functions:gradePublished,functions:gradeCreatedPublished,functions:gradeCorrection --project reporeview-e7ca4
```

All 13 deployed functions should then appear under:

```bash
firebase functions:list --project reporeview-e7ca4
firebase functions:log --project reporeview-e7ca4
```

The first deployment of second-generation triggers can require API enablement and several minutes of provisioning. If deployment fails, save the *non-secret error message* and confirm whether the affected function is still listed before retrying. Do not assume a partial deploy completed the entire batch.

## 5. Role-based production smoke tests

Use controlled test accounts and **non-grade-changing** sample data:

1. **Student:** see only assigned assessment and their own submitted evidence; cannot read another student's private evidence or teacher-only grading configuration.
2. **Teacher:** view the correct section's V2 assessment and incoming evidence; discover older historical commits if needed; inspect a selected checkpoint and approve it after reviewing it.
3. **Administrator:** receive an attribution-reclaim notification and resolve a synthetic reclaim conflict, producing an audit record.
4. **Notification verification:** new assessment deployment should notify only students assigned to the relevant section; new evidence should notify staff; **read/unread history** should remain available after the session.
5. **Grading:** test **manual** grading against an approved checkpoint. Do not publish a grade as part of the smoke test. Automatic V2 grading against a mutable repository HEAD is intentionally paused.

In the [Firebase Console](https://console.firebase.google.com/) inspect **Functions** status and logs for errors, and Firestore Rules for the correct published version.

**Only after the checks pass:** create and deploy **Q3 Mini PETA 1 — Mobile App UI Prototype** in Assessment Studio using the approved 20-point, XML-first rubric. Do not require Java backend logic, Firebase integration, arrays or full CRUD for this task.

## If something goes wrong

- **Permission denied:** confirm the logged-in Google account is authorized to deploy to `reporeview-e7ca4` and has required IAM permissions.
- **Billing/API error:** project owner should review Blaze billing and enabled Google Cloud APIs. Do not share payment details.
- **Functions don't appear:** check `firebase functions:list`, the deployment output, and the Functions logs. GitHub Pages status is not proof.
- **No staff notifications:** confirm the staff accounts used in `functions/index.js` exist in Firebase Authentication for the deployed project.
- **Rules reject expected writes:** check actual production rules and emulator coverage before editing or loosening permissions.
- **Previously deployed functions flagged for deletion:** cancel the deletion prompt and reconcile the deployed names and regions with the source. Never delete existing services just to silence a CLI warning.

Official references: [Firebase CLI](https://firebase.google.com/docs/cli), [Cloud Functions deployment](https://firebase.google.com/docs/functions/manage-functions), [Security Rules deployment](https://firebase.google.com/docs/rules/manage-deploy), [Emulators](https://firebase.google.com/docs/emulator-suite/install_and_configure).
