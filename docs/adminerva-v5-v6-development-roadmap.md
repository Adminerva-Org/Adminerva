# Adminerva: Version 5.0–6.x Master Development Roadmap

> **Status:** Living planning document — proposals, not a release commitment  
> **Created:** 2026-11-06 (Asia/Manila)  
> **Planning horizon:** Summer 2027 through 2028+, with a post-6.x idea parking lot  
> **Repository:** `Adminerva-Org/Adminerva`  
> **Scope:** Version 5.0, the 5.x feature releases, version 6.0 and its follow-ups, plus future explorations. Work for earlier versions is intentionally out of scope.  
> **Current pilot context:** Manila Cathedral School is the active pilot; no other school's data is assumed to be present.  
> **Document purpose:** A single durable record for decisions, feature proposals, milestones, dependencies, migration plans, unresolved questions, and changes agreed in subsequent planning conversations.

## How to maintain this document

1. Keep the **Roadmap Board**, **Decisions**, **Open Questions**, and **Change Log** current whenever plans change. Assign a stable ID to each proposed initiative so it can be discussed without ambiguity.
2. Mark items **Proposed**, **Approved for design**, **In progress**, **Delivered**, **Deferred**, or **Rejected**. Do not imply that a feature is implemented just because it appears here.
3. Record both a decision and its rationale. When a decision is reversed, keep the earlier decision in the history rather than silently erasing it.
4. Link implementation PRs, issues, schema migrations, and design artifacts as they are created. Document status and deployment status are separate.
5. Conversations do **not** automatically update this file: after a planning discussion, explicitly commit the agreed update to this repository.
6. Avoid placing real student names, credentials, identifying evidence, or other sensitive information in this public repository.

## 1. Product direction and non-negotiable principles

**Product ambition:** Progress from a classroom-tested assessment and programming-workflow MVP into a sustainable, teacher-efficient, student-friendly, multi-school academic platform.

**Architectural direction, pending final approval:** Make Supabase PostgreSQL the **single authoritative database for new academic records** at the summer 2027 academic-year boundary; retain selected Firebase services while they provide clear value. Do **not** run competing permanent Firestore and PostgreSQL writers for the same grade, assessment, submission, or enrollment.

**Principles**

- **Academic-year boundary, not big-bang rewrite.** Roll over the incoming academic year onto the new backend; preserve the prior year's authoritative records and history separately.
- **One identity, many scoped memberships.** A person may belong to multiple schools, years, sections, and roles without having multiple incompatible user identities.
- **Institution isolation and least privilege.** School ownership, teacher ownership, explicit sharing, student access, and administrator authority must be enforced server-side.
- **One assessment catalogue, one rubric system, one Gradebook.** GitHub evidence and Studio projects are different submission sources, not competing gradebooks.
- **Immutable evidence and accountable grading.** Keep submitted revisions, verified checkpoints, teacher decisions, evaluation provenance, draft/published grade distinctions, and correction trails.
- **Teacher-controlled academic decisions.** AI-generated suggestions never automatically publish grades; missing or uncertain evidence is not presumed to prove failure.
- **Mobile-first and accessible.** Core student workflows work on narrow screens, with keyboard access and intelligible loading/error states.
- **Minimize teacher workload.** Prefer integrated queues, bulk operations, templates, useful summaries, and workflow automation over duplicate admin panels.
- **Data minimization.** Historical real student records are not automatically safe test fixtures.
- **Pragmatic releases.** Use focused verification for changed workflows; retain stronger checks for migration, authorization, grades, and student data.

## 2. Roadmap at a glance

All dates are **planning windows**, contingent on Manila Cathedral School's actual academic calendar, readiness, budget, and approvals.

| Window | Release group | Theme | Primary outcome | Status |
| --- | --- | --- | --- | --- |
| Jan–Mar 2027 | 5.0 design | Data contracts and migration preparation | Approved target schema, source inventory, RLS/role model, cutover plan | Proposed |
| Apr–Jun 2027 (school break, to confirm) | **5.0** | Supabase foundation and academic-year transition | Incoming-year records use PostgreSQL; identities and history preserved; production cutover governed | Proposed |
| Jul–Sep 2027 | **5.1–5.2** | Teaching and learning workflows | Unified review, simpler student submissions, templates, directory and notification improvements | Proposed |
| Oct–Dec 2027 | **5.3–5.5** | Reporting and academic productivity | Gradebook improvements, analytics basics, exports and scoped automation | Proposed |
| 2028 | **6.0** | Institutional platform | Operational multi-school administration, governance, analytics and integrations | Proposed |
| 2028+ | **6.x** | Optimization and expansion | More mature automation, collaboration, admin tools and advanced Studio features | Proposed |
| Later | Future ideas | Explorations | AI learning support, expanded IDE, portfolios, ecosystem integrations | Not committed |

