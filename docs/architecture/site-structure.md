# Adminerva Site Structure and Public Route Contract

## Purpose

Adminerva is a live LMS/SIS/school operating system. Existing URLs may already be present in assignments, notifications, browser bookmarks, student instructions, grading evidence, and external links.

For that reason, **root HTML filenames are public compatibility contracts**. Internal code may be reorganized, but a public route must not be renamed or removed without a compatibility redirect that preserves query parameters and hash fragments.

## Public route layer

Root `*.html` files are the stable entrypoint layer.

Examples:

- `student-home.html`
- `student-assessments.html`
- `student-dashboard.html`
- `student-playground.html`
- `teacher-home.html`
- `assessment-studio.html`
- `repofetch.html`
- `gradebook.html`
- `class-record.html`
- `school-admin.html`
- `people-access.html`
- `school-academic-configuration.html`
- `school-grading-schemes.html`

A route may become a compatibility redirect when a canonical replacement exists, but the old URL remains valid.

Current examples:

- `manage-programs.html` -> `school-academic-configuration.html`
- `manage-sections.html` -> `school-academic-configuration.html`
- `manage-subjects.html` -> `school-academic-configuration.html`
- `pilot-sandbox.html` -> `teacher-home.html`
- `school-pilot.html` -> `school-admin.html`
- `reporeviewDashboard.html` -> `teacher-analytics.html`
- `temp-activity-grader.html` -> `activity-grader.html`
- `temp-grading.html` -> `group-inspector.html`

## Module ownership

### Shared platform shell

`js/core/` is reserved for code that is genuinely shared across product areas:

- authentication and authorization guards
- Firebase bootstrap
- shared navigation
- route/workspace information architecture
- verified school context
- account/school/role switching
- notifications
- loading, prefetch and shared UI utilities

Page-specific feature controllers should not be added to `js/core/` unless they are intentionally shared.

### Student

Canonical feature code:

- `js/student/`

Public routes remain at root for compatibility.

Important OLD-but-active student routes:

- `student-assessments.html`
- `student-dashboard.html`
- `student-settings.html`
- `student-xml-lab.html`

These remain visible because current classes may still depend on them.

### Repository Management

Canonical feature code:

- `js/repo-review/`

Public routes currently include:

- `assessment-studio.html`
- `submissions.html`
- `repofetch.html`
- `gradebook.html`
- `repobank.html`
- `grading.html`
- `activity-grader.html`
- `learning-follow-up.html`

This is an OLD-but-active workflow and must remain operational until an explicit repository migration is approved.

### School Administration

Canonical page-controller code:

- `js/school-admin/`

Current controllers:

- `dashboard.mjs`
- `people-access.mjs`
- `academic-configuration.mjs`
- `grading-policies.mjs`
- `class-record-oversight.mjs`

Former `js/core/` controller paths remain compatibility wrappers so cached HTML does not fail.

### Grading

Canonical feature code:

- `js/class-record/`

School-wide grading policy is administered through the School Administration module. Teachers use Class Record but do not own school-wide transmutation or weighting policy.

### Preparation

Existing feature folders include:

- `js/lesson-review/`
- `js/presentation-review/`

Preparation pages remain stable root routes such as `lesson-planner.html`, `presentation.html`, `library.html`, and `schedule.html`.

### Analytics

Canonical feature code:

- `js/analytics/`

### Settings

Canonical feature code:

- `js/settings/`

## Navigation rules

1. **Home is not a workspace.**
2. **Workspaces are major product domains.**
3. The center header shows groups/tools for the active workspace.
4. Student OLD workflows that are still used by current classes must remain visible.
5. Use **OLD**, not “Legacy”, in user-facing navigation.
6. Yellow navigation indicator = usable but needs further development/enhancement.
7. Red navigation indicator = future/not yet developed.
8. Do not expose redirect aliases as separate tools when they do not provide a distinct workflow.
9. Do not expose a navigation item unless the current role can actually open it.
10. Future-only major workspaces may have a reserved overview page, but unfinished individual tools remain disabled.

## Change policy

When changing a public route:

1. Identify all role guards, notification links, deep links, assessment records, and navigation references.
2. Add the new canonical route first.
3. Preserve the previous route as a redirect shim.
4. Preserve `location.search` and `location.hash`.
5. Update canonical navigation to the new route.
6. Remove the compatibility route only when there is an explicit migration decision and no active dependency.

## Development direction

New school-system domains should receive their own module folders rather than being placed in `js/core/`.

Planned examples:

- `js/registrar/`
- `js/finance/`
- `js/hr/`
- `js/health/`
- `js/facilities/`
- `js/communications/`
- `js/documents/`

Folders should be created when implementation starts, not merely for empty placeholders.
