# Evidence editing and review workflow repair — 2026.10.19.4

## Reported failures and root causes

- Evidence concurrency used `JSON.stringify` on whole Firestore maps. Map-property order is not evidence identity; equivalent records could falsely report “Evidence changed.” The new recursive comparison sorts map keys but preserves all field values, array order and timestamp nanoseconds. Real changes still block transactions. Manual grade concurrency comparisons use the same semantic comparison.
- The student picker read evidence only when opening the assessment. A teacher reopening in another session did not update an already-open picker. An owned, server-confirmed query subscription now updates editability live, including first-time submissions with no document. Pending local writes and disconnected cache state cannot masquerade as confirmed server approval. Closing the modal stops the listener.
- Legacy checkpoint approvals may have no independently verified contributions. They cannot safely enable evaluation by assigning every selected/shared commit to the student. A deliberate instructor-only “Revise contribution verification” action now records a fresh audited approval without changing the student's selected commits, checkpoint, submission timestamp or identity. Published grades must be explicitly unpublished first. Old grade drafts become stale because the evidence revision changes.
- The old integrated workspace ran three separate page applications in nested iframes, with two starting only when expanded. The primary review now mounts one shared evidence controller and native inline result panels. The standalone evidence route mounts the same view/controller and remains compatible.

## How to use it

1. Students: keep Project Hub open. After the instructor selects **Reopen evidence for student**, the checkbox/checkpoint controls become editable without reloading. Change the selection and **Resubmit selected evidence**. Reopening alone is not a new student submission or approval.
   For a teacher-discovered historical proposal, the instructor can **Release proposal for student changes** before approval, with a reason and audit. The proposal does not become a real student submission until the student deliberately submits it.
2. Instructors: inspect selected diffs, matching pinned source and attribution. Check only independently verified contributing commits, describe the student's responsibilities, add a review note and confirm inspection. **Verify and approve checkpoint** records approval, not a grade.
3. For an already-approved checkpoint missing individual verification, select **Complete individual verification → Revise contribution verification**, verify the relevant boxes/scope, add a fresh note/confirmation and **Save revised verification**. This does not edit the student's selected evidence or grant credit automatically. Leave all contribution boxes empty when no work is verified and grade manually.
4. **Evaluate** becomes available for an approved checkpoint with verified individual changes. Missing provider setup opens its configuration details; provider failure does not prevent manual grading. Copy suggestions only deliberately, save a private draft, and publish separately. No grades are automatically published or changed by this patch.
5. A real concurrent submission/approval change keeps unsaved verification notes and blocks the stale approval. Use **Reload evidence** after reviewing its discard confirmation. Teacher grade fields are kept separately, and stale system suggestions are invalidated. Close/full refresh also confirms unsaved teacher or verification edits.

## Parallel loading and boundaries

Evidence/diffs/source, group status, checkpoint-history sample and contribution investigation start together through `Promise.all`. Each panel has independent loading/error state; one failed read does not erase other results. One per-review GitHub client deduplicates in-flight responses and limits network concurrency to four. Expanding the accordions does not launch another page or repeat those reads. Close/switch cancels requests; completed older reviews cannot populate the new student's workspace.

The initial history sample is at most 100 pinned commits; absence from that sample is not absence of work. Preserved standalone inspectors remain optional for broader investigation. The source preview retains its 12-file/30-KB limits and explicit coverage warnings. Evaluation retains its stricter evidence limits, separate individual/project scope and teacher-verification requirement. The XML simulator remains a supported subset; this repair does not claim Android runtime parity or change the screenshots' documented XML limitations.

## Permissions and release

I've set up prototype Security Rules to keep the data in Firestore safe. They are designed to be secure for verified instructor re-verification, immutable evidence revisions, unchanged student-selected evidence and protected published grades. However, you should review and verify them before broadly sharing your app. If you'd like, I can help you harden these rules.

The owner approved deploying this repair after checks pass. Deploy matching Firestore rules before the website; no Functions deployment, TTL change, maintenance-policy activation, student-data migration or grade publication is needed. Capture the existing deployed rules and website revision first, verify readback, publish only the tested source and revoke temporary deployment sign-in afterward. Older cached tabs must reload for the repaired controller and semantic comparison.

## Validation

Focused tests cover map-order independence versus real timestamp/field changes, bounded/deduplicated requests, independent panel failures, closed-review suppression, teacher-field preservation and explicit publication. Real local Auth/Firestore browser tests cover an open student's controls changing live after reopening, actual checkbox changes/resubmission, a concurrent resubmission while verification notes are dirty, preloaded accordions causing no extra pinned reads, no nested iframes, legacy revision-zero verification and successful evaluation without any grade write. Permission tests exercise instructor-only re-verification, immutable audits, unchanged selections, verified subsets, published-grade blocking and stale-draft publication rejection. Test identities/source/provider responses are synthetic; no production student record is used to demonstrate these flows.
