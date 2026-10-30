# Adminerva 4.0 — role- and school-aware UX, mobile-first screens and workflow contracts

Status: design and interaction specification, not implemented. Build on shared Adminerva CSS/navigation, verified auth guard, common loader, existing Studio/Gradebook, not duplicate workflows.

## Design principles (priority order)

1. **One-school simplicity:** school UI appears only if it is necessary. When exactly one verified active school exists, hide all school-selection affordances. Allow a quiet accessible school label in the School Admin information page, not a redundant top-bar dropdown. School configuration remains visible to the one school's admin.
2. **Task first, jargon second:** "My Assignments" → "Open Studio" → "Submit" → "Teacher Reviews" → "Published Grade". Never require students to understand schools, databases, snapshot SHA or evidence identities just to complete a task.
3. **Every role has a separate home and minimal relevant navigation.** School admin is school management, not developer administration. Platform owner gets a separate console. Teacher dashboard opens teaching tasks; student dashboard opens learning tasks; guest sees only public practice.
4. **Mobile-first** with usable 320 px viewport, 44 × 44 CSS px minimum touch targets when practical, visible focus, keyboard support, no hover-only critical controls, legible text, and reduced-motion support. Start CSS at narrow screens and progressively enhance.
5. **Explicit status everywhere:** Pending, processing, saved, unsaved, offline, failed, needs review, published, archived; every asynchronous action has one visible loader, disabled duplicate-action control, a clear result and a safe retry.
6. **Never claim user scope based on the selector**; only verified server membership enables data and actions. Sensitive data never paints before school/role admission.
7. **Continuity:** keep current navigation routes where compatible, preserve project URLs and historical work, and map legacy deep links into the authorized MCS context without redirect loops.
8. **Privacy in shared devices:** minimize sensitive cached data, clear role/school views and notifications on switch/signout, and avoid showing previous school's counts after context changes.

## Role entrypoints and first tasks

| Persona | Landing emphasis | Primary actions | Secondary actions |
| --- | --- | --- | --- |
| Guest | Explore Adminerva without login | Try Studio demo; Practice; read Wiki; request school access | Learn how school accounts work |
| Student | Assignments due / current class | Resume a project; open/submit assessment; check feedback/published grades | Practice courses; XML Lab; profile; progress |
| Teacher | Classes taught and work needing review | Create/deploy assessment; review Studio/V2 evidence; grade; publish | Lesson plans; slide editor; class projects; class analytics |
| School admin | One school's operational status | Admissions; teachers/sections/subjects/offerings; school reports | School files; policies; school AI quotas; audit; help |
| Platform administrator | Tenant fleet overview | Provision school; configure activation/status; invite school admins; inspect health | Usage, feature flags, incident/recovery audit |

### Two-school teaching example

Teacher account has memberships in MCS and School B. On login:
- use last selected *still-authorized* school if available;
- otherwise show a simple, accessible two-card school selection sheet **before** any school-private request;
- show selected school on compact menu button: `MCS · Teacher ▾`;
- choose School B → prompt if there are unsaved/pending changes → cancel school-local listeners → verify School B role/grants → navigate to School B teacher home → show **only School B** classes and inbox;
- if the account later has only MCS, route there automatically and hide the selector.

### School admin multi-school example

An administrator assigned to MCS and School B sees the switcher; each school's settings, staff, permissions, activity and reports remain separate. The administrator **cannot create School C** unless a platform-owner grant separately exists. School creation lives in Platform Console, not School Administration.

### Platform owner example

Owner Console always has a **School Directory** for provisioning/operations. That directory is not the same thing as a school switcher. If the owner is not also a verified MCS member, the owner does **not** get a teacher/student dashboard merely by clicking a school card. School impersonation/support access is separately authorized, read-only by default, reasoned and audited.

## Navigation and school switcher visibility state machine

State source is one resolved `AccountScope` object:
`{ uid, memberships: [{ schoolId, schoolName, schoolState, roles, scopes, grantVersion }], activeSchoolId, activeRole, capabilities, resolutionStatus }`.

