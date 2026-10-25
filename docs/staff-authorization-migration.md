# Staff authorization migration

Adminerva currently keeps one **bootstrap administrator email** as an emergency compatibility path while moving staff authority into `staff_access`.

## Current behavior

- The bootstrap administrator remains recognized even if no `staff_access` administrator record exists.
- Active `staff_access` records with `role: "admin"` are now recognized by browser role resolution, Firestore rules and backend administrator checks.
- Administrator-directed notifications resolve all active `staff_access` administrators plus the bootstrap administrator.
- Existing teacher records and the original-teacher fallback continue to work.

## Why the bootstrap remains

Removing the bootstrap identity before at least one active administrator record exists could lock the school out of staff-access management and privileged Firestore operations.

## Final migration

When an active administrator record has been created and verified:

1. confirm the administrator can open School Administration, Staff Settings and Reports;
2. confirm Firebase backend administration checks recognize the record;
3. replace the bootstrap email fallback with custom claims or the finalized role source;
4. remove the legacy original-teacher fallback only after that teacher has an explicit active `staff_access` record.

Do not remove both fallback paths in the same unverified deployment.
