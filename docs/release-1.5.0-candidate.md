# Adminerva 1.5.0 — release candidate (NOT YET PUBLISHED)

**Prepared:** October 27, 2026 (Asia/Manila)  
**Last recorded public release:** 1.4.3 (October 25, 2026)  
**Public release commit:** `1a5792c720e9eec118da5ed54d97ad885779b36e`  
**Unreleased website baseline:** `main` at `5cadc7f4041f8b81e59b2c96474a9e59a358cbc8`  
**Candidate:** PR #94 (`fix/evidence-reopen-reclaim-20261026`) plus the intervening 18 commits already merged to `main`.

## Summary for the school community

This release streamlines assessment evidence and class grading, improves evaluation of large repositories, restores dependable lesson printing, and makes evidence correction and attribution review easier to use.

### Teacher and administrator workflows
- **Single Assessment / Gradebook:** Review and reopen eligible evidence for the selected assessment and section in one batch. Published grades are protected; already reopened and missing records are not reopened again.
- **Bulk approval:** Refresh from current Firestore server state, include successfully resubmitted evidence, recheck individual checkpoint ancestry and linked GitHub identity; identify exceptions without stopping the whole class.
- **Commit reclaim queue:** See pending requests in the selected section and assessment. Teachers may inspect; authorized administrators record audited Approve, Shared or Reject decisions. Pending claims block evidence approval until resolved.
- **Evaluation and publication:** Clean system evaluations are stored as **unpublished grades** without redundant private suggestions; genuinely flagged evaluations retain private review suggestions. Historical clean private drafts can be published through existing controlled actions.
- **Adaptive contribution review:** Larger commit histories, long diffs, original-commit credit and renamed/removed source paths are handled without treating shared team code as verified individual work.
- **External evaluation:** Copy a structured assessment package for outside review and import validated responses; do not overwrite approved teacher scores and comments.
- **Missing-evidence reminders:** Copy a class-chat-ready reminder for students with no independently verifiable contribution evidence.

### Student workflows
- **Evidence revision:** After instructor reopening, directly change selected commits and resubmit. When GitHub confirms a newer project checkpoint contains the selection, the student may confirm advancing it. No withdrawal is required.
- **Attribution request:** A visible inline reclaim form explains mismatched/shared GitHub authorship; clear save errors and pending decision status replace browser prompts.
- **Simpler assessments:** More compact assignment cards, step-by-step evidence selection, selected-commit counts, commit filters and progressive-disclosure previews. Withdrawal remains under a secondary cancellation action for erroneous submissions.

### Planning and platform clarity
- Restored the prior stable legacy browser print behavior and improved lesson-session pagination, border placement and continuation rules.
- Updated legacy timetable compatibility and lesson-export behavior without silently migrating existing teacher content.
- Release alerts and What's New history adapt to the viewer's role. Previously released mobile, branding and consent controls remain intact.

## Critical boundaries
- A **project checkpoint** is group context, not individual contribution proof.
- Approval of a **reclaim** clears an attribution dispute; it is not evidence approval or a score. Bulk approval still does **not** automatically give individual credit for a nonmatching GitHub login merely because a reclaim was accepted. The teacher must verify such contributions individually.
- Evidence approval does not publish a grade, prove code compilation/runtime, or assert an actual push timestamp.
- Existing published grades and assessment audit histories must remain unchanged by release itself. No automatic grade publication or data migration.
- PR #87 is an older conflicting grading-draft proposal; its clean-versus-flagged suggestion behavior and clearer publication labels are integrated into this candidate instead of merging the stale PR.

## Release readiness and sequencing

1. Verify that PR #94's final head (including this candidate note) passes the targeted JavaScript, Firestore-emulator, CodeQL and source-validation checks; optional browser smoke validation uses only emulator accounts.
2. Firestore rules must be released to **reporeview-e7ca4** first from this exact candidate, through an authorized Firebase session. The current GitHub Firebase backend workflow also deploys Functions and indexes; do not mistake it for a rules-only deployment.
3. Merge the validated PR into `main`, allow GitHub Pages to publish, then reload existing browsers.
4. Confirm student direct resubmission, pending reclaim creation and administrator decision, Gradebook refresh/bulk approval, and published-grade protection with designated test records.
5. **Only after deployment confirmation**, publish version 1.5.0 in `patch-history.json` (`public:true`, `status:"published"`, real `publishedAt`) and advance `site-release.json` with its actual publication timestamp; verify the Pages release. An administrator's push announcement is a separate, opt-in step.

## Verification recorded during preparation
- The last Pages deployment observed before this release was a successful GitHub Pages run on `main` SHA `5cadc7f4041f` (run 40237559108).
- The latest observed successful Firebase backend deployment was run 40205064677 on SHA `95c5f18e8fc0` on October 25, **before** the new PR #94 Firestore rules. Production rules version cannot be confirmed from GitHub workflow history alone.
- PR #94 quality, CodeQL and release-source checks passed at head `a7352122772ddf0ea7f558de2106404bc271a435`; recheck at the final head after consolidation. No live Firebase deployment or browser test is established by these checks.
