# Adminerva School OS — Master Development Plan

**Canonical roadmap and development-status document**  
**Last consolidated:** 2026-11-24  
**Repository:** Adminerva-Org/Adminerva

> This is the single source of truth for Adminerva product direction, current development status, priorities, and future development.
>
> Other documents in the repository may remain as technical specifications, architecture references, historical implementation notes, migration records, or operational runbooks. They must not be treated as competing roadmaps or progress trackers. When another document conflicts with this one on product direction or priority, this document governs.

## 1. Product vision

Adminerva is evolving from an LMS/programming platform into a **School Operating System**: one school-wide website where institutional operations share a verified identity, school context, academic structure, permissions model, audit model, and operational workflow.

The target is not merely to place SIS, LMS, Clinic, Finance, Cafeteria, Uniforms, HR, Inventory, and other modules beside one another. The target is to make them work from the same authoritative school records without creating duplicate sources of truth.

The long-term product should support:

- Platform/System Administration
- School Administration
- Registrar and SIS
- Teaching and LMS
- Assessment, Gradebook, Class Record and Attendance
- Student and Parent Services
- Personnel and HR
- Finance, cashiering and student accounts
- Clinic, guidance and learner welfare
- Cafeteria/canteen and school store/uniform sales
- Facilities, assets, inventory and procurement
- Library, transport and other campus services
- Communications, forms and approvals
- Institutional reporting, compliance, privacy and audit

## 2. Non-negotiable product principles

1. **One school context.** Every private operation executes inside one server-verified school context.
2. **One person, many relationships.** A school person record is distinct from login identity, school membership, student registration, staff appointment, teacher assignment, guardian relationship and departmental records.
3. **No duplicate operational truth.** Teacher load is derived from class assignments and schedules; ordinary class rosters derive from official student placement; published assessment results project into the Class Record instead of being manually copied.
4. **Class-centered academics.** The canonical instructional unit is a course/class offering tied to school, academic period, subject and section or selective roster.
5. **Teacher-owned preparation is private by default.** Lessons, assessment blueprints, presentations and teaching resources remain creator-private unless deliberately shared.
6. **Historical academic evidence is preserved.** Enrollment history, submissions, evidence, published grades, revisions and audit records are not silently rewritten when staffing or placement changes.
7. **Departmental least privilege.** A clinic user does not gain Gradebook access; finance staff do not gain assessment access; teachers do not gain unrestricted health or finance records.
8. **Platform Admin is not School Admin.** Platform operations and school operations remain separate. Cross-school assistance must be explicit and audited.
9. **Mobile-first and understandable.** A user should enter through role-appropriate workspaces and operational tasks rather than a maze of implementation pages.
10. **Focused validation.** Do not expand release/deployment testing unnecessarily. Keep validation concentrated on the changed workflow, tenant isolation, permissions, data integrity and irreversible/high-impact operations.

## 3. Target School OS architecture

### Platform Administration

- Institution Registry and school lifecycle
- Platform user/account visibility
- Platform Administrator access
- System Admin Assist
- Operations Center, incidents and observability
- Platform feature rollout, quotas and infrastructure status
- School provisioning, suspension and recovery

### School Administration

- Operations Dashboard and action queue
- School Profile and Campuses
- Academic Configuration
- People & Access
- Classes & Scheduling
- Enrollment & Registration
- Grading Policies
- Attendance Oversight
- Class Record Oversight
- School policies, integrations and institutional settings

### Registrar / SIS

- Admissions and applicants
- Registration and official section placement
- Student master directory
- Guardian relationships
- Enrollment lifecycle
- Transfers, withdrawals, promotion, retention and graduation
- Student records / 201 files
- Credentials, report cards, transcripts and certificates
- Registrar requests, verification and records release

### Academics / LMS

- Classroom stream
- Classwork and materials
- Teacher preparation
- Assessment Studio
- Personalized assessments
- Adminerva Studio and project evidence
- Submission review and private assessment conversation
- Gradebook
- Class Record
- Advisory/Homeroom
- Attendance
- Academic analytics
- Practice/Games and laboratories

### Personnel / HR

- Staff directory
- Staff appointment and school role
- Teaching assignment and faculty load
- Personnel 201 files
- Contracts and appointments
- Attendance/DTR and leave
- Payroll and benefits
- Performance and professional development
- Recruitment, onboarding and offboarding

### Finance and Commerce

- Fee setup and student ledgers
- Cashiering and payments
- Receipts, adjustments and refunds
- Scholarships/discounts
- Budget and disbursements
- Accounting and reporting
- Shared transaction/payment foundation for school services
- Cafeteria/canteen point of sale
- Uniforms and school-store point of sale

### Health and Student Services

- Clinic dashboard
- Restricted health profile
- Consultations/visits
- Medication and supply logs
- Accidents/incidents and referrals
- Medical clearance
- Guidance and counseling
- Discipline/case records
- Learning support / special needs
- Emergency contacts and authorized notifications

### Campus Operations

- Rooms and facilities
- Facility reservations
- Maintenance requests
- Assets and inventory
- Procurement and suppliers
- Library
- Transportation
- Security/visitor management
- Lost and found

### Institutional Services

- School announcements and messaging
- Forms and surveys
- Events
- Parent/Guardian portal
- Document repository and templates
- Approval/routing workflows
- Accreditation/government reports
- Privacy, audit and records retention
- Institutional analytics

## 4. Canonical data and authority model

The School OS must continue using explicit authoritative relationships instead of convenience fields.

### Identity and people

- Firebase/global account identity answers **who can sign in**.
- School membership answers **which school and roles the account currently has**.
- School person answers **who the person is inside the institution**.
- Student registration answers **where the learner is officially placed for an academic period**.
- Staff appointment answers **the person's institutional staff relationship**.
- Teacher assignment answers **which class offerings the teacher may teach**.
- Adviser assignment answers **which section the teacher advises**, independently of subject teaching.
- Guardian records/relationships answer **who is authorized for a learner**.

### Academic authority

- Academic year/periods, programs, subjects, sections and course offerings are school-owned.
- Official section placement drives normal section-class enrollment.
- Selective/manual rosters exist for electives, irregular learners and deliberate exceptions.
- Teacher workload is calculated from active class assignments and official schedules.
- Official schedules are school-owned and must prevent teacher, section and room conflicts.
- Published assessment results link/project to the Class Record; do not create a second score ledger.

### Departmental authority

Future Finance, Clinic, HR, Cafeteria, Uniforms, Inventory and similar modules should reference canonical people and school records but own their private operational data in separate permission domains.

## 5. Development status as of 2026-11-24

Status definitions:

- **Operational:** merged/released and intended for normal current use.
- **Merged:** code is on main; deployment/runtime state may still depend on the corresponding release workflow.
- **In development:** substantial implementation exists in an open PR/branch.
- **Foundation:** architecture or partial implementation exists but is not yet the canonical operational path.
- **Planned:** product direction is approved here but implementation is not yet established.

