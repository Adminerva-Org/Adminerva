# Adminerva 4.0 — Manila Cathedral School legacy default, migration and compatibility runbook

**Status:** design only; no production data move, live settings edit or account authorization changes. This plan deliberately prioritizes continuity of the existing MCS pilot records.

## A. Non-negotiable product behavior

1. The single authorized pilot school is **Manila Cathedral School**, proposed immutable school key `mcs-manila`. Existing staff and learners retain the familiar launch experience; the school picker is hidden when a principal has one verified active membership.
2. Existing records already known to be MCS-owned should be provisionally **linked to MCS** and ultimately copied to tenant-aware paths with exact evidence/grade/revision identity. This does *not* grant all registered Firebase users access to MCS.
3. **No global wildcard fallback.** An unrecognized record, UID, email, section name, uploaded file or URL never implicitly acquires MCS authority. Only a server-signed legacy mapping manifest may assert a record's target school. A student's possession of an email in the same domain is not proof of membership.
4. The old namespace is immutable after MCS cutover; until then it remains the sole write authority. No dual writes for grades, evidence versions, AI feedback or student project snapshots.
5. A second school must begin with **zero migrated MCS records** and must not have permission to enumerate, read or update old flat collections.
6. Never remove the original legacy source until the school has passed reconciliation, backup retention, access audit and post-rollout acceptance; no automatic cleanup in 4.0.

## B. Compatibility model: old paths → MCS-owned tenant paths

A **server-maintained** `legacy_record_links` ledger is the only way to interpret pre-v4 legacy records. A record's absence of `schoolId` indicates “unmigrated/unknown,” not “grant MCS by default.” The explicit pilot compatibility rule is:

- **MCS-scoped legacy records with verified manifest mapping** → read from old location in the *temporary compatibility stage*, or from new location after record-family cutover.
- **Unrecognized records** → quarantine for attribution; no default public/teacher/admin school access.
- **New records written on the V4 platform** → directly tenant-scoped paths, with authenticated membership/authorization.
- **Legacy records already migrated** → new paths only; no “missing new record? query all legacy” automatic fallback.
- **Unknown cross-school references** → block the operation with an actionable migration status rather than attach to MCS.

Example mapping:
| Legacy | Pilot target | Notes |
| --- | --- | --- |
| `students/{studentId}` | `schools/mcs-manila/students/{studentId}` | Preserve studentId, email, historical section and relation to UID; add stable enrollment offering IDs |
| `staff_access/{email}` | `schools/mcs-manila/memberships/{uid}` and `staff_assignments` | Need verified Firebase UID; preserve old grants as migration audit, do not blindly copy privilege |
| `teachers/{id}` | `schools/mcs-manila/teachers/{id}` | Save teacher identity and private integration-key classification |
| `school_catalog/{kind}/records/{record}` | `schools/mcs-manila/{kind}/{id}` | Map name/year to stable IDs; avoid conflating names across terms |
| `assessments/{id}` & `assessment_private/{id}` | `schools/mcs-manila/assessments/{id}` + private config | Keep V2 and V3 submissionSource, dates/rubrics, deploy origins |
| `assessment_evidence/{id}/revisions/{rev}` | `schools/mcs-manila/assessment_evidence/{id}/revisions/{rev}` | Immutable SHA/checkpoint and approval history |
| `studio_submissions/{id}/versions/{rev}` | `schools/mcs-manila/studio_submissions/{id}/versions/{rev}` | Immutable snapshotJson/hash, revision and teacher review status |
| `student_grades/{id}` and `grade_revisions/{id}` | `schools/mcs-manila/student_grades/{id}` and revisions | Never recalculate or republish an old grade |
| `commit_reclaims/{id}` + conflicts/decisions | `schools/mcs-manila/commit_reclaims/{id}` + relations | Reclaim collision key must include school and repo; retain original decision |
| `student_code_projects/{uid}/projects/{projectId}` | `schools/mcs-manila/student_code_projects/{uid}/projects/{projectId}` | Only school-bound projects; personal scratch work may stay outside school |
| `student_playground_workspaces`, `playground_snapshots` | `schools/mcs-manila/...` | Preserve original revision, owner, language and links |
| `staff_workspaces`, `teacher_materials`, `reference_folders` | `schools/mcs-manila/...` | Distinguish a teacher's personal drafts from school-shared resources |
| `student_practice_progress`, `practice_*` | `schools/mcs-manila/...` | Separate school rankings; keep global curriculum templates if public |
| `activity_preferences`, `activity_events`, `analytics_*` | `schools/mcs-manila/...` | Opt-in and retention must carry over exactly; no silent consent changes |
| `issues`, `notifications`, `push_devices`, `notification_history` | school-owned streams / UID-wide envelope | Global device token remains user-bound; per-item schoolId and verified routing |
| `school_ai_results`, `school_ai_usage`, `system_private/school_ai` | school-private AI namespace/secret store | Never copy secrets to frontend/client-readable school docs |
| `app_config`, `global_settings`, `monitoring_control` | split platform settings vs school-scoped settings | Classify each setting; platform-global records do not become MCS by default |

