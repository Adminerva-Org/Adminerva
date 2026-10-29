# Adminerva 3.0 site-wide failure-scenario register

This is a current-source risk register for the **single planned major release**. It is not a claim that every page has been tested or that production is bug-free. Implementation statuses refer only to the feature branch.

| Surface | What if? | Expected behavior | Current status |
|---|---|---|---|
| Authentication | User logs out or changes Google account while a request is pending | Abort account-scoped work and never persist a different user's data | Account-bound guards used on Studio submissions; other modules require live multi-role verification |
| Role navigation | Cached role says teacher but Firestore access is removed | No privileged data shown; role-specific route remains server-authorized | Existing auth-guard and Firestore roles preserved |
| Teacher assessments | Task is edited after students have received instructions | Deployed Studio rubric stays frozen; create new task for changed requirements | Studio V3 blocked in UI and rules; legacy tasks unchanged |
| Teacher assessments | Assignment is removed from a section after being published | Hide the task for that class and deny new submissions; retain historical evidence | Studio submission rules respect the active windows map |
| Student assignments | Network fails while reading submission status | Show status unavailable rather than falsely reporting not submitted | Studio UI revised; live browser verification pending |
| Student submissions | Browser clock wrong, form stale, deadline changed | Server time decides; failed submission keeps work | Studio schedule guards implemented |
| Student submissions | Double-click or two tabs retry the same project | Avoid duplicate unchanged snapshot; transaction advances revision without overwriting old one | Transaction and hash-duplicate guard implemented |
| Student submissions | Student edits or deletes working project after submitting | Teacher views the original immutable snapshot | Version storage implemented |
| Student submissions | Teacher requests improvements after reviewing | Original version stays available, resubmission allowed only before deadline | Studio review/resubmission workflow implemented |
| Gradebook | Teacher publishes a grade for an outdated Studio revision | Block publication until reviewed revision matches | Studio rules and grade verifier implemented |
| Gradebook | Teacher edits a published grade without unpublishing | Reject mutation and preserve published evidence | Studio rules implemented |
| Repository evidence | Student's commit was pushed under another account | Attribution reclaim audit and teacher verification; no automatic credit from claim alone | Existing V2 workflow preserved; authenticated live regression needed |
| External evaluations | Malformed JSON or partial rubric scores are imported | Reject incompatible score and preserve draft | Existing validator; live regression needed |
| Code execution | Compiler busy/429, timeout, invalid Java entry point | Show explicit failure or fallback, preserve project | Existing timeout and consolidated PR #98 Java entry fixes; external service not guaranteed |
| Code execution | Browser loses internet mid-run | Explain run status uncertainty and keep local code | Existing cancel/recovery; device testing pending |
| Code projects | LocalStorage quota reached on save | Warn, retain in-memory editor and offer ZIP export | Consolidated PR #97 and #98 safeguards; device testing pending |
| Code projects | User switches projects while cloud sync pending | Preserve each project's queued save independently | PR #97 per-project autosave consolidated |
| Code projects | Cloud delete races with pending write | Cancel scheduled writes, wait for in-flight work, then delete | PR #97 protection consolidated |
| Code projects | Malicious or oversized ZIP import | Reject before mutating files; support recovery | PR #98 import validation consolidated |
| Database | Duplicate PK or destructive invalid WHERE | Reject malformed SQL without partial corruption | PR #98 SQL integrity checks consolidated |
| Database | Project-scoped SQL mistaken for real SQLite/JDBC | Label tool as an educational simulator, not an external database server | Existing UI disclaimer retained |
| Teacher inbox | Submission belongs to a different section | Deny inspection and grading | Studio section-scoped read rules implemented |
| School administration | Staff assignment is revoked during an operation | Write must re-check live access on server | Existing role rules; live testing pending |
| Notifications | Destination is no longer accessible | Route through role-aware allowlist; don't expose restricted records | Existing destination guard extended for Studio inbox |
| Classroom analytics | Missing data returns misleading zero | Distinguish unavailable from zero and provide retry | Existing partial coverage; deeper browser audit pending |
| UI on mobile | Modal extends beyond viewport or editor splitter is too small | Accessible scroll area and reachable controls | Responsive base styles; mobile device verification pending |

## Release cutover requirements
- **Single version:** Adminerva 3.0.0 is the intended next production release; no intermediate 2.1.3 deployment.
- **Source integration:** consolidate Code Studio reliability PRs #97 and #98 and Studio/assessment PR #99 into one reviewed source branch; resolve overlapping changes before merging.
- **Security deployment is required.** New Studio submissions use Firestore security rules. GitHub Pages-only deployment is insufficient; rules must be deployed to the correct Firebase project before enabling the new interface.
- **Data migrations:** no destructive migration of legacy GitHub assessments, student projects, or grades. New Studio assessments are V3. Older records remain on their existing workflow.
- **Operational checks:** verify a real student, class-scoped teacher and admin account; frozen snapshots, deadlines, resubmissions, grade publication and source-revocation checks.
- **Rollback:** disabling the Studio UI must not delete frozen submission data or downgrade security rules to permit unauthorized access. Back up Firestore configuration before changing production rules.

## Known limitations
- Studio submissions are individual. Group Studio submissions and GitHub/Studio **either-source per assessment** require a future explicit design, not silent coercion into GitHub evidence.
- Studio evaluations currently use teacher-reviewed manual rubric scores, not a proven sandboxed teacher-side compiler for submitted snapshots.
- Very large projects exceed the conservative Firestore snapshot budget and must be reduced or exported. A separate object-storage backend is needed for unrestricted artifacts.
- Collaborative editing conflict resolution across browsers remains outside the current single-owner project model.
- Legacy pages and workflows not listed as implemented remain unverified. Do not certify the entire site as bug-free.
