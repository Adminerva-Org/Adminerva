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
- `functions/mcs-migration-apply.js` + approval template: reviewed, checksum-locked, no-overwrite legacy mirror preflight/apply engine with explicit write acknowledgement and resumable capped batches.
- `functions/mcs-migration-reconcile.js`: read-only post-copy verification that every approved source still matches its ledger digest and every legacy mirror destination is byte-equivalent at the canonical Firestore value level; emits blockers instead of repairing them.
- `functions/mcs-identity-candidates.js`: read-only verified UID candidate reconciliation for legacy MCS student and staff rows; preserves multiple historical roster rows and never automatically grants roles or rewrites grades.
- `functions/school-academics.js`: school-controlled academic year/term/subject/section catalog, course offerings, separate student enrollments and teacher-course grants; class roster reads constrained by verified assignments. People & Access pilot has corresponding responsive controls.
- `functions/people-directory.js`: active school membership listing and audited non-destructive suspension. A school admin cannot revoke their own or a peer's school-admin grant through this action.
- `functions/school-assessments.js`: teacher-owned blueprint deployment to an assigned offering, frozen rubric and instructions, explicit server window and submission source, idempotent request key; authorized student assignment discovery via linked person and active enrollment.
- `functions/school-studio-projects.js`: bounded school project text-file save and owner-only revision checks.
- `functions/school-studio-submissions.js`: immutable project submission snapshots from saved school projects, owner/student/course/deadline verification, idempotent resubmission receipts, teacher-only frozen-code inspection and formal revision request.
- `functions/school-gradebook.js`: rubric breakdown including awarded vs pending points, teacher-private draft versions, exact current Studio submission hash/revision verification, audited publication and student-only published grade reads.
- `teacher-assessment-library.html`: rubric editor, verified teacher recipient chooser, deployed task tab, assigned-course deployment sheet and retry-safe request key.
- Focused mapping and tenant-selection checks, without claiming full V4 integration acceptance.

**Safety update:** The school-aware GitHub evidence adapter is now implemented with frozen commit selections, teacher verification/approval and school-admin attribution reclaim handling. A scorable rubric is mandatory at deployment. Studio/GitHub revisions requested after the original deadline require explicit reviewed extension handling; academic publication still fails closed against stale evidence.

**Remaining:** finish migration of legacy 3.0 lesson/presentation/practice/admin surfaces and historical V2/V3 records, complete MCS ledger/reconciliation and cutover tooling, then retire compatibility paths. The existing Studio already has a progressive V4 bridge and the dedicated V4 Gradebook/GitHub evidence/reclaim paths are present, but no production Firestore copy or role grant has been executed. Do not present the new callables as deployed features.

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
- The 4.0 notification feed resolves verified school roles, filters school-tagged notices by the active school and preserves school tags in saved notification history. School support issue alerts and commit-attribution notifications now use the tenant-aware visibility path instead of legacy issue metadata. Firestore still allows recipients to update only `readAt` on official notification documents.
- Core V4 assessment notifications are tenant-tagged and idempotent: first deployment → enrolled students; Studio/GitHub submission → owning teacher; GitHub approval/revision and Studio revision → affected student; grade publication/correction → affected student; attribution request → school administrators; attribution decision → affected student. Notification delivery failures never roll back the academic transaction.

## Directory reconciliation and Sheets source — October 31, 2026

- People & Access now exposes a consolidated person detail view showing school membership roles/status, invitation state, enrollments or teaching assignments, and recent school audit history without exposing credentials, grades, evidence or private teacher resources.
- School administrators can export a bounded directory CSV containing person identity/status, account-link state and school role status for reconciliation.
- `functions/school-roster-source.js` adds a server-side Google Sheets roster source limited to `docs.google.com` spreadsheet URLs. It normalizes edit/published links to CSV export, manually validates redirects to Google-controlled hosts, caps responses at 500 KB and rejects HTML/login responses.
- A configured sheet feeds the same server preview and digest-locked People import as uploaded CSV. No OAuth tokens, cookies, Apps Script URLs or arbitrary remote fetches are accepted.
- This adapter remains people-only: it does not silently create school memberships, enroll students into offerings, assign teachers, or change grades. People & Access now provides separate reviewed bulk enrollment and bulk teacher-assignment steps after import.

## School support, V4-only staff fencing and school operations — October 31, 2026

- `functions/school-support.js` and `school-support.html` add a private school support model under `schools/{schoolId}`. Any active school member may create/read/comment on their own report; active school administrators may list and triage reports for that school. Platform ownership alone does not expose private school reports. Administrator status/priority/lock changes use optimistic revisions and audit records.
- School support attachments remain disabled while Cloud Storage is deny-by-default. No base64 screenshot fallback is accepted by the new service.
- Shared navigation, home links, notification deep links and Help routing send verified V4 school members to `school-support.html`; legacy 3.x users and platform-wide legacy administrators retain `issues.html`.
- `school-gradebook.html` is a dedicated tenant-safe V4 grading page containing only the verified assessment/evidence workflow. It does not expose the legacy quarter matrix or global section controls. Teacher library deployments deep-link directly to the matching V4 task.
- V4-only teachers (verified school teacher membership without a legacy `staff_access` teacher grant) can no longer use legacy browser role simulation and are fenced away from non-tenant-safe legacy teacher pages. Their home/navigation shows only the school assessment library, verified Gradebook, reclaim workflow, school support and applicable school administration pages. Existing MCS teachers with a legacy grant keep the compatibility bridge during migration.
- Legacy school-admin bookmarks such as `users.html`, `teacher-accounts.html`, and old section/subject setup pages redirect to the corresponding People & Access or School Administration V4 workspace rather than exposing the old global UI.
- `functions/school-analytics.js` and `school-analytics.html` provide school-admin-only aggregate operational counts for directory, enrollments, teacher assignments, deployments, evidence workflow, grade publication and support workload. No student names, emails, code, repository URLs, scores, diagnostic activity trails, or platform-wide records are returned.

