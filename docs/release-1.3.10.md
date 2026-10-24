# Adminerva 1.3.10 release candidate

This release finishes the first round of Code Playground organization improvements without expanding the teacher workspace model again.

## Included in 1.3.10

- Project Explorer supports manual ordering for files and folders, including mixed file/folder placement within the same directory.
- Dragging over a sibling shows an insertion line so the student can see whether the item will be placed before or after it.
- Explorer order persists across local drafts, cloud versions, practice scratch work, restores, and shared snapshots.
- Existing folder-drop behavior remains available for moving items into another directory or back to the project root.
- Cloud versions can be named when they are created.
- Cloud versions can be pinned or unpinned; pinned versions are shown first in the version manager.
- Versions can be duplicated without changing the original.
- Clean up keeps the newest 10 unpinned versions plus every pinned version and deletes older unpinned copies only after confirmation.
- Existing Restore, Rename and Delete actions remain available.

## Pending for a later release

- Automatic time-based cloud retention is intentionally not enabled; cleanup stays user-confirmed to avoid deleting student checkpoints unexpectedly.
- Subject-specific teacher workspace taxonomy and cross-subject permissions when additional departments are onboarded.

## Release handling

The public release manifest remains on 1.3.9 until 1.3.10 is deployed. The Pin/Unpin action requires the matching Firestore rules deployment.
