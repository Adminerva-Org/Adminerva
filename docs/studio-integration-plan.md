# Adminerva 3.0 — Studio integration, failure scenarios and release acceptance

Status: **work in progress**, not a deployed or certified production release. Current production site remains on 2.1.2. Integrate and reconcile overlapping Code Studio reliability PRs #97 and #98 before release.

## Design contract
- **One assessment catalogue, one rubric and one Gradebook.** New Studio assignments use `schemaVersion:3`, `submissionSource:studio`; existing repository assessments remain V2.
- **No mutable grading evidence.** Students submit a complete, bounded serialized snapshot plus SHA-256 digest. A numbered version record cannot be modified or deleted; a pointer identifies the current revision.
- **One protected grade path.** Teachers inspect the exact submission, save a draft in `student_grades`, and publish deliberately in the existing Gradebook. Published grades cannot be silently replaced.
- **No GitHub dependency for Studio.** Students need a verified school account and assigned class; guest projects and Practice Lab scratch sessions are not eligible.
- **Existing data unaffected.** Old project IDs, local save keys, repository evidence, grades and URLs are not renamed or migrated.

## What-if matrix

| Scenario | Expected system response | Enforcement |
|---|---|---|
| Student clicks submit with no named project | Explain that a project must be opened and saved | Studio UI and snapshot validator |
| Student in guest/practice mode | Refuse assessment submission without affecting scratch files | Studio capture guard |
| Project files contain path traversal or invalid file order | Reject without creating a submission | Snapshot validator |
| Project exceeds submission size | Reject, keep edits and offer ZIP export as recovery | Snapshot limit; Firestore document bound |
| Assignment not deployed to student's section | No eligible assignment; reject forged submission | Student task filtering and Firestore rules |
| Assignment not open / past deadline | Explain schedule; server rejects late write even if browser clock is wrong | UI + server-timestamp deployment windows |
| Two tabs submit simultaneously | Transaction re-reads latest revision; no overwrite of frozen prior version | Revision transaction and immutable version rules |
| Network interruption after submit click | Do not claim success; ask to refresh submission status before retry | UI uncertainty state |
| Student edits source after submission | Prior revision stays intact; teacher sees submitted snapshot | Versioned JSON snapshot |
| Student resubmits during review | Only if status allows; reviewed work cannot be replaced | Transaction status checks and server rules |
| Student resubmits after grade published | Permission denied; teacher must unpublish and explicitly reopen | Grade publication guard and revision rule |
| Teacher opens old revision while another teacher reviews | Refuse stale review transaction, reload latest | Revision and status checks |
| Stored snapshot altered or corrupted | Block grading and show checksum mismatch | Inspector checksum verification |
| Teacher requests revision | Student sees status and note; existing frozen version preserved | Staff review state and new student revision |
| Teacher saves grade | Private draft only; matching reviewed snapshot and rubric score bounds required | Transaction + grade security rules |
| Student resubmits while grade remains unpublished | Old grade no longer eligible for publication | Gradebook compares current Studio revision |
| Teacher publishes outdated grade | Block publication and ask to reopen Studio review | Publication verifier and Firestore grade rules |
| Teacher edits published grade | Require unpublish first; do not mutate published score/feedback | Firestore protected-grade rule |
| Teacher only authorized for another class | Cannot list or grade this submission | Section-scoped queries and Firestore access rules |
| Student impersonates another student or uses forged uid | Rules compare authenticated owner and verified student record | Student ownership rules |
| Legacy repository-based assignment is opened | Existing GitHub evidence and grade lifecycle remains unchanged | Schema V2 kept separate |
| Studio task wrongly sent into GitHub reviewer | Direct teacher to Studio submissions inspector instead | Role navigation and Gradebook route |
| Local project deleted after submission | Frozen submitted revision remains reviewable | Independent submission snapshot |
| Browser reload during grading | Existing saved draft remains private; UI must reload before edits | Firebase transaction and Gradebook |
| Offline / storage quota / private-browser mode | Preserve in-memory edits if possible; never show a false 'saved' status | Existing Playground warnings and submission failure notices |

## Acceptance gates remaining
1. Firestore emulator checks of student owner, cross-section teacher, immutable version, deadline, revision replay, and published-grade cases.
2. Authenticated browser student → teacher → Gradebook end-to-end with a real Java project and two accounts.
3. Review of data size on projects with large diagrams/tables and slow connections.
4. Reconcile #97 / #98 reliability fixes into the same major-release branch, not separate deployments.
5. Audit existing Gradebook V2, manual review, school admin and account switching for regressions. No site-wide bug-free guarantee is possible from source inspection alone.

## Next steps
Keep this feature branch separate from production until role/security verification and conflict reconciliation are completed. Do not present these features as live before merge and release checks.
