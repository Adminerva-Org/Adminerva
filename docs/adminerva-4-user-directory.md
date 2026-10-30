# Adminerva 4.0 — Unified school User Directory, identities, enrollment and access

**Planning specification only. No production roster has been modified.** Replace the current separated student roster, teacher accounts and guest admission panels with one role-aware **People & Access** workspace. Keep familiar deep links as redirects/tabs. Use the school-aware authorization foundation and MCS verified legacy migration.

## Findings from current implementation

- `users.html` largely lists students, supports CSV and a configured Google Sheet roster, filters by section/GitHub status and includes guest admissions in a lower panel; teacher assignments live on `teacher-accounts.html`. Separate pages create duplicated account/roster concepts.
- `js/settings/settings-user.js` reads the entire flat `students` collection for roster/list/filter, imports up to 500 via CSV, currently generates composite roster identity from email+section+schoolYear, and contains a bulk "Suspend All Student Access" and browser-side "View As" workflow. This is not an appropriate authorization model for multi-school, multi-role users.
- `js/core/admission-service.mjs` matches student records by email and writes global account requests/staff access; `teacher-accounts.mjs` stores section/subject strings, with optional subject focus not a server-side subject authorization.
- Existing email, student roster record, Firebase Auth UID and teacher role are not the same entity. The upgrade must avoid duplicating a person just because they enroll in a second section or use a second school.

## One identity, many school relationships

**Separate these concepts in storage and UI:**

1. **Authentication identity**: Firebase Auth UID, verified email and provider state (global to the platform). The same UID can have different active roles at multiple schools.
2. **School membership**: server-managed link `schoolId + uid`, status (invited / pending / active / suspended / revoked), role set, actor/reason/time/revision. This governs entering the school.
3. **Person record**: one per individual *inside that school*, `personId`, display name, contact methods, legal/preferred name where policy allows, student/staff identifiers, verified accountLink status. Do not assume one email = one person or email always present.
4. **Student enrollment(s)**: academic year, term, program, grade, section/course-offering IDs, status (prospective / enrolled / transferred / completed / withdrawn / archived) and reason history. A person may have multiple historical enrollments; historical grades remain attached to their original enrollment.
5. **Staff appointment and teaching assignments**: active school membership, school role, course/subject/section/year/term grants, start/end, status, academic team delegation.
6. **Account invitation/admission**: access request separate from roster record. A roster entry can exist before first sign-in, and a signed-in teacher can lack any school membership.
7. **Teacher-owned resources and shared grants**: do NOT store private resource data in directory. Directory recipient picker returns only active same-school teacher identities; real ACL checks live in resource security service.

### Suggested storage contracts

- `platform_users/{uid}` contains global identity pointer and only required platform metadata. Users cannot edit their own role/school grants.
- `platform_users/{uid}/memberships/{schoolId}` is a **derived membership index**, not the sole authority for permission.
- `schools/{schoolId}/people/{personId}` stores school-owned directory person info, not a global directory.
- `schools/{schoolId}/memberships/{uid}` contains verified school-local role grants.
- `schools/{schoolId}/students/{studentId}`, `enrollments/{id}`, `staff_assignments/{id}`, `course_offerings/{id}` and `invitations/{id}` store separate relationship concepts.
- `schools/{schoolId}/directory_audit/{eventId}` and `import_jobs/{jobId}/rows/{rowId}` for audited non-destructive changes and import recovery.

Use stable IDs, school+record foreign-key validation, server-verified links, revision checks and school admin action auditing. Never expose global `platform_users` lists to school admins. Personal contact info and sensitive identifiers must be field-scoped; directory lists should use minimal allowed summaries.

## School Directory information architecture

Replace the three disconnected screens with **School Admin → People & Access**, selected current school context, tabs:

| Tab / page | Listing and actions | Who may access |
| --- | --- | --- |
| **Overview** | Counts: active students, unlinked roster records, active teachers, pending invitations, access issues, recent audited changes | School admin; limited view for delegated registrar |
| **People** | Search school-scoped profiles, sort by name/role/status, person detail drawer, no global identity list | School admin / designated authorized staff |
| **Students** | Enrollments and school-year/term filters; move section, view class link, invite/disable, history; no unrelated grade editing | School admin and delegated registrar; teachers see only their assigned-class roster in a separate teaching view |
| **Teachers & Staff** | Add/invite staff, verify identity, assign course/subject/section grants, role status, view owned resources count (not contents), handover | School admin / authorized staff manager |
| **Access Requests** | Pending invitation, student roster match, teacher approval and denials, with reason and audit | School admin / authorized admissions officer |
| **Classes & Assignments** | Year > term > course offering > section; class roster and teacher responsibilities, warning on conflicts | School admin / designated academic lead |
| **Imports & Exports** | CSV and school-configured Google Sheet, validation preview, conflicts, dry-run, results, recovery journal, school-only exports | Privileged school admin / registrar |
| **Audit & Recovery** | Suspend/reactivate, link conflict, history, role and teacher owner transfer, history search, restore | School admin with separately privileged recovery permission |

