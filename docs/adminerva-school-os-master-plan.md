# Adminerva School OS — Master Development Plan

**Canonical roadmap and development-status document**  
**Last consolidated:** 2026-11-21  
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

## 5. Development status as of 2026-11-21

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
| Student account replacement / recovery | Released; Davis compatibility E2E verification pending | PR #241 released the preview-first, revision-safe account replacement workflow while preserving the canonical school person, registration/enrollment history, grades, submissions, evidence, Studio projects/personalized variants, repository settings and private assessment conversations. PR #249 merged the recovered-student Classroom/Subject route fix at `25db0f5a3b30584c68266f05e3aac505aa8afc5a`. Live Davis verification then exposed a compatibility-only gap: older programming assessments and personalized Studio variants still resolved learners by the current Firebase email even though recovery deliberately preserves the original legacy `students/{id}` linkage on the canonical person. PR #250 merged to `main` at `5e564c7135d1667882bbd4c6d4e27b9fad80c94a`, with JavaScript regressions, Firestore security, CodeQL and JavaScript/TypeScript analysis passing; GitHub Pages and Firebase Functions/Firestore deployment both completed successfully. A subsequent Davis screenshot proved the browser was still receiving the pre-#250 student assessment module because `student-assessments.html` retained the old `20261121-studio-route-hotfix` cache key and footer build `25db0f5a3b30`. PR #253 merged to `main` at `bc2b05616b36fd4f35ea68dffef225423479a498`; it publishes cache-safe versions for `student-assessments.html -> assessments.js -> student-access.mjs`, extends the shared UI/access cache-bump workflow to keep those references synchronized automatically, and adds a regression against the stale pre-recovery keys. The generated cache-bump commit `b1b5ce477ff465b72d6a4171a175f72f567d11bd` deployed successfully to GitHub Pages, and the three relevant references now use build key `bc2b05616b36`. No enrollment, assessment, submission, grade, evidence or Studio record was rewritten or duplicated. Authenticated Davis verification of the older assignment, personalized Studio task, submission history and grades remains required before calling the entire recovery path operational. |
| Core administrative CRUD / record lifecycle | Released; E2E verification pending | PR #215 merged to `main` on 2026-11-21 at `79d27269538ae39a7dcfc19d990942f494933d5a`. The reconciled release standardizes revision-safe Create / Read / Update / Archive / Restore across canonical people, invitations/access artifacts, academic master data, classes and related administrator-owned records while preserving registration, enrollment, staffing, adviser, grade, submission and audit history. GitHub Pages released the cache-bumped frontend from `d8c2d082fd16f3e3fea2482e89a4479182c97abd`, and the Firebase Functions/Firestore production deployment completed successfully. Authenticated school end-to-end verification remains required before calling the workflow operational. |
| System Admin + School Admin workflow consolidation | Released; E2E verification pending | PR #215 merged to `main` on 2026-11-21 at `79d27269538ae39a7dcfc19d990942f494933d5a` after reconciling newer Studio, assessment, Registrar, Class Record and bulk-evaluation work. The released administrator workflow covers School Profile & Campuses, Academic Configuration, People & Access, Classes & Scheduling, Enrollment & Registration, Grading Policies, Attendance Oversight and Class Record Oversight; System Admin Preview remains non-mutating and Assist remains explicit/audited. Frontend and Firebase backend release workflows both completed successfully; authenticated role-by-role operational verification is still pending. |
| Classes & Scheduling | Released; E2E verification pending | PR #215 released the canonical Class Offering workspace with staffing, derived teacher load, section coverage, official schedules, adviser assignment and explicit roster authority using existing `course_offerings`, `staff_assignments`, registrations and enrollments rather than a parallel source of truth. Production frontend/backend releases completed; authenticated administrator/teacher roster and schedule validation remains pending. |
| Enrollment & Registration lifecycle | In development | Standard registration exists and PR #215 now adds exact directory-student deep links, reviewed-person binding, history-preserving same-grade/same-period section correction, automatic-roster synchronization that excludes selective/elective classes, registration lifecycle ownership that preserves unrelated selective enrollments, and explicit withdrawal / transfer-out / cancellation classifications without deleting historical records. The SIS progression slice is now implemented on the branch: individual and bounded cohort Promotion/Retention/Graduation reuse one canonical registration-transition transaction; require the exact reviewed registration revision; are available only from the last active configured academic period; gate progression on the student’s released Class Record Final Grades for every registration-owned class; reconcile registration-owned roster counts; revalidate target academic structure, future academic year and identity requirements; preserve the completed source registration; create a linked next registration and automatic roster for Promotion/Retention; record Graduation without inventing a next placement; block direct Restore of progressed registrations; and expose school-scoped effective-dated placement/audit history from the existing canonical records. Cohort preview is bounded to 60 active learners, runs individual readiness checks with controlled concurrency, and applies only Ready learners as independent audited transactions so blocked/failed records remain unchanged. New standard registrations also seed the canonical guardian contact/relationship while retaining the older guardian snapshot for compatibility. CI execution, merge, release and operational verification remain pending. |
| Teacher Classroom consolidation | In development | PR #215 organizes Stream, Classwork, roster, submissions, grades and Class Record around one selected class. |
| Advisory and school attendance | In development | PR #215 implements adviser authority, daily attendance and School Admin oversight. |
| Class Record | Operational / evolving | School-scoped Class Record exists; PR #215 improves assessment links and administrator oversight, reports grading-policy coverage/conflicts, makes per-class policy failures actionable, and prevents equal-specificity policy overlaps at save time. |
| Practical exam manual open/close | Merged; deployment/operational verification pending | PR #223 merged the backend-first stage; PR #224 fixed first deployment bootstrap behavior; PR #216 then merged the teacher/student UI and complete session workflow. Do not call the workflow operational until the corresponding backend/frontend release state is confirmed in production. |
| Assessment Studio multi-class deployment and date-range scheduling | Merged; frontend release/operational verification pending | PR #228 merged to `main` on 2026-11-21. The canonical form now supports multiple authorized class offerings and two-click date-range scheduling while preserving independent per-class assessments, teacher-controlled exam sessions and audit history. Production frontend availability and end-to-end operation not yet confirmed. |
| Assessment Studio deployment-first personalization | Merged to main; backend/frontend release and operational verification pending | PR #231 merged to `main` on 2026-11-21 (commit `2e94339d4adbba13272b706d0675c7494bb4c6f3`). The canonical deployment flow selects assigned classes and dates before determining private variants from authorized active enrollment, recognizes already-deployed blueprints, reuses sufficient activated pools, and removes manual pool sizing from the creation form. Existing school deployments and legacy historical assignments remain preserved. Verify Firebase Functions and frontend production release separately before calling this operational. |
| Studio student-project recovery and legacy Studio-only submission UI | Merged to main; backend/frontend release and operational verification pending | PR #230 merged to `main` on 2026-11-21 (commit `afa2777b78b331f937ecfc90ac69b1cad1e3f5f3`). The hotfix guards in-memory editor state, canonical cloud saves and accidental blank uploads; restores student-owned frozen V4 sources with teacher-session access controls; identifies legacy submitted project IDs and verified source to offer non-destructive recovery; and hides repository-only GitHub revision controls for Studio assessments. CodeQL, targeted regressions and Firestore checks passed. Firebase Functions deployment and live frontend operation must be verified separately. |
| Legacy Repository Management deployment visibility and schedule editing | Merged to main; frontend release and operational verification pending | PR #233 merged to `main` on 2026-11-21 (commit `fad25b9ea6f1bcac929063f8fb260117ecfc1950`). The canonical Deployed Tasks view now includes teacher-owned legacy deployments through the existing owner-scoped API, with links to each original class schedule; the historical editor supports direct existing-deployment links, deadline extension and late-submission changes while preserving the original assignment date and evidence. Existing variants, submissions and grades are not migrated, cloned or changed. Verify GitHub Pages frontend release and real legacy update workflow before marking operational. |
| V4 unified historical assessment review and verified conversion readiness | Merged to main; backend/frontend release and operational validation pending | PR #234 merged on 2026-11-21 (commit `f183ada74a6770212704917a6c6227076d4d2209`). Teacher-owned historical Adminerva Studio submissions can be reviewed from V4 using an audited owner/school-scoped read-through adapter: verified frozen code/variant evidence, private drafts, reviewed-grade publishing and bounded non-zero bulk publication update the original legacy grade record, not a duplicate V4 grade. Historical published scalar grades do not fabricate rubric breakdowns; source and grades remain authoritative in their legacy collections. A read-only readiness preview checks identity, enrollment and historical-term provenance before any future physical migration. Historical GitHub evidence still requires its existing review workflow. CodeQL, focused JavaScript regressions, Firestore security and Pages build passed; isolated Java Worker build failed independently. Firebase Functions deployment, frontend release and end-to-end teacher verification are still required before marking operational. |
| Historical Repository Management GitHub read-through in V4 | Implemented on branch; not yet merged, deployed or operational | Branch `feat/v4-historical-github-readthrough-20261121` adds an original-record read-through adapter under the existing school-scoped `schoolAssessmentMigration` callable: original owner/imported blueprint checks, historical `assessment_evidence` inbox and inspection, V4 collapsed commit links, explicit individual-commit scope for AI, and transactional rubric draft/publication updates solely to the original `student_grades` and `grade_revisions` records. Existing published scalar grades remain protected; unpublished scalar drafts require original-workflow resolution instead of silent rubric fabrication. Unapproved/attribution-disputed historical evidence retains a link to the old verification page until safe approval controls are integrated in V4; no legacy UI is deleted yet. Historical outcomes are not projected to V4 Class Record without verified academic term/enrollment mapping. Focused ownership, version, frozen SHA, zero-score and provenance tests are required. |
| V4 repository evidence consolidation into Review & Grade | Merged to main and frontend released; authenticated teacher verification pending | PR #251 merged to main on 2026-11-21 (squash commit `4d832fac3dc744de684ccec6823cb15935521c18`). The implementation adds bounded checkpoint-pinned source retrieval to V4 GitHub evaluation, reuses the conservative legacy commit-substance classifier, carries source/coverage/merge/attribution limits into Internal/External AI packages, and reduces teacher-facing commit inspection to a collapsed per-commit GitHub link list. The canonical V4 approval, protected draft, publication and Class Record flow remains unchanged; no evidence or grade migration is performed. Historical Repository Management GitHub assessments still require an owner/identity-verified read-through grading adapter before their old grade path can retire. Focused JavaScript regressions, CodeQL, Firestore checks, and Pages PR build passed; the isolated Java Worker build failed outside this change. The mainline GitHub Pages deployment succeeded on 2026-11-21 at run `44915066079` (commit `869d309ab0fa90b01c431c80bff4201ebd29a8b8`). Real teacher GitHub/private-repository verification remains necessary before calling the workflow operational. No Firebase backend deployment was required for this frontend/client-only work. |
| V4 Studio bulk AI evaluation and private draft staging | Merged to main; backend/frontend release and operational validation pending | PR #237 merged to `main` on 2026-11-21 (commit `9b90ce4daf48e92f9a49ffec70a10c0514649e49`). The canonical V4 Review & Grade page supports bounded Internal AI (up to 10 per batch) and anonymous-reference External AI JSON evaluation for teacher-selected historical/native Studio submissions; original frozen source, exact personalized scenarios, rubric, and verification evidence are reused. Teacher can inspect per-criterion AI rationales and explicitly save eligible non-zero/no-pending/no-teacher-confirmation results as private grade drafts. The authorized legacy/native grade services reject overwriting an existing draft or published grade; bulk publication remains a separate teacher decision. JavaScript regressions passed; backend/frontend production releases, pending check conclusions and authenticated operational verification must be confirmed separately. No duplicate grade store or evidence migration was created. |
| V4 bulk External AI imported grade save-state hotfix | Merged to main; frontend release and authenticated operational validation pending | PR #240 merged 2026-11-21 (commit `900d05f922a783dbc2f68d2f1058e0d851fc0f32`). Corrects disabled **Save eligible private drafts** after successfully importing External AI JSON: saving no longer depends on retaining the original roster selection; imported eligible suggestions are selected separately with per-result inclusion controls, and the button shows the exact eligible count. Eligibility continues to enforce current ungraded submission version and positive/no-pending/no-teacher-confirmation AI results; the previously deployed backend rejects overwrite of existing grades. JavaScript tests and Pages PR build passed. User's already-open batch can use **Select ungraded** without refreshing; release new frontend and verify actual teacher operation before calling operational. |
| V4 Studio bulk next-ten selection and completed exchange reset | Merged to main and frontend released; authenticated operational verification pending | PR #243 merged 2026-11-21 (commit `df3f47c61e640d3a46d3cfcb2676a002a8b5178c`); GitHub Pages release succeeded at run `44901310138` on 2026-11-21. Initial Studio bulk roster selection and each post-save refresh select at most ten still-ungraded learners. Successful complete save clears the evaluation selection and completed external package/import JSON, then selects the next ten from authoritative grade records. Partial saves, missing source references and unfinished evaluation suggestions retain their JSON mapping and staged evidence for recovery; next selection excludes staged/exception records. Teacher can also manually select up to ten. Focused JavaScript regressions and Pages deployment succeeded; teacher-account end-to-end confirmation remains pending. No grade publication, evidence rewrite, schema change or backend redeployment. |
| V4 compact shared-once External AI batch packaging | Merged to main and frontend released; authenticated teacher verification pending | PR #244 merged 2026-11-21 (commit `27878670fbf787bde48305c1d2996a147e0da319`); GitHub Pages release run `44902536342` completed successfully. The canonical structured assessment/rubric/checking instructions and evaluator rules appear once in each compact V2 External AI batch, while each anonymous student retains the exact assigned variant, frozen source, hashes, automatic/execution verification, artifacts, and individual checking guidance when distinct. The existing V1 External AI response parser, anonymous reference matching, protected private draft saving and separate grade publication are unchanged; Internal AI and single-student evaluation remain unaffected. Representative ten-item exports were approximately 77% smaller; actual savings depend on code size. Focused JavaScript regression tests, source packaging and Pages build succeeded. Do not mark actually operational until a teacher exports, evaluates, imports and verifies drafts on a new real batch. Existing in-flight V1 exchanges should be saved before a reload. No backend deployment or data migration was required. |
| Historical Studio V4 learner ID compatibility hotfix | Merged to main; backend/frontend release and operational verification pending | PR #236 merged 2026-11-21 (commit `4bdd84b43749ed6241e92adede7976421eefa1a8`). Fixes V4's “Student is invalid” failure for older non-alphanumeric Firestore student document IDs (including email-like IDs), validates the original frozen personalized variant ID and restores the exact attempt variant or private-pool record without regenerating work. The fallback text is corrected. Focused regressions, Firestore permission tests, CodeQL and Pages checks passed. Firebase deployment, frontend release and actual Mini PETA #3 teacher review are separately verified before calling operational. |
| System Admin Operations Center | In development | Draft PR #194 contains the first-party observability/incident-management implementation. |
| V4 verified-school / multi-school foundation | Foundation | PR #113 contains the broad V4 foundation; PR #186 staged selective main-first integration. These are not the roadmap anymore; their architectural invariants remain inputs to this document. |
| Games / Practice modernization | Evolving | School-scoped progress, challenges, analytics and game UX have been developed through the recent Practice/Games PR series. |
| Cloudflare edge services | Foundation / optional | Worker/R2/Queues/CheerpJ work exists. Firebase remains authoritative for school identity, academics, grades and evidence unless a separately approved change is made. |
| Registrar full SIS lifecycle | Released; E2E verification pending | PR #238 merged to main at `e9b95b055852a7e8349d59f5fe44da77d0714699`. The production Firebase deployment completed successfully, including creation of `schoolStudentRecords` and update of `schoolEnrollment`; GitHub Pages successfully released the post-merge cache-bumped frontend from `3217fbd7402033e4297bc2ba7165b66f115310a5`. A narrow verified `registrar` school membership role is staff-bound and limited to Enrollment & Registration plus Student Records / 201 File unless another role is separately granted. Released scope includes admissions review already inside Enrollment, official registration/placement, withdrawal/transfer classification, progression workflows, canonical Student Records aggregation, guardian relationship/contact lifecycle, exact released Class Record result display and registrar document-request tracking. Authenticated school end-to-end testing is still required before calling the workflow operational. Actual transcript/report-card/certificate file generation, parent/guardian portal authority, richer records retention/release controls and Registrar reporting remain future work. |
| Parent/Guardian services | Partial foundation released | PR #238 released canonical school-scoped guardian contacts and distinct student-to-guardian relationships, including primary-contact selection, lifecycle preservation, legacy primary-guardian snapshot adoption and enrollment seeding. People & Access no longer edits guardian relationships in the normal UI; Student Records is the relationship authority. Parent/Guardian account invitation/authentication, consent/authority rules, portal views and messaging remain future work. |
| Personnel / HR | Planned | Teaching relationships exist; full personnel records, DTR, leave, contracts, payroll and HR lifecycle are future modules. |
| Finance | Planned | Navigation/future architecture exists; no canonical complete finance system is established yet. |
| Clinic / Guidance | Planned | Navigation/future architecture exists; health and counseling records require stricter dedicated permissions. |
| Cafeteria / Uniforms / School Store | Planned | Should be built on a shared commerce/transaction/inventory foundation rather than independent ad-hoc modules. |
| Facilities / Assets / Procurement | Planned | Future campus-operations modules. |
| Library / Transport / Security | Planned | Future campus-service modules. |
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
- Keep teacher-owned artifact lifecycle separate from administrator master-data CRUD. Assessment blueprints currently support create/update/archive; add an explicit reviewed Restore path in the teacher Assessment/Preparation workstream rather than making archive silently permanent.


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
- Complete the verified historical GitHub assessment read-through handoff into V4 Review & Grade, then retire redundant RepoFetch evaluator/inspector navigation without rewriting original grades or evidence.
- Finish practical-exam session release
- Expand attendance reporting and school calendar behavior
- Continue student/teacher mobile workflow cleanup
- Continue school-scoped Practice/Games consolidation

