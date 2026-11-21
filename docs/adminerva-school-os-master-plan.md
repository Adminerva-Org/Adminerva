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
| People & Access directory improvements | Merged | PRs #220, #221 and #222 added existing-student placement, legacy section repair, central directory search/profile editing and direct section placement. |
| System Admin + School Admin workflow consolidation | In development | Draft PR #215 is the current major administration integration track. |
| Classes & Scheduling | In development | PR #215 provides canonical class offerings, staffing, derived load, section coverage, official schedules, adviser assignment and roster authority. |
| Enrollment & Registration lifecycle | In development | Standard registration exists and PR #215 strengthens registration lifecycle, official placement and automatic whole-section synchronization. |
| Teacher Classroom consolidation | In development | PR #215 organizes Stream, Classwork, roster, submissions, grades and Class Record around one selected class. |
| Advisory and school attendance | In development | PR #215 implements adviser authority, daily attendance and School Admin oversight. |
| Class Record | Operational / evolving | School-scoped Class Record exists; PR #215 improves assessment links and administrator oversight. |
| Practical exam manual open/close | Merged; deployment/operational verification pending | PR #223 merged the backend-first stage; PR #224 fixed first deployment bootstrap behavior; PR #216 then merged the teacher/student UI and complete session workflow. Do not call the workflow operational until the corresponding backend/frontend release state is confirmed in production. |
| Assessment Studio multi-class deployment and date-range scheduling | Merged; frontend release/operational verification pending | PR #228 merged to `main` on 2026-11-21. The canonical form now supports multiple authorized class offerings and two-click date-range scheduling while preserving independent per-class assessments, teacher-controlled exam sessions and audit history. Production frontend availability and end-to-end operation not yet confirmed. |
| Assessment Studio deployment-first personalization | Merged to main; backend/frontend release and operational verification pending | PR #231 merged to `main` on 2026-11-21 (commit `2e94339d4adbba13272b706d0675c7494bb4c6f3`). The canonical deployment flow selects assigned classes and dates before determining private variants from authorized active enrollment, recognizes already-deployed blueprints, reuses sufficient activated pools, and removes manual pool sizing from the creation form. Existing school deployments and legacy historical assignments remain preserved. Verify Firebase Functions and frontend production release separately before calling this operational. |
| Studio student-project recovery and legacy Studio-only submission UI | Merged to main; backend/frontend release and operational verification pending | PR #230 merged to `main` on 2026-11-21 (commit `afa2777b78b331f937ecfc90ac69b1cad1e3f5f3`). The hotfix guards in-memory editor state, canonical cloud saves and accidental blank uploads; restores student-owned frozen V4 sources with teacher-session access controls; identifies legacy submitted project IDs and verified source to offer non-destructive recovery; and hides repository-only GitHub revision controls for Studio assessments. CodeQL, targeted regressions and Firestore checks passed. Firebase Functions deployment and live frontend operation must be verified separately. |
| Legacy Repository Management deployment visibility and schedule editing | Merged to main; frontend release and operational verification pending | PR #233 merged to `main` on 2026-11-21 (commit `fad25b9ea6f1bcac929063f8fb260117ecfc1950`). The canonical Deployed Tasks view now includes teacher-owned legacy deployments through the existing owner-scoped API, with links to each original class schedule; the historical editor supports direct existing-deployment links, deadline extension and late-submission changes while preserving the original assignment date and evidence. Existing variants, submissions and grades are not migrated, cloned or changed. Verify GitHub Pages frontend release and real legacy update workflow before marking operational. |
| V4 unified historical assessment review and verified conversion readiness | Merged to main; backend/frontend release and operational validation pending | PR #234 merged on 2026-11-21 (commit `f183ada74a6770212704917a6c6227076d4d2209`). Teacher-owned historical Adminerva Studio submissions can be reviewed from V4 using an audited owner/school-scoped read-through adapter: verified frozen code/variant evidence, private drafts, reviewed-grade publishing and bounded non-zero bulk publication update the original legacy grade record, not a duplicate V4 grade. Historical published scalar grades do not fabricate rubric breakdowns; source and grades remain authoritative in their legacy collections. A read-only readiness preview checks identity, enrollment and historical-term provenance before any future physical migration. Historical GitHub evidence still requires its existing review workflow. CodeQL, focused JavaScript regressions, Firestore security and Pages build passed; isolated Java Worker build failed independently. Firebase Functions deployment, frontend release and end-to-end teacher verification are still required before marking operational. |
| System Admin Operations Center | In development | Draft PR #194 contains the first-party observability/incident-management implementation. |
| V4 verified-school / multi-school foundation | Foundation | PR #113 contains the broad V4 foundation; PR #186 staged selective main-first integration. These are not the roadmap anymore; their architectural invariants remain inputs to this document. |
| Games / Practice modernization | Evolving | School-scoped progress, challenges, analytics and game UX have been developed through the recent Practice/Games PR series. |
| Public editorial and Opportunity Hunter | In development (draft PR #235); not merged, released or operational | One public-only, review-before-publish content system with separate channels for immersive discovery scenes, product announcements, Friday Pulse and verified external learning/career opportunities. The Opportunities directory and role-home highlights are implemented on a branch. Codex scheduling and actual publication are not configured or deployed; school-private announcements require a separate authorized backend workflow. |
| Cloudflare edge services | Foundation / optional | Worker/R2/Queues/CheerpJ work exists. Firebase remains authoritative for school identity, academics, grades and evidence unless a separately approved change is made. |
| Registrar full SIS lifecycle | Planned / partial | Registration exists; full admissions, transfers, promotion, graduation, records and credentials remain to be completed. |
| Parent/Guardian services | Planned / partial | Guardian data is used in enrollment; dedicated parent accounts/portal and broader guardian workflows remain future work. |
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

### Priority 2 — Complete the SIS student lifecycle

Build one continuous lifecycle:

Application -> review -> acceptance -> registration -> section placement -> account activation -> active classes -> attendance/academic records -> promotion/retention/transfer/withdrawal/graduation.

Required additions:

- Admissions/application queue
- Guardian relationship model and portal preparation
- Effective-dated placement/transfer history
- Promotion/retention processing
- Withdrawal/transfer handling
- Student records and credentials
- Document/certificate requests
- Registrar reporting

### Priority 3 — Finish academic-operational integration

- Stabilize class-centered Teacher Classroom
- Complete teacher Preparation -> Classroom handoffs
- Complete Assessment -> Gradebook -> Class Record linkage
- Finish practical-exam session release
- Expand attendance reporting and school calendar behavior
- Continue student/teacher mobile workflow cleanup
- Continue school-scoped Practice/Games consolidation

### Priority 4 — Complete System Administration

- Integrate Operations Center concepts with the current System Admin workflow
- Keep platform observability separate from private school academic data
- Establish clear school lifecycle, recovery, Assist, feature rollout and incident operations
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
5. **Enrollment & Registration** — register learners and establish official placement.
6. **Grading Policies** — define school grading structures.
7. **Operate the school** — Classroom, assessments, attendance, Gradebook and Class Record.
8. **Monitor exceptions** — dashboard should surface missing staffing, schedule conflicts, unplaced learners, attendance gaps and other operational issues.

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
- Make public/guest and role homepages engaging through progressive, task-oriented visual storytelling and interaction, without turning normal school work into a distracting animation showcase. Respect mobile screens and reduced-motion preferences.
- Public activity previews must be explicitly illustrative, never masquerade as real user activity. Personal activity is private and role-scoped; future aggregated school activity requires verified authorization, privacy thresholds, retention and deliberate school controls.
- Public Opportunity Hunter should present source-checked scholarships, training, competitions, internships and career opportunities with clear provenance, eligibility qualifications, recheck/expiry handling and no fabricated deadlines. Do not publish school-private records or school announcements to the public editorial channel.

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
9. Scheduled editorial/Codex automation may prepare release-note or feature-spotlight drafts using existing published release history and verified deployment evidence; it must not silently advance the public version, publish an unverified change, or send school-wide notifications.
10. Selected editorial cadence: daily immersive homepage experience, daily release notes/announcements, daily Opportunity Hunter, Friday Weekly Adminerva Pulse. Codex automations produce reviewable drafts in separate public content channels; approved content appears only after review and normal frontend publication. Run instructions are in `ops/public-editorial-automation.md`. Their existence on a PR is not evidence that schedules are configured.

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
3. Reconcile the useful V4 verified-school foundation into current mainline without overwriting newer Class Record, Studio, Games or administration work.
4. Finish the standard SIS student lifecycle before building many independent service modules.
5. Use the canonical school/person/class/enrollment model as the foundation for Finance, Clinic, Cafeteria, Uniforms and the remaining School OS modules.
6. Keep this file updated whenever a major workstream is merged, deployed, superseded or newly prioritized.
