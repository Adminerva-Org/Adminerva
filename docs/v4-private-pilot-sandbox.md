# Adminerva 4.0 — Private Pilot Sandbox

## Goal
Allow an invited MCS co-teacher to browse the current teacher's expressly shared classroom resource summaries, then run **private simulations** without editing the owner's school data or notifying actual students.

## Access prerequisites
1. The MCS school must be in the V4 **pilot** or **active** state, with `legacy_allowed` while legacy previews are still required.
2. The visitor signs in with their **own email-verified Firebase account**, is linked to the MCS school, and has an **active teacher membership**. An account created merely as a guest or student cannot use this feature.
3. The owner signs in and opens **Pilot Sandbox** from the teacher workspace.
4. In **Shared preview**, the owner enters the visitor's verified email and creates the grant. The recipient must already have active MCS teacher membership.
5. The recipient opens the same Pilot Sandbox page and selects the shared teacher workspace. Grants expire after 30 days and can be revoked from the owner's page.

## What the visitor can do
- Inspect teacher-owned V4 resource labels, assessment rubric summaries, timetables, and selected legacy MCS owned resource summaries.
- Inspect only aggregated gradebook activity. Student-level grades, identifying details, code evidence, private feedback, and connection credentials are deliberately excluded.
- Press **Set up example classroom** in **Practice workflows** to generate fictional learners and a private sample assessment, timetable, lesson, and school-admin scenario.
- Simulate evidence submission, draft grading, publication, reopening and resubmission for fictional learners.
- Create and edit private timetable and lesson examples and modify fictional school sections/staff/academic period.
- Copy an authorized assessment or timetable preview to **their own** sandbox for independent experiments.
- Create, edit, and delete private example notes under **My private sandbox**.

## Isolation contract
All persisted test records use `schools/{schoolId}/pilot_sandboxes/{actorUid}/records/{recordId}`. Official records are never updated by sandbox actions. The callable validates the signed-in UID and active school membership; neither browser-selected UIDs nor simulated roles grant authority. Browser Firestore access to `schools/**` is denied by existing rules, so all operations flow through server validation.

Sharing is restricted to consent-granted metadata-only previews; a school admin role does not automatically provide access to another teacher's private sandbox. Grants are separately stored in `pilot_preview_grants` and audited. Revoking a grant disables subsequent preview requests. Previously copied private examples remain the recipient's own records.

## Important limitations
- This is a practice simulation, **not** a duplicated full application/database or live teacher-account impersonation.
- Legacy assessments lacking explicit owner attribution remain unavailable: no fallback to school-wide or section-wide unowned records.
- Real MCS student identities and unpublished grades cannot be viewed through this pilot preview. Any broader school-authorized view requires a separate privacy/access-control design and approval.
- No direct GitHub commits, actual student submissions, student notifications, or official grade publication occur inside the pilot sandbox.
- The UI and callable must be deployed **together** before use. This branch is currently a draft implementation and has not been released.

## Development handoff
Changes are maintained in draft PR #137. Do not modify legacy student data, rebuild rosters, reset school accounts, change the cutover mode, or grant administrator rights as a workaround for a preview-access problem.
