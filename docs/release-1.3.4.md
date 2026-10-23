# Adminerva 1.3.4 — Teacher reference-folder recovery

Released 23 October 2026 (Asia/Manila).

## Recovery completed

The original teacher requested recovery of their earlier reference library. Six legacy folders, containing 27 saved reference documents and 282,485 characters of stored reference text, were copied into the verified teacher's existing private material path. Original folder IDs and document data were retained so recovered lesson plans can keep their reference selections. Shared originals were preserved, and recovery receipts identify source and destination.

## Website changes

- The reference library waits for verified staff identity before reading its account-scoped data.
- Account labels, explicit load errors and refresh controls replace silent blank states.
- The library and lesson planner read the same teacher material scope and support both older inline references and nested document records.
- Saved lesson folder selections survive asynchronous loading of the reference list.
- Cache keys are scoped to the signed-in account.

## Deployment

The existing Firestore rules already allow the teacher's private reference-folder path. No rule or Cloud Function changes are needed. Source parsing and dependency packaging checks are used; no runtime, browser or emulator test suites are run.
