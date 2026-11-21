> **Planning authority:** This document is retained as a technical specification, implementation note, migration reference, or historical plan. The canonical Adminerva product roadmap, development status and future priorities are maintained only in [Adminerva School OS — Master Development Plan](https://github.com/Adminerva-Org/Adminerva/blob/main/docs/adminerva-school-os-master-plan.md). Do not use this file as a competing roadmap or progress tracker.

# Administrator workflow development

### System administration

- Editing automatic maintenance requires a successful policy read. If another administrator saves first, refresh the current policy before editing it again.

- Suspended schools can be restored through the school registry with an explicit recovery reason. The server requires verified platform authority, the exact reviewed school revision, prior production authorization and an active school administrator. Recovery records an audit entry, preserves school policies and compatibility mode, and leaves individually suspended memberships suspended.
- School-specific owner forms reset when a school is selected. Policy decisions and governance assignment remain unavailable until the current school's read succeeds; responses from older selections cannot populate current forms. School selection is locked during an owner write. Global governance-role creation remains available independently of school-specific bindings.

### School administration

- Roster previews bind to the school selected before reading the CSV or fetching the configured Sheet. File changes, source changes and school changes invalidate obsolete previews; old successes and failures cannot replace the current review.
- Import commits capture the reviewed rows and digest and lock file/source controls until completion. A successful import remains marked as committed when a follow-up refresh fails. Failed commits require another preview before retrying.
- Sheet controls reflect saved configuration rather than unsaved URL text. Stale status reads cannot overwrite newly edited URLs. Duplicate supported CSV headers are rejected before calling the server.
- School switching clears person/access forms and class selectors, preventing copied IDs, invitation emails or staff search results from becoming another school's input.
- Enrollment review clears the previous student's number and placement before loading another applicant. Unsaved edits require a discard decision before replacement or school switching. Saves lock the enrollment controls and invalidate older reads; independent queue/registration refresh failures preserve available results.
- Class Record oversight keeps audit history tied to the selected class. An unavailable overview shows a dash for missing counts.

### Validation and delivery

Deploy the updated `platformSchools` backend before exposing the recovery action in the frontend.