The destination collection names are a **proposed contract**; update the code inventory/actual SDK helper callers before implementing. **Do not claim the table reflects existing migrated content.**

## C. Audit coverage — every legacy data family

Migration inventory must record:
- Root collection, subcollection paths, schema variants, count, oldest/newest updatedAt, owner/author, referenced school context, permissions, private field classification, storage references, dependencies, and current Cloud Function triggers.
- Top-level nested revision records, immutable Studio version docs, evidence historical selection/approval/reopen/resubmit state, grade revisions and publication audits, legacy group/team submissions, unresolved reclaim conflicts.
- Source records with email-to-UID identity links, duplicate student email matches, former employees, disabled/suspended students, archived sections/terms, orphan grades or assessments, unknown teacher/section or repo identities.
- Off-Firestore assets: browser-local drafts/ZIPs, browser caches, Firebase Storage objects (if any), PDF/Docs exports, third-party repository URLs, AI provider keys/quotas, push device tokens and service-worker caches.
- Data already server-generated: access summaries, school AI usage, practice scores, notifications and analytics; distinguish authoritative records from rebuildable derived caches.

**Read-only discovery** against production; never perform a “trial migration” using write operations to real student grade records. Generate separate `unknown` and `needs-verification` buckets and an immutable inventory version.

### Manifest and audit contract (illustrative)
`migration_runs/{runId}` is restricted to server owner:
- `targetSchoolId: "mcs-manila"`, `dryRun: true`, `sourceVersion`, `schemaVersion`, `phase`, `startedByUid`, `startedAt`, `collectionTotals`, `exceptions`, `approvedByUid`, `cutoverEpoch`.
- `entries/{entryId}`: `legacyPath`, `targetPath`, `legacyUpdateTime`, `sourceChecksum`, `targetChecksum`, `migrationStatus` (pending/copied/verified/conflict/skipped), `dependencyPaths`, `lastError`, `attemptCount`.
- Checksum canonicalization excludes non-deterministic export serialization artifacts; includes all semantically relevant document fields. For student snapshots retain the original established digest and original JSON exactly.
- A migration run is append-only/audited; replaying it with the same run ID must produce the same destination identity and never generate another grade, assessment revision, notification or submission receipt.
- Any changed legacy source between inventory and cutover invalidates its stale copy and requires re-evaluation.
- “Skipped” is allowed only for an explicitly reviewed class of records (for example platform-global configuration), not a silent missing grade.

## D. Detailed transition stages and rollback

### Stage 0 — Freeze assumptions, not school operations
- Establish school pilot ID and legitimate MCS administrative access; document the current production Firebase project and backup owner.
- Write down authoritative collections / trigger inventory, backups, required Firestore composite indexes and storage security constraints.
- Confirm there are no other institutions' records intermingled in legacy data. If uncertain, quarantine and verify individual ownership; the pilot cannot swallow everything.
- No UI changes yet; normal 3.0 functionality remains active.

### Stage 1 — V4 architecture without data movement
- Deploy server-verifiable platform school registry, school memberships, roles/assignments and isolated tenant paths, all **disabled for normal feature traffic** behind a backend-controlled flag.
- Firebase Functions must revalidate school membership, school state and target resource for each privileged request; Admin SDK bypasses Firestore rules.
- Add a separate deny-by-default Rules namespace for `schools/{schoolId}` and scoped Storage paths. Every allowed nested subcollection path gets explicit rules. Audit existing overlapping/broad wildcard rules before adding tenant matches.
- Add tenant context to domain services and interfaces with built-in refusal for missing school authority. Do not merely prefix arbitrary strings from URL with `schoolId`.

