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

**Remaining:** finish remaining legacy support/history cleanup and bootstrap-authority retirement, complete production MCS migration/reconciliation execution, then remove compatibility-only code that is no longer required after an observed rollback window. The existing Studio already has a progressive V4 bridge and the dedicated V4 Gradebook/GitHub evidence/reclaim paths are present, but no production Firestore copy or role grant has been executed. Do not present the new callables as deployed features.

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

## Canonical teacher planning migration — October 31, 2026

The current 4.0 runtime already has school-scoped teacher planning, schedules and reference-library services. The migration work now maps MCS legacy planning data into those existing contracts rather than creating parallel schemas.

- `mcs-canonical-planning-plan.js` → approval template → apply engine migrates teacher-owned lesson plans and presentations into `schools/{schoolId}/teaching_resources`. Current personal workspace copies are preferred over older global copies; ownership is resolved only from verified workspace UID, saved owner UID/email identity, or an exact source-lesson relationship.
- Lesson/presentation deterministic client keys match the live 4.0 editor bridges, preventing a migrated resource from becoming a duplicate when the teacher later saves it from the editor.
- Planning revisions must be complete from 1 through the current revision. Missing/duplicate/oversized histories block migration instead of being fabricated.
- All migrated lesson/presentation resources remain private and archived records remain archived. No legacy sharing is inherited.
- `mcs-canonical-planning-support-plan.js` → approval template → apply engine migrates teacher-owned reference folders/documents and personal timetables. Safe legacy reference-folder IDs are retained so lesson folder references remain valid.
- Reference migration accepts bounded text and already-extracted PDF text only; raw PDF payloads remain blocked while V4 Storage is deny-by-default.
- Timetables are revalidated against canonical teacher section/subject assignments and use the live V4 `scheduleId(uid,year,semester)` contract. Folder/document and schedule/revision units are atomic; partial target state is a preflight blocker.
- Legacy administrator-shared reference folders and shared `app_config` timetables are identified from the reviewed dry-run ledger but are **not** copied into every teacher account. They require an explicit school-shared policy or archived-history decision.

## School-scoped Practice runtime and migration — October 31, 2026

Practice is no longer treated as an acceptable global exception for 4.0.

- `functions/school-practice-season-service.js` provides parallel V4 Practice callables authorized by verified school student membership, linked active person and active course enrollment. Sessions, mission state, awards, progress, class standings and public aliases all live under `schools/{schoolId}`.
- Signed-in V4 students no longer subscribe directly to global `practice_public_rankings`. The school Practice hub returns the selected school's public aliases and class standings. Guest/legacy users retain the 3.x compatibility path until cutover.
- Multi-school students must choose a school through the account context; changing schools invalidates the active scored session. Pending answers/drafts are keyed by school.
- A per-student `practice_migration_state` prevents scored actions while canonical progress is partially migrated.
- `mcs-canonical-practice-plan.js` reconciles current-season score totals against award rows, completed mission state and course progress before proposing canonical records. Mismatches are blockers, not repaired guesses.
- Legacy public-leaderboard consent is intentionally reset: migrated learners begin opted out of the new school leaderboard with a deterministic pseudonymous alias. The old alias/opt-in is provenance only.
- `mcs-canonical-practice-approval-template.js` and `mcs-canonical-practice-apply.js` provide explicit per-student approve/exclude review and resumable create-only batches. A migration marker becomes complete only after every expected target reconciles.
- Previous-season score state, if still present in the legacy head, is retained under a school-scoped historical archive. Ephemeral attempts, browser/session locks, security events and derived legacy rankings remain in the quarantined mirror instead of being promoted as current authorization state.

## Canonical MCS Practice migration and analytics — October 31, 2026

