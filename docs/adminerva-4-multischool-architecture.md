# Adminerva 4.0 — multi-school foundation and five-role authorization

Status: **architecture and implementation plan only**. Nothing here is deployed, and no school records have been migrated. Pilot institution proposed by the product owner: **Manila Cathedral School** (MCS). Pilot key: `mcs-manila`; final allocation must check existing live IDs first.

Related roadmap: [five-role access epic #100](https://github.com/Adminerva-Org/Adminerva/issues/100).


## Agreed requirements for the 4.0 design (October 30, 2026)

- **Legacy pilot by default, with verified provenance:** preserve the existing test/production academic data, grades, revision histories and school memberships by assigning confirmed Manila Cathedral School records to the `mcs-manila` migration destination. This is a **data migration default**, **not a blanket account admission default**; unknown or conflicting legacy records are quarantined. Existing authorized single-school users continue into MCS without an extra selector.
- **School switcher conditional:** count distinct server-verified *active* school memberships. When the count is zero show guest/request access, when one auto-select and hide school switcher completely, when more than one show a compact accessible picker. This applies equally to students, teachers and school admins. Platform Owner Console's School Directory remains available independent of the ordinary school switcher.
- **Mobile-first redesign:** redesign the current workspaces for 320 px upward, reduce unnecessary persistent toolbars, move school switching into the account surface for multi-school users, keep submit/save status visible, touch-friendly file controls, scroll-contained Gradebook/teacher modals and explicit processing/recovery states.
- **Same next release:** implement a coordinated multi-school authorization and schema cutover across all existing features before announcing Adminerva 4.0. Separate feature branches/workstreams may be used internally; production rollouts use compatible backend-first flags and one public major-release record.
- **No production migration in planning:** these agreements are specifications only, not evidence of a completed tenant schema or record transfer.

### Additional required subsystems: teacher ownership, directory and pilot decisions

**Teacher-scoped privacy is separate from school-scoped isolation.** Every author-created assessment blueprint, rubric template, presentation, lesson, teacher file and teaching workspace is **private by default** and belongs to its verified creator/owner. It is NOT automatically visible to other teachers assigned to the same section. The teacher can opt to share with **specific teachers** or **all teachers inside the same school**, with **view and independent copy** as default permissions. Optional coediting and delegated student review/grade publication require independent, explicit server grants. Preserve private teacher resources and school-owned historical student assessment evidence when staff leave.

**Unified User Directory:** one school-aware **People & Access** application replaces disjoint student directory, teacher grants and access requests. Separates global Auth UID, school person identity, school membership/roles, student term enrollment, staff appointment, course offering assignments and invitations. Teachers see only assigned-class rosters and minimal same-school colleague search for deliberate sharing. School Admin sees only that institution; Platform Owner manages school registry and operational metadata only.

**Owner decisions register:** school/data authority, first MCS school admin, verified legacy provenance, actual academic terms, data steward/consent/retention and AI provider policy before live migration. Continue building with synthetic data and conservative defaults while owner inputs are pending.

4. [Teacher-owned private work, specific/school-wide sharing, cloning and co-review](adminerva-4-teacher-ownership-sharing.md) — [implementation track #110](https://github.com/Adminerva-Org/Adminerva/issues/110).
5. [Unified User Directory, roster, admissions, staff and import/exports](adminerva-4-user-directory.md) — [track #111](https://github.com/Adminerva-Org/Adminerva/issues/111).
6. [Owner attention and pilot readiness decision record](adminerva-4-owner-decisions-pilot-readiness.md) — [track #112](https://github.com/Adminerva-Org/Adminerva/issues/112).

### Detailed implementation documents

1. [MCS legacy default, data mapping, controlled migration and one-school hidden switcher](adminerva-4-mcs-legacy-migration.md).
2. [Mobile-first five-role navigation, screen sketches, workflows and interaction contracts](adminerva-4-mobile-first-role-ux.md).
3. [Cross-school what-if scenarios, critical invariants and release acceptance](adminerva-4-scope-what-if-matrix.md).


## 1. Product decision and boundaries

Adminerva is one application used by multiple independently administered schools. Platform administrators manually create and configure the schools. One school must never see another school's private students, grades, teacher drafts, code projects, library, school AI prompts, notifications, usage statistics or files.

**V4.0 delivers all current Adminerva workflows with strict school and role scope.** It does not promise a new accounting, HR, attendance, enrollment payment or student-information-system module; those are later modules built on the same foundation.

Keep one public website, one platform identity entry point and one platform administration control plane. A signed-in identity can hold more than one school membership or one role in a school, but every school operation executes in one explicit, server-verified school context.

**Isolation strategy for V4.0:** use school-scoped Firestore document paths and school-prefixed, access-controlled Cloud Storage paths in the existing Firebase project. This is **logical database isolation, not a physically independent database**. A physical-database adapter and a school `dataLocation` registry field must be included so a future school can move to its own named Firestore database or Firebase project if contractual/legal requirements justify it. Do not advertise physical per-school databases before actually provisioning them.

Why this default: existing source has one default Firestore database, 1,500+ lines of security rules, flat triggers, and dozens of direct flat-path reads. Firebase supports multiple named databases, but the rules and indexes must be deployed for each, and Firestore triggers each bind to one database. Parallel cross-database membership enforcement and school-specific function deployment greatly expand the first migration's failure surface. See official docs: https://firebase.google.com/docs/firestore/manage-databases ; https://firebase.google.com/docs/functions/firestore-events .

**Alternative decision gate before onboarding school #2:** if physically separate Firestore databases are mandatory rather than separate tenant namespaces, stop and switch the storage adapter/provisioning plan before another school's records are accepted. Named databases have service quotas and per-database operational overhead; a completely separate Firebase project offers still stronger infrastructure isolation with more administrative overhead.

## 2. Namespace and identifiers

Platform-owned metadata (not confidential school content):
- `platform_schools/{schoolId}`: immutable ID, verified display name, state (draft/active/suspended/archived), owner-provisioned config, data location, region, branding references, service/policy flags, quotas, createdBy/At, audit revision.
- `platform_users/{uid}`: identity linkage only; no flattened roster or school grade data.
- `platform_users/{uid}/memberships/{schoolId}`: the signed-in user's authorized school choices and membership status; server-managed.
- `platform_admins/{uid}` or an equivalent trusted server-side owner grant: never user-editable and never based solely on client localStorage/email/domain.
- `platform_audit/{eventId}`, `provisioning_jobs/{jobId}`, `system_health/{id}`: restricted to platform operations. Never mix school AI keys or teacher grade drafts here.

School-owned records under `schools/{schoolId}/...`:
- `settings/{recordId}`; `academic_years/{yearId}`; `terms/{termId}`; `programs/{id}`; `subjects/{id}`; `sections/{id}`; `course_offerings/{offeringId}`.
- `memberships/{uid}`: server-managed **authoritative school-local permission record**, including active/disabled state, roles, membership revision and permitted scope; the global membership index is only a school selector.
- `students/{studentId}`, `enrollments/{id}`, `staff_assignments/{id}`, `teachers/{id}`; use stable IDs and explicit student-to-auth UID link. Assignment by course offering/section/subject, not a free-form section name alone.
- `assessments/{assessmentId}`, `assessment_private/{id}`, `assessment_evidence/{id}/revisions/{revision}`, `studio_submissions/{submissionId}/versions/{revision}`, `commit_reclaims/{id}`, `commit_claim_decisions/{id}`, `commit_claim_conflicts/{id}`, `student_grades/{id}`, `grade_revisions/{id}`, `student_submissions/{id}` and other protected grading queues.
- `projects/{id}`, `student_code_projects/{uid}/projects/{id}`, `repositories/{id}`, `playground_snapshots/{id}`, `student_projects/{id}`, repository/evidence link records. Student personal/offline practice work remains separate from school-owned assessment evidence.
- `staff_workspaces/{uid}/{kind}/{id}`, `teacher_materials/{uid}/{kind}/{id}`, `lesson_plans`, `presentations`, `reference_folders`, `libraries`, `schedules`, school catalog, lesson exports, teaching/academic support.
- `practice_*` progress, awards, scores, season leaderboards and packs; `analytics_*`, activity consent/events, monitoring; `issues` and comments; `notification_history`, `notifications`, `push_preferences` and grading alerts where school-owned.
- `school_ai/{config}` and `school_ai_usage` with secrets only on the server (Secret Manager or other privileged configuration service). Individual teacher preference is not a school API key.
- `storage_index/{fileId}` metadata including immutable schoolId, owner, MIME, size, checksum, visibility, retention class, virus-scan state and storage location.

School file objects: `schools/{schoolId}/{category}/{ownerUid}/{fileId}/{safeFilename}` in Cloud Storage, protected by dedicated `storage.rules` (not currently present in the root deployment manifest) or signed, authorized server upload/download endpoints. Never use public long-lived URLs for private learner/teacher data. Prefix confinement is not sufficient without authorizing school membership and ownership; quarantine, object size and content-type checks are required. Storage rules cannot simply be assumed to share Firestore rule state.

Storage adapters: `platformDb`, `schoolDb(context)` / `schoolCollection(context, key)`, `schoolStorage(context)`, `schoolCallable(context, operation)`. Domain services receive a verified context; they do not construct arbitrary Firestore paths, choose Firebase database IDs from URL input, or accept mutable schoolId fields as authority. URL, header and localStorage school selectors are **untrusted requests**, rechecked against membership.

Use compound logical keys for records referenced across scope: `(schoolId, recordId)`. No cross-school deduplication by student's email, section name, public GitHub commit SHA or the same assessment ID. Link global Firebase Auth UID to each school's separate student/person record; one person may be student at one school and teacher at another.

## 3. Roles and permission model

Roles are **not a simple global hierarchy**. A higher platform role does not silently permit browsing or editing student records. Effective permission = authenticated identity + school membership + current school status + role grant + section/course/subject assignment + resource ownership + action + resource state.

| Role | View | Create/change | Forbidden by default |
| --- | --- | --- | --- |
| Guest | public site, Wiki, public tutorials, local demo/practice | anonymous/local non-graded drafts, access request | any private school resource |
| Student | own enrollment, assigned projects/assessments, own evidence, published grades, allowed class practice | own project and permitted submissions/resubmissions, profile preferences | others' data; unpublished draft; teacher roster/export |
| Teacher | explicitly assigned offerings, learners, submissions, teacher materials and relevant analytics | assigned-class tasks, reviewed grade drafts, deliberate grade publication, feedback, lesson plans | other classes or schools, school-wide admission or platform secrets |
| School admin | own-school staff, roster, offerings, school dashboards and audited operations | approve own-school admissions, assign staff, create catalog entries and policies, authorize school-level resources | other schools, platform service secrets, unlogged grade override |
| Platform administrator | school registry, school health/config, onboarding, deployment and audit metadata | provision/suspend school, approve school admin, enforce platform policy, emergency recovery | routine student grades/private files without audited time-limited support authority |

Support **multiple roles per school** and **multiple school memberships per UID**; switching must select one effective school and one role rather than combining privileges across schools. Teacher assignments are scoped by school + academic year/term + section + subject/course offering. School admins may manage roles only within their school. No school admin may assign platform-admin authority. Require reauthentication/MFA for owner-level destructive or sensitive actions when supported.

Role-aware routes, buttons, search, notifications, Wiki, release notes and dashboards follow the same capability service. UI hiding is presentation only; Firestore/Storage rules and every callable enforce read/write/export/approve/publish/delete authorization again. Platform admin view-as should be read-only and audited; any break-glass write requires an explicit grant, expiry, reason and independent audit.

## 4. Workflow/data-dependency inventory and required changes

| Existing feature / paths | Multi-school coupling to fix | Expected V4.0 behavior |
| --- | --- | --- |
| Public site, guest demo, Wiki, PWA, release history | Current pages mostly shared | Global marketing/help remains public; no school data until membership selected; school-specific guide/announcement visible in proper context |
| Sign-in, admissions, students, teachers, legacy hardcoded bootstrap | `staff_access` and `students` are global; email is treated as identity/role | Global UID; explicit invited school membership; school-specific student and staff identities; safe legacy bootstrap migration |
| Role navigation, landing, account settings | `admin`/`superadmin` vs student/teacher, localStorage role cache | Five-role capability-aware menu and separate School Admin vs Platform Console; active school displayed, switcher checks live grant |
| School catalog/programs/sections/subjects | Flat catalog with free-form names, current school-admin all-school list | School scoped catalog, stable IDs, academic year/term, relationship-driven class assignment; records from school A never in B |
| Teacher assignments, timetable and roster | Flat teacher sections and legacy schedule | Teacher has per-school course offering/section/subject/term grants; revocation blocks writes immediately |
| Assessment Studio V2 GitHub and V3 Studio | Flat assessment and evidence paths; assignment by section name | School/course-scoped deployments, permissions, deadlines and immutable rubric/snapshots; no cross-school submission |
| Student assignments, Studio projects, practical exams | Learner resolved globally by email; code projects by UID alone | School-specific assignments and graded project scope; personal scratch work isolated; existing snapshot revision invariants retained |
| Repository management and attribution reclaim | GitHub repo/commit SHA and students may collide globally | Scoping by school+repo+assessment+student, cross-school GitHub connections remain separate, reclaim conflicts cannot leak |
| Teacher review, external evaluation, AI suggestions | Evidence approval and scoring tied to flat student/assessment IDs | Same review/gradebook, school-specific rubric and policy; verified evidence only; no cross-school import, export or evaluation package |
| Gradebook and publication | Flat grades, revisions and publication batches | School-aware grade keys, academic year/term and offering context, current snapshot checks, teacher review, auditable publication/adjustments |
| Lesson planner, slide editor, libraries and exported documents | Teacher private workspaces and shared reference folders | Personal vs school-owned material explicit; school-only sharing, storage, reference library and export metadata |
| Practice courses, XML lab, rankings and seasons | Course content global but scores/leaderboards section-based | Global read-only curriculum templates; progress, consents, class rankings, teacher review and course enrollments per school |
| School AI and teacher integrations | One school AI key, usage limit and global fallback | Separate policy, credentials, approval, quota, provider and usage per school; no prompt/source cross-tenant mixing |
| Notifications, push, issues and helpdesk | UID-only inbox, global issue queries, school-blind targets | User may see own multi-school inbox, each item labeled/checked for school; authorized school switches before opening target; no push leakage |
| Analytics and monitoring | Global events, one special teacher view, `student_access` derived from all students | School-specific consent, analytics snapshots and jobs, aggregated platform operational metrics only (no uncontrolled row-level access) |
| Guest/student/teacher/admin account changes and local persistence | LocalStorage keys usually UID-only, cached roles and connection tokens | Key school+UID+workspace; clear in-memory subscriptions on switch; never expose last school's data when stale/offline |
| File management, ZIP, source snapshots, screenshots and backups | Some projects local or Firestore-only; no school Storage rules | Private per-school file browser, quotas, owner/share metadata, resumable upload, scanning, export and cleanup; legacy file IDs retain references |
| Adminerva releases and patch notes | Broad `admin` role and one release visibility filter | Add school-admin/platform-admin and school-scoped release impact; every affected student receives meaningful grading-policy disclosure |
| Firebase Functions and cron | Trigger patterns and admin queries point to flat collections | Each event bound to school path/context; server checks school grants and writes only within the same tenant, idempotent retries |
| Firestore rules, indexes, Storage, backup and deployment | Single default DB and broad flat collection matching | Deny-by-default school route, versioned rules, proper indexes, Storage protection and school-scoped backup/restore |
| Billing, resource quotas, incidents | No per-school attribution | Platform dashboard of school usage, AI budget, storage, project limits, errors and legal retention; alerts when quota reached |

## 5. Manila Cathedral School pilot plan

MCS is the **first tenant**, not a special-case global school. This avoids writing assumptions like `if school == MCS` into every feature.

Pilot provisioning (manual and audited):
1. Platform owner reviews school identity and authorization. Create draft `mcs-manila` registry record with display name **Manila Cathedral School**, timezone `Asia/Manila`, chosen school year, branding placeholders, data-location `shared-firestore/school-path`, features/quotas, policy draft and one school-admin invitation. No production school record should be altered solely by creating this registry.
2. Enumerate ALL current flat production collections, subcollections, blobs, scripts, Firebase triggers, emails, existing role grants and integration keys. Generate read-only inventory of document IDs, counts and referenced links; manually verify every record's MCS provenance. **Do not infer school ownership merely from email domain, section label or account name.**
3. Create reversible mapping ledger `legacyPath -> schoolId + newPath + checksum/status`. Flag unresolved/orphan records for owner action; never silently assign unknown records to MCS or delete duplicates. Keep original IDs stable within MCS wherever possible.
4. Create school-scoped catalog, section/subject/course offering mappings, teacher permissions and student enrollment links. Translate old section strings into stable new IDs; preserve class roster and archived historical academic years.
5. Copy teacher materials, learner projects, assessments, deadlines, approved evidence, submitted Studio revisions, external evaluation evidence, grades, publication state, revisions/audit trail, practice progress, consent, messaging and school policies. Build all records and attachments before cutting over client reads. Existing ZIP, local drafts and personal projects must remain available without overwrites.
6. Run old-vs-new record counts, fingerprints, all reference chains and one controlled student/teacher/admin route test. Don't compare just top-level counts: assess nested versions, comments, reclaims, grade revisions and notification history.
7. Put affected school operations in a short **read-only cutover** to avoid split-brain writes; switch frontend school-data routing and backend triggers together behind a reversible feature flag. Do not start writing both legacy and new grade paths.
8. Re-enable MCS after authorization and data-integrity signoff. Retain legacy read-only state for a defined period; record migration version and time. No automatic destructive cleanup.
9. After MCS is stable, owner manually provisions a **second empty synthetic school** (not real student data) to prove two-school isolation before onboarding any additional institution.

Pilot default settings are proposals, not facts about MCS: branding/contacts/logo require authorization, as do real administrative accounts, academic calendar, official policy documents and AI data-sharing choices.

## 6. Platform Administrator school-creation workflow

Platform Console is owner-only and separate from School Administration:
1. Create school → check immutable slug, uniqueness, verified name, legal/contact basics, timezone, data policy, region and plan/quotas.
2. Provision school namespace, initial settings, indexes/rules coverage, private file root and usage counters; show step-by-step provisioning status and idempotent retry.
3. Invite one or more designated school administrators by verified identity. Never give school-wide access based solely on an email domain. Invitation expires and requires acceptance.
4. School admin sets academic year, programs, subjects, sections, offerings, teacher assignments, school policies, branding and authorized integrations.
5. Import/enroll students into the selected school only, validate identity collisions and class placement.
6. Activate school only after data routes, uploads, rules and permission checks pass. Platform owner may suspend, archive, change plan or disable a feature without deleting records.
7. School admin can view own-school quotas, users, reports and notifications; platform owner can see tenant health and audited support metadata. School ownership and historical data transfer are privileged, explicit processes.

States: `draft -> provisioning -> pending-admin -> ready -> active -> suspended -> archived`. Failed provisioning stays unavailable to normal users and may be retried safely, never half-authorized. A suspended school remains backed up but normal student/teacher writes stop. Deletion requires a separate policy-approved retention and export workflow.

## 7. Affected cross-cutting constraints

- **Data relations:** every assessment references a course offering and school; every grade references an assessment, student, teacher and reviewed evidence revision within the same school; every notification references school and authorized destination.
- **Security:** server-side grants, deny-by-default rules, not role badges/localStorage; guard all Admin SDK code (which bypasses client rules), scheduled jobs, import scripts and support tools. Prevent cross-school collection-group queries.
- **Identity:** same Google/Firebase UID can be at different schools with different roles, but school membership and current-school context never imply permission at the other. Require verified invitation/admission.
- **Academic timeline:** academic year/term, archived classes, transfers and graduation must not orphan grades; student transfer between schools must NOT automatically transfer transcripts/private teacher notes.
- **File lifecycle:** metadata ownership and object path both encode school, checksum references immutable submitted artifacts, safe ZIP/import limits, revisions and retention. A file copied between schools is a separately approved export/import, not a raw reference.
- **External evaluation:** evaluation packages, imported JSON feedback, LLM calls, code snapshots, provider credentials, analytics and logs must keep school and student boundaries; teacher approval remains required.
- **Privacy:** least access, school consent and retention policies, recording/export audits, controlled breach response; confirm applicable Philippine education and privacy requirements before production onboarding. No unauthorized sample student data in synthetic tests.
- **Usability:** explicit active-school banner, contextual role switcher, helpful no-membership/expired invitation/access revoked states, narrow mobile navigation, correct loaders and offline messages. Avoid a separate duplicate Gradebook for each assignment source.
- **Performance/cost:** query indexes by school/course/year, bounded pagination, storage size per school, AI budgets and request throttles, backpressure for multi-tenant notifications/triggers. Avoid listing all schools' student records to derive a count.
- **Business continuity:** MCS backups, school-scoped exports/restores, migration manifests, release flags, rollback with grade and notification reconciliation, no silent reassignment to the wrong tenant.

## 8. What-if and failure outcomes (minimum)

| Incident | Required behavior |
| --- | --- |
| Student guesses another schoolId in URL or localStorage | Server denies; nothing from other school is returned |
| Teacher teaches two schools | Can switch with distinct grants; no merged roster or Gradebook |
| Teacher is removed from a section during grading | Save/publish denied, private draft preserved for authorized staff |
| School admin tries to manage another school | All read/write/export denied, attempted access recorded where suitable |
| Platform owner uses school view-as | Explicit reason, read-only default, audit and expiry |
| New guest selects a school | May see only public school profile; no auto membership |
| Email domain matches MCS but user is not invited | Remains guest/request pending, not admitted |
| Two MCS students share the same name | Separate stable student IDs; email/UID mapping verified |
| Student is transferred to school B | Historical MCS records protected; no automatic grade transfer |
| Two schools use section “11-A” or same repo URL | No cross-school query, collision or shared permissions |
| Assessment deployed to wrong school | Reject, audit; immutable evidence and grade never silently move |
| Student submits an exam via another school tab | Client sees context mismatch; server rejects cross-school write |
| Offline work and school switch | Keep each scope's draft separated; do not replay old school writes after switch |
| Queued cloud save races with school suspension | Server rejects old token and scope; no further writes |
| File upload starts in school A, user switches to B | Cancel/finish only under verified A grant; never attach object to B |
| Private file has a guessed object URL | Must still require authorization; no public read |
| Large ZIP or malware is uploaded | Reject/quarantine; do not overwrite or expose existing files |
| Gradebook batch crosses schools | Refuse entire mixed batch; no partial wrong-school grades |
| Student resubmits after teacher publishes | Preserve frozen history and require explicit reopening |
| Teacher edits after losing course assignment | Refuse write at server even when stale UI retains controls |
| AI provider returns error or school quota reached | Report school-specific cause; preserve manual workflow |
| School-specific key rotated | Invalidate previous setting; other schools unaffected |
| Notification points to another school | Switch after grant check or show safe no-access state |
| Two schools issue same commit reclamation | Claims resolve inside each school and assessed repository context |
| Analytics worker processes multiple schools | Partition outputs and consent; no mixing in dashboards/logs |
| A school is suspended or provisioning fails | Data retained, student/staff writes denied, privileged recovery possible |
| Migration crashes midway | Idempotent resume from ledger; legacy source remains intact |
| Duplicate migration command | No duplicate records or grade publications |
| School owner attempts deletion while exports pending | Block and require explicit retention review |
| Website released before rules/functions | Feature flag stays off until compatible backend deploy confirms |
| School context becomes unavailable | Fail closed with Retry / Switch School; never fall back to another school |

## 9. Delivery plan for the single next major release

These are **workstreams inside the same 4.0 milestone**, not permission to publish partially migrated production functionality.

- **Foundation A — Schema and service boundaries:** normalized school IDs, academic identifiers, tenant registry, school context, storage adapters, relationship graph, deterministic IDs.
- **Foundation B — Authentication and authorization:** five-role grant model, dual-school memberships, school chooser, server-side Functions and Firestore rules, legacy bootstrap/admin migration with safe recovery.
- **Foundation C — School operations:** platform owner console and manual provisioner; school admin portal, onboarding/admissions, catalog/offerings, teachers, enrolments, quotas and audit.
- **Foundation D — Current LMS workflows:** V2 GitHub/V3 Studio assessments, review, evidence, Gradebook and publication; lessons, presentations, schedules, reference library, student workspaces, practice/progress and analytics all tenant-aware.
- **Foundation E — File/data services and integrations:** school file browser/Storage access, imports/exports, shared-vs-private materials, school AI policies/secrets/quotas, repository integration, notification routing, monitoring and backups.
- **Foundation F — Pilot migration and cutover:** inventory, audited ledger, MCS record relocation, historical integrity, role migration, one empty second-tenant proof, rollout flags, fallback.
- **Foundation G — Product quality and docs:** accessible five-role responsive navigation, school selectors, empty/error states, Wiki onboarding per role, role+school-aware release notes, operational runbooks.

### Focused release acceptance gates

1. No unauthorized cross-school Firestore, Functions or Storage read/write, even when forging IDs and using two authenticated schools in tests.
2. MCS historical student/teacher roster, V2 approved evidence, V3 frozen revisions, grade totals, publication states, notifications and audit revisions reconcile exactly with migration inventory. Unresolved records block activation.
3. An MCS student completes Studio submission; an MCS teacher reviews and publishes a grade; student sees **only** their published grade; second school cannot access any of it.
4. Teacher with two school memberships correctly switches, retains separate subjects/rosters, and loses permissions immediately after revocation.
5. A second empty school can be provisioned by owner without data from MCS, then deactivated without touching MCS.
6. School-specific cloud files/uploads, AI configuration, notifications, imports, export and analytics honor scope and quotas.
7. Deployment order: compatible Functions and Firestore/Storage rules, controlled migration, verified MCS routing, Pages, 4.0 public manifest and release-impact notes. No release announcement before backend cutover.
8. Non-destructive rollback documented; old assessment evidence and grade records retained until reconciliation and retention approvals.

Do not require exhaustive repetition of already-green unrelated tests. Add targeted tests for new tenant/role invariants plus focused existing review and grading regression gates.

## 10. Deferred modules supported by this foundation

After 4.0 is stable: full SIS (enrollment, registrar, transferees, credentials), attendance, school calendar, homeroom and advisory, parent/guardian accounts, messaging, learning content management and exams, school financial and payment workflows, inventory/assets, library circulation, HR/payroll where appropriate, counselor/disciplinary records with stricter consent, institutional analytics, third-party integrations, accreditation/reporting, tenant billing and optional dedicated physical databases/projects. Each module inherits schoolId, role grants, academic year/term, audit, privacy and file ownership, rather than adding bespoke global collections.

## 11. Explicit non-goals and unresolved configuration

- The MCS name is a pilot label supplied by the owner, not independent verification of school affiliation or authority to use institutional branding or data.
- No hidden access for a school admin to platform credentials or other schools; the platform owner does not automatically become the school's grading teacher.
- No destructive migration, automatic real-school provisioning, billing activation, or implicit cross-school student transcript sharing.
- Confirm from the actual pilot school's authorized personnel: official branding, first school administrator, applicable grade levels, academic calendar, privacy/consent policy, data retention, AI-provider approvals and whether dedicated **physical** database isolation is mandatory. Missing choices do not justify unsafe defaults.
