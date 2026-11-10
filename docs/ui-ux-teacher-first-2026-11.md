# Adminerva UI/UX and loading optimization — Teacher-first pass

## Scope
This development branch improves the teacher's review-and-grade workflow first, then the teacher dashboard and lesson-planning tools. It also improves first paint on administrator, student, and platform-owner home routes. The existing evidence, grade approval, publication, and school-access data models remain unchanged.

## Implemented
- **Review & Grade (`repofetch.html`)**: condensed review context and related tools; workflow steps; inline queue progress, status and skeleton; more legible active target; existing manual grading controls preserved.
- **Faster review load**: the hidden legacy repository investigation no longer triggers a redundant full `students` collection read on normal visits. V2 still retrieves authoritative server evidence and the grade data it needs.
- **Teacher home**: primary review/lesson actions and organized quick links to schedule, slides, Studio submissions, analytics, contribution requests and support.
- **Optional teacher home pulse**: recent evidence counts now load after initial navigation; they do not block the home interface.
- **Lesson planner**: compact configuration headers, retained saved-plan workflows and removal of an unused synchronous DOCX conversion dependency. Print and Google Docs export remain.
- **Slide editor**: fixed overlapping history/archive controls; more compact navigator/editor proportions; on-demand download of JSZip and PptxGenJS only when PowerPoint export is requested; Quill/KaTeX remain available for actual editing.
- **Teacher schedule**: scrollable week grid with pinned headings/time column, edit-only deletion column hidden while reading, responsive controls and visible initial timetable status.
- **Shared navigation**: reserve header height before role-aware navigation mounts; limited same-origin HTML prefetch on hover/focus, skipping routes with query parameters and metered 2G connections.
- **Loading presentation**: suppress the automatic short-lived “Opening page…” logo toast while preserving loader feedback for actual work; auth-safe structural placeholder on teacher/student/admin/owner home pages.
- **School administration home**: prioritize overview counts, V4 pilot controls and grouped operations; all previous destination routes retained.
- **Other homes**: structural first paint for student and owner landing routes, and connection hints on the public landing page.

## Explicitly unchanged
- No migrations, privilege changes, automatic grade publication or evidence approval.
- No new external services, Firebase Cloud Functions or Firestore schema changes.
- No copying of private school records to browser storage.
- The Pilot Sandbox work is a separate development branch/PR.

## Deployment considerations
This branch has not been merged or deployed. External Tailwind runtime is still used for the public/static pages; replacing it across every route with a compiled CSS build remains a separate performance project requiring an inventory of dynamic classes and actual browser verification. No measured load-time speedup is claimed without browser metrics. Design changes were prepared from repository source and the supplied screenshots; interactions should be reviewed in a browser before broad release.

## Next UX targets
After this teacher-first pass, prioritize user-directory administration tables, the student evidence-selection experience, Studio navigation, and page-level data waterfalls. Preserve audit trails and explicit publication approval while reducing the number of loading overlays.