**Milestone rule:** If the school break or migration criteria are missed, delay the cutover rather than split one incoming academic year unpredictably across two authoritative backends.

## 3. Architecture decision: Firebase + Supabase

### Target service ownership

| Concern | Target owner | Notes |
| --- | --- | --- |
| Academic records, gradebook, assessments, submissions, memberships, audit | **Supabase PostgreSQL** | Single authoritative write target after cutover |
| Database authorization | **PostgreSQL RLS + trusted server-side workflows** | Never rely on hiding UI controls alone |
| Login / existing user identity | **Firebase Auth initially** | Evaluate Supabase Auth later; preserve identity continuity |
| Push delivery | **Firebase Cloud Messaging** | Delivery only; notification metadata/read state can live in PostgreSQL |
| File assets and submission snapshots | **Supabase Storage or purpose-specific immutable object storage** | Access control and retention required |
| GitHub repository history | **GitHub** | Store immutable commit identifiers and verified evidence metadata in PostgreSQL |
| Realtime academic activity | **Supabase Realtime** | Subscribe only to allowed, scoped data |
| Studio source and execution | **Design decision pending** | Separate authoring/runtime concerns from academic submission snapshots |
| Legacy academic records | **Read-only/controlled Firebase archive for transitional period** | No silent dual-write fallback |
| Reporting | **SQL views, materialized summaries or approved analytics pipeline** | Protect student privacy and avoid misleading metrics |

**Not planned:** A permanent hybrid where Firestore and Supabase both accept independent edits to the same official grade or submission.

### Architectural boundaries

1. Frontend uses an explicit data-access layer rather than scattering database-specific calls across every page.
2. A record has an unambiguous authoritative location and a stable ID.
3. Authorization derives from trusted identity and live membership/assignment records, not mutable client profile fields.
4. Multi-entity operations (approval + audit + grade invalidation, for example) are transactionally coordinated.
5. External evaluation and AI providers are behind consent, bounded data export, provenance, and teacher-confirmation controls.
6. Background jobs, push messages, and webhooks are retryable and idempotent.

### Auth compatibility questions

- Verify current Firebase-to-Supabase third-party JWT integration and required claims against current official documentation during implementation.
- Decide whether to retain Firebase Auth long term or later migrate sessions/identities to Supabase Auth; the latter is **not** a prerequisite for 5.0.
- Define emergency administrator access without relying indefinitely on a hardcoded bootstrap identity.

## 4. Version 5.0 — Supabase and academic-year foundation

### 4.1 Core outcomes

**5.0 is complete when:**

1. New-year academic records are exclusively authoritative in PostgreSQL.
2. Authorized students, teachers, and administrators sign in without duplicate-account confusion.
3. A school, year, term, section, enrollment, assignment, assessment, evidence, evaluation, and grade have enforceable relationships.
4. Teacher-owned assessments are private by default and can be intentionally shared with named teachers or eligible school colleagues.
5. Existing pilot records have an explicit archived/migrated/excluded classification; no required published grade or decision is lost.
6. A controlled academic-year closeout and new-year setup works.
7. School isolation, grade publication, immutable evidence and correction policies have focused acceptance checks.
8. A migration/reconciliation report and recovery plan exist before official cutover.

### 4.2 Proposed PostgreSQL domains and table families

These names are **design candidates**, not a final physical schema.

