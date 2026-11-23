> **Status authority:** This is a technical specification and inactive code foundation. The sole product roadmap and status record is the Adminerva School OS master plan.

# Adminerva Exam Integrity Engine + Adminerva Companion

## Architecture
One monitoring system supports two optional capture methods under the existing teacher-controlled Studio assessment session: browser observation (tab visibility/focus, connection, authorized screen snapshots) and a visible desktop Companion (foreground app names, bounded running-app names and authorized full-screen capture). The existing assessment deployment, offering, enrollment, manually controlled session epoch and final checkpoint remain authoritative.

Teacher monitoring belongs with Deployed Tasks and Class save history, not a new assessment or duplicate roster. Activity events and screenshots are observational records, never automatic cheating verdicts or grades. Student code, autosave, final-save receipts, session closing and grade evidence stay unchanged.

## Status of this branch
- Added a small server-side event normalization contract without any persistence, endpoint or authorization.
- Added a transport-agnostic browser event observer with mandatory opt-in arguments; it is intentionally NOT imported into live Studio.
- Added focused tests for event bounds, discarded sensitive fields, inactive defaults and stop behavior.
- No screenshot uploads, desktop installer, native app telemetry, teacher dashboard, permission settings or monitoring backend are operational.

## Privacy, security and authorization contract
- Default OFF, per-exam deployment policy; provide explicit examination notice, relevant consent/guardian authorization and school-approved retention before any observation or screen capture.
- Browser getDisplayMedia requires a student action and selection. It cannot force entire-monitor sharing or persist that permission. Show unavailable or interrupted states honestly.
- Companion is a separately installed, visible opt-in application; require an obvious recording indicator, Stop control, current school/student/exam and OS screen permissions. No stealth startup, hidden background capture, keylogging, clipboard monitoring, microphone, webcam, raw process paths, window titles, URL/query strings or screen-text extraction.
- Server must bind auth UID to verified school person and active enrollment; validate school, roles, offering, published/open exam, exact session epoch, replay protection and bounded rate. Never trust client identity or timestamps. Separate teacher-only review from platform operations.
- Pair Companion to an authenticated student browser using a short-lived one-session code, a per-device key and audited revocation. Never embed permanent user credentials in the desktop app.
- Keep screenshot blobs in private school-owned object storage (not Firestore or immutable code checkpoints), with restricted grants, server timestamps, digests, access audit, size/retention limits and approved deletion governance.
- On Close stop monitoring authorization immediately, independent of the 60-second final code-save grace. Do not accept uploads from a previous epoch. Monitoring failure cannot lock the editor, rewrite grades or destroy code.
- Mobile/iOS/unsupported browser mode must display limited coverage, not claim full desktop monitoring. Native agents require OS-specific testing and code signing.

## Integration sequence
1. School-approved policy and retention model; tenant-scoped callables for get policy, submit activity, class status, student timeline, and private signed snapshot uploads.
2. Student exam-entry notice and browser observer wired only after server-verification of an open session and appropriate authorization; stop on close, school switch or logout.
3. Teacher per-class monitoring status/timeline integrated into Deployed Tasks and Class save history; activity evidence read lazily.
4. Companion installer + explicit pairing + foreground-app reporting + limited process summary + permissioned screen snapshots, followed by device validation.

Never mark the feature live merely because a PR, model contract or website asset exists. Preserve existing practical exam, assessment, Studio and Class Record workflows.
