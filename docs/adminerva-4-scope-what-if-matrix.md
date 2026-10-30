# Adminerva 4.0 — cross-school what-if matrix, workflow invariants and release acceptance

Status: **planning / design**, not automated evidence of implementation. These scenarios are mandatory design inputs, not a claim every scenario has been tested.

Severity: **P0** means release blocker (privacy/authorization/data loss/grade corruption); **P1** means major functional/accessibility breakdown; **P2** means recoverable usability defect. Every P0 gets a deterministic server-side acceptance test, plus one representative browser flow where appropriate.

## Critical invariants

**I1 Tenant boundary:** For resource R with schoolId S, a read, write, export, list, notification target, file, AI request or administrative command never uses another school, unless an explicit scoped owner support grant is verified and audited. User-submitted schoolId cannot create permissions.

**I2 Single-school simplicity:** Zero active memberships = no school private access. Exactly one active verified school = automatically choose it and **no school switcher anywhere in the application**. More than one = accessible picker. Multiple roles/classes in one school do not increase the school count.

**I3 MCS continuity:** Verified pre-V4 historical MCS records retain identity, immutable evidence revisions, grades and publication status. No implicit legacy access to unknown people/documents. No duplicate grading/notification events during migration.

**I4 Reviewer integrity:** Grade publication references same school, student, assessment/course, approved reviewed evidence revision and authorized staff grant; reject stale, cross-school and ambiguous matches. No client-only grade authority.

**I5 Consistent switch:** One selected verified school and role at a time. Pending actions are scoped to origin and cannot replay after switching; render no stale private record from another scope.

**I6 Recoverable failure:** Network, storage, quota, emulator or migration failure must not falsely claim success, silently retry a destructive operation, discard unsaved work or downgrade permissions.

**I7 Audit & privacy:** Privileged role changes, support access, exports, grade corrections, school suspend/archive and migrations produce reasoned audit records. No private school content in platform-wide analytics by default.

## A. Membership, roles and school selection

| ID | Priority | What if? | Expected behavior / layer |
| --- | --- | --- | --- |
| A01 | P0 | Existing legitimate MCS student has one verified school | Auto-route to MCS student home; selector absent; server checks membership |
| A02 | P0 | User with no membership signs in, with MCS as pilot | Remain guest/access-request only; **never** auto-admit to MCS |
| A03 | P0 | User changes `?school=mcs-manila` or local storage to unauthorized school | Auth/scope guard and backend refuse; no private records rendered |
| A04 | P0 | School B school-admin tries to read MCS roster/grades | Firestore/Function/Storage deny; no platform-owner escalation |
| A05 | P0 | Teacher teaches at two schools with same `11-A` | Queries/gradebook/notifications contain only verified active school |
| A06 | P0 | Multi-role user teacher in MCS, student in B | Effective role is computed within selected school; never union grants |
| A07 | P0 | Teacher assignment is revoked while review modal open | Server denies draft/save/publish; old snapshot remains, UI moves to safe state |
| A08 | P0 | School administrator is deactivated during roster import | In-flight privileged updates fail after current grant recheck; audit partial import |
| A09 | P1 | User has one school + two roles | No school selector; only useful authorized role/workspace selector |
| A10 | P1 | User has two school memberships but one suspended | Only active school counted; selector hidden if one eligible |
| A11 | P1 | User loses first school after browser reload | If one remains, auto-enter; if none, show request/recovery; no old cache |
| A12 | P1 | Membership service returns 503 | Neutral loading/retry, no default teacher role, no stale school data |
| A13 | P1 | User bookmarked School B teacher page then only has MCS | Safe redirect/recovery; never reinterpret B record ID as MCS |
| A14 | P1 | Site offline with cached old role/selection | Offline local drafts if permitted, but no privileged writes or false verified access |
| A15 | P1 | 20 eligible school memberships | Searchable keyboard/touch picker, school name + role/status; paginated if necessary |
| A16 | P1 | Platform owner has no school membership | Owner Console works; no automatic view of school-private learner data |

## B. Legacy MCS data and migration

