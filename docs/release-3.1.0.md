# Adminerva 3.1.0 — Classroom reliability and interface improvements

Published November 11, 2026 (Asia/Manila). This is the **cumulative public maintenance release since v3.0.0 (October 30, 2026)**. Earlier hotfixes were shipped as source updates without separate public release entries; they are consolidated here rather than recorded as fictitious earlier releases.

## For teachers
- **Evidence and attribution:** Restored authorized Gradebook and Review & Grade reads, including approved original-repository commits, amended evidence and previously mismatched identities. Teacher attribution is explicitly reviewed; accepted reclaim requests do not independently establish authorship or a score.
- **Reopened submissions:** Returning evidence to a learner and reviewing the selected additional commits/checkpoint now has clearer states. The student must keep GitHub connected and the teacher must verify revised evidence before grading.
- **System evaluation:** Bulk evaluation is available for eligible approved submissions; permission failures, incomplete contexts and exceptions no longer silently block unrelated eligible learners.
- **External evaluation:** Prepare and validate structured external grading packages. Imported results remain subject to teacher review, and saving an evaluation does not publish a grade.
- **Grade publication:** Explicitly approve a completed evaluation and publish when ready. Unapproved evaluations remain private; protected grade revisions and audit records are unchanged.
- **Larger assessments:** The former 40-file-path save limit no longer blocks unpublished grading records. Long file lists remain eligible for saving.
- **Feedback:** Structured accomplishments, score-affecting issues and recommended improvements have clearer formatting.
- **Daily workflow:** Review & Grade, Studio submissions, Gradebook, planning, schedule, slides and teacher analytics use clearer controls, accessible navigation, better responsive layouts and inline progress.
- **Lesson generation:** An optional external-AI handoff generates a structured package for teacher-controlled use in another service. Verify all generated lessons, and follow school policy before sharing data outside Adminerva.

## For students
- **My Assignments and commit evidence:** Larger selection targets, clearer task and checkpoint summaries, keyboard-compatible controls and better mobile presentation.
- **Revision and resubmission:** Reopened submissions provide a more reliable path back to selecting commits, reviewing them and resubmitting.
- **Project Hub:** Show recently cached GitHub activity first, allow explicit refresh and surface connection failures without claiming that saved results are current.
- **Adminerva Studio:** Improved mobile drawers, code-editor precision controls, responsive toolbars, terminal input and reliable ZIP/project operations.

## For administrators
- **People and access:** Clearer staff assignments, responsive directory navigation and more efficient panel loading.
- **GitHub verification:** Repository availability checks are deliberate and limited to visible entries. Merely viewing the roster no longer rewrites a learner's stored GitHub repository URL.
- **Reporting and class analytics:** Improved scoped repository summary requests and warnings when records are unavailable, without misrepresenting missing cache data as student inactivity.

## Shared performance and accessibility
- The interface exposes page structure while authorization resolves; action-specific loaders remain available without stacking duplicate overlays.
- School navigation and selected workspace panels load more selectively; limited same-origin HTML prefetching supports intentional navigation.
- The slide editor delays PowerPoint download dependencies until export is actually requested.
- No claims about exact load-time speedups are made without production timing measurements.

## Boundaries
- **No automatic grade publication, assessment score changes, migration or roster rewrite** occurs as part of this release.
- A group repository checkpoint is not proof of every learner's substantive contribution.
- Teachers remain responsible for the final score and the decision to publish; automated and external evaluation outputs are drafts until approved.
- School administrators control permitted access and any external data sharing.
- Development work on the next major platform version is excluded from this public release and continues separately.

## Delivery
- UI/UX merge: [PR #138](https://github.com/Adminerva-Org/Adminerva/pull/138).
- Other relevant maintenance work was merged to `main` after the public v3.0.0 baseline, including Gradebook evaluation fixes, teacher feedback presentation, evidence resubmission, and Studio mobile improvements.
- The public release record is stored in `patch-history.json` and `site-release.json`. Account What's New entries use those records; device push announcements are separate and are **not** automatically sent.
