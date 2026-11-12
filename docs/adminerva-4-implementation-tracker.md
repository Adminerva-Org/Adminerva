# Adminerva 4.0 — implementation tracker (Assessment Workflow Review)

**Updated:** 2026-11-06  
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

**Remaining:** the planned 4.0 engineering workstreams are implemented on this branch. Production still requires the real MCS administrator/calendar/policy decisions, protected migration and continuity execution, a successful recorded cutover package, backend-first activation, the final compatibility switch and frontend release. Compatibility-only rollback code remains until the observed rollback window is complete. No production Firestore copy, role grant or deployment has been executed; do not present the new callables as deployed features.

## Controlled SHS pilot state and subset migration — November 8, 2026

- A distinct `pilot` school state now separates teacher-led technical use from institutional production activation. Verified pilot members may use school-scoped V4 workflows while `productionAuthorized=false` and MCS remains `legacy_allowed`.
- Platform Owner can start `draft → pilot` only after a reviewed first School Admin exists and explicit limited-scope/non-production acknowledgements are recorded. `pilot → draft` disables V4 member access without deleting canonical data.
- Full `active` promotion still requires the existing institutional authority, provenance, calendar and privacy attestations. Pilot state cannot enable `v4_only` and deliberately fails production cutover readiness.
- The MCS foundation apply path now safely adopts the designated pre-existing first-admin membership, preserving School Admin while adding the reviewed Teacher role rather than treating that membership as a migration conflict.
- New protected pilot tooling creates a private operator file, filters canonical foundation planning to the four populated SHS ICT sections plus the designated teacher, cross-checks only aggregate roster counts, and generates an unapproved prefilled academic review for the two semesters/four programming subjects/eight active offerings.
- Initial pilot migration stops after foundation + academic access. Historical assessments, evidence/grades, planning, Practice, Basic Education and St. Sebastian students remain deferred.
- Operational procedure: `docs/adminerva-4-mcs-shs-controlled-pilot-runbook.md`.

## MCS teacher-led pilot scope refinement — November 8, 2026

- Initial canonical academic configuration is limited to **Senior High School ICT**: Grade 11 TechPro (ICT) sections St. Isidore of Seville, St. Carlo Acutis and St. Sebastian; Grade 12 TVL (ICT, old curriculum) sections St. Philip the Apostle and St. Anselm of Canterbury.
- Basic Education is intentionally deferred from the initial pilot. Deferred records remain preserved and must not be treated as inactive merely because they are outside the first pilot scope.
- Pilot subject sequencing is now explicit across the full academic year: Grade 11 TechPro (ICT) uses **Computer Programming 1** in Semester 1 and **Computer Programming 2** in Semester 2; Grade 12 TVL (ICT, old curriculum) uses **Computer Programming 3** in Semester 1 and **Computer Programming 4** in Semester 2.
- Semester-specific course-offering templates are defined for all five pilot sections. The live academic-year ID remains configurable and is supplied when the school creates/activates that year's catalog.
- Academic years now support editable start/end month defaults. MCS uses **July → May** by default; exact dates remain an institutional calendar decision.
- The provisional teaching escalation chain is Teacher → Strand/Level Leader → Subject Area Coordinator → Senior High Coordinator → appropriate administration/office. It is recorded for future governance/workflow modeling only and does not grant RBAC authority.
- Institutional authority, privacy, retention, backup/recovery and complete organizational references remain unavailable to the teacher-led pilot and are explicitly **pending**, not fabricated.
- Because MCS compatibility is currently school-wide, the limited Senior High pilot should remain `legacy_allowed`. Do not perform the final MCS-wide `v4_only` switch until the remaining active legacy population is reviewed or the authorized administration approves the full cutover scope.
- A protected teacher-collected roster snapshot is available for migration cross-checking: **168 populated responses / 168 unique account emails / 0 duplicate email submissions**. Pilot coverage is St. Isidore of Seville 44, St. Carlo Acutis 34, St. Philip the Apostle 45, St. Anselm of Canterbury 44, and St. Sebastian 0 (pending). One row is outside the pilot section set.
- The roster form used a multi-select section/activity field. Twenty-four pilot rows include a club/activity selection alongside the section, so migration/import review must recognize the canonical section token rather than require exact full-field equality.
- Student names and account emails from that roster are retained only in the protected Drive reference and are deliberately excluded from this public repository.

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

## V4 legacy route-fence completion — October 31, 2026

- The V4 teacher route fence now sends legacy Practice Analytics to the canonical Practice Progress workspace rather than Class Analytics.
- School administrators opening legacy `issues.html` after cutover are redirected to tenant-scoped School Support.
- At `v4_only`, the legacy admin page family (`users`, teacher accounts, admin analytics/hub, section/program/subject managers) is retired for every authority, not only school-admin members.
- Verified school administrators are routed to People & Access or School Administration; platform owners with a historical global admin record are routed to Owner Console rather than being left on a 3.x page whose Firestore authority is already disabled.
- Platform-owner-only access to the retired global issue page is also removed at cutover. Product ownership and private school support remain separate authorities.

## Legacy issue/monitoring rule retirement — October 31, 2026

- Firestore's legacy MCS gate now explicitly covers reporter access to global `issues`, creation of new global issue reports, activity-preference reads/writes, activity-event writes and issue-diagnostic writes.
- This closes the paths that did not necessarily pass through `isAdmin()`, `isTeacher()` or `ownsStudentProfile()`, all of which were already compatibility-gated.
- Once MCS enters `v4_only`, browsers can no longer use the flat legacy issue/monitoring collections even with a copied old page or stale SDK client. School Support remains available through the tenant-scoped callable service.
- Existing global records are retained for migration/history; the change removes browser authority rather than deleting historical data.

