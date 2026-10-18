# Review & Grade (RepoFetch)

## Teacher workflow

1. Open **Review & Grade** in the Grading menu. Select section, assessment, then **Review & Grade** beside a student. The queue includes submitted, withdrawn, reopened, approved, saved draft and published states; no GitHub sync is required.
2. Expand **Evidence, selected diffs, attribution and checkpoint approval**. Preview selected changes and the pinned project, resolve pending reclaim requests, describe the student's individual responsibilities and attribution basis, and check only commits independently verified as their contribution. Approve with a teacher note and inspection confirmation. Missing submissions can use historical discovery in this panel; discovered records are not certified student submissions.
3. Click **Evaluate** for an optional evaluation draft. After consent, matching pinned source and verified diffs go to the configured Gemini provider. Read criterion rationales and separate group observations. Uncertain criteria have no suggested score and no suggested total. Enter your own score after resolving them; do not silently change rubric weights.
4. Edit **Teacher score** and **Feedback to student**, add a teacher review note, confirm inspection, then **Save unpublished grade**. Evaluation alone saves nothing. A saved private draft remains invisible to students. Automated-assistance provenance survives later feedback edits.
5. Publish individually using existing Gradebook controls after verification. V2 bulk publication is excluded. Changed or reopened evidence blocks publication until a new reviewed draft is saved. Published grades must be explicitly unpublished before editing or reopening evidence.

**Advanced detail stays in the page:** group membership and submission status, selected diffs and reclaims, Contribution Inspector and Group Inspector are expandable. Older inspector routes remain under **Evidence tools**. Broader inspector history may include other revisions and cannot establish scoring credit at this checkpoint.

## Individual equity and the 4/20 screenshot

The reported draft assigned 1/5 to each criterion after seeing only `activity_main.xml`. That file may support observations about its own XML, but cannot establish that the group has no other screens, that this student owns every line, that their assigned work includes all three screens, or that the project runs. The screenshot alone cannot establish a fair replacement grade.

Evaluation now loads all matching source at the approved checkpoint (within explicit bounds), with **only teacher-verified selected commits** supplying individual attribution. Full files are project context. Each suggested criterion score must cite a verified substantive diff by exact SHA and path. Empty verified selections, trivial-only patches, merge commits, incomplete trees, missing diffs and exceeded source limits stop automated scoring.

- Apply each original criterion to documented responsibilities and demonstrated changes. If Alice implemented her assigned welcome screen, missing screens assigned to teammates do not automatically lower Alice's individual completeness/compliance score.
- Shared files do not earn Bob credit without verified contributing changes. A matching GitHub name or a checkpoint containing Alice's screen is insufficient.
- A score needs evidence for that criterion; a diff citation alone is not proof of quality. Scope ambiguity, visual quality and runtime-dependent criteria should remain **Teacher review needed** until independently checked. Missing evidence is not an automatic zero.
- Keep group completeness separate. Do not invent equal shares, rescale incomplete evidence to full marks, reweight criteria, or impose backend requirements on an XML-only assessment. Shared work needs an explicit teacher explanation of attributable work.
- Teacher-entered scores remain possible when automation abstains, including legacy approvals without per-commit verification. Require a reason and inspection. To enable evaluation on an old approval, explicitly reopen, have evidence resubmitted, and approve with the new contribution fields.

The model can still produce incorrect rationales. Citation validation and scope instructions constrain the draft; instructor review remains essential. No generated score is automatically saved or published.

## Student changes and audit rules

| Evidence state | Student action | Teacher action |
| --- | --- | --- |
| No record | Submit selected commits and checkpoint | Discover candidate historical evidence if needed |
| Submitted | Resubmit or withdraw | Inspect and approve |
| Withdrawn | Revise and resubmit | Wait for resubmission |
| Approved | Read only; request reopening | Explicitly reopen with a reason; unpublish any released grade first |
| Reopened | Revise/resubmit or withdraw | Wait for fresh submission and approval |
| Teacher-discovered, needs review | Read only | Inspect and approve; preserve origin |

Each update increments an evidence revision in a transaction and creates an immutable `assessment_evidence/{id}/revisions/{revision}` with exact before/after records, server time, actor and reason. Resubmission receives a fresh server submission time; withdrawal retains the previous timestamp. Reopening revokes approval and verified contributions. Old grade drafts are preserved but cannot publish, even if the same SHA is later reapproved.

Rules exclude evidence and V2 grades from staff catch-all write privileges. Staff identity requires verified email. Students cannot approve/reopen, alter review metadata, edit others' records, erase evidence, forge history, or publish. Administrator maintenance also respects the evidence lifecycle. Legacy-grade behavior is retained.

## Validation and activation

CI runs JavaScript regressions (including simulated review UI flows), Firestore emulator permissions, syntax checks and CodeQL. Local emulator tests use only `demo-adminerva-security`.

**No Firebase deployment is authorized by this PR.** Review and explicitly approve rules deployment before activating these controls. Old deployed rules cannot accept the new audited student updates; coordinate frontend release with approved rules activation. Functions are unchanged. No live grade, assessment, evidence or repository history is migrated.

Before release, smoke-test with real instructor/student accounts: submit, resubmit, withdraw, approve, save, publish, unpublish, reopen, resubmit and reapprove; verify the old draft cannot publish and another student's records stay private. Check provider consent/errors and GitHub access with controlled data.

## Limits

- Teacher approval is a human assertion; rules cannot authenticate GitHub authorship or independently validate ancestry. GitHub association is not proof of student identity. Reclaim lookups are client checks; newly created competing claims during review require reinspection.
- Review is bounded to 12 matching files, 30 KB per file, 48,000 source characters and 30,000 diff characters. Deleted/renamed work, merges, binary/omitted patches and larger projects need manual inspection. Git author times do not certify push deadlines.
- Runtime, builds and visual usability require direct observation. No automatic replacement for the screenshot's 4/20 is asserted.
- Legacy inspectors retain broader-history access/cache behavior. Student previews require public repositories; instructor evidence review supports the locally configured GitHub token.
- Gemini keys remain browser-managed. A server-side proxy and stronger Git identity verification remain future work. Existing functions do not add dedicated reopen/withdraw notifications; status appears in the queue and student assignments.