| Area | Status | Current position |
| --- | --- | --- |
| Existing LMS, Studio, assessment and grading base | Operational / evolving | Mature legacy/current functionality exists; school-scoped consolidation is ongoing. |
| People & Access directory improvements | Merged; compatibility placement verification follow-up | PRs #220, #221 and #222 added existing-student placement, legacy section repair, central directory search/profile editing and direct section placement. The current follow-up keeps People & Access as a contextual admin entry point while using the compatibility-aware `schoolAcademics` relationship service for schools that have not yet moved to canonical enrollment: the student detail verifies active pre-canonical class relationships, fails closed if placement cannot be verified, can end the reviewed compatibility placement with revision/audit protection, then allows reassignment without deleting history. Canonical registration lifecycle remains owned by Enrollment & Registration and is not duplicated in People & Access. |
| Student account replacement / recovery | Released; Davis compatibility E2E verification pending | PR #241 released the preview-first, revision-safe account replacement workflow while preserving the canonical school person, registration/enrollment history, grades, submissions, evidence, Studio projects/personalized variants, repository settings and private assessment conversations. PR #249 merged the recovered-student Classroom/Subject route fix at `25db0f5a3b30584c68266f05e3aac505aa8afc5a`. Live Davis verification then exposed a compatibility-only gap: older programming assessments and personalized Studio variants still resolved learners by the current Firebase email even though recovery deliberately preserves the original legacy `students/{id}` linkage on the canonical person. PR #250 merged to `main` at `5e564c7135d1667882bbd4c6d4e27b9fad80c94a`, with JavaScript regressions, Firestore security, CodeQL and JavaScript/TypeScript analysis passing; GitHub Pages and Firebase Functions/Firestore deployment both completed successfully. A subsequent Davis screenshot proved the browser was still receiving the pre-#250 student assessment module because `student-assessments.html` retained the old `20261121-studio-route-hotfix` cache key and footer build `25db0f5a3b30`. PR #253 merged to `main` at `bc2b05616b36fd4f35ea68dffef225423479a498`; it publishes cache-safe versions for `student-assessments.html -> assessments.js -> student-access.mjs`, extends the shared UI/access cache-bump workflow to keep those references synchronized automatically, and adds a regression against the stale pre-recovery keys. The generated cache-bump commit `b1b5ce477ff465b72d6a4171a175f72f567d11bd` deployed successfully to GitHub Pages, and the three relevant references now use build key `bc2b05616b36`. No enrollment, assessment, submission, grade, evidence or Studio record was rewritten or duplicated. The latest Davis screenshot confirms the PR #250 compatibility code executes but returns no mapping because the November 8 `mcs_canonical_identity_migrated` foundation path did not persist `legacyStudentIds` on canonical people. PR #254 merged to `main` at `86d508c8fdbf9d00b80667cac14ceac41538c609` and the Firebase Functions/Firestore deployment completed successfully. Older recovered canonical people from the November 8 foundation migration now resolve through preserved `previousAuthUids` -> historical Firebase Auth email -> exact legacy `students/{id}` when `legacyStudentIds` is absent, while failing closed instead of binding the replacement account's current email to another row. Functional regressions cover both the historical-UID recovery case and the fail-closed replacement-email case. The latest Davis screenshot still returned `No student class linked` after PR #254. PR #255 merged to `main` at `5e818f3f1ba3bad3cc52edfe9809cf97057e1da5` and now uses the old server-owned `student_access/{previousUid}.studentIds` as a stronger compatibility bridge before historical Auth-email lookup; this preserves the exact legacy student ID without name/section guessing or duplicate records. The generated cache-bump commit `04cbe16d053acc4d53358572ac2feefb4138264a` deployed successfully to GitHub Pages, the Assignments/footer/access bundle now uses cache key `5e818f3f1ba3`, and the Firebase Functions/Firestore deployment completed successfully. The empty compatibility state now also surfaces the resolver mapping status so any remaining failure is diagnosable from the student screen. PR #255 released the automatic prior-access projection fallback and diagnostic mapping status. PR #256 released a reviewed admin reconciliation path in People & Access: School Admin can search the MCS legacy student directory, inspect exact historical candidates and conflicts, explicitly link the selected stable legacy student ID to the canonical person with revision/audit protection, and immediately rebuild the server-owned compatibility projection. It never auto-links by name alone and does not rewrite enrollment, grades, submissions, evidence or Studio history. A Firestore inspection now confirms a recovered account can already resolve `identitySource: canonical_account_history`, the expected St. Carlo Acutis section and exact legacy student IDs, while the persisted `student_access` document omits the `profiles[]` structure consumed by the Assignments UI. PR #259 merged to `main` at `bd973909b74d769f0ee64d12a4128184702a7123` and is released. The server-owned `student_access` projection now persists `profiles[]` alongside `sections[]` and `studentIds[]`, while the client can hydrate profiles from that document when the callable response is incomplete, eliminating the split projection contract. The generated cache-bump commit `ab26007f729776cd6b8233dc7cb994239721e1fc` deployed successfully to GitHub Pages, and the Firebase Functions/Firestore backend deployment completed successfully. Live Davis verification after PR #259 confirms the older Mini PETA cards now load. The remaining recovery gap is GitHub/evidence continuity: legacy evidence, submission receipts and Student Dashboard ownership still depend on legacy-email equality even though the recovered account is authoritatively linked through server-owned `student_access.studentIds`. PR #262 merged to `main` at `4d90ddb7ea6554eac143a00a06d3e3113614782b` and is released. Legacy evidence/submission ownership now accepts the exact legacy student IDs authorized by server-owned `student_access`, recovered profiles carry non-secret repository metadata and current-account ownership, recovered GitHub OAuth credentials remain session-scoped, and Student Dashboard can transfer only the exact GitHub provider credential the learner just authenticated when that provider is still linked to a suspended canonical previous UID. The generated cache-bump commit `27b477fa968784640cf960e564bc0d26b53db56c` deployed successfully to GitHub Pages, and the Firebase Functions/Firestore deployment completed successfully. Closed assessment deadlines and late-submission policy remain unchanged by identity recovery. Authenticated Davis verification of GitHub reconnection, evidence history, Studio status, submission history and grades remains required before calling the entire recovery path operational. |
| Role-aware account settings and profile self-service | Released; authenticated role-by-role E2E verification pending | PR #265 established the canonical role-aware settings architecture and V4 student Settings/Profile surface. PR #269 merged to `main` at `02e1513cbfce3d2fd455bdd0d5fd2abc792ae275` and completed the cross-role UI/UX cleanup: staff/admin, V4 student, legacy-student fallback and guest settings now share one responsive Settings design system; desktop uses a compact category rail plus content panel while tablet/mobile collapses to a single-column flow with horizontally scrollable categories; section cards, status/save states, controls and navigation are consistent; complete verified access context is shown for multi-role accounts (for example School administrator · Teacher); teacher-only panels and teacher submission/grading notification categories stay hidden from non-teaching registrar/admin/platform contexts; Activity & Privacy is integrated into personal preferences rather than injected as a detached third column; V4 student Profile/Account/GitHub/Repository/Notifications/Privacy controls remain together; legacy student and guest fallbacks use the same visual language; V4 help links resolve to the canonical student Settings route; and recovered students\' optional activity preferences resolve through server-owned `student_access` before legacy-email fallback. Official SIS identity remains view-only/self-service-safe, and institutional configuration stays in School/System Administration rather than the personal gear menu. Focused JavaScript/settings regressions, Firestore security, CodeQL and JavaScript/TypeScript analysis passed. The generated cache-bump commit `6393ea0f8c671b8b492fca80df6f33b57c44a284` deployed successfully to GitHub Pages, and the Settings/Help/Activity asset chain is released with cache key `02e1513cbfce`. No backend deployment was required. Authenticated verification is still required for student, teacher, registrar, school-admin and platform/system-admin contexts before calling the entire settings workflow operational. |
| Teacher blueprint archive / private Restore | Merged to `main`; Firebase backend/index deployed; frontend released; authenticated teacher E2E pending | PR #275 deployed the revised `teacherBlueprints` callable and Firestore composite index to Firebase successfully from `d14720d6701902baa7b8956f460091b42d9adec7`. PR #274 merged the owner-only paginated Archived view and audited Archive/Restore UI at `720e435cc0de3c4b4b717bc56ce5bffeb8c39397`, with GitHub Pages and Cloudflare Pages production deployment successful. Restore preserves the same private resource and historical deployments, pool, submissions, grading and audit, resets sharing to private and requires reviewed revision and reason. Backend tests passed; a real teacher still needs to verify archive/restore, cross-school access denial and preserved history before marking it operational. |
| School campus archived-edit protection | Backend deployed; frontend existing flow released; authenticated School Admin E2E pending | PR #275 successfully deployed the `schoolProfile` change: archived campus records cannot be updated until the canonical reviewed, audited Restore is completed. The School Profile client already supports Archive/Restore. School-scoped permission, revision and audit requirements are unchanged; verify with School Admin account before marking operational. |
| System Admin global account lifecycle | Merged to `main`; Firebase backend deployed; frontend released; authenticated platform-admin E2E pending | PR #275 deployed the `platformUsers` backend successfully and PR #274 released the global account lifecycle UI at `720e435cc0de3c4b4b717bc56ce5bffeb8c39397`. The System Admin directory supports complete current-scale Firebase Auth listing, global-login creation, display-name correction, disable/restore and password-reset-link generation, with platform audit and authority checks. It does not alter canonical school person, membership, registrations, grades, submissions or evidence. Ordinary hard deletion is not offered; active Platform Admin accounts and the acting admin cannot be disabled. Verify with authorized platform credentials before calling it operational. |
| System Admin CRUD coverage expansion and test-student mobility | Merged to `main`; Firebase backend/rules deployed; frontend released; authenticated platform-admin E2E pending | PR #281 merged to `main` at `5f678eadbb5e506616da9244ed83239a23fdfac3`. It extends the released account lifecycle with Platform Administrator grant/retire/restore; adds revision-safe School Registry label update plus archive/restore for draft or suspended tenants; completes revisioned create/update/retire/restore semantics for legacy monitoring assignments; and makes legacy System Admin support triage/close/reopen/lock/classification reasoned and revisioned. The same release adds an explicit backend-only test-student designation and audited cross-school student-access handoff: Platform Users designates the global test login, while the actual target-school student person/membership is created or restored only through the school-scoped People & Access service under explicit System Admin Assist. Source-school registrations, grades, submissions, evidence and Studio history are never moved or deleted. Section placement remains owned by Enrollment & Registration for canonical schools and compatibility People & Access for legacy-compatible schools; test-school access can be suspended through the existing school access lifecycle before retiring the global test designation. Firestore rules deny browser access to the test-designation registry, including legacy administrator clients. GitHub Pages released the cache-bumped frontend from `ad7d8c6c867c88b7b2edf71191fff2e2fb9ab025` (Pages run `45089390280`), and Firebase Functions/Firestore rules/indexes deployment run `45089375577` completed successfully. This remains test-only mobility, not a production inter-school student-transfer shortcut; authenticated end-to-end verification with a real test login is still required before calling it operational. PR #194 Operations Center remains a separate in-development observability workstream. |
| Core administrative CRUD / record lifecycle | Released; E2E verification pending | PR #215 merged to `main` on 2026-11-21 at `79d27269538ae39a7dcfc19d990942f494933d5a`. The reconciled release standardizes revision-safe Create / Read / Update / Archive / Restore across canonical people, invitations/access artifacts, academic master data, classes and related administrator-owned records while preserving registration, enrollment, staffing, adviser, grade, submission and audit history. GitHub Pages released the cache-bumped frontend from `d8c2d082fd16f3e3fea2482e89a4479182c97abd`, and the Firebase Functions/Firestore production deployment completed successfully. Authenticated school end-to-end verification remains required before calling the workflow operational. |
| System Admin + School Admin workflow consolidation | Released; E2E verification pending | PR #215 merged to `main` on 2026-11-21 at `79d27269538ae39a7dcfc19d990942f494933d5a` after reconciling newer Studio, assessment, Registrar, Class Record and bulk-evaluation work. The released administrator workflow covers School Profile & Campuses, Academic Configuration, People & Access, Classes & Scheduling, Enrollment & Registration, Grading Policies, Attendance Oversight and Class Record Oversight; System Admin Preview remains non-mutating and Assist remains explicit/audited. Frontend and Firebase backend release workflows both completed successfully; authenticated role-by-role operational verification is still pending. |
| Classes & Scheduling | Released; E2E verification pending | PR #215 released the canonical Class Offering workspace with staffing, derived teacher load, section coverage, official schedules, adviser assignment and explicit roster authority using existing `course_offerings`, `staff_assignments`, registrations and enrollments rather than a parallel source of truth. Production frontend/backend releases completed; authenticated administrator/teacher roster and schedule validation remains pending. |
| Enrollment & Registration lifecycle | In development | Standard registration exists and PR #215 now adds exact directory-student deep links, reviewed-person binding, history-preserving same-grade/same-period section correction, automatic-roster synchronization that excludes selective/elective classes, registration lifecycle ownership that preserves unrelated selective enrollments, and explicit withdrawal / transfer-out / cancellation classifications without deleting historical records. The SIS progression slice is now implemented on the branch: individual and bounded cohort Promotion/Retention/Graduation reuse one canonical registration-transition transaction; require the exact reviewed registration revision; are available only from the last active configured academic period; gate progression on the student’s released Class Record Final Grades for every registration-owned class; reconcile registration-owned roster counts; revalidate target academic structure, future academic year and identity requirements; preserve the completed source registration; create a linked next registration and automatic roster for Promotion/Retention; record Graduation without inventing a next placement; block direct Restore of progressed registrations; and expose school-scoped effective-dated placement/audit history from the existing canonical records. Cohort preview is bounded to 60 active learners, runs individual readiness checks with controlled concurrency, and applies only Ready learners as independent audited transactions so blocked/failed records remain unchanged. New standard registrations also seed the canonical guardian contact/relationship while retaining the older guardian snapshot for compatibility. CI execution, merge, release and operational verification remain pending. |
| Teacher Classroom consolidation | In development | PR #215 organizes Stream, Classwork, roster, submissions, grades and Class Record around one selected class. |
| Advisory and school attendance | In development | PR #215 implements adviser authority, daily attendance and School Admin oversight. |
| Class Record | Operational / evolving | School-scoped Class Record exists; PR #215 improves assessment links and administrator oversight, reports grading-policy coverage/conflicts, makes per-class policy failures actionable, and prevents equal-specificity policy overlaps at save time. |
| Studio cloud-save recovery | **Merged in PR #290; GitHub Pages deployed successfully; affected-student verification pending** | Investigation of reported `Device copy saved · cloud not synced` incident identified a permanently cached failed school-verification state, no bounded retry after temporary save failures, and a generic manual-save message that concealed the underlying error. The released frontend rechecks canonical verified school access, requires school-owned storage for assessment projects even in compatibility mode, schedules bounded retry only for transient failures, preserves pending device copies/revision guards/exam-close authority, and displays actionable save-error categories. PR #290 merged to main at `ae93a09f0c336f4e2ef640c74b6a6ada5f4fa65b`; GitHub Pages run `45130687952` completed successfully. Teacher review of the affected student's actual cloud checkpoint remains necessary; the screenshot alone does not establish a specific server rejection. | 
| Practical exam manual open/close | Operational / hardening complete; session-level save-history review remains a teacher procedure | PR #223 delivered the backend/index foundation, PR #224 fixed retryable event-trigger bootstrap, and PR #216 delivered teacher-controlled open/close, session-epoch binding, student editor lock, 60-second final-save grace, immutable cloud final checkpoints, retryable close notifications and Class save history. The workflow was used in live classroom practical examinations on 2026-11-23 and the exam sessions were closed. PR #285 merged the teacher-side Finalizing saves timeout correction. After the live exam window, PR #272 merged at `71d5c2f7999900e385d65ffeddfec41b21cb20a2` to close the deferred device-storage resilience gap without changing close-receipt semantics: a quota-full/blocked browser retains the current Studio assessment project in memory, queues it to school cloud, prevents leaving while that only copy is unconfirmed, and preserves newer Studio Task/Earlier Projects behavior. GitHub Pages run `45094145254`, Firebase Functions/Firestore indexes run `45094146106`, mainline quality run `45094146120`, and CodeQL run `45094146167` all completed successfully. Teachers must still review Class save history for each finished exam session; an unconfirmed final checkpoint is an operational follow-up, not proof that the learner had no earlier autosaved school revision. |
| Exam Integrity Engine + Adminerva Companion | In development — PR #288 draft branch; not merged, deployed or operational | Initial opt-in monitoring-event contract and inactive browser observer are proposed in PR #288. Secure exam policy/notice, appropriate consent, tenant/teacher/student/epoch authorization, private snapshot storage, teacher monitoring timeline, signed Companion pairing and desktop OS permissions are not implemented or released. Integrate only with canonical Studio teacher-controlled sessions and preserve student code, cloud saving, grade evidence and history; monitoring observations are not automatic cheating verdicts. The native client work in PR #292 does not activate monitoring. |
| Public Adminerva download and installation hub | Merged into `main`; GitHub Pages frontend released | PR #289 merged the public `downloads.html`, shared navigation and homepage entry point. GitHub Pages production run `45125677795` completed successfully. Web access and browser-specific installation guidance are available; no official Windows/macOS installer, Google Play/App Store listing, desktop Companion or native monitoring application has been published. Existing PWA install prompts depend on browser eligibility. |
| Native client sign-in handoff | In development — draft PR #295; not merged, deployed or operational | Browser-to-desktop Firebase device-pairing prototype implemented on a dedicated branch: five-minute server-owned pairing with random flow ID, manual eight-digit code, PKCE verifier, recent verified account approval, one-time custom token, account-disable/revocation checks, backend-only Firestore records and TTL, and narrow desktop session completion using existing school role resolution. Both backend issuance (`ADMINERVA_NATIVE_AUTH_HANDOFF_ENABLED`) and the desktop development UI (`ADMINERVA_ENABLE_DESKTOP_SIGNIN_UI`) are disabled by default. Abuse throttling, provider/device end-to-end validation, signed native builds and Studio exam-save acceptance remain release blockers; no native application is downloadable. |
| Cross-platform native application foundation | Source merged into `main` via PR #292; no native builds released or operational | One shared School OS service/code layer for web and native clients. First workstream adds a restrictive public-only Electron desktop preview, public-only Capacitor mobile asset staging derived from canonical website files, conservative shared app/version/capability descriptors, focused security tests and technical release boundaries. Authenticated desktop login, safely signed Windows/macOS builds, auto-updaters, Capacitor Android/iOS projects, native app-store distribution and exam Companion remain future implementation; do not advertise them as available. Hosted public content follows web releases upon reload/navigation, but bundled mobile and native privilege changes require reviewed native releases. |
| Assessment Studio multi-class deployment and date-range scheduling | Merged; frontend release/operational verification pending | PR #228 merged to `main` on 2026-11-21. The canonical form now supports multiple authorized class offerings and two-click date-range scheduling while preserving independent per-class assessments, teacher-controlled exam sessions and audit history. Production frontend availability and end-to-end operation not yet confirmed. |
| Assessment Studio deployment-first personalization | Merged to main; backend/frontend release and operational verification pending | PR #231 merged to `main` on 2026-11-21 (commit `2e94339d4adbba13272b706d0675c7494bb4c6f3`). The canonical deployment flow selects assigned classes and dates before determining private variants from authorized active enrollment, recognizes already-deployed blueprints, reuses sufficient activated pools, and removes manual pool sizing from the creation form. Existing school deployments and legacy historical assignments remain preserved. Verify Firebase Functions and frontend production release separately before calling this operational. |
| Studio student-project recovery and unfinished-work resilience | Released; live practical-exam path used; cross-device/quota-pressure acceptance remains | PR #230 merged the canonical Studio recovery and legacy submitted-source restoration path. PR #283 later added Task visibility plus safe discovery/recovery of earlier same-account projects without altering assessment evidence. PR #272, merged after the 2026-11-23 practical-exam window at `71d5c2f7999900e385d65ffeddfec41b21cb20a2`, adds the deferred ordinary-autosave resilience for quota-full/blocked device storage and preserves in-memory assessment work until school-cloud confirmation. The same release adds canonical-person-scoped school-cloud drafts for unfinished written/link responses, explicit device/cloud conflict preservation, and Java diagnostics protection when source loses the `.java` extension. Direct browser access to school-private draft records remains denied by Firestore rules. Frontend and Firebase release workflows completed successfully. Remaining validation is targeted cross-device, offline/reconnect and intentionally quota-blocked acceptance rather than another architectural implementation phase. |
| Student Studio Task access and older project discovery | Merged to main and GitHub Pages frontend released; authenticated older-project verification pending | The current-main Studio interface used three viewport-dependent task triggers and hid the desktop task in the Assessment ribbon; the fix places one persistent Task button immediately after Projects for desktop, tablets and phones, while retaining the existing instructions sheet. V4-only school browser namespacing and the skipped legacy `student_code_projects/{uid}/projects` query could conceal older Mini PETA work; the existing project home now exposes a separate Earlier projects list for the same verified login’s unscoped device and older account-cloud copies, plus the previously missing Archived school projects entry. Optional recovery creates a distinct personal project retaining code/design/database, never edits the source, migrates submissions, assigns grades, or bypasses teacher-controlled practical-exam access. The standard project directory also protects assessment-launched work from ordinary deletion regardless of legacy offering metadata. PR #283 squash-merged to main as `11a294f938b9f613be09be3642d974c231eeb99e` after focused JavaScript, Firestore security, Studio mobile UX, CodeQL, and release-source checks passed. Historical files under a different former login still require verified person/UID recovery; no unsafe title/name inference is introduced. Focused regression tests passed; GitHub Pages build/deployment run `45081929068` succeeded for follow-up main commit `43fe4ae3c7081848958e2b59325bd33a37cd0199` containing the PR #283 Studio assets. Real recovered-account/legacy Mini PETA discovery and multiple-device acceptance remain unverified; do not mark operational from CI/deployment alone. |
| Legacy Repository Management deployment visibility and schedule editing | Merged to main; frontend release and operational verification pending | PR #233 merged to `main` on 2026-11-21 (commit `fad25b9ea6f1bcac929063f8fb260117ecfc1950`). The canonical Deployed Tasks view now includes teacher-owned legacy deployments through the existing owner-scoped API, with links to each original class schedule; the historical editor supports direct existing-deployment links, deadline extension and late-submission changes while preserving the original assignment date and evidence. Existing variants, submissions and grades are not migrated, cloned or changed. Verify GitHub Pages frontend release and real legacy update workflow before marking operational. |
| V4 unified historical assessment review and verified conversion readiness | Merged to main; backend/frontend release and operational validation pending | PR #234 merged on 2026-11-21 (commit `f183ada74a6770212704917a6c6227076d4d2209`). Teacher-owned historical Adminerva Studio submissions can be reviewed from V4 using an audited owner/school-scoped read-through adapter: verified frozen code/variant evidence, private drafts, reviewed-grade publishing and bounded non-zero bulk publication update the original legacy grade record, not a duplicate V4 grade. Historical published scalar grades do not fabricate rubric breakdowns; source and grades remain authoritative in their legacy collections. A read-only readiness preview checks identity, enrollment and historical-term provenance before any future physical migration. Historical GitHub evidence still requires its existing review workflow. CodeQL, focused JavaScript regressions, Firestore security and Pages build passed; isolated Java Worker build failed independently. Firebase Functions deployment, frontend release and end-to-end teacher verification are still required before marking operational. |
| GitHub student-submission-first grading and forced-discovery retirement | Merged to main and frontend released; backend deployment and authenticated teacher E2E pending | PR #261 squash-merged 2026-11-22 (commit `52a407d68005316d905d21895c7ffd005102da9b`). The implementation revises the canonical native/historical GitHub review pipeline: student-submitted, selected SHA receipts and frozen checkpoints are the gate for grading, not manual Approve Contributions. V4 automatically inspects pinned SHA ancestry and commit diffs. Historical `assessment_evidence` records sourced from forced instructor discovery that lack actual `submittedAt` remain visible for historical context but display **No student submission**, cannot be bulk selected, and cannot create new rubric grades even if an old checkpoint was approved. Previously published/historical grade documents and approval/audit records are untouched; actual student resubmissions following a teacher-discovered proposal count as new submitted evidence. New native GitHub grade drafts and publication likewise require original student-submitted frozen evidence. Selected student commits with no substantive detectable changes remain for individual review and never generate an AI-inferred zero. The one-click next-20 ungraded selector now considers actual student submission, nonzero selected SHA count, current grade status, and evidence integrity rather than approval status. The original controlled correction/reopen paths remain; legacy force-gather tools are not promoted in V4. Focused JavaScript regressions, Firebase Firestore tenant/security checks and CodeQL passed on PR #261; Pages production release succeeded at run `44925222067`. Firebase backend run `44925222762` remains in progress, and actual teacher/student operational end-to-end verification remains pending. |
| Historical Repository Management GitHub read-through in V4 | Merged to main and frontend released; backend deployment in progress, teacher E2E pending | PR #252 merged on 2026-11-21 (commit `dbfbfdbf7995b497a4966fcb1becfc5ce5af81fe`). The implementation adds an original-record read-through adapter under the existing school-scoped `schoolAssessmentMigration` callable: original owner/imported blueprint checks, historical `assessment_evidence` inbox and inspection, V4 collapsed commit links, explicit individual-commit scope for AI, and transactional rubric draft/publication updates solely to the original `student_grades` and `grade_revisions` records. Existing published scalar grades remain protected; unpublished scalar drafts can be manually reconstructed and saved in V4 as audited revisions of the original record instead of inventing missing rubric allocations. At the time of PR #252, unapproved evidence still depended on old verification links. PR #261 supersedes that rule: only actual student-submitted selected commits are gradeable; teacher-discovered context is never a student submission, and ordinary V4 review no longer requires contribution approval. Historical outcomes are not projected to V4 Class Record without verified academic term/enrollment mapping. Focused JavaScript/grade-integrity regressions and the GitHub Pages production release passed (run `44917236386`); Firebase production deployment run `44917237401` is in progress. No real teacher end-to-end verification or full retirement of old evidence-approval navigation has been confirmed. |
| V4 repository evidence consolidation into Review & Grade | Merged to main and frontend released; authenticated teacher verification pending | PR #251 merged to main on 2026-11-21 (squash commit `4d832fac3dc744de684ccec6823cb15935521c18`). The implementation adds bounded checkpoint-pinned source retrieval to V4 GitHub evaluation, reuses the conservative legacy commit-substance classifier, carries source/coverage/merge/attribution limits into Internal/External AI packages, and reduces teacher-facing commit inspection to a collapsed per-commit GitHub link list. At PR #251 the then-current approval, protected draft, publication and Class Record flow remained unchanged; PR #261 subsequently retired mandatory contribution approval for student-submitted GitHub evidence without migrating any evidence or grade. The original-record read-through was implemented in PR #252 and revised in PR #261: actual student-submitted commits can be evaluated regardless of old contribution approval; forced teacher discoveries without a submitted receipt remain in history but are excluded from new grades. Focused JavaScript regressions, CodeQL, Firestore checks, and Pages PR build passed; the isolated Java Worker build failed outside this change. The mainline GitHub Pages deployment succeeded on 2026-11-21 at run `44915066079` (commit `869d309ab0fa90b01c431c80bff4201ebd29a8b8`). Real teacher GitHub/private-repository verification remains necessary before calling the workflow operational. No Firebase backend deployment was required for this frontend/client-only work. |
| Shared V4 bulk assessment evaluation (GitHub 10 / other supported sources 20) | Merged to main and GitHub Pages released; authenticated teacher E2E pending | PR #257 merged 2026-11-21 (squash commit `5f5f16a854f517efc2345e788f7831d143717b7d`). The implementation generalizes the existing V4 bulk controller and compact V2 External AI package from Studio-only to every currently supported deployed submission source: native/historical Studio, native/historical student-submitted GitHub repository evidence (approval no longer required under PR #261), written/essay responses, and frozen HTTPS submission links. PR #271 was squash-merged to `main` at `5bf279fe46d88b4a40bb3813811479ffcdd39f03`; GitHub Pages build/deploy run `44966242824` succeeded. This frontend-only change requires no Firebase deployment. The teacher selects up to 10 eligible ungraded GitHub learners or 20 learners for Studio, essays and links; shared assessment instructions/rubric/checking guidance remain once per anonymous JSON package, while personalized scenarios, exact source and individual review evidence stay per learner. Internal AI processes independently per learner within one batch; External AI packages greedily fit as many complete learners as possible under 800,000 formatted JSON characters, defer overflow to later batches, and flag individually oversized evidence without truncating source. Historical GitHub uses its original school-scoped grade service; PR #261 removes the redundant mandatory contribution-approval step and excludes teacher-discovered snapshots from bulk selection; link-based AI suggestions require per-learner teacher confirmation of actual external artifact contents before saving. Existing private/published grades, attribution uncertainty, partial evidence, zero scores, and pending/teacher-confirmation scores are protected. PR #276 adds direct per-criterion **Final points** inputs for pending bulk AI results: the teacher can resolve a pending criterion to its final score without an additional reason field, the learner total is recalculated immediately, and the existing current-version/nonzero/private-draft protections still gate saving. PR #279 fixes false historical GitHub “evidence changed” failures for revisionless legacy records by preserving canonical evidence revision through repository preparation and adding a narrowly scoped compatibility path for already-open bulk batches without weakening real revision-1 concurrency checks. Publication remains separate. **Native MCQ/objective submissions are not yet a deployed V4 source** (`schoolAssessments` presently accepts Studio, GitHub, text, and link); add objective question-attempt/answer-key freezing and deterministic grading as the next source adapter to this *same* pipeline, not as a second bulk workflow. Focused JavaScript regressions and GitHub Pages production release passed (run `44922639960`); the new Firebase backend run `44922641024` is queued, and authenticated teacher end-to-end evaluation/save tests remain pending. School isolation, grade/evidence integrity, and private publication boundaries are retained. |
| V4 Studio bulk AI evaluation and private draft staging | Merged to main; backend/frontend release and operational validation pending | PR #237 merged to `main` on 2026-11-21 (commit `9b90ce4daf48e92f9a49ffec70a10c0514649e49`). The canonical V4 Review & Grade page supports bounded Internal AI (up to 10 per batch) and anonymous-reference External AI JSON evaluation for teacher-selected historical/native Studio submissions; original frozen source, exact personalized scenarios, rubric, and verification evidence are reused. Teacher can inspect per-criterion AI rationales and explicitly save eligible non-zero/no-pending/no-teacher-confirmation results as private grade drafts. The authorized legacy/native grade services reject overwriting an existing draft or published grade; bulk publication remains a separate teacher decision. JavaScript regressions passed; backend/frontend production releases, pending check conclusions and authenticated operational verification must be confirmed separately. No duplicate grade store or evidence migration was created. |
| V4 bulk External AI imported grade save-state hotfix | Merged to main; frontend release and authenticated operational validation pending | PR #240 merged 2026-11-21 (commit `900d05f922a783dbc2f68d2f1058e0d851fc0f32`). Corrects disabled **Save eligible private drafts** after successfully importing External AI JSON: saving no longer depends on retaining the original roster selection; imported eligible suggestions are selected separately with per-result inclusion controls, and the button shows the exact eligible count. Eligibility continues to enforce current ungraded submission version and positive/no-pending/no-teacher-confirmation AI results; the previously deployed backend rejects overwrite of existing grades. JavaScript tests and Pages PR build passed. User's already-open batch can use **Select ungraded** without refreshing; release new frontend and verify actual teacher operation before calling operational. |
| V4 Studio bulk next-ten selection and completed exchange reset | Merged to main and frontend released; authenticated operational verification pending | PR #243 merged 2026-11-21 (commit `df3f47c61e640d3a46d3cfcb2676a002a8b5178c`); GitHub Pages release succeeded at run `44901310138` on 2026-11-21. Initial Studio bulk roster selection and each post-save refresh select at most ten still-ungraded learners. Successful complete save clears the evaluation selection and completed external package/import JSON, then selects the next ten from authoritative grade records. Partial saves, missing source references and unfinished evaluation suggestions retain their JSON mapping and staged evidence for recovery; next selection excludes staged/exception records. Teacher can also manually select up to ten. Focused JavaScript regressions and Pages deployment succeeded; teacher-account end-to-end confirmation remains pending. No grade publication, evidence rewrite, schema change or backend redeployment. |
| V4 compact shared-once External AI batch packaging | Merged to main and frontend released; authenticated teacher verification pending | PR #244 merged 2026-11-21 (commit `27878670fbf787bde48305c1d2996a147e0da319`); GitHub Pages release run `44902536342` completed successfully. The canonical structured assessment/rubric/checking instructions and evaluator rules appear once in each compact V2 External AI batch, while each anonymous student retains the exact assigned variant, frozen source, hashes, automatic/execution verification, artifacts, and individual checking guidance when distinct. The existing V1 External AI response parser, anonymous reference matching, protected private draft saving and separate grade publication are unchanged; Internal AI and single-student evaluation remain unaffected. Representative ten-item exports were approximately 77% smaller; actual savings depend on code size. Focused JavaScript regression tests, source packaging and Pages build succeeded. Do not mark actually operational until a teacher exports, evaluates, imports and verifies drafts on a new real batch. Existing in-flight V1 exchanges should be saved before a reload. No backend deployment or data migration was required. |
| Historical Studio V4 learner ID compatibility hotfix | Merged to main; backend/frontend release and operational verification pending | PR #236 merged 2026-11-21 (commit `4bdd84b43749ed6241e92adede7976421eefa1a8`). Fixes V4's “Student is invalid” failure for older non-alphanumeric Firestore student document IDs (including email-like IDs), validates the original frozen personalized variant ID and restores the exact attempt variant or private-pool record without regenerating work. The fallback text is corrected. Focused regressions, Firestore permission tests, CodeQL and Pages checks passed. Firebase deployment, frontend release and actual Mini PETA #3 teacher review are separately verified before calling operational. |
| System Admin Operations Center | In development | Draft PR #194 contains the first-party observability/incident-management implementation. |
| Platform-wide account diagnostic timelines | Implemented on branch; PR / CI / deployment pending | 2026-11-24 support-diagnostics workstream extends the canonical global account directory with a **Platform Administrator-only**, reason-audited per-user timeline, while keeping existing platform account lifecycle audit records authoritative and PR #194 fleet observability a separate service. Server-owned `platform_account_diagnostics/{uid}/entries` receives bounded allowlisted metadata for authenticated verified users: session/page events, selected Run/Submit requests, Studio cloud-save confirmations, notification delivery/read signals, network/browser error codes and backend callable failure codes. The server never records source code, typed text, credentials, detailed URLs, report/message bodies, API payloads, marks or screenshots. Sign-in attempts before verified authentication, offline unsent events, and arbitrary user clicks are not guaranteed to appear. Platform Administrators must supply an audited support/security reason for each paginated read. School Admins, teachers and users cannot directly read or mutate diagnostic records through Firestore. Client events are append-only/idempotent, capped to 300 per account/day and expire at 60 days, with scheduled bounded cleanup; existing permanent account lifecycle audits remain separate. **Production governance:** publish transparent user notices, approved retention/incident access policy, deletion response and monitoring safeguards; logs are operational support signals, not academic effort, surveillance evidence or automatic misconduct findings. Do not mix with consent-gated learning research. |
| V4 verified-school / multi-school foundation | Foundation | PR #113 contains the broad V4 foundation; PR #186 staged selective main-first integration. These are not the roadmap anymore; their architectural invariants remain inputs to this document. |
| Games / Practice modernization | Evolving | School-scoped progress, challenges, analytics and game UX are operational/evolving. Global Games ranking derives active student memberships across every non-suspended/non-archived platform school, including controlled draft/migration schools, with privacy-safe aliases and current/preserved season XP; My class derives the current official section roster plus season scores instead of only previously materialized ranking rows. Teacher-assigned Practice Packs remain integrated into the Games Challenges surface. |
| Public editorial system / immersive entry experience | Merged to main and frontend released; authenticated qualitative/user acceptance pending | PR #270 established the public/guest horizon-path world, Opportunity Hunter, Pulse, Full/Quick mode, responsive composition and reduced-motion support. PR #293 then unified that immersive presentation with the **canonical operational role Home** instead of maintaining a second signed-in landing stage. The separate `avx-role-runway`, `Continue to operational dashboard` gate, cached `Return to my workspace` behavior and `workspace-return.mjs` path are retired. Student, Teacher, School Admin and System Admin Full Experience now decorates their actual role Home in place; Quick Mode removes scenery without changing destination or navigation semantics. Authenticated visits to the public root and Guest Explore resolve to the canonical role Home through the existing role-home contract, while protected destination guards remain authoritative for verified access. The official `assets/New Adminerva logo.png` remains the visible brand mark; optimized Adminerva environment artwork, guide-character art and lightweight portal/beacon/path/shard vectors provide the immersive world layer without fetching school-private data or replacing operational content. **Merged/released:** PR #293 squash-merged on 2026-11-24 as `fff9d893855db78eece135447737229f1cf878b9`; the repository's automatic shared-UI cache refresh produced production revision `5bea5a09d2e0d3416489dfc3951a24cb7bd2171a`, and GitHub Pages build/deploy run `45293729109` completed successfully for that revision. PR validation passed 56/56 real-Chromium viewport/entrypoint cases plus Adminerva quality/Firestore isolation, CodeQL, release packaging, Studio mobile UX and CheerpJ integration checks. Real authenticated user/device review and qualitative visual acceptance remain pending, so do not mark this experience fully operational yet. |
| Cloudflare edge services | Foundation / optional | Worker/R2/Queues/CheerpJ work exists. Firebase remains authoritative for school identity, academics, grades and evidence unless a separately approved change is made. |
| Registrar full SIS lifecycle | Released; E2E verification pending | PR #238 merged to main at `e9b95b055852a7e8349d59f5fe44da77d0714699`. The production Firebase deployment completed successfully, including creation of `schoolStudentRecords` and update of `schoolEnrollment`; GitHub Pages successfully released the post-merge cache-bumped frontend from `3217fbd7402033e4297bc2ba7165b66f115310a5`. A narrow verified `registrar` school membership role is staff-bound and limited to Enrollment & Registration plus Student Records / 201 File unless another role is separately granted. Released scope includes admissions review already inside Enrollment, official registration/placement, withdrawal/transfer classification, progression workflows, canonical Student Records aggregation, guardian relationship/contact lifecycle, exact released Class Record result display and registrar document-request tracking. Authenticated school end-to-end testing is still required before calling the workflow operational. Actual transcript/report-card/certificate file generation, parent/guardian portal authority, richer records retention/release controls and Registrar reporting remain future work. |
| Parent/Guardian services | Partial foundation released | PR #238 released canonical school-scoped guardian contacts and distinct student-to-guardian relationships, including primary-contact selection, lifecycle preservation, legacy primary-guardian snapshot adoption and enrollment seeding. People & Access no longer edits guardian relationships in the normal UI; Student Records is the relationship authority. Parent/Guardian account invitation/authentication, consent/authority rules, portal views and messaging remain future work. |
| Personnel / HR | Planned | Teaching relationships exist; full personnel records, DTR, leave, contracts, payroll and HR lifecycle are future modules. |
| Finance | Planned | Navigation/future architecture exists; no canonical complete finance system is established yet. |
| Clinic / Guidance | Planned | Navigation/future architecture exists; health and counseling records require stricter dedicated permissions. |
| Cafeteria / Uniforms / School Store | Planned | Should be built on a shared commerce/transaction/inventory foundation rather than independent ad-hoc modules. |
| Facilities / Assets / Procurement | Planned | Future campus-operations modules. |
| Library / Transport / Security | Planned | Future campus-service modules. |
| Pilot Studio process analytics (test-designated accounts only) | PR #287 merged and Firebase backend + GitHub Pages release confirmed successful (2026-11-23); collection for authenticated test users not yet E2E verified. PR #291 merged to main 2026-11-24 (`ca8309cc21dc2b02fd56bf48c62bc919bdcebaae`); enhanced frontend released (GitHub Pages run #45290407099 succeeded), Firebase backend deploy and authenticated collection verification not yet confirmed | The 2026-11-23 pilot research workstream adds a school-scoped, server-authorized observation service for **explicitly designated active test-student accounts** with verified student memberships. Studio emits bounded project-open, aggregated editor-change, execution-outcome and confirmed-cloud-save events. The backend accepts only allowlisted structured metadata (no source code, typed text, output, filenames, clipboard, grades or screen recording), imposes a daily per-account write limit, retains research events for 90 days with bounded scheduled expiry cleanup, and rejects unverified or non-test accounts. System Admin receives aggregate-only per-school counts from existing people, membership, enrollment, assessment, Studio submission, GitHub evidence and grade stores plus a transparently capped recent pilot-event sample. Existing academic evidence remains canonical; no historical events are fabricated. PR #291 adds exact 30-day event counts separated from newest-500-event research samples, run-outcome/edit-operation summaries, aggregate CSV export and a visible Studio collection-confirmation indicator; new behavioral events remain prospective. Unsolicited legacy activity and GA4 consent banners are deferred for the testing period, without silently enabling GA4 or removing existing Settings controls. **Before an actual school production rollout**, restore appropriate user/school notices and privacy choices, document the lawful processing basis, authorized researchers, retention/export and deletion controls, test role/tenant isolation and sampling completeness, and explicitly authorize production collection; test designation must never imply blanket school enrollment consent. |
| Institutional reporting/compliance | Planned / partial | Audit and operational analytics exist in parts; comprehensive institutional reporting remains future work. |