## Legacy background-trigger retirement — October 31, 2026

- The MCS compatibility gate now exposes a non-throwing `legacyMcsCompatibilityAllowed()` check for background handlers in addition to the callable failure gate.
- When `platform_schools/mcs-manila.compatibilityMode` is `v4_only`, legacy global roster rebuild/synchronization, activity monitoring, issue/reclaim notifications, evidence/submission notifications, assessment-assignment notifications and legacy grade notifications return without side effects.
- Legacy callable recovery/setup and legacy Practice operations continue to fail with an explicit precondition error after cutover; event handlers intentionally no-op so they do not generate retry noise for stale Admin SDK/migration writes.
- Canonical school-scoped Assessment, Gradebook, Reclaim, Studio/GitHub evidence and Support services remain active and keep their own `schools/{schoolId}/notifications` fan-out.
- Product-wide functions that are not legacy MCS workflow handlers (for example release announcements and explicit push test pings) were not disabled.

## Legacy Practice browser retirement — October 31, 2026

- Authenticated Practice now resolves verified-school scope before choosing a scoring service. If tenant lookup is unavailable, it fails closed instead of silently falling back to the flat legacy MCS Practice runtime.
- Legacy mode is used only when a successful tenant lookup confirms that the signed-in account has no canonical student school membership. Guest Practice remains available without an authenticated score identity.
- The remaining legacy `practice_packs` student-read path is explicitly gated by `legacyMcsAllowed()`; stale SDK clients cannot read flat MCS practice packs after the pilot enters `v4_only`.
- Flat seasonal Practice leaderboard/progress reads were already compatibility-gated, while the V4 school page receives school leaderboard rows through the school-scoped callable service. The current student page therefore does not require those flat collections after cutover.
- Student and guest Practice entry points now load the same updated session helper. Guest mission browsing remains unchanged; only authenticated legacy-score fallback semantics changed.

## V4 Studio tenant-local isolation — October 31, 2026

- Project Hub now deep-links canonical school Studio projects with `?codeProject=`; Studio falls back to `schoolStudioProjects.get` when the project is not already cached on the device, materializes the verified school revision locally, and continues syncing the same project ID/revision.
- The shared verified-school scope now retains the server-returned school `compatibilityMode`. Studio therefore actually observes `v4_only` instead of silently treating every selected school as legacy-compatible.
- In `v4_only`, named Studio projects no longer read, write or delete through the flat personal `student_code_projects/{uid}` cloud mirror. Canonical persistence remains under `schools/{schoolId}/student_code_projects/{uid}/projects/{projectId}`; compatibility-mode MCS keeps the legacy mirror only while migration remains enabled.
- V4-only local named-project lists and project undo snapshots are scoped by verified school. A project cached for School A cannot appear in School B's local Studio list or be queued into School B merely because the same browser/account switches schools.
- Legacy-draft import now goes through the scoped project controller, so an explicit import into a V4-only school cannot bypass the per-school local cache.
- Studio prevents school switching while a named project is open or a school save is queued/in flight. Switching from the project home reloads the workspace after the verified-school picker records the new school, ensuring the next school receives a fresh scoped project store.
- When a V4-only student has multiple schools and no school is selected, Studio does not expose an unscoped named-project home; it requires the verified school selection first. The picker then reloads into the selected school workspace.
- New institutions already default to `compatibilityMode: "v4_only"`; the legacy-compatible local/global mirror is therefore an MCS migration concern rather than the default for future schools.

## V4 Student Home routing cleanup — October 31, 2026

- Student Home now loads the current V4 auth/navigation/home-routing assets, so the existing school-scoped Project Hub, Assignments, Settings and Support rewrites actually run for V4-only student accounts.
- The shared Continue/resume helper now receives verified `v4OnlyStudent` state and translates remembered legacy student dashboard, assignment, settings and issue-report destinations before rendering the resume card.
- Practice, Adminerva Studio and XML Lab remain direct student workspaces; school-scoped Practice selects verified school context internally and no longer needs a legacy landing-page detour.
- Auth Guard remains authoritative. This cleanup removes stale 3.x entry-point presentation and redirect-after-click behavior without widening student access.

## V4 Staff Home routing cleanup — October 31, 2026

- Staff Home now applies V4-only presentation state from either the verified `adminerva:role-ready` payload or the already-published navigation dataset, so a late-loaded home module cannot leave legacy links visible.
- V4-only teacher quick access now routes directly to Assessment Library, Lesson Planner, Teacher Schedule, private references, Class Analytics, Practice Progress, commit-attribution requests and School Support.
- The V4 Staff Home introduction now reflects both assessment and planning workflows instead of implying the retired repository-only workflow is the complete teaching workspace.
- Session resume routing translates remembered legacy teacher destinations to canonical V4 pages before the Continue card is rendered: legacy grading/review pages → V4 Gradebook, legacy Assessment Studio → Assessment Library, legacy analytics → canonical analytics, legacy issue reporting → School Support, and legacy Reference Library → private verified-school references.
- The shared session-destination allowlists now recognize current V4 assessment, planning/reference and school-admin readiness pages. Auth Guard remains authoritative; these changes only prevent avoidable legacy hops and stale presentation.

## V4 Lesson Settings tenant cleanup — November 6, 2026

- Lesson Settings now imports the same verified-school workspace session used by the live planning editors, so teacher-private lesson/export preferences do not require a legacy `staff_access` role after cutover.
- Subject suggestions use `schoolAcademics.planning_options` in `v4_only`, limited to the teacher's active course offerings. Compatibility-mode MCS keeps the legacy school-options adapter until migration is retired.
- Existing teacher-private lesson settings remain under the staff workspace preference path; they were not moved into a school-shared configuration because they are personal export/signatory defaults rather than institutional academic records.
- The Settings entry page was cache-versioned for this module change.