| ID | Priority | What if? | Expected behavior / layer |
| --- | --- | --- | --- |
| B01 | P0 | Historic grade points differ after copy | Reconciliation blocks release; original immutable version remains authoritative |
| B02 | P0 | Evidence revisions and grade publication live in different path generations | Block publication until both school-scoped references are reconciled |
| B03 | P0 | Legacy row lacks provenance, seems to belong to another institution | Quarantine/owner review; cannot silently attach to MCS |
| B04 | P0 | Student email maps to several old records | Explicit verified match and enrollment; do not merge by email/name alone |
| B05 | P0 | Migration retries after partial copy | Idempotent stable destination ID, compare digest, no double grade/notification |
| B06 | P0 | Source row changes between inventory and copy | Re-read version; record conflict; copy only approved new revision |
| B07 | P0 | Cloud Function onCreate fires for migrated student submission/grade | Migration marker suppresses new student alerts and automatic grade effects |
| B08 | P0 | New-path writes began but rollback wants old paths | School put in read-only; reconcile new deltas; never restore old writes blindly |
| B09 | P0 | Unmigrated record is requested by School B user | Deny, even if record ID matches a valid B record |
| B10 | P0 | Legacy original teacher has special email fallback | Bridge only for verified MCS records; remove once new scoped grant validated |
| B11 | P1 | Archived school-year data is not in active catalog | Preserve historical relationships and view under past-year filter |
| B12 | P1 | Personal local project is mistakenly treated as school assignment | Keep personal sandbox separate until user explicitly submits project |
| B13 | P1 | Large document snapshot exceeds new storage budget | Preserve original; migration report and upgrade plan; no truncation |
| B14 | P1 | An orphan historical grade has no assessment doc | Flag exception; read-only historic view only if ownership verified, not silent regrade |

## C. Academic management and roles

| ID | Priority | What if? | Expected behavior / layer |
| --- | --- | --- | --- |
| C01 | P0 | School B uses same program/subject/section names as MCS | Namespaced stable IDs; no class or student collision |
| C02 | P0 | MCS school admin attempts to grant Platform Administrator | Server denies; only owner-controlled grant path |
| C03 | P0 | Teacher only assigned `Java` in `11-A` tries grading `Python` same class | Subject/offering grant required, not section string alone |
| C04 | P0 | Student is transferred into new school | Historical grades stay old school; only approved transcript export/import transfers data |
| C05 | P0 | School suspends teacher account while another tab is open | Writes denied after server-side membership revocation; UI no private refresh |
| C06 | P1 | Two school admins rename section during assignment deployment | Stable section ID retains relations; display name updates, no retroactive grade loss |
| C07 | P1 | Academic year changes while classes still active | Old year archived, not modified; new offerings for new year |
| C08 | P1 | New teacher invitation sent twice | Idempotent pending invitation; do not create duplicate teacher grants |
| C09 | P1 | School admin has two school appointments | Explicit picker, school-specific settings/roster; no merged admin panel |
| C10 | P1 | Wrong-school request to update AI policy | Reject and audit; no impact on other schools |

## D. Assignments, Studio, review and Gradebook

| ID | Priority | What if? | Expected behavior / layer |
| --- | --- | --- | --- |
| D01 | P0 | Student edits project after submitting to MCS | Teacher sees immutable frozen revision; new project edits do not mutate submitted code |
| D02 | P0 | Student submits from MCS editor to School B assessment ID | Backend rejects mismatched school/student/enrollment/task |
| D03 | P0 | Student has open MCS submission tab and switches school B | Block/cancel old operation, keep local draft under MCS key only |
| D04 | P0 | Teacher sees stale submission after student resubmitted | Reject outdated review and grade publish; prompt refresh exact revision |
| D05 | P0 | Teacher accidentally selects School B student when in MCS | Selector/results restrict to current MCS authorized offering; forged submission denied |
| D06 | P0 | Teacher edits a published grade without explicit unpublish/correction | Server rejects; original published grade and audit preserved |
| D07 | P0 | Reviewer grade batch contains two schools | Entire mixed-scope batch denied before any writes |
| D08 | P0 | Student tries reading unpublished teacher AI feedback | Firestore denies; only published feedback visible |
| D09 | P0 | GitHub commit SHA identical in two schools | Claims, conflicts and approvals key by school + assessment/repo + student; no leakage |
| D10 | P0 | Teacher grades commit claimed by another student without verified decision | Existing attribution approval/review required; no automatic credit |
| D11 | P1 | Teacher deploys identical task to same MCS section twice | Idempotent deployment or prompt to edit schedule |
| D12 | P1 | Student offline at deadline, clicks Submit | Never claim submitted; retain draft, explain server time gate |
| D13 | P1 | Student has very large Studio project/database | Explain bound, preserve project, offer safe ZIP export; never create truncated submission |
| D14 | P1 | Studio practical exam restrictions bypassed through another window | Explicitly deter only; no automatic accusation/proctoring claim; server still checks deadline/owner |
| D15 | P1 | Teacher's AI provider becomes unavailable | Manual grading/review continues; no invented automated results |
| D16 | P1 | Teacher accidentally grades archived term | Warning/role check; term-specific correction workflow, no silently editing historic grade |
| D17 | P1 | Student lacks GitHub account for Studio task | Studio submission works without GitHub, consistent existing 3.0 behavior |
| D18 | P1 | Auto checker gives conflicting assessment feedback | Teacher decides; provenance visible; save only reviewed private draft until publication |

