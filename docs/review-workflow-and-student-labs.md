# Review workflow and student learning patch

Prepared release: **2026.10.19.1**. This document describes a review branch, not a production deployment. No Firebase rules, Functions or student records are changed by preparing this patch.

## Teacher workflow

1. Open Grading → Review & Grade and choose a section, assessment and student.
2. **Review section:** selected diffs load in place, together with matching files at the exact pinned checkpoint. Review responsibilities, select only independently verified contribution commits, add an inspection note, confirm inspection, and approve the evidence. The evidence panel stays open after approval. Larger or unavailable source is explicitly marked as partial, not missing work. Advanced history and group tools remain optional.
3. **System evaluation draft:** select Evaluate after approval and contribution verification. If no instructor provider key is configured, Checker setup opens in the same page. Consent identifies the external provider and which source is shared. Review the criterion evidence, limitations and separate group observations. Suggestions do not overwrite teacher fields. Use suggested score or Use suggested feedback only when accepted. An unresolved total cannot be copied as a numeric score.
4. **Teacher score and feedback:** manually grade even when evaluation is unavailable. Supply feedback, a private review note and inspection confirmation. Save creates a private draft and audit revision. Publish reviewed grade is a separate confirmation and rechecks current evidence. There is no automatic publication.
5. For a published grade, Unpublish protected grade for revision asks for a reason and confirmation, preserves score/feedback, and records an audit revision. Then enter a reopening reason in the Review section and choose Reopen evidence for student. Old approvals and drafts cannot be reused after reopening. A fresh student submission and approval are required.

Protected grades and evidence-revision guards remain enforced in the deployed V2 rules. A saved older approval with no verified contribution commits cannot be made eligible simply by relabeling a button; reopen, obtain a fresh submission and verify the student's work. A teacher can still manually grade approved evidence with a documented review. Matching Git author names or a full shared project do not establish individual credit.

The 4/20 screenshot does not establish a fair replacement score. This patch does not rewrite it. Repository access limits, target path configuration, contribution verification, missing provider setup and publication protection are distinct blockers; the workspace explains the applicable next step rather than silently enabling unsafe actions.

## Student workflow

- Project Hub / Assessments puts V2 commit selection before the expanded instructions and rubric. Older saved SHAs are restored even outside the first history page. Unavailable saved commits remain visible so they can be removed. Before approval, or after instructor reopening, selections can be changed and cleared locally; only resubmission persists the revised evidence. Withdrawal retains history and does not secretly replace selections.
- XML Layout Lab is linked from Code Playground and Practice Lab. Edit XML and observe the preview. Supported views include LinearLayout, basic FrameLayout/ConstraintLayout containers and common widgets, with dimensions, colors, spacing, orientation, weights, visibility and parent-edge constraints. Generated HTML/CSS can be inspected. XML drafts are per-account on the current device. No scripts, external entities, network resources or form submissions execute in the preview. It is not Android runtime emulation: sibling constraints/chains, resource resolution and full layout parity remain unsupported and are disclosed.
- Practice Lab shows 10 personal points for each unique completed mission. These are self-recorded learning progress, not school grades. Students register a linked practice class and optionally choose a class alias. Teachers independently review specific missions before recording trusted practice points. Class snapshots contain opted-in aliases and teacher-reviewed totals only; student clients cannot award reviewed points or publish standings. Private reflections are not published.
- Class standings are explicitly teacher-published snapshots, not a live public leaderboard. Opt-in changes apply to the next publication; a teacher must refresh prior snapshots when removal is requested. Multiple class memberships require choosing the active practice class. A failed cloud operation never becomes a fictitious saved score.

## Public patch history and notifications

`patch-history.json` is a curated public artifact, not a dump of commits, bug reports, student records or internal security notes. Each released version includes only version/date/title/summary and New, Updated, Fixed, Revised or Removed changes. Use Adminerva Auto Checker and other system feature names in public copy. Assistance provenance, provider consent and the teacher's responsibility remain disclosed in relevant evaluation and feedback details; do not misrepresent generated material as an instructor's unaided writing.

`patch-notes.html` is public and renders plain text. Every published version produces one stable release notification in each signed-in user's inbox, using the existing read/history controls. Notices refresh on sign-in, page visibility and a five-minute check while the page is open. This is in-app delivery, not email, SMS or background push to a closed browser. It does not require a new notification-fanout Function or mass writes to student accounts. Existing work is never force-reloaded.

At release, update the site manifest and the public patch entry together. Every new public entry must be reviewed for privacy and accuracy. A feature-branch preview of these files is not a production announcement; merge only after coordinated backend approval and successful checks. Earlier history is limited to releases independently verified here rather than invented retrospective dates.

## Backend and release approval

The new practice registration, reviewed-score audit and private class snapshot rules are **not deployed**. They require a separately approved rules activation and website release. The Firebase deployment session was revoked after the previous release; a fresh authorized sign-in is required before any later deployment. No service keys should be pasted into this chat.

I've set up prototype Security Rules to keep the data in Firestore safe. They are designed to be secure for owner-scoped practice preferences, instructor-only reviewed points, immutable point revisions and roster-private class snapshots. However, you should review and verify them before broadly sharing your app. If you'd like, I can help you harden these rules.

Class snapshots are teacher-controlled and row privacy is enforced by the curated publication code, not a claim that every arbitrary staff-written row has server-verified meaning. Review the scoped audit and use an owner-designated test roster before broad rollout. Functions remain unchanged. Deploying all Firebase resources is not part of this patch.

## Lesson connection

Saved lesson rows now link directly to their plan in Slide Editor. A key-free starter maps the selected session's objectives, competencies, learning activities and evaluation into editable slides, escaping text and excluding private remarks. Existing decks keep their source lesson version, and version drift is shown rather than auto-replacing slides. System-generated drafts still need explicit consent and teacher review. Saving and revision history remain explicit. See the separate roadmap for the larger visual course-editor proposal.