- `functions/school-practice-season-service.js` is the verified-school Practice runtime. Student identity is resolved through canonical membership → linked student person → active school enrollment; Practice sessions and scores are school-scoped.
- `functions/school-practice-analytics.js` + `school-practice-analytics.html` provide teacher/school-admin current-season Practice analytics without reading global `students`, `practice_profiles`, `practice_scores` or `practice_rankings`. Teachers see only sections backed by their current active staff assignments; school administrators see active sections for the selected school.
- The shared navigation now gives verified teachers a dedicated Practice Progress workspace, and school administrators can open the same school-scoped view. V4-only teachers do not need to enter the legacy mixed Teacher Analytics page.
- `mcs-canonical-practice-plan.js` → approval template → resumable apply engine preserves durable verified course progress, current-season score/progress/awards/completion state, rebuilds class ranking rows from approved canonical enrollment sections, and archives an older season head separately when present.
- Legacy public-leaderboard consent is deliberately reset. A migrated student starts opted out with a deterministic school-scoped alias/public ID; the previous alias/opt-in is retained only as migration provenance.
- Browser sessions, active attempts, attempt responses, rate-limit/security events and derived legacy ranking rows are not promoted into live V4 runtime state. During a partial Practice migration, the school runtime fails closed for that student until their migration marker reconciles.
- Practice migration planning now fails closed on mirror read failures and validates source owner UID/document runtime keys instead of treating malformed/misbound history as valid progress.
- Focused regression coverage validates deterministic school ranking IDs, score/award/progress reconciliation, consent reset, historical-season archiving and verified-progress ownership.

## Canonical V4 Class Analytics — October 31, 2026

- `functions/school-teacher-analytics.js` adds offering-scoped academic analytics for verified teachers and school administrators. Authorization follows the canonical course offering and active staff assignment rather than legacy section-name access.
- Teachers see only their own deployed assessment tasks in an offering. They may explicitly include **their own** unpublished Gradebook drafts; another teacher's drafts are never exposed through this service.
- School administrators may aggregate deployed school tasks and published grades for an offering but do not gain access to private teacher drafts, feedback or teacher-owned blueprint content.
- `school-teacher-analytics.html` + `js/analytics/school-teacher-analytics.mjs` provide the dedicated V4 Class Analytics workspace with assessment averages, published-result coverage and per-student visible averages.
- Missing grades are excluded from averages rather than interpreted as zero. Legacy repository commit-count / ghost / equity heuristics are deliberately not carried into the canonical academic analytics surface because commit volume is not evidence of mastery, effort or authorship.
- V4 navigation now uses **Class Analytics** as the school-safe results workspace. Existing `teacher-analytics.html` remains a legacy compatibility page for 3.x staff during migration; V4-only analytics bookmarks are redirected to the canonical page.

## School files, retention and continuity export — October 31, 2026

- `functions/school-file-policy.js` adds an explicit school-admin file policy. Storage remains closed until an administrator deliberately enables support attachments, selects a 30/90/180/365-day retention period, selects a 1/2/5 MB per-file cap and records an audited reason.
- `storage.rules` now opens only the reserved support-attachment path. Uploads require verified active membership, the report owner, a pending Firestore reservation, exact size/type/custom metadata and the current school policy. Reads require the finalized attachment record plus report ownership or active school-admin access. Client overwrite/delete/list operations remain denied; all other Storage paths remain deny-by-default.
- School support now uses a two-phase attachment lifecycle: server reservation → direct authenticated Storage upload → server metadata verification/finalization. Files are not returned in report reads until finalization succeeds.
- `school-file-retention.js` runs a bounded scheduled cleanup for expired pending reservations and finalized retained files, deletes the Storage object and records an audit state transition.
- `school-data-controls.html` provides the school-admin Data & Files workspace. It configures the audited file policy, shows the current retention contract and creates an integrity-hashed continuity export.
- `school-data-export.js` exports only canonical school operational data: people/membership linkage, academic catalog, offerings, enrollments, teacher assignments, deployed assessment snapshots, **published** grades and school support report records.
- The continuity export deliberately excludes teacher-private blueprints/planning/reference resources, student Studio/GitHub source/evidence payloads, unpublished teacher grade drafts, Practice runtime/session state, nested support comments/attachment binaries, secrets and audit/event streams.
- The browser restore control remains **preview-only**: schema, school binding, SHA-256 integrity and saved category counts are checked without writing Firestore.
- `school-continuity-restore-plan.js` adds a read-only same-school restore planner. It classifies canonical targets as ready/identical/conflict and explicitly excludes membership/role restoration.
- `school-continuity-restore-approval-template.js` binds operator review to the exact export and plan hashes, requires explicit per-category approve/exclude decisions and records the access records that must be recovered separately.
- `school-continuity-restore-apply.js` is preflight-only by default and requires an exact environment acknowledgement for write mode. It is create-only, never overwrites canonical records, rechecks dependencies, requires active separately restored teacher/student memberships for access-bearing active records, suppresses notifications, and cannot restore memberships or grant roles.