| Domain | Candidate tables / concepts | Key invariants |
| --- | --- | --- |
| Identity | `profiles`, `external_identities` | Stable user; mapped legacy Firebase UID |
| Institutions | `schools`, `school_memberships`, `role_grants` | Membership scopes and validity; no implicit cross-school power |
| Academic structure | `academic_years`, `terms`, `courses`, `sections`, `section_enrollments`, `teaching_assignments` | Historical membership remains attributed to original year |
| Assessment catalogue | `assessment_templates`, `assessment_versions`, `rubric_versions`, `rubric_criteria`, `assessment_shares` | Immutable deployed definitions; explicit owner and share permissions |
| Assessment operations | `assessment_deployments`, `submissions`, `submission_revisions`, `submission_artifacts` | Source type and revision pinned; controlled lifecycle |
| Evidence and attribution | `evidence_selections`, `verified_commits`, `commit_reclaim_requests`, `reclaim_decisions`, `attribution_conflicts` | A Git SHA is not by itself proof of authorship |
| Evaluation | `evaluation_runs`, `criterion_findings`, `review_decisions` | Preserve provider, rubric version, source checkpoint, evidence and human overrides |
| Gradebook | `grade_drafts`, `grade_publications`, `grade_revisions` | Publish deliberately; stale evidence invalidates draft publishability |
| Studio | `studio_projects`, `studio_revisions`, `assessment_project_links` | Project remains separate from a frozen assessed submission |
| Communication | `notification_events`, `notification_recipients`, `preferences` | Sending push is not itself proof the user read the message |
| Governance | `audit_events`, `data_migration_runs`, `legacy_id_map`, `retention_policies` | Actor, source, timestamp, reason and traceability |

**Schema detail to resolve:** whether a course/section has one school affiliation per academic year, how group submissions map to individual grades, what becomes immutable after publication, and who may perform exceptional corrections.

### 4.3 Rights and permissions matrix (proposed)

| Actor | School directory | Assessment templates | Submissions/evidence | Grades |
| --- | --- | --- | --- | --- |
| Student | Own authorized profile / allowed classmates where policy permits | Read deployments assigned to them | Create and view own allowed revisions; request reclaim | Read own published grades |
| Teacher | Assigned students/sections | Own by default; read/write shared resources only to granted level | Review assigned assessment submissions | Draft/publish only within approved authority |
| School admin | School-authorized directory | School-scoped oversight | School-scoped audited exceptions | Audited grade correction authority |
| Platform admin | Platform configuration; limited educational data by policy | No automatic broad educational-data access | No automatic override | No automatic grade authority |

**RLS acceptance cases:** cross-school read/write denial; cross-section teacher denial; owner-only assessment; revoked share access; student cannot forge evidence approval; student cannot alter another student's submission; grade draft not visible to students; stale grade cannot publish; admin correction audited; membership revoked mid-session enforced from current database state.

### 4.4 Academic-year rollover

**Proposed closeout workflow:** identify unresolved assessments → finalize/flag grades and appeals → freeze eligible records → create verified archive/snapshot → approve rollover → establish new year/terms/sections → import/promote/enroll students → assign teachers → activate incoming year.

Requirements:

- Historical membership and published outcomes retain their original year and scope.
- Students may transfer, repeat, leave, return, or belong to different schools in different periods.
- Teachers can teach multiple schools without an irrelevant school selector for single-school accounts.
- Archiving does not silently terminate legitimate appeal/correction procedures.
- School administration can see unresolved exceptions before closing a term.

### 4.5 Data inventory, classification and migration plan

**Important:** The current Manila Cathedral School data may contain real educational records. Calling the old database “testing data” does **not** erase its confidentiality, retention, or historical significance. For development fixtures, use synthetic or properly de-identified copies.

| Category | Default disposition | Notes |
| --- | --- | --- |
| Real active user accounts | Link/migrate necessary identity data | Preserve Firebase UID mapping until auth decision |
| School, sections, enrollment and staff assignment | Migrate with year-scoped provenance | Preserve historical section and teaching relationships |
| Published grades and official evaluation outcomes | Archive securely; migrate if needed for student record continuity | Never silently re-score/recalculate on import |
| Rubric/assessment templates | Selectively migrate reusable versions | Preserve prior rubric versions for historical grading |
| Submitted evidence, verified commits, approvals and reclaim decisions | Preserve provenance; migrate relevant metadata | Respect immutable checkpoint/revision boundaries |
| Student projects and GitHub references | Preserve reference links and authorized artifacts | Avoid unnecessary copying of large Git histories |
| Practice/scratch work | Retain only where useful and permitted | Not automatically an official academic artifact |
| Demonstration users and dummy assessments | Development fixtures only | Exclude from production |
| Temporary logs and caches | Apply approved retention/deletion rules | Avoid indefinite sensitive-data storage |

**Rehearsal and cutover sequence**