## V4 Settings legacy-read retirement — November 6, 2026

- Settings now resolves tenant/platform access before loading legacy personal Gemini/GitHub credentials. Canonical school accounts whose compatibility is retired do not query the flat `teachers` profile for those secrets.
- Retired personal credentials are also cleared from the browser connection cache for that account, preventing a hidden legacy key from being reused accidentally by an older compatibility path.
- The RepoReview **Grading Rubrics** settings module now retires its flat global `templates` client for canonical school accounts. It does not subscribe/read/write the legacy template collection after cutover.
- Canonical users are directed to the school Assessment Library for assessment/rubric management; direct calls to legacy rubric mutation handlers are refused while the module is retired.
- Compatibility-enabled MCS teachers retain the old personal credential/rubric settings until the migration/cutover gate removes that compatibility path.
- Settings asset versions were refreshed so hidden legacy panels cannot keep running cached background reads after 4.0 is staged.

## V4 settings credential retirement — October 31, 2026

- Settings now labels browser/profile Gemini and GitHub credentials as **legacy personal API credentials** rather than implying they power verified-school AI.
- For canonical school accounts without an active legacy teacher compatibility role, and for schools already in `v4_only`, that personal credential card and write action are removed from the UI. The write handler also refuses a direct invocation in that mode.
- School AI remains visible through the separate tenant-scoped connection card. Teachers can see readiness but never receive the school key; only active school administrators can change the school connection.
- The settings behavior is driven from verified auth/navigation role state, with a dataset fallback for module/event ordering. It does not use local role state as authorization.
- `school-ai.mjs` now retains the server-returned school compatibility mode in its cached school context for V4-aware consumers.

## Verified-school planning workspace admission — November 6, 2026

- The shared planning `workspace-session.mjs` no longer calls legacy `resolveStaffRole()` when Lesson Planner, Slide Editor, Schedule or export helpers need an authenticated teacher UID.
- Planning workspace admission now uses tenant-first `resolveAccountAccess()`: an active verified-school teacher membership is sufficient, while compatibility-mode legacy teacher/admin roles continue to work during migration.
- The editor workspace banner reflects verified-school ownership for canonical teachers instead of calling the surface a personal legacy workspace.
- Lesson, presentation, timetable, AI/UI and export modules now import the same updated workspace-session URL, preventing a browser from instantiating a second legacy-gated session module alongside the V4 bridge.
- The three editor entry pages were cache-versioned again because their underlying module imports changed after the earlier planning cache pass.

## Tenant-first account resolution — November 6, 2026

- `resolveAccountAccess()` now resolves the verified tenant/platform context before touching any flat legacy identity collection.
- When the server reports legacy compatibility retired, canonical accounts do not query `staff_access`, `teachers` or `students` at all. School/platform roles from `tenantSchools` are sufficient for presentation and routing.
- MCS compatibility mode preserves the existing legacy staff/student profile lookups so migration continuity is unchanged before cutover. If the tenant callable itself is unavailable during staged rollout, the resolver retains the existing compatibility fallback rather than falsely treating the account as V4-only.
- School Administration now gives verified `school_admin` membership precedence over a historical global admin role. A dual-role user therefore receives tenant-scoped school counts/actions instead of the old flat platform summary.
- Platform-owner-only accounts entering School Administration after V4 cutover are sent to Owner Console instead of probing legacy global admin collections.
- Auth Guard and the affected canonical/retired entry pages were cache-versioned so direct navigation uses the tenant-first resolver before applying V4 route fences.

## V4 planning legacy-read retirement — November 6, 2026

- `schoolAcademics.planning_options` now supplies tenant-scoped academic choices for planning. Teachers receive only active sections, subjects, school years and offerings backed by their active teaching assignments; school administrators may review all active offerings in their selected school.
- Lesson Planner uses those canonical choices in `v4_only` and no longer loads the flat `school_catalog`/global student roster merely to populate planning inputs.
- Lesson Planner suppresses legacy reference-folder startup reads and older-lesson recovery/deep-link reads after cutover. Its school bridge provides private references, timetable context, previous-week lessons and canonical saves instead.
- Slide Editor still builds its selector UI, but in `v4_only` it does not fetch legacy personal lesson plans at startup; the school presentation bridge supplies canonical lesson/session sources.
- Teacher Schedule uses verified-school assignment/catalog choices in `v4_only`, skips the legacy personal schedule/preferences startup reads, and avoids writing legacy personal schedule options. Canonical timetable load/save remains in `schoolSchedules`.
- Compatibility-enabled MCS accounts retain the legacy reads during migration. These changes therefore remove post-cutover background permission failures without deleting migration continuity paths.
- The affected Lesson Planner, Slide Editor and Schedule page assets were cache-versioned so the new startup behavior is used when 4.0 is staged.

## V4-only planning/runtime cutover — October 31, 2026

- The existing private and school-shared reference services are now exported as `schoolReferences` and `schoolSharedReferences`; the shared-reference UI no longer points at missing callables.
- `teacher-reference-library.html` adds the missing private verified-school reference workspace. Teacher-owned folders and documents stay scoped to the selected school and UID; PDF ingestion remains transient and stores extracted text only.
- Lesson Planner now detects server-returned school `compatibilityMode`. In `v4_only` mode it suppresses legacy personal save/load affordances and uses canonical private reference folders/documents, verified-school teacher schedules, canonical previous-week lessons, school AI, and private `schoolPlanning` persistence.
- Slide Editor now uses canonical verified-school lessons as its lesson/session source in `v4_only` mode, suppresses legacy presentation history/save/archive controls, and saves editable decks to the private school planning repository.
- Teacher Schedule now loads the canonical school timetable after cutover and routes the existing Edit/Save workflow through `schoolSchedules`; class rows continue to be validated against active teacher assignments before persistence.
- Planning school context caches explicitly invalidate on preferred/verified school changes. The global account switcher is read-only on lesson, presentation, timetable and reference workspaces so an account-level context change cannot discard open work silently.
- Central auth/navigation now admits V4-only teachers to Lesson Planner, Slide Editor, Teacher Schedule, private references and school-shared references while continuing to block the legacy `library.html` reference surface.
- School administrators can reach School Setup Readiness and the school-shared reference library through the School Administration navigation. Private teacher reference content remains inaccessible to a school-admin-only account.

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