## Assessment lifecycle and teacher handover — October 31, 2026

- Deployed assessments now keep a separate `lifecycle` (`active`, `closed`, `archived`, `cancelled`) plus optimistic `revision`, instead of overloading the historical deployment `status`.
- Teachers can close/reopen/archive/restore a deployment with an audited reason. Reopening after the original deadline requires a new future deadline. Cancellation is allowed only when no Studio submission, GitHub evidence or grade history exists.
- Closed tasks block new first submissions but preserve explicit teacher-requested revision/resubmission workflows. Archived/cancelled tasks reject new student writes; archived history remains available to the responsible teacher for review/Gradebook continuity.
- `reviewerUid` is now distinct from deployment `ownerUid`. New deployments start with both equal. `ownerUid` remains historical/source provenance; `reviewerUid` identifies the teacher currently responsible for deployed student work.
- School-admin `handover_offering` atomically ends the current teaching assignment, creates/restores the replacement assignment and transfers review responsibility for up to 100 existing non-cancelled deployments. It does **not** transfer private assessment blueprints, lessons, presentations, references or any teacher-owned source resource.
- Ordinary “End assignment” now refuses to strand a teacher who still holds deployed-task review responsibility; the explicit handover flow must be used first.
- Studio submission review, GitHub evidence review, Gradebook, Class Analytics, lifecycle controls, submission alerts, continuity export and restore all use `reviewerUid || ownerUid` for backward-compatible responsibility.
- People & Access includes a reviewed Teacher Handover form and explains that private teacher resources retain their original ownership.

## Studio compact/mobile workspace completion — October 31, 2026

- Adminerva Studio now keeps Save, Run, Tools and assessment Submit as the primary narrow-screen actions instead of permanently exposing secondary project controls.
- Format, project settings, Minerva, XML Layout Lab, ZIP/import/export/reset/restore and compatibility project actions are consolidated under a single Tools disclosure.
- Explorer is collapsible, persists its device preference and becomes a bounded horizontal workspace strip on phones instead of permanently consuming editor width/height.
- Optional program input is collapsed by default and expands only when needed.
- Older two-row mobile toolbar rules are explicitly overridden so the 4.0 command surface remains one row; very narrow phones receive additional compact sizing without hiding Save.
- Terminal/Web preview/Desktop application remain output views inside Code rather than separate top-level Studio workspaces.

## 4.0 cutover readiness and reversible compatibility retirement — October 31, 2026

- `school-cutover-readiness.js` performs a bounded canonical integrity review without reading teacher-private reusable content. It checks active school administration, academic catalog/offerings, student person links, enrollments, teacher assignments, deployed-task responsibility, published-grade identity links, Practice migration markers, Storage-policy consistency and activation attestations.
- School administrators can review the same checks in `school-cutover-readiness.html`; the page is read-only and cannot retire compatibility.
- Platform-owner school records now carry a reversible `compatibilityMode`: `legacy_allowed` or `v4_only`. Existing schools with no field default to `legacy_allowed`, preventing accidental MCS cutover. Newly provisioned schools start `v4_only`.
- Switching an existing school to `v4_only` requires a clean server readiness result plus explicit owner attestations for continuity backup, migration reconciliation, rollback review and required V4 route validation. The operation is audited and does not delete 3.x or canonical data.
- Rollback switches the school back to `legacy_allowed` and records the rollback reason; it does not reverse or delete V4 data.
- Verified tenant context now includes the server compatibility mode. Staff admission treats a migrated legacy teacher as V4-only only after every verified school on that account is `v4_only`; multi-school accounts therefore fail conservatively if any school still needs compatibility.
- Once cut over, migrated school administrators/teachers are fenced from legacy global administration/teacher workspaces and redirected to canonical V4 surfaces. The legacy role records remain present solely for reversible compatibility until final retirement.
- The owner registry shows compatibility mode and canonical readiness blockers before offering the cutover control.

## Continuity-export v2 integrity and restore readiness — October 31, 2026

