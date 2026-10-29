# Adminerva 3.0.0 — Major release candidate (NOT PUBLISHED)

**State:** Draft source changes on PR #99. GitHub Pages on `main` and production Firebase are not automatically updated by this document. Publish only when required Firestore rules/backend permissions are deployed and the security-critical student/teacher/Gradebook path has passed acceptance.

## What is changing
- Adminerva Studio replaces the Code Playground label while preserving existing project identifiers and student/guest URLs.
- Teachers may choose **GitHub repository evidence** (existing V2) or **Adminerva Studio project snapshot** (new V3) in a single Assessment Studio.
- Students submit a frozen, numbered Studio project revision. Teachers inspect that version, request changes or save rubric feedback privately, then publish through the existing Gradebook.
- New optional **Practical exam** policy for Studio assessments restricts ordinary clipboard, import, restore, previous-version and AI-helper UI actions when the assessment is opened from My Assessments.
- Public Wiki gains explicit teacher/student procedures, mobile topic navigation, role filters, examples and AI-assisted grading transparency.
- Release history supports per-change, per-role **impact** notes. Downstream effects (for example, student grading changes originating in a teacher feature) can appear in student notifications.

## Content-aware release-note specification

An affected role is **not** the same as the owner of a page. Each public change may include:
```json
{
  "type": "Updated",
  "area": "Grading and evaluation",
  "text": "Teachers may use an AI-assisted evaluation draft before reviewing and publishing a score.",
  "audience": ["teacher"],
  "impact": {
    "teacher": "You must verify the student's work and accept or replace any automated suggestion before publishing.",
    "student": "Your teacher may use an AI tool to help prepare feedback. The AI suggestion is not your final grade. Your teacher reviews the work and decides which score to publish.",
    "admin": "Confirm that school policies and notices cover any external AI processing before enabling providers."
  }
}
```
The parser sanitizes these optional fields before display and derives the effective recipients from both `audience` and `impact`. A student who is affected by grading should receive the student note even if the change is located in the teacher interface.

### Proposed role-specific 3.0.0 notes (subject to acceptance)

| Actual effect | Administrator | Teacher | Student | Guest/visitor |
|---|---|---|---|---|
| Studio project assessments | Assign roles, protect school configuration and review class access | Create/deploy Studio tasks and review frozen revisions | Open, submit and check Studio project revision status | See general product information; no academic submission |
| Practical exams | Review school exam policies, access limits and privacy | Enable exam restrictions and supervise; do not treat blocked clipboard actions as proof of cheating | Clipboard/import/AI helper UI actions are restricted in exam window | No practical-exam submission |
| Gradebook and AI assistance | Approve provider use and oversight policy | Human review is mandatory; draft is not publication | See only published results; informed that AI suggestions may have supported the teacher | No private grades |
| Beginner Wiki | Public help available | Clear steps and role filtering | Step-by-step guidance and troubleshooting | Public guides without protected account access |
| Responsive navigation and status | Navigate supported admin screens on phones | Reach key actions and error states on small screens | Reach project, assignment and submission actions on small screens | Reach mobile public guides |

**Privacy disclosure:** Using an external AI provider can send eligible assessment evidence to that provider depending on configured school settings. The product should disclose the specific provider, data categories and school policy before activating an integration. No event such as pasting, changing devices, running code or declining monitoring establishes misconduct by itself.

## Workflow failure and interaction review

### Teacher blueprint and deployment
- Empty title, unassigned subject, invalid point total or rubric -> field-specific guidance; preserve form values; do not create a broken task.
- Student-workspace choice is immutable after creating the assessment. Deployment of a Studio blueprint freezes substantive task and rubric settings.
- Practical-exam type selected before/after the Studio source -> offer the same restriction option. An explicit checkbox is the source of truth.
- Missing opening/deadline dates, deadline earlier than opening or duplicate section -> refuse invalid deployment and keep the teacher's unfinished work. A removed deployment stops new submissions without deleting historical snapshots.
- Multiple save clicks or a slow request -> disable action until completion, explain processing and retain entered values if rejected.
- Teacher loses section rights or changes account mid-request -> server rejects unauthorized write; do not claim success.

### Student view and working project
- Student has no linked record, wrong section, no assignment or an unavailable schedule -> explain the reason, show only permitted content, and offer safe navigation back to My Assessments.
- User opens an exam through the assignment link -> temporarily block transfers until assessment policy loads; show exam notice. Never silently disable restrictions after a failed policy lookup.
- Student opens Studio outside the exam link, on another device or with preloaded files -> browser controls cannot guarantee originality. Explain this limitation; supervised exams need separate classroom procedures.
- Browser storage quota or offline save fails -> never display false success; preserve live editor where possible and provide recovery guidance.
- Phone width of 320–375 px -> toolbars wrap, panels scroll, keyboard focus remains visible. Browser/device verification remains pending.

### Student submission and receipt
- No named project / expired assignment / unsupported file paths or oversized snapshot -> prevent submission without destroying working code; show actionable explanation.
- Repeated click, concurrent tabs or interrupted network -> transaction re-checks current revision and checksum; if uncertain, ask user to reload submission status before retrying.
- Student edits working files after submitting -> teacher still receives the immutable revision.
- Teacher has reviewed or published -> prevent silent replacement; request an authorized revision or unpublication as appropriate.
- Deadline passes during the submission click -> Firestore server time decides eligibility, not device time.

### Teacher review to published score
- Student switched accounts, teacher loses rights or two staff review same revision -> deny stale transaction, preserve draft and offer a refresh.
- Frozen snapshot missing or digest mismatch -> do not display it as trusted grading evidence.
- Wrong rubric max or incomplete feedback -> validate before saving; keep feedback text.
- Submitted revision changes while staff grades -> block stale publication; display newest revision.
- Private grade saved -> Gradebook publication remains separate; students see no draft.
- Published grade needs correction -> use explicit unpublish/revise/republish flow, preserving version trail.
- AI-assisted evaluation -> suggestion remains advisory; teacher validates accuracy and attribution. Student-facing release notes explain the effect on their feedback.

### Wiki, releases and navigation
- Guest opens public handbook -> no required sign-in, no protected school record requests.
- User searches for a term with no matches -> show explicit empty state and clearing action.
- Mobile reader selects a topic -> jump to it without losing keyboard focus or truncating the document.
- Release change located in teacher grading but affecting students -> notify both, with separately worded impacts.
- Draft/future/private release or unmet Firebase dependency -> never claim a public update or send user notifications.

## Acceptance decisions — protect user work, minimize repetitive checking

**Required before production cutover:** deploy/review Firestore rules on the correct Firebase project; verify ownership and section isolation; one authenticated student→teacher→Gradebook lifecycle (including revision and deadline); verify no stale grade can publish; reconcile overlapping code reliability changes from PRs #97/#98. Avoid claiming browser restrictions are tamper-proof.

**Focused UX acceptance:** one narrow phone walkthrough at 320/375 px, one desktop walkthrough for each role, and public Wiki as a guest. Confirm buttons are reachable, show pending/success/failure, and preserve user-entered data. Broader repetitive runs can be deferred if not directly relevant to changed security or grading boundaries.

**Not included in 3.0.0:** secure proctoring, plagiarism detection proof, automatic cheating penalties, automatic publication of AI grades, full multi-device collaboration, unrestricted project binaries, production release on merging this document.

**Rollback:** hide new V3 entry points if needed without deleting snapshots, changing existing GitHub assessments, or weakening Firestore permissions.
