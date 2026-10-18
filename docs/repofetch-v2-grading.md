# RepoFetch — primary Assessment V2 grading workflow

> Historical guide for the initial queue. The current workflow and release requirements are in [Review & Grade](review-grade-workspace.md), including integrated evidence review, individual scoring and audited reopening.

## Teacher flow (one primary grading page)

1. Open **RepoFetch**. The **Assessment V2 · Review & Grade** queue loads section and assessment without requiring Fetch & Sync or a GitHub personal access token.
2. Select a **class section** and **V2 assessment**. Each student row shows evidence and grade status; choose **Review & Grade** for the student. This opens one grading workspace with the student and assessment already filled in. It does not create, change, or publish a grade merely by opening.
3. If the selected evidence lacks approval, use the **Assessment Evidence Review** link in the workspace. That page selects the current student/assessment automatically. Inspect selected diffs and checkpoint ancestry; resolve reclaim conflicts and approve with a meaningful teacher note. Return via its **Open grading in RepoFetch** link; the queue and review load the same student/assessment automatically. The **Reload checkpoint / grade status** button is also available.
4. For an approved checkpoint, inspect the pinned project and selected commit evidence. To request AI suggestions, configure your instructor-owned Gemini API key in Adminerva Settings and click **Generate AI rubric draft**. This requires an explicit confirmation that relevant source content will be sent to the configured AI provider.
5. AI suggestions are scored against the weighted, student-visible assessment rubric. The page fills editable **Teacher score**, **Feedback**, and **Files considered**. The teacher reads the criterion breakdown, reviews source and limitations, edits scores or wording, writes their own **Teacher review note**, confirms evidence inspection, and clicks **Save unpublished grade**.
6. The saved record includes the teacher-reviewed score and pinned graded SHA, plus optional AI suggestion metadata. **Publication remains an explicit, separate instructor action** through the existing RepoFetch/Gradebook controls. Never publish without verification.

**Supporting pages:** Assessment Evidence Review verifies SHA ancestry and reclaim conflicts, while Contribution Inspector provides deeper authorship investigation. Both stay separate and receive student/assessment filters as query parameters from RepoFetch.

**Legacy separation:** legacy Auto-Checker and bulk grading remain available for legacy assessments only. The legacy Auto-Checker is intentionally blocked for V2; the new V2 AI feature generates **advisory** rubric suggestions only from approved checkpoints.

## Evidence boundaries

- V2 AI suggestions never use the current mutable branch HEAD as the grading reference.
- AI source collection loads selected-commit diffs and the exact matching files at the **approved immutable checkpoint SHA**; it filters by the blueprint's configured target paths and expected file extensions.
- If no matching evidence, a missing textual diff, a truncated GitHub source tree, or limits prevent complete inspection, the assistant refuses to generate a score; the teacher can still review manually.
- Selected Git SHAs, commit authors, and Git author timestamps **do not prove** individual authorship or timely GitHub push. Only the instructor can approve evidence; reclaim conflicts require administrator resolution.
- The AI model does not execute Android apps. Claims about runtime behavior, on-device usability, and compilation require teacher observation. The user-facing rubric must not silently expand to Java, Firebase, arrays, authentication or backend CRUD for the XML-only Mini PETA 1.
- The browser sends student source evidence to the Gemini API **only after the teacher clicks and confirms**. API key/model settings remain instructor-managed in the current client-side integration. A future server-side proxy and improved credential handling remain necessary before broad institutional adoption.
- No automatic grade write or publication happens when AI returns a response. The teacher must explicitly save and publish later. Existing published and teacher-adjusted grades are protected.

## Rubric setup prerequisite

The AI assistant expects numbered, point-weighted headings in the visible **Evaluation Criteria** field, with a total equal to **Max Score**. Example:

```text
1. UI Completeness — 5 Points
2. XML & Technical Implementation — 5 Points
3. Design & Usability — 5 Points
4. Project Compliance — 5 Points
```

If the rubric is not parsable or contains incorrect totals, AI suggestions are unavailable, but manual teacher grading remains available.

## Production validation before class-wide adoption

The successful GitHub CI suite tests JavaScript parsing/validation and Firestore emulator permissions, but **does not prove the live Gemini provider, GitHub access, user roles, or runtime UI work**. Before rolling out:

- Verify RepoFetch V2 queue as an authenticated teacher, including filters by section and assessment.
- Use a controlled student repository with an approved checkpoint containing XML files and a correct rubric. Check the AI suggestion matches visible source and that limitations are stated.
- Verify unapproved evidence cannot receive an AI suggestion or be graded.
- Verify that saving creates a **new unpublished grade** with the pinned SHA, a teacher review note, revision record, and no automatic student-visible score.
- Verify a student cannot inspect other students' grade/evidence/private config; verify published-grade guards.
- Verify the supporting Evidence Review link and the return URL auto-select the correct student/assessment.
- Verify the AI provider error path and missing-key path do **not** modify any grade. Limit initial rollout to authorized staff/test data while credential handling and broader staff Firestore permissions are reviewed.