### Stage 2 — Authoritative owner mapping
- The MCS administrator receives the verified school-admin membership invitation. Existing teachers and students are matched by stable verified identity + school records + approved ledger.
- Legacy hard-coded admin/teacher bootstrap identities remain under a **temporary restricted migration recovery bridge** only until their new grants are verified. Never let those fallbacks open other schools.
- The website resolves verified membership on login. If exactly one school is active, auto-enter it and hide school selector; no interruption for most pilot users.
- Users with unknown records see a “School access needs confirmation” recovery screen, not an automatic MCS membership grant.

### Stage 3 — Dependency-safe data copy
- Dry-run and approve mapping; copy source → destination with same IDs and immutable field values in dependencies-first order: school/catalog → membership/people → course/roster → assessments/tasks → evidence and submission versions → reviews/grades/revisions → student projects/lesson resources → notifications/analytics/caches.
- **Cross-references:** change old `studentId`, `assessmentId` and `gradeId` references to an unambiguous school-scoped reference only if verified. Retain a read-only `legacyRef` for historical lineage.
- Preserve old grade field values including unpublished vs published, deadline state, rubric maximum and version/hash exactly. No automatic recalculation or trigger-based creation of new notifications/grades from migrated docs. Suppress/de-duplicate side effects for migration writes, including onCreate trigger events.
- Stop source mutations briefly only when every data family and trigger is compatible, then reconcile deltas and atomically activate the V4 data routing generation per school.
- Where the graph cannot be copied consistently (missing original grade or version), do not publish “migration complete.” Keep that feature on the old path with access restricted until resolved.

### Stage 4 — Pilot activation / smoke verification
- Use three controlled and authorized role accounts plus an empty synthetic second tenant:
  - MCS student → assignment → Studio project → submit immutable version → teacher review → draft grade → publish → student published view.
  - Existing GitHub/V2 evidence → original selected commit SHA → reopened/resubmitted evidence → approval → grade publication and audit.
  - MCS school admin → staff assignment/admission/catalog with reason/audit; teacher outside assigned section denied.
  - A student and teacher from synthetic School B cannot list or read MCS student records, version snapshots, files, grades, class rankings or lesson library.
  - Authorized multi-school test identity can switch without bringing prior school live listeners, browser caches or pending writes.
- Reconcile exact historical counts, selected critical IDs and hashes against saved ledger. Profile UI must show legitimate historical work rather than empty “new school” panels.
- Confirm push alerts do not accidentally fire on migration; each created grade remains at its old publication state.

### Stage 5 — Controlled rollback and retirement
- If post-cutover failure occurs, put MCS in read-only maintenance mode and recover using the last valid **single source of truth**. Never re-enable legacy writes while new-path writes exist without a documented reconciliation/rollback procedure.
- Preserve snapshots and audit trails in both locations. Restore only reviewed records and do not overwrite grades/new submissions created since the backup.
- Legacy reads are retired only after successful tenant path operation for an agreed stabilization period; old flat paths are denied to new schools at all times. Destructive archive/cleanup is a later approved change.

## E. Access resolution and hidden school selector

The school picker is **presentation**, never authentication. Membership data is read from a server-managed registry, optionally cached as a display hint but revalidated on every protected operation.

| Membership state | Landing and selector |
| --- | --- |
| Anonymous / unsigned-in | Public guest flow, no school selection |
| Signed-in with no active schools | Guest workspace + invitation/access request; no private MCS data |
| One active school, one role | Go directly to school landing; no switcher or extra onboarding gate |
| One active school, multiple roles | No school switcher; offer context-appropriate role/workspace choice **only if** role switching is legitimate and authorized |
| Two or more active schools | Compact school name in top account/navigation menu; mobile switcher in account sheet, not persistent toolbar |
| Two schools and multiple roles | First choose active school, then only roles granted for that school; never combine roles across schools |
| Membership disabled/removed while page open | Cancel listeners, deny pending writes, clear previous scoped view and show choose eligible school or retry |
| Only one remains after revocation | Auto-enter it on next verified route, hide selector |
| Temporarily offline | If cached scope exists, show previously permitted non-sensitive drafts as offline only; do not assert live membership or submit/grade; no automatic switch to MCS |
| Platform administrator has no school membership | Owner Console lists and provisions tenants; no implicit read/write access to MCS gradebook |
| Platform administrator holds one school role | School selector hidden for one authorized school; Owner Console remains a distinct global destination |
| School admin of two schools | Selector appears; each institution has separate settings and dashboards |