- The school continuity export now uses `adminerva-school-continuity-export-v2`. Each exported canonical category carries its own record count and SHA-256 digest in addition to the top-level bundle hash.
- Browser export assembly performs a final server-side integrity pass for every category. If school data changes while pages are being collected, no continuity file is produced.
- The server records only a privacy-safe export receipt after it independently re-verifies every category: bundle hash, category counts/digests, actor, revision and timestamp. Exported personal/academic records are not copied into the receipt.
- The 4.0 readiness gate now requires a current-schema verified continuity-export receipt prepared within the last 24 hours. This is evidence that a fresh recovery bundle was prepared; it does not claim that an institution stored the downloaded file correctly.
- The restore planner rejects any bundle whose category set/count/digest metadata does not match its actual contents, even if a modified file has a recomputed top-level SHA-256.
- Restore planning now surfaces separately required active teacher/student memberships before approval for active teaching assignments, repository configuration, deployed assessments and published grades. Automatic restore still never creates memberships or grants roles.
- Relationship identifiers are validated before dependency-key construction so malformed recovery rows become explicit blockers instead of aborting the planner unexpectedly.

## Controlled V4-only compatibility retirement — October 31, 2026

- The platform-owner school control plane already provides audited `legacy_allowed` ↔ `v4_only` switching. V4-only enablement re-runs school cutover readiness and requires continuity backup, migration reconciliation, rollback review and V4 route validation attestations; rollback is separately audited and does not delete canonical data.
- Verified account admission already propagates `compatibilityMode` through `tenantSchools`. When all active school memberships for the account are V4-only, the auth guard fences migrated teachers/students from legacy workspaces and routes legacy analytics/grading bookmarks to canonical V4 pages.
- Firestore rules now use the authoritative MCS school compatibility mode to disable legacy `isAdmin()` / `isTeacher()` authority after cutover. Student-owned flat `students`, `student_access`, legacy Practice profile/progress/award/season data, legacy account requests and teacher connection records are also fenced.
- Legacy MCS callable services now fail closed after V4-only cutover: legacy lesson recovery/setup, legacy student-access refresh and legacy Practice callables reject direct invocation even when a caller bypasses the browser UI.
- Canonical `schools/{schoolId}` data remains server-authorized and unaffected by this legacy gate. Rollback to `legacy_allowed` reopens compatibility paths without undoing V4 data.
- Legacy support/history records that are intentionally retained for reference are not treated as canonical authority and are not automatically deleted by cutover.

## Bootstrap-authority retirement at V4 cutover — October 31, 2026

- `tenantSchools` now returns the authoritative MCS legacy-compatibility state in addition to verified school memberships and platform-owner authority.
- `staff-session.mjs` suppresses all legacy `staff_access` / hardcoded bootstrap presentation roles when MCS compatibility is disabled. A cut-over account retains privilege only through canonical school membership or `platform_admins/{uid}`.
- This removes the prior half-authorized state where a legacy bootstrap administrator could still render as `superadmin` after Firestore had already denied legacy data access.
- Cached browser role state remains presentation-only; the auth guard re-resolves server-backed access and routes accounts without canonical authority away from privileged workspaces.
- The hardcoded legacy email and old notification/issue compatibility code remain in source only for the rollback window. They no longer provide authority after V4-only cutover and can be physically removed after the migration has been observed stable.

## Reviewed roster-to-course mapping — October 31, 2026

- People import still creates **people only**. CSV/Google Sheets `section` values remain ephemeral hints and are never treated as authorization, membership or enrollment.
- After an exact people preview is committed, People & Access groups valid student rows by section hint and matches only one exact active school section name. Missing or ambiguous section names remain unapplied.
- The school administrator must select a specific active course offering, provide an audit reason and confirm each group. This invokes the existing tenant-checked `bulk_enroll_students` service, which skips active duplicates and refuses to silently restore ended enrollment history.
- A section hint can correspond to several subject/term offerings, so Adminerva never chooses one automatically. Groups above the bounded 80-student bulk operation are directed to the normal Classes workflow.
- Staff section hints remain advisory until a verified teacher membership exists. Roster import therefore cannot create teacher access or silently assign a staff row to a class.

## School operational setup readiness — October 31, 2026

