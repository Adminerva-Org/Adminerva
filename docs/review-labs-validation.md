# Review and learning-tools validation

Validation uses synthetic accounts and repositories in local demo projects only. No production student data, grades, provider keys or deployment credentials were used.

## Local checks

- 193 JavaScript regressions pass, including new public-release projection, role visibility, stable notification identity, safe routing, explicit suggestion copying, missing checker setup, known-mission point totals, consent/section filtering, tied standings, XML dimension/color sanitization, entity rejection, lesson starter text escaping, complete chunking and source-version drift tests.
- 32 Firestore permission regressions pass. New coverage includes owner-only class registration, prevention of self-awarded reviewed points, verified instructor authority, exact reviewed-mission totals, mandatory immutable audit records, and roster-private class snapshots. Existing V2 evidence, protected grade, privacy and history regressions remain included.
- The extended browser lifecycle passes against actual Auth and Firestore emulators using the application's Firebase SDK 10.13.0. GitHub and evaluation responses are fixtures; unexpected external requests are blocked. Screenshots were visually inspected.
- Changed JavaScript/module syntax and whitespace checks pass.

## Browser scenarios

1. Student submits, revises, withdraws, reloads with a saved selected commit omitted from the first history page, unchecks/reselects evidence, clears the local selection and resubmits.
2. Teacher approves individual contributions inline. Selected diffs and pinned project files load without an external evaluation call. A provider outage leaves the grade unchanged. A partial evaluation leaves teacher fields unchanged until explicit acceptance.
3. Teacher explicitly saves a private grade. Separate publication remains possible through Gradebook for compatibility and through Review & Grade for the new primary workflow. A published grade blocks evidence reopening until explicit unpublication; reopening, same-checkpoint resubmission/reapproval and stale-draft publication guards remain effective.
4. A noncontributor cannot receive an automatic individual suggestion from shared project files. Students cannot read another student's evidence or private grade. Audit history preserves the original evidence and actor.
5. The real browser translates supported XML parent constraints into sandboxed HTML/CSS, escapes text resembling script tags, and refuses external entities. The preview sandbox has no executable-script permission.
6. Students opt into alias standings. Teachers review individual practice missions, save audited points and explicitly publish a class snapshot. Students see their own reviewed score and alias-only standings; another student's private score stays inaccessible.
7. Both student and teacher inboxes show public release notices. The public history page renders the curated notes. Student mobile layout has no horizontal page overflow.

## Limits

The full visual slide editor is not covered by this browser fixture. Lesson-to-slide conversion and escaping are unit-tested; a larger canvas/course-authoring upgrade is proposed separately. The XML lab is an approximation with a documented subset of Android layout support, not an Android runtime. Real provider quality, actual authorship, private-repository access, source-sharing policy and Android behavior require instructor verification with an approved test roster.

Personal practice completions remain self-recorded. Reviewed points require explicit instructor judgment; they are not automatic assessment grades. Alias standings are published snapshots, and opt-out requests require a new teacher publication to remove older entries. In-app release alerts are not background push/email delivery.

No Firebase rules or Functions deployment, PR merge, production notification fanout or grade publication is performed by these tests. CI results for the final review head are recorded in the pull request.
