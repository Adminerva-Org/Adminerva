# Next release — review only

This branch is not a release. Do not merge or deploy it without a separate approval.
The installed release manifest is unchanged. No Functions, monitoring, migrations,
grade publication or live account decisions are part of this change.

## Review sequence

1. **Checkpoint approval:** submit evidence, independently verify selected diffs,
   describe individual scope and approve. Metadata/buttons refresh without waiting
   for slow source previews. Evaluate is offered only when individual verification
   is eligible. No teacher review or protection checks are bypassed.
2. **Guest admission:** a verified Google/GitHub sign-in without enrollment becomes
   a private pending request. Guests have local-only web playground and practice.
   In **User Directory → Guest access requests**, choose a request, review the
   verified email, select a role and enter a reason. Link only a same-email student
   record, or deliberately create a new record and section. Teacher approval writes
   the existing administrator-managed staff registry. Set sections separately in
   **Manage Teachers**. No invitation email is sent. No password or provider token
   is stored in the request.
3. **School catalog:** Manage Sections, Subjects and Tracks & Pathways maintain
   audited metadata. Archive instead of deleting. Legacy and strengthened SHS
   schemes coexist. This does not rename roster sections, enroll students, migrate
   lessons or implement a full scheduling/course-enrollment system.
4. **Planning:** open saved lessons in the signed-in UID workspace. Saved document
   settings override current account defaults for that lesson. Mini-settings say
   which scope is being edited; save the lesson to persist lesson-only settings.
   Blank saved signatories remain blank. Existing school document markup, columns,
   dimensions, headings, signatures and print CSS are unchanged.
5. **RepoBank:** Refresh system overview pins the repository's default branch to
   a full SHA and samples at most 12 eligible source files, 6,000 characters each.
   Code is sent to the configured provider only after explicit confirmation.
   Drafts require review and a separate save. Unchanged checkpoint/model skips the
   provider request. Individual evidence is read separately from approved V2
   records, selected verified commits, instructor-recorded scope and each record's
   pinned checkpoint. Names, comments and shared source never establish credit.
   Earlier inferred member summaries are no longer presented as verified roles.
6. **Analytics:** administrators' primary Analytics link opens Administration
   Analytics. **Grading → Class analytics** opens the separate instructor view;
   ordinary teachers stay in their assigned learning view. No assignment means an
   explicit empty state, not a zero score or implicit access to all sections.
7. **Public documentation:** searchable guides and release filters; new release IDs
   can use MAJOR.MINOR.PATCH with dates separately. Existing dated IDs/read keys
   remain stable. The latest existing release has the display alias v1.0.0; this is
   not an additional release or notice. Private/draft/future releases remain hidden.

## Deliberately not implemented

- No unattended RepoBank scheduler. A future opt-in server job needs approval of
  source permissions, budgets, frequency, retention and draft-review ownership.
- No full Canva-like editor, automatic regeneration of edited slides, new lesson
  formats or rewritten curricula. Suggested future work: per-subject templates,
  cached source-version starters and incremental slide regeneration with a diff.
  Consult the teacher before implementing these.
- Both PDF buttons currently build the same document and invoke browser printing;
  Save & Print additionally saves first. Browser date/URL/page footers are controlled
  by print settings. No exact missing-footer example has been provided; its cause
  is not established and no footer-format changes are included.
- Legacy shared lessons have no reliable UID ownership and remain administrator
  read-only. Never assign them automatically by a teacher name. Recover/migrate
  individual records only after explicit ownership review and approval.
- Existing academic staff permissions still trust authorized teachers broadly.
  Analytics section assignments are not a complete per-class Firestore ACL for
  every legacy academic module. Review this before onboarding unrelated schools or
  teachers. Guest admission is not a substitute for a future tenant/section ACL migration.
- Requests show the most recent 100; catalog lists are capped at 200; staff
  assignment discovery retains existing roster limits. No pagination migration.
- Guest local storage is browser/account scoped, not encrypted storage or a cloud
  backup. Playground supports HTML/CSS/JS; it is not the enrolled-student editor.
  Practice points are local formative completion only and are not imported on
  admission. Guests do not initialize activity monitoring or notification feeds.
- Rejection is retained, not deletable or self-reopenable. Administrator-managed
  teacher admission and deliberate student enrollment remain separate mechanisms
  for later reconsideration. This is not Firebase Auth account suspension.
- Automated overviews are sampled, untested, potentially inaccurate project context;
  teacher edits/saves are explicit. They do not score or verify individual work.
  Different members may use different checkpoints. Current overview saves preserve
  reviewer/version metadata and use optimistic concurrency, not a new append-only
  RepoBank audit ledger; existing legacy RepoBank write permissions are unchanged.

## Curriculum reference

School catalogs are configurable rather than hardcoding a universal strand mapping.
Review the [official Strengthened SHS program](https://www.deped.gov.ph/strengthened-shs-program/)
and [2026 implementation memorandum](https://www.deped.gov.ph/wp-content/uploads/DM-12-s.-2026_Full-Implementation-of-the-Strengthened-Senior-High-School-Curriculum-in-School-Year-2026-2027.pdf)
before configuring a school's offerings. No assessment policy or lesson export
template is changed automatically from these references.

## Validation

Follow-up in the same review branch: [practice and actionable evaluation feedback](practice-and-feedback-review.md)
adds automatic class-only completion XP, a 300-mission course/module hierarchy,
partial-score guidance, flush review navigation and consolidated page help.
[Learning Arcade](learning-arcade-proposal.md) contains ideas only, not implemented games.

Pure tests cover request/role boundaries, stale decisions, local storage isolation,
frozen settings, stable release identities, source pinning, partial coverage and
rejection of inferred member output. Emulator tests exercise positive admissions,
spoofing, denied guest reads, immutable decisions, same-email linking, catalog
revisions and existing grade/evidence protections. The browser workflow uses
synthetic accounts and real local Auth/Firestore emulators. GitHub/provider calls
are fixtures, not live quota or external-service correctness tests.
