# Adminerva Studio — teacher-controlled practical-exam sessions

**Scope:** Canonical V4 school-scoped Studio assessment deployments only. Non-manual Studio assignments and other submission methods retain their existing schedule policies.

## Authority and identities

- A **deployment** is one `schools/{schoolId}/assessments/{taskId}`, tied to one `course_offering` / section. The assigned responsible teacher, an active teaching grant and active school membership are checked by callable backend actions.
- An enrolled, authenticated **student** owns one or more Studio projects in `schools/{schoolId}/student_code_projects/{authUid}/projects/{projectId}`. The active enrollment in the deployment's `offeringId` is checked for manual exam saves.
- Student application code must not read or mutate private `schools/**` documents directly; the Firestore rules prohibit it. Callable services are the only authorized school storage path.
- **Historical closing evidence** is immutable and access-controlled separately from editable current projects.

## State machine and deadline model

| Manual state | Who transitions it | Student access | Cloud saves |
| --- | --- | --- | --- |
| `waiting` | New manual deployment or manual mode enabled | Task details/project launch gated | Protected exam project writes blocked |
| `open` | Responsible teacher selects **Open exam** | Enrolled students may enter the current session | Normal revision-checked saves; submissions subject to due/late rules |
| `closed` | Responsible teacher selects **Close exam** | No editing or submissions | Only a final checkpoint for the same epoch during the bounded grace period |

`manualSessionEpoch` increments **only on opening**. **Close** records `manualClosedSessionEpoch`, `manualClosedAt` and `manualCloseGraceUntil`. After the grace period the exam remains **closed**, not indefinitely **closing**. Reopening during the prior grace is refused. Publishing an assessment is separate from opening a class session; closing the *assessment lifecycle* is separate from closing a *class meeting*. Historical `held`/`closing` states can still be read as closed by existing code.

The due date applies to formal submission policy. Teacher opening after the due date requires `allowLateSubmissions` to be explicitly enabled or a deadline extension.

## Save, close and resume protocol

1. Student enters through My Assessments; the server returns the deployment's current epoch. The client creates/resumes the assessment-bound named project with that epoch.
2. Normal editor changes are locally debounced, then synchronised with the school server using optimistic project revisions. A version mismatch does not silently overwrite a different cloud revision.
3. Teacher **Close exam** atomically changes the server deployment state to `closed`, records the epoch, closes ordinary writes and notifies students through their private notification feed. Active clients also recheck the authoritative session state periodically and on tab visibility changes.
4. On receiving closure, the client locks code editing and execution, captures all live Monaco models, and sends an epoch-bound **final checkpoint**. A full/disabled device storage does not prevent trying the upload from memory.
5. The backend verifies active school/student/section, matching assessment binding and epoch, checkpoint grace, revision and ownership. Project update (if necessary) and **one immutable final receipt** are committed in the same Firestore transaction. The first receipt for that student/session wins; different replayed contents cannot replace it.
6. The student is redirected out of Studio only on confirmed school server acknowledgment. The Assessments page independently checks the receipt before claiming it was saved. Failure leaves a locked and accurately labelled recovery state.
7. At the next teacher opening, the existing live project can resume under the new epoch. Its earlier immutable closing receipts cannot be overwritten.

**Network honesty:** A browser cannot physically stop an offline device or prove the keystroke time of source text it received after the teacher clicked Close. The checkpoint is proof of exactly what the server received **during the bounded final-save acceptance window**, not a perfect examination proctoring record. Unconfirmed students and device-only drafts require follow-up.

## Data ownership and storage

| Record | Path relative to `schools/{schoolId}` | Mutation policy |
| --- | --- | --- |
| Assessment deployment, manual state, epoch, due policy | `assessments/{taskId}` | Audited teacher callable; optimistic revision |
| Live Studio project, source/design/database/evidence | `student_code_projects/{authUid}/projects/{projectId}` | Student callable; ownership, enrollment, epoch and revision checks |
| Immutable final exam checkpoint | `studio_exam_close_receipts/{taskId}/sessions/{epoch}/studio_exam_final_checkpoints/{authUid}` | Created once, in same transaction as final cloud revision |
| Roster captured at explicit close | `studio_exam_session_rosters/{taskId}/sessions/{epoch}` | Best-effort create once; never edited |
| Assessment audit trail | `assessment_audit/{eventId}` | Backend-authored |
| Close/open notifications | `notifications/{authUid}/items/{eventId}` | Backend-authored, recipient-readable |