The student-facing "My Account" stays separate from the school staff directory. Owner Console "Schools" stays separate from all of these; it may show aggregate counts but not all student names and grades.

## Main directory list and person detail

**List columns (desktop):** Name (preferred display), person ID, current role(s), school status, class/course/year, account linkage state (invited/not linked/verified), last relevant change, actions. Do not show a personal email or student number when the staff role does not need it. Never display a direct GitHub token, AI API key or sensitive administrative secret.

**Person detail tabs:** Profile | School Roles | Enrollment/Assignments | Access & Invitations | Activity History (metadata only) | Teacher-owned Work (counts and delegated recovery workflow; not automatically open drafts). Student academic grades/feedback remain in protected Gradebook, not exposed to anyone who can browse People.

**Distinct statuses in UI:** school membership active/disabled; person status; student enrollment enrolled/withdrawn/archived; provider sign-in link pending/verified; GitHub integration linked/unlinked. Do not conflate "Missing GitHub Setup" with "No School Access" or "Suspended Enrollment".

**Search and filters:** server-paginated queries (not downloading every school student); role, school status, enrollment state, grade, section, course, academic year and account linkage. Search no larger than a verified current school and staff scope. Display results and summary when filters change. Never show MCS results during a school-switch loading state.

## Workflows

### D1 — Add/invite student

School admin selects Students → Add student → enter school-specific person/enrollment information → choose academic year, term, class/offering → validate duplicate school record and historical enrollment. Create roster person first if no login account. Invite verified identity by email or invite code, with expiry. Once verified, link Firebase UID via audited membership approval. **Do not assume any signed-in account with an MCS-looking email is MCS authorized.**

### D2 — Student changes section / changes year

Open student → Enrollments → Move to section or start new-year enrollment → show impact preview of current assignments, available classes, deadlines and grade history. Write an audited enrollment version and keep prior term's grades attached to original section/offering. Existing old grades never silently move to a new teacher or school.

### D3 — Add teacher and teaching grants

School admin selects Teachers & Staff → Invite teacher → verify identity and staff role → assign subjects + sections **as course offerings for school year/term**, not independent free-text lists. "Teacher Resource Sharing" remains private by default even when two teachers are assigned to the same class. Access revocation warns about active deployed assessments, student grading handoff and owned personal work.

### D4 — Existing person with two roles or schools

Same UID might be student in School B and teacher in MCS. Platform identity stays one account; each school maintains local person/membership and enrollment/appointment records. When only one school membership is active, hide selector. A different school membership does not imply data visibility to the current school admin.

### D5 — Join / approve admission

User with no school membership has an invitation code or a school-specific invitation link. Show institution name for confirmation only, not a permanent school selector or public browse-all-schools roster. School admin reviews pending identity links and roster matches; the request cannot create active membership without admin/server approval. Reject/expire reasons preserve audit.

### D6 — Import roster from CSV / Google Sheet

School admin opens Imports → Upload source (school-specific, never platform-global hardcoded sheet) → parse securely → **preview** adds, updates, skips and conflicts → validate identifiers, duplicates, program/section/year and account links → confirm audited idempotent job → progress with counts/errors → optional safe undo of **only newly created untouched records**. Imports may not blindly reset active role, section, enrollment history, published grades or consent settings.

Accept UTF-8 CSV with standard quoted commas/newlines; configurable column mapping; max row and file bytes with clear messages; sanitize spreadsheet-formula injection on export. Prefer immutable school ID + person/roster ID for match; email alone may be duplicated or change. Do not perform client-side full-school roster download for diffing. A school-specific connector for Google Sheets may require separate authorized configuration and must respect privacy.

### D7 — Suspend/reactivate vs delete

Bulk operations first show exact affected records and what access they will lose. **Do not make "Suspend All" a casual page action.** Use two-step privileged confirmation, reason, batch count, reauth where supported, audit and a preview/export checkpoint. Suspended memberships lose school access, but person/enrollment/grades/evidence history stay intact. Restore must not revive expired teacher grants without review.

### D8 — Teacher departure, orphaned work and safe handover

When suspending teacher, show "Owned assessments", "Deployed student tasks", "Pending grades", "Shared materials", "Private drafts" **counts only**. Delegate active academic work to an authorized successor without changing creator attribution; separately handle private content transfer/archival through audited recovery. A user cannot delete a teacher account to erase students' submitted work.

