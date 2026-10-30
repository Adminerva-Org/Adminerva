# Adminerva 4.0 — Owner decisions, pilot readiness and testability gates

**Purpose:** identify what the product owner must authorize, what the engineering team should default safely, and what can wait. These are proposed decisions, not production settings. Last planned: October 30, 2026.

## Owner decisions (recommended defaults already supplied)

| Decision | Priority | Recommended working default | What owner needs to confirm |
| --- | --- | --- | --- |
| **D-01: Institutional authorization to use MCS name/data** | **Blocking before touching live records** | Pilot labeled "Manila Cathedral School" with school ID `mcs-manila`; migrate only verified MCS records | Confirm appropriate institutional authority for real school names, actual pupil/staff data, branding and test/research use. If not yet authorized, use synthetic/anonymized testing only. |
| **D-02: MCS School Administrator(s)** | **Blocking before live pilot membership activation** | Explicit invited verified MCS admin(s), distinct from Platform Owner. Owner account can also hold an explicit MCS school-admin membership if authorized. | Identify who will operate school roster, teacher grants and initial policies; do not publish their email in code/docs or auto-grant based on domain. |
| **D-03: MCS record provenance** | **Blocking before migration cutover** | Verified historical records route to MCS; unknown/non-MCS quarantined; read-only mapping ledger reviewed. | Confirm that current Adminerva data are authorized MCS pilot data or indicate any other institutions/externals mixed in. |
| **D-04: Physical vs logical database isolation** | **Blocking before onboarding school #2; pilot default chosen** | One Firebase project with strict per-school Firestore document namespaces and protected school Storage paths. The school registry exposes explicit data location adapter for future physical isolation. | If contracts require physically separate named databases/Firebase projects per school, decide before second onboarding; do not claim logical isolation is separate physical database. |
| **D-05: Teacher assessment ownership/share** | **Default locked unless owner changes** | Private by default; creator owns; only deliberate selected-teacher or same-school all-teachers view/copy; separate coedit/review/publish grants. | Confirm whether recipient *may modify the original* in rare collaborations; recommended explicit coeditor only. Copy/clone is the ordinary share behavior. |
| **D-06: School-admin academic override** | **Policy decision before production grade/transfer** | School admin sees school operational metadata; cannot silently edit teacher private draft/grades. Reasoned audited emergency handover, specific grading delegation and change history. | Who at MCS can approve exceptional ownership transfer or grade correction, and whether the same person may grant and execute the operation. |
| **D-07: MCS academic calendar and catalog** | **Blocking before real deployments** | Academic year, term, program, grade, section and subject offering IDs explicitly configured. Preserve previous terms read-only. | Supply official active academic year/term structure, grade levels/sections and intended assessment/grade policy when ready. Do not invent an official MCS calendar. |
| **D-08: Privacy, retention and backups** | **Blocking before importing new live school data** | Deny by default, minimum private details, opt-in school AI, role-scoped exports, audited admin access, recoverable encrypted backups, no automatic destructive purge. | Confirm responsible school data steward, access/research consent process (especially learners/minors), retention/archival expectations and incident contact. Obtain any required independent legal/policy review. |
| **D-09: External AI and repository integrations** | **Blocking before school-level activation of integration** | AI disabled per school until approved, budget configured and provider terms reviewed. GitHub/Google Sheet credentials school/owner scoped, stored securely server-side (not in teacher-readable rosters). | MCS-approved provider, school AI usage budget, teacher/student permission, GitHub repos use, Google Sheets source owner and data-sharing policy. |
| **D-10: MCS testing content** | **Default** | Preserve verified existing pilot/test data; label synthetic fixtures; create empty synthetic School B to test isolation. Prefer dedicated nonproduction Firebase emulator/staging for mutation/failure testing. | Whether the current collection includes real student data and which MCS fixtures must be retained for validation without disclosing identities. |
| **D-11: School onboarding process** | **Default** | Manual owner-only provisioning, invite school admin, school config, grant check, activate only after readiness. | First non-MCS partner when known; no immediate action required. |
| **D-12: School files, quotas and exports** | **Can default initially** | Private-by-default; owner/class/school-share options; basic quota and retention settings; privileged school-level export with audit. | Actual storage and AI allowances; school branding/logo/contact metadata can be configured later. |
| **D-13: Co-review, co-teaching and grading delegation** | **Default** | Being a co-teacher grants only assigned-course roster access; separate assessment-level review and grade-publish grants. | Whether the school requires approvals for all grade changes or only published-grade corrections. |
| **D-14: Person identity and roster imports** | **Default** | Separate Firebase UID, school person ID, student enrollments, staff assignments and account invitations. MCS legacy email+section+year used only for mapping, never permanent identity. | Official school student/staff ID availability and authoritative CSV/Sheet data source. |
| **D-15: Institutional branding** | **Nonblocking for testing** | Generic Adminerva branding + plain-text institution name; upload approved school logo and contact information later. | Consent to use official MCS logo, domain, messaging and institutional branding. |
| **D-16: Future LMS/management modules** | **Defer** | 4.0 makes all existing functions school-aware, plus owner console, directory and school file layer; not a complete finance/HR/SIS launch. | Prioritize later attendance, registrar, parent portal, payments, library, etc. after 4.0 foundation. |

