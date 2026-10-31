# Adminerva 4.0 — implementation tracker (Assessment Workflow Review)

**Updated:** 2026-10-31  
**Development:** draft PR #113, feature branch `feat/adminerva-4-verified-tenant-foundation`  
**Architecture:** draft PR #103, issues #100 and #102–#112.  
**Production:** Adminerva 3.0.0 continues to use legacy paths. **Owner confirmed all legacy data are MCS pilot records; no live records migrated, no deployment made.**

## Pilot workspaces now in this branch

- `owner-schools.html` + `js/core/owner-school-registry.mjs`: owner-only draft provisioning, reviewed admin grant, readiness attestation and suspension. No site-wide owner role is inferred from legacy email.
- `people-access.html` + `js/core/people-access.mjs`: mobile-first school-admin People & Access overview, person records, pending invite creation and shareable verification links.
- `join-school.html` + `js/core/school-invitation.mjs`: verified account acceptance of school/role-specific invitations (7-day expiry, safe renewal by school admin); pilot routing is separate from legacy 3.0 student/teacher access.
- `teacher-assessment-library.html` + `js/repo-review/teacher-assessment-library.mjs`: owned/shared/school-wide blueprint tabs, private creation, owner editing/archive, preview, active same-school teacher picker, audited sharing, recipient-independent copies. These are *blueprints*, not deployed student assessment or Gradebook records.

All four are **opt-in pilot pages**, intentionally not substituted for the existing 3.0 navigation, assessment, directory or grading pages. The pages will not function until compatible Firebase callables, owner grants, active school membership and the separate backend deployment are in place. The new V4 school paths remain unavailable to direct browser Firestore reads/writes by design.

## Owner confirmation recorded — October 31, 2026

The product owner confirms that **all existing Adminerva data currently belong to the Manila Cathedral School pilot**, and **no other school's data have been mixed into the legacy collections**. Therefore the controlled migration destination for existing MCS academic records is `schools/mcs-manila/...` by default. This is an origin classification, **not** blanket live account authorization, legal-policy attestation, or permission to execute a production copy.

Do not repeat the mixed-schools question. Retain source document identifiers, exact original evidence versions, saved code projects, grade snapshots/publication states, teacher original authorship and associated subcollection history. A conflicting explicit `schoolId`, unsupported source shape, unknown root or hash mismatch is still flagged instead of overwritten.

## Additional 4.0 backend capabilities implemented (not deployed)

- `functions/mcs-migration-ledger.js`: canonical document digests, legacy-root classification, MCS target path mapping and collision/explicit-school-conflict decisions.
- `functions/mcs-migration-dryrun.js`: read-only, restricted-file inventory of nested Firestore data including evidence/grade revision paths, existing destination comparison and incomplete-inventory blockers.
- `functions/mcs-identity-candidates.js`: read-only verified UID candidate reconciliation for legacy MCS student and staff rows; preserves multiple historical roster rows and never automatically grants roles or rewrites grades.
- `functions/school-academics.js`: school-controlled academic year/term/subject/section catalog, course offerings, separate student enrollments and teacher-course grants; class roster reads constrained by verified assignments. People & Access pilot has corresponding responsive controls.
- `functions/people-directory.js`: active school membership listing and audited non-destructive suspension. A school admin cannot revoke their own or a peer's school-admin grant through this action.
- `functions/school-assessments.js`: teacher-owned blueprint deployment to an assigned offering, frozen rubric and instructions, explicit server window and submission source, idempotent request key; authorized student assignment discovery via linked person and active enrollment.
- `functions/school-studio-projects.js`: bounded school project text-file save and owner-only revision checks.
- `functions/school-studio-submissions.js`: immutable project submission snapshots from saved school projects, owner/student/course/deadline verification, idempotent resubmission receipts, teacher-only frozen-code inspection and formal revision request.
- `functions/school-gradebook.js`: rubric breakdown including awarded vs pending points, teacher-private draft versions, exact current Studio submission hash/revision verification, audited publication and student-only published grade reads.
- `teacher-assessment-library.html`: rubric editor, verified teacher recipient chooser, deployed task tab, assigned-course deployment sheet and retry-safe request key.
- Focused mapping and tenant-selection checks, without claiming full V4 integration acceptance.

**Safety update:** Until the school-aware GitHub evidence adapter is available, the V4 pilot prevents deploying a GitHub-mode task that students could not submit. A scorable rubric is mandatory at deployment. Studio teacher revisions requested after the original deadline require an explicit teacher-selected extension (maximum 30 days); the student resubmission server checks that extension.

**Remaining:** the existing 3.0 Studio IDE must be connected to the new project/submission APIs; the existing Review & Grade and Gradebook interfaces must use the V4 backend; V2 GitHub evidence and attribution reclaim need a tenant-preserving migration; nested production ledger must be generated/reconciled; no Firestore copy or role grant has been executed. Do not present the new callables as deployed features.

