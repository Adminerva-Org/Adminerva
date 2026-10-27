# Adminerva 1.5.0 — Assessment evidence and class review

Published October 27, 2026 (Asia/Manila). Cumulative release since public v1.4.3 (October 25, 2026).

## Highlights

- **Student evidence:** Students may revise selected commits and resubmit after instructor reopening, without withdrawing. Checkpoint changes are accepted only after verified Git ancestry.
- **Commit reclaim requests:** A student can submit an inline attribution explanation. Teachers can inspect section-scoped requests; administrators can record approved, shared, or rejected decisions with immutable audit.
- **Section-wide class review:** Teachers can reopen and approve eligible evidence in batches and inspect per-learner exceptions without overwriting published grades.
- **Grading and evaluation:** Clean evaluation results are stored as unpublished grades ready for existing publication controls; flagged results retain instructor review. Adaptive verification handles larger commit histories, oversized patches, merge context and renamed source paths.
- **External evaluation and reminders:** Teachers can export a structured evaluation package, import validated responses, and copy missing-evidence reminders for class group chats.
- **Student experience:** Compact assignments, guided commit selection, selection counts, commit filters, expandable previews and secondary withdrawal controls.
- **Lesson Planner:** Restored stable legacy print behavior and timetable compatibility, including clearer continuation formatting.
- **Release information:** Role-appropriate What's New entries and release announcements.

## Safeguards and limitations

Individual-credit attribution remains separate from a project's checkpoint. A resolved reclaim is **not** automatic evidence approval, verified authorship, or a grade. Contributions with a mismatched GitHub login must still be individually verified by the instructor. No automatic grade publication, live code compilation claim, or historical data migration is part of this release. Existing published grades and audit revisions remain protected.

## Deployment record

- Candidate: [PR #94](https://github.com/Adminerva-Org/Adminerva/pull/94), merged as `c3e5b71f2a11d916c942549e7d7b24f29d0ca639`.
- Rules-only deployment: [GitHub Actions run 40497759428](https://github.com/Adminerva-Org/Adminerva/actions/runs/40497759428), successful for `reporeview-e7ca4` before merge.
- Website: [GitHub Pages run 40498083275](https://github.com/Adminerva-Org/Adminerva/actions/runs/40498083275), successful after merge.
- Firebase production backend: [GitHub Actions run 40498084015](https://github.com/Adminerva-Org/Adminerva/actions/runs/40498084015), successful after merge.

Publication of this release record is a separate metadata update; it does not automatically issue a device-push announcement.