## 6. Current priority sequence

### Priority 0 — Keep one product direction

- Use this document as the only development roadmap/progress tracker.
- Do not create new roadmap, future-plan or implementation-tracker documents.
- Technical documents may describe how a feature works, but their status/priorities must point back here.
- A PR that materially changes product scope, module status or next priorities should update this document.

### Priority 1 — Consolidate the existing administration foundation

Complete the architectural direction already implemented in PR #215:

1. School Profile & Campuses
2. Academic Configuration
3. People & Access
4. Classes & Scheduling
5. Enrollment & Registration
6. Grading Policies
7. Attendance Oversight
8. Class Record Oversight

Remove normal administrator dependence on duplicated legacy teacher/section/subject assignment pages. Retain legacy paths only as controlled compatibility/migration surfaces.

#### CRUD and record-lifecycle rule

Canonical administrator-owned records must expose the lifecycle needed for real school maintenance:

- **Create** new canonical records without creating duplicate identities or duplicate academic authorities.
- **Read/search** active and archived records with school-scoped context and deep links.
- **Update** active records with optimistic revision checks; structural edits must be blocked when they would rewrite active dependent relationships.
- **Archive / retire** records instead of deleting them when historical relationships, grades, submissions, attendance, payments, audit trails or other evidence may exist.
- **Restore** archived records deliberately, revalidating parent/dependency state rather than blindly reviving old access, staffing or schedules.
- Ordinary School Admin UI must not expose hard delete for people, registrations, classes, grades, assessments or other historically meaningful records. Permanent deletion is reserved for narrowly reviewed recovery/migration cases where the record is proven unreferenced and retention rules allow it.
- Teacher CRUD means lifecycle management of the canonical **staff person**, school membership/access and teaching assignments; do not create a separate competing teacher-person table.
- Course CRUD distinguishes the reusable **subject/course catalog record** from the year/period/section-specific **class offering**.
- Continue this lifecycle audit across campuses, grading policies, schedules, departments, facilities/assets, inventory/catalog items and future School OS master data **as those modules become canonical**; do not create placeholder CRUD stores ahead of the authoritative domain model.
- Keep teacher-owned artifact lifecycle separate from administrator master-data CRUD. An explicit owner-only Assessment Studio blueprint Restore path is implemented on the current CRUD completion branch, **not yet released**. It must retain a private-by-default audience until consciously shared, and must preserve existing deployment/evidence history.
- Global Firebase login identity is a separate platform lifecycle from the school person record. System Admin may create an unassigned login, correct its display name, disable/restore sign-in, and generate an audited password reset link. These actions must not silently reassign school identity or academic ownership. Ordinary hard delete is not a normal CRUD action for accounts that may be referenced by historical school records.
- Test-student mobility is an explicit platform testing capability, not a normal SIS transfer. Only a deliberately designated test login may be granted student access in another active/pilot school. The target school receives its own student person/membership; existing source-school identity, registration, grades, submissions, evidence and Studio history stay untouched. Placement changes then use the target school’s canonical registration or compatibility placement workflow.
- Platform Administrator authority is an audited relationship separate from the login itself. It may be granted, retired and restored without deleting the underlying account; self-retirement and retirement of the last active explicit Platform Administrator must fail closed.
- Platform school tenants use lifecycle semantics instead of deletion. The platform-owned registry label may be corrected with revision/audit protection; only draft or suspended tenants may be archived, and restore returns them to a safe prior state rather than directly to active production.
- Mutable legacy monitoring assignment configuration requires create/update/retire/restore with revision history. Raw telemetry and expired diagnostics are observational/retention-governed data, not administrator-owned master-data CRUD.
- Support reports are preserved records. System Admin may triage, close/reopen, lock/unlock and classify them with reasons and optimistic revision history; ordinary hard delete is not part of the support lifecycle.
- Public release history is source-controlled publication history. Do not add direct CRUD editing merely because it appears in System Admin navigation; release entries remain governed by reviewed repository release authority.


