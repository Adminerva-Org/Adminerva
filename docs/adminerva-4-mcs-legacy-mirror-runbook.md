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

## Canonical migration stages after the legacy mirror

After the mirror reconciliation is complete, generate and review the canonical stages in dependency order. Each planner is read-only; each approval file is bound to the exact plan bytes; each apply engine defaults to preflight and requires its stage-specific write acknowledgement before `--apply`.

1. Canonical foundation: people, student/teacher memberships, academic catalog and course offerings.
2. Academic access: active/historical student enrollments and teacher-course assignments.
3. Assessments: teacher-owned blueprints and reviewed deployments.
4. Evidence and grades: immutable Studio/GitHub evidence plus published/draft grade history as supported by the reviewed source.
5. Student repository configuration: course-scoped durable GitHub repository URL/username only. **Legacy OAuth tokens are never migrated.**
6. Planning support: private reference folders/documents and teacher timetables.
7. Planning resources: private lesson plans and presentations with preserved revision history.
8. Practice: verified progress, current-season state and approved historical archive.

The student-repository stage is now executable through `mcs-canonical-student-repositories-apply.js`. It is create-only, requires an active canonical student identity plus active enrollment/offering, emits no notifications and refuses any OAuth credential migration.

Example preflight/write shapes:

```sh
# Preflight only.
node mcs-canonical-student-repositories-apply.js \
  --plan=/restricted/mcs-student-repositories-plan.json \
  --approval=/restricted/mcs-student-repositories-approval.json \
  --receipt=/restricted/mcs-student-repositories-preflight.json

# Write only in an approved migration window.
ADMINERVA_MCS_STUDENT_REPOSITORY_WRITE=YES_I_APPROVE_MCS_CANONICAL_STUDENT_REPOSITORIES \
node mcs-canonical-student-repositories-apply.js --apply --max-units=50 \
  --plan=/restricted/mcs-student-repositories-plan.json \
  --approval=/restricted/mcs-student-repositories-approval.json \
  --receipt=/restricted/mcs-student-repositories-apply-001.json
```

Every stage receipt must be preserved and reconciled with the approved plan before the next dependent stage is treated as complete.

## Restricted cutover operator packet

The migration scripts do not substitute for the real MCS backup, identity review, policy decisions or rollback rehearsal. Once the legacy mirror is reconciled and the current identity-candidate report exists, create a local restricted operator packet:

```sh
node mcs-cutover-operator-template.js \
  --ledger=/restricted/mcs-dryrun.json \
  --reconciliation=/restricted/mcs-mirror-reconciliation.json \
  --identity=/restricted/mcs-identity-candidates.json \
  --output=/restricted/mcs-cutover-operator.json
```

The generated packet is deliberately **unapproved**. Complete it only from reviewed operational evidence. It records the protected backup reference/checksum and recovery owner, identity-review disposition, the school-shared planning/reference policy decision, receipt hashes for every canonical migration stage, the platform-owner decision-record reference, and the rollback rehearsal.

After those fields have been independently completed, validate the packet offline:

```sh
node mcs-cutover-operator-validate.js \
  --packet=/restricted/mcs-cutover-operator.json \
  --output=/restricted/mcs-cutover-validation.json
```

A validation result of `ready: true` means only that the operator packet is structurally complete. It does **not** enable `v4_only`, deploy Firebase, grant school roles, or authorize production writes. Live school cutover readiness and the explicit Platform Owner cutover action remain separate gates.

## MCS owner decision record

Before technical cutover readiness can pass, the Platform Owner Console must contain a decision record bound to the currently designated first MCS school administrator. The record requires controlled references for institutional/data authority, the approved academic calendar, privacy, retention and backup/recovery policy; the data-steward role; and explicit `approved` or `disabled` decisions for School AI and external repository/GitHub integration.

Do not infer these values from legacy email domains, historical administrator accounts or existing data. The first school administrator must be an existing verified active Firebase identity deliberately granted `school_admin`. Changing that first-admin binding makes the old decision record stale and blocks cutover readiness until reviewed again.