Each final checkpoint contains `schemaVersion`, `retentionClass: academic_assessment_evidence`, `projectRevision`, `projectId`, `contentDigest`, `sourceDigest`, UTF-8 source files, validated project artifacts, `payloadBytes`, and server `savedAt`. The teacher's View code and project-data reader verifies recorded digests on retrieval. Firestore single-field indexes for the large `files` and `artifacts` fields of the unique checkpoint collection group are disabled; queryable receipt metadata remains indexable.

The teacher's Class save history uses **the roster frozen at the time of explicit closing**, not current enrollment, with an explicitly-labelled current-roster fallback if capture did not succeed. Current and historical sessions remain accessible even if the exam is unpublished, archived or the manual setting is later disabled, subject to active teacher authorization.

## UI architecture

- **Teacher**: Assessment Studio deployment settings, Open exam / Close exam, and a session-selectable Class save history (including arbitrary older session numbers). Each student row shows confirmed/unconfirmed progress, revision and saved time. View code presents immutable source and database/design/configuration data. A teacher-authorized CSV export includes student checkpoint states, timestamps, SHA-256 digests and approximate storage usage.
- **Student**: My Assessments is the canonical entry point. The editor uses a read-only close overlay and automatic exit on save confirmation; recovery is explicit on failure. A confirmed receipt is verified again in My Assessments without delaying the whole assignments list.
- **Project list**: Bound exam projects route to My Assessments; generic duplicate/delete shortcuts are hidden. Unrelated personal projects remain unaffected.
- **Shared school service**: All Studio modules import the same cache-versioned `v4-studio-service.mjs` singleton to prevent disconnected school picker and revision state.

## Remaining limitations and deployment ordering

- Server-held close is immediate; client lock depends on receipt of a realtime notification or the fallback session check. Offline tabs cannot be forcibly terminated.
- Final checkpoint creation is **not** formal exam submission and does not calculate grades. The class close report shows who received an acknowledged checkpoint, not who completed all exam requirements.
- Offering enrollments and checkpoint metadata are paged in bounded batches; school-person reads are batched. The current synchronous notification fanout and class report have an explicit **1,500-person limit**. For larger sections, job-queued notification fanout and separately paged reports remain future work.
- The teacher roster report projects **only small receipt metadata**; full source/database/diagram payloads are fetched solely for the selected student's View code action.
- Immutable Firestore documents are bounded by the existing source (600 KB) and artifacts (180 KB) limits. A `payloadBytes` estimate supports capacity planning but excludes billed Firestore document/index overhead.

## Retention and export governance

- **Default: retain academic evidence.** Closing checkpoints and historical rosters are not assigned a Firestore TTL or automatically deleted. Marking an assessment archived or removing a student's current section does not purge the evidence.
- `retentionClass: academic_assessment_evidence` is a **classification**, not a retention duration. No school-wide period has been approved in this change.
- Teachers may export session **receipt metadata** to CSV (names, student IDs, final-checkpoint status, revision, server timestamp, hashes, payload-byte estimate). A CSV is not an export of actual code, database or diagrams: those remain in the school-owned immutable Firestore evidence records.
- Any future archival or deletion operation needs a separately authorized school-admin policy, a recorded decision, confirmation that grade disputes and appeals are resolved, an integrity-preserving archive/export process, and an auditable purge log. No automatic purge function is installed by this PR.
- Recipients must treat exported CSVs as confidential school records; the export escapes spreadsheet-formula-leading values to avoid executing untrusted student names in spreadsheet applications.
- Deploy backend Firebase Functions and Firestore index exclusions before publishing cache-versioned GitHub Pages frontend. No production readiness claim follows from syntax checks; a focused teacher+student online/offline exercise is still required.
