# Repository map and naming policy

New routes and modules use lowercase kebab-case; module folders group responsibilities. JavaScript pure helpers use `.mjs`, existing browser entry `.js` paths remain stable when stored or cached. Tests are colocated or under `tests/`. Do not rename database collections, document IDs, stored keys, CI-mandated names, Firebase configuration filenames or standard documentation conventions just for style.

## Canonical routes and compatibility

| Canonical | Preserved alias |
| --- | --- |
| `teacher-analytics.html` | `reporeviewDashboard.html` |
| `group-inspector.html` | `temp-grading.html` |
| `activity-grader.html` | `temp-activity-grader.html` |

Aliases preserve query strings and fragments. The old dashboard module is an import shim. Binary logo filenames and deployed legacy entry modules are deliberately retained to avoid breaking outside links or cached clients. Further moves require consumer/link tests; this is not an unreviewed wholesale relocation.

## Module responsibilities

- `js/core/`: Shared navigation, account access, reporting and release infrastructure.
- `js/repo-review/`: Assessment authoring, repository evidence, individual review and protected grading.
- `js/student/`: Student submissions, practice progress and isolated code workspaces.
- `js/lesson-review/`: Lesson planning, school schedules, references and document export.
- `js/presentation-review/`: Editable slides, lesson provenance and safe slide export.
- `js/settings/`: Scoped product configuration and staff preferences.
- `js/analytics/`: Optional operational signals and separate instructor learning summaries.
- `js/help/`: Public contextual guidance and explicit privacy controls.

## Source file index

