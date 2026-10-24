# Adminerva 1.3.10 release candidate

This release finishes the first round of Code Playground organization improvements without expanding the teacher workspace model again.

## Included in 1.3.10

- Project Explorer supports manual sibling ordering for files and folders.
- Dragging over a sibling shows an insertion line so the student can see whether the item will be placed before or after it.
- Existing folder-drop behavior remains available for moving items into another directory or back to the project root.
- Cloud versions can be named when they are created.
- Cloud versions can be pinned or unpinned; pinned versions are shown first in the version manager.
- Existing Restore, Rename and Delete actions remain available.

## Pending for a later release

- Cloud version duplication, bulk cleanup and retention policies.
- More advanced project ordering such as mixed file/folder interleaving if classroom use shows that it is needed.
- Subject-specific teacher workspace taxonomy and cross-subject permissions when additional departments are onboarded.

## Release handling

The public release manifest remains on 1.3.9 until 1.3.10 is deployed. The Pin/Unpin action requires the matching Firestore rules deployment.
