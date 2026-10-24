# Adminerva 1.3.9 release candidate

This release keeps Staff Home, Lesson Planning, and Repository Management as distinct workspaces while improving the Submission Inbox and Code Playground.

## Included in 1.3.9

- Rename Educator Hub to **Repository Management** and remove Staff Home / Lesson Planning duplication from its local navigation.
- Keep **Lesson Planning** as its own workspace with lesson, slide, schedule, and reference tools.
- Add a derived **Graded** Submission Inbox state when a grade record exists; evidence lifecycle states remain unchanged.
- Allow Project Explorer files and folders to be dragged into folders or back to the project root, with a visible drop highlight.
- Allow students to rename and explicitly delete their own cloud versions while keeping saved source contents immutable.
- Reduce the shared website header height to recover workspace space.

## Pending for a later release

- Arbitrary sibling ordering in the Project Explorer. The 1.3.9 drag/drop behavior moves files and folders between directories; tree ordering remains deterministic rather than manually sortable.
- Advanced cloud-history actions such as naming at save time, pinning, duplication, bulk cleanup, or retention policies.
- Subject-specific staff workspace taxonomy once additional departments are onboarded. Repository Management is intentionally subject-neutral, but no new cross-subject permission or curriculum model is introduced here.

## Release handling

The public release manifest remains on 1.3.8 until 1.3.9 is actually deployed. Cloud version rename/delete requires the matching Firestore rules deployment in addition to the frontend.