## Canonical MCS migration pipeline — October 31, 2026

The branch now contains a staged, approval-bound canonical migration path in addition to the quarantined legacy mirror. None of these stages have been executed against production.

- `mcs-canonical-foundation-plan.js` → approval template → `mcs-canonical-foundation-apply.js`: reviewed people/account linkage, student/teacher memberships, academic catalog and explicit course offerings. The apply stage is preflight-only unless the exact write acknowledgement is supplied; it cannot grant `school_admin` or infer roles from email domains.
- `mcs-canonical-academic-access-plan.js` → approval template → apply engine: explicit per-row approve/exclude review for student enrollments and teacher-course assignments. Historical ended enrollment relationships stay ended; runtime `rowKey(...)` identifiers are used.
- `mcs-canonical-assessment-plan.js` → approval template → apply engine: private teacher-owned blueprint and deployment candidates only when ownership, rubric totals, course offering and current teacher assignment are deterministic. Historical deployment migration suppresses assignment notifications.
- `mcs-canonical-evidence-grade-plan.js` → approval template → apply engine: immutable GitHub evidence versions, Studio snapshots and grades are checksum-verified and bound to an approved student/task/enrollment relationship. Approved writes are candidate-atomic and notification-suppressed.
- Legacy multi-criterion grades that preserved only a final scalar score are represented as `legacy_scalar_v1` with an empty criterion array rather than fabricated point allocations. V4 Gradebook requires explicit score-preserving rubric reconstruction before ordinary editing/correction.
- Historical reviewer identities are preserved as migration provenance, while canonical review authority follows the assessment-owning teacher assigned to the offering.
- Reopened historical evidence past the original due date requires an explicit reviewed extension and retains the normal maximum 30-day extension boundary.
- Focused migration regressions cover deterministic IDs, role restrictions, rubric conversion, offering mapping, Studio snapshot checksum conversion, GitHub evidence digests, scalar-grade preservation and revision-extension bounds.

## Delivery and remaining work

| Track | Actual implementation in PR #113 | Remaining before Adminerva 4.0 |
|---|---|---|
| Verified tenant foundation / five roles (#104) | Server verifies email-verified UID, active school state and canonical membership roles; distinct platform-owner authority; verified auth routing; hidden single-school / conditional multi-school account context; new namespace deny rules and owner provisioning/recovery service. | Migrate the remaining legacy Firestore/Functions/Storage paths and page families, then retire the legacy email/bootstrap compatibility role after owner/teacher grants and MCS membership reconciliation. |
| Legacy MCS pilot (#105) | MCS-only provenance recorded; nested dry-run ledger, canonical hashes, reviewed legacy-mirror apply/reconciliation, plus staged canonical foundation, academic-access, assessment, immutable evidence/Studio and grade planners/approval/apply engines. Historical scalar grades have an explicit compatibility path instead of fabricated rubric data. | Generate the real restricted backup/ledger and identity report, complete operator review artifacts, execute/reconcile each gated stage in a controlled environment, add lesson/presentation/practice transforms, and rehearse rollback before cutover. |
| Assessment Studio / LMS (#106) | Teacher blueprint/deployment, Studio/GitHub evidence, reclaim and dedicated V4 Gradebook are tenant-scoped; canonical MCS assessment/evidence/grade migration contracts now preserve immutable versions and publication state. | Finish legacy lesson/slides/practice migration, remaining Studio UX refinement and lifecycle/handover work, then retire compatibility paths after MCS reconciliation. |
| School control plane / operations (#107) | Owner Console creates drafts, grants verified school admins, activates with attestations, suspends institutions, performs reviewed school-admin recovery, and school AI configuration/usage is tenant-isolated. School support/analytics and assessment/reclaim notifications are tenant-scoped. | School file storage/retention workflow, backup/export operations and fuller onboarding readiness UI. |
| Mobile-first (#108) | Conditional school context plus mobile-ready People & Access, School Support, dedicated V4 Gradebook and School Operations pages; scoped pickers veto unsafe school changes while edits/reviews are active. | Migrate remaining legacy lesson/presentation/practice/admin surfaces, refine Studio compact tools and complete listener/cache invalidation on every live route. |
| Teacher privacy (#110) | Private creator-owned resource, deliberate teacher audience, server re-verifies school/recipient/grant, audited share changes and clean independent copies. | Existing assessment and lesson migration, share sheet in Assessment Studio, searchable teacher recipient selector, optional coedit/reviewer/publish delegation, owner handover process. |
| User Directory (#111) | School-only People & Access API/page: overview, paginated/searchable/filterable people, rename/archive/restore lifecycle, consolidated person detail/audit history, preview-first idempotent CSV import, published Google Sheets CSV source adapter, bounded CSV export, account invitations/acceptance, membership suspend/restore, academic catalog, offerings, single/bulk enrollments, single/bulk teacher assignments, class roster lifecycle and audit writes. | Optional reviewed import-to-course mapping, richer bulk reconciliation reports, and remaining migration conveniences after MCS reconciliation. |
| Release safety (#109) | Core deny-by-default scoped APIs, deny-all Cloud Storage baseline, V4-only teacher legacy-page fence, tenant support/notifications/AI isolation, no production modifications. | Complete remaining legacy surface migration, MCS reconciliation/rollback, focused cross-school denial and continuity checks, then backend-first staged activation and one public 4.0 release. |

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
