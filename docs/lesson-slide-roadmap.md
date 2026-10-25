# Lesson-to-slide and course-editor roadmap

## Current integration and this patch

Lesson Planner saves structured weekly plans and sessions in `lesson_plans`, with revision history. Slide Editor selects a saved plan/session and stores editable decks in `presentations` under a plan/session identity, also with versions. Before this patch the link depended on finding the same plan manually, external generation was the primary transfer, and lesson-source version was not retained.

This patch adds a direct saved-plan link, a deterministic key-free lesson starter, source-version metadata and a drift warning. The Slide Navigator also supports direct thumbnail drag/reorder with an insertion indicator and deck-level Undo/Redo for structural changes; Quill retains its own text history. It does not silently synchronize revised lesson content into a teacher's edited slides. Private teacher remarks are not copied into the learner-facing starter. The full saved lesson remains a teacher-only source, not an automatically published student course.

## Proposed next increments

### 1. A visual slide workspace

- A single three-column workspace: lesson outline / slide thumbnails; selected slide canvas; contextual properties.
- Native blocks for title, text, image, code, diagram placeholder and comparison columns. Keep the existing sanitized text editor inside text blocks rather than replacing it immediately.
- Drag-to-reorder slides, duplicate/delete, visible unsaved state and structural undo/redo are now present. Remaining visual-workspace work is richer block authoring plus explicit contrast checks before export; overflow protection already blocks unsafe text growth.
- Theme tokens, reusable layouts and an asset picker with alt text and attribution. Uploads need size/type validation and an explicitly approved storage policy.
- Pin each deck to a saved lesson revision. Show an objective/activity coverage checklist and a before/after lesson diff; selectively import changed blocks only after teacher acceptance. Never overwrite a whole edited deck on a lesson save.

### 2. A teacher-published course builder

- Arrange sections containing a lesson, slide deck, practice activity and checkpoint quiz. Support preview-as-student before publication.
- Separate draft, review-ready, published and archived states. A published course points to immutable lesson/deck revisions; editing creates a new draft.
- Map objectives to slide/activity IDs. Track completion separately from teacher-reviewed performance. Practice participation points must not silently become assessment grades.
- Start with individual assignments and private class aggregates. Offer alias-only opt-in standings; avoid making student names, reflections or repository evidence public.

### 3. Advanced authoring, only after the core workflow is stable

- Flexible canvas positioning, grouping, alignment guides, multi-select and responsive previews. Use a structured block model with sanitized rendering instead of arbitrary executable HTML.
- Teacher comments and review requests, rubric-linked checkpoints, and accessible student-facing navigation.
- Consider concurrent editing only after conflict detection, ownership, revision audit, recovery and publication permissions are designed and tested. This is a separate architectural change, not a cosmetic toolbar addition.

## Boundaries and acceptance criteria

This is a product proposal inspired by visual design and course-authoring workflows, not a claim to reproduce another platform. No new third-party service, deployment or student-facing course publication is authorized by the proposal.

An increment is ready only when teacher text cannot be overwritten by late asynchronous responses, lesson/session switches protect unsaved work, published revisions remain recoverable, student previews cannot read teacher-only source, exports preserve layout, and keyboard/mobile workflows pass realistic tests. Source generation may assist drafting, but final teacher review and appropriate origin disclosure remain required.