### Priority 2 — Complete the SIS student lifecycle

Build one continuous lifecycle:

Application -> review -> acceptance -> registration -> section placement -> account activation -> active classes -> attendance/academic records -> promotion/retention/transfer/withdrawal/graduation.

Required additions:

- Admissions/application queue — basic reviewed application queue exists; continue toward full Registrar ownership.
- Guardian relationship model and portal preparation — canonical guardian contacts and distinct student relationships are implemented on PR #215 with migration/adoption support; account/portal authority, consent and guardian-facing workflows remain.
- Effective-dated placement/transfer history — individual canonical registration/section/progression history is implemented on PR #215; retain one history derived from registration and audit records.
- Promotion/retention processing — individual and bounded section-cohort Promotion/Retention/Graduation with released-Final-Grade readiness, final-period gating and independent audited commits is implemented on PR #215; larger cohorts still require paginated Registrar processing.
- Withdrawal/transfer handling — explicit registration end classification exists; complete broader transfer documentation/records workflow.
- Student records and credentials — the Student Records / 201-file aggregation and document-request lifecycle are implemented on PR #215; actual report-card/transcript/certificate generation, templates, verification and controlled file release remain.
- Document/certificate requests — request/in-review/ready/released/cancelled workflow with audited release reference is implemented on PR #215; self-service requester intake, fee integration where applicable and generated document delivery remain.
- Registrar reporting