`eligible = verified memberships where membership.status == active and school.status == active.`
- `eligible.length === 0`: show guest/request/pending state; school switcher hidden. Do not default to MCS for a new unknown account.
- `eligible.length === 1`: auto-select the only school; school switcher **not rendered at all** in header/mobile/account menu. Do not render a disabled selector or blank space.
- `eligible.length > 1`: render switcher in account menu as label + chevron, with current school and accessible name. Mobile: bottom-sheet/drawer; desktop: anchored popover with search at 6+ schools. Count by distinct schoolId (not roles, classes or school catalog entries).
- Authorization request in flight: show a compact "Checking school access…" loader, not an incorrect student role or old school.
- Revoked school: re-evaluate and move to remaining allowed school; if none, show "Your school access has changed" with Request access, Retry and Sign out.
- Invalid bookmarked `?schoolId=...` is an untrusted hint: ignore for authorization, show safe no-access if resource belongs to another school, retain correct user-scoped activity.
- No permission to any school but platform-owner authority: redirect to Owner Console, not blank guest home; separate global privileges.
- If one school but multiple roles, show **role/workspace switcher only when truly useful** (not school selector), never assume teacher permissions when student view is active.

**UI state machine**:
`unresolved -> authenticated -> membershipsLoading -> [zero | one | multiple] -> selected/validated -> authorized -> workspace; revoked/error/offline -> safeRecovery.`
No server-unverified sensitive panels render in unresolved/error state.

## Mobile-first responsive specifications

### Header (320–599 px)
- Single row: small logo, page title or context, notification icon, account/avatar menu. Avoid a separate school bar that consumes vertical space.
- At `eligible.length > 1`, show a compact selected-school chip **inside** account menu entry point or as a secondary row **only when the switch must be discoverable**. Prefer account drawer entry labelled "Switch school" (do not hide ability in an unlabeled icon).
- No school chip or selection gap when `eligible.length === 1`.
- Search / help accessible from account drawer and contextual page actions, not perpetually expanded fields.
- Menus are scroll-contained, respect safe-area insets, trap focus and can close without scrolling through page content.
- Notification item always carries school name when the user belongs to multiple schools; on single-school accounts omit redundant school prefix.

### Main navigation (320–599 px)
- Bottom action bar with up to four most-frequent actions, one "More" destination, **only if** the page structure supports it without consuming editor workspace. Studio may use a compact header + collapsible project drawer instead.
- Student: Home, Assignments, Studio, More. Teacher: Home, Review, Assessments, More. School admin: Overview, People, Academics, More. Owner: Schools, Provisioning, Health, More.
- No Role/School Admin links to a teacher unless explicit grants; no platform-owner links in school admin navigation.
- Active destination and accessible label visible, high contrast, keyboard/focus states and no noninteractive placeholders.
- Support browser back, nested navigation breadcrumbs when needed, and compact sticky primary action on long screens (not overlapping on-screen keyboard).

### Tablet (600–1023 px)
- Collapse secondary/tertiary panels into tabs/drawers. Two-column card dashboard when room allows. Compact inline school switcher only for multi-school users.
- Lists/Gradebook horizontally scroll **inside their own region** with sticky row labels where needed; page itself must not overflow horizontally.

### Desktop (1024+ px)
- Persistent slim sidebar or compact grouped top nav per role; secondary rail only when it adds context. School switcher in account area when multi-school.
- Multi-pane review: class selector → submissions → frozen snapshot/rubric; Gradebook access on same flow without duplicate "review" tabs.
- Owner Console contains school directory/table, filters, status and provisioner; no global student grade table.

### Shared accessibility/interaction
- Test at **320, 360, 375, 390, 430, 600, 768, 1024, 1280 px** and with 200% zoom.
- Minimum text 14–16 px for content; use larger headings, system font, 1.4–1.6 line height. On narrow widths, shorten labels rather than shrinking critical text.
- Input label visible, validation adjacent, status announced through `role=status` or appropriately prioritized live region. Avoid modal stacks and focus loss.
- Honor `prefers-reduced-motion`; loaders show text, not motion alone. Avoid dark/blank overlays without explanation.
- Every save/submit/review/publish button shows operation status and guards against double clicks, offline/network retry and stale school context.
- Do not reveal school roster data through loading skeletons, stale account initials, cached analytics counts or global search suggestions.

## Specific screen sketches (information architecture, not rendered mockups)

### Single-school student (default pilot, 360 px)