### Resolver algorithm (logical pseudocode, not production code)

1. Require verified Firebase Auth identity for private school use.
2. Read **server-managed** active school memberships and school status. Do not trust localStorage, an old cached `Adminerva_Role`, email domain or `?school=`.
3. Filter memberships where both user grant and school are active. Separate pending/disabled/invited schools from authorized choices.
4. If zero: show guest/access recovery. If one: make it current automatically with no visible selector. If >1: attempt to reuse the last *still-authorized* selection, otherwise require a choice before private queries.
5. Resolve effective roles **for selected school**, course/section/subject grants, currently allowed operations and capabilities. Set a scope version/epoch.
6. Start only school-local listeners, queries, files, views and notifications. Every mutation sends the explicit school context and server checks both membership and resource IDs again.
7. When switching: prevent new old-school actions, settle or cancel pending operations, discard unread private in-memory state, unsubscribe, clear school-sensitive caches, update verified context and redraw. If a draft cannot be safely synced, explain and offer local scoped recovery instead of losing it.
8. After grants change or token refreshed, re-evaluate membership and school status. A stale role cache can never restore revoked access.

**Do not insert “school = mcs-manila” inside an allow rule for unauthenticated or unknown actors.** The default applies only to verified records in the migration process and to selecting the **one existing authorized school**, not to authorization.

## F. Avoid current-source failure modes

- Current `resolveAccountAccess` queries global `teachers` and `students` by email. Replace with index → school membership → one-school roster lookup. Same email may link to multiple school records legitimately.
- Current `staffRole` and Firebase Functions still use bootstrap administrator and original teacher email exceptions. Retire only after verified new grants; constrain fallback to MCS during cutover and remove after stabilization.
- Current client code displays `superadmin` where server rules use `admin`. Replace with an explicit five-role capability mapping; never let school admin equal platform owner.
- Current `student_code_projects` stores by UID and `localStorage` saves some projects by UID alone. When project is school-bound, add schoolId to cloud and browser keys. Do not accidentally reassign personal local experiments.
- Current grade and evidence write transactions assume global assessment/student IDs; validate school match and new immutable relation keys at both read and write time.
- `functions/index.js` triggers, practice/monitoring services and school AI service use flat path literals or global singleton settings. They must all become tenant-aware, including migration-event suppression and idempotency. A school parameter in a function request cannot be trusted without verifying membership.
- Current `firestore.rules` includes a broad top-level `match /{collection}/{document}` administrator rule. Before enabling any school namespace audit all overlapping match conditions: a restrictive rule does not override another permissive overlapping match.
- Public PWA/offline state can retain a previous user's code. Version and partition data caches by UID + verified school + workspace; logout and account switching invalidate sensitive session state.

## G. Acceptance checklist

- Existing MCS pilot accounts land on the same familiar student/teacher workspaces with **no school selector** and with all legitimate past academic records available.
- No legacy flat record without a verified MCS ledger entry is silently accessible, and School B never receives one.
- Revisions, grade states, evidence counts, rubrics, student identity and teacher attribution reconcile; no synthetic grade publication, notification storm or lost project.
- Explicitly tested cross-school attacks: forged path, guessed IDs, old URL, stale role, cached enrollment, malicious callable request, Storage path, signed export link and server job.
- School suspension, role revocation, teacher reassignment, switching offline and partial migration fail closed without wiping historical records.
- School-wide and platform-wide controls are visibly separate and server scoped.
- Pilot dry-run, final cutover and recovery logs remain reproducible for provisioning later schools.

**Official guidance to consult during implementation:** Firebase Rules matching and overlapping allow expressions (https://firebase.google.com/docs/rules/rules-behavior), Firestore rules/query constraints (https://firebase.google.com/docs/firestore/security/rules-query), and managed export/import limitations (https://firebase.google.com/docs/firestore/manage-data/export-import). Managed export is not guaranteed to be a single point-in-time snapshot of an actively written database.