1. Inventory Firestore collections, Cloud Functions, indexes, identity assumptions, Storage objects, external integrations and implicit cross-document workflows.
2. Map source fields to target schema; mark required, optional, confidential, obsolete and unmappable data.
3. Establish deterministic `legacy_id_map`, import manifests, source hashes/counts, idempotent upserts and traceable errors.
4. Use staging plus synthetic/de-identified fixtures; run complete migration rehearsal.
5. Review record counts **and** relational correctness: memberships, grade publication, frozen evidence, links, authorship, rubric versions.
6. Obtain school approval for necessary historical data handling and the official cutover date.
7. Close or explicitly manage outstanding year-end writes; take a recoverable snapshot; perform final delta transfer.
8. Activate Supabase as sole authoritative backend for incoming-year records; clearly mark legacy historical access read-only except approved corrections.
9. Reconcile post-cutover state and produce a signed-off migration report.
10. Keep a time-boxed contingency: if cutover fails before official new-year writes begin, restore the previous operating mode; after new-year writes begin, do **not** blindly roll back to Firebase or create divergent grades.

**Migration workbench candidate:** import preview, duplicate resolution, classification, dry run, per-entity progress, re-run safety, exception queue, reconciliation and exportable report. This is an admin-only capability.

### 4.6 Failure and “what if” rules

| Scenario | Required behavior |
| --- | --- |
| Supabase unavailable during grade save | Fail visibly, preserve unsent draft locally when safe; **never** silently write an official duplicate to Firestore |
| One person has multiple memberships | Resolve allowed school context; hide selector for one-school accounts |
| Teacher share revoked during session | Subsequent server-authorized reads/writes reflect revocation |
| Student moves sections mid-assessment | Preserve historical assignment/evidence; require explicit transfer/deployment policy |
| Teacher edits a rubric after deployment | Existing deployed version remains immutable |
| Assessment grade already published | Correction requires authorized unpublish/amendment with history |
| Reclaim conflicts with another student | Preserve competing claims; human adjudication; no automatic reassignment |
| Student resubmits after evaluation draft | Pin new revision; stale evaluation/grade draft cannot publish |
| Legacy ID matches multiple accounts | Quarantine import; require review, not guessed linking |
| A migration is re-run | Idempotent result with no duplicate academic records |
| Historical archive is unavailable | New-year production continues; historical view shows explicit unavailability |
| User's account is removed or role changes | Membership-scoped access is checked again on protected actions |
| GitHub repository disappears or becomes private | Pinned evidence metadata remains; access limitations explicit; no fabricated verification |

### 4.7 5.0 milestone gates

- **M5-01 — Architecture approved:** tenancy, ownership/sharing, unified assessment and Gradebook contracts.
- **M5-02 — Target schema ready:** migrations, constraints, RLS and access matrices designed.
- **M5-03 — Identity linked:** existing users can access allowed Supabase resources with scoped privileges.
- **M5-04 — Migration rehearsal passed:** idempotency, totals, key relationships and exceptions reconciled.
- **M5-05 — Rollover ready:** closeout, archive, enrollment/teacher assignment and activation path complete.
- **M5-06 — Production cutover authorized:** school approval, archive snapshot, recovery plan and operational ownership documented.
- **M5-07 — New year live:** official incoming-year academic writes route only to Supabase.

## 5. Version 5.1–5.5 — Everyday teaching and learning

These allocations are proposals; features may move between minor versions based on real classroom use.

