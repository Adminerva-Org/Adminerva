# Adminerva 4.0 — Private Pilot Sandbox

## Goal
Allow an invited MCS co-teacher to browse the current teacher's expressly shared classroom resource summaries, then run **private simulations** without editing the owner's school data or notifying actual students.

## Access prerequisites
1. MCS has an existing school record (draft, pilot or active). This demonstration is **not** the V4 cutover and changes no school state, enrollment, teacher role or production authorization.
2. The visitor signs in to their **own email-verified account**. Either an active canonical MCS teacher membership **or an approved, active legacy MCS teacher record** is accepted for the sandbox **only**. A previously approved guest request with approvedRole=teacher creates the required legacy staff_access record; rejected/student/suspended accounts are denied.
3. The owner opens **Private pilot sandbox** from Teacher Home or Planning. An active MCS legacy teacher (including the original teacher) or canonical MCS teacher can use the page.
4. In **Shared preview**, the owner enters the visitor's **exact verified email address** and selects **Grant preview**. The server verifies the recipient remains an approved, active MCS teacher. No V4 membership is silently created.
5. The visitor opens [Private Pilot Sandbox](../pilot-sandbox.html) under her own account, selects the shared preview source and uses **Practice workflows** to initialize a private fictional classroom. Grants expire after 30 days and may be revoked immediately by the owner.
6. The visitor's grade simulations, schedule edits and other private examples are persisted exclusively under her Firebase UID; none are sent to real learners or applied to MCS assessments.

## What the visitor can do
- Inspect teacher-owned V4 resource labels, assessment rubric summaries, timetables, and selected legacy MCS owned resource summaries.
- Inspect only aggregated gradebook activity. Student-level grades, identifying details, code evidence, private feedback, and connection credentials are deliberately excluded.
- Press **Set up example classroom** in **Practice workflows** to generate fictional learners and a private sample assessment, timetable, lesson, and school-admin scenario.
- Simulate evidence submission, draft grading, publication, reopening and resubmission for fictional learners.
- Create and edit private timetable and lesson examples and modify fictional school sections/staff/academic period.
- Copy an authorized assessment or timetable preview to **their own** sandbox for independent experiments.
- Create, edit, and delete private example notes under **My private sandbox**.

## Isolation contract
All persisted test records use `schools/{schoolId}/pilot_sandboxes/{actorUid}/records/{recordId}`. Official records are never updated by sandbox actions. The callable validates the signed-in UID and either an active verified canonical teacher membership or an explicitly active legacy MCS staff record tied to the verified account. Canonical suspensions override legacy grants; the legacy bridge cannot grant any V4 API permission. Neither browser-selected UIDs nor simulated roles grant authority. Browser Firestore access to `schools/**` is denied by existing rules, so all operations flow through server validation.

Sharing is restricted to consent-granted metadata-only previews; a school admin role does not automatically provide access to another teacher's private sandbox. Grants are separately stored in `pilot_preview_grants` and audited. Revoking a grant disables subsequent preview requests. Previously copied private examples remain the recipient's own records.

## Important limitations
- This is a practice simulation, **not** a duplicated full application/database or live teacher-account impersonation.
- Legacy assessments lacking explicit owner attribution remain unavailable: no fallback to school-wide or section-wide unowned records.
- Real MCS student identities and unpublished grades cannot be viewed through this pilot preview. Any broader school-authorized view requires a separate privacy/access-control design and approval.
- No direct GitHub commits, actual student submissions, student notifications, or official grade publication occur inside the pilot sandbox.
- The UI and callable must be deployed **together** before use. This branch is currently a draft implementation and has not been released.

## Development handoff
Changes are maintained in draft PR #137. Do not modify legacy student data, rebuild rosters, reset school accounts, change the cutover mode, or grant administrator rights as a workaround for a preview-access problem.

## Deployment and co-teacher onboarding
- This feature ships as a dedicated page and **one** Firebase callable (`schoolPilotSandbox`) in `asia-southeast1`. The deployment workflow deploys **only** this callable from reviewed `main`, using the protected Firebase service-account secret. It does not deploy unrelated V4 functions or modify Firestore rules.
- The GitHub Pages deployment updates `pilot-sandbox.html`, the shared teacher navigation and teacher home. Function deployment must report success separately before using the page.
- To grant Maed's already-approved teacher account, the owner opens the page, signs in, uses **Shared preview**, enters the exact verified email used during admission and presses **Grant preview**. Only that owner can issue the grant for their records; a code deployment does not silently share live classroom data.
- If access is denied, check email verification, approved legacy teacher status, canonical suspension status, and the MCS school record. **Do not** create fake student records or add production section assignments to bypass an access denial.
- Read-only preview and private simulations are the available experience; the pilot does **not** impersonate the owner's full live account or reveal per-student private grades.