`┌────────────────────────────────────┐
│  [Adminerva]  Assignments   🔔  ☰  │
├────────────────────────────────────┤
│  Good afternoon                     │
│  Continue what you're working on   │
│  [ Assignment due soon ]            │
│  [ Open Adminerva Studio ]          │
│  [ Feedback & published grades ]    │
│                                     │
│  My classes                         │
│  [ Grade 11 — ... ]                  │
├────────────────────────────────────┤
│ Home    Assignments    Studio   More│
└────────────────────────────────────┘`

No "Manila Cathedral School ▾" school selection because only one verified school exists. An accessible static school name may be displayed in Profile/About School, not as a fake control.

### Multi-school teacher (360 px)

`┌────────────────────────────────────┐
│ [Adminerva]   Teacher        🔔  ☰ │
├────────────────────────────────────┤
│ Teaching at: MCS  [Switch school]   │
│ Classes: only MCS                   │
│ [Assessments awaiting review]       │
│ [Create assignment]                 │
│ [Lesson Planner]                    │
├────────────────────────────────────┤
│ Home      Review      Tasks     More│
└────────────────────────────────────┘`

Tapping Switch school:
`┌─ Select a school ──────────────────┐
│ ◉ Manila Cathedral School           │
│ ○ School B                           │
│ [Choose school]     [Cancel]         │
└──────────────────────────────────────┘`
Choose action does **not** reload old MCS project into School B; user must re-open an authorized resource.

### One-school School Admin (360 px)

`┌────────────────────────────────────┐
│ [Adminerva] School Admin      🔔 ☰ │
├────────────────────────────────────┤
│ School overview                     │
│ [Admissions]  [Teacher assignments] │
│ [Sections]   [Subjects & offerings] │
│ [School files and policies]         │
│ [Usage/AI quota]  [Reports]         │
├────────────────────────────────────┤
│ Overview     People   Academics More│
└────────────────────────────────────┘`

No school selector. School Admin still sees their institution's fixed name and brand on overview and settings.

### Platform owner (360 px)

`┌────────────────────────────────────┐
│ [Adminerva] Platform        🔔  ☰  │
├────────────────────────────────────┤
│ Schools managed                     │
│ [Manila Cathedral School] [Active]  │
│ [+ Add a school]                    │
│ [Provisioning tasks]                │
│ [Infrastructure status & logs]      │
│ [Usage and security alerts]         │
├────────────────────────────────────┤
│ Schools   Provisioning  Health More │
└────────────────────────────────────┘`

**School Directory** is always appropriate for owner operations; its existence does not force a school selector on ordinary users.

## Workflow 1 — guest → admission → first MCS session

1. User browses guest Wiki/Studio without school records.
2. User signs in using verified identity and receives resolution state.
3. Existing approved MCS legacy user is matched via server-approved UID mapping. One MCS membership becomes active; no school chooser. Open appropriate Student/Teacher/School Admin workspace.
4. New user with zero memberships sees "Request access" (optionally an invitation code or school invitation link), NOT a default MCS student role. School admins approve invitations within their own school.
5. If owner has a platform-only account, Owner Console loads regardless of school membership.
6. Failed membership lookup shows "Couldn’t verify access—Retry" without exposing data or forcing logout.

## Workflow 2 — student project → assessment → teacher review → Gradebook

1. Student opens assigned MCS assessment from MCS workspace; submit path includes internally resolved school + task ID + student membership.
2. Studio header shows "For your MCS assessment" only where this contextual label prevents confusion. Personal scratch projects remain personal and excluded from evidence submission until explicitly selected.
3. Student saves/submits; server verifies school, student, enrollment, term, task source, deployment, deadline, workspace owner and immutable snapshot limits.
4. Teacher's "Needs review" inbox shows only assigned MCS course; opens frozen submission and relevant rubric in same interface.
5. Teacher saves private draft grade, reopens if needed, then deliberately publishes through existing Gradebook; stale revision and cross-school mismatches fail server-side.
6. Student sees published grade only. Notifications deep-link to the exact authorized school/task and omit school prefix when one school.
7. If student switches school mid-editor or work is unsaved, present "Save or keep a school-specific local draft before switching"; never send buffered writes to a different school.

## Workflow 3 — teacher author → deploy to class → grade

