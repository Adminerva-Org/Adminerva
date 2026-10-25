# Adminerva 1.4.0 release candidate

Adminerva 1.4.0 is the classroom workflow and follow-through release.

## Teacher grading and review

- Single-assessment Gradebook becomes a class review console with submission/evidence/grade/publication status per learner.
- Bulk checkpoint approval performs ancestry and reclaim-conflict checks and never infers individual contribution credit.
- Bulk evaluation runs only for approved evidence with verified individual contributions and saves private suggestions rather than grades.
- Review & grade loads those private class suggestions against the exact approved evidence revision for teacher confirmation.
- Review & grade remains the individual exception/manual investigation workspace.
- Repository Bank is demoted from primary navigation and retained as advanced Repository context inside Review & grade.

## Reports and school administration

- Administrators can mark internal/test reports separately from genuine user reports.
- Visible reports can be copied as Markdown support packets or exported as JSON/CSV.
- Individual reports can be copied with description, reproduction details, expected/actual behavior, discussion and context for support work.
- School Administration gains an overview workspace for students, teachers, open reports, configuration and operations.

## Navigation, settings and release communication

- Teacher work is separated into **Repository Management** and **Lesson Planning** workspaces so assessment/review tools do not compete with lesson-authoring tools in the same navigation.
- Header uses the rounded Adminerva badge treatment and a more compact vertical footprint.
- Help & updates contains only What's new, page help, Wiki/tutorials and Report a problem.
- Account/role menu contains My reports & support, Privacy and role-appropriate Settings while Sign out remains immediately available.
- Website updates become a true device-push category.
- Administrators can deliberately send the newest published release notification through the same Firebase push path used by grading/review alerts.
- Staff and student settings include interface density, motion, inbox categories, device push, privacy/local-data controls and role-specific existing settings.
- Guests gain a local Guest Settings page for density, motion and privacy/local-data choices.
- Settings panels keep their URL/history state, including direct notification-preferences links.

## Analytics and repository workflow

- Teacher Analytics uses the same centered content width as Practice & learning.
- Repository context remains available for advanced project-level summaries, but is no longer a competing primary tool.

## Authoring and student organization

- Slide Navigator supports direct drag/reorder with a visible insertion indicator, plus deck-level Undo/Redo for structural changes while text editing keeps Quill's own history.
- Skill Arcade remains a single practice hub with reusable deterministic mechanics rather than a collection of unrelated apps.

### Code Playground

- Project Explorer supports file/folder drag-and-drop, moving items into folders or back to the project root, and visible edge insertion for sibling reordering.
- Private cloud versions can be named, renamed, pinned, duplicated, restored, cleaned up or deleted without changing the current device draft.

### Review and follow-through

- Submission Inbox distinguishes submitted/review states from **Graded draft** and **Published** results.
- Teachers can assign Practice Packs built from existing verified Practice missions.
- Teachers can create named projects for whole sections or selected students.
- Teachers can create Improvement Plans with skill targets, goals, next actions and optional linked Practice Packs.
- Students see assigned Practice Packs, projects and Improvement Plans in their existing Project Workspace.
- Assigned Practice Packs also appear in Practice Lab and link directly to the assigned missions.
- Improvement Plans are teacher-authored support records, not automatic mastery or deficit judgments.

## Security and release requirements

- Sections remain the academic authorization boundary.
- Bulk approval does not establish authorship or individual credit.
- Bulk evaluation does not write or publish grades.
- New Firestore rules cover private evaluation suggestions, report test flags, Practice Packs, named projects and Improvement Plans.
- Student profile ownership by email now requires a verified Firebase email claim before direct reads or connection updates.
- Once an activity grade enters versioned audit history it cannot be replaced by an unversioned grade; later changes require the next matching immutable revision.
- Grading-alert updates require authority over the existing alert and cannot reassign its student or section.
- Google Docs export tests exercise the active exporter, and Drive consent requests only the per-file `drive.file` scope without carrying forward prior incremental grants.
- Main-branch quality checks now make the existing public Pages release verification reachable.
- A new `student_projects` composite index supports whole-section named-project queries while selected-learner projects remain scoped to their assigned students.
- 1.4.0 requires coordinated deployment of frontend, Firestore rules/indexes and Cloud Functions because release push adds a new callable and push category.
- The public release manifest remains on 1.3.10 until 1.4.0 is actually deployed.
