# RepoReview Assessment V2 — implementation and rollout

## Scope and compatibility

RepoReview, Lesson Review and Admin Hub remain independent main modules. RepoReview now supports an opt-in Version 2 blueprint for **new** assessments. Older assessments, receipts in `student_submissions`, grades in `student_grades`, and activity grades in `activity_grades` are not migrated.

New V2 teacher-only `systemPersona` and `rules` are stored in `assessment_private/{assessmentId}`; legacy blueprints preserve their original shape.

**Do not create or deploy Q3 Mini PETA 1 until Firebase rules/functions are deployed and role-based smoke tests pass.**

## New data records

- `assessments/{assessmentId}`: new `schemaVersion: 2`, `evidenceMode: "commit_selection"`, `checkpointMode: "individual"`. Legacy assessments remain unversioned.
- `assessment_evidence/{studentId}_{assessmentId}`: selected full Git SHAs, a selected checkpoint SHA, student's own repo, and server-recorded evidence submission time. Teachers may discover historical evidence with `source: "teacher_discovered"` and `status: "needs_review"`, which is **not** a student submission.
- `commit_reclaims/{sha}_{studentId}`: proposed correction to detected Git author attribution. No automatic reassignment. Students may withdraw a pending reclaim; administrators decide via a separately stored `commit_claim_decisions` audit entry.
- `commit_claim_conflicts/{sha}`: aggregate of overlapping active reclaim requests, maintained by Cloud Functions.
- `student_grades/{studentId}_{taskId}`: teacher manual grading is allowed for V2 only after checkpoint approval; store the approved graded SHA. Existing grading and publication safeguards remain.

## Staff workflow

1. Create a **new** V2 blueprint in Assessment Studio; configure correct sections, dates, task context and student-visible rubric.
2. For existing classroom assignments, open RepoReview → Assessment Evidence and **discover historical commits** when students only pushed to GitHub. This is proposed evidence without a certified original push date.
3. For student-selected submissions, open Submission Inbox → Review selected evidence.
4. Inspect each selected Git diff and checkpoint; verify selected SHAs occur in the checkpoint's ancestry. Resolve pending reclaim requests with the administrator.
5. Approve the student's checkpoint with a substantive teacher note.
6. Grade manually in RepoFetch (published grades remain protected); Gradebook shows the pinned SHA. V2 auto-check is intentionally paused until it can inspect the approved revision rather than mutable repository HEAD.

## Student workflow

Project Hub → Assignments → V2 assessment → Commit Evidence Selection → preview file diffs → select up to 20 commits → choose a project checkpoint from that set → submit. Each resubmission receives a **new server timestamp**. Student may request a Reclaim Commit for incorrectly attributed work. Detection is not automatic proof of authorship. Instructor-discovered evidence is displayed but cannot be silently edited by the student.

## Deployment checklist

- GitHub PR tests (JavaScript regressions, Firebase rules emulator, CodeQL) must pass.
- Deploy backend permissions and notifications from an authorized Firebase CLI session:
  `firebase deploy --only firestore:rules,functions`.
- Verify as an actual student that another student's evidence, claims, private grading configuration and grades are not readable.
- Verify as a teacher that the real section's V2 blueprint can be viewed, that missing student submission leads to historical discovery, and that approved checkpoints permit manual grading.
- Verify as an administrator that reclaim conflicts notify the correct account and decisions create audit entries.
- Do not classify Git author timestamps as verified push-before-deadline evidence.
- Do not mark the backend as deployed or the live site as validated until checked separately.

## First assessment configuration (not created)

Q3 Mini PETA 1 — Mobile App UI Prototype; type Mini PETA; max score 20; original classroom assignment October 9, 2026; extended deadline October 23, 2026 (11:59 PM Asia/Manila). The supplied class presentation has three required screens, Android XML UI focus, and four five-point rubric criteria. Do not require Java backend, Firebase, arrays, or complete CRUD.

## Remaining approved phases

- Phase 2: checkpoint-aware automated rubric suggestions that inspect **approved** project versions; more complete teacher review-to-grading deep links and legacy workflow consolidation.
- Phase 3: teacher-authoritative individual contribution handling including more robust verified GitHub identity association, shared contributions, alternate branches, and authorized private repositories.
- Phase 4: Project Evolution Timeline in RepoBank and student Project Hub, using approved checkpoints and published feedback, not unreviewed claims.
- Phase 5: final RepoReview submodule navigation grouping and accessible mobile QA; preserve the Lesson Review and Admin Hub main-module boundaries.
- Operational: retention/archival policy, further history coverage beyond the first five bounded 100-commit pages per view, GitHub rate-limit handling, strict server verification of GitHub revisions before automatic scoring, and production rollout.

Approval to build features does **not** constitute approval to auto-publish grades or migrate legacy records.

## Recent history-recovery improvement

Student V2 commit selection and teacher historical discovery can load up to five pages (500 GitHub commits). Existing selections and the chosen checkpoint remain stable while older pages load. Review is rate-limited and only considers verified SHA strings. This does **not** certify original push times, Git identity or ownership, and does not replace the requirement to inspect evidence before checkpoint approval. The page count is a client-side discovery limit, not a retention guarantee; GitHub may return fewer commits or temporarily reject requests.