| ID | Candidate release | Priority | Feature | Outcome | Status |
| --- | --- | --- | --- | --- | --- |
| TEACH-501 | 5.1 | P0 | Unified submission Review Center | Evidence, reclaims, evaluations, feedback and grading in one teacher workflow | Proposed |
| TEACH-502 | 5.1 | P0 | Gradebook 2.0 | Reliable draft/save/publish, filters, revision history and eligible bulk operations | Proposed |
| STUD-501 | 5.1 | P0 | Guided student submissions | Clear stages, evidence preview, status, revision and recovery prompts | Proposed |
| STUD-502 | 5.1 | P1 | Feedback and evidence timeline | Students understand current status, verified contributions and teacher feedback | Proposed |
| TEACH-503 | 5.2 | P1 | Visual assessment builder | Reusable rubric/criteria templates, versioning, deploy previews | Proposed |
| TEACH-504 | 5.2 | P1 | Owner/share assessment library | Private by default, specific-teacher sharing, permitted school library | Proposed |
| OPS-501 | 5.2 | P1 | Role-aware user directory | Bulk invite/enroll, duplicate resolution, transfer and historical role view | Proposed |
| OPS-502 | 5.2 | P1 | Notification center/preferences | Per-event delivery rules, read state, FCM delivery integration | Proposed |
| STUD-503 | 5.2 | P1 | Student dashboard/mobile redesign | Actionable assignments, progress, deadlines, accessible controls | Proposed |
| TEACH-505 | 5.3 | P1 | Class and workload dashboards | Missing work, pending review, completion patterns | Proposed |
| OPS-503 | 5.3 | P1 | Permission-aware global search | Search across allowed classes, assessments, projects and people | Proposed |
| REPORT-501 | 5.3 | P1 | Grade and assessment exports | CSV/institution-approved formats with traceable export access | Proposed |
| TEACH-506 | 5.4 | P1 | Feedback snippets, extensions and exceptions | Reduce repetitive teacher actions without hiding academic decisions | Proposed |
| STUDIO-501 | 5.4 | P1 | Unified project-as-submission | Studio project linked to assessment; frozen version sent to existing Gradebook | Proposed |
| STUD-504 | 5.4 | P2 | Project learning portfolio | Selected work, feedback and achievements, privacy-by-default | Proposed |
| AUTO-501 | 5.5 | P1 | Event-driven academic reminders | Deployment, deadline, review, feedback and published-grade notifications | Proposed |
| REPORT-502 | 5.5 | P1 | Rubric/competency summaries | Aggregate results with context and privacy protections | Proposed |

**Interaction standards:** student-friendly plain language; progressive disclosure for advanced evidence/commit details; 320px layout support; optimistic UI only when safe; visible loading, success, error, retry, and stale-state handling. Teachers should not need to navigate separate redundant tools for the same submission.

**Gradebook invariant:** A published grade is not overwritten by an AI suggestion, an altered project HEAD, an unapproved evidence revision, or a repeated request.

## 6. Version 6.0–6.x — Institutional intelligence

### 6.1 6.0 release outcome

Make multi-school tenancy operational with school onboarding, academic configuration, organizational governance, mature analytics, and documented interoperability—not merely a school filter in the UI.

| ID | Priority | Initiative | Requirements / notes | Status |
| --- | --- | --- | --- | --- |
| INST-601 | P0 | School onboarding and configuration | School profile, branding, active academic year, grading settings, terms | Proposed |
| INST-602 | P0 | Advanced school-specific RBAC | Configurable role grants with safe defaults and auditability | Proposed |
| INST-603 | P0 | Multi-school user experience | Cross-school memberships; selector only for users with >1 eligible school | Proposed |
| INST-604 | P0 | Academic-year and section transfers | Historic record preservation and cross-year reporting | Proposed |
| GOV-601 | P0 | Audit, retention, export and correction governance | Institutional policies, data subject requests, privileged-action trail | Proposed |
| REPORT-601 | P1 | Institutional analytics | School-level completion, performance patterns, review queues and assessment quality | Proposed |
| REPORT-602 | P1 | Cross-term trends | Explain denominators, context and changes in rubric versions | Proposed |
| OPS-601 | P1 | Administration console | Memberships, configuration, incidents, migration and operational visibility | Proposed |
| INT-601 | P1 | Interoperability APIs/exports | School-approved data integration; scoped access and API versioning | Proposed |
| AUTO-601 | P1 | Academic workflow automation | Event triggers, idempotent jobs, failure/retry visibility, manual overrides | Proposed |
| STUDIO-601 | P2 | Collaboration and project review | Team project permissions, verified individual work and source review | Proposed |
| REPORT-603 | P2 | Teacher workload insights | Administrative trends for process improvement, not uncontextualized staff ranking | Proposed |

**Metric quality warning:** raw commit counts, lines changed, resubmission frequency, or AI evaluation scores must not be treated as standalone evidence of learning or individual merit. Report relevant denominators, rubric changes, missing evidence and uncertainty.

### 6.2 6.x candidates after institutional foundation