### Priority 3 — Finish academic-operational integration

- Stabilize class-centered Teacher Classroom
- Complete teacher Preparation -> Classroom handoffs
- Complete Assessment -> Gradebook -> Class Record linkage
- Extend the canonical Assessment submission and grade pipeline with frozen MCQ/objective attempts, protected answer keys and deterministic scoring; connect those attempts to the canonical source-aware bulk review rather than building separate MCQ bulk screens.
- Verify GitHub student-submission-first eligibility and frozen checkpoint ancestry against real teacher/student records; preserve historical instructor-discovered snapshots as ungraded context rather than requiring a second approval. Map historical academic terms only with confirmed identity/enrollment evidence, then retire redundant RepoFetch evaluator/inspector navigation without rewriting original grades or evidence.
- Finish practical-exam session release
- Expand attendance reporting and school calendar behavior
- Continue student/teacher mobile workflow cleanup
- Publish and maintain one public Adminerva download/install page with verified links only; connect signed desktop/mobile distribution once native clients and stores are actually released.
- Deliver cross-platform Adminerva as **one canonical School OS**, not four duplicated products: first secure public-only desktop preview and mobile web-asset staging with a shared client compatibility contract, then a verified system-browser/Firebase native sign-in handoff and protected Studio class-exam workflow, then app-store-compliant Capacitor Android/iOS clients. Hosted desktop web content can pick up compatible site releases without native rebuild; bundled mobile assets and any new native OS permission/bridge must be released through signed native updates. Keep native Companion monitoring off until its school-scoped permission/session/privacy controls exist.
- Continue school-scoped Practice/Games consolidation