**Registrar authority boundary:** the `registrar` membership role is departmental and must remain separate from `school_admin`. School Admin grants/revokes the role from canonical staff access; Registrar operates Enrollment and Student Records only unless another role is explicitly granted.

### Priority 4 — Complete System Administration

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

## 11. Documents and planning governance

The repository should contain four kinds of documentation only:

- **This master plan:** product direction, development status, priorities and future work.
- **Technical specifications:** exact architecture/data/workflow contracts for a feature.
- **Operational runbooks:** deployment, migration, recovery and incident procedures.
- **Historical/release records:** what a specific release/branch implemented.

Older documents with titles such as plan, roadmap, implementation tracker or phases are retained only for engineering history or detailed technical context. Their progress tables and future priorities are not authoritative.

When useful information from an older plan changes the product direction, move that decision into this master plan. Do not start a second master document.

## 12. Immediate next actions

1. Continue PR #215 as the primary School Admin/System Admin consolidation workstream.
2. Confirm the merged practical-exam backend/frontend release state and perform only the focused classroom-readiness check required before ordinary use; do not reopen it as a broad development workstream unless a defect appears.
3. Keep PR #215 content-current with current main and perform one final ancestry reconciliation before merge readiness; do not overwrite newer Class Record, Studio, practical-exam, Games or assessment-personalization work.
4. Finish the standard SIS student lifecycle and complete dependency-aware CRUD/archive/restore coverage for canonical administrator-owned master data before building many independent service modules.
5. Use the canonical school/person/class/enrollment model as the foundation for Finance, Clinic, Cafeteria, Uniforms and the remaining School OS modules.
6. Keep this file updated whenever a major workstream is merged, deployed, superseded or newly prioritized.
