# Practice and evaluation follow-up — review only

No merge, deployment, public release notice, migration job, monitoring activation
or grade publication is authorized by this change. The installed release manifest
and lesson export formats are unchanged.

## Teacher evaluation

- Review navigation sits outside the one scrolling modal body, directly under the
  title. It does not float below a margin or conceal the evidence status.
- Approve the actual individual evidence, then choose Evaluate. Historical verified
  diffs remain in scope even when their SHA differs from the project checkpoint;
  the project source itself stays pinned to that checkpoint.
- Each criterion is independent. An unclear responsibility note is not sufficient
  to erase teacher-verified attribution or demonstrable technical findings.
  It still cannot establish missing responsibilities, runtime behavior or a whole
  project from one XML component. Shared group context earns no individual credit.
- Feedback requests observed strengths, a file/element-specific issue, its effect,
  an improvement and a way to test it. Uncertainty must be explained neutrally;
  private unintelligible teacher notes should not be quoted to students.
- Pending criteria show a concrete next check. Supported criteria can display a
  partial subtotal, never a reweighted final total or missing-score zero. The
  suggested full score remains unavailable until every criterion is supported.
  Manual Teacher grade remains available; use the shortcut to enter the final
  teacher score and feedback. Nothing is copied, saved or published automatically.
- The screenshots do not establish that the student made no contribution. A row
  layout is a component, not necessarily a full screen. Visual/runtime criteria
  may require Android Studio or a demonstration. Clarify assigned responsibilities
  rather than inventing scope or crediting a teammate's missing work.

## Practice and class rankings

- Four courses × five modules × fifteen missions = 300 guided missions. Existing
  IDs/completions are retained; completed legacy missions do not become locked.
  Module entries expose their counts; first missions are independently accessible.
- Student progress merges cloud and local records transactionally. Work added
  during a pending save remains queued and is drained without losing completions
  or reflections. Offline progress remains in account-scoped local storage.
- `practice_rankings/{studentId}` contains generated alias, completion count and
  ten XP per distinct valid mission, plus owner/roster IDs, section and timestamps.
  Classmates see aliases/XP in the UI, never private reflection text or emails.
  Firestore documents include opaque record IDs; aliases are pseudonyms, not
  anonymity guarantees. Authorized staff retain existing academic access.
- Class reads require verified enrollment and a matching, live selected-section
  membership. Unfiltered and other-class student queries are denied. Roster
  transfers revoke the student's former-section read permission immediately.
- Owners synchronize totals from four private course records in a transaction.
  Rules validate both creates/updates, reject unknown/cross-course or duplicate
  IDs and forged numeric totals, and preserve ranking owner/alias. No client can
  overwrite a school grade through the ranking path. Old reviewed snapshots are
  separate advanced records; their opt-in value is not silently enabled.
- Limitations: completion of known IDs is still client-reported, not trustworthy
  mastery. Rankings sync while Practice Lab is open; offline activity can lag.
  Boards display at most 500 rows and explicitly label a capped subset. Records
  for transferred/deleted profiles may remain in an old class until controlled
  resynchronization/cleanup; no live cleanup is performed. Catalog IDs and rules
  must change together; a regression test checks exact parity.
- Existing academic instructor rights are broader than complete per-class tenant
  isolation. Do not interpret this private student leaderboard as a full rewrite
  of legacy staff access. Do not onboard unrelated institutions on that assumption.

## Help cleanup

Repeated heading-level links are removed. Use the navigation **? → Help with
this page**, or **Help / tutorial** in the footer. Context-specific help inside
Review/Evaluation/Teacher grade stays available. Wiki, privacy and patch history
remain accessible from the footer and information menu.

## Validation and future work

Pure regressions cover catalog/rules parity, all mission variants, aliases and
ties, evidence scope, partial criteria and save races. Real local Auth/Firestore
browser coverage exercises automatic XP before activity consent or teacher
publication, legacy private-record recovery, peer reflection denial, desktop/mobile
review header geometry and information-menu help. Security tests exercise ownership,
valid/invalid completions, cross-class queries and all 300 IDs within rule budgets.
GitHub and evaluation-provider behavior use fixtures, not proof of live model
accuracy or live GitHub availability.

The new rules are a review prototype, not a deployment or a guarantee. Review the
new paths and existing staff permissions before broadly sharing. Games are
proposals only: see [Learning Arcade](learning-arcade-proposal.md).

Local checks: 259 JavaScript/model regressions, 71 isolated permission/worker
checks and the 14-milestone real Auth/Firestore browser lifecycle passed. Browser
artifacts also cover the flush mobile review navigation and automatic class XP.
Final hosted CI status is reported on the PR's exact head, not inferred from an
earlier commit. No live external-provider accuracy claim is made.