1. Teacher’s context resolves to one school and authorized offerings/sections/subjects.
2. Creating a new assessment defaults to **current course offering** chosen from assigned classes, not a global free-form "11-A" field.
3. Drafts can be saved until deployed; deployed rubric/evidence dates follow immutable version/explicit amendment policies.
4. Duplicate class deployment is refused or directed to editing the existing schedule; server enforces idempotency.
5. Grades require teacher-review privileges for the offering, within the school's active policy and Gradebook revisions.
6. Assignments moved between sections/schools are copied as new school-owned tasks only via audited export/import; old grades remain where originally earned.

## Workflow 4 — school admin manage school

1. School admin lands at own school's overview and no school selection if only one membership.
2. School catalog: Academic year > Term > Program > Subject > Section/Course offering; each creation validates stable scope and duplicate names within correct year.
3. Invite verified teachers/students, approve matched roster links, assign course offerings/section responsibility; any role escalation audited.
4. Access revocation prompts confirmation (who loses which active classes); server denies new writes immediately and preserves historical records.
5. School files: upload school-specific materials, set sharing rules (private owner, assigned class, school staff), review storage quota, archive.
6. School AI: explicit school-local policy and quota; schools do not see each other's settings or prompts.
7. Reports are school-scoped; all-school totals are a privileged platform-only aggregate and should not contain student-level private data.

## Workflow 5 — platform owner add school manually

1. Open Owner Console → Schools → Add School.
2. Wizard `Identity → Policies & Data Region → Quotas & Features → Initial School Admin → Review & Provision`. At 320 px each stage takes a full-width single-column panel.
3. Before provisioning, validate immutable school key, authorized school identity, status uniqueness, default policy choices and any sensitive secrets.
4. Submit creates idempotent server provisioning job; progress phases with visible status and retry of failed step. **No partially provisioned school is visible to regular users.**
5. Owner invites school admin; school admin sets initial catalog and enrollments; activation requires access test and no path-leakage risks.
6. Owner may suspend/reactivate after audit. Delete/archive is a different privileged workflow with backup, consent and retention gates.

## Workflow 6 — school switch / role switch / stale work

Switch school:
1. User taps Switch school (multi-member only), sees current school and eligible list.
2. Before confirmation, detect unsaved Studio files, import/SQL work, grade drafts, ongoing uploads, teacher form edits and pending cloud/AI operations.
3. If pending: options `Stay and finish`, `Save local draft and switch` where safe, or `Discard unsaved changes` with explicit confirmation. Do not enable switching while a non-cancellable grade transaction is in progress; show result/reconcile first.
4. Increment session/scope epoch, disable old-school controls, unsubscribe, abort requests, persist permissible local drafts to `uid+school+project` key and discard cached private records.
5. Recheck authorization for target school, apply appropriate role, route to role home and then fetch tenant-only data.
6. On failure restore safe previous verified school **only if access is still active**, otherwise show scope recovery.
Role switch within one school follows equivalent privilege boundary and should not leave teacher review data visible in student view.

## Workflow 7 — Studio editor responsiveness

- Project header: name, save state and project settings primary; editor actions in one compact toolbar. Nonpersistent guidance in tooltip/info menu.
- Mobile: top-level project/files drawer, editor as primary canvas, run result/terminal/database in switchable lower sheet. Avoid duplicate tabs when terminal and app are already within Code view.
- File explorer add/rename/delete on context menu **plus** a touch-accessible per-file "More" button and global Add file (right-click alone excludes touch/keyboard users).
- Database tab includes table explorer, rows, SQL console, visual schema/foreign key descriptions and educational simulator disclaimer; important destructive queries require review before commit.
- Assessment submission action pinned in project context only when task active; individual GitHub/project task policies determine whether "Submit" is allowed.
- Practical exam: clear start screen, countdown when deadline policy provides one, restrictions clearly labelled as browser deterrents, save state always visible and keyboard-accessible "Ask for help"; no false promise of proctoring.
- Avoid a second vertical toolbar, meaningless black spacer, oversized splitters and clipped modals. Ensure Monaco editor fills available height while browser keyboard is active.
- Editing and terminal remain possible offline where supported, but server-run/submit states are visibly unavailable until connection returns.

## Workflow 8 — notifications and school deep links

- Global user inbox may aggregate authorized notifications from multiple schools, but each payload includes protected school ID and recipient UID; school-local teacher notifications are generated only from authorized class data.
- Multi-school users see explicit school label for each item; single-school users need no redundant label.
- On click, verify recipient membership/role/resource before switching or opening. If revoked, show "This item belongs to a school you can no longer access."
- No school name in device push if privacy mode is enabled. Avoid actual grade or student names in push preview on shared devices.
- Opening a notification never silently changes data or grants school access; badges and unread states are user-scoped but content is tenant scoped.