- Better approval queues and delegated academic coordination.
- Configurable reminders and staff workload digests.
- Additional report builders and scheduled exports.
- External LMS/SIS integration where permitted and maintainable.
- Broader database and schema teaching tools in Studio.
- School-level accessibility, privacy and operational settings.
- More sophisticated backup, retention and archive lifecycle management.

## 7. Future development parking lot (not part of the 5.0 or 6.0 commitments)

| ID | Concept | Why it may matter | Prerequisite / caution |
| --- | --- | --- | --- |
| FUT-701 | Studio multi-language/runtime expansion | More programming curricula | Sandboxed execution, resource caps, cost and abuse controls |
| FUT-702 | Visual database explorer/SQL playground | Database education with table/schema/query views | Isolated per-student environments; no live institutional DB exposure |
| FUT-703 | Automated source-code tests | Help verify functional requirements | Distinguish functional tests from human assessment |
| FUT-704 | AI-assisted rubric and feedback drafting | Reduce authoring/review load | Teacher sign-off, provenance, privacy and bounded exports |
| FUT-705 | Learning recommendations | Identify next skills/resources | Pedagogical validation and appealable interpretations |
| FUT-706 | Portable learner portfolio | Student-controlled evidence of learning | Consent, permissions, expiry and export/transfer policy |
| FUT-707 | Advanced project team collaboration | Support authentic group software projects | Authorship checks and equitable individual assessment |
| FUT-708 | More integrations | Interoperate with institutional systems | Demand, maintenance cost, privacy and permission model |
| FUT-709 | Reassess Firebase Auth retirement | Simplify auth infrastructure if beneficial | Session/user continuity and migration risk |
| FUT-710 | Offline-first workflows | Support learners with intermittent connectivity | Conflict strategy, secure local storage, sync integrity |

## 8. Cross-cutting technical and product design requirements

### Student and school data protection

- Define official-record ownership and retention with the school before migration. Real student data must not be repurposed as unrestricted test fixtures.
- Keep production, staging and development separate; apply synthetic/de-identified datasets outside production.
- Enforce tenant and owner access at the data layer, including storage objects, realtime subscriptions and exports.
- Keep service-role/secret keys off browsers; do not put personal student data in GitHub issues, code or public docs.
- Keep a tamper-evident record of privileged corrections and evaluation provenance.

### Reliability and recoverability

- Use explicit state machines for evidence, reclaim, submission, evaluation and grade publication.
- Prefer idempotent mutations and retriable background tasks. Clearly distinguish “pending,” “saved,” “published,” and “delivery attempted.”
- Treat imported records as immutable historical facts unless an authorized correction process says otherwise.
- Measure performance for teacher review screens and large evidence packages; paginate and stream rather than forcing arbitrary small file-count limits.
- Use limited, change-focused checks ordinarily; never waive authorization or data-integrity gates for cutover.

### Access and UX

- Hide school switching when a user has only one active school membership; do not infer this from user role alone.
- Reuse shared navigation, loaders, visual patterns and role-aware views.
- Show status and next action prominently; put expert evidence and Git details behind progressive disclosure.
- Preserve the single Gradebook and assessment identity when the submission source is Studio versus GitHub.

## 9. Workstreams and dependency order

| Workstream | 5.0 responsibilities | 5.x responsibilities | 6.x responsibilities |
| --- | --- | --- | --- |
| Platform & data | PostgreSQL, schema, identity bridge, RLS, migration, rollover | Performance, operations, schema refinement | Multi-school scale and integrations |
| Assessment & academic | Immutable submissions, grades, provenance, tenant ownership | Review Center, assessment builder, Gradebook, templates | Institutional academic policy and analytics |
| Studio & learning | Project/submission contract | Direct assessed submissions, portfolios, review | Collaboration and deeper tooling |
| Experience & operations | Directory, admin setup, cutover UX | Mobile-first dashboards, search, notifications, teacher productivity | School management, reporting, automation |

**Critical path:** school/year/identity/authorization model → target schema → source inventory and mapping → migration rehearsal → production cutover → daily workflow improvements → institutional scale.

Avoid shipping a feature that relies on a future permission or data model that has not yet been defined.

## 10. Decision register