## Role, navigation and People & Access integration — October 31, 2026

- `tenantSchools` now returns independently verified `platformAdmin` authority from `platform_admins/{uid}`; platform ownership is no longer inferred from an email, school role or browser state.
- Auth/session routing recognizes a distinct platform-owner presentation role. A platform-owner-only account lands in the institution registry instead of the teacher workspace; legacy 3.0 administrators remain a separate compatibility role during migration.
- The shared navigation exposes Institution Registry only when server-backed platform authority is present. School-admin and teacher workspace access still depends on their school roles.
- A shared account school context is mounted after verified admission. It is hidden for zero/one-school accounts and becomes selectable only for users with multiple active schools. Editor/review pages that already own a scoped school picker show the current school read-only in the account menu to avoid switching underneath unsaved work.
- People & Access now includes school-scoped person name search, type/status filters, rename, archive and restore controls. Person lifecycle remains separate from Firebase identity, school membership, student enrollment and teacher assignment.
- Platform-owner recovery now supports audited school-admin suspension/restoration. The platform service refuses to suspend the last active school administrator for an institution.

## Roster import, School AI and tenant notifications — October 31, 2026

- People & Access now has a preview-first CSV roster importer. It accepts the legacy-friendly `email,firstName,lastName,section` shape plus `displayName`, `kind`, and `externalId`; every row requires an email or external ID for deterministic idempotent matching.
- Import preview is server-validated against the active school. Invalid and duplicate rows block commit. Commit creates **school person records only** with deterministic import IDs and an audit/import ledger; it does not create Firebase identities, memberships, invitations, enrollments, teaching assignments, grades or assessment access. Raw CSV email/section values are not copied into the new person record by this action.
- People & Access and Teacher Assessment Library now use the shared verified auth guard and role-aware navigation rather than functioning as isolated pilot pages.
- School AI was refactored from the legacy global `system_private/school_ai` connection to per-school server-only configuration under `schools/{schoolId}`. AI keys, per-teacher usage, concurrency slots and short-lived result cache are isolated by verified school; only active school administrators can configure a key and only active teachers can generate. The 4.0 client no longer falls back to a personal browser Gemini key.
- The 4.0 notification feed now resolves verified school roles correctly, filters school-tagged notices by the active school and preserves the school tag in saved notification history. Firestore still allows recipients to update only `readAt` on official notification documents.
- Core V4 assessment notifications are now tenant-tagged and idempotent: first deployment → enrolled students; Studio/GitHub submission → owning teacher; GitHub approval/revision and Studio revision → affected student; grade publication/correction → affected student. Notification delivery failures never roll back the academic transaction.

## Delivery and remaining work

