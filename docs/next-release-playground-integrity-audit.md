# Next release: Code Playground integrity and workflow audit

**Scope:** GitHub Pages static frontend on the current main branch (release 2.1.2). Changes are staged on a feature branch, not published.

## Confirmed defects repaired

| Priority | Workflow | Reproduction before fix | Repair |
|---|---|---|---|
| High | Code Studio > Database > SQL | `UPDATE students SET id=1 WHERE id=2` could produce two identical primary-key IDs. | Reject duplicate and NULL primary-key assignments for both INSERT and UPDATE. Validate before replacing rows. |
| High | Database > SQL | `INSERT INTO students (id,name) VALUES (1,'O''Reilly')` stored the doubled apostrophe rather than the intended value. | Parse SQL doubled-quote escaping; retain actual text. |
| High | Database > SQL | An invalid WHERE column silently selected no rows or could delete incorrectly. | Reject unknown column names and duplicate INSERT/UPDATE assignments; reject malformed duplicate CREATE columns. |
| High | Code Studio > Import ZIP (from project gallery) | Importing without an active project restored a local scratch workspace but did not create an accessible named project in the gallery. | Create and open a named project from the imported archive, retaining bundle metadata. |
| High | Code Studio > Import ZIP | Work files could be replaced before bundle size/schema/configuration validation finished, leaving incomplete imports when metadata failed. | Validate the resulting project and bundle before restoring the editor; reject oversized or duplicate archive paths. |
| High | Code Studio > Restore | If persistence failed after source models were replaced, the live editor could remain switched to the failed import. | Restore previous in-memory editor source after a failed restore. |
| High | Named-project cloud sync | Editing two projects rapidly could cancel the prior project's pending cloud save because both used one debounce timer. | Separate debounce timers per project and serialize writes for each project. |
| Medium | Named-project deletion | Pending cloud saves could re-create a project after it was deleted remotely. | Cancel pending timers, wait for in-flight writes, then delete the cloud record. |
| Medium | Project settings/reset | Project state was mutated before storage validation, leaving in-memory state different from persisted state if save failed. | Apply settings, template resets, and workspace edits through validated candidate snapshots. |
| Medium | Database row editor | Empty text values were silently converted to NULL. | Preserve empty strings as text; interpret empty numeric controls as NULL. |

## Cross-workflow safeguards

- Student and guest playgounds import the same shared project management and database code; both entry pages now reference the updated JavaScript versions.
- Firestore rules, backend functions, assessment evidence/grades and authorization routes are deliberately unchanged.
- The new SQL regression tests run in the existing quality workflow, alongside review, navigation, Firestore and student-workspace regression suites.
- Project bundle import remains a user-confirmed destructive action, with existing undo/recovery behavior preserved.

## Remaining risks / follow-up work

- Browser-only Java Swing runtime depends on third-party runtime and compiler availability. CI cannot guarantee these public external services on every device.
- Real Firebase account synchronization and interrupted network scenarios require hands-on authenticated browser testing, especially switching accounts and deleting or restoring cloud-backed projects.
- Multi-tab concurrent editing is not conflict-free; the current project cloud format uses last-writer-wins instead of a collaborative revision protocol.
- The Adminerva DB interface is an educational SQL simulator, not SQLite or a JDBC backend. Its supported SQL grammar remains intentionally limited.
- Accessibility, device-specific resizing, CDN failures, browser compatibility and complete role-specific content cannot be certified without representative end-to-end browser sessions.
- This is not a claim that the entire website is defect-free. The existing application-wide automated suites and targeted code review reduce known risk but do not cover every interaction.

## Suggested release process

Review this pull request, confirm the CI workflows pass, then include it with the next release manifest and publish when the remaining planned changes are ready. Do not advertise it as already deployed.
