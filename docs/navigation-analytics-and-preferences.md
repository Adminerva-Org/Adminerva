# Navigation, analytics and activity preferences

## Using the update
- Open **?** for What's new, Report a problem, your reports, Wiki, privacy and account settings. The notification bell remains separate. Escape closes either panel; opening one closes other menus.
- In **Assessment Evidence**, choose a section and search by name or GitHub username. Results are capped at 40 plus the current selection. Searches never silently change the loaded student or write evidence. Choose a result and **Load evidence**; unsaved review text requires confirmation.
- **Teacher Analytics** uses assigned sections and published grades by default. Administrators select an instructor; teachers cannot select other instructors. Expand Optional learning activity for permitted coarse snapshots. Refresh retries loading without changing grades.
- **Administration Analytics** separates operations from academic results. Missing sources show unavailable totals, not zeros. Summary publication still requires complete source reads, fresh consent/assignment checks and confirmation. No automatic monitoring is enabled by this release.
- On signed-in student/staff home visits, the activity dialog shows saved choices. **Save preferences** explicitly applies sharing choices. **Not now** discards unaccepted sharing edits; if “Don't show again” changed, it saves that reminder choice using the previously saved consent. Escape discards unsaved changes. Account Settings can edit consent and restore the home reminder.

## Privacy and permissions
`activity_preferences/{authUid}.promptDismissed` is an optional boolean (absent means false), private to the verified owner and administrators. Suppression follows the account across browsers after the next page load; it is independent of `enabled`. Diagnostics remain local to the signed-in account and in-memory on the page; source, typed text, selectors and URLs are not recorded. Public pages do not initialize Firebase activity collection. Permission/storage failure keeps sharing off and does not falsely report successful saving.

## Limits
- Academic section assignments do not add school-wide per-class grading ACLs; newly admitted teachers remain trusted academic staff under existing rules.
- Missing learning snapshots require an administrator refresh. Snapshots and repository samples are incomplete, never proof of contribution, attendance or mastery. Activity tables currently identify student records by roster ID.
- Repository charts are capped at 20 repositories and 100 recent default-branch commits each, use bounded concurrency/shared rate-limit cooldown, and may be partial. They do not establish push time or pinned assessment evidence.
- Closing the reminder without saving does not suppress future home visits. An unavailable preference store cannot persist reminder suppression. Other open devices refresh choices on their next page load, not instantaneously.
- Deployment includes no live-data migration, grade publication, Functions deployment or monitoring-policy change. Older shared lessons remain preserved for explicit administrator recovery.

## Validation
Node regressions cover bounded student search, normalization and retained selection; emulator rules cover private typed suppression without activity consent. The real Auth/Firestore emulator browser flow covers home prompting, unsaved-consent dismissal, settings edits, public-page isolation, search/deep links, role-scoped analytics and 320–1024px menu hit-testing with the real Quill toolbar.