| Track | Actual implementation in PR #113 | Remaining before Adminerva 4.0 |
|---|---|---|
| Verified tenant foundation / five roles (#104) | Server verifies email-verified UID, active school state and canonical membership roles; distinct platform-owner authority; verified auth routing; hidden single-school / conditional multi-school account context; new namespace deny rules and owner provisioning/recovery service. | Migrate the remaining legacy Firestore/Functions/Storage paths and page families, then retire the legacy email/bootstrap compatibility role after owner/teacher grants and MCS membership reconciliation. |
| Legacy MCS pilot (#105) | Safe read-only top-level inventory in `functions/pilot-inventory.js`; candidate classification only. | Authorized provenance map, nested revision/grade evidence inventory, owner-approved ledger, immutable source hashing, controlled migration, side-effect suppression, counts/hashes reconciliation, rollback. |
| Assessment Studio / LMS (#106) | Teacher blueprint creation, owner-only revision-checked edits/archive, selected/school-wide sharing, a verified teacher picker, and owner-private copy using a server callable. | Integrate Assessment Studio UI; tenant-scope deployed tasks, V2/V3 submissions, immutable Studio versions, rubrics, evidence, Gradebook, repository ownership, practice, lessons, slides and class offering rights. |
| School control plane / operations (#107) | Owner Console creates drafts, grants verified school admins, activates with attestations, suspends institutions, performs reviewed school-admin recovery, and school AI configuration/usage is tenant-isolated. Core V4 assessment notices are school-tagged. | School file storage rules, full analytics/support notification isolation, backup/export operations and fuller onboarding readiness UI. |
| Mobile-first (#108) | Optional callable-backed school picker hidden for one school; compact 320 px-ready People & Access pilot page; scope lease to reject stale writes. | Replace global navigation and remaining old pages, class review/Gradebook mobile UX, studio tool menus, modal processing and cache/listener invalidation on every live route. |
| Teacher privacy (#110) | Private creator-owned resource, deliberate teacher audience, server re-verifies school/recipient/grant, audited share changes and clean independent copies. | Existing assessment and lesson migration, share sheet in Assessment Studio, searchable teacher recipient selector, optional coedit/reviewer/publish delegation, owner handover process. |
| User Directory (#111) | School-only People & Access API/page: overview, paginated/searchable/filterable people, rename/archive/restore lifecycle, preview-first idempotent CSV people import, account invitations/acceptance, membership suspend/restore, academic catalog, offerings, enrollments, teacher assignments, class roster lifecycle and audit writes. | Google Sheets adapter, export, richer person detail/audit history, bulk enrollment/assignment operations and safe legacy-directory redirects. |
| Release safety (#109) | Core deny-by-default scoped API, no production modifications, targeted selection/authority unit tests. | End-to-end cross-school rule and callable checks, backup/reconciliation, backend-first staged activation, public 4.0 version only after cutover. |

### Verified-school behavior

- 0 memberships: no private school context or selector; invitation/access request required.
- 1 active membership: select automatically, **do not render a school switcher** or reserve navigation space.
- 2+ active memberships: accessible account-level switcher; only server-verified active schools offered.
- Staff role assignments are scoped to the chosen school. Platform-admin identity does not imply membership or access to private school information.
- The browser selector and local cache **never** authorize database operations. All V4 callables recheck school, role and (where applicable) current write-transaction grants.
- Mid-save school switch can be vetoed. Old-school write leases do not become School B writes; state is cleared on verified context change.

### Teacher assessment contract

- Teacher A creates private blueprint (not a student-facing deployment).
- Teacher B cannot browse it because of a shared section or subject.
- A selects B (same-school active teacher) or all school teachers; they gain preview and independent copy, not edit, deploy-the-original, student record access, grade review or publication.
- Recipient's copy is new and private; provenance stores source ID/revision without student or answer-key fields.
- Revocation blocks new source copy/read operations; existing independently copied work survives.
- The 4.0 server implementation is a new assessment **template library** and is not yet wired into live 3.0 Assessment Studio.

### Owner decisions required before **real pilot cutover**, not before engineering

1. **Answered in part:** all current records belong to the MCS pilot, with no other school mixed in (owner confirmation October 31, 2026). Institutional/data processing authority and consent policies still need documentation before a live cutover.
2. Identify and verify the **first MCS School Administrator UID**. Do not grant any role by school email domain or via the legacy bootstrap email.
3. Confirm academic year/term structure, school privacy/data steward/retention and backups, and external AI/repository integration permissions.
4. Decide before onboarding a second actual school if logical Firestore namespace separation is sufficient or physical databases/projects are required.

**Default pending review:** `mcs-manila` is a proposed pilot destination *for verified MCS legacy records only*. Unknown records remain quarantined. AI and school file uploads are disabled until explicit school-level configuration and protected storage exist.

### Cutover order (do not reverse)

1. Approve owner decisions and source provenance; capture backups and complete **read-only** inventory including historical nested revisions and external file pointers.
2. Provision platform owner authority outside the application. Deploy compatible server/membership primitives and rules, without routing legacy operations to new paths.
3. Use synthetic school fixtures to establish school-owner roles, role revocation, resource sharing/copy, user directory and cross-school access denial.
4. Stage idempotent source-to-school mapping with immutable review/evidence/grade history; suppress migration-triggered grade/notification side effects; verify counts and hashes.
5. Route all existing 3.0 feature families to school-aware storage/services; update School Admin, student and teacher views/menus; safely retire legacy access bridge after membership reconciliation.
6. Stage MCS cutover with rollback, School B denial checks, student→teacher→Gradebook continuity and mobile save/recovery checks.
7. Only after backend activation, data reconciliation and frontend deployment, publish the **single** Adminerva 4.0 release.

### Pilot inventory usage

Inside a separately approved environment with Firebase Admin credentials:

```sh
cd functions
ADMINERVA_PILOT_SCHOOL_ID=mcs-manila node pilot-inventory.js --output=/secure-local-path/mcs-inventory.json
```

The output file is created with owner-only file permissions and cannot overwrite an existing file. It contains collection counts and attribution categories, not student names/identifiers. It is **not** a backup, approved migration ledger, or exhaustive inventory of nested evidence/revisions, cloud storage and external services. Running this script was **not** part of PR #113.

### Essential non-happy-path outcomes

- **Wrong school ID, revoked membership, suspended school, copied link:** deny server read/write or share, even when a client menu still shows stale data.
- **Teacher B same class, no share:** private blueprint inaccessible. **Selected share revoked:** future copy denied; B's already independent copy remains.
- **Unverified staff email or owner impersonation:** cannot create an active membership; platform admin role seeded out-of-band.
- **Pending invitation:** no automatic account activation or role grant, and duplicate pending invitations are idempotent.
- **Switch while writing:** complete/block action under the original school; never rebase operation to another school's path.
- **Legacy record without approved provenance:** keep read-only/unmigrated and flag for review; never infer MCS ownership from email/section names.
- **Missing original grade, revision, snapshot or orphan reference:** stop cutover for that record family; never fabricate points, evidence or grades.
- **School AI/storage not configured:** fail closed rather than leaking across institutions or silently using a global credential.