## Verified-school context invalidation — October 31, 2026

- A targeted live V4 school-picker audit found stale-request/state gaps in School Administration, School Setup Readiness and School Operations analytics.
- School Administration now invalidates prior summary generations and clears school counts before a context change, so an old-school response cannot overwrite the newly selected school.
- School Setup Readiness now clears rendered progress/counts/checks and uses a generation fence around asynchronous readiness calls.
- School Operations analytics now cancels the presentation generation on school switch, clears aggregate cards and allows the newly selected school to load immediately even when the previous school's request is still resolving.
- Other reviewed high-risk school-picker workspaces already veto switches during writes or clear scoped state/epochs before loading the next school (Support, Data & Files, cutover readiness, teacher assessment library, V4 Gradebook/reclaim, student assignments/projects/settings, Practice analytics and teacher class analytics).
- Server authorization remains lease/tenant checked; these changes close client presentation races and stale-school UI state rather than adding authority.

## Actionable directory relationship reconciliation — October 31, 2026

- People & Access now includes a bounded school-admin reconciliation view for unresolved directory/access/class relationships. It reads only school people, memberships, active enrollments, active teaching assignments, course offerings and invitation state.
- Findings distinguish integrity problems from ordinary attention/review items: mismatched membership/person links, invalid active enrollment/assignment dependencies, active students without account access or enrollment, active teachers without course assignments, unlinked staff records and expired pending invitations.
- Results contain only the minimum school-administration labels/IDs needed to route remediation. The reconciliation service does not inspect grades, submissions, evidence, code, repository data, AI content or teacher-private planning/assessment resources.
- Each finding routes the administrator to People, Invitations, School Access or Classes. The report itself is read-only and cannot silently repair, enroll, assign, invite, suspend or restore anything.
- The bounded pilot review fails closed above 500 records in any scanned relationship collection rather than returning a misleading partial integrity result.

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

## School setup readiness catalog accuracy — November 6, 2026

- School Setup Readiness now counts only active academic years, terms, subjects and sections explicitly belonging to the verified selected school. Archived/ended or malformed cross-school catalog entries cannot make the academic catalog checklist appear complete.
- The existing read-only school-admin overview, bounded listing, optional file/AI items and separate migration/cutover readiness remain unchanged.

## MCS identity-to-resource ownership reconciliation — November 6, 2026

- The restricted MCS identity-candidate report now preserves a SHA-256 fingerprint of each verified Auth email on the candidate record. The raw email is still not added to the migration artifact.
- Teacher planning migration can therefore resolve legacy lesson/presentation ownership from a verified owner email when no reliable saved owner UID exists, while still requiring the teacher to be explicitly approved in the canonical foundation.
- If an older identity report lacks the teacher email fingerprint, planning now stops and requires regeneration instead of silently classifying recoverable teacher resources as unresolved.
- One verified Auth UID resolving from conflicting legacy email identities is treated as a manual reconciliation blocker rather than being merged automatically.

## 4.0 reconciliation, compatibility and grading continuity pass — November 6, 2026

- **Academic access reconciliation:** approval files must now contain exactly one decision for every planned student enrollment and teacher-course assignment. Duplicate decisions can no longer hide an omitted relationship while still satisfying the relationship-count check.
- **Legacy compatibility retirement:** product-level administrator actions now prefer verified platform-owner authority. Once MCS is in `v4_only`, the bootstrap administrator email and legacy `staff_access` administrator records no longer authorize those actions; they remain available only during the compatibility window.
- **Studio → Assessment → Gradebook continuity:** live Studio immutable versions now store the assigned course offering ID. Gradebook scoring, historical rubric reconstruction, published-grade correction and publication verify that the frozen version matches the same school, task, offering, student UID, person ID and version as the submission header in addition to verifying the content/evidence digest.
- These changes affect only the undeployed 4.0 branch and migration/review safeguards. No production MCS records, memberships, grades or release metadata were changed.

## 4.0 workstreams 4–6 completion pass — November 6, 2026