## Mandatory before pilot activation (not necessarily before code development)

The **critical manual inputs** are: authorized use of actual MCS data/identity, first approved school administrator, confirmed legacy ownership, academic calendar, and school privacy/AI policy. Engineering can implement foundational modules using synthetic data while these are pending.

**Safe engineering defaults:** owner-only manual school creation, MCS as verified legacy migration destination, one-school selector hidden, teacher work private by default, shared teacher content view/copy only, independent student grading authority, no raw teacher/admin impersonation, student history preserved and no auto-deletion.

## MVP for meaningful 4.0 testing

We need six verified scenarios, not hundreds of screenshots:

1. **Existing MCS student continuity:** same verified student can sign in with no school picker, open historical assessments, see *only their own published grades*, resume school/project local drafts and use new assessment source without losing evidence.
2. **Two MCS teachers:** Teacher A creates private rubric/assessment, Teacher B teaches same section but cannot see it; A shares selected teacher or school-wide, B previews and makes own copy, then deploys to B's assigned class without A's student data.
3. **MCS admissions and directory:** school admin invites student/teacher, links verified login to school person and separate enrollment/teaching appointment, imports CSV with preview, revokes role and sees audit trail.
4. **MCS end-to-end grading:** teacher deploys V2 or V3, student submits frozen evidence, teacher reviews, publishes Gradebook; student sees published feedback. Colleague without explicit reviewer grant cannot grade.
5. **Multi-school isolation and switching:** same verified user has MCS and synthetic School B role grants; picker shows only then; switching clears cached data/unsaved old-school writes; School B cannot read MCS grades, files, assessments, roster or teacher private drafts.
6. **Platform owner operations:** owner provisions synthetic School B, configures quotas, invites school admin and suspends School B without affecting MCS or obtaining access to private teacher/student records.

The fixture suite should include: anonymous guest, MCS one-school student, MCS one-school teacher, private assessment owner, same-school unshared teacher, specifically shared teacher, school-wide shared teacher, dual-school teacher, single-school school admin, dual-school school admin, platform-only owner, a suspended staff identity and one archived student with historical grades. Use **synthetic content** for adversarial testing, not real learner PII.

## Operational requirements easy to miss

- **Migration trigger suppression:** copying existing submitted evidence/grades must not send duplicate push, change publish state or create new grade records.
- **Student transcript and year history:** no automatic school-to-school grade transfer, section rename must not rewrite historical grades.
- **Access revocation:** disable teacher/login prevents active reads/writes without losing lesson plans/ongoing student grading. Handover is a separate action.
- **Cross-school resource permissions:** a teacher's owner UID must not act as authority outside the school; all share recipients must be active members of same school.
- **Offline data:** localStorage and service worker must be partitioned by UID+school+role/workspace, not just UID. Old pending cloud save cannot write into new school.
- **School file layer:** Storage rules and signed download controls must exist before private school files begin uploading. Keep no public long-lived student uploads.
- **Current connection risks:** existing student/teacher profile and browser connection paths handle GitHub tokens and teacher Gemini keys. Design server-side credential vault/Secret Manager flows, scoped to school/provider and least-privileged individual owner where appropriate; prevent keys appearing in directory exports or shared templates.
- **Directory integration:** teacher colleague picker for sharing, section/course offering assignment, admission and roster import all use one school identity service; do not create duplicate user profiles per feature.
- **Manual recovery:** only operator-approved idempotent job for school provisioning and migration, preview for bulk suspensions, permanent audit records, non-destructive backups.
- **No fake deployment claims:** none of the above are live until backend rules, Functions, vetted migration and Pages source have been deployed in compatible order.

## What to ask the owner now

Ask only for essential facts not already supplied by prior decisions:
1. **Can the existing Adminerva records be treated as authorized MCS pilot data, and do they include any other schools' records?**
2. **Which account/person should be the first MCS School Administrator (different from, or also you as, the Platform Owner)?**
3. **What is MCS's active school year/term configuration and who approves its privacy/AI policies?**

The other decisions have explicit safe defaults and should **not block initial engineering work**. Do not repeat a question after answered; use responses to populate the school registry and migration manifest after explicit approval.