**Registrar authority boundary:** the `registrar` membership role is departmental and must remain separate from `school_admin`. School Admin grants/revokes the role from canonical staff access; Registrar operates Enrollment and Student Records only unless another role is explicitly granted.

### Priority 4 — Complete System Administration

- Validate the released Platform Users global-login lifecycle with authenticated Platform Administrator credentials while keeping school-person recovery in school-scoped People & Access
- Validate the released System Admin CRUD coverage and test-student multi-school mobility with authenticated Platform Administrator credentials, including school switch, compatibility placement, source-history preservation, assisted access suspension and test-designation retirement
- Preserve non-CRUD operational boundaries: release history remains source-controlled, telemetry remains observational/retention-governed and audit history remains append-only
- Integrate Operations Center concepts with the current System Admin workflow
- Keep platform observability separate from private school academic data
- Establish clear school lifecycle, recovery, Assist, feature rollout and incident operations
- Keep standard-school activation as a minimum tenant-foundation gate: verified School Administrator + saved profile + coherent active academic offering; staffing, enrollment, grading and daily operations remain School Administration responsibilities after activation
- Remove remaining confusion between legacy Administration Analytics and canonical School Administration

### Priority 5 — Build the financial transaction foundation

Before cafeteria, uniforms or advanced online payments, establish a shared audited transaction model:

- Account/ledger
- Charge
- Payment
- Receipt
- Adjustment
- Refund
- Reconciliation
- Payment method/provider reference
- Department/cost-center classification
- Audit trail

Then build student billing/cashiering and allow school services to reuse the payment infrastructure without sharing inappropriate private data.

### Priority 6 — Student Services: Clinic, Guidance and Welfare

Build restricted departmental workspaces referencing the canonical learner identity:

- Clinic encounters and health records
- Medication/supply logging
- Incident/referral workflow
- Medical clearance
- Guidance/counseling
- Discipline/case management
- Emergency contact workflow

Health/guidance access must be narrower than general School Admin access wherever practical.

### Priority 7 — Commerce and campus services

Build a shared catalog/inventory/POS foundation, then support:

- Cafeteria/canteen
- Uniforms
- School supplies/merchandise
- Inventory and stock movement
- Purchasing/procurement
- Suppliers
- Facilities/assets/maintenance

### Priority 8 — Personnel, parent services and institutional operations

- HR/personnel records
- DTR/leave
- Contracts/appointments
- Payroll/benefits
- Parent/Guardian portal
- Library
- Transport
- Security/visitor workflows
- Institutional reports/accreditation
- Document approvals and retention

## 7. Canonical administrator workflow

A School Administrator should not need to understand Adminerva's internal page history.

