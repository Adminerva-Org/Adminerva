# Adminerva UI/UX and loading optimization — V4 teacher-first pass
Updated: 2026-11-10

## Objective and scope
Make the existing V4 site faster to understand and more responsive to input, starting from the instructor's Review & Grade journey, then covering student submissions, Studio and school administration. Preserve explicit teacher approval/publication and existing student/teacher/school records.

This PR is a **UI/UX and client-side performance branch**; it does not grant school roles, alter authorization rules, rewrite assessments/grades/evidence, change Firebase Functions, or migrate production data. It is distinct from Pilot Sandbox PR #137.

## Teacher-first workflow
- `repofetch.html`: compact class, assessment, learner and repository context; visible workflow steps; inline queue skeleton/progress; tighter review controls. The hidden legacy investigation no longer starts a redundant full-roster read on normal entry.
- `gradebook.html` and Assessment Studio: compact responsive controls and clear review/publishing context. No automatic grade publication or evidence approval.
- `teacher-home.html`: primary review, planning and class-progress actions; organized tools and contextual shortcuts. Optional activity pulse occurs after first paint.
- Lesson planner, timetable, and slide editor: less wasted space; pinned schedule headings; clear read/edit states; fixed slide history/archive overlap; lazy-load slide export libraries only when exporting.
- Teacher analytics: bound repository-cache reads to the selected section's repositories (up to 60 groups in batches of eight) instead of scanning every repository cache record. Missing cache data is **not** treated as proof of student inactivity.
- Submission Inbox and Studio review: inline status, responsive lists, visible counts, stale account-response cancellation, and frozen Studio revision inspection.
- Attribution, repository investigation, and V4 teacher assessment library/gradebook: consistent navigation, keyboard focus and responsive layout.

## Student-first and Studio follow-on
- Student assignments: filter-aware counters, more legible cards, event-delegated open action, accessible modal dialog with Escape/Tab focus handling and return focus.
- Student commit evidence: progress/selection count, checkpoint state, server-synchronization status, focus-preserving action buttons and mobile layout; original evidence transaction and audit behavior preserved.
- Student Project Hub: render saved GitHub activity immediately; skip automatic refresh for a recent cache; explicit refresh action; bounded 90-day repository history requests and clear failure notices. GitHub repository redirects may be followed for **read-only** activity; school student URLs are not silently rewritten.
- Student Studio: deferred editor/diagram scripts; **JSZip loads before the Monaco AMD loader** to keep import/export/multi-file execution reliable. ZIP loading was not deferred after the ordering dependency was identified.
- Student Practice Lab and XML Layout Lab: auth-safe first-paint shell, deferred shared navigation, and early connection hints on common routes.

## School administration follow-on
- Legacy User Directory: no automatic per-student GitHub fan-out on page entry; instead, an explicit read-only check of only the visible page, up to three GitHub requests at a time. Navigation and roster reload do not modify stored repository URLs.
- V4 People & Access: fetch only the selected panel on initial entry; tabs support arrow/Home/End keyboard navigation and associate with their panels; server-side role and school lease checks remain authoritative.
- Teacher accounts: focus on assigning sections and subjects; legacy recovery is in accessible advanced disclosure sections.
- Sections, subjects, pathways and school/owner pages: shared administrative density, responsive controls, visible status, and stable navigation region.

## Shared loading and navigation
- Auth-safe visual structure for pages gated by Firebase account verification; no protected person/grade data is exposed before admission.
- Reserve header height before role-aware navigation mounts, reducing layout shift.
- Prefetch same-origin HTML only after navigation intent (hover/focus), not every possible route. Do not prefetch school records or identity-specific URLs.
- Remove the redundant short-lived page-opening loader while preserving action-level busy feedback.
- Update HTML script query versions for changed entry files and shared navigation so browsers do not persist stale pre-PR code.

## Data-safety boundaries
- No Firestore schema, rule, IAM, Cloud Function, or server migration changes in this PR.
- No bulk grade approval, private-draft publication, evidence ownership transfer or audit-history removal.
- No automatic changes to student profile GitHub repository URLs during directory browsing.
- Do not treat missing GitHub metadata as confirmed lack of student work.

## Review and release considerations
- Source checks and GitHub workflows run on the PR. The branch is deliberately separate from production until release integration is approved.
- This change set does not assert a measured load-time improvement without real browser network and timing measurements.
- The Tailwind CDN/runtime remains in many static pages; replacing it with a compiled, route-aware CSS build is a **separate optimization**, because dynamically generated class names must be preserved.
- Final browser checks should cover narrow-width teacher Review & Grade, modal focus, reopened student evidence, Studio ZIP import/export and V4 multi-school switching. Keep this review focused; grading data must remain untouched.
- A previous CI run uncovered a schedule editor mock-DOM guard and two student UX assumptions. The schedule guard, Studio AMD/ZIP dependency order and student delegated-action test have been corrected on this branch. Current CI status should be read from the PR.

## Status
Implementation is committed to `feature/teacher-first-ux-perf-20261110` and tracked in PR #138. **Do not claim deployed** solely because a commit was pushed. Release/hosting status is a separate step.
