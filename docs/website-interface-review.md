# Website interface and workflow review — 22 October 2026

This update covers the shared interface across the 42 root HTML routes, with deeper repairs to school setup, student practice, guest access, directory imports and account settings. The earlier unpublished 1.1.1 patch is consolidated into this 1.2.0 candidate; it is not recorded as a separate historical release.

## Findings and implemented changes

| Finding | Result |
| --- | --- |
| Workspace switching was hidden behind the logo; the current page was unclear. | A direct Home link, visible Workspaces menu, current location and grouped task navigation are shared across authenticated pages. XML Lab and older grading tools retain reachable routes. |
| Navigation could retain the previous account role while access checks completed. | Verified role presentation refreshes after admission, while the existing page guards continue to enforce access. |
| School catalogs, roster sections and teacher access looked interchangeable. | Setup pages show a three-step flow: define section names, enroll students with those names, then assign teachers. Catalogs offer search, status filters, edit/cancel and useful empty states. |
| Native multi-selection obscured teacher assignments. | Checkboxes show exact section names and roster counts. Saved assignments are visible in the teacher directory. |
| Approving an existing teacher request could clear assigned sections. | Teacher approval preserves existing explicit assignments; new teachers receive an empty assignment list. |
| The directory's Teachers control did nothing; CSV selection replaced its own file input. | Teachers opens teacher management. Import supports keyboard access, drag/drop, file replacement and a clear 500-record bound. |
| Practice could show a Check button without a challenge or recover a session without restoring a mission. | Mission actions wait for a loaded challenge. Reconnect restores the active mission, expired attempts offer a new example, and moved sessions hide stale actions. |
| Completion confirmations disappeared during the next progress refresh. | The saved completion and XP confirmation remains visible after refresh. |
| Guest practice showed fifteen expanded exercises with indistinct right/wrong feedback. | Mission disclosures, completion indicators and distinct answer feedback make progress readable. |
| The public page presented two different login buttons leading to the same place. | One workspace entry explains role-based access. Sign-in identifies the required email, blocks repeated popups and presents errors as accessible text. |
| Forms and messages varied between modules. | Shared form grids, status tones, buttons, step lists and smaller-screen layouts provide consistent patterns. A skip-to-content link and reduced-motion support are shared. |
| Pending assignments were filtered by urgency rather than completion. | Pending includes unfinished, overdue and revision work while submitted and reviewed work stay out of that filter. |
| Student account loading failures could leave permanent placeholders. | Missing class records and connection errors show recovery steps; saving waits for a valid profile and confirms the server write. |
| Practice review depended on an optional ranking profile and could show a previous learner's response. | Every enrolled learner can be reviewed. Changing selection hides stale results and restores the selected learner's saved teacher note. |
| Connection settings displayed an editable Firebase configuration that was never used. | Application connection details are read-only and reflect the actual initialized app. Per-account preferences have a working save control, verification errors and protection against account changes. |
| Report dialogs allowed keyboard focus to leave the form. | Focus stays inside the open dialog; Escape preserves the draft and returns focus to Help. |
| PDF reference imports could wait indefinitely after provider errors. | HTTP errors and invalid processing states stop immediately. Processing has a two-minute limit, restores the import control and supports selecting the same file to retry. |
| The code editor's module loader captured JSZip before it could expose the global ZIP constructor. | JSZip loads before the editor loader. Browser validation opens the real editor, runs a Web Preview and downloads a ZIP archive. |
| A delayed module could miss the editor's page-ready event. | The editor initializes immediately when the page is already ready, while retaining normal initialization for earlier loads. |
| Shared-browser connection fields could carry over to another staff account. | One account owns the compatibility cache. Login and page admission restore only that account's own saved fields; switching accounts and signing out clear the previous values. |

## Intended setup and learning flows

**School setup:** Sections → User directory → Teachers. A catalog record supplies a name; it does not rename student records or grant teacher access. Use the exact existing roster name when assigning a teacher. Tracks, pathways and subjects remain descriptive catalogs.

**Teacher review:** Assessment Studio → Submission inbox / Review & Grade → Gradebook. Teacher feedback is saved before deliberate publication. The interface keeps those actions distinct.

**Student work:** Home → Assignments / Project Hub → submit evidence → review teacher feedback. Practice uses its own predict → run → reflect sequence, with completion XP separate from assessment grades.

## Verification and practical limits

The local route scan checks HTML destinations and duplicate IDs. Model tests cover authorization-sensitive service behavior and practice recovery. Browser validation uses synthetic identities with local Firebase Auth and Firestore, including section assignment, catalog creation, practice handover and responsive layouts. These checks do not exercise a real provider API key or change production student records.

Release status must be determined from the deployed version and hosted checks. A local manifest or this document does not prove publication.
