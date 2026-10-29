# Next-release audit: Code Studio and connected workflows

**Candidate:** Adminerva 2.1.3 · **Status:** prepared in a pull request; not deployed.

## Findings and code changes

| Severity | Defect / regression risk | Resolution |
| --- | --- | --- |
| High | Import Project ZIP on the Code Studio home screen tried to restore an unopened editor instead of creating a project. | Create a new named project on home import; preserve existing-project imports with a recoverable undo snapshot. |
| High | Bundle metadata validation ran after source files had already been replaced. A bad bundle could leave source and database metadata out of sync. | Validate the entire imported workspace, metadata, capacity and database structure before replacing project state. |
| High | SQL UPDATE allowed a primary key to collide with another row; the visual editor could then edit/delete multiple rows through a non-unique key. | Make updates atomic, enforce primary-key uniqueness/non-null, and refuse ambiguous visual edits/deletions in older projects. |
| Medium | Database form escaped apostrophes as SQL-standard doubled quotes, but the SQL learning engine stored the doubled apostrophe literally. | Decode quoted SQL strings correctly; preserve legacy backslash escaping. |
| Medium | Unknown WHERE columns silently matched no rows; duplicate CREATE/INSERT columns and prototype-like table names were accepted or mishandled. | Fail with specific errors before persisting changes. |
| Medium | Multi-file Java projects could try to run whichever Java class was open, even if it had no main method. | Choose the current runnable Java class, then another actual main class, before falling back to a generic filename. |
| Medium | A failure to store Code Studio run history could overwrite the console output of an otherwise successful execution. | Keep execution results intact and report run-history storage failures separately. |
| Medium | Repeated or excessively large ZIP entries could overwrite files or consume excessive space. | Reject duplicate paths and check extracted-size hints, file counts and project limits. |

## Workflow and regression boundaries

- **Student + guest Code Studio:** Shared editor script, ZIP loading, project/home navigation, file storage, Java entry resolution, and database tools are included in this patch.
- **Student Practice Lab:** The temporary practice-workspace path remains separated from named projects. Import controls are disabled during practice mode.
- **Review & Grade and reclaim:** No assessment evidence, claim ownership, permission, grading or release rules were changed. These continue under existing CI coverage.
- **Teacher/admin:** Current Firestore security and review modules are unchanged, reducing the risk of unintended authorization or grading changes.
- **Cloud projects:** The existing project-specific cloud path and local fallback remain unchanged; offline or concurrent-device sync needs real-account verification.

## Important remaining deployment validation

Automated source tests cannot prove a live browser's access to external services or the correctness of school records. Before describing the website as fully verified, perform representative authenticated student, teacher, administrator and guest smoke sessions. In Code Studio, cover import from project home, import over an existing project/undo, Java multi-file execution, SQL primary-key edits, cloud reload, and browser-storage quota failures. Confirm separately that the external Judge0 compiler and CheerpJ desktop service respond from student devices. This audit does **not** certify the entire website as bug-free.
