# Teacher workspaces, account admission and responsive review

## What changed

Previously, lesson IDs contained the subject/week/year but no owner, schedules used shared `app_config` documents, planning defaults were global, and device keys were shared between signed-in accounts. Two staff accounts could therefore replace the same lesson or timetable. The new `staff_workspaces/{authUid}` parent separates lessons, schedules, slide decks and lesson preferences. Personal device caches use that same authenticated UID and never silently import the old shared cache. Account changes invalidate the open workspace rather than saving an old in-memory draft under a different identity.

Lesson/deck/schedule writes compare the version actually opened by the user. Another tab/device changing it makes Save stop and retain the edited text. Content updates require a matching immutable prior-version record. Archive/restore change flags only; hard deletion requires prior archiving. Printed teacher names and school defaults are display metadata, not account ownership.

## Administrator-managed teacher access

Open **Teacher Accounts** from the administrator menu. Authorize the exact verified Google email, enter a name, select sections, and record a reason. This grants access; it does not send an email invitation, create a password, or grant administrator privileges. The teacher's own connection profile is created after their first successful admitted sign-in. Teacher connection tokens are not readable through another teacher's directory query.

Only the verified bootstrap administrator can create/change admission entries and their immutable audit. An explicit disabled entry overrides the original instructor fallback. Disabling staff access preserves teaching files and does not delete the Firebase/Google identity. Student self-registration and teacher-directory fields cannot grant staff authority. Simulated browser roles do not grant server permissions.

Important scope: admitted teachers inherit the existing trusted academic-staff permissions. Section assignments scope Teacher Analytics and coarse learning snapshots; this is **not** a complete section-level ACL migration for every grading/repository/library tool. Authorize trusted academic staff only. That broader permission migration should be separately reviewed before opening access institution-wide.

## Existing shared records

No production record is reassigned, migrated or deleted. Old root lessons/presentations are administrator-readable and non-writable, because their display-name fields do not establish reliable ownership. Teacher Accounts lists up to 25 old lessons for inspection. Open one, review it, and deliberately save a personal copy; an existing personal lesson cannot be replaced without loading its current version. This is not automatic recovery into each original teacher's account.

Schedules offer **Import older shared timetable**. The chosen period's shared source is copied into the editor only after confirmation. Review and **Save Schedule** into the signed-in account. **Reload my saved schedule** explicitly discards the unsynced local view. No shared timetable is automatically adopted by another teacher.

## Analytics and interface

Teacher Analytics defaults to published numeric grades; optional private-draft charts are clearly provisional. Missing/invalid scores are excluded instead of becoming zero. Academic student/grade queries use assigned-section and student-ID groups; an empty instructor/assignment starts no invalid document lookup. Administrators select an instructor on the teaching page. Teachers cannot see the instructor-management selector or raw administration trails.

Administration Analytics remains operational: optional activity samples, reports and diagnostic trails, not duplicate mastery charts. Its advanced teacher-summary controls support the selected instructor. Existing automatic maintenance remains off. The unchanged deployed maintenance worker refreshes only the original instructor; new instructors use the explicit administrator summary refresh until a separately authorized backend update is implemented/deployed.

The shared navigation reduces the brand/email footprint at narrow widths and bounds the notification panel to the viewport. The footer consistently links Help, Wiki, patch history and privacy, including the login page. Review & Grade retains the three-step workflow with sticky section navigation, a bounded viewport and wrapping save/publication actions. Automated assistance disclosures, protected grades and deliberate publication remain intact.

## Release and limitations

I've set up prototype Security Rules to keep the data in Firestore safe. They are designed to be secure for UID-owned teaching records, administrator-managed admission, private teacher connections and immutable history. However, you should review and verify them before broadly sharing your app. If you'd like, I can help you harden these rules.

Deploy matching permission rules before the website only after owner approval. Back up the live rules/site baseline and verify exact readback/content. No Functions deployment, automatic monitoring activation, TTL change, student-data migration or grade publication is part of this repair. Existing tabs must save work and refresh; old shared writes are rejected once the new rules are active. Emulator tests do not change production Auth/API configuration or real account-directory records.

Tests cover pure identity/cache/version logic, real emulator isolation/admission/audits/grades, and a browser lifecycle using synthetic identities and mocked GitHub/evaluation responses. The browser scenario includes a second teacher authorized through the actual administration form, same-week private lesson records, a stale second tab, analytics selection, mobile header/footer layouts and existing protected-grade workflows. They do not establish real provider quality, production migrations, or that every future device/browser layout is covered.
