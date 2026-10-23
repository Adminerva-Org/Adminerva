# Adminerva 1.3.2 — Original teacher lesson recovery

Released 23 October 2026 (Asia/Manila).

## Changes

- The verified original teacher account can restore its pre-workspace legacy school lessons directly from Saved Plans. The destination is resolved server-side from the configured original teacher's email and verified UID; clients cannot choose another owner.
- Existing teacher saves, linked legacy copies and shared originals are preserved. Explicit conflicting owners are blocked. A stale recovery receipt without an actual teacher copy no longer suppresses recovery.
- Saved Plans shows the signed-in account, all school years by default, recovered labels and archived counts. Recovery failures leave existing saves available and provide a retry control.
- Saved Plans can open directly using `lesson-planner.html?saved=1`.

## Operational recovery

The user explicitly requested that their legacy saved lessons belong to the original teacher account rather than the administrator account. The existing administrator save linked to a legacy lesson was transferred with its saved content and revision handling. The transfer preserved an audit backup before removing the administrator entry. Nineteen remaining legacy lessons were copied into the teacher workspace, retaining archive state. The confirmed teacher total is 20 plans: 18 active and 2 archived, with no personal lesson plans remaining in the administrator workspace at recovery completion. Shared originals remain intact.

## Checks

Only source parsing and dependency packaging checks are run. No runtime, browser or emulator test suites are run. The one-time production data recovery is an authorized operation, not a test.