- **GitHub evidence / reclaim migration compatibility (#4):** canonical evidence planning now resolves tasks from the reviewed assessment set instead of an out-of-scope planner variable; legacy commit-attribution claims are transformed into school-scoped reclaim history with exact student/task/evidence/SHA binding, decision-record provenance checks, preserved legacy revision history and explicit approve/exclude migration decisions. Pending or rejected reclaim history on the currently selected evidence behind a published grade blocks canonical migration instead of being silently ignored.
- **Teacher resource reconciliation (#5):** shared administrator-era references and shared timetables now have a fixed migration disposition of `retain_legacy_mirror_only`. They are not copied into teacher-private libraries or activated as school-wide resources. Unsafe private folder IDs use the same deterministic remap in both reference migration and lesson migration; lessons retain only verified teacher-owned folder links, while unresolved/shared legacy folder IDs remain in migration provenance. Duplicate reference text is deduplicated without losing source provenance.
- **Historical grade migration (#6):** evidence/grade approval files now require exactly one decision per evidence, reclaim and grade candidate. Historical scalar-only grades remain `legacy_scalar_v1` with their exact score/maximum and are informational rather than redundant blockers; no rubric allocation is fabricated. Grade apply rechecks the exact immutable evidence version against school, task, offering, student UID, person ID, version and digest before creating a historical grade. Published-grade status, not an optional historical timestamp, blocks Studio reopening.
- Migrated Studio immutable versions now carry their course-offering binding in both live and historical migration paths.
- Focused syntax/guard checks passed for the changed migration and runtime files. No production migration, role grant, grade mutation, notification fan-out or 4.0 deployment was executed.

## 4.0 workstreams 7–10 completion pass — November 6, 2026

- **People & Access migration cleanup (#7):** directory reconciliation now detects one Auth UID linked to multiple people, inactive people retaining active memberships/enrollments/teacher assignments, role-to-person-kind mismatches, student+teacher role conflicts, active roleless memberships and pending invitations targeting inactive people. These remain explicit remediation findings; no relationship is silently rewritten.
- **School operational configuration (#8):** setup readiness now requires coherent active academic relationships, not merely existing documents. Active terms must belong to active years; offerings must resolve to active year/term/subject/section records; active enrollments and teacher assignments must resolve to valid active identities and offerings. Cutover readiness applies the same active-catalog and identity integrity standard, including unique person/account links and canonical teacher staff-person linkage.
- **Role/mobile UX completion (#9):** the student workspace now consistently presents the product as **Adminerva Studio**; V4 Gradebook school switching/evidence review has reduced narrow-screen overflow pressure; People & Access tabs/cards/actions adapt for very narrow phones while retaining 44px interaction targets. Existing conditional single-school/multi-school context, compact Studio toolbar, mobile setup/readiness pages and role-aware navigation remain the baseline.
- **Cutover/release preparation (#10):** `functions/mcs-cutover-package.js` now creates one restricted, read-only MCS cutover package binding the completed mirror, mirror reconciliation, canonical foundation, academic access, assessment, evidence/grade/reclaim, teacher planning, planning-support and Practice receipts by SHA-256 while re-running live cutover readiness. The platform-owner control plane can validate and record that package summary; MCS cannot switch to `v4_only` without a fresh successful recorded package. The Owner Console exposes the package-recording workflow and disables final cutover until both live readiness and the package gate pass.
- `docs/adminerva-4-cutover-runbook.md` documents package generation, backend-first activation, the small essential continuity checks, compatibility switch, frontend activation, release publication boundary and reversible rollback.
- Focused syntax/consistency checks passed for the changed backend files and Owner Console integration. No production MCS migration, school-role grant, deployment, compatibility switch or public release was performed by this development pass.

**Development status:** planned workstreams 1–10 are implemented on the 4.0 feature branch. What remains is protected production operation: provide the real MCS administrator/policy/calendar decisions, run the approved migration/continuity artifacts with production credentials, record the successful cutover package, deploy in the documented order, switch compatibility mode and publish 4.0 only after activation.

## Main synchronization and stability pass — November 6, 2026

- The 4.0 feature branch was synchronized with the current `main` hotfix line, including the 3.0.1 global-loader cleanup, evidence/reclaim authorization fixes, Gradebook review resilience, selector UX and feedback-formatting changes. Overlapping files were reconciled without replacing the V4 tenant/cutover fences.
- Compatibility-mode Firestore rules now include the latest stale-section review behavior for legacy evidence, reclaim, submission-receipt and grade reads while short-circuiting excluded namespaces before expensive legacy administrator checks. The Firestore emulator suite passes the maximum supported 20-commit evidence-validation case without exceeding the rule expression budget.
- Stability review found and fixed concrete V4 defects: malformed shared-reference confirmation strings; a school-student-profile syntax error; missing shared loader/help entry points on school invitation and owner registry pages; optional evidence-review shortcuts that could crash the manual review workspace on hosts that do not render those buttons; and incorrect legacy Gradebook current-page navigation state.
- CI now runs the canonical MCS assessment, evidence/grade/reclaim, foundation, planning, planning-support, Practice, reconciliation, tenant-authority, tenant-selector, continuity-export and roster-source tests in addition to the legacy regression suite. Backend dependencies are installed before those contract tests.
- Deployment-contract coverage verifies the exported 4.0 school workflow callables, region, concurrency, max-instance and timeout bounds without performing data operations.
- Focused stability result on the synchronized runtime tree: JavaScript regressions **passed**, Firestore emulator security **passed**, release-source parsing/resolution **passed**, CodeQL **passed**, and JavaScript analysis **passed**.
- The successful checks validate source, service contracts, migration transforms, permission rules and regression behavior; they are not a substitute for the small live pilot workflow confirmation after backend deployment.
- No production deployment, MCS migration, compatibility switch, school-role grant or public 4.0 release was performed during this synchronization/stability pass.

## MCS owner decisions and program-scoped academic calendar — November 7, 2026

- The designated first MCS School Administrator is an existing verified MCS teacher account. Its Firebase UID is intentionally kept out of the public repository and must be entered only through the protected Platform Owner Console during production setup.
- School memberships are explicitly multi-role. Granting `school_admin` preserves an existing `teacher` role; regression coverage verifies the additive role grant.
- Academic calendars are no longer constrained to one school-wide term structure. Canonical `academic_programs` define divisions/programs, and academic periods are bound to program + academic year with a configurable type (`term`, `semester`, `quarter`, `trimester`, or `custom`) and sequence.
- Initial MCS direction: **Basic Education = 3 terms**; **Senior High School = 2 semesters**. Legacy section/program mappings remain explicit operator decisions; migration does not infer Basic Ed versus Senior High from section names.
- Sections and course offerings are program-scoped. Offerings, enrollments, teaching assignments, assessments, teacher analytics and V4 teacher schedules preserve the program/period relationship. V4 teacher schedules use canonical academic-period IDs; legacy S1/S2 schedules remain isolated to compatibility/migration.
- School AI is approved for MCS subject to protected credential configuration. GitHub/external repository workflows are approved subject to the existing school/repository authorization controls.
- MCS default data steward is `school_admin`. Platform Administrators can create non-operational governance-role definitions and assign them to selected schools; a custom steward role cannot pass cutover readiness unless it exists and is actively assigned to that school.
- MCS retention direction is **retain all historical data**. Cutover decisions now record `retentionMode=retain_all`; optional finalized support attachments can use audited indefinite retention while abandoned upload reservations still expire.
- Continuity export is now `adminerva-school-continuity-export-v3`, including academic programs, program-scoped periods/sections/offerings/access relationships and assessment program scope. Restore planning/apply validates the same dependency graph and rejects cross-program mismatches.
- `docs/adminerva-4-mcs-production-decisions.md` records these non-sensitive decisions. Credentials, the first-admin UID, migration payloads and private institutional policy documents remain outside source control.
- Focused validation after these changes: JavaScript regressions **passed**, release-source **passed**, CodeQL **passed**, JavaScript analysis **passed**, and Firestore emulator security **passed**.
- No production role grant, MCS migration, AI credential setup, repository authorization, deployment, compatibility switch or public release was performed.

## Delivery and remaining work

| Track | Actual implementation in PR #113 | Remaining before Adminerva 4.0 |
|---|---|---|
| Verified tenant foundation / five roles (#104) | Server verifies email-verified UID, active school state and canonical membership roles; distinct platform-owner authority; verified auth routing; hidden single-school / conditional multi-school account context; new namespace deny rules and owner provisioning/recovery service. | Migrate the remaining legacy Firestore/Functions/Storage paths and page families, then retire the legacy email/bootstrap compatibility role after owner/teacher grants and MCS membership reconciliation. |
| Legacy MCS pilot (#105) | MCS-only provenance recorded; nested dry-run ledger, canonical hashes, reviewed legacy-mirror apply/reconciliation, plus staged canonical foundation, academic-access, assessment, immutable evidence/Studio, grade, teacher planning/reference/timetable and Practice planners/approval/apply engines. Historical scalar grades have an explicit compatibility path instead of fabricated rubric data. | Generate the real restricted backup/ledger and identity report, complete operator review artifacts, retain the reconciled shared legacy planning/reference records as mirror-only history, execute/reconcile each gated stage in a controlled environment, and rehearse rollback before cutover. |
| Assessment Studio / LMS (#106) | Teacher blueprint/deployment, lifecycle close/reopen/archive/cancel, reviewer handover, Studio/GitHub evidence, reclaim, dedicated V4 Gradebook and scored Practice are tenant-scoped; canonical MCS migrations preserve revisions, ownership and publication/progress state. Studio now has the compact mobile command surface, canonical Project Hub deep-links, V4-only school-scoped local project caches and no flat personal cloud mirror after cutover. | Complete remaining compatibility retirement after MCS reconciliation. |
| School control plane / operations (#107) | Owner Console creates drafts, grants verified school admins, activates with attestations, suspends institutions, performs reviewed school-admin recovery, and school AI configuration/usage is tenant-isolated. School support/analytics and assessment/reclaim notifications are tenant-scoped. School file retention/support attachments, integrity-bound continuity export/restore planning and the school setup-readiness UI are implemented. | Complete the real MCS administrator/configuration decisions and operate the approved backup/migration workflow before cutover; no production setup is executed by this branch. |
| Mobile-first (#108) | Conditional school context plus mobile-ready People & Access, School Support, V4 Gradebook/Operations, school-native lesson/presentation/timetable/reference planning, school-aware Practice and compact Studio tools; scoped editors invalidate or veto unsafe school changes. V4 planning inputs now also use canonical assigned course options and suppress flat legacy startup reads. | Finish remaining legacy compatibility/admin surfaces; continue applying the same generation/lease pattern when additional live routes are migrated. |
| Teacher privacy (#110) | Private creator-owned blueprints/planning resources, deliberate teacher sharing/copy, verified recipients, and explicit deployed-task reviewer handover without changing private source ownership. | Optional coedit/reviewer/publish delegation for private reusable resources remains a future policy choice; it is not required for 4.0 task handover. |
| User Directory (#111) | School-only People & Access API/page: overview, paginated/searchable/filterable people, rename/archive/restore lifecycle, consolidated person detail/audit history, preview-first idempotent CSV/Google Sheets import, reviewed section-hint-to-course enrollment, actionable bounded directory reconciliation, bounded CSV export, account invitations/acceptance, membership suspend/restore, academic catalog, offerings, single/bulk enrollments, single/bulk teacher assignments, class roster lifecycle and audit writes. | Remaining migration conveniences after MCS reconciliation. |
| Release safety (#109) | Core deny-by-default scoped APIs, deny-all Cloud Storage baseline, V4-only legacy-page fence with canonical planning exceptions, tenant-first account resolution, legacy callable/background-trigger/Practice-browser cutover fences, tenant support/notifications/AI isolation, and school-scoped Studio browser/server state after cutover; no production modifications. | Complete remaining legacy surface migration, MCS reconciliation/rollback, focused cross-school denial and continuity checks, then backend-first staged activation and one public 4.0 release. |

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


## Mainline reconciliation and workspace consolidation — November 12, 2026

- Reconciled Adminerva 4.0 against the current maintenance line through main commit `8dfa9a6e69be893a9dc1647044cb0f3b173869c1`, intentionally stopping before the separate Class Record work. Class Record is not part of this V4 reconciliation workstream and was not modified here.
- First absorbed 79 non-conflicting current-main files, then reconciled overlapping teacher/student workflows deliberately instead of overwriting tenant-specific V4 behavior.
- Personalized Assessment now remains complete inside the V4 compatibility path: current authoring/personalization UI, explicit publish/unpublish lifecycle, private external variant pools, cross-batch scenario registry, student personalized-task panels, variant-to-attempt binding and the latest safe first-activation Firestore rule are present. V4 `firestore.rules`, function exports and the Studio variant service match the current pre-Class-Record main contracts for this feature.
- Adminerva Studio keeps the V4 school-scoped project store and school-switch protections while carrying current mobile editor pinch/pan, Menus/Tools hierarchy, editor preferences, inline terminal input, Java diagnostics, queue/review state and refresh-safe runtime recovery. The optional server runtime remains disabled unless a trusted runtime origin is configured; no execution backend is silently changed by this reconciliation.
- Gradebook compatibility views are format-aware: repository gather/reclaim controls stay with GitHub assessments, while Studio/personalized tasks route teachers to the frozen Studio submission review workflow. Current external-evaluation paste normalization is retained.
- Lesson Planning keeps the verified-school save bridge, canonical school academic options and V4 legacy-read fences while gaining the current timetable-derived session structure, deterministic session dates/remarks, instruction-to-section mapping and batched full-reference analysis.
- Teaching workspace presentation is consolidated and refreshed across Lesson Planner, academic-period-aware Schedule and Slide Editor. The private co-teacher pilot sandbox remains isolated and is now discoverable under Teaching rather than becoming another top-level workspace.
- Staff navigation now presents broad workspaces rather than every implementation page: **Assess & grade**, **Teaching**, **Insights**, and role-gated **School administration**. School administration exposes four routine entry points—Overview, People & classes, Resources & data, and Advanced readiness—while specialist pages remain reachable inside those workflows.
- Student Home, Project Hub compatibility, Practice and XML Lab carry the current responsive/loading treatment while retaining V4 tenant routing and school-aware Practice behavior.
- Legacy compatibility review/admin pages received the current teacher-first UI and loading improvements without removing V4 cutover fences. The legacy user directory keeps tenant-first admission and no longer performs automatic GitHub repository checks or silently rewrites student repository URLs; verification is explicit and limited to visible rows.
- After the initial pre-Class-Record reconciliation boundary, selected later **non–Class Record** fixes were also carried: Studio grade publication/correction stays inside Studio review rather than Repository Management, and Java Errors/Warnings are docked under Explorer with severity tabs. No Class Record source, route or navigation was added to this branch by this pass.
- Remaining work is no longer a broad UI feature build. It is controlled production preparation: finish any residual compatibility retirement identified during reconciliation, prepare/review real MCS migration and continuity artifacts, provide the protected first-school-admin and institutional calendar/policy inputs, activate the controlled pilot, perform focused role continuity checks, and only later authorize the MCS-wide `v4_only` cutover and public 4.0 release.


## Canonical assessment parity completion — November 12, 2026

- **Personalized Assessment survives `v4_only`.** The canonical verified-school Assessment Library now supports Standard or Personalized Studio blueprints. Public blueprint metadata stores only the mode, target and variation guidance; full learner prompts and private evaluator notes live under teacher-private school-scoped pool records.
- Personalized pools are owner-only, version/fingerprint bound, scenario-de-duplicated across external-AI batches, capped at 600 variants, and require explicit activation after imports. Sharing/copying a blueprint never copies the owner's private pool; the recipient must generate/import a separate pool for their independent copy.
- A canonical deployment freezes the exact activated pool fingerprint and variant-ID set. Each enrolled learner attempt receives one server-issued variant reserved uniquely within that deployed task; a teacher-requested revision receives a new attempt/variant. Learners receive the prompt only. Teacher Gradebook inspection receives the frozen prompt plus private evaluation notes as context, without adding hidden rubric criteria.
- Canonical Studio submission writes now bind the issued variant ID and attempt to the immutable frozen project version. Direct submission without a matching server-issued variant is rejected.
- **Deploy and Publish are separate in V4.** Creating a class deployment prepares it privately with `published=false`. Only an explicit teacher Publish action makes it visible to students and sends assignment notifications. Unpublish hides the task while preserving submissions, evidence and grades. Student Studio, Personalized-variant and GitHub-evidence endpoints independently enforce publication so a known task ID cannot bypass the visibility gate.
- Studio reviewed grades remain publishable/correctable from the Studio review workflow; Repository Management controls are not required for Studio grading.
- MCS migration artifacts were upgraded so newly created Personalized Assessments are not lost at cutover. The mirror inventory now captures detached `studio_assessment_variants/*/attempts/*` documents; assessment migration reviews and applies the exact activated private pool; deployed tasks preserve publication state; evidence migration preserves each variant ID/frozen prompt and reconstructs canonical attempt/uniqueness records from the reviewed legacy assignment source.
- Assessment migration plan/approval/receipt and evidence-grade plan/approval/receipt are now v2 contracts. The final MCS cutover package requires the new v2 receipts and rejects stale pre-personalization receipts.
- Focused migration regression cases cover activated-pool integrity and personalized Studio attempt provenance. The changed migration scripts passed source syntax checks; no broad release/deployment suite was started.


## School Administration and People & Access integration — November 12, 2026

- Reconciled the focused School Administration and People & Access improvements from PR #166 into the full V4 foundation rather than replacing its broader School Administration, school operations, private resources, advanced readiness or role-aware navigation with older mainline UI.
- The verified-school administration dashboard now hides metrics and school-only controls until the **selected** school has an active `school_admin` membership. Switching schools immediately clears the previous totals and invalidates in-flight responses.
- School-specific directory and support totals are fetched using server-scoped `peopleDirectory` and `schoolSupport` callables. Independently unavailable services leave their values unknown rather than displaying misleading historical/global counts.
- The legacy flat `students`, `staff_access`, and `issues` collections remain accessible **only** in the explicitly admitted legacy MCS administrator compatibility view. This is not a V4 school-directory fallback and must retire with legacy compatibility.
- People & Access gains school-scoped student/staff audience shortcuts, clearable filters, direct eligible-person invitation handoff, role-prefilled invitation entry, stale search/invite response suppression, and compact mobile controls. Original server-side invitation, person, membership and class lifecycle services are reused unchanged.
- Legacy roster and teacher configuration pages deep-link into the canonical V4 directory without changing the historical roster, grades, assessments, account memberships or teacher-course grants.
- The full V4 navigation's existing compact **Assess & grade / Teaching / Insights / School administration** hierarchy is retained instead of copying an older alternative grouping.
- This integration is source-only and is **not** a production deployment, MCS data migration, administrator role grant, V4 pilot activation or release. Class Record and CheerpJ terminal development remain outside this workstream.

**Still pending:** integrate this isolated change into the V4 development branch; reconcile the larger V4 branch with current mainline maintenance without overwriting newer independent features; complete protected MCS migration preparation, focused cross-school authorization checks and controlled pilot activation.


## Mainline routing and home continuity reconciliation — November 12, 2026

- Reconciled current mainline verified-school guard and session-destination route additions: `school-grading-schemes.html`, `school-student-grades.html`, and `class-record.html`. These routes retain server-verified school-role access checks; student grades require school-student membership, and Class Record requires school-teacher membership. This does not migrate or modify those modules.
- Retained the full V4 scoped authorization model and role-specific legacy fences instead of replacing it with mainline's simpler legacy guard.
- Added compatible `My Grades` and `Class Record` labels for resumable recent-workspace hints without introducing a new top-level navigation group or linking to pages not yet reconciled into this branch.
- Carried mainline's deferred home pulse scheduling into V4 without losing canonical school Practice/assessment summaries. V4-only accounts use verified-school callables even while MCS remains `legacy_allowed`; they do **not** fall back to legacy global evidence or Practice collections.
- Changed-school events now invalidate old home pulse requests, hide the prior snapshot and reload from the newly verified school; no school ID is trusted from browser state.
- No Class Record, CheerpJ, assessment rubric, grade, evidence or production Firebase code changed. No deployment or pilot activation.
- Still pending: incorporation of the newer independent mainline Class Record and CheerpJ artifacts at a controlled reconciliation boundary, further shared LMS/Firebase compatibility review, and protected MCS pilot activation.


### Primary-guard parity follow-up — November 12, 2026

The foundation uses both `auth-guard-v4-pilot.js` and the canonical `auth-guard.js`. Both now consistently recognize the controlled pilot, grading-scheme, teacher Class Record and student grade routes. The **primary guard** retains its established `staff-session.mjs` and `session-destination.mjs` imports and legacy-compatible home routing; it is not replaced wholesale by the pilot guard. It also retains the separately verified school-teacher and school-student visibility conditions. Canonical recent-workspace routing treats Class Record as school-teacher only and school grades as a student route. No underlying grading module or database permission rule was changed.


## Firebase assessment-service parity and Studio assessment context — November 12, 2026

### Verified shared service contract (main vs V4)
- **Byte-identical at this review boundary:** `firestore.rules`, `functions/studio-assessment-variants.js`, `functions/school-gradebook.js`, `functions/school-studio-projects.js`, `functions/people-directory.js`, `functions/school-academics.js`, and the client-side external evaluation/personalization services. These files require no duplicate merge edits.
- **Intentional V4 extensions — do not overwrite from main:** `functions/school-assessments.js` adds private teacher-owned personalized pools, freezes assigned variants, and separates deployment from publication; `functions/school-studio-submissions.js` binds immutable submissions to the server-issued attempt/variant; `functions/school-github-evidence.js` enforces unpublished-assessment visibility; `functions/teacher-blueprints.js` retains private personalized blueprint infrastructure.
- **Function registry conflict:** mainline `functions/index.js` exports `schoolClassRecord` and `schoolStudentClassRecord`, backed by two Class Record modules absent from V4. V4 instead already exports `schoolStudioAssessmentVariant`. The later mainline reconciliation must preserve **all three** exports and bring forward the **unchanged current** Class Record modules. Neither mainline registry nor V4 registry can simply replace the other. No Class Record modules or exports were changed in this assessment batch.

### Focused compatibility implementation
- `js/student/studio-assessment-variant.mjs` now re-emits the newer mainline Studio assessment lifecycle context (`loading`, `not-personalized`, `ready`, `unavailable`) for both the canonical verified-school variant and existing legacy fallback.
- The active variant remains the server-issued frozen variant; canonical school lookup occurs first and retains the existing school-scoped callable. Non-personalized tasks are identified explicitly instead of leaving an indefinite loading state.
- Sign-out, late requests and failed lookups do not leave an old personalized variant marked as ready. Assignment-context state is a **client UI hint only**, never an authorization grant or server submission bypass.
- Studio page script cache is updated so the reconciled client loads without altering CheerpJ or the terminal integration.

**Status:** isolated source integration only. No role changes, production Firebase deployment, assessment publication, grading mutation, live migration, or `v4_only` switch. Remaining gate: combine current-main Class Record endpoints and newest backend maintenance into V4 without replacing the canonical personalized pipeline; then focused signed-in acceptance and controlled MCS pilot activation.