## Component design contracts

| Component | Minimum states | Important behavior |
| --- | --- | --- |
| School switcher | hidden / ready / switching / denied | Render only when 2+ active schools; last selection is merely a hint |
| Effective role badge | hidden / verified / changes pending | Label from server authority, not old `Adminerva_Role` cache |
| Assignment card | upcoming / open / submitted / needs revision / closed | One primary relevant action; no duplicate CTA |
| Grade chip | draft / ready / published / corrected | Students never see private draft or teacher-only review notes |
| Project save indicator | unsaved / saving / saved / offline / failed | No fake "saved" on local-only changes; preserve recovery copy |
| Inline table | loading / rows / empty / error / partial | Empty ≠ inaccessible/error; page count and accessible sorting |
| Modal | loading / form / processing / error / success | Focus trap, Escape close when safe, explicit Close, bounded content |
| Notification badge | 0 / unread / loading / unavailable | Avoid false zero for missing feed |
| File upload | queued / scanning / uploading / complete / failed | Destination school fixed at start; no switching of uploaded object owner |
| Permission gate | checking / allowed / denied / revoked | Safe neutral skeleton until allowed; denial with next step |
| School provisioner | draft / provisioning / pending-admin / ready / active / failed / suspended | Idempotent retry and detailed stage failure |
| School-specific release card | relevant / hidden / read | Explain student grading impact even if feature is teacher-facing |

## Content and language rules

Prefer `School`, `Class`, `Assignment`, `Project`, `Submission`, `Grade`, `Review`, `Published`. Limit technical language like tenant, UID, revisionHash, repository SHA and database project ID to advanced details/admin screens. Show Manila Cathedral School name in the School Admin overview, profile/about school and multi-school switcher as appropriate, but not a mandatory selector on single-school pages.

Clear recovery messages:
- "Your work is saved on this device, but it hasn't synced yet."
- "You no longer have access to this class. Your teacher or school administrator can review your assignment."
- "Your school access couldn't be verified. Retry or ask your school administrator."
- "This submission belongs to another school. Open the assignment from your current school's workspace."
- "The assignment deadline has passed. Your project is still saved, but submission isn't available."
- "School change paused: finish or save the current grading action first."

## Page-by-page role mapping (reuse, not create another system)

| Existing page(s) | Student | Teacher | School admin | Platform admin |
| --- | --- | --- | --- | --- |
| guest pages / Wiki | public | public | public | public |
| student-home, dashboard, assessments, Studio, XML Lab, Practice | own school | only if separately authorized student role | not automatically | not automatically |
| teacher-home, assessment-studio, review/inbox/gradebook | — | assigned school classes | school oversight and appropriately approved school actions | no default student-record access |
| teacher analytics, lesson planner, slides, library, schedule | — | assigned classes and private materials | school-level resources where authorized | platform operational overview only |
| users, teacher-accounts, manage-sections/programs/subjects, school-admin | — | read-only where granted | own school admin | not school-edit by default |
| admin-analytics, monitoring, issues | own relevant notifications/issues | class scoped | school scoped | aggregate platform diagnostics with audited break-glass |
| settings, patch notes | own profile/role | own profile/role | school configuration + profile | global platform configuration + profile |

A service may have multiple routes for different roles but only one backend domain model; do not clone Gradebook, evidence approval, school setup or Studio by role.

## Focused UI acceptance

- Single-school MCS student/teacher/admin **never sees a school dropdown** (including empty toolbar width, disabled dropdown, mobile drawer ghost link).
- Multi-school teacher and school admin can discover the switcher by touch, keyboard and screen reader, and the verified selection survives reload.
- At 320 px: no clipped buttons/menus, modal content and terminal accessible, file explorer actions usable by touch, Gradebook scrolls in region.
- Never show another school's student name/count through stale view, search, notification, skeleton, browser back, live listener or export.
- No privileged action is enabled while access resolution is pending; server denies forged scope even if the UI is manipulated.
- Existing learner workflow from assessment through published grade remains achievable with clear statuses and no extra school-selection step.
- Account, school and role switching never overwrites pending local drafts or grade journal and never accidentally sends pending cloud work to a different scope.
