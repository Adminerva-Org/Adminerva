# Adminerva 4.0 — MCS legacy mirror controlled runbook

**Status:** implementation only. This runbook does not authorize a production migration.

The owner has confirmed that all current legacy Adminerva records belong to the Manila Cathedral School pilot and no other school's records are mixed into the legacy collections. The raw 3.x mirror destination is therefore `schools/mcs-manila/legacy_roots/...`. A mirror is **not** a canonical V4 transform and does not grant a user access.

## Non-negotiable boundaries

The mirror tooling may create only records whose dry-run decision is `eligible_for_approved_mirror`. It never copies identity/platform/secret roots, never changes a source record, never overwrites a destination, never creates memberships or roles, and never converts a legacy grade/evidence/lesson directly into a canonical V4 record.

The current Firestore-trigger review shows existing triggers use exact legacy top-level document patterns (for example `students/{studentId}`, `issues/{issueId}`, `assessment_evidence/{evidenceId}`, and `student_grades/{gradeId}`). The legacy mirror path does not match those patterns. This observation must be rechecked immediately before an actual cutover because trigger definitions may change.

## Review sequence

1. Capture and independently verify the approved backup/export. Record its location and recovery owner outside the repository.
2. Generate a fresh complete dry-run ledger with `mcs-migration-dryrun.js`. The ledger must not be truncated, must have no unknown roots, and must have zero school/destination conflicts.
3. Create a review template with `mcs-migration-approval-template.js`. The template stores the SHA-256 of the **exact ledger bytes**.
4. Review the excluded identity/platform/manual-review records separately. The mirror phase must not be treated as account reconciliation or V4 admission.
5. Re-review deployed Firestore triggers and the rollback procedure. Only then fill `approvedBy`, `approvedAt`, review notes and every acknowledgement in the approval file.
6. Run `mcs-migration-apply.js` **without** `--apply` first. This performs a live source/destination hash preflight and creates a restricted receipt. A blocker means stop; do not edit the ledger to bypass it.
7. For an approved write window, use a small staged `--max-writes` batch. Write mode additionally requires the exact `ADMINERVA_MCS_MIRROR_WRITE=YES_I_APPROVE_MCS_LEGACY_MIRROR` environment acknowledgement.
8. Each target is created transactionally only after the source digest still equals the approved ledger digest. An already-identical target is accepted as an idempotent retry. A changed source or conflicting target stops the run.
9. Repeat staged runs until the receipt reports `complete: true`. Preserve every restricted receipt with the migration change record.
10. Generate a new post-copy dry-run ledger and reconcile counts/digests. Do not begin canonical V4 transforms until the mirror reconciliation is complete.

## Example command shapes

These examples deliberately omit credentials and actual secure paths.

```sh
cd functions

node mcs-migration-dryrun.js \
  --output=/restricted/mcs-dryrun.json

node mcs-migration-approval-template.js \
  --ledger=/restricted/mcs-dryrun.json \
  --output=/restricted/mcs-approval.json

# Preflight only; performs no writes.
node mcs-migration-apply.js \
  --ledger=/restricted/mcs-dryrun.json \
  --approval=/restricted/mcs-approval.json \
  --receipt=/restricted/mcs-preflight-receipt.json

# Write form. Run only in an explicitly approved migration window.
ADMINERVA_MCS_MIRROR_WRITE=YES_I_APPROVE_MCS_LEGACY_MIRROR \
node mcs-migration-apply.js --apply --max-writes=250 \
  --ledger=/restricted/mcs-dryrun.json \
  --approval=/restricted/mcs-approval.json \
  --receipt=/restricted/mcs-apply-receipt-001.json
```

A completed mirror still leaves separate work for verified identity/person mapping, memberships, academic offerings/enrollments, assessment ownership, canonical Studio/GitHub evidence, Gradebook publication history, teacher lesson/presentation resources, practice data, notifications, and any future school file storage.