### D9 — Classroom teacher needs recipient list

Teachers can view a minimal staff picker of **active teachers within the selected school** for deliberate resource sharing; cannot list the entire school student directory unless class assignment authorizes a roster view. No school-wide email scrape; searchable minimum fields, rate limited, no cross-school leakage.

## Mobile-first UI/UX (320 px minimum)

- One **People & Access** school-admin landing, compact summary chips, search field and scrollable role tabs. Not three separate large vertically stacked imports/directories/requests.
- List as tappable full-width cards at 320–599px: name, role/status, current class and "More" action; no clipped multi-column table. For 600px+ show responsive rows, with role and year filters, sticky column labels on wide screens.
- Person detail opens accessible full-screen sheet on mobile or side-panel on desktop; fixed close at top, scrollable interior, sticky Save/Cancel region respecting safe areas and keyboard. Never stack two modals or require scroll to the very bottom to close.
- Import wizard on mobile: **Select source → Column mapping → Validate & preview → Confirm → Results**. Show progress after upload, cancellation where safe and explicit "no changes made" on failure. Do not place CSV import ahead of day-to-day directory browsing.
- Teacher assignment editor uses grouped checkable subjects/course offerings, collapsible by academic year/section. Inline searchable teacher picker for sharing, but only in the specific resource-share sheet.
- Active school dropdown absent with one active membership. A multi-school school admin can switch from account drawer after resolving unsaved form edits.
- All action buttons: 44px touch target where practical, accessible labels/keyboard/focus, high contrast, proper async loaders and no duplicated processing.

## Privacy, security and audit

- Explicit permissions by current school, office delegation, section/course/subject and resource. School admin cannot see another school's people; teachers see their assigned students, not complete directory. Platform owner has operational school stats but no blanket person-level access.
- Invite links are expiring, single use/atomic, school-bound and never auto-convert a user to admin by domain.
- Personally identifying fields such as addresses/contacts and sensitive categories are never part of unrestricted directory exports. Record purpose, recipient, actor, school, timestamp for privileged exports.
- Role/section/course changes, student suspension, invitations, import and handover all require recorded actor and change reason; use optimistic concurrency to prevent overwriting another admin.
- A person removed from a school cannot use cached UI and old device tokens to access private data. Membership revocation must close subscriptions and invalidate future server operations.

## Pilot legacy migration

- MCS verified roster records map to school persons + enrollment history without changing original historical student ID used by evidence/Gradebook. Multiple existing `students` records can represent one school person enrolled in different classes/years; review identity collisions instead of merging by email alone.
- Existing teacher `staff_access` maps to verified MCS memberships and explicit teaching grants, preserving original role/assignment audit.
- Existing global account requests move to school context only after school proven; unmapped requests remain pending platform-level recovery queue, not auto-approved.
- Legacy CSV/Google Sheet source remains usable through authorized, configured import after new directory migration; **never** silently overwrite school data on initial load.
- Existing teacher/student deep links redirect into selected authorized school; historical person IDs remain searchable via an explicit legacy mapping ledger.

## Critical acceptance and what-ifs

| Scenario | Required result |
| --- | --- |
| Existing student has 2 historical enrollments | One school person, distinct term/section enrollments, prior grades intact |
| Two people share the same email | Block automatic merge and require identity resolution |
| Same UID teacher in MCS, student in School B | Both membership contexts work, no accidental shared profile/permissions |
| School admin imports wrong-school roster | Preview shows wrong destination, dry-run/cancel before writes; server never changes other school's records |
| Imported CSV repeats or partially fails | Idempotent retry and row-level audit, no duplicate person or grade edits |
| Teacher is disabled during grading | Access denied; active task assigned via controlled successor, grade/evidence safe |
| Administrator changes section after grade published | Historical grade stays with original term/section; no orphan |
| Guest sends school invitation link to other person | Single-use verified identity/approval required |
| Teacher searches staff for sharing | Only same-school active teachers; no students or other-school faculty |
| School admin tries global user directory | Denied; only current school people |
| Platform admin tries browse all student details | Denied without separately audited support |
| Mobile 320px user edits profile or enrollment | No clipping, duplicate save, hidden close or lost unsaved changes |
| Suspended account still has stale cached roster | Server denies; client drops private cache and shows access recovery |
| Bulk suspend accidentally selected entire school | Explicit scope count and protected confirmation; no quick irreversible operation |

**Dependencies:** #104 tenant/roles, #105 verified MCS migration, #107 school admin, #108 mobile-first UX and teacher sharing policy.