## E. Files, Studio projects, personal cache and integrations

| ID | Priority | What if? | Expected behavior / layer |
| --- | --- | --- | --- |
| E01 | P0 | School B user guesses `schools/mcs-manila/files/...` | Storage rules/server signed download refuse; no public file URL |
| E02 | P0 | Student uploads new file to MCS then switches to B mid-transfer | Upload remains MCS-owned/cancels cleanly; never attaches B metadata |
| E03 | P0 | Tenant-admin changes storage object `schoolId` metadata | Server checks immutable metadata and path; deny ownership reassignment |
| E04 | P0 | Teacher shares private library document with another school | Denied unless explicit audited export/import with separate copy and rights |
| E05 | P0 | School AI key accidentally returned in school settings response | Secrets never in client JSON/log; fail code review/security check |
| E06 | P0 | Cloud-save queue from MCS fires after selecting B | Reject with context epoch/scope; never rebase write into B |
| E07 | P1 | SQL update violates primary key in Studio | Reject atomically, keep project data; preserve existing 3.0 behavior |
| E08 | P1 | ZIP import contains path traversal/too many files | Reject before mutation, explain limit and preserve undo |
| E09 | P1 | Browser local quota fills during project save | Retain in-memory work, show recovery/export option; don't claim saved |
| E10 | P1 | School file/AI quota is exhausted | Show school-specific status and retry path; other schools unaffected |
| E11 | P1 | Shared computer switches account, previous school caches persist | Clear sensitive views/work, use UID+school keys, validate on restore |
| E12 | P1 | Export includes school-specific annotations or private teacher notes | Generate only explicitly authorized fields with audited reason and recipient |

## F. Notification, analytics, privacy, lifecycle and platform provisioner

| ID | Priority | What if? | Expected behavior / layer |
| --- | --- | --- | --- |
| F01 | P0 | MCS notification delivered to School B teacher because same section label | Generate under school+offering grant; only MCS recipients |
| F02 | P0 | Notification link refers to school the user lost access to | Show safe no-access; never reveal title, grade, file or student details |
| F03 | P0 | Analytics reads all schools due to collection-group query | Reject missing explicit school authorization, partition per school and student consent |
| F04 | P0 | Platform admin opens raw school private activity data without support grant | Forbidden by default; support request logged/approved/expiring |
| F05 | P0 | School suspension occurs during a grading batch | Stop future school writes; preserve completed audit, show partial status and recovery |
| F06 | P0 | School provisioner fails at step 4 of 7 | Remain non-active, idempotent retry from durable job state, never public half-tenant |
| F07 | P0 | Platform admin starts school deletion while backups incomplete | Refuse; require separate legal retention/export approval and recovery capability |
| F08 | P1 | Two tabs read same school invitation at same time | Single atomic acceptance, resulting membership not duplicated |
| F09 | P1 | Device push generated for multiple-school user | Tenant-labeled where privacy-safe; target validated on opening; no sensitive preview |
| F10 | P1 | Browser gets update mid-tenant migration | Old client gets maintenance/compatible read-only mode, not split reads or corrupt writes |
| F11 | P1 | School status becomes archived, old help deep link used | Preserve safe historical access by policy; no active task mutations |
| F12 | P1 | Global release notes discuss teacher AI grading change | Affected student receives disclosure regardless of teacher-only UI change |
| F13 | P1 | Mobile modal is taller than viewport / keyboard covers submit | Scrollable modal, safe area and visible action; no hidden close button |
| F14 | P1 | User switches school with unsaved grade/Studio local data | Warn with destination and recoverable options; no silent discard |
| F15 | P2 | One-school user sees empty selector area | Treat as UI regression; remove unused slot entirely |
| F16 | P2 | Mobile dropdown long school name truncates | Accessible full name via text/tooltip and two-line menu row, usable at 320 px |

