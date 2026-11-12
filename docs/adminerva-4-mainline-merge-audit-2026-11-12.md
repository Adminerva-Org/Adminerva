# Adminerva 4.0 — current-main / v4 merge preparation (2026-11-12)

## Pinned comparison (no live deployment)

- Production `main`: `c080e9dc18f104de77dd2cc82480f8b1b6151121`.
- V4 foundation: `1e83b57f242d717803ef961227c907d56b6b1aae`.
- Common merge base: `bebfd29eb51adc9e12271d74814ba60a02601b18`.
- This document is a **three-tree final-content comparison**. A divergent path does **not** necessarily mean an actual Git textual merge conflict; Git may auto-merge disjoint hunks. Do not infer release readiness from a mergeability flag alone.

## File disposition

| Three-tree status | Files | Treatment |
|---|---:|---|
| Unchanged in both | 350 | Leave untouched |
| Both changed to identical final content | 99 | Already consistent |
| V4-only changes | 116 | Preserve V4 source and pilot boundaries |
| Main-only changes | 1 | Carry into V4 |
| Both changed to different final content | 73 | Resolve explicitly, never blanket-replace |

## Mainline updates staged in isolated merge-preparation branch

- [x] Forward-port `learning-follow-up.html` (the one main-only changed path).
- [x] Retain mainline Studio variant, external-personalization, Class Record and grading-scheme checks in V4's canonical quality workflow.
- [x] Restore the **Add to Class Record** deep link in school assessment deployments without modifying the Class Record engine, teacher score, publication policy or school permission rules.
- [ ] Reconcile remaining shared source differences after risk-based inspection; do not force a merge parent or discard either branch's features.
- [ ] Keep current Class Record development owned by its separate workstream; do not overwrite its production files during source convergence.
- [ ] Produce an auditable main-based release candidate with explicit file provenance, followed by a controlled school pilot before mainline merge.

## Divergent paths requiring disposition

### Other shared code / CI (4)

- `.github/workflows/adminerva-quality.yml`
- `css/v4-people-ux.css`
- `js/repo-review/gradebook-class-review.mjs`
- `scripts/check-first-release-reliability.mjs`

### Page integration / cache versions (29)

- `activity-grader.html`
- `gradebook.html`
- `grading.html`
- `issues.html`
- `manage-programs.html`
- `manage-sections.html`
- `manage-subjects.html`
- `owner-schools.html`
- `pilot-sandbox.html`
- `reclaim-inbox.html`
- `repobank.html`
- `repofetch.html`
- `school-admin.html`
- `school-gradebook.html`
- `school-pilot.html`
- `school-student-assessments.html`
- `school-student-projects.html`
- `school-student-settings.html`
- `settings.html`
- `student-assessments.html`
- `student-dashboard.html`
- `student-home.html`
- `student-practice.html`
- `student-xml-lab.html`
- `submissions.html`
- `teacher-accounts.html`
- `teacher-analytics.html`
- `teacher-home.html`
- `users.html`

### Studio / assessment submission (9)

- `assessment-studio.html`
- `css/playground-workspace.css`
- `guest-playground.html`
- `js/student/playground.js`
- `js/student/studio-assessment-submit.mjs`
- `js/student/studio-assessment-variant.mjs`
- `scripts/check-studio-mobile-ux.mjs`
- `student-playground.html`
- `studio-submissions.html`

### Firebase / backend (1)

- `functions/index.js`

### Identity / routing / access (10)

- `js/core/adminerva-nav.js`
- `js/core/adminerva-nav.test.mjs`
- `js/core/auth-guard-v4-pilot.js`
- `js/core/home-pulse.mjs`
- `js/core/home-workspace.mjs`
- `js/core/people-access.mjs`
- `js/core/session-destination-v4-pilot.mjs`
- `js/core/session-destination.mjs`
- `js/settings/settings-user.js`
- `people-access.html`

### Lesson / references / presentations (14)

- `js/lesson-review/ai-engine.js`
- `js/lesson-review/app-ui.js`
- `js/lesson-review/document-exporter.js`
- `js/lesson-review/lesson-firebase.js`
- `js/lesson-review/lesson-workflow.test.mjs`
- `js/lesson-review/schedule-scope.test.mjs`
- `js/lesson-review/schedule.js`
- `js/presentation-review/presentation-firebase.js`
- `js/repo-review/teacher-assessment-library.mjs`
- `lesson-planner.html`
- `library.html`
- `presentation.html`
- `schedule.html`
- `teacher-assessment-library.html`

### Class Record / student score visibility (6)

- `class-record.html`
- `docs/class-record.md`
- `js/class-record/class-record.mjs`
- `school-class-records.html`
- `school-grading-schemes.html`
- `school-student-grades.html`

## Release-safety boundaries

1. The final merge candidate must retain the V4 verified-school access guard, `legacy_allowed` compatibility policy, school-scoped operations, and the currently deployed mainline Class Record work.
2. Don't import a diff only to make GitHub report `mergeable=true`; combine both branches' behavior intentionally before recording both parents in a merge commit.
3. No Firebase deployment, Cloudflare activation, role cutover, score migration, `v4_only` change or automatic student release is authorized by this source audit.


## Main-first draft integration progress — November 12, 2026

The original 73 divergent paths above describe the pinned **pre-integration** tree outcomes. They are retained as the fixed audit baseline; the source stages below address 15 of those paths without ever modifying current production `main`.

| Stage | GitHub | Source outcome |
|---|---|---|
| 1 | [Draft #186](https://github.com/Adminerva-Org/Adminerva/pull/186) | 57 new V4-only paths added to current-main baseline, no existing main file changed |
| 2 | [Merged #187](https://github.com/Adminerva-Org/Adminerva/pull/187) | 60 V4 modifications where production main matched the original ancestor |
| 3 | [Merged #188](https://github.com/Adminerva-Org/Adminerva/pull/188) | 6 shared lesson/presentation files: concise generator, editor, exporter, school lesson storage and canonical academic schedule |
| 4 | [Merged #189](https://github.com/Adminerva-Org/Adminerva/pull/189) | 1 shared Cloud Functions index: add V4 school variant callable without removing legacy Studio variant or Class Record exports |
| 5 | [Merged #190](https://github.com/Adminerva-Org/Adminerva/pull/190) | 8 shared school-role navigation, auth-routing, home, and People & Access files |

**Main-first diff after stage 5:** 132 paths (57 added, 75 modified, 0 deleted), 9 commits ahead of pinned `main`, 0 behind. Of the original 73 divergent shared paths, **58 remain to disposition**. This is a snapshot; recalculate if active `main` moves.

**Critical distinction:** Draft #186 may appear `mergeable` to GitHub because it starts from current `main`; it is **not a finished Adminerva 4.0 release**, and some school-only routes are not yet wired to their intended entry pages. Keep draft and do not deploy before explicit scoped workflow reconciliation and private pilot acceptance.

Remaining high-priority areas are (a) the shared Studio page and server-mediated submission state, (b) verified-school assessment publish/review services and school Gradebook, (c) current mainline Class Record updates belonging to the separate workstream, (d) teacher/student/school-admin entry-point wiring and navigation script versions.
