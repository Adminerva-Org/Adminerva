# Adminerva 4.0 — implementation tracker (Assessment Workflow Review)

**Updated:** 2026-10-31  
**Development:** draft PR #113, feature branch `feat/adminerva-4-verified-tenant-foundation`  
**Architecture:** draft PR #103, issues #100 and #102–#112.  
**Production:** Adminerva 3.0.0 continues to use legacy paths. **No live MCS records migrated, no deployment made.**

## Pilot workspaces now in this branch

- `owner-schools.html` + `js/core/owner-school-registry.mjs`: owner-only draft provisioning, reviewed admin grant, readiness attestation and suspension. No site-wide owner role is inferred from legacy email.
- `people-access.html` + `js/core/people-access.mjs`: mobile-first school-admin People & Access overview, person records, pending invite creation and shareable verification links.
- `join-school.html` + `js/core/school-invitation.mjs`: verified account acceptance of school/role-specific invitations (7-day expiry, safe renewal by school admin); pilot routing is separate from legacy 3.0 student/teacher access.
- `teacher-assessment-library.html` + `js/repo-review/teacher-assessment-library.mjs`: owned/shared/school-wide blueprint tabs, private creation, owner editing/archive, preview, active same-school teacher picker, audited sharing, recipient-independent copies. These are *blueprints*, not deployed student assessment or Gradebook records.

All four are **opt-in pilot pages**, intentionally not substituted for the existing 3.0 navigation, assessment, directory or grading pages. The pages will not function until compatible Firebase callables, owner grants, active school membership and the separate backend deployment are in place. The new V4 school paths remain unavailable to direct browser Firestore reads/writes by design.

## Delivery and remaining work

| Track | Actual implementation in PR #113 | Remaining before Adminerva 4.0 |
|---|---|---|
| Verified tenant foundation / five roles (#104) | Server verifies email-verified UID, active school state and canonical membership roles; choice of zero/one/multiple schools; new namespace deny rules; owner provisioning service. | Migrate *all* existing Firestore/Functions/Storage paths, user admission, auth guard, account switching, role routes and course grants. Retire email bootstrap only after new owner/teacher grants exist. |
| Legacy MCS pilot (#105) | Safe read-only top-level inventory in `functions/pilot-inventory.js`; candidate classification only. | Authorized provenance map, nested revision/grade evidence inventory, owner-approved ledger, immutable source hashing, controlled migration, side-effect suppression, counts/hashes reconciliation, rollback. |
| Assessment Studio / LMS (#106) | Teacher blueprint creation, owner-only revision-checked edits/archive, selected/school-wide sharing, a verified teacher picker, and owner-private copy using a server callable. | Integrate Assessment Studio UI; tenant-scope deployed tasks, V2/V3 submissions, immutable Studio versions, rubrics, evidence, Gradebook, repository ownership, practice, lessons, slides and class offering rights. |
| School control plane / operations (#107) | Manually create draft, explicitly grant verified school admin, activate only with attestations or suspend with an audit log. | Owner Console UI, onboarding invitation acceptance, AI policy and quotas, file storage rules, analytics and notification isolation, safe role recovery and school backups. |
| Mobile-first (#108) | Optional callable-backed school picker hidden for one school; compact 320 px-ready People & Access pilot page; scope lease to reject stale writes. | Replace global navigation and remaining old pages, class review/Gradebook mobile UX, studio tool menus, modal processing and cache/listener invalidation on every live route. |
| Teacher privacy (#110) | Private creator-owned resource, deliberate teacher audience, server re-verifies school/recipient/grant, audited share changes and clean independent copies. | Existing assessment and lesson migration, share sheet in Assessment Studio, searchable teacher recipient selector, optional coedit/reviewer/publish delegation, owner handover process. |
| User Directory (#111) | New school-only People & Access API and pilot page: directory overview, paginated school people, person creation, pending teacher/student invitations with seven-day expiry, verified invitation acceptance and school-level audit writes. | Separate enrollments and staff offerings, admission verification/acceptance, classes, import preview/CSV/Sheets, export, person details, audit/recovery tabs and safe redirects from `users.html` and `teacher-accounts.html`. |
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

1. Confirm legal/institutional authorization to use the Manila Cathedral School identity and live student/staff/test records; identify which historical records are truly MCS and which are ambiguous or external.
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