| ID | Date | Decision / recommendation | Status | Rationale / next action |
| --- | --- | --- | --- | --- |
| DEC-001 | 2026-11-06 | Target Supabase PostgreSQL as new-year academic source of truth in summer 2027 | **Proposed** | Natural academic boundary; school calendar and sign-off pending |
| DEC-002 | 2026-11-06 | Retain Firebase Auth initially with third-party integration | **Proposed** | Avoid forced user re-registration; verify current integration during implementation |
| DEC-003 | 2026-11-06 | Retain FCM for push delivery | **Proposed** | No proven value to immediate replacement |
| DEC-004 | 2026-11-06 | No permanent dual-authoritative Firestore/PostgreSQL writes | **Proposed** | Prevent divergent official grades/submissions |
| DEC-005 | 2026-11-06 | Preserve required historical records; exclude test data from new production | **Proposed** | Protect school records and reduce migration noise |
| DEC-006 | 2026-11-06 | Private teacher ownership with explicit sharing | **Proposed** | Consistent authorization for single- and multi-school teachers |
| DEC-007 | 2026-11-06 | One assessment system and Gradebook for GitHub and Studio work | **Proposed** | Avoid duplicate academic records and grading logic |
| DEC-008 | 2026-11-06 | Put advanced AI/Studio expansion in future backlog, not core migration | **Proposed** | Focus delivery capacity on foundational academic workflows |

## 11. Open questions requiring a school/product decision

| ID | Question | Impact | Target resolution |
| --- | --- | --- | --- |
| Q-001 | What are Manila Cathedral School's confirmed SY closeout and incoming-year dates? | Sets safe cutover window | Before migration freeze |
| Q-002 | Which historical records are official, must be migrated, may remain archived, or can be deleted under policy? | Scope, privacy and storage | Before import design sign-off |
| Q-003 | Who authorizes real student-data migration and correction/retention policies? | Governance | Before staging receives real data |
| Q-004 | Which roles may modify published grades or override section permissions? | RLS and audit design | Before schema approval |
| Q-005 | Should school admins approve teacher-to-teacher assessment shares, or may owners share directly? | Sharing workflows | Before permission implementation |
| Q-006 | Will students use existing Firebase login for the full next school year? | Identity strategy | Before account migration |
| Q-007 | Which Studio submission types qualify as official graded artifacts? | Snapshot format and grader integration | Before Studio expansion |
| Q-008 | What is the acceptable production budget, backup tier and data region? | Supabase plan/infrastructure | Before project provisioning |
| Q-009 | What is the rollback decision boundary after the first new-year write? | Migration safety | Before cutover rehearsal |
| Q-010 | Which teacher workload and student-perception outcomes should roadmap improvements measure? | Product research and prioritization | During 5.x planning |
| Q-011 | Is multi-school customer onboarding expected in 2028, or should 6.0 stay pilot-focused until demand exists? | Scope and spending | During 6.0 planning |

## 12. Feature and release definition of done

A roadmap entry may be marked **Delivered** only when its required implementation is merged, its operational dependencies are deployed, and focused acceptance criteria pass.

**For 5.0 migration:** add source/destination reconciliation, cross-tenant/role checks, publish guards, archival access, recovery procedure and authorized school sign-off.

**For normal 5.x enhancements:** focus checks on affected paths, role scopes, mobile usability, error behavior and regression-prone grading states.

**For 6.0 institutional features:** demonstrate isolated school operations, compliant exports, audited privileged changes and school-specific configuration.

Documentation complete != feature implemented != backend deployed != production validated.

## 13. Existing repository references

- [Studio integration and unified assessment/Gradebook design](studio-integration-plan.md)
- [Review & Grade teacher workflow](review-grade-workspace.md)
- [Assessment V2 evidence and grading boundaries](assessment-v2-rollout.md)
- [Staff authorization and bootstrap transition](staff-authorization-migration.md)
- [Studio audit](next-release-code-studio-audit.md)
- [Monitoring and maintenance](monitoring-maintenance.md)
- [Teacher workspace and responsive review](teacher-workspaces-and-responsive-review.md)

## 14. Change log

| Date | Revision | Change | Source |
| --- | --- | --- | --- |
| 2026-11-06 | 0.1 — initial planning baseline | Established 5.0 summer transition, Supabase target architecture, 5.x daily workflows, 6.x institutional direction, future backlog, risk rules and open decisions | Adminerva roadmap discussion |

---

**Next planning edit:** Finalize the 5.0 data inventory and school/teacher authorization specification, then turn approved feature IDs into GitHub issues or milestones. The plan remains editable; no backend changes, project provisioning, migration or release approval is implied by this file.