The normal setup/operations sequence is:

1. **School Profile & Campuses** — verify institution identity and campuses.
2. **Academic Configuration** — establish academic year, periods, programs, sections and subjects.
3. **People & Access** — establish people, accounts, school roles and access.
4. **Classes & Scheduling** — create offerings, assign teachers/advisers, schedules and roster authority.
5. **Enrollment & Registration** — register learners and establish official placement. Exact directory-student handoffs should bind to the reviewed person record; section corrections should create a new official placement while preserving superseded registration/enrollment history and leaving selective/elective enrollments independent.
6. **Student Records / Registrar** — maintain the learner 201-file aggregation, guardian relationships, released academic-record view and document-request lifecycle. Verified Registrar staff may operate Enrollment and Student Records without receiving broader School Admin authority.
7. **Grading Policies** — define school grading structures and ensure every active class resolves to exactly one highest-specificity policy before Class Record finalization.
8. **Operate the school** — Classroom, assessments, attendance, Gradebook and Class Record.
9. **Monitor exceptions** — dashboard should surface incomplete foundation setup, missing staffing, schedule conflicts, unplaced learners, grading-policy gaps/overlaps, attendance gaps and other operational issues.

Future departments should join this same action-oriented model rather than adding unrelated dashboard trees.

## 8. UX direction

- Prefer role/workspace navigation over feature-file navigation.
- Prefer one selected class/student/context that persists through related workflows.
- Deep-link to the exact person, class, assessment or issue that requires action.
- Show the next operational action instead of making administrators infer it.
- Avoid duplicate configuration forms for the same relationship.
- Separate ordinary work from advanced recovery/migration tools.
- Preserve usable mobile layouts from 320 px upward.
- Use meaningful empty, loading, stale, conflict and permission states.
- Do not expose future placeholder modules as though they are already functional.
- Public, guest, student, teacher, School Admin and System Admin entrypoints can reuse immersive illustrative activities and approved editorial cards without replacing canonical classroom/administration workflows. Scenes must not imply private user activity is publicly visible; respect reduced-motion and mobile accessibility.
- The public, guest and editorial discovery experience should feel like **one Adminerva visual world**, not separate themed microsites or a conventional landing page with effects. Navigation should be carried by the scene/path itself rather than permanent chapter chrome. Avoid orbit/radar/constellation motifs, floating pill navigation, decorative particles, oversized copy that competes with content, and card grids as the primary immersive language. Preserve the four canonical public editorial channels, source verification and published release authority. Opportunity Hunter should prioritize progressive discovery with search/filter as utility; Pulse should communicate movement over time; signed-in Full Experience must live **inside the canonical operational role Home**, not as a second landing stage or dashboard handoff; Home must resolve to one role-canonical destination across logo links, login routing and public-root redirects. Responsive composition must be deliberate for desktop, laptop, tablet portrait/landscape, 320–430 px mobile portrait and short-height mobile landscape, with touch, keyboard, coarse-pointer, safe-area and reduced-motion support. PR #270 merged and its frontend was released on 2026-11-22 after 56/56 focused Chromium viewport checks and repository safety checks passed; signed-in role acceptance and qualitative visual approval remain pending before treating the experience as fully operational.
- The Opportunity Hunter may show source-checked public training, scholarship, competition, internship and career opportunities with checked eligibility and application deadlines where available. Use public-only sources, never student or school-private data. Keep provider links, verification and expiry visible.

## 9. Security, privacy and audit boundaries

- School-private data is always school-scoped.
- Cross-school IDs from URL/localStorage never grant access.
- High-impact writes should use current server authority and revision/concurrency checks where needed.
- Grades, submissions, health records, finance records and private teacher materials have distinct permission boundaries.
- Platform support/Assist access must be deliberate and audited.
- Historical records should be ended/archived/revisioned instead of silently deleted.
- Department-specific privacy requirements must be designed before broad rollout.
- No future external AI, storage or edge service becomes authoritative for academic records merely because it is convenient.

## 10. Development and release discipline

1. Implement against canonical records before inventing another store.
2. Reuse existing authoritative services where they already model the domain correctly.
3. When replacing a legacy path, provide an explicit handoff/migration rather than maintaining two normal workflows indefinitely.
4. Keep changes school-scoped and role-scoped from the beginning.
5. Keep validation focused. Always protect tenant isolation, permissions, grade/evidence integrity, money transactions and sensitive health/identity operations.
6. Distinguish clearly between:
   - implemented on a branch;
   - merged to main;
   - backend deployed;
   - frontend released;
   - operationally enabled.
7. Do not describe a feature as live merely because its PR exists.
8. Avoid broad release process expansion unless it materially reduces a real production risk.
9. Codex Scheduled Tasks may prepare public editorial changes in four independent channels: daily experiences, daily release notes/announcements, daily Opportunity Hunter and Friday Pulse. New content is approved by review/merge of a PR, not an automatic rewrite of the live site. Public release claims still require confirmed shipped status; existing patch-history remains canonical. See `ops/public-editorial-automation.md` for the implementation contract.

## 11. Documents and planning governance

The repository should contain four kinds of documentation only:

- **This master plan:** product direction, development status, priorities and future work.
- **Technical specifications:** exact architecture/data/workflow contracts for a feature.
- **Operational runbooks:** deployment, migration, recovery and incident procedures.
- **Historical/release records:** what a specific release/branch implemented.

Older documents with titles such as plan, roadmap, implementation tracker or phases are retained only for engineering history or detailed technical context. Their progress tables and future priorities are not authoritative.

When useful information from an older plan changes the product direction, move that decision into this master plan. Do not start a second master document.

## 12. Immediate next actions

1. Validate the already merged/released PR #215 School Admin/System Admin lifecycle workflows in authenticated school contexts; make focused corrections to the canonical implementation.
2. Treat the practical-exam open/close workflow as operational after the 2026-11-23 live classroom use and post-exam resilience release. Review Class save history for completed sessions, run only focused cross-device/quota/offline acceptance for the new resilience paths, and reopen the workstream only for concrete defects.
3. Finish CRUD lifecycle gaps in existing canonical services, including owner-only blueprint Restore, archived-campus editing protection, and the audited System Admin global-account lifecycle; verify permission, identity-boundary, dependency and evidence integrity before release. Keep newer Class Record, Studio, practical-exam, Games and assessment-personalization code intact.
4. Finish the standard SIS student lifecycle and complete dependency-aware CRUD/archive/restore coverage for canonical administrator-owned master data before building many independent service modules.
5. Use the canonical school/person/class/enrollment model as the foundation for Finance, Clinic, Cafeteria, Uniforms and the remaining School OS modules.
6. Keep this file updated whenever a major workstream is merged, deployed, superseded or newly prioritized.