- `functions/school-onboarding-readiness.js` adds a read-only school-admin setup review that summarizes only counts and configuration state; it does not expose private student work, grades, teacher resources or credentials.
- Required operational checks cover active institutional attestations, at least one active school administrator, People records, teacher/student memberships, the academic catalog, active course offerings, teaching assignments and student enrollments.
- School file retention/support attachments and school AI are shown as optional services. They remain fail-closed when not configured and do not prevent a school from completing the core operational checklist.
- `school-onboarding-readiness.html` is a mobile-first School Administration surface with conditional verified-school switching, progress, setup counts and direct links to People & Access, academic setup, Data & Files and Settings.
- Operational setup readiness is deliberately separate from `school-cutover-readiness.html`. Completing ordinary school setup does not authorize legacy retirement, production migration, continuity backup acceptance or MCS reconciliation.
- Platform-owner authority alone does not grant access to this private school setup summary; the service requires an active `school_admin` membership for the selected school.

## Delivery and remaining work

| Track | Actual implementation in PR #113 | Remaining before Adminerva 4.0 |
|---|---|---|
| Verified tenant foundation / five roles (#104) | Server verifies email-verified UID, active school state and canonical membership roles; distinct platform-owner authority; verified auth routing; hidden single-school / conditional multi-school account context; new namespace deny rules and owner provisioning/recovery service. | Migrate the remaining legacy Firestore/Functions/Storage paths and page families, then retire the legacy email/bootstrap compatibility role after owner/teacher grants and MCS membership reconciliation. |
| Legacy MCS pilot (#105) | MCS-only provenance recorded; nested dry-run ledger, canonical hashes, reviewed legacy-mirror apply/reconciliation, plus staged canonical foundation, academic-access, assessment, immutable evidence/Studio and grade planners/approval/apply engines. Historical scalar grades have an explicit compatibility path instead of fabricated rubric data. | Generate the real restricted backup/ledger and identity report, complete operator review artifacts, execute/reconcile each gated stage in a controlled environment, add lesson/presentation/practice transforms, and rehearse rollback before cutover. |
| Assessment Studio / LMS (#106) | Teacher blueprint/deployment, lifecycle close/reopen/archive/cancel, reviewer handover, Studio/GitHub evidence, reclaim, dedicated V4 Gradebook and scored Practice are tenant-scoped; canonical MCS migrations preserve revisions, ownership and publication/progress state. Studio now has the compact mobile command surface, collapsible Explorer and consolidated Tools workflow. | Complete remaining compatibility retirement after MCS reconciliation. |
| School control plane / operations (#107) | Owner Console creates drafts, grants verified school admins, activates with attestations, suspends institutions, performs reviewed school-admin recovery, and school AI configuration/usage is tenant-isolated. School support/analytics and assessment/reclaim notifications are tenant-scoped. School file retention/support attachments, integrity-bound continuity export/restore planning and the school setup-readiness UI are implemented. | Complete the real MCS administrator/configuration decisions and operate the approved backup/migration workflow before cutover; no production setup is executed by this branch. |
| Mobile-first (#108) | Conditional school context plus mobile-ready People & Access, School Support, V4 Gradebook/Operations, lesson/presentation bridges, school-aware Practice and compact Studio tools; scoped editors invalidate or veto unsafe school changes. | Finish remaining compatibility/admin surfaces and complete listener/cache invalidation on every live route. |
| Teacher privacy (#110) | Private creator-owned blueprints/planning resources, deliberate teacher sharing/copy, verified recipients, and explicit deployed-task reviewer handover without changing private source ownership. | Optional coedit/reviewer/publish delegation for private reusable resources remains a future policy choice; it is not required for 4.0 task handover. |
| User Directory (#111) | School-only People & Access API/page: overview, paginated/searchable/filterable people, rename/archive/restore lifecycle, consolidated person detail/audit history, preview-first idempotent CSV/Google Sheets import, reviewed section-hint-to-course enrollment, actionable bounded directory reconciliation, bounded CSV export, account invitations/acceptance, membership suspend/restore, academic catalog, offerings, single/bulk enrollments, single/bulk teacher assignments, class roster lifecycle and audit writes. | Remaining migration conveniences after MCS reconciliation. |
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