- `activity-grader.html`: Adminerva module: activity grader.
- `admin-analytics.html`: Administrator operational usage, diagnostic samples and summary preparation.
- `assessment-evidence-review.html`: Instructor checkpoint approval, reopening and contribution verification.
- `assessment-studio.html`: Adminerva module: assessment studio.
- `contribution-inspector.html`: Committed-change inspection and contribution-claim context.
- `css/adminerva-ui.css`: Adminerva module: adminerva ui.
- `functions/index.js`: Cloud Functions v2 report/submission notification handlers; deployment requires explicit separate approval.
- `gradebook.html`: Teacher grade administration, protected revisions and explicit publication.
- `grading.html`: Adminerva module: grading.
- `group-inspector.html`: Shared-project detail and individual contribution context.
- `index.html`: Public Adminerva product introduction and workspace entry.
- `issues.html`: Role-separated report feed, triage and optional admin-only diagnostic trails.
- `js/analytics/activity-client.mjs`: Opt-in, minimized activity collection and in-memory diagnostic trails.
- `js/analytics/activity-model.mjs`: Allowlisted module/action schema and approximate foreground-time accounting.
- `js/analytics/activity-model.test.mjs`: Regression coverage: Allowlisted module/action schema and approximate foreground-time accounting.
- `js/analytics/admin-analytics.mjs`: Administrator operational usage, diagnostic samples and summary preparation.
- `js/analytics/teacher-analytics.mjs`: Assigned-instructor academic analytics and repository activity context.
- `js/analytics/teacher-engagement.mjs`: Private coarse engagement snapshots with administrator teacher selection.
- `js/core/adminerva-loader.js`: Concurrent loading status, public help mounting and issue reporting.
- `js/core/adminerva-nav.js`: Responsive module navigation, account controls and notifications.
- `js/core/adminerva-nav.test.mjs`: Regression coverage: Responsive module navigation, account controls and notifications.
- `js/core/auth-guard.js`: Verified account admission, workspace visibility and sign-out routing.
- `js/core/feedback-format.mjs`: Shared navigation, account access, reporting and release infrastructure: feedback format.
- `js/core/feedback-format.test.mjs`: Regression coverage: Shared navigation, account access, reporting and release infrastructure: feedback format.
- `js/core/firebase-core.js`: Shared Firebase application, authentication and Firestore initialization.
- `js/core/issues.js`: Role-separated report feed, triage and optional admin-only diagnostic trails.
- `js/core/login.js`: Approved-account sign-in and access feedback.
- `js/core/notification-history.mjs`: Shared navigation, account access, reporting and release infrastructure: notification history.
- `js/core/notification-routing.mjs`: Shared navigation, account access, reporting and release infrastructure: notification routing.
- `js/core/notification-routing.test.mjs`: Regression coverage: Shared navigation, account access, reporting and release infrastructure: notification routing.
- `js/core/notification-visibility.mjs`: Shared navigation, account access, reporting and release infrastructure: notification visibility.
- `js/core/notification-visibility.test.mjs`: Regression coverage: Shared navigation, account access, reporting and release infrastructure: notification visibility.
- `js/core/notifications.mjs`: Shared navigation, account access, reporting and release infrastructure: notifications.
- `js/core/patch-history.mjs`: Shared navigation, account access, reporting and release infrastructure: patch history.
- `js/core/patch-history.test.mjs`: Regression coverage: Shared navigation, account access, reporting and release infrastructure: patch history.
- `js/core/patch-notes.mjs`: Public curated feature history without private operational details.
- `js/core/report-filters.mjs`: Shared navigation, account access, reporting and release infrastructure: report filters.
- `js/core/report-filters.test.mjs`: Regression coverage: Shared navigation, account access, reporting and release infrastructure: report filters.
- `js/core/server.js`: Shared navigation, account access, reporting and release infrastructure: server.
- `js/core/site-updates.mjs`: Shared navigation, account access, reporting and release infrastructure: site updates.
- `js/core/staff-role.mjs`: Verified staff identity; simulation never grants authorization.
- `js/help/page-help.mjs`: Page tutorials, public handbook links and explicit activity preferences.
- `js/lesson-review/ai-engine.js`: Explicitly requested lesson assistance with source and edit guards.
- `js/lesson-review/app-ui.js`: Lesson-planner interface events and workflow coordination.
- `js/lesson-review/document-exporter.js`: School-format lesson document construction and export.
- `js/lesson-review/lesson-editor.test.mjs`: Regression coverage: Editable lesson content, save state and export synchronization.
- `js/lesson-review/lesson-firebase.js`: Saved lesson records, version handling and lesson loading.
- `js/lesson-review/lesson-plan-helpers.mjs`: Lesson planning, school schedules, references and document export: lesson plan helpers.
- `js/lesson-review/lesson-plan-helpers.test.mjs`: Regression coverage: Lesson planning, school schedules, references and document export: lesson plan helpers.
- `js/lesson-review/lesson-workflow.test.mjs`: Regression coverage: Lesson planning, school schedules, references and document export: lesson workflow.
- `js/lesson-review/library.js`: Lesson reference folders and document management.
- `js/lesson-review/reference-context.mjs`: Lesson planning, school schedules, references and document export: reference context.
- `js/lesson-review/reference-context.test.mjs`: Regression coverage: Lesson planning, school schedules, references and document export: reference context.
- `js/lesson-review/schedule-scope.mjs`: Lesson planning, school schedules, references and document export: schedule scope.
- `js/lesson-review/schedule-scope.test.mjs`: Regression coverage: Lesson planning, school schedules, references and document export: schedule scope.
- `js/lesson-review/schedule.js`: Teacher schedule editing and scoped calendar workflow.
- `js/presentation-review/lesson-slide-integration.test.mjs`: Regression coverage: Editable slides, lesson provenance and safe slide export: lesson slide integration.
- `js/presentation-review/lesson-to-slides.mjs`: Editable slides, lesson provenance and safe slide export: lesson to slides.
- `js/presentation-review/lesson-to-slides.test.mjs`: Regression coverage: Editable slides, lesson provenance and safe slide export: lesson to slides.
- `js/presentation-review/presentation-ai.js`: Explicitly requested assisted slide generation and safe draft acceptance.
- `js/presentation-review/presentation-export.js`: Editable slides, lesson provenance and safe slide export: presentation export.
- `js/presentation-review/presentation-firebase.js`: Saved deck storage, lesson linking and source-version checks.
- `js/presentation-review/presentation-ui.js`: Slide authoring controls and deck editing state.
- `js/presentation-review/sanitize.js`: Editable slides, lesson provenance and safe slide export: sanitize.
- `js/repo-review/app.js`: Assessment authoring, repository evidence, individual review and protected grading: app.
- `js/repo-review/assessment-dates.mjs`: Assessment authoring, repository evidence, individual review and protected grading: assessment dates.
- `js/repo-review/assessment-dates.test.mjs`: Regression coverage: Assessment authoring, repository evidence, individual review and protected grading: assessment dates.
- `js/repo-review/assessment-evidence-review.mjs`: Instructor checkpoint approval, reopening and contribution verification.
- `js/repo-review/assessment-studio.js`: Assessment authoring, repository evidence, individual review and protected grading: assessment studio.
- `js/repo-review/auto-checker.js`: Automated evaluation assistance with instructor-controlled acceptance.
- `js/repo-review/contribution-inspector.js`: Committed-change inspection and contribution-claim context.
- `js/repo-review/dashboard.js`: Legacy teacher analytics import compatibility entry.
- `js/repo-review/gradebook-quarter.mjs`: Assessment authoring, repository evidence, individual review and protected grading: gradebook quarter.
- `js/repo-review/gradebook.js`: Teacher grade administration, protected revisions and explicit publication.
- `js/repo-review/grading.js`: Assessment authoring, repository evidence, individual review and protected grading: grading.
- `js/repo-review/group-inspector.js`: Shared-project detail and individual contribution context.
- `js/repo-review/manual-review.mjs`: Primary teacher evidence review, evaluation drafts and deliberate grade publication.
- `js/repo-review/repobank.js`: Assessment authoring, repository evidence, individual review and protected grading: repobank.
- `js/repo-review/repofetch.js`: Repository selection and entry into the teacher review workspace.
- `js/repo-review/services/assessment-evidence.mjs`: Committed-evidence selection, checkpoint provenance and evidence lifecycle.
- `js/repo-review/services/assessment-evidence.test.mjs`: Regression coverage: Committed-evidence selection, checkpoint provenance and evidence lifecycle.
- `js/repo-review/services/commit-history.mjs`: Assessment authoring, repository evidence, individual review and protected grading: commit history.
- `js/repo-review/services/commit-history.test.mjs`: Regression coverage: Assessment authoring, repository evidence, individual review and protected grading: commit history.
- `js/repo-review/services/commit-substance.mjs`: Assessment authoring, repository evidence, individual review and protected grading: commit substance.
- `js/repo-review/services/commit-substance.test.mjs`: Regression coverage: Assessment authoring, repository evidence, individual review and protected grading: commit substance.
- `js/repo-review/services/contribution-resolver.mjs`: Assessment authoring, repository evidence, individual review and protected grading: contribution resolver.
- `js/repo-review/services/contribution-resolver.test.mjs`: Regression coverage: Assessment authoring, repository evidence, individual review and protected grading: contribution resolver.
- `js/repo-review/services/evidence-lifecycle.mjs`: Assessment authoring, repository evidence, individual review and protected grading: evidence lifecycle.
- `js/repo-review/services/evidence-lifecycle.test.mjs`: Regression coverage: Assessment authoring, repository evidence, individual review and protected grading: evidence lifecycle.
- `js/repo-review/services/evidence-transaction.mjs`: Assessment authoring, repository evidence, individual review and protected grading: evidence transaction.
- `js/repo-review/services/github-evidence-client.mjs`: Assessment authoring, repository evidence, individual review and protected grading: github evidence client.
- `js/repo-review/services/github-evidence-client.test.mjs`: Regression coverage: Assessment authoring, repository evidence, individual review and protected grading: github evidence client.
- `js/repo-review/services/grade-revision-snapshot.mjs`: Assessment authoring, repository evidence, individual review and protected grading: grade revision snapshot.
- `js/repo-review/services/grade-revision-snapshot.test.mjs`: Regression coverage: Assessment authoring, repository evidence, individual review and protected grading: grade revision snapshot.
- `js/repo-review/services/inspector-helpers.mjs`: Assessment authoring, repository evidence, individual review and protected grading: inspector helpers.
- `js/repo-review/services/inspector-helpers.test.mjs`: Regression coverage: Assessment authoring, repository evidence, individual review and protected grading: inspector helpers.
- `js/repo-review/services/review-snapshot.mjs`: Assessment authoring, repository evidence, individual review and protected grading: review snapshot.
- `js/repo-review/services/review-snapshot.test.mjs`: Regression coverage: Assessment authoring, repository evidence, individual review and protected grading: review snapshot.
- `js/repo-review/services/v2-grading-assistant.mjs`: Assessment authoring, repository evidence, individual review and protected grading: v2 grading assistant.
- `js/repo-review/services/v2-grading-assistant.test.mjs`: Regression coverage: Assessment authoring, repository evidence, individual review and protected grading: v2 grading assistant.
- `js/repo-review/submissions.mjs`: Unified review inbox for legacy receipts and committed evidence.
- `js/repo-review/temp-activity-grader.js`: Assessment authoring, repository evidence, individual review and protected grading: temp activity grader.
- `js/repo-review/v2-grading-queue.mjs`: Assessment authoring, repository evidence, individual review and protected grading: v2 grading queue.
- `js/settings/settings-core.js`: Scoped product configuration and staff preferences: settings core.
- `js/settings/settings-lesson.js`: Scoped product configuration and staff preferences: settings lesson.
- `js/settings/settings-presentation.js`: Scoped product configuration and staff preferences: settings presentation.
- `js/settings/settings-repo.js`: Scoped product configuration and staff preferences: settings repo.
- `js/settings/settings-security.js`: Scoped product configuration and staff preferences: settings security.
- `js/settings/settings-user.js`: Scoped product configuration and staff preferences: settings user.
- `js/student/assessment-evidence.mjs`: Committed-evidence selection, checkpoint provenance and evidence lifecycle.
- `js/student/assessment-state.mjs`: Student submissions, practice progress and isolated code workspaces: assessment state.
- `js/student/assessment-state.test.mjs`: Regression coverage: Student submissions, practice progress and isolated code workspaces: assessment state.
- `js/student/assessments.js`: Student submissions, practice progress and isolated code workspaces: assessments.
- `js/student/dashboard.js`: Legacy teacher analytics import compatibility entry.
- `js/student/playground-cloud.mjs`: Student submissions, practice progress and isolated code workspaces: playground cloud.
- `js/student/playground-storage.mjs`: Student submissions, practice progress and isolated code workspaces: playground storage.
- `js/student/playground-storage.test.mjs`: Regression coverage: Student submissions, practice progress and isolated code workspaces: playground storage.
- `js/student/playground.js`: Isolated code editing, execution, persistence and practice handoffs.
- `js/student/practice-analytics.mjs`: Student submissions, practice progress and isolated code workspaces: practice analytics.
- `js/student/practice-courses.mjs`: Student submissions, practice progress and isolated code workspaces: practice courses.
- `js/student/practice-courses.test.mjs`: Regression coverage: Student submissions, practice progress and isolated code workspaces: practice courses.
- `js/student/practice-playground-bridge.mjs`: Student submissions, practice progress and isolated code workspaces: practice playground bridge.
- `js/student/practice-playground-bridge.test.mjs`: Regression coverage: Student submissions, practice progress and isolated code workspaces: practice playground bridge.
- `js/student/practice-points.mjs`: Student submissions, practice progress and isolated code workspaces: practice points.
- `js/student/practice-points.test.mjs`: Regression coverage: Student submissions, practice progress and isolated code workspaces: practice points.
- `js/student/practice-standings.mjs`: Student submissions, practice progress and isolated code workspaces: practice standings.
- `js/student/practice.js`: Practice missions, private progress and personal completion points.
- `js/student/settings.js`: Student submissions, practice progress and isolated code workspaces: settings.
- `js/student/submission-receipts.mjs`: Student submissions, practice progress and isolated code workspaces: submission receipts.
- `js/student/xml-lab.mjs`: Safe Android XML subset browser preview and per-account drafts.
- `js/student/xml-layout.mjs`: Student submissions, practice progress and isolated code workspaces: xml layout.
- `js/student/xml-layout.test.mjs`: Regression coverage: Student submissions, practice progress and isolated code workspaces: xml layout.
- `lesson-planner.html`: Adminerva module: lesson planner.
- `library.html`: Lesson reference folders and document management.
- `login.html`: Approved-account sign-in and access feedback.
- `patch-notes.html`: Public curated feature history without private operational details.
- `practice-analytics.html`: Adminerva module: practice analytics.
- `presentation.html`: Adminerva module: presentation.
- `repobank.html`: Adminerva module: repobank.
- `repofetch.html`: Repository selection and entry into the teacher review workspace.
- `reporeviewDashboard.html`: Adminerva module: reporeviewDashboard.
- `schedule.html`: Teacher schedule editing and scoped calendar workflow.
- `settings.html`: Adminerva module: settings.
- `student-assessments.html`: Adminerva module: student assessments.
- `student-dashboard.html`: Adminerva module: student dashboard.
- `student-home.html`: Student learning and project workspace landing page.
- `student-playground.html`: Adminerva module: student playground.
- `student-practice.html`: Adminerva module: student practice.
- `student-settings.html`: Adminerva module: student settings.
- `student-xml-lab.html`: Adminerva module: student xml lab.
- `submissions.html`: Unified review inbox for legacy receipts and committed evidence.
- `teacher-analytics.html`: Assigned-instructor academic analytics and repository activity context.
- `teacher-home.html`: Staff module landing page and verified administrator shortcuts.
- `temp-activity-grader.html`: Adminerva module: temp activity grader.
- `temp-grading.html`: Adminerva module: temp grading.
- `tests/browser/review-fixtures.mjs`: Regression coverage: Adminerva module: review fixtures.
- `tests/browser/review-lifecycle.smoke.mjs`: Regression coverage: Adminerva module: review lifecycle.smoke.
- `tests/firestore-rules.test.mjs`: Regression coverage: Adminerva module: firestore rules.
- `tests/lesson-school-format.test.mjs`: Regression coverage: Adminerva module: lesson school format.
- `tests/review-workspace.test.mjs`: Regression coverage: Adminerva module: review workspace.
- `users.html`: Adminerva module: users.
- `wiki.html`: Public curated handbook, privacy information and workflow tutorials.

