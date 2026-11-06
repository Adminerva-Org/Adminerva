# Adminerva 4.0 — MCS controlled cutover runbook

This runbook is for the Manila Cathedral School pilot only. It does not authorize a production migration by itself.

## Preconditions

Before generating the final package:

- the protected legacy backup exists;
- the approved MCS dry-run ledger has been mirrored and reconciled;
- canonical foundation, academic access, assessments, evidence/grades, teacher planning, planning support and Practice migration stages have completed in apply mode;
- migration receipts report no blockers and no remaining units/targets;
- migration-triggered notifications remained suppressed;
- the current school continuity export receipt is fresh;
- the platform-owner cutover-decision record and first MCS school administrator are current.

## Generate the final cutover package

Run from the `functions` directory with Firebase Admin credentials in the approved operator environment:

```sh
npm run cutover:package -- \
  --mirror-receipt=/secure/mcs-mirror-receipt.json \
  --mirror-reconciliation=/secure/mcs-mirror-reconciliation.json \
  --foundation-receipt=/secure/mcs-foundation-receipt.json \
  --academic-access-receipt=/secure/mcs-academic-access-receipt.json \
  --assessment-receipt=/secure/mcs-assessment-receipt.json \
  --evidence-grade-receipt=/secure/mcs-evidence-grade-receipt.json \
  --planning-receipt=/secure/mcs-planning-receipt.json \
  --planning-support-receipt=/secure/mcs-planning-support-receipt.json \
  --practice-receipt=/secure/mcs-practice-receipt.json \
  --output=/secure/mcs-cutover-package.json
```

The command is read-only. It hashes every migration artifact, checks stage completion/safety markers, verifies mirror/reconciliation ledger continuity and re-runs live school cutover readiness. A blocked package exits non-zero and must not be recorded.

## Record the package

In **Platform school registry**:

1. Select `mcs-manila`.
2. Confirm the owner cutover decisions and designated first school administrator are current.
3. Under **MCS cutover package**, select the generated package JSON and enter a review reason.
4. Record the package.

The owner service validates the package structure, artifact schemas/hashes, safety markers and freshness, then re-checks live cutover readiness. Only summary hashes are stored. Student records and migration payloads are not uploaded to the owner console.

A recorded MCS package expires after 24 hours. Regenerate it if configuration or canonical data changes materially before cutover.

## Production activation order

1. Deploy the compatible backend functions and Firestore/rules changes.
2. Keep MCS in `legacy_allowed`.
3. Complete only the focused continuity checks needed for the live pilot: cross-school denial, student assignment/submission, responsible-teacher review/publication and the rollback route.
4. Refresh cutover readiness.
5. In the owner console, confirm continuity backup, migration reconciliation, rollback review and V4 route validation.
6. Enable `v4_only`.
7. Deploy/activate the V4 frontend routing.
8. Confirm the canonical school workflows are being used.
9. Publish the single Adminerva 4.0 release only after activation succeeds.

## Rollback

If cutover behavior is unacceptable, use **Restore legacy compatibility** in the owner console with a recorded reason. This changes MCS back to `legacy_allowed`; it does not delete canonical V4 records or reverse migrated history.

Do not delete the legacy mirror, migration receipts, continuity export or canonical records during the rollback observation window.

## Release boundary

The following are not part of package generation and remain explicit operator actions:

- choosing the first MCS school administrator;
- entering approved academic/policy references and school-level AI/repository decisions;
- running the protected migration stages against production;
- recording the final continuity export;
- deploying backend/rules/frontend;
- switching compatibility mode;
- publishing the public 4.0 release.