## G. Test roles and data fixture contract

Fixture schools:
- `mcs-manila` with **synthetic only** student/teacher/admin test records, curriculum and V2/V3 assessment/Gradebook chain, plus an inventory of real legacy records for read-only reconciliation.
- `school-b-fixture` is an empty/new synthetic school in the emulator (never mix with production MCS data).
- `school-c-fixture` optional for switching/search edge cases.

Fixture identities:
- `guest` no verified school.
- `mcs-student-1` and `mcs-student-2`: student A vs B reads.
- `b-student`: same section name as MCS student.
- `mcs-teacher-java`: Java in `11-A` only, cannot grade another subject.
- `mcs-teacher-multi`: teacher MCS and B with independent courses, selector visible.
- `mcs-school-admin`: one school, selector absent.
- `dual-school-admin`: school admin of both, selector visible.
- `owner`: platform operator with zero ordinary school memberships.
- `revoked-account`: membership/assignment removed after session start.

Proposed automated gates:
1. Rules Emulator: read/write/query/subcollection/collection-group, storage object paths and nested grade publication restrictions; assert denial when schoolId differs or resource is not assigned.
2. Functions unit/emulator: platform provisioner idempotency; student/teacher role revocation; school AI limits and no secret exposure; notification recipient scoping; migration marker prevents trigger storms.
3. Pure helpers: `eligibleSchoolCount`, single-school selection, last selection validity, active school+role epoch, guard on offline stale state, permission matrices, scope-bound key generation.
4. Mobile component tests: no selector for zero/one memberships; switcher discoverable only for 2+; school name in notification when 2+; safe 320 px scroll, modal focus, no extra vertical toolbar.
5. MCS migration dry-run: sample every affected collection+subcollection, hash match and deep link resolution, no lost grade history or silent publish.
6. One authorized end-to-end browser scenario each for MCS student, teacher, school admin, platform owner and cross-school teacher, including submitted vs revised grade.
7. Deployment checks: compatible rules/Storage and Functions before enabling V4 routes, gate incomplete provisioned tenant, version and announcement last.

## H. Release cutover and stop conditions

1. Implement and deploy compatible Firestore **and Storage** rules, Function APIs, tenant registry and owner grants. Keep existing MCS 3.0 traffic on legacy paths until cutover. Validate that old paths do not grant access to other tenants.
2. Perform verified MCS read-only inventory, trusted legacy mapping approvals, target copy, nested integrity checks, trigger suppression and academic history reconciliation.
3. Validate effective role, school membership, UI selector counts, all P0 cross-school checks, and one critical V2/V3 grading lifecycle. Block release on any missing critical historical grade/evidence or cross-tenant access.
4. Controlled short read-only cutover for MCS; switch one school routing generation atomically, clear stale clients and service-worker caches, finish pending grades correctly and re-open writes only after verification.
5. Run focused 320–390 px usability checks for Student Studio, Assessment Studio, Gradebook, School Admin and Owner Console. Fix severe blocked actions or unsafe modals.
6. Promote new 4.0 source and deploy Pages only after backend and verified data are ready; publish `site-release.json` and `patch-history.json` only after live deployment completes.
7. Observe school-specific errors/denials/storage costs. Keep non-destructive rollback: read-only freeze, reconcile post-cutover writes, restore verified source. Never downgrade rules to public access during incident response.

**Release-blocking issues:** any cross-school private data read/write; role escalation; MCS historical grade/evidence loss; publication mismatch; unscoped Cloud Function/Storage permission; failed or incomplete migration ledger; inability to recover from interrupted cutover; any selector exposing unauthorized school name/identity data.

**Not a release gate:** exhaustive pixel perfection on all combinations, complete implementation of future SIS/finance modules, automatic school onboarding, tenant billing or physical database separation (unless the latter is explicitly required by onboarding policy).
